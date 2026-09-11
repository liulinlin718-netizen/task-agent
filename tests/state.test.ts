import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptSuggestions, createDefaultState, logicalDate, normalizeState, rolloverState, updateMessage } from '../src/state/appState';
import { trackTaskActivity } from '../src/state/taskActivity';

test('logical day respects the configured boundary, including a fresh install', () => {
  const now = new Date(2026, 8, 11, 1, 59);
  assert.equal(logicalDate(now, '02:00'), '2026-09-10');
  assert.equal(createDefaultState(now).activeDate, '2026-09-10');
  assert.equal(logicalDate(new Date(2026, 8, 11, 2, 0), '02:00'), '2026-09-11');
});

test('rollover preserves partial progress and history, and is idempotent while AI is pending', () => {
  const state = createDefaultState(new Date(2026, 8, 10, 12));
  state.tasks = [
    { id: 'partial', name: '论文', date: '2026-09-10', progress: 45, notes: '第三章', priority: 'high' },
    { id: 'done', name: '读书', date: '2026-09-10', progress: 100 },
  ];
  const next = rolloverState(state, '2026-09-13');
  assert.equal(next.tasks.length, 3);
  assert.equal(next.tasks[2].progress, 45);
  assert.equal(next.tasks[2].notes, '第三章');
  assert.equal(next.tasks[2].date, '2026-09-13');
  assert.equal(next.historySummaries.length, 1);
  assert.equal(rolloverState(next, '2026-09-13'), next);
  assert.equal(state.tasks.length, 2);
});

test('suggestions use their own dates and cannot be accepted twice', () => {
  const state = createDefaultState();
  state.chatSessions[0].messages.push({ id: 'suggest', role: 'model', text: '建议', proposedTasks: [
    { name: '写报告', date: '2026-09-12', added: false },
    { name: '写报告', date: '2026-09-12', added: false },
  ] });
  const first = acceptSuggestions(state, 'suggest', '2026-09-11', 0);
  const second = acceptSuggestions(first, 'suggest', '2026-09-11', 0);
  const all = acceptSuggestions(second, 'suggest', '2026-09-11');
  assert.equal(all.tasks.length, 1);
  assert.equal(all.tasks[0].date, '2026-09-12');
  assert.ok(all.chatSessions[0].messages.at(-1)?.proposedTasks?.every(p => p.added));
  assert.equal(state.chatSessions[0].messages.at(-1)?.proposedTasks?.[0].added, false);
});

test('message updates remain with their original session after switching active session', () => {
  const state = createDefaultState();
  const original = state.activeChatSessionId;
  state.chatSessions[0].messages.push({ id: 'pending', role: 'model', text: '' });
  state.chatSessions.push({ id: 'other', title: '另一个', messages: [], updatedAt: '' });
  state.activeChatSessionId = 'other';
  const next = updateMessage(state, 'pending', m => ({ ...m, text: '完成' }), original);
  assert.equal(next.chatSessions[0].messages.at(-1)?.text, '完成');
  assert.equal(next.chatSessions[1].messages.length, 0);
});

test('legacy settings/history migrate without losing tasks or messages', () => {
  const state = createDefaultState();
  const migrated = normalizeState({ ...state, chatSessions: undefined, chatHistory: [{ id: 'old', role: 'user', text: '旧记录' }],
    settings: { ...state.settings, apiBaseUrl: undefined, apiFormat: 'openai', apiUrl: '' } });
  assert.equal(migrated.settings.apiBaseUrl, 'https://api.openai.com/v1');
  assert.equal(migrated.chatSessions[0].messages[0].id, 'old');
  assert.equal(migrated.activeChatSessionId, migrated.chatSessions[0].id);
  assert.throws(() => normalizeState({ tasks: null }));
});

test('browser task activity records progress changes but ignores chat and metadata edits', () => {
  const original = createDefaultState();
  const earlier = new Date('2026-09-11T00:00:00.000Z');
  const now = new Date('2026-09-11T03:00:00.000Z');
  const added = trackTaskActivity(original, { ...original, tasks: [{ id: 'a', name: '论文', date: original.activeDate, progress: 0 }] }, earlier);
  assert.equal(added.tasks[0].lastProgressAt, earlier.toISOString());
  const renamed = trackTaskActivity(added, { ...added, tasks: [{ ...added.tasks[0], name: '论文初稿', notes: '准备资料' }] }, now);
  assert.equal(renamed.tasks[0].lastProgressAt, earlier.toISOString());
  const progressed = trackTaskActivity(renamed, { ...renamed, tasks: [{ ...renamed.tasks[0], progress: 30 }] }, now);
  assert.equal(progressed.tasks[0].lastProgressAt, now.toISOString());
  const chatted = trackTaskActivity(progressed, updateMessage(progressed, progressed.chatSessions[0].messages[0].id, m => ({ ...m, text: '聊天不会推迟进度提醒' })), new Date(now.getTime() + 60_000));
  assert.equal(chatted.tasks[0].lastProgressAt, now.toISOString());
  const migrated = trackTaskActivity({ ...original, tasks: [{ id: 'old', name: '旧任务', date: original.activeDate, progress: 20 }] }, { ...original, tasks: [{ id: 'old', name: '旧任务', date: original.activeDate, progress: 20 }] }, now);
  assert.equal(migrated.tasks[0].lastProgressAt, now.toISOString());
});
