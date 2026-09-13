const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { probeServer, waitForServer } = require('../electron-wait.cjs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const policy = require('../electron/proactive.cjs');

async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return `http://127.0.0.1:${instance.address().port}`;
}

test('development startup waits through HTTP errors until Vite serves a successful response', async t => {
  let calls = 0;
  const url = await server(t, (_req, res) => {
    res.writeHead(++calls < 3 ? 503 : 200);
    res.end();
  });
  await waitForServer(url, 4, 1);
  assert.equal(calls, 3);
});

test('unavailable development server fails after bounded attempts', async t => {
  let calls = 0;
  const url = await server(t, (_req, res) => { calls++; res.writeHead(500); res.end(); });
  await assert.rejects(waitForServer(url, 2, 1), /did not become ready/);
  assert.equal(calls, 2);
});

test('a hung HTTP server times out cleanly', async t => {
  const url = await server(t, () => {});
  assert.equal(await probeServer(url, 30), false);
});

// Exercise the real main-process handlers without opening a GUI, using a
// deterministic clock and in-memory Electron/file boundaries.
async function desktopHarness(initial) {
  let clock = new Date(2026, 8, 11, 12).getTime(), nextTimer = 1, writeFailure = false, readFailure = false;
  let saved = initial || {
    tasks: [{ id: 't1', name: '阅读文献', date: '2026-09-11', progress: 0,
      lastProgressAt: new Date(clock - 3 * 3600000).toISOString() }],
    settings: { floatingBallEnabled: true, proactiveEnabled: true, proactiveIntervalMinutes: 30,
      proactiveQuietStart: '00:00', proactiveQuietEnd: '00:00', rolloverTime: '02:00' },
  };
  const timers = new Map(), windows = [], writes = [], logs = [];
  class ClockDate extends Date {
    constructor(value) { super(value === undefined ? clock : value); }
    static now() { return clock; }
  }
  const schedule = (fn, delay = 0, repeat = false) => {
    const id = nextTimer++; timers.set(id, { fn, at: clock + delay, repeat: repeat ? delay : 0 }); return id;
  };
  const advance = milliseconds => {
    const end = clock + milliseconds;
    for (let steps = 0; steps < 20000; steps++) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { clock = end; return; }
      const [id, timer] = next; clock = timer.at;
      if (timer.repeat) timer.at += timer.repeat; else timers.delete(id);
      timer.fn();
    }
    throw new Error('Unexpected unbounded timer loop');
  };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.id = windows.length + 1; this.visible = options.show !== false; this.focuses = 0; this.inactiveShows = 0;
      this.bounds = { x: options.x || 0, y: options.y || 0, width: options.width, height: options.height };
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.sent = [];
      this.webContents.send = (name, value) => this.sent.push({ name, value: structuredClone(value) });
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.getURL = () => this.url;
      windows.push(this);
    }
    static getAllWindows() { return windows; }
    static fromWebContents(sender) { return windows.find(win => win.webContents === sender); }
    loadURL(url) { this.url = url; this.webContents.emit('did-start-loading'); return Promise.resolve(); }
    loadFile() { return this.loadURL('file://test'); }
    isDestroyed() { return false; }
    isVisible() { return this.visible; }
    isMinimized() { return false; }
    restore() {}
    show() { this.visible = true; }
    showInactive() { this.visible = true; this.inactiveShows++; }
    hide() { this.visible = false; }
    focus() { this.focuses++; }
    getBounds() { return { ...this.bounds }; }
    getPosition() { return [this.bounds.x, this.bounds.y]; }
    setBounds(value) { this.bounds = { ...this.bounds, ...value }; }
    setPosition(x, y) { this.bounds = { ...this.bounds, x, y }; }
    setResizable() {}
  }
  class FakeTray extends EventEmitter { setToolTip() {} setContextMenu() {} }
  const app = new EventEmitter(), ipcMain = new EventEmitter(), powerMonitor = new EventEmitter();
  app.isPackaged = false; app.isReady = () => true; app.getPath = () => '/isolated-fixture'; app.setPath = () => {};
  app.whenReady = () => Promise.resolve(); app.requestSingleInstanceLock = () => true; app.quit = () => app.emit('before-quit');
  ipcMain.handle = () => {}; powerMonitor.getSystemIdleState = () => 'active';
  const display = { workArea: { x: 0, y: 0, width: 1200, height: 900 }, workAreaSize: { width: 1200, height: 900 } };
  const electron = { app, ipcMain, powerMonitor, BrowserWindow: FakeWindow, Tray: FakeTray,
    screen: { getPrimaryDisplay: () => display, getDisplayMatching: () => display, getDisplayNearestPoint: () => display },
    Menu: { buildFromTemplate: items => items }, nativeImage: { createFromBitmap: () => ({ resize: () => ({}) }) },
    dialog: {}, shell: { openExternal: () => Promise.resolve() } };
  const storage = {
    readState: () => { if (readFailure) throw new Error('simulated read failure'); return JSON.stringify(saved); }, atomicWrite: () => {},
    writeState: (_file, json, options = {}) => {
      if (writeFailure) throw writeFailure instanceof Error ? writeFailure : new Error('simulated write failure');
      saved = policy.reconcileReminder(policy.stampTaskActivity(options.restore ? null : saved, JSON.parse(json), new ClockDate()), new ClockDate());
      writes.push(structuredClone(saved)); return JSON.stringify(saved);
    },
    commitState: (_file, json) => storage.writeState(_file, json),
  };
  const context = { __dirname: path.resolve(__dirname, '..'), process: { env: {}, argv: [] }, Buffer, Date: ClockDate, URL,
    console: { error: (...args) => logs.push(args.join(' ')) },
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, true), clearInterval: id => timers.delete(id),
    require: name => name === 'electron' ? electron : name === './electron/storage.cjs' ? storage
      : name === './electron/proactive.cjs' ? policy : name === 'fs' ? { readFileSync: () => { throw new Error('No saved position'); } } : require(name),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron-main.cjs'), 'utf8'), context);
  await Promise.resolve(); await Promise.resolve(); advance(0);
  const main = windows[0], ball = windows[1];
  const emit = (channel, ...args) => {
    const event = { sender: ball.webContents, senderFrame: ball.webContents.mainFrame };
    ipcMain.emit(channel, event, ...args); return event.returnValue;
  };
  return { app, ipcMain, powerMonitor, main, ball, writes, logs, timers, advance, emit,
    state: () => structuredClone(saved), failWrites: value => { writeFailure = value; }, failReads: value => { readFailure = value; },
    ready: () => { emit('app:update-ball', true); emit('ball:ready'); advance(250); },
    replace: value => { saved = structuredClone(value); },
    dragging: () => vm.runInNewContext('dragState.size', context),
  };
}

test('one main-process scheduler waits for a visible ready ball and never focuses its reminder', async () => {
  const desktop = await desktopHarness(); desktop.main.hide();
  desktop.emit('app:update-ball', true); desktop.advance(30000);
  assert.equal(desktop.state().proactive?.active, undefined, 'renderer must be ready');
  desktop.ready();
  assert.ok(desktop.state().proactive.active);
  assert.equal(desktop.state().proactive.count, 1);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [328, 112]);
  assert.equal(desktop.ball.sent.filter(event => event.name === 'ball:presentation').at(-1).value.mode, 'nudge');
  assert.equal(desktop.ball.focuses, 0);
  assert.ok(desktop.ball.inactiveShows > 0);
  assert.equal([...desktop.timers.values()].filter(timer => timer.repeat === 30000).length, 1);
  desktop.app.quit(); assert.equal(desktop.timers.size, 0);
});

test('manual chat and dragging defer reminders, and renderer reload resets the chat presentation', async () => {
  const desktop = await desktopHarness();
  desktop.emit('app:update-ball', true); desktop.emit('ball:ready'); desktop.emit('ball:expand'); desktop.advance(250);
  assert.equal(desktop.state().proactive?.active, undefined);
  desktop.ball.webContents.emit('did-start-loading'); desktop.advance(250);
  assert.equal(desktop.ball.bounds.width, 48);
  desktop.emit('ball:ready'); desktop.emit('window:drag-start'); desktop.advance(250);
  assert.equal(desktop.state().proactive?.active, undefined);
  desktop.emit('window:drag-end'); desktop.advance(250);
  assert.ok(desktop.state().proactive.active);
  desktop.app.quit();
});

test('locked and suspended sessions withdraw active cards and wait for unlock/resume', async () => {
  const desktop = await desktopHarness(); desktop.ready();
  desktop.powerMonitor.emit('lock-screen'); desktop.advance(250);
  assert.equal(desktop.state().proactive.active, undefined);
  assert.equal(desktop.ball.bounds.width, 48);
  desktop.advance(31 * 60000); assert.equal(desktop.state().proactive.count, 1);
  desktop.powerMonitor.emit('suspend'); desktop.powerMonitor.emit('unlock-screen'); desktop.advance(250);
  assert.equal(desktop.state().proactive.count, 1);
  desktop.powerMonitor.emit('resume'); desktop.advance(250);
  assert.equal(desktop.state().proactive.count, 2);
  desktop.app.quit();
});

test('reminder actions are ball-only, atomic on failure, and support same-value progress confirmation', async () => {
  const desktop = await desktopHarness(); desktop.ready();
  const active = desktop.state().proactive.active, originalTime = desktop.state().tasks[0].lastProgressAt;
  const other = { sender: desktop.main.webContents, senderFrame: desktop.main.webContents.mainFrame };
  desktop.ipcMain.emit('proactive:action', other, active.id, 'update', 50);
  assert.equal(other.returnValue.ok, false);
  desktop.failWrites(true);
  assert.equal(desktop.emit('proactive:action', active.id, 'update', 50).ok, false);
  assert.equal(desktop.state().tasks[0].progress, 0);
  assert.equal(desktop.state().proactive.active.id, active.id);
  desktop.failWrites(false);
  assert.equal(desktop.emit('proactive:action', active.id, 'update', 0).ok, true);
  assert.notEqual(desktop.state().tasks[0].lastProgressAt, originalTime);
  assert.equal(desktop.state().proactive.active, undefined);
  assert.equal(desktop.emit('proactive:action', active.id, 'update', 100).ok, false);
  desktop.app.quit();
});

test('help opens a pinned-ready composer draft only after the reminder action saves', async () => {
  const desktop = await desktopHarness(); desktop.ready();
  const active = desktop.state().proactive.active;
  assert.equal(desktop.emit('proactive:action', active.id, 'help').ok, true);
  desktop.advance(250);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [380, 520]);
  const help = desktop.ball.sent.find(event => event.name === 'reminder:help');
  assert.equal(help.value.taskId, 't1'); assert.match(help.value.prompt, /阅读文献.*日期：2026-09-11.*0%/);
  assert.match(help.value.prompt, /不要直接添加或修改/);
  assert.equal(desktop.state().proactive.active, undefined);
  assert.equal(desktop.ball.focuses, 0);
  desktop.app.quit();
});

test('unpersisted reminders never display and a restart does not announce the same saved card again', async () => {
  const desktop = await desktopHarness(); desktop.failWrites(true); desktop.ready();
  assert.equal(desktop.state().proactive?.active, undefined);
  assert.equal(desktop.ball.bounds.width, 48);
  desktop.failWrites(false); desktop.advance(30000); desktop.advance(250);
  const saved = desktop.state(); assert.ok(saved.proactive.active); desktop.app.quit();
  const restarted = await desktopHarness(saved); restarted.ready();
  assert.equal(restarted.state().proactive.active, undefined);
  assert.equal(restarted.state().proactive.count, 1);
  assert.equal(restarted.ball.bounds.width, 48);
  restarted.app.quit();
});

test('collapsing the chat returns to the small ball even when storage cannot be read', async () => {
  const desktop = await desktopHarness();
  desktop.emit('app:update-ball', true); desktop.emit('ball:ready'); desktop.emit('ball:expand'); desktop.advance(250);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [380, 520]);
  desktop.failReads(true);
  desktop.emit('ball:collapse'); desktop.advance(250);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [48, 48]);
  assert.ok(desktop.logs.some(message => message.includes('simulated read failure')));
  desktop.app.quit();
});

test('a renderer reload clears interrupted dragging and allows the ready ball to remind again', async () => {
  const desktop = await desktopHarness();
  desktop.emit('app:update-ball', true); desktop.emit('ball:ready'); desktop.emit('window:drag-start'); desktop.advance(250);
  assert.equal(desktop.dragging(), 1);
  assert.equal(desktop.state().proactive?.active, undefined);
  desktop.ball.webContents.emit('did-start-loading'); desktop.emit('ball:ready'); desktop.advance(250);
  assert.equal(desktop.dragging(), 0);
  assert.ok(desktop.state().proactive.active);
  assert.equal(desktop.ball.bounds.width, 328);
  desktop.app.quit();
});

for (const [interrupt, resume] of [['lock-screen', 'unlock-screen'], ['suspend', 'resume']]) {
  test(`${interrupt} clears interrupted dragging so ${resume} can resume scheduling`, async () => {
    const desktop = await desktopHarness();
    desktop.emit('app:update-ball', true); desktop.emit('ball:ready'); desktop.emit('window:drag-start'); desktop.advance(250);
    assert.equal(desktop.dragging(), 1);
    desktop.powerMonitor.emit(interrupt);
    assert.equal(desktop.dragging(), 0);
    desktop.powerMonitor.emit(resume); desktop.advance(250);
    assert.ok(desktop.state().proactive.active);
    desktop.app.quit();
  });
}

test('closing the ball clears its interrupted dragging state', async () => {
  const desktop = await desktopHarness(); desktop.emit('window:drag-start');
  assert.equal(desktop.dragging(), 1);
  desktop.ball.emit('closed');
  assert.equal(desktop.dragging(), 0);
  desktop.app.quit();
});

test('opening and returning from reminder detail changes only presentation, never quota or saved data', async () => {
  const desktop = await desktopHarness(); desktop.ready();
  const before = desktop.state(), active = before.proactive.active, writeCount = desktop.writes.length;
  const originalAnchor = desktop.ball.sent.filter(event => event.name === 'ball:presentation').at(-1).value.anchor;
  const anchor = { x: desktop.ball.bounds.x + originalAnchor.x, y: desktop.ball.bounds.y + originalAnchor.y };
  for (const expanded of [true, true, false, false, true, false]) {
    assert.equal(desktop.emit('reminder:expand', active.id, expanded).ok, true);
    desktop.advance(250);
    assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], expanded ? [360, 380] : [328, 112]);
    const presentation = desktop.ball.sent.filter(event => event.name === 'ball:presentation').at(-1).value;
    assert.equal(presentation.mode, expanded ? 'reminder' : 'nudge');
    assert.deepEqual({ x: desktop.ball.bounds.x + presentation.anchor.x, y: desktop.ball.bounds.y + presentation.anchor.y }, anchor);
    assert.deepEqual(desktop.state(), before);
    assert.equal(desktop.writes.length, writeCount);
    assert.equal(desktop.ball.focuses, 0);
  }
  desktop.app.quit();
});

test('reminder detail rejects other windows, child frames, invalid input and stale reminder IDs', async () => {
  const desktop = await desktopHarness(); desktop.ready();
  const active = desktop.state().proactive.active, writes = desktop.writes.length;
  for (const event of [
    { sender: desktop.main.webContents, senderFrame: desktop.main.webContents.mainFrame },
    { sender: desktop.ball.webContents, senderFrame: {} },
    { sender: desktop.ball.webContents },
  ]) {
    desktop.ipcMain.emit('reminder:expand', event, active.id, true);
    assert.equal(event.returnValue.ok, false);
  }
  assert.equal(desktop.emit('reminder:expand', 'forged-id', true).ok, false);
  assert.equal(desktop.emit('reminder:expand', active.id, 'true').ok, false);
  desktop.failReads(true);
  assert.equal(desktop.emit('reminder:expand', active.id, true).ok, false);
  desktop.failReads(false);
  const latest = desktop.state(); latest.tasks[0].progress = 40; desktop.replace(latest);
  assert.equal(desktop.emit('reminder:expand', active.id, true).ok, false);
  assert.equal(desktop.writes.length, writes);
  desktop.advance(250);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [328, 112]);
  desktop.app.quit();
});

test('a current detail cannot be reopened after its TTL and the scheduled cleanup returns to the ball', async () => {
  const desktop = await desktopHarness(); desktop.ready();
  const active = desktop.state().proactive.active;
  assert.equal(desktop.emit('reminder:expand', active.id, true).ok, true);
  desktop.advance(policy.REMINDER_TTL_MS + 250);
  assert.equal(desktop.emit('reminder:expand', active.id, true).ok, false);
  assert.equal(desktop.state().proactive.active, undefined);
  assert.equal(desktop.state().proactive.count, 1);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [48, 48]);
  desktop.app.quit();
});

test('renderer reload returns a valid expanded reminder to its small nudge without spending quota', async () => {
  const desktop = await desktopHarness(); desktop.ready();
  const before = desktop.state(), active = before.proactive.active;
  desktop.emit('reminder:expand', active.id, true); desktop.advance(250);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [360, 380]);
  desktop.ball.webContents.emit('did-start-loading'); desktop.advance(250);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [48, 48]);
  desktop.emit('ball:ready'); desktop.advance(250);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [328, 112]);
  assert.equal(desktop.ball.sent.filter(event => event.name === 'ball:presentation').at(-1).value.mode, 'nudge');
  assert.deepEqual(desktop.state(), before);
  desktop.app.quit();
});

for (const [interrupt, resume] of [['lock-screen', 'unlock-screen'], ['suspend', 'resume']]) {
  test(`${interrupt} closes detail, and a later eligible reminder after ${resume} starts as a nudge`, async () => {
    const desktop = await desktopHarness(); desktop.ready();
    const active = desktop.state().proactive.active;
    desktop.emit('reminder:expand', active.id, true); desktop.advance(250);
    desktop.powerMonitor.emit(interrupt); desktop.advance(250);
    assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [48, 48]);
    assert.equal(desktop.emit('reminder:expand', active.id, true).ok, false);
    desktop.advance(31 * 60000);
    assert.equal(desktop.state().proactive.count, 1);
    desktop.powerMonitor.emit(resume); desktop.advance(250);
    assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [328, 112]);
    assert.notEqual(desktop.state().proactive.active.id, active.id);
    assert.equal(desktop.state().proactive.count, 2);
    assert.equal(desktop.ball.sent.filter(event => event.name === 'ball:presentation').at(-1).value.mode, 'nudge');
    desktop.app.quit();
  });
}

test('reminder detail cannot replace a manual chat and completion returns detail to the small ball', async () => {
  const desktop = await desktopHarness(); desktop.ready();
  const active = desktop.state().proactive.active;
  desktop.emit('ball:expand'); desktop.advance(250);
  assert.equal(desktop.emit('reminder:expand', active.id, true).ok, false);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [380, 520]);
  desktop.emit('ball:collapse'); desktop.advance(250);
  assert.equal(desktop.emit('reminder:expand', active.id, true).ok, true); desktop.advance(250);
  assert.equal(desktop.emit('proactive:action', active.id, 'complete').ok, true); desktop.advance(250);
  assert.equal(desktop.state().tasks[0].progress, 100);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [48, 48]);
  desktop.app.quit();
});

test('ending a drag that interrupts the nudge animation restores its full native size', async () => {
  const desktop = await desktopHarness();
  desktop.emit('app:update-ball', true); desktop.emit('ball:ready'); desktop.advance(48);
  assert.ok(desktop.ball.bounds.width > 48 && desktop.ball.bounds.width < 328);
  desktop.emit('window:drag-start'); desktop.emit('window:drag-end'); desktop.advance(250);
  assert.deepEqual([desktop.ball.bounds.width, desktop.ball.bounds.height], [328, 112]);
  const { anchor } = desktop.ball.sent.filter(event => event.name === 'ball:presentation').at(-1).value;
  assert.ok(anchor.x >= 0 && anchor.x <= desktop.ball.bounds.width - 48);
  assert.ok(anchor.y >= 0 && anchor.y <= desktop.ball.bounds.height - 48);
  assert.ok(desktop.ball.bounds.x + anchor.x <= 1200 - 48);
  assert.ok(desktop.ball.bounds.y + anchor.y <= 900 - 48);
  assert.equal(desktop.state().proactive.count, 1);
  desktop.app.quit();
});

test('atomic task conflicts return an actionable error through preload without broadcasting success', async () => {
  const desktop = await desktopHarness();
  desktop.failWrites(Object.assign(new Error('任务已在其他窗口改期，请重新确认任务名称和日期后再发送。'), { code: 'TASK_CONTEXT_STALE' }));
  let api;
  const ipcRenderer = {
    sendSync: (channel, ...args) => desktop.emit(channel, ...args),
    on: () => {}, send: () => {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron-preload.cjs'), 'utf8'), {
    window: {}, console: { error: () => {} },
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } }, ipcRenderer,
      webFrame: { setZoomFactor: () => {}, setZoomLevel: () => {} } }),
  });
  const before = JSON.stringify(desktop.state());
  assert.throws(() => api.storeCommit(before, before), /改期.*重新确认/);
  assert.equal(JSON.stringify(desktop.state()), before);
  assert.equal(desktop.writes.length, 0);
  assert.equal(desktop.ball.sent.some(event => event.name === 'store:changed'), false);
  desktop.failWrites(true);
  assert.equal(api.storeCommit(before, before), null, 'ordinary storage failures retain the existing return contract');
  desktop.app.quit();
});
