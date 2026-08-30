import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  use: {
    baseURL: process.env.CALLSCOPE_BASE_URL || 'http://127.0.0.1:4173/',
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.CALLSCOPE_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
        timeout: 30_000,
      },
})
