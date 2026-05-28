import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'bkt',
    include: ['src/**/*.test.ts'],
  },
});
