const http = require('node:http');
const { spawn } = require('node:child_process');

function probeServer(url, timeout = 2000) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeout, () => req.destroy(new Error('Server timeout')));
  });
}

async function waitForServer(url = 'http://localhost:3000', attempts = 60, interval = 500) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await probeServer(url)) return;
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Vite server did not become ready');
}

async function launch() {
  await waitForServer();
  console.log('[electron-wait] Vite is ready, launching Electron...');
  // Use the installed executable directly; npx can download unexpectedly and
  // execSync prevents the parent from forwarding termination cleanly.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['.'], { stdio: 'inherit', cwd: __dirname, env });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  child.once('error', error => { console.error('[electron-wait]', error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}

if (require.main === module) {
  launch().catch(error => { console.error('[electron-wait]', error.message); process.exitCode = 1; });
}

module.exports = { probeServer, waitForServer };
