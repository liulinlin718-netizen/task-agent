import test from 'node:test';
import assert from 'node:assert/strict';
import { readBrowserState, writeBrowserState } from '../src/state/browserStorage';
import { createDefaultState } from '../src/state/appState';
import { emptyMemory, getMemory, normalizeMemory, reviseMemory } from '../src/state/memory';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}

test('browser persistence stores profile and long-term memory separately and migrates old data', () => {
  const saved = storage();
  const state = createDefaultState();
  state.profile.major = '计算机';
  saved.setItem('taskagent-state', JSON.stringify(state));
  assert.deepEqual(JSON.parse(readBrowserState(saved)!), state);
  writeBrowserState(saved, JSON.stringify(state));
  const data = JSON.parse(saved.getItem('taskagent-state')!);
  const memory = JSON.parse(saved.getItem('taskagent-memory')!);
  assert.equal(data.profile, undefined);
  assert.equal(data.memory, undefined);
  assert.deepEqual(memory.profile, state.profile);
  assert.deepEqual(memory.memory, state.memory);
  assert.deepEqual(JSON.parse(readBrowserState(saved)!), state);
});

test('browser write failure restores both stores and preserves the original error', () => {
  const saved = storage();
  const state = createDefaultState();
  writeBrowserState(saved, JSON.stringify(state));
  const original = saved.setItem;
  let failed = false;
  saved.setItem = (key, value) => {
    if (key === 'taskagent-state' && !failed) { failed = true; throw new Error('quota'); }
    original(key, value);
  };
  const next = { ...state, profile: { ...state.profile, major: '新专业' }, tasks: [{ id: 'a', name: '任务', progress: 0, date: state.activeDate }] };
  assert.throws(() => writeBrowserState(saved, JSON.stringify(next)), /quota/);
  assert.deepEqual(JSON.parse(readBrowserState(saved)!), state);
  assert.equal(saved.getItem('taskagent-storage-transaction'), null);
});

test('browser interrupted transaction recovers a consistent prior snapshot', () => {
  const saved = storage();
  const state = createDefaultState();
  writeBrowserState(saved, JSON.stringify(state));
  saved.setItem('taskagent-storage-transaction', JSON.stringify({ data: saved.getItem('taskagent-state'), memory: saved.getItem('taskagent-memory') }));
  saved.setItem('taskagent-memory', JSON.stringify({ version: 1, profile: { ...state.profile, major: '未提交' }, memory: state.memory }));
  assert.deepEqual(JSON.parse(readBrowserState(saved)!), state);
  saved.removeItem('taskagent-memory');
  assert.throws(() => readBrowserState(saved), /长期记忆缺失/);
});

test('manual memory changes invalidate pending learning and keep profile intact', () => {
  const state = createDefaultState();
  const next = reviseMemory(state, memory => ({ ...memory, enabled: false }));
  assert.notEqual(getMemory(next).epoch, getMemory(state).epoch);
  assert.equal(getMemory(next).enabled, false);
  assert.deepEqual(next.profile, state.profile);
  assert.equal(emptyMemory().epoch, emptyMemory().epoch);
  assert.throws(() => normalizeMemory({ ...emptyMemory(), facts: [{}] }), /格式无效/);
});
