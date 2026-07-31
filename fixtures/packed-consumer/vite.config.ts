import { defineConfig } from 'vite';

/**
 * No aliases, no externals, no plugins.
 *
 * The point of this build is that the published dependency graph bundles on
 * its own. Every knob that could paper over a packaging defect is deliberately
 * absent, so a failure here is a real failure.
 */
export default defineConfig({
  build: { target: 'es2022' }
});
