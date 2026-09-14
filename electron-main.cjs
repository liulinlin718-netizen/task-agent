const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { atomicWrite, readText, readState, writeState, commitState, encryptData, decryptData } = require('./electron/storage.cjs');
const { reconcileReminder, planReminder, applyReminderAction } = require('./electron/proactive.cjs');
const { isDeepStrictEqual } = require('node:util');

// A separate profile is useful for development and smoke tests. Resolve it
// before reading data or acquiring Electron's per-profile instance lock.
const dataDirArgument = process.argv.find(value => value.startsWith('--user-data-dir='));
const dataDir = process.env.TASKAGENT_USER_DATA_DIR || dataDirArgument?.slice('--user-data-dir='.length);
if (dataDir) app.setPath('userData', path.resolve(dataDir));

let mainWindow = null;
let ballWindow = null;
let taskCenterWindow = null;
let tray = null;
let ballReady = false;
let ballChatExpanded = false;
let ballMode = 'ball';
let reminderExpandedId = null;
let ballAnchor = null;
let screenLocked = false;
let systemSuspended = false;
let reminderInitialized = false;
let reminderTimer = null;
let reminderTick = null;

const BALL_POS_FILE = path.join(app.getPath('userData'), 'ball-position.json');
const STORE_FILE = path.join(app.getPath('userData'), 'taskagent-data.json');

const isDev = !app.isPackaged;
const VITE_DEV_URL = 'http://localhost:3000';
const SNAP_THRESHOLD = 50;
const TC_STRIP_W = 3;

function configureWindow(win) {
  const openExternal = url => {
    try {
      if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) {
        shell.openExternal(url).catch(error => console.error('[window] Unable to open link:', error.message));
      }
    } catch { /* ignore invalid links */ }
  };
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) { event.preventDefault(); openExternal(url); }
  });
  win.webContents.on('did-fail-load', (_event, code, description) => {
    if (code !== -3) console.error(`[window] Failed to load: ${description} (${code})`);
  });
}

function loadWindow(win, type) {
  configureWindow(win);
  const loading = isDev
    ? win.loadURL(`${VITE_DEV_URL}${type ? `?window=${type}` : ''}`)
    : win.loadFile(path.join(__dirname, 'dist/index.html'), type ? { query: { window: type } } : {});
  loading.catch(error => console.error('[window] Unable to load application:', error.message));
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function workArea(win) {
  return win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds()).workArea
    : screen.getPrimaryDisplay().workArea;
}

const finiteCoordinates = (...values) => values.every(Number.isFinite);

function saveBallPosition(x, y) {
  try { atomicWrite(BALL_POS_FILE, JSON.stringify({ x, y })); }
  catch (error) { console.error('[window] Unable to save floating ball position:', error.message); }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    icon: path.join(__dirname, 'resources/icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, zoomFactor: 1,
    },
    show: true,
    backgroundColor: '#ffffff', // Prevents transparent flash before React renders
  });
  loadWindow(mainWindow);
  mainWindow.on('close', (e) => {
    // Hide instead of quit — tray keeps the app alive
    if (!app.isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
    } else if (!app.isQuitting) {
      app.quit();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createBallWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  // Restore saved position or use default
  let bx = area.x + area.width - 80, by = area.y + area.height - 200;
  try {
    const saved = JSON.parse(fs.readFileSync(BALL_POS_FILE, 'utf-8'));
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const savedArea = screen.getDisplayNearestPoint({ x: Math.round(saved.x), y: Math.round(saved.y) }).workArea;
      bx = Math.round(Math.max(savedArea.x, Math.min(saved.x, savedArea.x + savedArea.width - 48)));
      by = Math.round(Math.max(savedArea.y, Math.min(saved.y, savedArea.y + savedArea.height - 48)));
    }
  } catch { /* no saved position */ }
  ballWindow = new BrowserWindow({
    width: 48, height: 48, x: bx, y: by,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, zoomFactor: 1,
    },
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, skipTaskbar: true, hasShadow: false, show: false,
  });
  ballAnchor = { x: bx, y: by };
  ballWindow.webContents.on('did-start-loading', () => {
    reminderExpandedId = null;
    ballReady = false;
    ballChatExpanded = false;
    dragState.delete(ballWindow.id);
    if (ballMode !== 'ball') resizeBall('ball');
  });
  loadWindow(ballWindow, 'ball');

  ballWindow.on('closed', () => {
    dragState.delete(ballWindow.id);
    clearTimeout(animations.get(ballWindow.id)); animations.delete(ballWindow.id);
    ballWindow = null; ballReady = false; ballChatExpanded = false; ballMode = 'ball';
  });
}

function createTaskCenterWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  taskCenterWindow = new BrowserWindow({
    width: 320, height: 480, x: area.x + area.width - 360, y: area.y + Math.round((area.height - 480) / 2),
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, zoomFactor: 1,
    },
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, skipTaskbar: true, hasShadow: false, show: false,
  });
  loadWindow(taskCenterWindow, 'taskcenter');

  taskCenterWindow.on('closed', () => { taskCenterWindow = null; });
}

// ─── Generic IPC ─────────────────────────────────────────────────────────────────
ipcMain.on('log-error', (_event, err) => {
  if (typeof err === 'string') console.error(err);
});

// ─── Persistent Store IPC ─────────────────────────────────────────────────────────
ipcMain.on('store:get', (event) => {
  try { event.returnValue = readState(STORE_FILE); }
  catch (error) { event.returnValue = { error: error.message }; }
});

function broadcastState(data, sender) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents !== sender) win.webContents.send('store:changed', data);
  }
}

ipcMain.on('store:set', (event, data) => {
  try {
    const saved = writeState(STORE_FILE, data, { preserveProactive: true });
    event.returnValue = true;
    broadcastState(saved);
    deferReminderEvaluation();
  } catch (error) {
    console.error('[store] Save failed:', error.message);
    event.returnValue = false;
  }
});

ipcMain.on('store:commit', (event, data, base, guard) => {
  try {
    const merged = commitState(STORE_FILE, data, base, guard);
    event.returnValue = merged;
    if (merged !== null) { broadcastState(merged, event.sender); deferReminderEvaluation(); }
  } catch (error) {
    console.error('[store] Save failed:', error.message);
    event.returnValue = error.code === 'TASK_CONTEXT_STALE' ? { error: error.message } : null;
  }
});

// ─── Data Export/Import IPC ────────────────────────────────────────────────────
ipcMain.handle('data:export', async (event, password) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const { filePath } = await dialog.showSaveDialog(win, {
      defaultPath: `taskagent-backup-${new Date().toISOString().slice(0, 10)}.taskagent`,
      filters: [{ name: 'TaskAgent Backup', extensions: ['taskagent'] }],
    });
    if (!filePath) return null;
    const data = readState(STORE_FILE);
    if (data === null) throw new Error('No valid saved data');
    const encrypted = encryptData(data, password);
    atomicWrite(filePath, JSON.stringify(encrypted));
    return true;
  } catch (error) {
    console.error('[backup] Export failed:', error.message);
    return false;
  }
});

ipcMain.handle('data:import', async (event, password) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const { filePaths } = await dialog.showOpenDialog(win, {
      filters: [{ name: 'TaskAgent Backup', extensions: ['taskagent'] }],
      properties: ['openFile'],
    });
    if (!filePaths || !filePaths[0]) return null;
    const encrypted = JSON.parse(readText(filePaths[0]));
    const decrypted = decryptData(encrypted, password);
    const saved = writeState(STORE_FILE, decrypted, { restore: true });
    broadcastState(saved, event.sender);
    deferReminderEvaluation();
    return saved;
  } catch (error) {
    console.error('[backup] Import failed:', error.message);
    return '__ERROR__';
  }
});

ipcMain.on('app:update-ball', (_event, enabled) => {
  if (!ballWindow || ballWindow.isDestroyed()) return;
  if (enabled === true) {
    ballWindow.showInactive();
  } else {
    ballWindow.hide();
  }
  deferReminderEvaluation();
});

ipcMain.on('ball:ready', event => {
  if (event.sender !== ballWindow?.webContents) return;
  ballReady = true;
  sendBallPresentation();
  deferReminderEvaluation();
});

let prevTcVisible = false;

ipcMain.on('app:update-taskcenter', (_event, enabled) => {
  if (typeof enabled !== 'boolean') return;
  const area = screen.getPrimaryDisplay().workArea;
  if (!taskCenterWindow || taskCenterWindow.isDestroyed()) return;
  if (enabled && !prevTcVisible) {
    taskCenterWindow.setResizable(true);
    taskCenterWindow.setBounds({ x: area.x + area.width - 360, y: area.y + Math.round((area.height - 480) / 2), width: 320, height: 480 });
    taskCenterWindow.setResizable(false);
    taskCenterWindow.webContents.send('taskcenter:auto-snap', null);
    taskCenterWindow.showInactive();
  } else if (enabled) {
    taskCenterWindow.showInactive();
  } else {
    taskCenterWindow.hide();
  }
  prevTcVisible = enabled;
});

ipcMain.on('window:move', (event, dx, dy) => {
  if (!finiteCoordinates(dx, dy)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    const [x, y] = win.getPosition();
    win.setPosition(x + Math.round(dx), y + Math.round(dy));
    if (win === ballWindow && ballAnchor) { ballAnchor.x += Math.round(dx); ballAnchor.y += Math.round(dy); }
  }
});

const dragState = new Map();

ipcMain.on('window:drag-start', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    clearTimeout(animations.get(win.id)); animations.delete(win.id);
    dragState.set(win.id, win.getBounds());
  }
});

ipcMain.on('window:drag-to', (event, x, y) => {
  if (!finiteCoordinates(x, y)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    const b = dragState.get(win.id);
    if (b) {
      win.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height });
    } else {
      win.setPosition(Math.round(x), Math.round(y));
    }
    if (win === ballWindow) ballAnchor = { x: Math.round(x) + ballExpandOffset.x, y: Math.round(y) + ballExpandOffset.y };
  }
});

ipcMain.on('window:drag-end', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) dragState.delete(win.id);
  if (win === ballWindow && !win.isDestroyed()) {
    const b = win.getBounds();
    ballAnchor = { x: b.x + (b.width > 48 ? ballExpandOffset.x : 0), y: b.y + (b.height > 48 ? ballExpandOffset.y : 0) };
    saveBallPosition(ballAnchor.x, ballAnchor.y);
    deferReminderEvaluation();
  }
});

ipcMain.on('window:get-position', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  event.returnValue = win && !win.isDestroyed() ? win.getPosition() : [0, 0];
});

ipcMain.on('window:get-bounds', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  event.returnValue = win && !win.isDestroyed() ? win.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
});

ipcMain.on('window:set-bounds', (event, bounds) => {
  if (!bounds || !finiteCoordinates(bounds.x, bounds.y, bounds.width, bounds.height) || bounds.width < 1 || bounds.height < 1) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.setResizable(true);
    win.setBounds({
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.round(bounds.width), height: Math.round(bounds.height),
    });
    win.setResizable(false);
  }
});

ipcMain.on('screen:get-work-area', (event) => {
  event.returnValue = workArea(BrowserWindow.fromWebContents(event.sender));
});

let ballExpandOffset = { x: 0, y: 0 };

// Animated setBounds with easeOutCubic
const animations = new Map();
function animateBounds(win, target, durationMs = 200) {
  if (!win || win.isDestroyed()) return;
  clearTimeout(animations.get(win.id));
  const start = win.getBounds();
  const t0 = Date.now();
  const step = () => {
    if (win.isDestroyed()) { animations.delete(win.id); return; }
    const elapsed = Date.now() - t0;
    const p = Math.min(elapsed / durationMs, 1);
    const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
    win.setBounds({
      x: Math.round(start.x + (target.x - start.x) * e),
      y: Math.round(start.y + (target.y - start.y) * e),
      width: Math.round(start.width + (target.width - start.width) * e),
      height: Math.round(start.height + (target.height - start.height) * e),
    });
    if (p < 1) animations.set(win.id, setTimeout(step, 16));
    else { animations.delete(win.id); win.setResizable(false); }
  };
  step();
}

function ballSize(mode) {
  return mode === 'chat' ? [380, 520] : mode === 'reminder' ? [360, 380] : mode === 'nudge' ? [328, 112] : [48, 48];
}

function resizeBall(mode) {
  if (!ballWindow || ballWindow.isDestroyed()) return;
  const area = workArea(ballWindow);
  const [x, y] = ballWindow.getPosition();
  const savedAnchor = ballAnchor || { x, y };
  const anchor = {
    x: Math.max(area.x, Math.min(savedAnchor.x, area.x + area.width - 48)),
    y: Math.max(area.y, Math.min(savedAnchor.y, area.y + area.height - 48)),
  };
  const [width, height] = ballSize(mode);
  let newX = anchor.x - (width - 48), newY = anchor.y - (height - 48);
  if (anchor.x - area.x < width / 2) newX = anchor.x;
  if (anchor.y - area.y < height / 2) newY = anchor.y;
  newX = Math.max(area.x, Math.min(newX, area.x + area.width - width));
  newY = Math.max(area.y, Math.min(newY, area.y + area.height - height));
  ballExpandOffset = mode === 'ball' ? { x: 0, y: 0 } : { x: anchor.x - newX, y: anchor.y - newY };
  ballAnchor = mode === 'ball' ? { x: newX, y: newY } : anchor;
  ballMode = mode;
  sendBallPresentation();
  ballWindow.setResizable(true);
  animateBounds(ballWindow, { x: newX, y: newY, width, height });
  if (mode === 'ball') saveBallPosition(newX, newY);
}

function sendBallPresentation() {
  if (ballReady && ballWindow && !ballWindow.isDestroyed()) {
    ballWindow.webContents.send('ball:presentation', { mode: ballMode, anchor: ballExpandOffset });
  }
}

function syncBallPresentation(state) {
  if (!ballReady || !ballWindow || ballWindow.isDestroyed()) return;
  const active = state?.proactive?.active;
  if (!active || active.id !== reminderExpandedId) reminderExpandedId = null;
  const mode = ballChatExpanded ? 'chat' : active && !screenLocked && !systemSuspended ? (reminderExpandedId ? 'reminder' : 'nudge') : 'ball';
  const [width, height] = ballSize(mode);
  const bounds = ballWindow.getBounds();
  const interruptedResize = !animations.has(ballWindow.id) && (bounds.width !== width || bounds.height !== height);
  if ((mode !== ballMode || interruptedResize) && !dragState.has(ballWindow.id)) {
    resizeBall(mode);
    if ((mode === 'nudge' || mode === 'reminder') && ballWindow.isVisible()) ballWindow.showInactive();
  }
}

ipcMain.on('reminder:expand', (event, id, expanded) => {
  event.returnValue = { ok: false, error: '提醒已失效，请等待新的提醒。' };
  if (event.sender !== ballWindow?.webContents || event.senderFrame !== ballWindow.webContents.mainFrame || typeof expanded !== 'boolean') return;
  try {
    const saved = readState(STORE_FILE);
    const current = saved && reconcileReminder(JSON.parse(saved), new Date());
    if (!current?.proactive?.active || current.proactive.active.id !== id || ballChatExpanded || screenLocked || systemSuspended) return;
    reminderExpandedId = expanded ? id : null;
    syncBallPresentation(current);
    event.returnValue = { ok: true };
  } catch (error) { console.error('[reminder] Unable to open reminder:', error.message); }
});

ipcMain.on('ball:expand', event => {
  if (event.sender !== ballWindow?.webContents) return;
  ballChatExpanded = true;
  resizeBall('chat');
});

ipcMain.on('ball:collapse', event => {
  if (event.sender !== ballWindow?.webContents) return;
  ballChatExpanded = false;
  resizeBall('ball');
  deferReminderEvaluation();
});

ipcMain.on('ball:check-snap', (event) => {
  if (!ballWindow || ballWindow.isDestroyed()) { event.returnValue = null; return; }
  const [x] = ballWindow.getPosition();
  const b = ballWindow.getBounds();
  const area = workArea(ballWindow);

  const BALL_MARGIN = 0; // Fixed distance from edge
  const center = x + b.width / 2;
  const SNAP_DIST = 100;

  if (center - area.x <= SNAP_DIST) {
    ballWindow.setPosition(area.x + BALL_MARGIN, b.y);
    ballAnchor = { x: area.x + BALL_MARGIN + ballExpandOffset.x, y: b.y + ballExpandOffset.y };
    if (b.width === 48) saveBallPosition(area.x + BALL_MARGIN, b.y);
    event.returnValue = 'left';
  } else if (area.x + area.width - center <= SNAP_DIST) {
    ballWindow.setPosition(area.x + area.width - b.width - BALL_MARGIN, b.y);
    ballAnchor = { x: area.x + area.width - b.width - BALL_MARGIN + ballExpandOffset.x, y: b.y + ballExpandOffset.y };
    if (b.width === 48) saveBallPosition(area.x + area.width - b.width - BALL_MARGIN, b.y);
    event.returnValue = 'right';
  } else {
    event.returnValue = null;
  }
});

// ─── Task Center IPC ─────────────────────────────────────────────────────────
ipcMain.on('taskcenter:snap-to-edge', (event, edge, height) => {
  if (!taskCenterWindow || taskCenterWindow.isDestroyed()) return;
  if (!['left', 'right'].includes(edge) || (height !== undefined && (!Number.isFinite(height) || height < 1))) return;
  const area = workArea(taskCenterWindow);
  const b = taskCenterWindow.getBounds();
  const h = Math.min(Math.round(height || b.height), area.height);
  const y = Math.max(area.y, Math.min(b.y, area.y + area.height - h));
  taskCenterWindow.setResizable(true);
  if (edge === 'right') {
    taskCenterWindow.setBounds({ x: area.x + area.width - TC_STRIP_W, y, width: TC_STRIP_W, height: h });
  } else {
    taskCenterWindow.setBounds({ x: area.x, y, width: TC_STRIP_W, height: h });
  }
  taskCenterWindow.setResizable(false);
});

ipcMain.on('taskcenter:expand-from-edge', (event, edge, width, height) => {
  if (!taskCenterWindow || taskCenterWindow.isDestroyed()) return;
  if (!['left', 'right'].includes(edge)
    || [width, height].some(value => value !== undefined && (!Number.isFinite(value) || value < 1))) return;
  const area = workArea(taskCenterWindow);
  const b = taskCenterWindow.getBounds();
  const w = Math.min(Math.round(width || 320), area.width);
  const h = Math.min(Math.round(height || 480), area.height);
  const y = Math.max(area.y, Math.min(b.y, area.y + area.height - h));
  taskCenterWindow.setResizable(true);
  if (edge === 'right') {
    taskCenterWindow.setBounds({ x: area.x + area.width - w, y, width: w, height: h });
  } else {
    taskCenterWindow.setBounds({ x: area.x, y, width: w, height: h });
  }
  taskCenterWindow.setResizable(false);
});

ipcMain.on('taskcenter:check-snap', (event) => {
  if (!taskCenterWindow || taskCenterWindow.isDestroyed()) { event.returnValue = null; return; }
  const [x] = taskCenterWindow.getPosition();
  const b = taskCenterWindow.getBounds();
  const area = workArea(taskCenterWindow);
  if (x <= area.x + SNAP_THRESHOLD) {
    event.returnValue = 'left';
  } else if (x + b.width >= area.x + area.width - SNAP_THRESHOLD) {
    event.returnValue = 'right';
  } else {
    event.returnValue = null;
  }
});

// Only the main process owns reminders: every decision and button action reads
// the latest snapshot, commits before display, then broadcasts the saved result.
function deferReminderEvaluation() {
  if (app.isQuitting || reminderTick !== null) return;
  reminderTick = setTimeout(() => { reminderTick = null; evaluateReminder(); }, 0);
}

function evaluateReminder() {
  if (app.isQuitting) return;
  try {
    const saved = readState(STORE_FILE);
    if (!saved) return;
    const state = JSON.parse(saved), now = new Date();
    let next = reconcileReminder(state, now);
    // A card displayed by a previous process is not announced again. Its
    // persisted daily quota and last-reminded time still enforce the cooldown.
    if (!reminderInitialized && next.proactive?.active) next = { ...next, proactive: { ...next.proactive, active: undefined } };
    const eligible = ballReady && ballWindow && !ballWindow.isDestroyed() && ballWindow.isVisible()
      && !ballChatExpanded && !dragState.has(ballWindow.id) && !screenLocked && !systemSuspended;
    if (eligible) next = planReminder(next, now);
    let committed = state;
    if (!isDeepStrictEqual(state, next)) {
      const result = writeState(STORE_FILE, JSON.stringify(next), { now });
      committed = JSON.parse(result);
      broadcastState(result);
    }
    reminderInitialized = true;
    syncBallPresentation(committed);
  } catch (error) {
    // Never show an uncommitted reminder or silently spend an unpersisted quota.
    console.error('[reminder] Evaluation failed:', error.message);
  }
}

function cancelVisibleReminder() {
  // Lock/suspend may swallow the renderer's mouseup event. Do not leave a
  // permanent dragging flag that blocks later reminders after unlock/resume.
  dragState.clear();
  reminderExpandedId = null;
  if (ballMode === 'reminder' || ballMode === 'nudge') resizeBall('ball');
  try {
    const saved = readState(STORE_FILE);
    if (!saved) return;
    const state = JSON.parse(saved);
    if (!state.proactive?.active) return;
    const result = writeState(STORE_FILE, JSON.stringify({ ...state, proactive: { ...state.proactive, active: undefined } }));
    broadcastState(result);
  } catch (error) { console.error('[reminder] Unable to dismiss on lock/suspend:', error.message); }
}

ipcMain.on('proactive:action', (event, id, action, progress) => {
  if (!ballWindow || event.sender !== ballWindow.webContents
    || (event.senderFrame && event.senderFrame !== ballWindow.webContents.mainFrame)) {
    event.returnValue = { ok: false, error: '此操作仅能在桌宠提醒卡片中执行。' };
    return;
  }
  try {
    const saved = readState(STORE_FILE);
    if (!saved) throw new Error('没有可用的提醒数据。');
    const current = JSON.parse(saved), active = current.proactive?.active, now = new Date();
    const next = applyReminderAction(current, id, action, progress, now);
    const result = writeState(STORE_FILE, JSON.stringify(next), { now });
    const committed = JSON.parse(result);
    if (action === 'help') ballChatExpanded = true;
    broadcastState(result);
    syncBallPresentation(committed);
    if (action === 'help') {
      const task = current.tasks.find(item => item.id === active.taskId);
      ballWindow.webContents.send('reminder:help', {
        prompt: `我在任务“${task.name}”（日期：${task.date}，当前进度：${task.progress}%）上有点卡住了。请先安抚我，帮我拆出一个可完成的小步骤；先给建议，不要直接添加或修改任务。`,
      });
    }
    event.returnValue = { ok: true };
    deferReminderEvaluation();
  } catch (error) {
    event.returnValue = { ok: false, error: error.message || '提醒操作失败，请重试。' };
  }
});

function startReminderScheduler() {
  try { screenLocked = powerMonitor.getSystemIdleState(1) === 'locked'; } catch { screenLocked = false; }
  powerMonitor.on('lock-screen', () => { screenLocked = true; cancelVisibleReminder(); });
  powerMonitor.on('unlock-screen', () => { screenLocked = false; deferReminderEvaluation(); });
  powerMonitor.on('suspend', () => { systemSuspended = true; cancelVisibleReminder(); });
  powerMonitor.on('resume', () => { systemSuspended = false; deferReminderEvaluation(); });
  reminderTimer = setInterval(evaluateReminder, 30000);
  deferReminderEvaluation();
}

function createTray() {
  // Generate a 32x32 blue gradient circle tray icon
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const cx = 15.5, cy = 15.5, r = 14;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= r + 0.8) {
        // 135deg linear gradient (top-left → bottom-right), matching floating ball CSS
        const t = (x + y) / (2 * (size - 1)); // 0=top-left, 1=bottom-right
        // #2563eb → #3b82f6 → #60a5fa (BGRA order)
        buf[i] = Math.round(235 + (250 - 235) * t); // B
        buf[i + 1] = Math.round(99 + (165 - 99) * t); // G
        buf[i + 2] = Math.round(37 + (96 - 37) * t); // R
        buf[i + 3] = dist <= r ? 255 : Math.round(255 * Math.max(0, 1 - (dist - r) / 0.8));
      }
    }
  }
  const icon = nativeImage.createFromBitmap(buf, { width: size, height: size }).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('TaskAgent');
  const trayMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setContextMenu(trayMenu);
  tray.on('double-click', showMainWindow);
}

// ─── App lifecycle ───────────────────────────────────────────────────────────
app.on('before-quit', () => {
  app.isQuitting = true;
  clearInterval(reminderTimer); reminderTimer = null;
  clearTimeout(reminderTick); reminderTick = null;
  for (const timer of animations.values()) clearTimeout(timer);
  animations.clear();
});
app.on('activate', () => { if (app.isReady()) showMainWindow(); });
app.on('window-all-closed', () => { if (!tray) app.quit(); });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.whenReady().then(() => {
    try { createTray(); }
    catch (error) { tray = null; console.error('[tray] Unable to create tray:', error.message); }
    createMainWindow();
    createBallWindow();
    createTaskCenterWindow();
    startReminderScheduler();
  }).catch(error => {
    console.error('[app] Startup failed:', error.message);
    app.quit();
  });
}
