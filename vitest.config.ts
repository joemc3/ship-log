import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Two Vitest projects under one run (`npm test`):
 *  - "server": the existing data + server suites, node environment (unchanged).
 *  - "ui": the SPA suite, jsdom environment with @testing-library + jest-dom.
 * Splitting by project keeps the node tests in a node environment while the UI
 * tests get a DOM, so neither leaks globals into the other.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'ui',
          include: ['src/ui/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/ui/test/setup.ts'],
        },
      },
    ],
  },
});
