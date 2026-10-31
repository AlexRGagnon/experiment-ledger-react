import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8797',
    browserName: 'chromium',
    channel:
      process.env.LEDGER_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined),
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:8797/health',
    reuseExistingServer: false,
    timeout: 30000,
    env: { LEDGER_PORT: '8797', LEDGER_DB: `.e2e/test-${Date.now()}-${process.pid}.sqlite` },
  },
});
