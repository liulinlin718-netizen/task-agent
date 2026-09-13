import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState } from '../src/state/appState';
import { assertBoundRequest, assertTaskWrite, parseTaskDateIntent } from '../src/services/TaskGuard';
import type { TaskContext } from '../src/Store';

const day = '2026-09-13';
const tomorrow = '2026-09-14';
function fixture() {
  const state = createDefaultState(new Date(2026, 8, 13, 12));
  state.tasks = [
    { id: 'fitness', name: '健身', date: day, progress: 20 },
    { id: 'interview-today', name: '面阶跃星辰', date: day, progress: 42 },
    { id: 'interview-future', name: '面试', date: tomorrow, progress: 0 },
    { id: 'draft', name: '论文初稿', date: day, progress: 10 },
    { id: 'polish', name: '论文润色', date: day, progress: 0 },
  ];
  return state;
}
const reference = (id = 'fitness'): TaskContext => {
  const task = fixture().tasks.find(task => task.id === id)!;
  return { taskId: task.id, taskName: task.name, taskDate: task.date };
};
const options = (requestText: string, taskContext?: TaskContext) => ({ activeDate: day, currentDate: day, requestText, taskContext });

test('calendar expressions distinguish source and destination across month/year boundaries', () => {
  assert.deepEqual(parseTaskDateIntent('把明天的任务改到今天', day), { sourceDate: tomorrow, destinationDate: day, ambiguous: false });
  assert.deepEqual(parseTaskDateIntent('将9/14面试移到9月16日', day), { sourceDate: tomorrow, destinationDate: '2026-09-16', ambiguous: false });
  assert.deepEqual(parseTaskDateIntent('把今天的论文改为明天', '2028-02-28'), { sourceDate: '2028-02-28', destinationDate: '2028-02-29', ambiguous: false });
  assert.equal(parseTaskDateIntent('后天那项', '2026-12-31').sourceDate, '2027-01-02');
  assert.equal(parseTaskDateIntent('2026年9月14号的面试', day).sourceDate, tomorrow);
});

test('conflicting, invalid and unsupported date expressions require clarification', () => {
  for (const text of ['今天或明天的任务', '2026-02-30那项', '下周五面试完成了']) {
    assert.equal(parseTaskDateIntent(text, day).ambiguous, true, text);
  }
  assert.deepEqual(parseTaskDateIntent('把健身备注改为明天再试', day), { sourceDate: undefined, destinationDate: undefined, ambiguous: false });
});

test('explicit today follows the real logical day even while viewing historical tasks', () => {
  const state = fixture(); state.activeDate = '2026-09-11';
  assert.doesNotThrow(() => assertTaskWrite(state, 'fitness', { progress: 100 }, { ...options('今天健身完成了'), activeDate: state.activeDate }));
  assert.throws(() => assertTaskWrite(state, 'interview-future', { progress: 100 }, { ...options('今天面试完成了'), activeDate: state.activeDate }), /2026-09-13.*2026-09-14/);
});

test('pinyin cannot redirect an explicit today completion to a future generic task', () => {
  const state = fixture();
  assert.throws(() => assertTaskWrite(state, 'interview-future', { progress: 100 }, options('今天jieyuexingchen面完了')), /原任务日期/);
  assert.throws(() => assertTaskWrite(state, 'interview-today', { progress: 100 }, options('今天jieyuexingchen面完了')), /完整名称|关联任务/);
  assert.doesNotThrow(() => assertTaskWrite(state, 'interview-today', { progress: 100 }, options('今天面阶跃星辰完成了')));
});

test('partial ambiguous names ask while unique implicit completion is allowed', () => {
  const state = fixture();
  assert.throws(() => assertTaskWrite(state, 'draft', undefined, options('删除今天那个论文任务')), /多项任务/);
  assert.doesNotThrow(() => assertTaskWrite(state, 'draft', undefined, options('删除今天论文初稿')));
  assert.doesNotThrow(() => assertTaskWrite(state, 'fitness', { progress: 100 }, options('健完身了')));
  assert.throws(() => assertTaskWrite(state, 'fitness', { progress: 100 }, options('那项做完了')), /多项任务/);
});

test('an explicit source/destination reschedule is allowed without treating destination today as the source', () => {
  const state = fixture();
  assert.doesNotThrow(() => assertTaskWrite(state, 'interview-future', { date: day }, options('把明天的任务改到今天')));
  assert.doesNotThrow(() => assertTaskWrite(state, 'interview-future', { date: day }, options('把面试改到今天')));
  assert.doesNotThrow(() => assertTaskWrite(state, 'interview-future', { date: day }, options('把明天的任务改到今天', reference('interview-future'))));
  assert.throws(() => assertTaskWrite(state, 'interview-future', { date: '2026-09-15' }, options('把明天的任务改到今天')), /目标日期/);
  assert.throws(() => assertTaskWrite(state, 'fitness', { date: tomorrow }, options('健身完成了')), /目标日期/);
});

test('bound progress phrases work for a historical task without borrowing the selected date', () => {
  const state = fixture(); const context = reference();
  state.tasks[0] = { ...state.tasks[0], date: '2026-09-11' }; context.taskDate = '2026-09-11';
  for (const text of ['完成了', '这项完成了', '推进了一点', '还没变化', '把它拆成3步']) {
    assert.doesNotThrow(() => assertBoundRequest(state, options(text, context)), text);
  }
  assert.doesNotThrow(() => assertTaskWrite(state, 'fitness', { progress: 100 }, options('这项完成了', context)));
});

test('bound references reject other IDs, explicit other names and conflicting source dates', () => {
  const state = fixture(); const context = reference();
  assert.throws(() => assertTaskWrite(state, 'draft', { progress: 100 }, options('完成了', context)), /关联之外/);
  assert.throws(() => assertTaskWrite(state, 'fitness', { progress: 100 }, options('把论文初稿完成', context)), /其他任务/);
  assert.throws(() => assertTaskWrite(state, 'fitness', { progress: 100 }, options('明天健身完成了', context)), /日期不一致/);
});

test('deleted, renamed or rescheduled bindings are stale but ordinary progress changes are not', () => {
  const context = reference();
  for (const mutate of [
    (state: ReturnType<typeof fixture>) => { state.tasks = state.tasks.filter(task => task.id !== 'fitness'); },
    (state: ReturnType<typeof fixture>) => { state.tasks[0].name = '新的健身安排'; },
    (state: ReturnType<typeof fixture>) => { state.tasks[0].date = tomorrow; },
  ]) {
    const state = fixture(); mutate(state);
    assert.throws(() => assertBoundRequest(state, options('完成了', context)), /重新选择/);
  }
  const state = fixture(); state.tasks[0].progress = 70;
  assert.doesNotThrow(() => assertTaskWrite(state, 'fitness', { progress: 100 }, options('完成了', context)));
});

test('a short date selection can resolve a prior clarification without carrying old ambiguous dates', () => {
  const state = fixture();
  assert.doesNotThrow(() => assertTaskWrite(state, 'interview-future', { progress: 100 }, options('9/14那项')));
  state.tasks.push({ id: 'future-reading', name: '读文献', date: tomorrow, progress: 0 });
  assert.throws(() => assertTaskWrite(state, 'interview-future', { progress: 100 }, options('9/14那项')), /多项任务/);
  assert.doesNotThrow(() => assertTaskWrite(state, 'interview-future', { progress: 100 }, { ...options('9/14那项'), previousRequestText: '把面试标为完成' }));
  assert.doesNotThrow(() => assertTaskWrite(state, 'interview-future', { progress: 100 }, options('9/14的面试')));
});
