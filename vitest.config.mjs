import { defineConfig } from 'vitest/config'

// One runner, three layers: `unit` is pure functions, `audit` builds the client bundle and drives
// jsdom or a real browser, `compat` exercises installer and Host-contract logic without a network.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      { test: { name: 'audit', include: ['tests/audit/**/*.test.mjs'], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false } },
      { test: { name: 'compat', include: ['tests/compat/**/*.test.mjs'], testTimeout: 120_000, hookTimeout: 120_000 } },
    ],
  },
})
