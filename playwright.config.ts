import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  webServer: process.env.TASKAGENT_E2E_EXECUTABLE ? undefined : { command: 'npm run dev', url: 'http://127.0.0.1:3000', reuseExistingServer: false, timeout: 30_000 },
});
