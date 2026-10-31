import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const port = Number(process.env.FIGURE_BROWSER_TEST_PORT || 4189)

// Test pages for the figure alone: no site, no backend. Every request a page
// makes outside this server is the test's to mock.
export default defineConfig({
  root: fileURLToPath(new URL('./fixture', import.meta.url)),
  cacheDir: fileURLToPath(new URL(`../../node_modules/.vite/browser-tests-${port}`, import.meta.url)),
  build: { target: 'es2025' },
  server: {
    hmr: false,
    host: '127.0.0.1',
    port,
    strictPort: true,
    fs: {
      allow: [fileURLToPath(new URL('../..', import.meta.url))],
    },
  },
})
