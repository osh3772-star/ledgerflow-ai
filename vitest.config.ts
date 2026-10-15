import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 90_000,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
