import { defineConfig } from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  base: './',
  server: { proxy: { '/ws': { target: 'ws://127.0.0.1:3000', ws: true }, '/api': 'http://127.0.0.1:3000' } },
  build: { target: 'es2022', chunkSizeWarningLimit: 900, copyPublicDir:process.env.DUSTII_REVIEW_BUILD!=='1', rolldownOptions:{input:{main:fileURLToPath(new URL('./index.html',import.meta.url)),private:fileURLToPath(new URL('./private.html',import.meta.url))}} }
});
