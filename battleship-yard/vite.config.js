import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000, assetsInlineLimit: 0 },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5173 },
});
