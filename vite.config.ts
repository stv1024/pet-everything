import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true, port: 5188, strictPort: true },
  preview: { port: 5189 },
});
