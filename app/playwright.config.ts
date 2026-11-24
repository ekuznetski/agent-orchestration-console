import { defineConfig, devices } from '@playwright/test'
import type { ConsoleOptions } from './e2e/fixtures.ts'

// e2e always starts its own server from this checkout, on a port of its own (5298 unless E2E_PORT is set), so
// it never tests whatever another checkout or a dev server happens to serve.
const port = Number(process.env.E2E_PORT ?? 5298)

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
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [
    // The suite without the mock's timing jitter (pnpm e2e) and with it (pnpm e2e:jitter).
    { name: 'chromium', use: { ...devices['Desktop Chrome'], jitter: false } },
    { name: 'chromium-jitter', use: { ...devices['Desktop Chrome'], jitter: true } },
  ],
  webServer: {
    command: `pnpm dev --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
})
