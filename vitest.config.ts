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
    // The public suite contains several synchronous, CPU-heavy geometry
    // differentials.  On GitHub's runner the auto-sized fork pool twice
    // completed all 1,780 assertions and then timed out worker `onTaskUpdate`
    // RPCs. Two workers leave capacity for the reporter process without
    // skipping, sharding, or weakening any test, and keep the local
    // `pnpm test` command identical to CI.
    maxWorkers: 2,
    // Examples are included so a demo can land tests beside its code and have
    // them run. Nothing under `examples/` defines a test today, which is why
    // this is the moment to add the path: closing the trap costs nothing now,
    // and closing it later means discovering that a demo's tests were never in
    // CI at the point someone relied on them.
    include: [
      'packages/*/test/**/*.test.ts',
      'examples/*/test/**/*.test.ts',
      // The release verifier's judgements are ordinary code and are tested
      // like it, against synthetic manifests rather than five real installs.
      'scripts/test/**/*.test.ts'
    ]
  }
});
