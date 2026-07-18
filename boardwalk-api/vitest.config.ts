import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // better-sqlite3 is synchronous and in-memory here, so the default timeout is plenty.
    environment: 'node',
  },
});
