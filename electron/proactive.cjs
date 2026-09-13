'use strict';

// This module only transforms state. The main process owns scheduling, saving,
// and displaying the returned reminder; no model or operating-system API runs here.
const REMINDER_TTL_MS = 5 * 60 * 1000;
const SNOOZE_MS = 30 * 60 * 1000;
const DAILY_LIMIT = 3;
const INTERVALS = [30, 60, 120, 240];
const SNOOZE_MINUTES = [30, 60, 120];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = value => typeof value === 'string';
const optional = (value, check) => value === undefined || check(value);
const isTimestamp = value => isString(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const isTime = value => isString(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const isDate = value => isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function validActive(value) {
  return isObject(value) && ['id', 'taskId', 'taskName', 'message'].every(key => isString(value[key]))
    && value.id.length > 0 && isDate(value.taskDate)
    && Number.isFinite(value.progress) && value.progress >= 0 && value.progress < 100
    && isTimestamp(value.lastProgressAt) && isTimestamp(value.createdAt)
    && optional(value.snoozeMinutes, value => SNOOZE_MINUTES.includes(value));
}

function validTaskState(value) {
  return isObject(value) && optional(value.snoozedUntil, isTimestamp)
    && optional(value.snoozeCount, value => Number.isInteger(value) && value >= 0 && value <= 3)
    && optional(value.dismissedDate, isDate) && optional(value.lastProgressAt, isTimestamp);
}

/** Optional fields are accepted for legacy files; malformed present fields are not. */
function validProactive(value) {
  return value === undefined || (isObject(value) && isDate(value.day)
    && Number.isInteger(value.count) && value.count >= 0 && value.count <= DAILY_LIMIT
    && optional(value.lastRemindedAt, isTimestamp) && optional(value.snoozedUntil, isTimestamp)
    && optional(value.dismissedDate, isDate) && optional(value.active, validActive)
    && optional(value.taskStates, states => isObject(states)
      && Object.entries(states).every(([id, state]) => id.length > 0 && validTaskState(state))));
}

function validProactiveSettings(settings) {
  return isObject(settings)
    && optional(settings.proactiveEnabled, value => typeof value === 'boolean')
    && optional(settings.proactiveIntervalMinutes, value => INTERVALS.includes(value))
    && optional(settings.proactiveQuietStart, isTime) && optional(settings.proactiveQuietEnd, isTime);
}

function checkedNow(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('提醒时间无效');
  return now;
}

function localDate(now, rolloverTime) {
  const [hour, minute] = (isTime(rolloverTime) ? rolloverTime : '02:00').split(':').map(Number);
  const boundary = new Date(now);
  boundary.setHours(hour, minute, 0, 0);
  const day = new Date(now);
  if (now < boundary) day.setDate(day.getDate() - 1);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function inQuietHours(settings, now) {
  const minutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  const start = minutes(isTime(settings.proactiveQuietStart) ? settings.proactiveQuietStart : '22:00');
  const end = minutes(isTime(settings.proactiveQuietEnd) ? settings.proactiveQuietEnd : '09:00');
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : start > end && (current >= start || current < end);
}

function intervalMs(settings) {
  return (INTERVALS.includes(settings.proactiveIntervalMinutes) ? settings.proactiveIntervalMinutes : 120) * 60 * 1000;
}

function canRemind(state, now, day) {
  const settings = state.settings || {};
  const proactive = state.proactive;
  return settings.floatingBallEnabled === true && settings.proactiveEnabled !== false
    && !inQuietHours(settings, now)
    && !(isTimestamp(proactive?.snoozedUntil) && Date.parse(proactive.snoozedUntil) > now.getTime())
    && proactive?.dismissedDate !== day;
}

function taskState(state, id) {
  const states = state.proactive?.taskStates;
  return states && Object.hasOwn(states, id) ? states[id] : undefined;
}

function canRemindTask(state, task, now, day) {
  const status = taskState(state, task.id);
  return status?.dismissedDate !== day
    && !(isTimestamp(status?.snoozedUntil) && Date.parse(status.snoozedUntil) > now.getTime());
}

function updateTaskState(state, id, value) {
  return { ...state, proactive: { ...state.proactive, taskStates: { ...state.proactive?.taskStates, [id]: value } } };
}

function resetTaskSnooze(state, id, timestamp) {
  const previous = taskState(state, id);
  if (!previous) return state;
  if (previous.snoozeCount === 0 && previous.snoozedUntil === undefined && previous.lastProgressAt === timestamp) return state;
  const { snoozedUntil, ...rest } = previous;
  return updateTaskState(state, id, { ...rest, snoozeCount: 0, lastProgressAt: timestamp });
}

// Bind postponements to the progress version, including confirmations from
// another window. A dismissed task stays dismissed for its explicitly chosen day.
function reconcileTaskStates(state) {
  const states = state.proactive?.taskStates;
  if (!states) return state;
  const tasks = new Map(state.tasks.map(task => [task.id, task]));
  let next = state;
  const removed = [];
  for (const [id, status] of Object.entries(states)) {
    const task = tasks.get(id);
    if (!task || task.progress >= 100) { removed.push(id); continue; }
    if (status.lastProgressAt !== undefined && status.lastProgressAt !== task.lastProgressAt) {
      next = resetTaskSnooze(next, id, task.lastProgressAt);
    } else if (status.lastProgressAt === undefined && isTimestamp(task.lastProgressAt)) {
      next = updateTaskState(next, id, { ...status, lastProgressAt: task.lastProgressAt });
    }
  }
  if (removed.length) {
    const retained = { ...next.proactive.taskStates };
    for (const id of removed) delete retained[id];
    next = { ...next, proactive: { ...next.proactive, taskStates: retained } };
  }
  return next;
}

/** Preserve unrelated edits; a same-value explicit confirmation supplies a fresh next timestamp. */
function stampTaskActivity(previous, next, now = new Date()) {
  checkedNow(now);
  const timestamp = now.toISOString();
  const oldTasks = new Map((previous?.tasks || []).map(task => [task.id, task]));
  let changed = false;
  const tasks = next.tasks.map(task => {
    const old = oldTasks.get(task.id);
    let lastProgressAt;
    if (previous && (!old || old.progress !== task.progress)) lastProgressAt = timestamp;
    else if (isTimestamp(task.lastProgressAt)) lastProgressAt = task.lastProgressAt;
    else if (isTimestamp(old?.lastProgressAt)) lastProgressAt = old.lastProgressAt;
    else lastProgressAt = timestamp;
    if (task.lastProgressAt === lastProgressAt) return task;
    changed = true;
    return { ...task, lastProgressAt };
  });
  let stamped = changed ? { ...next, tasks } : next;
  for (const task of tasks) {
    const old = oldTasks.get(task.id);
    if (old && old.progress !== task.progress) stamped = resetTaskSnooze(stamped, task.id, task.lastProgressAt);
  }
  return reconcileTaskStates(stamped);
}

function withoutActive(state) {
  const { active, ...proactive } = state.proactive;
  return { ...state, proactive };
}

/** Reconciliation only withdraws a card; it never refunds quota or cooldown. */
function reconcileReminder(state, now = new Date()) {
  checkedNow(now);
  state = reconcileTaskStates(state);
  const proactive = state.proactive;
  const active = proactive?.active;
  if (!active) return state;
  const day = localDate(now, state.settings?.rolloverTime);
  const task = state.tasks.find(item => item.id === active.taskId);
  const age = now.getTime() - Date.parse(active.createdAt);
  const valid = validActive(active) && proactive.day === day && canRemind(state, now, day)
    && age >= 0 && age < REMINDER_TTL_MS && task && task.date === day && task.date === active.taskDate
    && task.name === active.taskName && task.progress < 100 && canRemindTask(state, task, now, day)
    && task.progress === active.progress && task.lastProgressAt === active.lastProgressAt
    && Date.parse(task.lastProgressAt) <= now.getTime();
  return valid ? state : withoutActive(state);
}

function planReminder(state, now = new Date()) {
  checkedNow(now);
  let next = reconcileReminder(state, now);
  const day = localDate(now, next.settings?.rolloverTime);
  let proactive = next.proactive;
  // Never reset the daily quota backwards, including after a clock correction.
  if (proactive?.day > day) return next;
  if (proactive && proactive.day < day) {
    proactive = { ...proactive, day, count: 0 };
    next = { ...next, proactive };
  }
  if (proactive?.active || !canRemind(next, now, day) || (proactive?.count || 0) >= DAILY_LIMIT) return next;
  const nowMs = now.getTime();
  const interval = intervalMs(next.settings || {});
  const previousReminder = isTimestamp(proactive?.lastRemindedAt) ? Date.parse(proactive.lastRemindedAt) : undefined;
  // Legacy global snoozes retain their one-time follow-up. New postponements
  // can bypass the interval only for the same task, never for an unrelated one.
  const legacyFollowUp = isTimestamp(proactive?.snoozedUntil) && Date.parse(proactive.snoozedUntil) <= nowMs;
  if (previousReminder !== undefined && previousReminder > nowMs) return next;
  const globalIntervalPassed = previousReminder === undefined || nowMs - previousReminder >= interval || legacyFollowUp;
  const priorities = { high: 2, medium: 1, low: 0 };
  const candidates = next.tasks.filter(task => task.date === day && Number.isFinite(task.progress)
    && task.progress >= 0 && task.progress < 100 && isTimestamp(task.lastProgressAt)
    && nowMs - Date.parse(task.lastProgressAt) >= interval && canRemindTask(next, task, now, day)
    && (globalIntervalPassed || (isTimestamp(taskState(next, task.id)?.snoozedUntil)
      && Date.parse(taskState(next, task.id).snoozedUntil) <= nowMs)));
  candidates.sort((a, b) => Date.parse(a.lastProgressAt) - Date.parse(b.lastProgressAt)
    || (priorities[b.priority] || 0) - (priorities[a.priority] || 0));
  const task = candidates[0];
  if (!task) return next;
  const createdAt = now.toISOString();
  const count = (proactive?.count || 0) + 1;
  const active = {
    id: `reminder:${createdAt}:${count}:${task.id}`,
    taskId: task.id, taskName: task.name, taskDate: task.date,
    progress: task.progress, lastProgressAt: task.lastProgressAt, createdAt,
    snoozeMinutes: SNOOZE_MINUTES[Math.min(taskState(next, task.id)?.snoozeCount || 0, 2)],
    message: `「${task.name}」的进度记录有一段时间没更新了，目前记为 ${task.progress}%。如果方便，可以更新一下；也可以稍后提醒。`,
  };
  const { snoozedUntil, ...retained } = proactive || {};
  next = { ...next, proactive: { ...retained, day, count, lastRemindedAt: createdAt, active } };
  const status = taskState(next, task.id);
  if (status?.snoozedUntil !== undefined) {
    const { snoozedUntil, ...taskStatus } = status;
    next = updateTaskState(next, task.id, taskStatus);
  }
  return next;
}

function applyReminderAction(state, id, action, progress, now = new Date()) {
  checkedNow(now);
  if (!['update', 'complete', 'advance', 'unchanged', 'snooze', 'dismiss-task', 'today', 'help'].includes(action)) throw new Error('不支持的提醒操作');
  if (action === 'update' ? !Number.isFinite(progress) || progress < 0 || progress > 100 : progress !== undefined) {
    throw new Error('进度必须是 0 到 100 的有效数字，且只用于更新进度');
  }
  const current = reconcileReminder(state, now);
  const active = current.proactive?.active;
  if (!isString(id) || !active || active.id !== id) throw new Error('这条提醒已过期或任务已变化，请在主面板查看最新任务');
  let next = withoutActive(current);
  if (['update', 'complete', 'advance', 'unchanged'].includes(action)) {
    const confirmed = action === 'complete' ? 100 : action === 'advance' ? Math.min(100, active.progress + 10)
      : action === 'unchanged' ? active.progress : progress;
    next = { ...next, tasks: next.tasks.map(task => task.id === active.taskId
      ? { ...task, progress: confirmed, lastProgressAt: now.toISOString() } : task) };
    return reconcileTaskStates(resetTaskSnooze(next, active.taskId, now.toISOString()));
  }
  if (action === 'today') {
    return { ...next, proactive: { ...next.proactive, dismissedDate: localDate(now, next.settings?.rolloverTime) } };
  }
  const status = taskState(next, active.taskId) || {};
  if (action === 'dismiss-task') {
    return updateTaskState(next, active.taskId, { ...status, dismissedDate: localDate(now, next.settings?.rolloverTime), lastProgressAt: active.lastProgressAt });
  }
  // For help, main captures the validated card and opens the AI composer itself.
  const minutes = action === 'snooze' ? SNOOZE_MINUTES[Math.min(status.snoozeCount || 0, 2)] : 30;
  return updateTaskState(next, active.taskId, { ...status,
    snoozeCount: action === 'snooze' ? Math.min(3, (status.snoozeCount || 0) + 1) : status.snoozeCount || 0,
    snoozedUntil: new Date(now.getTime() + minutes * 60000).toISOString(), lastProgressAt: active.lastProgressAt });
}

module.exports = {
  REMINDER_TTL_MS, SNOOZE_MS, DAILY_LIMIT,
  stampTaskActivity, reconcileReminder, planReminder, applyReminderAction,
  validProactive, validProactiveSettings,
};
