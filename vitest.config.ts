import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@holotope/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@holotope/three': fileURLToPath(new URL('./packages/three/src/index.ts', import.meta.url))
    }
  },
  test: {
    include: ['packages/*/test/**/*.test.ts']
  }
});
