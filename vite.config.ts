import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// MV3 extension pages: no inline scripts (CSP), stable name for the
// background entry so manifest.json can reference it.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Unminified on purpose: AMO reviewers can read the shipped code directly,
    // so no separate source-code submission is required.
    minify: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        app: r('app.html'),
        popup: r('popup.html'),
        background: r('src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
})
