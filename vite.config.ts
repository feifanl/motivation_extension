import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;

export default defineConfig({
  base: './',
  server: envPort ? { port: envPort, strictPort: true } : undefined,
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: {
        newtab: resolve(__dirname, 'newtab.html'),
      },
    },
  },
});
