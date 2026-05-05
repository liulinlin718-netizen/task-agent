process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let ballWindow = null;
let taskCenterWindow = null;
let tray = null;

const BALL_POS_FILE = path.join(app.getPath('userData'), 'ball-position.json');

const isDev = !app.isPackaged;
const VITE_DEV_URL = 'http://localhost:3000';
const SNAP_THRESHOLD = 50;
const TC_STRIP_W = 6;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, zoomFactor: 1,
    },
    show: true,
    backgroundColor: '#ffffff', // Prevents transparent flash before React renders
  });
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }
  mainWindow.on('close', (e) => {
    // Hide instead of quit — tray keeps the app alive
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createBallWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  // Restore saved position or use default
  let bx = sw - 80, by = sh - 200;
  try {
    const saved = JSON.parse(fs.readFileSync(BALL_POS_FILE, 'utf-8'));
    if (typeof saved.x === 'number' && typeof saved.y === 'number') { bx = saved.x; by = saved.y; }
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
  // ballWindow.webContents.openDevTools({ mode: 'detach' });
  if (isDev) {
    ballWindow.loadURL(`${VITE_DEV_URL}?window=ball`);
  } else {
    ballWindow.loadFile(path.join(__dirname, 'dist/index.html'), { query: { window: 'ball' } });
  }
  // ballWindow.once('ready-to-show', () => ballWindow.show());

  ballWindow.on('closed', () => { ballWindow = null; });
}

function createTaskCenterWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  taskCenterWindow = new BrowserWindow({
    width: 320, height: 480, x: sw - 360, y: Math.round((sh - 480) / 2),
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, zoomFactor: 1,
    },
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, skipTaskbar: true, hasShadow: false, show: false,
  });
  // taskCenterWindow.webContents.openDevTools({ mode: 'detach' });
  if (isDev) {
    taskCenterWindow.loadURL(`${VITE_DEV_URL}?window=taskcenter`);
  } else {
    taskCenterWindow.loadFile(path.join(__dirname, 'dist/index.html'), { query: { window: 'taskcenter' } });
  }
  // taskCenterWindow.once('ready-to-show', () => taskCenterWindow.show());

  taskCenterWindow.on('closed', () => { taskCenterWindow = null; });
}

// ─── Generic IPC ─────────────────────────────────────────────────────────────
ipcMain.on('log-error', (event, err) => {
  console.log('\x1b[31m%s\x1b[0m', err);
});

let prevBallVisible = false;

ipcMain.on('app:update-ball', (event, enabled) => {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  if (!ballWindow || ballWindow.isDestroyed()) return;
  if (enabled && !prevBallVisible) {
    ballWindow.setBounds({ x: sw - 80, y: sh - 200, width: 48, height: 48 });
    ballWindow.setResizable(false);
    ballWindow.showInactive();
  } else if (enabled) {
    ballWindow.showInactive();
  } else {
    ballWindow.hide();
  }
  prevBallVisible = enabled;
});

let prevTcVisible = false;

ipcMain.on('app:update-taskcenter', (event, enabled) => {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  if (!taskCenterWindow || taskCenterWindow.isDestroyed()) return;
  if (enabled && !prevTcVisible) {
    taskCenterWindow.setResizable(true);
    taskCenterWindow.setBounds({ x: sw - 360, y: Math.round((sh - 480) / 2), width: 320, height: 480 });
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
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    const [x, y] = win.getPosition();
    win.setPosition(x + Math.round(dx), y + Math.round(dy));
  }
});

const dragState = new Map();

ipcMain.on('window:drag-start', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    dragState.set(win.id, win.getBounds());
  }
});

ipcMain.on('window:drag-to', (event, x, y) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    const b = dragState.get(win.id);
    if (b) {
      win.setBounds({ x: Math.round(x), y: Math.round(y), width: b.width, height: b.height });
    } else {
      win.setPosition(Math.round(x), Math.round(y));
    }
  }
});

ipcMain.on('window:drag-end', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) dragState.delete(win.id);
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
  event.returnValue = screen.getPrimaryDisplay().workAreaSize;
});

let ballExpandOffset = { x: 380 - 48, y: 520 - 48 };

ipcMain.on('ball:expand', () => {
  if (!ballWindow || ballWindow.isDestroyed()) return;
  const [cx, cy] = ballWindow.getPosition();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  let newX = cx - (380 - 48);
  let newY = cy - (520 - 48);

  if (cx < 380 / 2) newX = cx;
  if (cy < 520 / 2) newY = cy;

  if (newX + 380 > sw) newX = sw - 380;
  if (newY + 520 > sh) newY = sh - 520;
  if (newX < 0) newX = 0;
  if (newY < 0) newY = 0;

  ballExpandOffset = { x: cx - newX, y: cy - newY };

  ballWindow.setResizable(true);
  ballWindow.setBounds({ x: newX, y: newY, width: 380, height: 520 });
});

ipcMain.on('ball:collapse', () => {
  if (!ballWindow || ballWindow.isDestroyed()) return;
  const b = ballWindow.getBounds();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  let bx = b.x + ballExpandOffset.x;
  let by = b.y + ballExpandOffset.y;

  if (bx + 48 > sw) bx = sw - 48;
  if (by + 48 > sh) by = sh - 48;
  if (bx < 0) bx = 0;
  if (by < 0) by = 0;

  ballWindow.setBounds({ x: bx, y: by, width: 48, height: 48 });
  ballWindow.setResizable(false);
  // Persist position
  try { fs.writeFileSync(BALL_POS_FILE, JSON.stringify({ x: bx, y: by })); } catch { }
});

ipcMain.on('ball:check-snap', (event) => {
  if (!ballWindow || ballWindow.isDestroyed()) { event.returnValue = null; return; }
  const [x] = ballWindow.getPosition();
  const b = ballWindow.getBounds();
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;

  const BALL_MARGIN = 0; // Fixed distance from edge
  const center = x + b.width / 2;
  const SNAP_DIST = 100;

  if (center <= SNAP_DIST) {
    ballWindow.setPosition(BALL_MARGIN, b.y);
    event.returnValue = 'left';
  } else if (sw - center <= SNAP_DIST) {
    ballWindow.setPosition(sw - b.width - BALL_MARGIN, b.y);
    event.returnValue = 'right';
  } else {
    event.returnValue = null;
  }
});

// ─── Task Center IPC ─────────────────────────────────────────────────────────
ipcMain.on('taskcenter:snap-to-edge', (event, edge, height) => {
  if (!taskCenterWindow || taskCenterWindow.isDestroyed()) return;
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const b = taskCenterWindow.getBounds();
  const h = height || b.height;
  taskCenterWindow.setResizable(true);
  if (edge === 'right') {
    taskCenterWindow.setBounds({ x: sw - TC_STRIP_W, y: b.y, width: TC_STRIP_W, height: h });
  } else {
    taskCenterWindow.setBounds({ x: 0, y: b.y, width: TC_STRIP_W, height: h });
  }
  taskCenterWindow.setResizable(false);
});

ipcMain.on('taskcenter:expand-from-edge', (event, edge, width, height) => {
  if (!taskCenterWindow || taskCenterWindow.isDestroyed()) return;
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  const b = taskCenterWindow.getBounds();
  const w = width || 320;
  const h = height || 480;
  taskCenterWindow.setResizable(true);
  if (edge === 'right') {
    taskCenterWindow.setBounds({ x: sw - w, y: b.y, width: w, height: h });
  } else {
    taskCenterWindow.setBounds({ x: 0, y: b.y, width: w, height: h });
  }
  taskCenterWindow.setResizable(false);
});

ipcMain.on('taskcenter:check-snap', (event) => {
  if (!taskCenterWindow || taskCenterWindow.isDestroyed()) { event.returnValue = null; return; }
  const [x] = taskCenterWindow.getPosition();
  const b = taskCenterWindow.getBounds();
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
  if (x <= SNAP_THRESHOLD) {
    event.returnValue = 'left';
  } else if (x + b.width >= sw - SNAP_THRESHOLD) {
    event.returnValue = 'right';
  } else {
    event.returnValue = null;
  }
});

// ─── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMainWindow();
  createBallWindow();
  createTaskCenterWindow();

  // System tray
  // Generate a 32x32 blue gradient circle tray icon
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const cx = 15.5, cy = 15.5, r = 14;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= r + 0.8) {
        const t = Math.min(dist / r, 1);
        // Match floating ball: #2563eb → #3b82f6 → #60a5fa (BGRA order)
        buf[i]   = Math.round(235 + (250 - 235) * t); // B: 0xeb→0xfa
        buf[i+1] = Math.round(99  + (165 - 99)  * t); // G: 0x63→0xa5
        buf[i+2] = Math.round(37  + (96  - 37)  * t); // R: 0x25→0x60
        buf[i+3] = dist <= r ? 255 : Math.round(255 * Math.max(0, 1 - (dist - r) / 0.8));
      }
    }
  }
  const icon = nativeImage.createFromBuffer(buf, { width: size, height: size });
  tray = new Tray(icon);
  tray.setToolTip('TaskAgent');
  const trayMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(trayMenu);
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
});
app.on('window-all-closed', () => { /* keep running, tray is alive */ });
