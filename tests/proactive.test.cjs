const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REMINDER_TTL_MS, SNOOZE_MS, DAILY_LIMIT,
  stampTaskActivity, reconcileReminder, planReminder, applyReminderAction,
  validProactive, validProactiveSettings,
} = require('../electron/proactive.cjs');

// Local dates deliberately avoid assumptions about the machine's time zone.
const at = (time, day = 11) => new Date(2026, 8, day, ...time.split(':').map(Number));
const iso = (time, day = 11) => at(time, day).toISOString();
const later = (date, minutes) => new Date(date.getTime() + minutes * 60000);
function fixture(overrides = {}) {
  return {
    settings: { floatingBallEnabled: true, rolloverTime: '02:00', proactiveEnabled: true,
      proactiveIntervalMinutes: 120, proactiveQuietStart: '22:00', proactiveQuietEnd: '09:00' },
    activeDate: '2020-01-01', // Viewing history is independent of the logical date.
    tasks: [{ id: 't1', name: '分析实验数据', date: '2026-09-11', progress: 20, lastProgressAt: iso('09:00') }],
    chatSessions: [], ...overrides,
  };
}
const settings = (state, changes) => ({ ...state, settings: { ...state.settings, ...changes } });
const frozen = value => {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(frozen); }
  return value;
};

test('new and changed progress stamp now while ordinary edits preserve activity', () => {
  const previous = frozen(fixture());
  const edited = { ...previous, tasks: [{ ...previous.tasks[0], name: '改名', notes: '补充说明' }], chatSessions: [{ id: 'chat' }] };
  assert.equal(stampTaskActivity(previous, edited, at('12:00')), edited);
  const missing = { ...edited, tasks: [{ ...edited.tasks[0], lastProgressAt: undefined }] };
  assert.equal(stampTaskActivity(previous, missing, at('12:00')).tasks[0].lastProgressAt, iso('09:00'));
  const changed = { ...previous, tasks: [{ ...previous.tasks[0], progress: 21 },
    { id: 't2', name: '新任务', date: '2026-09-11', progress: 0, lastProgressAt: iso('06:00') }] };
  const stamped = stampTaskActivity(previous, frozen(changed), at('12:00'));
  assert.deepEqual(stamped.tasks.map(task => task.lastProgressAt), [iso('12:00'), iso('12:00')]);
  assert.equal(previous.tasks[0].lastProgressAt, iso('09:00'));
});

test('first migration and restore preserve supplied timestamps and fill only missing ones', () => {
  const state = fixture({ tasks: [fixture().tasks[0], { id: 'old', name: '旧任务', progress: 0, date: '2026-09-11' }] });
  const restored = stampTaskActivity(null, frozen(state), at('12:00'));
  assert.equal(restored.tasks[0], state.tasks[0]);
  assert.equal(restored.tasks[1].lastProgressAt, iso('12:00'));
  assert.equal(stampTaskActivity(null, restored, at('15:00')), restored);
  const migration = stampTaskActivity(state, state, at('12:00'));
  assert.equal(migration.tasks[1].lastProgressAt, iso('12:00'));
});

test('idle threshold includes the boundary; persisted active is stable and does not spend quota twice', () => {
  const state = frozen(fixture());
  assert.equal(planReminder(state, at('10:59')), state);
  const planned = planReminder(state, at('11:00'));
  assert.equal(planned.proactive.active.taskId, 't1');
  assert.equal(planned.proactive.count, 1);
  assert.equal(planned.proactive.day, '2026-09-11');
  assert.equal(planned.proactive.lastRemindedAt, iso('11:00'));
  assert.match(planned.proactive.active.message, /进度记录.*没更新/);
  assert.doesNotMatch(planned.proactive.active.message, /偷懒|你没有工作|毫无进展/);
  assert.equal(planReminder(planned, at('11:04')), planned);
  const restarted = JSON.parse(JSON.stringify(planned));
  assert.deepEqual(planReminder(restarted, at('11:04')), planned);
  assert.ok(validProactive(planned.proactive));
});

test('oldest activity wins, with high priority only breaking equal activity times', () => {
  const task = fixture().tasks[0];
  const state = fixture({ tasks: [
    { ...task, id: 'new-high', priority: 'high', lastProgressAt: iso('09:30') },
    { ...task, id: 'old-low', priority: 'low', lastProgressAt: iso('08:00') },
    { ...task, id: 'old-high', priority: 'high', lastProgressAt: iso('08:00') },
  ] });
  assert.equal(planReminder(state, at('12:00')).proactive.active.taskId, 'old-high');
  state.tasks[1].lastProgressAt = iso('07:59');
  assert.equal(planReminder(state, at('12:00')).proactive.active.taskId, 'old-low');
});

test('only incomplete logical-today tasks qualify, regardless of the date being viewed', () => {
  const task = fixture().tasks[0];
  const ineligible = [
    { ...task, id: 'yesterday', date: '2026-09-10' },
    { ...task, id: 'tomorrow', date: '2026-09-12' },
    { ...task, id: 'done', progress: 100 },
    { ...task, id: 'future-activity', lastProgressAt: iso('15:00') },
    { ...task, id: 'unstamped', lastProgressAt: undefined },
  ];
  const state = fixture({ tasks: ineligible });
  assert.equal(planReminder(state, at('12:00')), state);
  assert.equal(planReminder({ ...state, tasks: [...ineligible, task] }, at('12:00')).proactive.active.taskId, task.id);
});

test('logical rollover uses local cutoff including midnight instead of activeDate', () => {
  let state = settings(fixture({ tasks: [{ ...fixture().tasks[0], date: '2026-09-10', lastProgressAt: iso('20:00', 10) }] }),
    { proactiveQuietStart: '00:00', proactiveQuietEnd: '00:00' });
  assert.equal(planReminder(state, at('01:59')).proactive.day, '2026-09-10');
  assert.equal(planReminder(state, at('02:00')), state);
  state = settings(state, { rolloverTime: '06:30' });
  const planned = planReminder(state, at('06:29'));
  assert.equal(planned.proactive.active.taskDate, '2026-09-10');
  assert.equal(reconcileReminder(planned, at('06:30')).proactive.active, undefined);
});

test('quiet intervals cross midnight and include start but exclude end; equal times disable quiet', () => {
  const task = { ...fixture().tasks[0], lastProgressAt: iso('00:00') };
  const state = fixture({ tasks: [task] });
  assert.equal(planReminder(state, at('08:59')), state);
  assert.ok(planReminder(state, at('09:00')).proactive.active);
  assert.ok(planReminder(state, at('21:59')).proactive.active);
  assert.equal(planReminder(state, at('22:00')), state);
  const tomorrow = { ...state, tasks: [{ ...task, date: '2026-09-12' }] };
  assert.equal(planReminder(tomorrow, at('03:00', 12)), tomorrow);
  assert.ok(planReminder(settings(tomorrow, { proactiveQuietStart: '22:00', proactiveQuietEnd: '22:00' }), at('03:00', 12)).proactive.active);
  const middayQuiet = settings(state, { proactiveQuietStart: '12:00', proactiveQuietEnd: '13:00' });
  assert.equal(planReminder(middayQuiet, at('12:59')), middayQuiet);
  assert.ok(planReminder(middayQuiet, at('13:00')).proactive.active);
  assert.equal(reconcileReminder(planReminder(state, at('21:59')), at('22:00')).proactive.active, undefined);
});

test('5 minute card TTL retracts without refund, and actions reject expired IDs', () => {
  assert.equal(REMINDER_TTL_MS, 300000);
  const planned = frozen(planReminder(fixture(), at('12:00')));
  assert.equal(reconcileReminder(planned, new Date(at('12:00').getTime() + REMINDER_TTL_MS - 1)), planned);
  const expired = reconcileReminder(planned, at('12:05'));
  assert.equal(expired.proactive.active, undefined);
  assert.equal(expired.proactive.count, 1);
  assert.equal(expired.proactive.lastRemindedAt, iso('12:00'));
  assert.throws(() => applyReminderAction(planned, planned.proactive.active.id, 'snooze', undefined, at('12:05')), /过期/);
  assert.equal(planReminder(expired, at('13:59')), expired);
  assert.equal(planReminder(expired, at('14:00')).proactive.count, 2);
});

test('daily cap survives restart and resets only when logical day moves forward', () => {
  let state = fixture();
  for (const time of ['11:00', '13:00', '15:00']) state = planReminder(JSON.parse(JSON.stringify(state)), at(time));
  assert.equal(state.proactive.count, DAILY_LIMIT);
  const expired = reconcileReminder(state, at('15:05'));
  assert.equal(planReminder(expired, at('17:00')), expired);
  const rolled = { ...expired, tasks: [{ ...expired.tasks[0], date: '2026-09-12' }] };
  const tomorrow = planReminder(rolled, at('09:00', 12));
  assert.equal(tomorrow.proactive.count, 1);
  assert.equal(tomorrow.proactive.day, '2026-09-12');
  const clockBack = planReminder({ ...tomorrow, tasks: expired.tasks }, at('18:00'));
  assert.equal(clockBack.proactive.active, undefined);
  assert.equal(clockBack.proactive.count, 1);
  assert.equal(clockBack.proactive.day, '2026-09-12');
});

test('snooze and help defer the same task 30 minutes then bypass global cooldown once', () => {
  assert.equal(SNOOZE_MS, 1800000);
  for (const action of ['snooze', 'help']) {
    const planned = planReminder(fixture(), at('12:00'));
    const delayed = applyReminderAction(frozen(planned), planned.proactive.active.id, action, undefined, at('12:01'));
    assert.equal(delayed.proactive.active, undefined);
    assert.equal(delayed.proactive.snoozedUntil, undefined);
    assert.equal(delayed.proactive.taskStates.t1.snoozedUntil, iso('12:31'));
    assert.equal(delayed.proactive.taskStates.t1.snoozeCount, action === 'snooze' ? 1 : 0);
    assert.equal(delayed.proactive.count, 1);
    assert.equal(delayed.proactive.lastRemindedAt, iso('12:00'));
    assert.equal(planReminder(delayed, at('12:30')), delayed);
    const due = planReminder(JSON.parse(JSON.stringify(delayed)), at('12:31'));
    assert.equal(due.proactive.count, 2);
    assert.equal(due.proactive.snoozedUntil, undefined);
    assert.equal(due.proactive.taskStates.t1.snoozedUntil, undefined);
    assert.equal(due.proactive.active.snoozeMinutes, action === 'snooze' ? 60 : 30);
    assert.equal(planReminder(due, at('13:01')).proactive.active, undefined);
    assert.equal(planReminder(due, at('14:31')).proactive.count, 3);
    assert.deepEqual(delayed.tasks, planned.tasks);
  }
});

test('due snooze still observes task activity, quiet hours, daily cap and clock rollback', () => {
  const planned = planReminder(fixture(), at('12:00'));
  const delayed = applyReminderAction(planned, planned.proactive.active.id, 'snooze', undefined, at('12:01'));
  const progressed = { ...delayed, tasks: [{ ...delayed.tasks[0], progress: 40, lastProgressAt: iso('12:20') }] };
  const reconciled = planReminder(progressed, at('12:31'));
  assert.equal(reconciled.proactive.active, undefined);
  assert.deepEqual(reconciled.proactive.taskStates.t1, { snoozeCount: 0, lastProgressAt: iso('12:20') });
  assert.ok(planReminder(progressed, at('14:20')).proactive.active);
  const quiet = settings(delayed, { proactiveQuietStart: '12:30', proactiveQuietEnd: '13:00' });
  assert.equal(planReminder(quiet, at('12:31')), quiet);
  assert.ok(planReminder(quiet, at('13:00')).proactive.active);
  const capped = { ...delayed, proactive: { ...delayed.proactive, count: 3 } };
  assert.equal(planReminder(capped, at('12:31')), capped);
  const rollback = { ...delayed, proactive: { ...delayed.proactive, snoozedUntil: iso('11:30') } };
  assert.equal(planReminder(rollback, at('11:59')), rollback);
});

test('dismiss today respects logical day and restoring reminders preserves quota/cooldown', () => {
  const planned = planReminder(fixture(), at('12:00'));
  const dismissed = applyReminderAction(planned, planned.proactive.active.id, 'today', undefined, at('12:01'));
  assert.equal(dismissed.proactive.dismissedDate, '2026-09-11');
  assert.equal(planReminder(dismissed, at('18:00')), dismissed);
  const { dismissedDate, ...proactive } = dismissed.proactive;
  const resumed = { ...dismissed, proactive };
  assert.equal(planReminder(resumed, at('12:02')), resumed);
  assert.equal(planReminder(resumed, at('14:00')).proactive.count, 2);
  const nextDay = { ...dismissed, tasks: [{ ...dismissed.tasks[0], date: '2026-09-12' }] };
  assert.ok(planReminder(nextDay, at('09:00', 12)).proactive.active);
});

test('updates and same-value confirmations stamp activity, close the card and keep quota', () => {
  for (const progress of [0, 20, 20.5, 50, 100]) {
    const input = fixture();
    if (progress === 20.5) input.tasks[0].progress = 20.5;
    const planned = frozen(planReminder(input, at('12:00')));
    const confirmed = applyReminderAction(planned, planned.proactive.active.id, 'update', progress, at('12:01'));
    assert.equal(confirmed.tasks[0].progress, progress);
    assert.equal(confirmed.tasks[0].lastProgressAt, iso('12:01'));
    assert.equal(confirmed.proactive.active, undefined);
    assert.equal(confirmed.proactive.count, 1);
    assert.equal(confirmed.proactive.lastRemindedAt, iso('12:00'));
    // The persisted write's stamping must not lose an explicit same-value confirmation.
    assert.equal(stampTaskActivity(planned, confirmed, at('12:01')), confirmed);
    assert.equal(planReminder(confirmed, at('14:00')), confirmed);
    assert.equal(Boolean(planReminder(confirmed, at('14:01')).proactive.active), progress < 100);
  }
});

test('stale task versions, deletion, completion, date changes and forged IDs reject all actions', () => {
  const planned = planReminder(fixture(), at('12:00'));
  const id = planned.proactive.active.id;
  const variants = [
    { ...planned, tasks: [] },
    { ...planned, tasks: [{ ...planned.tasks[0], progress: 21 }] },
    { ...planned, tasks: [{ ...planned.tasks[0], progress: 100 }] },
    { ...planned, tasks: [{ ...planned.tasks[0], date: '2026-09-12' }] },
    { ...planned, tasks: [{ ...planned.tasks[0], name: '新名称' }] },
    { ...planned, tasks: [{ ...planned.tasks[0], lastProgressAt: iso('12:00') }] },
    { ...planned, proactive: { ...planned.proactive, dismissedDate: '2026-09-11' } },
    { ...planned, proactive: { ...planned.proactive, snoozedUntil: iso('12:30') } },
  ];
  for (const variant of variants) {
    assert.equal(reconcileReminder(variant, at('12:01')).proactive.active, undefined);
    for (const action of ['update', 'complete', 'advance', 'unchanged', 'snooze', 'dismiss-task', 'today', 'help']) {
      assert.throws(() => applyReminderAction(variant, id, action, action === 'update' ? 30 : undefined, at('12:01')), /过期/);
    }
  }
  assert.throws(() => applyReminderAction(planned, 'forged', 'today', undefined, at('12:01')), /过期/);
  const annotated = { ...planned, tasks: [{ ...planned.tasks[0], notes: '新备注' }] };
  assert.equal(reconcileReminder(annotated, at('12:01')), annotated);
  const renamed = { ...planned, tasks: [{ ...planned.tasks[0], name: '改名' }] };
  const withdrawn = reconcileReminder(renamed, at('12:01'));
  assert.equal(withdrawn.proactive.active, undefined);
  assert.equal(withdrawn.proactive.count, planned.proactive.count);
  assert.equal(withdrawn.proactive.lastRemindedAt, planned.proactive.lastRemindedAt);
});

test('both settings switches withdraw active and retain same-day interval and quota across restart', () => {
  const planned = planReminder(fixture(), at('12:00'));
  for (const key of ['floatingBallEnabled', 'proactiveEnabled']) {
    const disabled = reconcileReminder(settings(planned, { [key]: false }), at('12:01'));
    assert.equal(disabled.proactive.active, undefined);
    assert.equal(disabled.proactive.count, 1);
    assert.equal(planReminder(disabled, at('18:00')), disabled);
    const enabled = settings(JSON.parse(JSON.stringify(disabled)), { [key]: true });
    assert.equal(planReminder(enabled, at('13:59')), enabled);
    assert.equal(planReminder(enabled, at('14:00')).proactive.count, 2);
  }
});

test('same-day clock rollback withdraws a future card and cannot trigger a reminder burst', () => {
  const planned = planReminder(fixture(), at('12:00'));
  const back = planReminder(planned, at('11:00'));
  assert.equal(back.proactive.active, undefined);
  assert.equal(back.proactive.count, 1);
  assert.equal(back.proactive.lastRemindedAt, iso('12:00'));
  assert.equal(planReminder(back, at('11:59')), back);
  assert.equal(planReminder(back, at('13:59')), back);
  assert.equal(planReminder(back, at('14:00')).proactive.count, 2);
  assert.throws(() => applyReminderAction(planned, planned.proactive.active.id, 'update', 50, at('11:59')), /过期/);
});

test('malformed settings/state and action parameters are rejected without mutation', () => {
  assert.ok(validProactive(undefined));
  assert.ok(validProactiveSettings({}));
  assert.ok(validProactiveSettings(fixture().settings));
  for (const bad of [null, {}, { day: '2026-02-30', count: 0 }, { day: '2026-09-11', count: 4 },
    { day: '2026-09-11', count: 1, snoozedUntil: 'not a date' }]) assert.equal(validProactive(bad), false);
  for (const bad of [null, { proactiveEnabled: 1 }, { proactiveIntervalMinutes: 90 },
    { proactiveQuietStart: '24:00' }, { proactiveQuietEnd: '9:00' }]) assert.equal(validProactiveSettings(bad), false);
  const state = frozen(planReminder(fixture(), at('12:00')));
  for (const progress of [undefined, NaN, Infinity, -1, 101, '20', null]) {
    assert.throws(() => applyReminderAction(state, state.proactive.active.id, 'update', progress, at('12:01')), /进度/);
  }
  assert.throws(() => applyReminderAction(state, state.proactive.active.id, 'snooze', 20, at('12:01')), /进度/);
  assert.throws(() => applyReminderAction(state, state.proactive.active.id, 'invalid', undefined, at('12:01')), /不支持/);
  assert.throws(() => planReminder(state, new Date('invalid')), /时间/);
});

test('consecutive task snoozes grow 30/60/120 minutes and stay capped across restart and days', () => {
  let state = planReminder(fixture(), at('12:00'));
  for (const [count, actionTime, dueTime, nextMinutes] of [[1, '12:01', '12:31', 60], [2, '12:32', '13:32', 120]]) {
    assert.equal(state.proactive.active.snoozeMinutes, count === 1 ? 30 : 60);
    state = applyReminderAction(frozen(state), state.proactive.active.id, 'snooze', undefined, at(actionTime));
    assert.equal(state.proactive.taskStates.t1.snoozeCount, count);
    assert.equal(state.proactive.taskStates.t1.snoozedUntil, iso(dueTime));
    state = planReminder(JSON.parse(JSON.stringify(state)), at(dueTime));
    assert.equal(state.proactive.active.snoozeMinutes, nextMinutes);
  }
  state = applyReminderAction(state, state.proactive.active.id, 'snooze', undefined, at('13:33'));
  assert.equal(state.proactive.taskStates.t1.snoozedUntil, iso('15:33'));
  assert.equal(state.proactive.taskStates.t1.snoozeCount, 3);
  assert.equal(planReminder(state, at('15:33')).proactive.active, undefined, 'A due snooze never bypasses daily quota');
  const tomorrow = { ...state, tasks: state.tasks.map(task => ({ ...task, date: '2026-09-12' })) };
  const nextDay = planReminder(tomorrow, at('09:00', 12));
  assert.equal(nextDay.proactive.count, 1);
  assert.equal(nextDay.proactive.active.snoozeMinutes, 120);
  const capped = applyReminderAction(nextDay, nextDay.proactive.active.id, 'snooze', undefined, at('09:01', 12));
  assert.equal(capped.proactive.taskStates.t1.snoozeCount, 3);
  assert.equal(capped.proactive.taskStates.t1.snoozedUntil, iso('11:01', 12));
});

test('task snoozes only bypass the interval for their own due follow-up', () => {
  const input = fixture();
  input.tasks.push({ ...input.tasks[0], id: 't2', name: '另一任务', lastProgressAt: iso('09:30') });
  const planned = planReminder(input, at('12:00'));
  const delayed = applyReminderAction(planned, planned.proactive.active.id, 'snooze', undefined, at('12:01'));
  assert.equal(planReminder(delayed, at('12:02')).proactive.active, undefined);
  assert.equal(planReminder(delayed, at('12:31')).proactive.active.taskId, 't1');

  const longPause = { ...delayed, proactive: { ...delayed.proactive, taskStates: {
    t1: { ...delayed.proactive.taskStates.t1, snoozeCount: 3, snoozedUntil: iso('15:00') },
  } } };
  assert.equal(planReminder(longPause, at('13:59')).proactive.active, undefined);
  assert.equal(planReminder(longPause, at('14:00')).proactive.active.taskId, 't2');
  const deleted = { ...delayed, tasks: delayed.tasks.filter(task => task.id !== 't1') };
  const cleaned = planReminder(deleted, at('12:31'));
  assert.deepEqual(cleaned.proactive.taskStates, {});
  assert.equal(cleaned.proactive.active, undefined, 'Deleting a snoozed task cannot transfer its bypass to another task');
});

test('dismissing one task retains other reminders after cooldown and expires on the next logical day', () => {
  const input = fixture();
  input.tasks.push({ ...input.tasks[0], id: 't2', lastProgressAt: iso('09:30') });
  const planned = planReminder(input, at('12:00'));
  const dismissed = applyReminderAction(planned, planned.proactive.active.id, 'dismiss-task', undefined, at('12:01'));
  assert.equal(dismissed.proactive.dismissedDate, undefined);
  assert.equal(dismissed.proactive.taskStates.t1.dismissedDate, '2026-09-11');
  assert.equal(dismissed.proactive.lastRemindedAt, planned.proactive.lastRemindedAt);
  assert.equal(planReminder(dismissed, at('12:02')).proactive.active, undefined);
  assert.equal(planReminder(dismissed, at('14:00')).proactive.active.taskId, 't2');
  const tomorrow = { ...dismissed, tasks: [{ ...dismissed.tasks[0], date: '2026-09-12' }] };
  assert.equal(planReminder(tomorrow, at('09:00', 12)).proactive.active.taskId, 't1');
});

test('complete, advance and unchanged atomically confirm the active task and reset its postponement streak', () => {
  for (const [action, before, after] of [['complete', 20, 100], ['advance', 20, 30], ['advance', 95.5, 100], ['unchanged', 20, 20]]) {
    const input = fixture(); input.tasks[0].progress = before;
    input.tasks.push({ ...input.tasks[0], id: 't2', lastProgressAt: iso('09:30') });
    input.proactive = { day: '2026-09-11', count: 0, taskStates: {
      t1: { snoozeCount: 2, lastProgressAt: input.tasks[0].lastProgressAt },
      t2: { snoozeCount: 1, lastProgressAt: input.tasks[1].lastProgressAt },
    } };
    const planned = frozen(planReminder(input, at('12:00')));
    const confirmed = applyReminderAction(planned, planned.proactive.active.id, action, undefined, at('12:01'));
    assert.equal(confirmed.tasks[0].progress, after);
    assert.equal(confirmed.tasks[0].lastProgressAt, iso('12:01'));
    assert.equal(confirmed.tasks[1], planned.tasks[1]);
    assert.equal(confirmed.proactive.active, undefined);
    assert.equal(confirmed.proactive.count, 1);
    assert.equal(confirmed.proactive.lastRemindedAt, iso('12:00'));
    assert.deepEqual(confirmed.proactive.taskStates.t2, planned.proactive.taskStates.t2);
    if (after === 100) assert.equal(confirmed.proactive.taskStates.t1, undefined);
    else assert.deepEqual(confirmed.proactive.taskStates.t1, { snoozeCount: 0, lastProgressAt: iso('12:01') });
    assert.equal(stampTaskActivity(planned, confirmed, at('12:01')), confirmed);
    assert.throws(() => applyReminderAction(confirmed, planned.proactive.active.id, action, undefined, at('12:02')), /过期/);
    assert.throws(() => applyReminderAction(planned, planned.proactive.active.id, action, 30, at('12:01')), /进度/);
  }
});

test('other-window progress confirmations reset only that task; ordinary notes retain its streak', () => {
  const planned = planReminder(fixture(), at('12:00'));
  const delayed = frozen(applyReminderAction(planned, planned.proactive.active.id, 'snooze', undefined, at('12:01')));
  const annotated = { ...delayed, tasks: [{ ...delayed.tasks[0], notes: '新备注' }] };
  assert.equal(stampTaskActivity(delayed, annotated, at('12:02')), annotated);
  for (const change of [{ progress: 30 }, { lastProgressAt: iso('12:02') }]) {
    const edited = { ...delayed, tasks: [{ ...delayed.tasks[0], ...change }] };
    const stamped = stampTaskActivity(delayed, edited, at('12:02'));
    assert.deepEqual(stamped.proactive.taskStates.t1, { snoozeCount: 0, lastProgressAt: iso('12:02') });
    assert.equal(planReminder(stamped, at('12:31')).proactive.active, undefined);
    assert.equal(planReminder(stamped, at('14:02')).proactive.active.snoozeMinutes, 30);
  }
  const complete = { ...delayed, tasks: [{ ...delayed.tasks[0], progress: 100 }] };
  assert.deepEqual(stampTaskActivity(delayed, complete, at('12:02')).proactive.taskStates, {});
  const restored = stampTaskActivity(null, JSON.parse(JSON.stringify(delayed)), at('12:02'));
  assert.deepEqual(restored, delayed, 'Valid restored progress versions retain their streak and deadline');
});

test('help postpones only its task and does not add another consecutive snooze', () => {
  const input = fixture();
  input.proactive = { day: '2026-09-11', count: 0, taskStates: { t1: { snoozeCount: 2, lastProgressAt: iso('09:00') } } };
  const planned = planReminder(input, at('12:00'));
  const helped = applyReminderAction(planned, planned.proactive.active.id, 'help', undefined, at('12:01'));
  assert.equal(helped.proactive.snoozedUntil, undefined);
  assert.equal(helped.proactive.taskStates.t1.snoozeCount, 2);
  assert.equal(helped.proactive.taskStates.t1.snoozedUntil, iso('12:31'));
  assert.equal(planReminder(helped, at('12:31')).proactive.active.snoozeMinutes, 120);
});

test('legacy global postponement and dismissal remain readable and effective', () => {
  const input = fixture({ proactive: { day: '2026-09-11', count: 1, lastRemindedAt: iso('12:00'), snoozedUntil: iso('12:31') } });
  assert.ok(validProactive(input.proactive));
  assert.equal(planReminder(input, at('12:30')), input);
  const due = planReminder(input, at('12:31'));
  assert.equal(due.proactive.active.taskId, 't1');
  assert.equal(due.proactive.snoozedUntil, undefined);
  assert.equal(due.proactive.active.snoozeMinutes, 30);
  const dismissed = { ...input, proactive: { ...input.proactive, dismissedDate: '2026-09-11' } };
  assert.equal(planReminder(dismissed, at('14:00')), dismissed);
});

test('task reminder fields reject malformed imports and safely support arbitrary existing task IDs', () => {
  const base = { day: '2026-09-11', count: 0 };
  for (const taskStates of [null, [], { '': {} }, { t1: null }, { t1: { snoozeCount: -1 } }, { t1: { snoozeCount: 1.5 } },
    { t1: { snoozeCount: 4 } }, { t1: { snoozedUntil: 'later' } }, { t1: { dismissedDate: '2026-02-30' } },
    { t1: { lastProgressAt: '' } }]) assert.equal(validProactive({ ...base, taskStates }), false);
  const planned = planReminder(fixture(), at('12:00'));
  assert.equal(validProactive({ ...planned.proactive, active: { ...planned.proactive.active, snoozeMinutes: 45 } }), false);
  const input = fixture(); input.tasks[0].id = '__proto__';
  const unusual = planReminder(input, at('12:00'));
  const delayed = applyReminderAction(unusual, unusual.proactive.active.id, 'snooze', undefined, at('12:01'));
  assert.ok(Object.hasOwn(delayed.proactive.taskStates, '__proto__'));
  assert.equal(delayed.proactive.taskStates.__proto__.snoozeCount, 1);
  assert.equal(Object.getPrototypeOf(delayed.proactive.taskStates), Object.prototype);
  assert.ok(validProactive(JSON.parse(JSON.stringify(delayed.proactive))));
});
