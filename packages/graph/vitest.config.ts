import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'graph',
    include: ['src/**/*.test.ts'],
  },
});
