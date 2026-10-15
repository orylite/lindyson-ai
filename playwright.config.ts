import { defineConfig,devices } from '@playwright/test';

const e2ePort = Number(process.env.E2E_PORT ?? 5177);
const baseURL = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${e2ePort} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
