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
    // Examples are included so a demo can land tests beside its code and have
    // them run. Nothing under `examples/` defines a test today, which is why
    // this is the moment to add the path: closing the trap costs nothing now,
    // and closing it later means discovering that a demo's tests were never in
    // CI at the point someone relied on them.
    include: [
      'packages/*/test/**/*.test.ts',
      'examples/*/test/**/*.test.ts'
    ]
  }
});
