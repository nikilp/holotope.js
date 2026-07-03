import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works at any mount path (GitHub Pages
  // serves it under /holotope.js/).
  base: './',
  resolve: {
    // Point at package sources so the showcase runs without a prior build step.
    alias: {
      '@holotope/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@holotope/three': fileURLToPath(new URL('../../packages/three/src/index.ts', import.meta.url))
    }
  },
  build: {
    rollupOptions: {
      // Multi-page app: the gallery landing page plus one page per example.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        tesseract: fileURLToPath(new URL('./tesseract.html', import.meta.url)),
        polychora: fileURLToPath(new URL('./polychora.html', import.meta.url))
      }
    }
  }
});
