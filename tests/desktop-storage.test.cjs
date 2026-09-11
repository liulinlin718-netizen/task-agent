const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseState, readState, writeState, commitState, encryptData, decryptData } = require('../electron/storage.cjs');
const { planReminder, applyReminderAction } = require('../electron/proactive.cjs');

function state() {
  return {
    profile: { major: '', goal: '', skills: '' },
    tasks: [{ id: 't1', name: '阅读文献', progress: 0, date: '2026-09-11', lastProgressAt: '2026-09-11T00:00:00.000Z' }],
    settings: { rolloverTime: '02:00', agentStyle: 'academic', sidebarEnabled: true, floatingBallEnabled: false },
    chatSessions: [{ id: 's1', title: '新对话', messages: [], updatedAt: '2026-09-11T00:00:00Z' }],
    activeChatSessionId: 's1', activeDate: '2026-09-11', lastRolloverDate: '2026-09-11', historySummaries: [], reports: [],
  };
}

function memoryState() {
  const value = state();
  value.profile = { major: '计算机科学', goal: '完成论文', skills: 'Python', bio: '博士研究生' };
  value.chatSessions[0].messages.push({ id: 'm1', role: 'user', text: '请简短回答' });
  value.memory = { version: 1, epoch: 'epoch-1', enabled: true, facts: [fact('f1')] };
  return value;
}

function fact(id) {
  return { id, key: `preference-${id}`, category: 'preference', content: `偏好简洁回答${id}`, evidence: '请简短回答',
    sourceSessionId: 's1', sourceMessageId: 'm1', createdAt: '2026-09-11T01:00:00Z', updatedAt: '2026-09-11T01:00:00Z' };
}

function memoryPath(file) { return path.join(path.dirname(file), 'taskagent-memory.json'); }

function splitSnapshot(value) {
  const { profile, memory, ...data } = value;
  return { data, memory: { version: 1, profile, ...(memory === undefined ? {} : { memory }) } };
}

function readAfterRestart(file) {
  const script = 'const value = require(process.argv[1]).readState(process.argv[2]); process.stdout.write(JSON.stringify(value === null ? null : JSON.parse(value)));';
  const result = spawnSync(process.execPath, ['-e', script, require.resolve('../electron/storage.cjs'), file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function storeFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taskagent-storage-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'nested', 'taskagent-data.json');
}

function legacyEncrypt(text, password) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
}

test('atomic store writes survive restart and retain the last valid snapshot', t => {
  const file = storeFile(t), first = JSON.stringify(state());
  assert.equal(readState(file), null);
  writeState(file, first);
  assert.deepEqual(JSON.parse(readState(file)), JSON.parse(first));
  const changed = state(); changed.tasks[0].progress = 30;
  const second = JSON.stringify(changed);
  const savedSecond = writeState(file, second);
  assert.deepEqual(JSON.parse(readState(file)), JSON.parse(savedSecond));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), JSON.parse(first));
  assert.equal(fs.readdirSync(path.dirname(file)).some(name => name.endsWith('.tmp')), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.writeFileSync(file, '{truncated');
  assert.deepEqual(JSON.parse(readState(file)), JSON.parse(first));
  const restoredSecond = writeState(file, second);
  assert.deepEqual(JSON.parse(readState(file)), JSON.parse(restoredSecond));
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), JSON.parse(first));
});

test('invalid state is rejected before touching the current file or recovery snapshot', t => {
  const file = storeFile(t), saved = JSON.stringify(state());
  writeState(file, saved);
  const savedDataFile = fs.readFileSync(file, 'utf8');
  for (const mutate of [
    value => { value.tasks[0].progress = 101; },
    value => { value.tasks[0].date = '2026-02-30'; },
    value => { value.tasks.push(value.tasks[0]); },
    value => { value.settings.rolloverTime = '29:99'; },
    value => { value.chatSessions[0].messages.push({ id: 'm1', role: 'tool', text: 'invalid display message' }); },
    value => { value.activeChatSessionId = 'missing'; },
    value => { value.reports = [{ id: 'r1', dates: 'invalid' }]; },
    value => { value.tasks[0].lastProgressAt = 'invalid'; },
    value => { value.settings.proactiveIntervalMinutes = 15; },
    value => { value.settings.proactiveQuietStart = '25:00'; },
    value => { value.proactive = { day: '2026-09-11', count: 4 }; },
  ]) {
    const invalid = state(); mutate(invalid);
    assert.throws(() => writeState(file, JSON.stringify(invalid)));
    assert.equal(fs.readFileSync(file, 'utf8'), savedDataFile);
  }
  assert.throws(() => writeState(file, '{}'));
  assert.equal(fs.existsSync(`${file}.bak`), false);
});

test('encrypted backups authenticate their content and remain compatible with existing backups', () => {
  const plain = JSON.stringify(state()), password = '隔离测试口令';
  const backup = encryptData(plain, password);
  assert.equal(backup.format, 'taskagent-backup');
  assert.equal(decryptData(backup, password), plain);
  assert.notDeepEqual(encryptData(plain, password), backup, 'fresh backups use fresh salt and IV');
  assert.throws(() => decryptData(backup, 'wrong password'));
  assert.throws(() => decryptData({ ...backup, data: `AAAA${backup.data.slice(4)}` }, password));
  assert.throws(() => decryptData({ ...backup, iv: 'invalid!' }, password));
  assert.throws(() => decryptData({ ...backup, iterations: 999999999 }, password));
  assert.throws(() => encryptData(plain, ''));
  assert.equal(decryptData(legacyEncrypt(plain, password), password), plain);
  assert.throws(() => decryptData(legacyEncrypt('{"unrelated":"valid JSON"}', password), password));
});

test('legacy v1 state remains available for renderer migration', () => {
  const legacy = state();
  legacy.chatHistory = [{ id: 'm1', role: 'model', text: '旧对话' }];
  legacy.settings.apiFormat = 'gemini';
  legacy.settings.apiUrl = 'https://example.test/v1beta';
  delete legacy.chatSessions; delete legacy.activeChatSessionId; delete legacy.reports;
  delete legacy.historySummaries; delete legacy.lastRolloverDate;
  assert.deepEqual(parseState(JSON.stringify(legacy)), legacy);
});

test('stale windows preserve concurrent task additions and independent fields', t => {
  const file = storeFile(t), original = state(), base = JSON.stringify(original);
  writeState(file, base);
  const first = structuredClone(original);
  first.tasks[0].progress = 40;
  first.tasks.push({ id: 't2', name: '第一窗口新增', progress: 0, date: '2026-09-11' });
  commitState(file, JSON.stringify(first), base);
  const second = structuredClone(original);
  second.tasks[0].name = '第二窗口重命名';
  second.tasks.push({ id: 't3', name: '第二窗口新增', progress: 0, date: '2026-09-11' });
  const merged = JSON.parse(commitState(file, JSON.stringify(second), base));
  assert.deepEqual(merged.tasks.map(task => task.id), ['t1', 't2', 't3']);
  assert.equal(merged.tasks[0].progress, 40);
  assert.equal(merged.tasks[0].name, '第二窗口重命名');
});

test('deletions affect only known entities and unchanged stale entities do not resurrect', t => {
  const file = storeFile(t), original = state(), base = JSON.stringify(original);
  writeState(file, base);
  const first = structuredClone(original);
  first.tasks = [{ id: 't2', name: '新任务', progress: 0, date: '2026-09-11' }];
  const firstCommitted = JSON.parse(commitState(file, JSON.stringify(first), base));
  const second = structuredClone(original);
  second.profile.goal = '新目标';
  const merged = JSON.parse(commitState(file, JSON.stringify(second), base));
  assert.deepEqual(merged.tasks, firstCommitted.tasks);
  assert.equal(merged.profile.goal, '新目标');
  const third = structuredClone(original); third.tasks = [];
  assert.deepEqual(JSON.parse(commitState(file, JSON.stringify(third), base)).tasks, firstCommitted.tasks);
});

test('concurrent chat appends, report saves and summaries keep both windows changes', t => {
  const file = storeFile(t), original = state(), base = JSON.stringify(original);
  writeState(file, base);
  for (const id of ['1', '2']) {
    const next = structuredClone(original);
    next.chatSessions[0].messages.push({ id: `m${id}`, role: 'user', text: `消息${id}` });
    next.reports.push({ id: `r${id}`, title: `报告${id}`, dates: ['2026-09-11'], content: id, createdAt: '2026-09-11T00:00:00Z' });
    next.historySummaries.push({ date: `2026-09-0${id}`, summary: id });
    commitState(file, JSON.stringify(next), base);
  }
  const merged = JSON.parse(readState(file));
  assert.deepEqual(merged.chatSessions[0].messages.map(message => message.id), ['m1', 'm2']);
  assert.deepEqual(merged.reports.map(report => report.id).sort(), ['r1', 'r2']);
  assert.deepEqual(merged.historySummaries.map(summary => summary.date).sort(), ['2026-09-01', '2026-09-02']);
});

test('new sessions and reports preserve the requested prepend order', t => {
  const file = storeFile(t), original = state(), base = JSON.stringify(original);
  writeState(file, base);
  const next = structuredClone(original);
  next.chatSessions.unshift({ id: 's2', title: '新对话2', messages: [], updatedAt: '2026-09-11T01:00:00Z' });
  next.activeChatSessionId = 's2';
  const merged = JSON.parse(commitState(file, JSON.stringify(next), base));
  assert.deepEqual(merged.chatSessions.map(session => session.id), ['s2', 's1']);
});

test('same scalar conflict takes the later submitted edit and no-op commits preserve current data', t => {
  const file = storeFile(t), base = JSON.stringify(state());
  writeState(file, base);
  const first = state(); first.tasks[0].progress = 10;
  commitState(file, JSON.stringify(first), base);
  const second = state(); second.tasks[0].progress = 90;
  const final = commitState(file, JSON.stringify(second), base);
  assert.equal(JSON.parse(final).tasks[0].progress, 90);
  assert.equal(commitState(file, base, base), final);
});

test('a late stream or progress update cannot resurrect a deleted session or task', t => {
  const file = storeFile(t), original = state();
  original.chatSessions.push({ id: 's2', title: '保留对话', messages: [], updatedAt: '2026-09-11T01:00:00Z' });
  const base = JSON.stringify(original);
  writeState(file, base);
  const deleted = structuredClone(original);
  deleted.tasks = [];
  deleted.chatSessions = [deleted.chatSessions[1]];
  deleted.activeChatSessionId = 's2';
  commitState(file, JSON.stringify(deleted), base);
  const stale = structuredClone(original);
  stale.tasks[0].progress = 90;
  stale.chatSessions[0].messages.push({ id: 'm1', role: 'model', text: '稍后返回的回答' });
  const merged = JSON.parse(commitState(file, JSON.stringify(stale), base));
  assert.deepEqual(merged.tasks, []);
  assert.deepEqual(merged.chatSessions.map(session => session.id), ['s2']);
  assert.equal(merged.activeChatSessionId, 's2');
});

test('repeated deterministic rollover insertion preserves an already updated task', t => {
  const file = storeFile(t), original = state(), base = JSON.stringify(original);
  writeState(file, base);
  const rollover = structuredClone(original);
  rollover.tasks.push({ id: 'rollover:2026-09-12:t1', name: '阅读文献', progress: 0, date: '2026-09-12' });
  const rolled = commitState(file, JSON.stringify(rollover), base);
  const edited = JSON.parse(rolled); edited.tasks[1].progress = 50;
  commitState(file, JSON.stringify(edited), rolled);
  const merged = JSON.parse(commitState(file, JSON.stringify(rollover), base));
  assert.equal(merged.tasks.length, 2);
  assert.equal(merged.tasks[1].progress, 50);
});

test('concurrent deletion of all known sessions creates a valid fresh session', t => {
  const file = storeFile(t), original = state();
  original.chatSessions.push({ id: 's2', title: '第二对话', messages: [], updatedAt: '2026-09-11T01:00:00Z' });
  const base = JSON.stringify(original);
  writeState(file, base);
  const first = structuredClone(original); first.chatSessions = [first.chatSessions[0]];
  commitState(file, JSON.stringify(first), base);
  const second = structuredClone(original); second.chatSessions = [second.chatSessions[1]]; second.activeChatSessionId = 's2';
  const merged = JSON.parse(commitState(file, JSON.stringify(second), base));
  assert.equal(merged.chatSessions.length, 1);
  assert.equal(['s1', 's2'].includes(merged.chatSessions[0].id), false);
  assert.equal(merged.activeChatSessionId, merged.chatSessions[0].id);
});

for (const deletedTarget of ['session', 'message']) {
  test(`guarded task/report transaction has no side effects after its ${deletedTarget} was deleted`, t => {
    const file = storeFile(t), original = state();
    original.chatSessions[0].messages.push({ id: 'response', role: 'model', text: '' });
    original.chatSessions.push({ id: 's2', title: '另一对话', messages: [], updatedAt: '2026-09-11T01:00:00Z' });
    const base = JSON.stringify(original);
    writeState(file, base);
    const deletion = structuredClone(original);
    if (deletedTarget === 'session') {
      deletion.chatSessions = [deletion.chatSessions[1]];
      deletion.activeChatSessionId = 's2';
    } else deletion.chatSessions[0].messages = [];
    commitState(file, JSON.stringify(deletion), base);
    const before = fs.readFileSync(file, 'utf8');
    const backupBefore = fs.readFileSync(`${file}.bak`, 'utf8');
    const fileNamesBefore = fs.readdirSync(path.dirname(file));
    const stale = structuredClone(original);
    stale.tasks.push({ id: 'late-task', name: '延迟新增任务', date: '2026-09-11', progress: 0 });
    stale.reports.push({ id: 'late-report', title: '延迟报告', dates: ['2026-09-11'], content: '报告内容', createdAt: '2026-09-11T01:00:00Z' });
    stale.chatSessions[0].messages[0].toolEvents = [{ id: 'call-1', name: 'create_tasks', status: 'success', message: '已添加' }];
    assert.equal(commitState(file, JSON.stringify(stale), base, { sessionId: 's1', messageId: 'response' }), null);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), backupBefore);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), fileNamesBefore);
  });
}

test('guarded transaction commits entities and tool event together while retaining independent edits', t => {
  const file = storeFile(t), original = state();
  original.chatSessions[0].messages.push({ id: 'response', role: 'model', text: '' });
  const base = JSON.stringify(original);
  writeState(file, base);
  const current = structuredClone(original); current.tasks[0].progress = 50;
  commitState(file, JSON.stringify(current), base);
  const next = structuredClone(original);
  next.tasks.push({ id: 'new-task', name: '有效任务', date: '2026-09-11', progress: 0 });
  next.reports.push({ id: 'new-report', title: '有效报告', dates: ['2026-09-11'], content: '报告内容', createdAt: '2026-09-11T01:00:00Z' });
  next.chatSessions[0].messages[0].toolEvents = [{ id: 'call-1', name: 'create_tasks', status: 'success', message: '已添加' }];
  const result = commitState(file, JSON.stringify(next), base, { sessionId: 's1', messageId: 'response' });
  assert.notEqual(result, null);
  const merged = JSON.parse(result);
  assert.equal(merged.tasks[0].progress, 50);
  assert.equal(merged.tasks[1].id, 'new-task');
  assert.equal(merged.reports[0].id, 'new-report');
  assert.equal(merged.chatSessions[0].messages[0].toolEvents[0].id, 'call-1');
});

test('guarded transaction rejects missing stores and invalid guards before creating files', t => {
  const file = storeFile(t), data = JSON.stringify(state());
  assert.equal(commitState(file, data, data, { sessionId: 's1', messageId: 'missing' }), null);
  assert.equal(commitState(file, data, data, null), null);
  assert.equal(fs.existsSync(file), false);
});

test('profile and long-term memory live in a separate physical file and survive restart', t => {
  const file = storeFile(t), original = memoryState();
  writeState(file, JSON.stringify(original));
  const savedData = JSON.parse(fs.readFileSync(file, 'utf8'));
  const savedMemory = JSON.parse(fs.readFileSync(memoryPath(file), 'utf8'));
  assert.equal(Object.hasOwn(savedData, 'profile'), false);
  assert.equal(Object.hasOwn(savedData, 'memory'), false);
  assert.deepEqual(savedMemory, { version: 1, profile: original.profile, memory: original.memory });
  assert.equal(Object.hasOwn(savedMemory, 'tasks'), false);
  assert.equal(Object.hasOwn(savedMemory, 'chatSessions'), false);
  assert.deepEqual(readAfterRestart(file), original);
  assert.equal(fs.existsSync(`${file}.journal`), false);
});

test('the existing single-file store migrates automatically without losing profile or memory', t => {
  const file = storeFile(t), original = memoryState();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(original));
  assert.deepEqual(JSON.parse(readState(file)), original);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')), 'profile'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(memoryPath(file), 'utf8')).memory, original.memory);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), original);
  assert.deepEqual(readAfterRestart(file), original);
});

test('legacy stores without learned memory migrate their profile and remain compatible', t => {
  const file = storeFile(t), original = state();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(original));
  assert.deepEqual(JSON.parse(readState(file)), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(memoryPath(file), 'utf8')).profile, original.profile);
  assert.deepEqual(readAfterRestart(file), original);
});

test('missing or corrupt memory without a valid backup cannot be replaced by an empty profile', t => {
  for (const missing of [false, true]) {
    const file = storeFile(t), original = memoryState();
    writeState(file, JSON.stringify(original));
    if (missing) fs.unlinkSync(memoryPath(file));
    else fs.writeFileSync(memoryPath(file), '{damaged memory');
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => readState(file), /长期记忆/);
    assert.throws(() => writeState(file, JSON.stringify(state())), /长期记忆/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    if (!missing) assert.equal(fs.readFileSync(memoryPath(file), 'utf8'), '{damaged memory');
    else assert.equal(fs.existsSync(memoryPath(file)), false);
  }
});

test('a broken memory file recovers a complete prior snapshot instead of mixing generations', t => {
  const file = storeFile(t), original = memoryState();
  writeState(file, JSON.stringify(original));
  const next = structuredClone(original);
  next.memory.facts.push(fact('f2')); next.tasks[0].progress = 80;
  writeState(file, JSON.stringify(next));
  fs.writeFileSync(memoryPath(file), '{}');
  assert.deepEqual(JSON.parse(readState(file)), original);
  assert.deepEqual(readAfterRestart(file), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), original);
});

test('encrypted backup exports and explicit restore contain both task data and separate memory', t => {
  const source = storeFile(t), original = memoryState();
  writeState(source, JSON.stringify(original));
  const backup = encryptData(readState(source), 'test password');
  const imported = decryptData(backup, 'test password');
  assert.deepEqual(JSON.parse(imported), original);
  const target = storeFile(t);
  writeState(target, JSON.stringify(state()));
  fs.writeFileSync(memoryPath(target), 'invalid memory');
  writeState(target, imported, { restore: true });
  assert.deepEqual(readAfterRestart(target), original);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(target, 'utf8')), 'memory'), false);
});

for (const phase of ['prepared', 'committed']) {
  test(`restart recovers both files consistently from a ${phase} transaction`, t => {
    const file = storeFile(t), previous = memoryState(), next = structuredClone(previous);
    writeState(file, JSON.stringify(previous));
    next.memory.facts.push(fact('f2')); next.profile.goal = '修改后的目标'; next.tasks[0].progress = 90;
    fs.writeFileSync(`${file}.journal`, JSON.stringify({ version: 1, phase, previous, next }));
    // Simulate interruption after the memory file was replaced but data still contains the prior version.
    fs.writeFileSync(memoryPath(file), JSON.stringify(splitSnapshot(next).memory));
    const expected = phase === 'prepared' ? previous : next;
    assert.deepEqual(readAfterRestart(file), expected);
    assert.equal(fs.existsSync(`${file}.journal`), false);
    assert.deepEqual(JSON.parse(readState(file)), expected);
  });
}

test('an interrupted first write rolls back to an empty store', t => {
  const file = storeFile(t), next = memoryState();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.journal`, JSON.stringify({ version: 1, phase: 'prepared', previous: null, next }));
  fs.writeFileSync(memoryPath(file), JSON.stringify(splitSnapshot(next).memory));
  assert.equal(readAfterRestart(file), null);
  assert.equal(fs.existsSync(memoryPath(file)), false);
  assert.equal(fs.existsSync(`${file}.journal`), false);
});

test('failure replacing the second file rejects the commit and rolls both files back', t => {
  const file = storeFile(t), previous = memoryState(), next = structuredClone(previous);
  writeState(file, JSON.stringify(previous));
  next.memory.facts.push(fact('f2')); next.tasks[0].progress = 90;
  const rename = fs.renameSync;
  let fail = true;
  fs.renameSync = (source, target) => {
    if (target === file && fail) { fail = false; throw new Error('simulated data file failure'); }
    return rename(source, target);
  };
  try { assert.throws(() => writeState(file, JSON.stringify(next)), /simulated data file failure/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(JSON.parse(readState(file)), previous);
  assert.deepEqual(readAfterRestart(file), previous);
});

test('unrecoverable journal blocks normal access but a validated explicit backup can repair it', t => {
  const file = storeFile(t), original = memoryState();
  writeState(file, JSON.stringify(original));
  fs.writeFileSync(`${file}.journal`, '{broken journal');
  assert.throws(() => readState(file), /journal/);
  assert.throws(() => writeState(file, JSON.stringify(state())), /journal/);
  writeState(file, JSON.stringify(original), { restore: true });
  assert.deepEqual(readAfterRestart(file), original);
});

test('invalid learned-memory fields are rejected before changing either physical file', t => {
  const file = storeFile(t), original = memoryState();
  writeState(file, JSON.stringify(original));
  const dataBefore = fs.readFileSync(file, 'utf8'), memoryBefore = fs.readFileSync(memoryPath(file), 'utf8');
  for (const mutate of [
    value => { value.memory.version = 2; }, value => { value.memory.epoch = ''; },
    value => { value.memory.enabled = 'true'; }, value => { value.memory.facts[0].category = 'unknown'; },
    value => { value.memory.facts[0].key = 'k'.repeat(101); }, value => { value.memory.facts[0].content = 'c'.repeat(501); },
    value => { value.memory.facts[0].evidence = 'e'.repeat(501); }, value => { value.memory.facts[0].sourceMessageId = 1; },
    value => { value.memory.facts.push(value.memory.facts[0]); },
    value => { value.memory.facts.push({ ...value.memory.facts[0], id: 'different-id-same-key' }); },
    value => { value.memory.facts[0].evidence = ''; }, value => { value.memory.facts[0].sourceSessionId = ''; },
    value => { value.memory.facts = Array.from({ length: 101 }, (_, index) => fact(`f${index}`)); },
    value => { value.chatSessions[0].messages = [{ id: 'm', role: 'model', text: '', memoryStatus: {} }]; },
  ]) {
    const invalid = structuredClone(original); mutate(invalid);
    assert.throws(() => writeState(file, JSON.stringify(invalid)));
    assert.equal(fs.readFileSync(file, 'utf8'), dataBefore);
    assert.equal(fs.readFileSync(memoryPath(file), 'utf8'), memoryBefore);
  }
});

test('concurrent learned facts merge by ID while unrelated task edits survive', t => {
  const file = storeFile(t), original = memoryState(), base = JSON.stringify(original);
  writeState(file, base);
  const first = structuredClone(original); first.memory.facts.push(fact('f2')); first.tasks[0].progress = 70;
  commitState(file, JSON.stringify(first), base);
  const second = structuredClone(original); second.memory.facts.push(fact('f3'));
  const merged = JSON.parse(commitState(file, JSON.stringify(second), base));
  assert.deepEqual(merged.memory.facts.map(item => item.id).sort(), ['f1', 'f2', 'f3']);
  assert.equal(merged.tasks[0].progress, 70);
});

test('late learning from an old epoch cannot resurrect facts after clear or disable', t => {
  for (const enabled of [false, true]) {
    const file = storeFile(t), original = memoryState(), base = JSON.stringify(original);
    writeState(file, base);
    const cleared = structuredClone(original);
    cleared.memory = { ...cleared.memory, epoch: 'manual-clear', enabled, facts: [] };
    commitState(file, JSON.stringify(cleared), base);
    const stale = structuredClone(original);
    stale.memory.facts.push(fact('late-fact')); stale.tasks[0].progress = 35;
    const merged = JSON.parse(commitState(file, JSON.stringify(stale), base));
    assert.deepEqual(merged.memory, cleared.memory);
    assert.equal(merged.tasks[0].progress, 35);
    assert.deepEqual(readAfterRestart(file).memory, cleared.memory);
  }
});

test('an explicit epoch-changing clear also removes facts learned since the UI snapshot', t => {
  const file = storeFile(t), original = memoryState(), base = JSON.stringify(original);
  writeState(file, base);
  const learned = structuredClone(original); learned.memory.facts.push(fact('concurrent'));
  commitState(file, JSON.stringify(learned), base);
  const cleared = structuredClone(original); cleared.memory.epoch = 'cleared'; cleared.memory.facts = [];
  const merged = JSON.parse(commitState(file, JSON.stringify(cleared), base));
  assert.deepEqual(merged.memory.facts, []);
  assert.equal(merged.memory.epoch, 'cleared');
});

test('a manual fact edit changes epoch while preserving unrelated concurrently learned facts', t => {
  const file = storeFile(t), original = memoryState(), base = JSON.stringify(original);
  writeState(file, base);
  const learned = structuredClone(original); learned.memory.facts.push(fact('concurrent'));
  commitState(file, JSON.stringify(learned), base);
  const edited = structuredClone(original); edited.memory.epoch = 'edited'; edited.memory.facts[0].content = '手动确认的偏好';
  const merged = JSON.parse(commitState(file, JSON.stringify(edited), base));
  assert.deepEqual(merged.memory.facts.map(value => value.id).sort(), ['concurrent', 'f1']);
  assert.equal(merged.memory.facts.find(value => value.id === 'f1').content, '手动确认的偏好');
  assert.equal(merged.memory.epoch, 'edited');
});

test('automatic learning is atomically rejected when its user source was deleted but the assistant remains', t => {
  const file = storeFile(t), original = memoryState();
  original.chatSessions[0].messages.push({ id: 'assistant', role: 'model', text: '回复已完成' });
  const base = JSON.stringify(original);
  writeState(file, base);
  const deleted = structuredClone(original);
  deleted.chatSessions[0].messages = deleted.chatSessions[0].messages.filter(message => message.id !== 'm1');
  commitState(file, JSON.stringify(deleted), base);
  const files = [file, memoryPath(file), `${file}.bak`];
  const before = files.map(name => fs.readFileSync(name, 'utf8'));
  const stale = structuredClone(original);
  stale.memory.facts.push(fact('late'));
  stale.tasks.push({ id: 'late-task', name: '同事务任务', progress: 0, date: '2026-09-11' });
  assert.equal(commitState(file, JSON.stringify(stale), base, { sessionId: 's1', messageId: 'assistant' }), null);
  assert.deepEqual(files.map(name => fs.readFileSync(name, 'utf8')), before);
});

test('automatic learning rejects assistant, attachment and changed evidence sources in the current snapshot', t => {
  for (const mutate of [
    message => { message.role = 'model'; },
    message => { message.contextText = '附件资料'; },
    message => { message.text = '这段不包含旧证据'; },
  ]) {
    const file = storeFile(t), original = memoryState(), base = JSON.stringify(original);
    writeState(file, base);
    const changed = structuredClone(original); mutate(changed.chatSessions[0].messages[0]);
    const current = commitState(file, JSON.stringify(changed), base);
    const stale = structuredClone(original); stale.memory.facts.push(fact('late'));
    assert.equal(commitState(file, JSON.stringify(stale), base), null);
    assert.deepEqual(JSON.parse(readState(file)), JSON.parse(current));
  }
});

test('manual memory edits with a new epoch remain allowed after their old source was deleted', t => {
  const file = storeFile(t), original = memoryState(), base = JSON.stringify(original);
  writeState(file, base);
  const deleted = structuredClone(original); deleted.chatSessions[0].messages = [];
  const current = commitState(file, JSON.stringify(deleted), base);
  const edited = JSON.parse(current); edited.memory.epoch = 'manual'; edited.memory.facts[0].content = '用户手工修正';
  const result = commitState(file, JSON.stringify(edited), current);
  assert.equal(JSON.parse(result).memory.facts[0].content, '用户手工修正');
});

test('concurrent automatic facts with the same semantic key converge on the latest submitted ID', t => {
  const file = storeFile(t), original = memoryState(); original.memory.facts = [];
  const base = JSON.stringify(original);
  writeState(file, base);
  const first = structuredClone(original);
  first.memory.facts = [{ ...fact('uuid-first'), key: 'preference.reply_style' }, fact('unrelated')];
  commitState(file, JSON.stringify(first), base);
  const second = structuredClone(original);
  second.memory.facts = [{ ...fact('uuid-second'), key: 'preference.reply_style' }];
  const merged = JSON.parse(commitState(file, JSON.stringify(second), base));
  assert.deepEqual(merged.memory.facts.map(value => value.id).sort(), ['unrelated', 'uuid-second']);
  assert.equal(merged.memory.facts.filter(value => value.key === 'preference.reply_style').length, 1);
  assert.deepEqual(readAfterRestart(file).memory, merged.memory);
  const duplicate = structuredClone(original);
  duplicate.memory.facts = [{ ...fact('a'), key: 'same-key' }, { ...fact('b'), key: 'same-key' }];
  assert.throws(() => decryptData(legacyEncrypt(JSON.stringify(duplicate), 'password'), 'password'));
});

test('task activity is stamped on creation and progress changes, but not on notes or renames', t => {
  const file = storeFile(t), initial = state(); initial.tasks = [];
  writeState(file, JSON.stringify(initial));
  const created = structuredClone(initial);
  created.tasks = [{ id: 'new-task', name: '新任务', date: '2026-09-11', progress: 0 }];
  const creation = JSON.parse(writeState(file, JSON.stringify(created), { now: new Date('2026-09-11T01:00:00.000Z') }));
  assert.equal(creation.tasks[0].lastProgressAt, '2026-09-11T01:00:00.000Z');
  const edited = structuredClone(creation); edited.tasks[0].name = '重命名'; edited.tasks[0].notes = '新增备注';
  const renamed = JSON.parse(writeState(file, JSON.stringify(edited), { now: new Date('2026-09-11T02:00:00.000Z') }));
  assert.equal(renamed.tasks[0].lastProgressAt, creation.tasks[0].lastProgressAt);
  renamed.tasks[0].progress = 70;
  const updated = JSON.parse(writeState(file, JSON.stringify(renamed), { now: new Date('2026-09-11T03:00:00.000Z') }));
  assert.equal(updated.tasks[0].lastProgressAt, '2026-09-11T03:00:00.000Z');
  assert.equal(JSON.parse(readState(file)).tasks[0].lastProgressAt, updated.tasks[0].lastProgressAt);
});

test('commit returns the stamped time and stale metadata cannot roll task activity backwards', t => {
  const file = storeFile(t), initial = state(), base = JSON.stringify(initial);
  writeState(file, base);
  const changed = structuredClone(initial); changed.tasks[0].progress = 60;
  const committed = JSON.parse(commitState(file, JSON.stringify(changed), base));
  assert.notEqual(committed.tasks[0].lastProgressAt, initial.tasks[0].lastProgressAt);
  assert.equal(committed.tasks[0].lastProgressAt, JSON.parse(readState(file)).tasks[0].lastProgressAt);
  const stale = structuredClone(initial); stale.tasks[0].notes = '另一个窗口的备注'; stale.tasks[0].lastProgressAt = '2026-09-10T00:00:00.000Z';
  const merged = JSON.parse(commitState(file, JSON.stringify(stale), base));
  assert.equal(merged.tasks[0].lastProgressAt, committed.tasks[0].lastProgressAt);
  assert.equal(merged.tasks[0].progress, 60);
  const rawStale = structuredClone(merged); rawStale.tasks[0].lastProgressAt = initial.tasks[0].lastProgressAt;
  assert.equal(JSON.parse(writeState(file, JSON.stringify(rawStale))).tasks[0].lastProgressAt, committed.tasks[0].lastProgressAt);
});

test('restore retains valid historical activity and initializes only missing timestamps', t => {
  const file = storeFile(t), initial = state();
  writeState(file, JSON.stringify(initial));
  const imported = structuredClone(initial); imported.tasks[0].progress = 90;
  imported.tasks.push({ id: 'missing', name: '旧版任务', date: '2026-09-11', progress: 0 });
  const result = JSON.parse(writeState(file, JSON.stringify(imported), { restore: true, now: new Date('2026-09-11T05:00:00.000Z') }));
  assert.equal(result.tasks[0].lastProgressAt, initial.tasks[0].lastProgressAt);
  assert.equal(result.tasks[1].lastProgressAt, '2026-09-11T05:00:00.000Z');
});

test('same-value reminder confirmation stamps activity and stale renderers cannot restore the active card', t => {
  const file = storeFile(t), initial = state(), now = new Date(2026, 8, 11, 12);
  initial.settings = { ...initial.settings, floatingBallEnabled: true, proactiveEnabled: true,
    proactiveIntervalMinutes: 30, proactiveQuietStart: '00:00', proactiveQuietEnd: '00:00' };
  initial.tasks[0].lastProgressAt = new Date(now.getTime() - 3 * 3600000).toISOString();
  const planned = planReminder(initial, now); assert.ok(planned.proactive.active);
  const base = writeState(file, JSON.stringify(planned), { restore: true, now });
  const confirmed = applyReminderAction(planned, planned.proactive.active.id, 'update', 0, now);
  writeState(file, JSON.stringify(confirmed), { now });
  const after = JSON.parse(readState(file));
  assert.equal(after.tasks[0].lastProgressAt, now.toISOString());
  assert.equal(after.proactive.active, undefined);
  const stale = JSON.parse(base); stale.profile.goal = '新目标'; stale.proactive.count = 0;
  const merged = JSON.parse(commitState(file, JSON.stringify(stale), base));
  assert.equal(merged.proactive.active, undefined);
  assert.equal(merged.proactive.count, 1);
  assert.equal(merged.tasks[0].lastProgressAt, after.tasks[0].lastProgressAt);
});

test('settings can clear an unchanged reminder pause while preserving quota and newer pauses', t => {
  const file = storeFile(t), initial = state();
  initial.proactive = { day: '2026-09-11', count: 2, lastRemindedAt: '2026-09-11T01:00:00.000Z', snoozedUntil: '2026-09-11T02:00:00.000Z', dismissedDate: '2026-09-11' };
  const base = writeState(file, JSON.stringify(initial));
  const resume = JSON.parse(base); delete resume.proactive.snoozedUntil; delete resume.proactive.dismissedDate;
  const resumed = JSON.parse(commitState(file, JSON.stringify(resume), base));
  assert.deepEqual(resumed.proactive, { day: '2026-09-11', count: 2, lastRemindedAt: '2026-09-11T01:00:00.000Z' });
  writeState(file, base, { restore: true });
  const newer = JSON.parse(base); newer.proactive.snoozedUntil = '2026-09-11T03:00:00.000Z';
  writeState(file, JSON.stringify(newer));
  const raced = JSON.parse(commitState(file, JSON.stringify(resume), base));
  assert.equal(raced.proactive.snoozedUntil, newer.proactive.snoozedUntil);
  assert.equal(raced.proactive.dismissedDate, undefined);
  assert.equal(raced.proactive.count, 2);
});

test('a complete user-data reset clears reminder history but ordinary snapshots cannot', t => {
  const file = storeFile(t), initial = memoryState(); initial.proactive = { day: '2026-09-11', count: 2 };
  const base = writeState(file, JSON.stringify(initial));
  const ordinary = JSON.parse(base); delete ordinary.proactive; ordinary.tasks = [];
  assert.equal(JSON.parse(commitState(file, JSON.stringify(ordinary), base)).proactive.count, 2);
  const cleared = JSON.parse(base);
  cleared.tasks = []; delete cleared.proactive; cleared.profile = { major: '', goal: '', skills: '', bio: '' };
  cleared.memory = { ...cleared.memory, epoch: 'full-reset', facts: [] };
  cleared.chatSessions = [{ id: 'reset-session', title: '新对话', messages: [], updatedAt: '2026-09-11T01:00:00.000Z' }];
  cleared.activeChatSessionId = 'reset-session'; cleared.reports = []; cleared.historySummaries = [];
  assert.equal(JSON.parse(commitState(file, JSON.stringify(cleared), base)).proactive, undefined);
});
