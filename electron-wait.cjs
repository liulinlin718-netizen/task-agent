// Wait for Vite to be ready, then launch Electron
const http = require('http');
const { execSync } = require('child_process');

function checkServer(retries = 30) {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:3000', (res) => {
      resolve();
    });
    req.on('error', () => {
      if (retries > 0) {
        setTimeout(() => checkServer(retries - 1).then(resolve).catch(reject), 500);
      } else {
        reject(new Error('Vite server did not start'));
      }
    });
    req.setTimeout(2000, () => {
      req.destroy();
      if (retries > 0) {
        setTimeout(() => checkServer(retries - 1).then(resolve).catch(reject), 500);
      } else {
        reject(new Error('Vite server timeout'));
      }
    });
  });
}

checkServer().then(() => {
  console.log('[electron-wait] Vite is ready, launching Electron...');
  execSync('npx electron .', { stdio: 'inherit', cwd: __dirname });
}).catch((err) => {
  console.error('[electron-wait] Failed:', err.message);
  process.exit(1);
});
