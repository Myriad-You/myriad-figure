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
  // The render layer is served as its own source files, as the site's dev server does: failure probes read its
  // files on the stack, and a dependency optimized mid-run would reload the page and the import Worker under a test.
  optimizeDeps: { exclude: ['@myriad/figure-player'] },
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
