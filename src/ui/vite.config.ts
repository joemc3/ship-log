import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * SPA build/dev config. Root is this src/ui dir (so index.html + main.tsx are
 * the entry); the bundle is emitted to <repo>/dist/ui. In dev (`npm run dev:ui`)
 * the server proxies /api, /photos, and /files to the Express server on :8080,
 * so the SPA runs against the real API in demo mode. The Express app serves
 * dist/ui in P2.
 */
export default defineConfig({
  root: here,
  base: '/',
  plugins: [react()],
  build: {
    outDir: resolve(here, '../../dist/ui'),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/photos': { target: 'http://localhost:8080', changeOrigin: true },
      '/files': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
