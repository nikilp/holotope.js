import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Point at package sources so the example runs without a prior build step.
    alias: {
      '@holotope/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@holotope/three': fileURLToPath(new URL('../../packages/three/src/index.ts', import.meta.url))
    }
  }
});
