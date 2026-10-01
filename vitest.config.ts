import { defineConfig } from 'vitest/config'

/* Unit tests cover the browser-API-free logic under src/shared/.
   Everything else in the extension talks to `browser.*` and is verified by hand
   against a real profile — so coverage is measured against src/shared only,
   where a threshold is meaningful rather than aspirational. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts'],
      exclude: ['src/shared/**/*.test.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
})
