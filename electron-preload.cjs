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
  onTaskCenterAutoSnap: (callback) => ipcRenderer.on('taskcenter:auto-snap', (_, edge) => callback(edge)),
});

window.onerror = (message, source, lineno, colno, error) => {
  ipcRenderer.send('log-error', `[Window Error] ${message} at ${source}:${lineno}:${colno}\n${error?.stack}`);
};
const originalConsoleError = console.error;
console.error = (...args) => {
  ipcRenderer.send('log-error', `[Console Error] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`);
  originalConsoleError.apply(console, args);
};
