import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests share one Postgres database, so they must not interleave.
    fileParallelism: false,
    setupFiles: ['src/test/setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
