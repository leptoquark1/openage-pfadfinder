import { defineConfig } from 'vitest/config';

// Standalone so Vitest does not load vite.config.ts (app plugins, Pages base).
// Timing-sensitive *.bench.ts files are excluded; see vitest.perf.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
