import { defineConfig } from 'vitest/config';

// Timing-sensitive demo benchmarks, excluded from the default suite
// (see tests/*.bench.ts). Run with: pnpm test:perf
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.bench.ts'],
  },
});
