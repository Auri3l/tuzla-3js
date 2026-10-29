import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the build works under any sub-path (e.g. GitHub Pages)
  base: './',
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true }
});
