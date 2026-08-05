/**
 * Headless entry point for the isolated consumer.
 *
 * Runs each check in order and exits non-zero on the first failure, so the
 * verifier reads a process status rather than parsing prose.
 */
import {
  certifiedConvexQuery,
  convexHullContact,
  experimentProbe,
  geometryComposition,
  hyperrectangleComposition,
  physicsComposition,
  representationClaims
} from './checks.js';

const checks: readonly [name: string, run: () => void | Promise<void>][] = [
  ['certifiedConvexQuery', certifiedConvexQuery],
  ['convexHullContact', convexHullContact],
  ['geometryComposition', geometryComposition],
  ['representationClaims', representationClaims],
  ['experimentProbe', experimentProbe],
  ['physicsComposition', physicsComposition],
  ['hyperrectangleComposition', hyperrectangleComposition]
];

for (const [name, run] of checks) {
  await run();
  console.log(`ok  ${name}`);
}
console.log(`\n${checks.length} headless check(s) passed.`);
