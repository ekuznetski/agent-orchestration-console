import { defineConfig, devices } from '@playwright/test'
import type { ConsoleOptions } from './e2e/fixtures.ts'

// https://playwright.dev/docs/test-configuration
export default defineConfig<ConsoleOptions>({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5297',
    trace: 'on-first-retry',
  },
  projects: [
    // The whole suite runs twice: without and with the mock's timing jitter.
    { name: 'chromium', use: { ...devices['Desktop Chrome'], jitter: false } },
    { name: 'chromium-jitter', use: { ...devices['Desktop Chrome'], jitter: true } },
  ],
  webServer: {
    command: 'pnpm dev --port 5297 --strictPort',
    url: 'http://localhost:5297',
    reuseExistingServer: !process.env.CI,
  },
})
