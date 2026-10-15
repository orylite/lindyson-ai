import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/fullstack',
  timeout: 100_000,
  expect: { timeout: 10_000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8080',
    channel: 'chrome',
    launchOptions: {
      args: [
        '--host-resolver-rules=MAP com.localhost 127.0.0.1,MAP cn.localhost 127.0.0.1',
      ],
    },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'fullstack-chrome', use: { ...devices['Desktop Chrome'] } }],
});
