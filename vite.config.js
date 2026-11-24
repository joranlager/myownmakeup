import { defineConfig } from 'vite';

// BASE_PATH is set by the GitHub Pages workflow, e.g. "/myownmakeup/" for main
// or "/myownmakeup/branches/feature-x/" for other branches.
export default defineConfig({
  base: process.env.BASE_PATH || './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { host: true },
});
