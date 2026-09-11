const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Prevent zoom changes (fixes the "content enlarging" bug)
webFrame.setZoomFactor(1);
webFrame.setZoomLevel(0);

contextBridge.exposeInMainWorld('electronAPI', {
  // App
  updateBall: (enabled) => ipcRenderer.send('app:update-ball', enabled),
  updateTaskCenter: (enabled) => ipcRenderer.send('app:update-taskcenter', enabled),

  // Ball
  ballExpand: () => ipcRenderer.send('ball:expand'),
  ballCollapse: () => ipcRenderer.send('ball:collapse'),
  ballCheckSnap: () => ipcRenderer.sendSync('ball:check-snap'),
  ballReady: () => ipcRenderer.send('ball:ready'),
  reminderAction: (id, action, progress) => ipcRenderer.sendSync('proactive:action', id, action, progress),
  onReminderHelp: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('reminder:help', listener);
    return () => ipcRenderer.removeListener('reminder:help', listener);
  },

  // Window
  windowMove: (dx, dy) => ipcRenderer.send('window:move', dx, dy),
  windowDragStart: () => ipcRenderer.send('window:drag-start'),
  windowDragTo: (x, y) => ipcRenderer.send('window:drag-to', x, y),
  windowDragEnd: () => ipcRenderer.send('window:drag-end'),
  windowGetPosition: () => ipcRenderer.sendSync('window:get-position'),
  windowGetBounds: () => ipcRenderer.sendSync('window:get-bounds'),
  windowSetBounds: (b) => ipcRenderer.send('window:set-bounds', b),

  // Screen
  screenGetWorkArea: () => ipcRenderer.sendSync('screen:get-work-area'),

  // Task center
  taskCenterSnapToEdge: (edge, height) => ipcRenderer.send('taskcenter:snap-to-edge', edge, height),
  taskCenterExpandFromEdge: (edge, width, height) => ipcRenderer.send('taskcenter:expand-from-edge', edge, width, height),
  taskCenterCheckSnap: () => ipcRenderer.sendSync('taskcenter:check-snap'),
  onTaskCenterAutoSnap: (callback) => {
    const listener = (_, edge) => callback(edge);
    ipcRenderer.on('taskcenter:auto-snap', listener);
    return () => ipcRenderer.removeListener('taskcenter:auto-snap', listener);
  },

  // Persistent store
  storeGet: () => {
    const result = ipcRenderer.sendSync('store:get');
    if (result && typeof result === 'object') throw new Error(result.error || '无法读取本地数据');
    return result;
  },
  storeSet: (data) => ipcRenderer.sendSync('store:set', data),
  storeCommit: (data, base, guard) => ipcRenderer.sendSync('store:commit', data, base, guard),
  onStoreChanged: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('store:changed', listener);
    return () => ipcRenderer.removeListener('store:changed', listener);
  },

  // Data export/import
  dataExport: (password) => ipcRenderer.invoke('data:export', password),
  dataImport: (password) => ipcRenderer.invoke('data:import', password),
});

window.onerror = (message, source, lineno, colno, error) => {
  ipcRenderer.send('log-error', `[Window Error] ${message} at ${source}:${lineno}:${colno}\n${error?.stack}`);
};
const originalConsoleError = console.error;
console.error = (...args) => {
  const message = args.map(value => {
    if (value instanceof Error) return value.stack || value.message;
    try { return typeof value === 'object' ? JSON.stringify(value) : String(value); }
    catch { return '[unserializable error]'; }
  }).join(' ');
  ipcRenderer.send('log-error', `[Console Error] ${message}`);
  originalConsoleError.apply(console, args);
};
