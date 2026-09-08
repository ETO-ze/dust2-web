import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { proxy: { '/ws': { target: 'ws://127.0.0.1:3000', ws: true }, '/api': 'http://127.0.0.1:3000' } },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 }
});
