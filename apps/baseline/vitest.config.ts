import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'baseline',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
