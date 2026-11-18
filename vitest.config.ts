import { defineConfig } from 'vitest/config'

// Node for packages and main-process logic; jsdom for renderer components.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'node', environment: 'node', include: ['packages/*/src/**/*.test.ts', 'apps/desktop/src/main/**/*.test.ts'] } },
      { test: { name: 'renderer', environment: 'jsdom', include: ['apps/desktop/src/renderer/**/*.test.{ts,tsx}'] } }
    ]
  }
})
