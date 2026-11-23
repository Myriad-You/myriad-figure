import process from 'node:process'
import { defineConfig } from '@playwright/test'

const port = Number(process.env.FIGURE_BROWSER_TEST_PORT || 4189)
const engines = (process.env.FIGURE_BROWSER_ENGINES || 'chromium').split(',').map((name) => {
  const engine = (['chromium', 'firefox', 'webkit'] as const).find(known => known === name.trim())
  if (!engine) throw new Error(`FIGURE_BROWSER_ENGINES: no engine "${name}"`)
  return engine
})

export default defineConfig({
  testDir: './tests/browser',
  outputDir: `test-results/browser-${port}`,
  testMatch: '*.spec.ts',
  timeout: 25_000,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: engines.map(browserName => ({
    name: browserName,
    use: {
      browserName,
      // Only Chromium ships in channels (`chrome`, `msedge`).
      channel: browserName === 'chromium' ? process.env.FIGURE_BROWSER_CHANNEL || undefined : undefined,
    },
  })),
  webServer: {
    command: `node node_modules/vite/bin/vite.js --config tests/browser/vite.config.ts --port ${port}`,
    url: `http://127.0.0.1:${port}/rigImport.html`,
    reuseExistingServer: false,
  },
})
