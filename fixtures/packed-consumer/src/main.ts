/**
 * Headless entry point for the isolated consumer.
 *
 * Runs each check in order and exits non-zero on the first failure, so the
 * verifier reads a process status rather than parsing prose.
 */
import {
  authoredDimensionBridge,
  featurePairContact,
  laggedPairFriction,
  certifiedConvexQuery,
  convexHullContact,
  barrierOrderGuard,
  exactPointSimplexQuery,
  dimensionGenericSection,
  experimentProbe,
  geometryComposition,
  planeEmbeddingComposition,
  sectionChartRender,
  hyperrectangleComposition,
  physicsComposition,
  representationClaims,
  slipVelocityRegularization,
  stationarityCriterion
} from './checks.js';

const checks: readonly [name: string, run: () => void | Promise<void>][] = [
  ['certifiedConvexQuery', certifiedConvexQuery],
  ['barrierOrderGuard', barrierOrderGuard],
  ['exactPointSimplexQuery', exactPointSimplexQuery],
  ['convexHullContact', convexHullContact],
  ['geometryComposition', geometryComposition],
  ['dimensionGenericSection', dimensionGenericSection],
  ['sectionChartRender', sectionChartRender],
  ['planeEmbeddingComposition', planeEmbeddingComposition],
  ['authoredDimensionBridge', authoredDimensionBridge],
  ['featurePairContact', featurePairContact],
  ['laggedPairFriction', laggedPairFriction],
  ['slipVelocityRegularization', slipVelocityRegularization],
  ['stationarityCriterion', stationarityCriterion],
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
