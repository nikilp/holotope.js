/**
 * The headless conformance checks, run inside the isolated consumer.
 *
 * Each one composes published packages the way an outside caller would, and
 * throws on the first violated claim. The verifier runs this file with `node`
 * after a strict typecheck; a thrown error is the failure signal.
 */
import { LineBasicMaterial, PerspectiveCamera, Raycaster, Vector2, Vector3, type Intersection } from 'three';
import {
  BivectorN,
  CellComplex,
  HyperplaneSliceN,
  PerspectiveProjection,
  PlaneEmbedding3D,
  planeEmbeddingMapRecipe3,
  Rotor4,
  TransformN,
  VecN,
  cellComplexBoundsAlongAxisN,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  createHypercube,
  createSimplex,
  createHyperrectangle,
  cuboidCellFacetN,
  describeRepresentationHitN,
  rotorIdentityResidual,
  sectionSimplexGroupN,
  tetrahedralizeCuboidCells,
  type CellGroup,
  type DisplayMap3D,
  type DisplayMapInverse3D,
  type HyperplaneSliceNOptions,
  type PlaneEmbeddingMapRecipe3,
  type SectionSimplexGroupNDiagnosticsN,
  type SectionSimplexGroupNOptions,
  type SectionSimplexGroupNResultN,
  type SourceAffineLineageN
} from '@holotope/core';
import {
  ProjectedEdges3D,
  SectionChart3D,
  representationHitFromProjectedEdge,
  representationHitFromProjectedSurface,
  representationHitFromSectionChart,
  representationHitFromSlicedComplex,
  type SectionChart3DOptions
} from '@holotope/three';
import {
  ConvexHullSupportShapeN,
  PhysicsWorld4,
  XpbdSourceSimplexPairBarrierN,
  XpbdSourceSimplexPairBarrierStepFilterN,
  XpbdPreparedSourceSimplexPairFrictionN,
  XpbdSourceSimplexPairFrictionN,
  evaluateExactPointSimplexResult,
  compileXpbdSourceSimplexPairBarrierFamilyN,
  compileXpbdSourceSimplexPairFrictionFamilyN,
  type CompileXpbdSourceSimplexPairFrictionFamilyNOptions,
  type XpbdSourceSimplexPairFrictionEvaluationN,
  type XpbdSourceSimplexPairFrictionLagN,
  type XpbdSourceSimplexPairFrictionLagStateN,
  type XpbdSourceSimplexPairFrictionNOptions,
  type XpbdSourceSimplexPairFrictionPrepareNOptions,
  type XpbdSourceSimplexPairFrictionPrepareRefusalN,
  type XpbdSourceSimplexPairFrictionPreparationN,
  type XpbdSourceSimplexPairFrictionRegimeN,
  type XpbdSourceSimplexPairFrictionSkipN,
  type XpbdSourceSimplexPairResolvedSlipRegularizationN,
  type XpbdSourceSimplexPairSlipRegularizationN,
  type PointSimplexProjectedErrorBounds,
  type PointSimplexProjectedResult,
  type PointSimplexProjectedWitness,
  type PointSimplexPublicationReason,
  type PointSimplexRankDeficientResult,
  type PointSimplexResult,
  type PointSimplexUncertifiedResult,
  type PointSimplexZeroErrorBounds,
  type PointSimplexZeroResult,
  type PointSimplexZeroWitness,
  evaluateSourceSimplexPairDistanceN,
  compileXpbdSourceSimplexMeasureBarrierN,
  type CompileXpbdSourceSimplexMeasureBarrierNOptions,
  type XpbdSourceSimplexMeasureBarrierDomainReasonN,
  type XpbdSourceSimplexMeasureBarrierPublicationReasonN,
  type XpbdSourceSimplexMeasureBarrierTermsN,
  type CompileXpbdSourceSimplexPairBarrierFamilyNOptions,
  type SourceSimplexPairDistanceN,
  type SourceSimplexPairDistanceOptionsN,
  type SourceSimplexPairIndeterminateN,
  type SourceSimplexPairSeparatedMultipleN,
  type SourceSimplexPairSeparatedUniqueN,
  type SourceSimplexPairSideN,
  type SourceSimplexPairWitnessN,
  type SourceSimplexPairZeroDistanceN,
  type XpbdSourceSimplexPairBarrierDomainReasonN,
  type XpbdSourceSimplexPairBarrierEvaluationN,
  type XpbdSourceSimplexPairBarrierNOptions,
  type XpbdSourceSimplexPairBarrierStepFilterEvaluationN,
  type XpbdSourceSimplexPairBarrierStepFilterEvidenceN,
  type XpbdSourceSimplexPairBarrierStepFilterNOptions,
  type XpbdSourceSimplexPairBarrierStepFilterRefusalReasonN,
  RigidBody4,
  XpbdParticleN,
  XpbdParticleSourceSimplexBarrierN,
  XpbdParticleSourceSimplexBarrierStepFilterN,
  XpbdPotentialDomainErrorN,
  XpbdSourceSimplexAabbHierarchyN,
  XpbdWorldN,
  compileXpbdIncrementalPotentialProblemN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  compileXpbdSourceSimplexAabbHierarchyN,
  compileXpbdSourceSimplexCosineBendingFamilyN,
  evaluateSimplexHingeCosineN,
  minimizeXpbdIncrementalPotentialN,
  recoverXpbdIncrementalPotentialFeasibleBaseN,
  stepXpbdIncrementalPotentialN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdConservativeForceProviderN,
  type XpbdIncrementalPotentialStepFilterN,
  type XpbdIncrementalPotentialConvergenceContractN,
  type XpbdIncrementalPotentialConvergenceEvidenceN,
  type XpbdIncrementalPotentialConvergenceKindN,
  type XpbdIncrementalPotentialConvergenceN,
  type XpbdIncrementalPotentialDiagnosisN,
  type XpbdIncrementalPotentialWorldSelectionN,
  type XpbdIncrementalPotentialWorldStepN,
  type XpbdSourceSimplexAabbQueryDiagnosticsN,
  type XpbdSourceSimplexBendingHingeN,
  type XpbdSourceSimplexCosineBendingFamilyEvaluationN,
  type XpbdSourceSimplexCosineBendingFamilyTermsN,
  type XpbdSourceSimplexAabbQueryN,
  type XpbdVelocityResponseN,
  type XpbdParticleSourceSimplexBarrierDomainReasonN,
  type XpbdParticleSourceSimplexBarrierEvaluationN,
  type XpbdParticleSourceSimplexBarrierNOptions,
  type XpbdParticleSourceSimplexBarrierStepFilterEvaluationN,
  type XpbdParticleSourceSimplexBarrierStepFilterEvidenceN,
  type XpbdParticleSourceSimplexBarrierStepFilterNOptions,
  type XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN,
  type XpbdParticleSourceSimplexBarrierFamilyEvaluationN,
  type XpbdParticleSourceSimplexBarrierFamilyStepFilterEvaluationN,
  compileXpbdParticleSourceConvexHullBarrierFamilyN,
  gjkDistance,
  massPropertiesFromCellComplex4,
  type CompileXpbdParticleSourceConvexHullBarrierFamilyNOptions,
  type GjkResult,
  type XpbdParticleSourceConvexHullActiveBarrierN,
  type XpbdParticleSourceConvexHullBarrierDomainReasonN,
  type XpbdParticleSourceConvexHullBarrierFamilyStepFilterEvaluationN,
  type XpbdParticleSourceConvexHullBarrierFamilyStepFilterRefusalReasonN,
  type XpbdParticleSourceConvexHullBarrierFamilyTermsN,
  type XpbdParticleSourceConvexHullQueryDiagnosticsN,
  type XpbdParticleSourceConvexHullSegmentCertificationN,
  type XpbdSourceConvexHullWitnessN,
  evaluateClampedLogBarrierAtOrderN,
  ClampedLogBarrierInputErrorN
} from '@holotope/physics';
import {
  compileExperimentDocumentV0,
  coreExperimentCompilerV0,
  prepareExperimentDocumentV0,
  type ExperimentDocumentV0,
  type ExperimentProbeSourceCellStatusV0
} from '@holotope/experiment';
import {
  physicsExperimentCompilerV0,
  type ExperimentRigidModel4RuntimeV0
} from '@holotope/experiment-physics';
import { buildScenario, buildSection, buildSurface, cellCountOf, requireGroup } from './scenario.js';

/** An assertion function, so a checked `result.ok` narrows the union after it. */
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`packed consumer: ${message}`);
}

/**
 * The first element of a list, as a value rather than an assertion.
 *
 * `noUncheckedIndexedAccess` is on in this consumer, and a non-null assertion
 * would erase exactly the emptiness this check exists to notice.
 */
function requireFirst<T>(values: readonly T[], what: string): T {
  const first = values[0];
  if (first === undefined) throw new Error(`packed consumer: ${what} is empty`);
  return first;
}

/** A packed coordinate read through the same guard, never asserted away. */
function requireCoordinate(vector: VecN, axis: number, what: string): number {
  const value = vector.data[axis];
  if (value === undefined) {
    throw new Error(`packed consumer: ${what} has no coordinate ${axis}`);
  }
  return value;
}

/** The eight oriented facets of a hypercube, in emission order. */
const EXPECTED_FACETS = '3:- 3:+ 2:- 2:+ 1:- 1:+ 0:- 0:+';

function facetNames(complex: CellComplex): string {
  const cuboids = requireGroup(
    complex.cellsOfDim(3).find((group) => group.kind === 'cuboid'),
    'cuboid 3-cells'
  );
  const names: string[] = [];
  for (let cell = 0; cell < cellCountOf(cuboids); cell += 1) {
    const facet = cuboidCellFacetN(complex, cuboids, cell);
    if (facet === null) throw new Error(`packed consumer: cell ${cell} lies on no facet`);
    names.push(`${facet.axis}:${facet.sign > 0 ? '+' : '-'}`);
  }
  return names.join(' ');
}

/**
 * 0a. Exact-on-supplied-Float64 point--simplex decisions and publication.
 *
 * This consumes every result arm and every evidence field from the packed
 * declaration surface. The finite-witness accuracy overflow is intentionally
 * distinct from a witness that is itself outside Float64.
 */
export function exactPointSimplexQuery(): void {
  const projected: PointSimplexResult = evaluateExactPointSimplexResult(
    [0.25, 0.125, 2],
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    3
  );
  assert(projected.status === 'projected', 'exact triangle query did not project');
  const projectedResult: PointSimplexProjectedResult = projected;
  const projectedWitness: PointSimplexProjectedWitness = projectedResult.witness;
  const projectedError: PointSimplexProjectedErrorBounds = projectedResult.error;
  assert(projectedResult.exactRank === 2, 'exact triangle rank is wrong');
  assert(projectedResult.activeSlots.length === 3, 'exact active face is wrong');
  assert(projectedWitness.anchorSlot === 0, 'unexpected residual-weight anchor');
  assert(projectedWitness.weights.reduce((sum, weight) => sum + weight, 0) === 1,
    'published weights do not sum to one');
  assert(projectedWitness.point[2] === 0 && projectedWitness.distance === 2 &&
    projectedWitness.squaredDistance === 4 && projectedWitness.direction[2] === 1,
  'published projected witness is incoherent');
  assert(projectedError.weightAbsoluteErrorBound.every((bound) => bound === 0) &&
    projectedError.pointAbsoluteErrorBound.every((bound) => bound === 0) &&
    projectedError.squaredDistanceErrorBound === 0 &&
    projectedError.directionErrorBound === 0,
  'exact dyadic fixture unexpectedly carries publication error');

  const zero = evaluateExactPointSimplexResult(
    [0.25, 0.25, 0], [0, 0, 0, 1, 0, 0, 0, 1, 0], 3
  );
  assert(zero.status === 'zero', 'on-simplex point did not report exact zero');
  const zeroResult: PointSimplexZeroResult = zero;
  const zeroWitness: PointSimplexZeroWitness = zeroResult.witness;
  const zeroError: PointSimplexZeroErrorBounds = zeroResult.error;
  assert(zeroWitness.point[2] === 0 &&
    zeroError.squaredDistanceErrorBound === 0,
  'zero witness or its error evidence is wrong');

  const rank = evaluateExactPointSimplexResult(
    [0, 0, 1], [0, 0, 0, 1, 0, 0, 2, 0, 0], 3
  );
  assert(rank.status === 'rank-deficient', 'collinear triangle was admitted');
  const rankResult: PointSimplexRankDeficientResult = rank;
  assert(rankResult.exactRank === 1, 'exact deficient rank is wrong');

  const uncertain = evaluateExactPointSimplexResult(
    [7, Number.MIN_VALUE], [0, 0, 25, 0], 2
  );
  assert(uncertain.status === 'uncertified', 'accuracy overflow was certified');
  const uncertified: PointSimplexUncertifiedResult = uncertain;
  const reason: PointSimplexPublicationReason = uncertified.reason;
  assert(reason === 'accuracy-bound-overflow' && uncertified.detail.length > 0,
    'finite accuracy overflow lost its typed reason');
  assert(Object.isFrozen(projectedResult) &&
    Object.isFrozen(projectedWitness.weights) &&
    Object.isFrozen(projectedError.pointAbsoluteErrorBound),
  'published evidence is not owned and frozen');
}

/**
 * 0. Certified convex distance through the packed artifact.
 *
 * The pinned near-tie family: a flat box probed from a point whose two middle
 * coordinates differ by a quarter-million-th. Before the certified-termination
 * repair this configuration cycled to the iteration limit with the distance
 * already numerically right; the packed artifact must decide it with the
 * support-gap certificate, at the analytic distance, under the default budget.
 */
export function certifiedConvexQuery(): void {
  const corners: number[] = [];
  for (let corner = 0; corner < 8; corner += 1) {
    corners.push(
      (corner >> 0) & 1 ? 1 : 0,
      (corner >> 1) & 1 ? 1 : 0,
      (corner >> 2) & 1 ? 1 : 0,
      0
    );
  }
  const hull = new ConvexHullSupportShapeN(4, Float64Array.from(corners));
  const base = 0.618483421044642045;
  const probe = new ConvexHullSupportShapeN(4, Float64Array.from([
    0.468806433725538929, base, base + 2.5e-7, 1.52075262807995881
  ]));
  const result: GjkResult = gjkDistance(probe, hull);
  assert(result.status === 'separated', `near-tie query did not decide: ${result.status}`);
  assert(
    Math.abs(result.distance - 1.52075262807995881) < 1e-11,
    `near-tie distance off: ${result.distance}`
  );
  assert(
    result.termination.supportGap <= result.termination.threshold,
    'separation reported without a support-gap certificate'
  );
  // An insufficient budget is an explicit refusal, never a fabricated answer.
  const refused = gjkDistance(probe, hull, { maxIterations: 2 });
  assert(refused.status === 'iteration-limit', 'forced budget did not refuse');
  assert(refused.intersects === null, 'a refusal claimed an intersection answer');
}

/**
 * 0b. Source-retained convex-hull contact through the packed artifact.
 *
 * One dynamic probe against the convex hull of a flat two-cell support:
 * construction from packed types, a decided closest-point query with its
 * source witness, a forced indeterminate refusal under a starved query
 * budget, the paired filter's certified prefix, and rollback on refusal.
 */
export function convexHullContact(): void {
  const obstacle = new CellComplex(3, Float64Array.from([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0
  ]), [{
    key: 'support', dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
  }]);
  const body = new CellComplex(3, Float64Array.from([0.4, 0.6, 0.5]), [{
    key: 'probe', dim: 0, verticesPerCell: 1, kind: 'simplex',
    indices: Uint32Array.from([0])
  }]);
  const binding = compileXpbdParticleBindingN({
    source: body, id: 'packed-hull-probe', mass: 1
  });
  const compileOptions: CompileXpbdParticleSourceConvexHullBarrierFamilyNOptions = {
    id: 'packed-hull',
    binding,
    obstacle,
    sourceGroup: requireGroup(obstacle.groups[0], 'hull source group'),
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 2
  };
  const family = compileXpbdParticleSourceConvexHullBarrierFamilyN(compileOptions);

  // The provider/filter pair travels together into a solve.
  const terms: XpbdParticleSourceConvexHullBarrierFamilyTermsN =
    family.incrementalPotentialTerms();
  assert(terms.providers.length === 1 && terms.stepFilters.length === 1,
    'terms must carry the provider with its paired filter');

  // A decided query with a source-retained witness.
  const evaluation = family.evaluate();
  const diagnostics: XpbdParticleSourceConvexHullQueryDiagnosticsN =
    evaluation.diagnostics;
  assert(diagnostics.setQueries === 1, 'expected one set query per particle');
  assert(diagnostics.hullVertexCount === 4, 'expected four hull vertices');
  assert(evaluation.activeBarriers.length === 1, 'expected one active barrier');
  const record: XpbdParticleSourceConvexHullActiveBarrierN =
    evaluation.activeBarriers[0]!;
  assert(Math.abs(record.distance - 0.5) < 1e-11, `hull distance off: ${record.distance}`);
  const witness: XpbdSourceConvexHullWitnessN = record.witness;
  assert(witness.sourceVertices.length > 0, 'witness names no source vertices');
  assert(witness.query.status === 'separated', 'query did not decide');
  const force = evaluation.forces[0]!;
  assert(force.data[2]! > 0, 'barrier does not push along the support normal');
  assert(
    Math.hypot(force.data[0]!, force.data[1]!) <= 1e-12 * Math.abs(force.data[2]!),
    'a flat-interior push acquired a lateral component'
  );

  // The paired filter certifies a strict prefix of a crossing segment.
  const filter: XpbdParticleSourceConvexHullBarrierFamilyStepFilterEvaluationN =
    family.stepFilter.evaluate({
      dimension: 3,
      requestedStepLength: 1,
      positionBefore: () => new VecN(Float64Array.from([0.4, 0.6, 0.5])),
      positionAfter: () => new VecN(Float64Array.from([0.4, 0.6, -0.5]))
    });
  assert(filter.status === 'limited', `expected a limited prefix, got ${filter.status}`);
  assert(
    filter.status === 'limited' && filter.maximumStepLength > 0 &&
    filter.maximumStepLength < 1,
    'certified prefix must be a strict positive fraction'
  );
  const certification: XpbdParticleSourceConvexHullSegmentCertificationN | undefined =
    filter.certifications[0];
  assert(certification !== undefined &&
    certification.certification === 'global-lipschitz',
    'the crossing segment must be certified by the Lipschitz proof');

  // The filter's own refusal vocabulary is a closed union, composed here so
  // the packed types keep their meaning outside the workspace.
  const initialRefusal: XpbdParticleSourceConvexHullBarrierFamilyStepFilterRefusalReasonN =
    'initial-domain-violation';
  assert(initialRefusal !== ('' as never), 'refusal vocabulary present');

  // A starved query budget is a typed refusal that mutates nothing.
  const starved = compileXpbdParticleSourceConvexHullBarrierFamilyN({
    id: 'packed-hull-starved',
    binding,
    obstacle,
    sourceGroup: requireGroup(obstacle.groups[0], 'hull source group'),
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 2,
    maximumQueryIterations: 1
  });
  const before = Array.from(binding.particles[0]!.position.data);
  let refused = false;
  try {
    starved.evaluate();
  } catch (error) {
    const reason: XpbdParticleSourceConvexHullBarrierDomainReasonN =
      'closest-point-indeterminate';
    refused = error instanceof XpbdPotentialDomainErrorN &&
      error.reason === reason;
  }
  assert(refused, 'a starved query budget must refuse as closest-point-indeterminate');
  assert(
    JSON.stringify(Array.from(binding.particles[0]!.position.data)) ===
      JSON.stringify(before),
    'a refusal mutated particle state'
  );
}

/**
 * 1. Package and geometry composition.
 *
 * A sentinel for the installed artifact as much as for the geometry:
 * `cuboidCellFacetN` landed after v0.0.8, so resolving an older published
 * package fails here rather than passing quietly.
 */
/**
 * The dimension-generic affine chart and simplicial section, chained.
 *
 * An outside caller's first question about a section is whether it can trust the
 * ancestry after cutting twice, so this drives the R5 → R4 → R3 chain rather
 * than one cut: every final vertex must still name original R5 vertices, and
 * those weights must rebuild the emitted point.
 */
export function dimensionGenericSection(): void {
  // A 4-simplex in R5 straddling both hyperplanes.
  const positions = Float64Array.from([
    0, 0, 0, -1, -1,
    4, 0, 0, 1, 1,
    0, 4, 0, 1, -1,
    0, 0, 4, -1, 1,
    1, 1, 1, 1, 1
  ]);
  const group: CellGroup = {
    dim: 4, verticesPerCell: 5, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 3, 4])
  };
  const complex = new CellComplex(5, positions, [group]);

  const outer = HyperplaneSliceN.axisAligned(5, 4, 0);
  assert(outer.ambientDim === 5 && outer.chartDim === 4, 'chart dimensions');
  const first: SectionSimplexGroupNResultN = sectionSimplexGroupN({
    complex, group, slice: outer
  });
  assert(first.cellCount > 0, 'the first section emitted no cell');
  assert(first.cellDim === 3, 'a 4-simplex cut by a hyperplane is a 3-cell');
  const firstDiagnostics: SectionSimplexGroupNDiagnosticsN = first.diagnostics;
  assert(firstDiagnostics.sectionedCells === 1, 'the source cell was not sectioned');
  assert(
    firstDiagnostics.sourceCells ===
      firstDiagnostics.sectionedCells + firstDiagnostics.suppressedOnPlaneCells +
      firstDiagnostics.cellsBelow + firstDiagnostics.collapsedSectionCells,
    'the diagnostic partition identity failed through the packed surface'
  );

  const intermediateGroup: CellGroup = {
    dim: first.cellDim, verticesPerCell: first.verticesPerCell,
    kind: 'simplex', indices: first.cells
  };
  // The options bag spelled out: `axisAligned(5, 3, 0)` delegates to exactly
  // this constructor call, so the slice is identical - what this exercises is
  // the published option types, as an outside caller annotates them.
  const innerOptions: HyperplaneSliceNOptions = { normal: [0, 0, 0, 1, 0], offset: 0 };
  const inner = new HyperplaneSliceN(innerOptions);
  const lineage: SourceAffineLineageN = first.lineage;
  const secondOptions: SectionSimplexGroupNOptions = {
    complex: new CellComplex(5, first.ambientPositions, [intermediateGroup]),
    group: intermediateGroup,
    slice: inner,
    lineage
  };
  const second = sectionSimplexGroupN(secondOptions);
  assert(second.cellCount > 0, 'the chained section emitted no cell');
  assert(second.cellDim === 2, 'the chained section should be a surface');

  for (let vertex = 0; vertex < second.vertexCount; vertex++) {
    const from = second.lineage.offsets[vertex] ?? 0;
    const to = second.lineage.offsets[vertex + 1] ?? 0;
    assert(to > from, 'a section vertex with no ancestry');
    let sum = 0;
    const rebuilt = [0, 0, 0, 0, 0];
    for (let at = from; at < to; at++) {
      const ancestor = second.lineage.sourceVertices[at] ?? 0;
      const weight = second.lineage.weights[at] ?? 0;
      // Original R5 vertices, never the intermediate complex's.
      assert(ancestor < 5, 'ancestry escaped to the intermediate complex');
      sum += weight;
      for (let c = 0; c < 5; c++) {
        rebuilt[c] = (rebuilt[c] ?? 0) + weight * (positions[ancestor * 5 + c] ?? 0);
      }
    }
    assert(Math.abs(sum - 1) < 1e-11, `weights sum to ${sum}`);
    for (let c = 0; c < 5; c++) {
      const emitted = second.ambientPositions[vertex * 5 + c] ?? 0;
      assert(Math.abs((rebuilt[c] ?? 0) - emitted) < 1e-11, 'weights do not rebuild the point');
    }
    // Both hyperplanes hold, which is what makes this codimension two.
    const point: number[] = [];
    for (let c = 0; c < 5; c++) point.push(second.ambientPositions[vertex * 5 + c] ?? 0);
    assert(Math.abs(outer.signedDistance(point)) < 1e-11, 'off the outer hyperplane');
    assert(Math.abs(inner.signedDistance(point)) < 1e-11, 'off the inner hyperplane');
  }

  // Non-simplicial input is refused, with the remedy named.
  let refused = '';
  try {
    sectionSimplexGroupN({
      complex,
      group: { dim: 4, verticesPerCell: 5, kind: 'cuboid', indices: group.indices },
      slice: outer
    });
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  assert(refused.includes('Simplexize'), 'a cuboid group was not refused');
}

/**
 * The RN section render adapter, from the same tarballs its section came from.
 *
 * Drives the seam an outside caller needs first: construct over a simplicial
 * group, render, move the source, and resolve a pick back to the parent cell
 * with the ambient point qualified as approximate rather than upgraded.
 */

/**
 * The R2 -> R3 embedding through a render product, from the packed tarballs:
 * an injective display map drawn on the same path as a lossy projection, with
 * the taxonomy's evidence claims intact outside every workspace.
 */

/**
 * P56 feature-pair contact from the packed tarballs: the query's typed
 * branches, the family through the shipping world step, and the P53d gap
 * closed - outside every workspace.
 */

/**
 * P57 lagged friction from the packed tarballs: the lag lifecycle, the typed
 * refusals, a live sliding/sticking distinction, and the world transaction
 * seam - outside every workspace.
 */
export function laggedPairFriction(): void {
  const sheet = new CellComplex(4, Float64Array.from([
    0, 0, 0, 1.2,
    1, 0, 0, 1.2,
    0, 1, 0, 1.2,
    1, 1, 0, 1.2
  ]), [{
    dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
  }]);
  const support = new CellComplex(4, Float64Array.from([
    0.3, 0.3, 0, -0.5,
    0.3, 0.3, 0, 0.9,
    0.55, 0.1, 0.08, -0.5,
    0.1, 0.55, -0.08, -0.5
  ]), [{
    dim: 3, verticesPerCell: 4, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 3])
  }]);
  const binding = compileXpbdParticleBindingN({ id: 'sheet', source: sheet });
  const contact = compileXpbdSourceSimplexPairBarrierFamilyN({
    id: 'contact',
    binding,
    simplexGroup: sheet.groups[0]!,
    obstacle: createSourceSimplexReferenceN(
      createSourceCellReferenceN(support, support.groups[0]!, 0)
    ),
    activationDistance: 0.3,
    stiffness: 3
  });

  // Every published friction type, annotated the way an outside caller holds it.
  const familyOptions: CompileXpbdSourceSimplexPairFrictionFamilyNOptions = {
    id: 'friction', contact, frictionCoefficient: 0.5, slipRegularization: 1e-3
  };
  const family = compileXpbdSourceSimplexPairFrictionFamilyN(familyOptions);
  assert(family.terms.length === contact.barriers.length,
    'one friction term per contact pair, with no obstacle fan-out');

  const soloOptions: XpbdSourceSimplexPairFrictionNOptions = {
    id: 'solo', barrier: contact.barriers[0]!,
    frictionCoefficient: 0.5, slipRegularization: 1e-3
  };
  const solo = new XpbdSourceSimplexPairFrictionN(soloOptions);
  const prepared: XpbdPreparedSourceSimplexPairFrictionN = solo.prepare();
  const lag: XpbdSourceSimplexPairFrictionLagN = prepared.lag;
  const lagState: XpbdSourceSimplexPairFrictionLagStateN = lag.state;
  assert(lagState === 'prepared', 'a fresh lag is prepared');
  assert(lag.uniquenessGap > 0, 'the lag records the P56 margin that justified it');
  assert(Math.abs(lag.normal.length() - 1) < 1e-12, 'the frozen normal is a unit vector');
  assert(lag.laggedNormalForce >= 0, 'the lagged normal magnitude is non-negative');

  // A live sticking/sliding distinction, not merely a constructed object.
  const atRest: XpbdSourceSimplexPairFrictionEvaluationN = prepared.evaluate();
  const restRegime: XpbdSourceSimplexPairFrictionRegimeN = atRest.regime;
  assert(restRegime === 'sticking', 'zero slip must read as sticking');
  assert(atRest.forces.every((force) => force.length() === 0),
    'zero slip exerts exactly zero force');
  const sliding = prepared.evaluateAt((particle) => {
    const position = particle.position.clone();
    position.data[0] = position.data[0]! + 0.05;
    return position;
  });
  assert(sliding.regime === 'sliding', 'a large slip must saturate');
  assert(Math.abs(sliding.tangentForce.length() - sliding.forceLimit) < 1e-9,
    'a saturated force sits exactly on the Coulomb bound');
  assert(Math.abs(sliding.tangentForce.dot(lag.normal)) < 1e-11,
    'the friction force is tangent to the frozen normal');

  // The single-use lifecycle is a named failure, never an implicit refresh.
  prepared.markConsumed();
  let staleRefused = false;
  try { prepared.assertUsable(); } catch { staleRefused = true; }
  assert(staleRefused, 'a consumed lag must refuse reuse by name');
  prepared.rollback();
  prepared.assertUsable();

  // Typed prepare refusals reach the packed surface with their vocabulary.
  const refusalReason: XpbdSourceSimplexPairFrictionPrepareRefusalN =
    'tied-witness-no-unique-gradient';
  assert(refusalReason.length > 0, 'the refusal vocabulary is published');

  // The transaction seam: prepared ids appear separately from authored ones.
  const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
  binding.addToWorld(world);
  contact.addToWorld(world);
  const preparation: XpbdSourceSimplexPairFrictionPreparationN = family.prepare();
  const skips: readonly XpbdSourceSimplexPairFrictionSkipN[] = preparation.skipped;
  assert(preparation.prepared.length > 0, 'the family prepared no term');
  assert(Array.isArray(skips), 'skipped pairs are reported as a list');
  const advance = stepXpbdIncrementalPotentialWorldN({
    world,
    deltaTime: 0.01,
    stepFilters: contact.stepFilters,
    preparedProviders: preparation.prepared,
    warmStart: 'feasible-inertial-prediction',
    minimization: { directionPolicy: 'steepest-descent' }
  });
  // The family registers one barrier per cell, so the authored ids are
  // 'contact-0', 'contact-1', ... - not the family id itself.
  assert(advance.selection.providerIds.length === contact.barriers.length &&
    advance.selection.providerIds.every((id) => id.startsWith('contact-')),
    'the authored registry stays authoritative');
  assert(advance.selection.preparedProviderIds !== undefined &&
    advance.selection.preparedProviderIds.length === preparation.prepared.length,
    'prepared ids appear in selection evidence, separate from authored ones');
  if (advance.step.status === 'applied') preparation.markConsumed();
  else preparation.rollback();
}

/**
 * `U(x) = -f · x`, so the reported force is exactly `f` everywhere and the
 * packed gradient at an unmoved warm start is exactly `-deltaTime² f`.
 *
 * That makes both residuals analytic rather than fitted: the packed norm is
 * `deltaTime² ‖f‖`, and the acceleration residual is `‖f‖ / mass`.
 */
function packedConstantForce(
  id: string,
  particle: XpbdParticleN,
  force: VecN
): XpbdConservativeForceProviderN {
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (
    positionOf
  ) => ({
    potentialEnergy: -force.dot(positionOf(particle)),
    forces: [force.clone()]
  });
  return {
    id,
    dimension: particle.dimension,
    particles: [particle],
    evaluate: () => evaluateAt((bound) => bound.position.clone()),
    evaluateAt
  };
}

/**
 * P58A scale-aware stationarity from the packed tarballs.
 *
 * The packed objective is `½‖x − xPrediction‖²_M + deltaTime² U(x)`, so a
 * packed gradient entry carries mass·length. An absolute bound on its norm
 * therefore resolves forces only down to `tolerance / deltaTime²`, and
 * refining the timestep *lowers* the force the stop test can still see. One
 * free particle of unit mass under a constant 1000 N force demonstrates it
 * here: at `deltaTime = 1e-6` the shipped default of `1e-8` accepts the
 * unmoved warm start, delivers exactly zero velocity, and reports `applied` at
 * every step. Nothing in the result says otherwise, because converging
 * immediately is a legitimate outcome rather than a refusable one.
 *
 * The two criteria are not ranked. They differ by exactly `deltaTime²`: over
 * an eight-fold refinement at a fixed authored tolerance the packed norm holds
 * delivered position error to 1.5× while scattering acceleration by 45×, and
 * the acceleration residual does the reverse, 1.02× and 62.8×. Which error the
 * scene must bound is the scene author's to state, so the surface is a
 * discriminated stop test rather than a second scalar.
 */
export function stationarityCriterion(): void {
  const FORCE = 1000;
  const DELTA_TIME = 1e-6;
  const STEPS = 20;

  const drive = (
    convergence?: XpbdIncrementalPotentialConvergenceN
  ): { readonly applied: number; readonly velocity: number } => {
    const particle = new XpbdParticleN({
      id: 'packed-stationarity', position: [0, 0, 0]
    });
    const world = new XpbdWorldN({ dimension: 3, gravity: [0, 0, 0] });
    world.addParticle(particle);
    world.addForceProvider(packedConstantForce(
      'packed-constant-force', particle, new VecN([FORCE, 0, 0])
    ));
    let applied = 0;
    for (let step = 0; step < STEPS; step += 1) {
      const advance = stepXpbdIncrementalPotentialWorldN({
        world,
        deltaTime: DELTA_TIME,
        ...(convergence === undefined ? {} : { minimization: { convergence } })
      });
      if (advance.step.status === 'applied') applied += 1;
    }
    return {
      applied,
      velocity: requireCoordinate(particle.velocity, 0, 'the driven particle')
    };
  };

  // The legacy criterion at this timestep: every step succeeds and the whole
  // force is below the resolution the packed bound can still see.
  const legacy = drive();
  assert(legacy.applied === STEPS,
    'every packed-gradient step reports applied, whatever it resolved');
  assert(legacy.velocity === 0,
    'at this timestep the packed bound resolves no part of a 1000 N force');

  // The same scene bounded in length/time² instead. One metre per second
  // squared is four hundred thousand times smaller than the acceleration this
  // scene produces, and is authorable without knowing the timestep at all.
  const bounded = drive({ kind: 'maximum-acceleration-residual', tolerance: 1 });
  assert(bounded.applied === STEPS,
    'every acceleration-bounded step reports applied');
  assert(Math.abs(bounded.velocity - FORCE * DELTA_TIME * STEPS) < 1e-12,
    "the acceleration bound delivers Newton's answer at this timestep");

  // The evidence every terminal carries, read straight off the minimizer.
  const witness = new XpbdParticleN({
    id: 'packed-stationarity-witness', position: [0, 0, 0]
  });
  const problem = compileXpbdIncrementalPotentialProblemN({
    dimension: 3,
    particles: [witness],
    predictedPositions: [new VecN([0, 0, 0])],
    deltaTime: DELTA_TIME,
    providers: [packedConstantForce(
      'packed-witness-force', witness, new VecN([FORCE, 0, 0])
    )]
  });
  const stopTest: XpbdIncrementalPotentialConvergenceN = {
    kind: 'maximum-acceleration-residual', tolerance: 1
  };
  const evaluated = minimizeXpbdIncrementalPotentialN({
    problem, initialCoordinates: [0, 0, 0],
    convergence: stopTest, maximumIterations: 0
  });
  // Only the refused-initial-state terminal carries the bare contract; every
  // terminal that reached an evaluation carries what the criterion measured.
  assert(evaluated.status !== 'initial-state-refused',
    `the evaluation-only run refused its initial state (${evaluated.status})`);
  const evidence: XpbdIncrementalPotentialConvergenceEvidenceN =
    evaluated.convergence;
  const kind: XpbdIncrementalPotentialConvergenceKindN = evidence.kind;
  assert(kind === 'maximum-acceleration-residual',
    'the terminal names the criterion that ran, not the default');
  assert(evidence.tolerance === 1,
    'the authored threshold is echoed in its own unit');
  // grad = -deltaTime² f at the base, so the residual is ‖f‖ / mass exactly.
  assert(Math.abs(evidence.initialResidual - FORCE) <= 1e-6 * FORCE,
    'the acceleration residual is the force divided by the mass, in length/time²');
  assert(evidence.finalResidual === evidence.initialResidual,
    'an evaluation-only run moves no iterate, and says so at both endpoints');
  // The packed norm is retained whichever criterion decided, and the legacy
  // threshold is reported as the inert default it now is.
  assert(Math.abs(evaluated.initial.gradientNorm - DELTA_TIME * DELTA_TIME * FORCE)
      <= 1e-6 * DELTA_TIME * DELTA_TIME * FORCE,
    'the packed gradient norm survives alongside the criterion that decided');
  assert(evaluated.gradientTolerance === 1e-8,
    'the legacy threshold is echoed untouched under another criterion');
  // The evidence is the contract plus what it measured, so it reads as either.
  const contract: XpbdIncrementalPotentialConvergenceContractN = evidence;
  assert(contract.tolerance === evidence.tolerance,
    'the authored contract is recoverable from the evidence that extends it');

  const converged = minimizeXpbdIncrementalPotentialN({
    problem, initialCoordinates: [0, 0, 0], convergence: stopTest
  });
  assert(converged.status === 'converged',
    `the acceleration-bounded solve reported ${converged.status}`);
  assert(converged.convergence.initialResidual > converged.convergence.tolerance &&
    converged.convergence.finalResidual <= converged.convergence.tolerance,
    'a converged run crosses its own threshold, and reports both sides of it');

  // Two thresholds in different units are refused before anything is
  // evaluated, rather than reconciled by a rule nobody authored.
  let bothRefused = false;
  try {
    minimizeXpbdIncrementalPotentialN({
      problem, initialCoordinates: [0, 0, 0],
      gradientTolerance: 1e-6, convergence: stopTest
    });
  } catch { bothRefused = true; }
  assert(bothRefused,
    'authoring both stop tests is refused, never silently resolved');

  // Diagnosis follows the criterion that ran rather than always naming the
  // packed threshold.
  const diagnosisParticle = new XpbdParticleN({
    id: 'packed-stationarity-diagnosis', position: [0, 0, 0]
  });
  const diagnosisWorld = new XpbdWorldN({ dimension: 3, gravity: [0, 0, 0] });
  diagnosisWorld.addParticle(diagnosisParticle);
  diagnosisWorld.addForceProvider(packedConstantForce(
    'packed-diagnosis-force', diagnosisParticle, new VecN([FORCE, 0, 0])
  ));
  const diagnosed = stepXpbdIncrementalPotentialWorldN({
    world: diagnosisWorld,
    deltaTime: DELTA_TIME,
    minimization: { convergence: stopTest }
  });
  const facts = diagnosed.diagnosis.facts;
  assert(facts['convergenceKind'] === 'maximum-acceleration-residual',
    'diagnosis names the criterion that decided the step');
  assert(facts['convergenceTolerance'] === 1,
    'diagnosis carries the authored tolerance');
  assert(typeof facts['convergenceResidualInitial'] === 'number' &&
    typeof facts['convergenceResidualFinal'] === 'number',
    'diagnosis reports the criterion residual at both endpoints');
  assert(typeof facts['gradientNormInitial'] === 'number',
    'the packed norm is reported alongside, never replaced');
}

/**
 * P58B timestep-consistent friction regularization from the packed tarballs.
 *
 * Per-step slip is `‖tangential velocity‖ · deltaTime`, so inside the
 * regularized branch a *fixed* length gives a force proportional to
 * `deltaTime`, one step's impulse proportional to `deltaTime²`, and a fixed
 * horizon of `T/deltaTime` steps a total proportional to `T · deltaTime`:
 * friction vanishes under refinement. Measured over an eight-fold refinement
 * the tangential impulse falls to 0.133 of its coarse value, last halving 1.98
 * against a predicted 2.00; authored as a slip velocity it holds to 1.06, last
 * halving 0.99.
 *
 * The velocity form resolves to `velocity · deltaTime` once, and that resolved
 * length is frozen into the lag. Freezing is load-bearing rather than tidy:
 * conservativeness within one lag is what lets the Armijo search evaluate the
 * term repeatedly, and a length that moved mid-solve would leave the search
 * minimizing a function whose shape changed under it. `prepare` therefore
 * takes the timestep, required under a velocity and refused under a length.
 */
export function slipVelocityRegularization(): void {
  const SLIP_VELOCITY = 0.5;
  // Binary-exact, so the resolved length is comparable without a tolerance.
  const DELTA_TIME = 1 / 128;
  const RESOLVED_LENGTH = SLIP_VELOCITY * DELTA_TIME;

  const sheet = new CellComplex(4, Float64Array.from([
    0, 0, 0, 1.2,
    1, 0, 0, 1.2,
    0, 1, 0, 1.2,
    1, 1, 0, 1.2
  ]), [{
    dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
  }]);
  const support = new CellComplex(4, Float64Array.from([
    0.3, 0.3, 0, -0.5,
    0.3, 0.3, 0, 0.9,
    0.55, 0.1, 0.08, -0.5,
    0.1, 0.55, -0.08, -0.5
  ]), [{
    dim: 3, verticesPerCell: 4, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 3])
  }]);
  const binding = compileXpbdParticleBindingN({
    id: 'packed-slip-sheet', source: sheet
  });
  const sheetGroup = requireFirst(sheet.groups, 'the sheet cell groups');
  const obstacle = createSourceSimplexReferenceN(createSourceCellReferenceN(
    support, requireFirst(support.groups, 'the support cell groups'), 0
  ));
  /** The apex sits 0.3 below the sheet, so activation decides contact here. */
  const contactAt = (activationDistance: number, id: string) =>
    compileXpbdSourceSimplexPairBarrierFamilyN({
      id, binding, simplexGroup: sheetGroup, obstacle,
      activationDistance, stiffness: 3
    });
  const touching = contactAt(0.5, 'packed-slip-touching');
  const clear = contactAt(0.2, 'packed-slip-clear');

  // The authored spelling, held the way an outside caller holds it.
  const authored: XpbdSourceSimplexPairSlipRegularizationN = {
    kind: 'slip-velocity', velocity: SLIP_VELOCITY
  };
  const prepareOptions: XpbdSourceSimplexPairFrictionPrepareNOptions = {
    deltaTime: DELTA_TIME
  };
  const soloOptions: XpbdSourceSimplexPairFrictionNOptions = {
    id: 'packed-slip-velocity',
    barrier: requireFirst(touching.barriers, 'the touching contact barriers'),
    frictionCoefficient: 0.5,
    slipRegularization: authored
  };
  const solo = new XpbdSourceSimplexPairFrictionN(soloOptions);
  const prepared: XpbdPreparedSourceSimplexPairFrictionN =
    solo.prepare(prepareOptions);
  const lag: XpbdSourceSimplexPairFrictionLagN = prepared.lag;
  assert(lag.regularizationLength === RESOLVED_LENGTH,
    'a slip velocity resolves to velocity * deltaTime, once, into the lag');
  assert(lag.regularizationLength !== SLIP_VELOCITY,
    'the authored velocity is never itself taken for a length');

  // The timestep is required under a velocity and refused under a length:
  // accepting and discarding it would leave an author believing a fixed length
  // tracked the timestep, which is the belief that makes friction disappear.
  let missingTimestep = false;
  try { solo.prepare(); } catch { missingTimestep = true; }
  assert(missingTimestep,
    'a slip velocity cannot be frozen without the timestep it resolves against');
  const byLength = new XpbdSourceSimplexPairFrictionN({
    id: 'packed-slip-length',
    barrier: requireFirst(touching.barriers, 'the touching contact barriers'),
    frictionCoefficient: 0.5,
    slipRegularization: { kind: 'slip-length', length: 1e-3 }
  });
  assert(byLength.prepare().lag.regularizationLength === 1e-3,
    'an authored length is frozen exactly as written');
  let timestepRefused = false;
  try { byLength.prepare(prepareOptions); } catch { timestepRefused = true; }
  assert(timestepRefused,
    'a timestep under an authored length is refused, not accepted and dropped');

  // Contact activity is its own axis. Regime is decided by the slip, activity
  // by the lagged normal force, and neither may be inferred from the other.
  const atRest: XpbdSourceSimplexPairFrictionEvaluationN = prepared.evaluate();
  const active: boolean = atRest.contactActive;
  assert(active === (atRest.forceLimit > 0),
    'contact activity is exactly a positive force limit');
  assert(active === (lag.laggedNormalForce > 0),
    'under a positive coefficient, activity is the lagged normal force');
  assert(active, 'a pair inside the activation distance carries a force limit');

  const slide = (
    term: XpbdPreparedSourceSimplexPairFrictionN
  ): XpbdSourceSimplexPairFrictionEvaluationN => term.evaluateAt((particle) => {
    const position = particle.position.clone();
    position.data[0] = requireCoordinate(position, 0, 'a bound sheet particle') + 0.05;
    return position;
  });
  const sliding = slide(prepared);
  const regime: XpbdSourceSimplexPairFrictionRegimeN = sliding.regime;
  assert(regime === 'sliding',
    'a slip well above the resolved length saturates');
  assert(sliding.contactActive === (sliding.forceLimit > 0),
    'activity is read from the force limit, never from the regime');
  assert(Math.abs(sliding.tangentForce.length() - sliding.forceLimit) < 1e-9,
    'a saturated active force sits exactly on the Coulomb bound');

  // The orthogonality, live: a pair outside the activation distance still has
  // a slip and still reports a regime, while exerting exactly zero force.
  const clearTerm = new XpbdSourceSimplexPairFrictionN({
    id: 'packed-slip-clear-term',
    barrier: requireFirst(clear.barriers, 'the clear contact barriers'),
    frictionCoefficient: 0.5,
    slipRegularization: authored
  });
  const clearPrepared = clearTerm.prepare(prepareOptions);
  assert(clearPrepared.lag.regularizationLength === RESOLVED_LENGTH,
    'every lag freezes the same resolved length');
  const clearSliding = slide(clearPrepared);
  assert(clearSliding.regime === 'sliding' && !clearSliding.contactActive,
    "a 'sliding' regime is not evidence that any contact force is active");
  assert(clearSliding.forceLimit === 0 &&
    clearSliding.tangentForce.length() === 0 &&
    clearSliding.forces.every((force) => force.length() === 0),
    'an inactive term exerts exactly zero force whatever its slip says');

  // The family carries the same authored scale, normalized without
  // reinterpretation, and hands the timestep down to every term it freezes.
  const family = compileXpbdSourceSimplexPairFrictionFamilyN({
    id: 'packed-slip-family', contact: touching,
    frictionCoefficient: 0.5, slipRegularization: authored
  });
  const resolved: XpbdSourceSimplexPairResolvedSlipRegularizationN =
    family.slipRegularization;
  assert(resolved.kind === 'slip-velocity' && resolved.velocity === SLIP_VELOCITY,
    'the family normalizes the authored scale without changing its unit');
  const preparation = family.prepare(prepareOptions);
  assert(preparation.prepared.length > 0, 'the family prepared no term');
  assert(preparation.prepared.every(
    (term) => term.lag.regularizationLength === RESOLVED_LENGTH
  ), 'every family term freezes the one resolved length');
  preparation.rollback();

  // The numeric spelling remains a world length carrying its exact value, so
  // no existing scene is rescaled by the new one.
  const legacy = compileXpbdSourceSimplexPairFrictionFamilyN({
    id: 'packed-slip-legacy', contact: touching,
    frictionCoefficient: 0.5, slipRegularization: 1e-3
  });
  const legacyScale = legacy.slipRegularization;
  assert(legacyScale.kind === 'slip-length' && legacyScale.length === 1e-3,
    'a bare number is a world length, and is never read as a velocity');
}

export function featurePairContact(): void {
  const sheet = new CellComplex(4, Float64Array.from([
    0, 0, 0, 1.2,
    1, 0, 0, 1.2,
    0, 1, 0, 1.2,
    1, 1, 0, 1.2
  ]), [{
    dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
  }]);
  const obstacle = new CellComplex(4, Float64Array.from([
    0.3, 0.3, 0, -0.5,
    0.3, 0.3, 0, 0.9,
    0.55, 0.1, 0.08, -0.5,
    0.1, 0.55, -0.08, -0.5
  ]), [{
    dim: 3, verticesPerCell: 4, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 3])
  }]);
  const sheetGroup = sheet.groups[0]!;
  const spike = createSourceSimplexReferenceN(
    createSourceCellReferenceN(obstacle, obstacle.groups[0]!, 0)
  );

  // The P53d gap through the packed surface: pierced interior, legal
  // vertices. Every published type is exercised as an outside caller would
  // annotate it, so the packed d.ts carries each one.
  const piercedSide: SourceSimplexPairSideN = {
    reference: createSourceSimplexReferenceN(
      createSourceCellReferenceN(sheet, sheetGroup, 0)
    ),
    positions: Float64Array.from([0, 0, 0, 0.2, 1, 0, 0, 0.2, 0, 1, 0, 0.2])
  };
  const queryOptions: SourceSimplexPairDistanceOptionsN = { rankTolerance: 1e-10 };
  const pierced: SourceSimplexPairDistanceN = evaluateSourceSimplexPairDistanceN(
    piercedSide, { reference: spike }, queryOptions
  );
  assert(pierced.status === 'zero-distance',
    'a pierced triangle interior must certify zero distance');
  const zero: SourceSimplexPairZeroDistanceN = pierced;
  const zeroWitness: SourceSimplexPairWitnessN = zero.witness;
  assert(zeroWitness.activeSlotsA.length > 0, 'the witness names its active slots');
  assert(!('direction' in pierced), 'zero distance must not invent a normal');

  // A tied placement returns multiplicity evidence, never one blessed witness.
  const tied = evaluateSourceSimplexPairDistanceN(
    {
      reference: createSourceSimplexReferenceN(
        createSourceCellReferenceN(sheet, sheetGroup, 0), [0, 1]
      ),
      positions: Float64Array.from([-1, 0, 0, 0, 1, 0, 0, 0])
    },
    {
      reference: createSourceSimplexReferenceN(
        createSourceCellReferenceN(sheet, sheetGroup, 1), [1, 3]
      ),
      positions: Float64Array.from([-0.5, 0.75, 0, 0, 0.5, 0.75, 0, 0])
    }
  );
  assert(tied.status === 'separated-multiple',
    'an exactly parallel pair must certify with multiplicity');
  const multiple: SourceSimplexPairSeparatedMultipleN = tied;
  assert(multiple.witnesses.length >= 2,
    'an exactly parallel pair must return every tied witness');

  // A separated-unique result and its margin, plus branch types a caller
  // narrows into - including the refusal branches, spelled as the union
  // members they are.
  const uniquePair = evaluateSourceSimplexPairDistanceN(
    {
      reference: createSourceSimplexReferenceN(
        createSourceCellReferenceN(sheet, sheetGroup, 0), [0, 1]
      ),
      positions: Float64Array.from([-1, 0.3, 0, 0, 1, 0.3, 0, 0])
    },
    {
      reference: createSourceSimplexReferenceN(
        createSourceCellReferenceN(sheet, sheetGroup, 1), [1, 3]
      ),
      positions: Float64Array.from([0.1, 0, -1, 0, 0.1, 0, 1, 0])
    }
  );
  assert(uniquePair.status === 'separated-unique', 'the skew pair must be unique');
  const unique: SourceSimplexPairSeparatedUniqueN = uniquePair;
  assert(unique.uniquenessGap > 0, 'a unique witness carries its margin');
  const audit: SourceSimplexPairIndeterminateN | null =
    uniquePair.status === ('indeterminate' as typeof uniquePair.status)
      ? (uniquePair as unknown as SourceSimplexPairIndeterminateN)
      : null;
  assert(audit === null, 'a certified pair is not an audit refusal');

  // The family composes through the world step from the packed artifacts.
  const binding = compileXpbdParticleBindingN({ id: 'packed-sheet', source: sheet });
  const familyOptions: CompileXpbdSourceSimplexPairBarrierFamilyNOptions = {
    id: 'packed-contact',
    binding,
    simplexGroup: sheetGroup,
    obstacle: spike,
    activationDistance: 0.25,
    stiffness: 3
  };
  const family = compileXpbdSourceSimplexPairBarrierFamilyN(familyOptions);
  assert(family.barriers.length === 2, 'one pair per sheet triangle');
  assert(family.barriers[0] instanceof XpbdSourceSimplexPairBarrierN,
    'family members must be the public barrier class');
  const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
  binding.addToWorld(world);
  family.addToWorld(world);
  let applied = 0;
  for (let step = 0; step < 8; step++) {
    const advance = stepXpbdIncrementalPotentialWorldN({
      world,
      deltaTime: 0.01,
      stepFilters: family.stepFilters,
      warmStart: 'feasible-inertial-prediction',
      minimization: { directionPolicy: 'steepest-descent' }
    });
    if (advance.step.status === 'applied') applied++;
  }
  assert(applied > 4, 'the packed world step must advance the sheet');

  // The barrier and filter option bags, evaluations, and refusal vocabularies
  // as typed values, the way an outside caller holds them.
  const barrierOptions: XpbdSourceSimplexPairBarrierNOptions = {
    id: 'packed-solo',
    particlesA: family.features[0]!.vertexIndices.map(
      (vertexIndex) => binding.particleForSourceVertex(vertexIndex)
    ),
    featureA: family.features[0]!,
    featureB: spike,
    activationDistance: 0.25,
    stiffness: 3
  };
  const solo = new XpbdSourceSimplexPairBarrierN(barrierOptions);
  const soloEvaluation: XpbdSourceSimplexPairBarrierEvaluationN = solo.evaluate();
  assert(soloEvaluation.forces.length === 3, 'one force per moving vertex');
  const domainReason: XpbdSourceSimplexPairBarrierDomainReasonN =
    'tied-witness-no-unique-gradient';
  assert(domainReason.length > 0, 'the refusal vocabulary is published');
  const filterOptions: XpbdSourceSimplexPairBarrierStepFilterNOptions = {
    id: 'packed-solo-filter', barrier: solo
  };
  const soloFilter = new XpbdSourceSimplexPairBarrierStepFilterN(filterOptions);
  const verdict: XpbdSourceSimplexPairBarrierStepFilterEvaluationN =
    soloFilter.evaluate({
      dimension: 4,
      requestedStepLength: 1,
      positionBefore: (particle) => particle.position.clone(),
      positionAfter: (particle) => particle.position.clone()
    });
  const evidence: XpbdSourceSimplexPairBarrierStepFilterEvidenceN = verdict;
  assert(evidence.certification === 'stationary',
    'an unmoved segment certifies as stationary');
  const refusalReason: XpbdSourceSimplexPairBarrierStepFilterRefusalReasonN =
    'initial-domain-violation';
  assert(refusalReason.length > 0, 'the filter refusal vocabulary is published');
}

export function planeEmbeddingComposition(): void {
  const square = new CellComplex(2, Float64Array.from([
    0, 0,
    2, 0,
    2, 2,
    0, 2
  ]), [{
    key: 'wire', dim: 1, verticesPerCell: 2, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 1, 2, 2, 3, 3, 0])
  }]);
  // Broad annotation on purpose: the packed d.ts must accept the embedding
  // wherever a display map is accepted, without a cast.
  const embedding: DisplayMap3D = new PlaneEmbedding3D();
  const edges = new ProjectedEdges3D(square, embedding);
  edges.object.updateMatrixWorld(true);

  const forward = new PlaneEmbedding3D().projectPoint([1.5, 0.25]);
  assert(forward[0] === 1.5 && forward[1] === 0.25 && forward[2] === 0,
    'the embedding must map [x, y] to [x, y, 0] exactly');
  const inverse: DisplayMapInverse3D = new PlaneEmbedding3D().invertPoint(forward);
  assert(inverse.status === 'on-image', 'the exact image must invert');
  assert(inverse.status === 'on-image' && inverse.point[0] === 1.5 && inverse.point[1] === 0.25,
    'the inverse on the image must be exact');
  const off = new PlaneEmbedding3D().invertPoint([1.5, 0.25, 0.5]);
  assert(off.status === 'off-image' && off.distanceFromImage === 0.5,
    'an off-image point must refuse by type with its distance');

  const caster = new Raycaster(new Vector3(1, 0, 5), new Vector3(0, 0, -1), 0.01, 100);
  caster.params.Line.threshold = 0.05;
  const hits = caster.intersectObject(edges.object, true);
  assert(hits.length > 0, 'the embedded square was not pickable');
  const hit = representationHitFromProjectedEdge(edges, hits[0]!);
  assert(hit.ambientDim === 2, 'the hit must live in R2');
  assert(hit.ambientPointStatus === 'approximate',
    'a renderer-derived inverse must stay approximate, never exact');
  assert(hit.ambiguity === 'none', 'an injective map cannot overlap');
  // The recorded step is bitwise the factory's recipe: an outside caller can
  // rebuild and compare provenance rather than trusting a string.
  const recipe: PlaneEmbeddingMapRecipe3 = planeEmbeddingMapRecipe3();
  assert(recipe.fromDim === 2 && recipe.toDim === 3,
    'the embedding recipe must go from R2 to display R3');
  const step = hit.lineage.steps[0];
  assert(step !== undefined && step.kind === recipe.kind
    && step.fromDim === recipe.fromDim && step.toDim === recipe.toDim,
    'the recorded lineage step must equal the published recipe');
  edges.dispose();
}


/**
 * The complete authored R5 bridge from the packed tarballs: Part B's 4-facet
 * group, two exact cuts, a rendered chart, a real pick, and original R5
 * ancestry - reproduced outside every workspace.
 */
export function authoredDimensionBridge(): void {
  const body = createSimplex({ dim: 5, maxCellDimension: 4 });
  const facets = body.groups.find((group) => group.dim === 4);
  assert(facets !== undefined && facets.indices.length / 5 === 6,
    'the R5 simplex must author six simplicial 4-facets');

  const outer = HyperplaneSliceN.axisAligned(5, 4, 0.02);
  const first = sectionSimplexGroupN({ complex: body, group: facets!, slice: outer });
  assert(first.cellCount > 0 && first.cellDim === 3 && first.chartDim === 4,
    'the first cut must produce live 3-cells in an R4 chart');

  const intermediateGroup: CellGroup = {
    dim: first.cellDim, verticesPerCell: first.verticesPerCell,
    kind: 'simplex', indices: first.cells
  };
  const intermediate = new CellComplex(4, first.chartPositions, [intermediateGroup]);
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let vertex = 0; vertex < first.vertexCount; vertex++) {
    const w = first.chartPositions[vertex * 4 + 3]!;
    if (w < low) low = w;
    if (w > high) high = w;
  }
  const inner = HyperplaneSliceN.axisAligned(4, 3, low + (high - low) * 0.5);
  const chart = new SectionChart3D(intermediate, intermediateGroup, inner, {
    lineage: first.lineage
  });
  assert(chart.cellCount > 0, 'the second cut must render live triangles');

  // A real pick at the first drawn triangle's centroid.
  const positions = chart.geometry.getAttribute('position');
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let corner = 0; corner < 3; corner++) {
    cx += positions.getX(corner) / 3;
    cy += positions.getY(corner) / 3;
    cz += positions.getZ(corner) / 3;
  }
  chart.object.updateMatrixWorld(true);
  const caster = new Raycaster(new Vector3(cx, cy, cz + 10), new Vector3(0, 0, -1), 0.01, 100);
  const hits = caster.intersectObject(chart.object, true);
  assert(hits.length > 0, 'the rendered bridge was not pickable');
  const hit = representationHitFromSectionChart(chart, {
    point: hits[0]!.point, faceIndex: hits[0]!.faceIndex ?? 0
  });
  assert(hit.ambientPointStatus === 'approximate',
    'a renderer-derived point must stay approximate through the chain');

  // Every corner of the picked primitive names ORIGINAL R5 vertices with
  // affine weights summing to one, and both plane equations hold at the
  // reconstructed R5 point.
  const primitive = Math.floor(hits[0]!.faceIndex ?? 0);
  for (const corner of chart.primitiveVertices(primitive)) {
    const ancestry = chart.vertexAncestry(corner);
    assert(ancestry.sourceVertices.length > 0, 'a corner lost its ancestry');
    const reconstructed = [0, 0, 0, 0, 0];
    let weightSum = 0;
    for (let at = 0; at < ancestry.sourceVertices.length; at++) {
      const source = ancestry.sourceVertices[at]!;
      assert(source < body.vertexCount,
        'ancestry leaked an intermediate-complex vertex into the final report');
      weightSum += ancestry.weights[at]!;
      for (let axis = 0; axis < 5; axis++) {
        reconstructed[axis]! += ancestry.weights[at]! * body.positions[source * 5 + axis]!;
      }
    }
    assert(Math.abs(weightSum - 1) < 1e-9, 'affine weights must sum to one');
    const onOuter = outer.projectPointToChart(reconstructed);
    assert(Math.abs(onOuter.signedDistance) < 1e-9, 'the outer plane equation failed');
    const onInner = inner.projectPointToChart(onOuter.coordinates);
    assert(Math.abs(onInner.signedDistance) < 1e-9, 'the inner plane equation failed');
  }
  chart.dispose();
}

export function sectionChartRender(): void {
  const positions = Float64Array.from([
    0, 0, 0, -1,
    2, 0, 0, 1,
    0, 2, 0, 1,
    0, 0, 2, 1
  ]);
  const complex = new CellComplex(4, positions, [
    { dim: 3, verticesPerCell: 4, kind: 'simplex', indices: Uint32Array.from([0, 1, 2, 3]) }
  ]);
  const group = complex.groups[0];
  assert(group !== undefined, 'expected the tetrahedron group');

  const options: SectionChart3DOptions = {
    material: new LineBasicMaterial()
  };
  // A caller-owned material on a triangle section would be wrong for shading,
  // but ownership is the thing under test: the product must not dispose it.
  const chart = new SectionChart3D(
    complex, group, HyperplaneSliceN.axisAligned(4, 3, 0), options
  );
  assert(chart.cellCount === 1, `expected one section triangle, got ${chart.cellCount}`);
  assert(chart.section.diagnostics.sectionedCells === 1, 'the cell did not section');
  assert(chart.section.diagnostics.collapsedSectionCells === 0, 'nothing should collapse');

  // Streaming: move the authoritative source, update, and the drawn buffer
  // follows while the caller complex is only read.
  for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
    const at = vertex * 4;
    complex.positions[at] = (complex.positions[at] ?? 0) + 3;
  }
  chart.update();
  const attribute = chart.geometry.getAttribute('position');
  assert(attribute.getX(0) >= 2, 'the drawn section did not follow the source');

  const hit = representationHitFromSectionChart(chart, {
    point: new Vector3(3.5, 0.5, 0),
    faceIndex: 0
  });
  assert(hit.representation === 'section-chart', 'wrong representation kind');
  assert(hit.source.kind === 'cell' && hit.source.cellIndex === 0, 'wrong parent cell');
  assert(hit.ambientPointStatus === 'approximate', 'a Float32 pick is approximate');
  assert(hit.ambiguity === 'none', 'a section pick is not ambiguous');

  let refused = '';
  try {
    void new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(4, 3, 0),
      { magic: 1 } as never
    );
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  assert(refused.includes('unknown option'), 'unknown options must refuse by name');

  chart.dispose();
  const material = options.material;
  assert(material !== undefined, 'the option was provided');
  // Disposing after the product proves the product left it alive.
  material.dispose();
}

export function geometryComposition(): void {
  const complex = createHypercube({ dim: 4, size: 3, maxCellDimension: 3 });
  assert(facetNames(complex) === EXPECTED_FACETS, `size-3 facets were ${facetNames(complex)}`);
  const bounds = cellComplexBoundsAlongAxisN(complex, 3);
  assert(bounds.min === -1.5 && bounds.max === 1.5, `w bounds were [${bounds.min}, ${bounds.max}]`);

  const relative = Rotor4.fromPlane(0, 3, 0.7);
  const [major, minor] = Rotor4.principalAnglesBetween(Rotor4.identity(), relative);
  assert(Math.abs(major - 0.7) < 1e-12 && minor < 1e-12, `principal angles were [${major}, ${minor}]`);

  // Translated clear of the origin, every coordinate shares one sign, so a
  // recipe reading `Math.sign` would name the same facet eight times.
  const moved = new CellComplex(
    complex.ambientDim,
    complex.positions.map((value) => value + 10),
    [...complex.groups]
  );
  assert(facetNames(moved) === EXPECTED_FACETS, `translated facets were ${facetNames(moved)}`);
}

interface PositionAttribute {
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

/** Casts a deterministic ray at the centroid of the first emitted triangle. */
function rayAtFirstTriangle(geometry: {
  getAttribute(name: string): PositionAttribute;
}): Raycaster {
  const position = geometry.getAttribute('position');
  const x = (position.getX(0) + position.getX(1) + position.getX(2)) / 3;
  const y = (position.getY(0) + position.getY(1) + position.getY(2)) / 3;
  const z = (position.getZ(0) + position.getZ(1) + position.getZ(2)) / 3;
  const camera = new PerspectiveCamera(60, 1, 0.01, 1000);
  camera.position.set(x, y, z + 20);
  camera.lookAt(x, y, z);
  camera.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0, 0), camera);
  return raycaster;
}

/**
 * 2. Section and projection claims, through a real Three.js `Raycaster`.
 *
 * The intersection is produced by Three and handed to the adapter unchanged.
 * Manufacturing an intersection literal would test the adapter's tolerance for
 * a shape this consumer invented rather than the one Three actually returns.
 */
export function representationClaims(): void {
  const scenario = buildScenario(2);

  const edges = new ProjectedEdges3D(
    scenario.complex,
    new PerspectiveProjection({ fromDim: 4, viewDistance: 4 }),
    { color: 0x1e293b }
  );
  assert(
    (edges.object.material as LineBasicMaterial).color.getHex() === 0x1e293b,
    'ProjectedEdges3D ignored its explicit color'
  );
  let rejectedUnknownOption = false;
  try {
    new ProjectedEdges3D(
      scenario.complex,
      new PerspectiveProjection({ fromDim: 4, viewDistance: 4 }),
      { linewidth: 2 } as never
    );
  } catch (error) {
    rejectedUnknownOption = error instanceof Error && /linewidth/.test(error.message);
  }
  assert(rejectedUnknownOption, 'ProjectedEdges3D accepted an unknown linewidth option');

  const section = buildSection(scenario);
  section.object.updateMatrixWorld(true);
  const sectionHits: Intersection[] = rayAtFirstTriangle(section.geometry).intersectObject(
    section.object,
    false
  );
  assert(sectionHits.length > 0, 'the section ray met no triangle');
  const sectionReport = describeRepresentationHitN(
    representationHitFromSlicedComplex(section, sectionHits[0]!)
  );
  assert(
    sectionReport.ambient.claim === 'unique',
    `section claim was ${sectionReport.ambient.claim}`
  );
  assert(
    sectionReport.source.kind === 'cell',
    `section source kind was ${sectionReport.source.kind}`
  );
  const firstTet = section.sourceTetOfFace(0);
  assert(
    section.facesOfSourceTet(firstTet).includes(0),
    'the source-tetrahedron inverse did not return its rendered face'
  );
  const chartPoint: [number, number, number] = [0.1, -0.2, 0.3];
  const roundTrip = section.slice.projectPointToChart(
    section.slice.embedPoint(chartPoint)
  );
  assert(
    Math.abs(roundTrip.signedDistance) < 1e-12 &&
      roundTrip.coordinates.every((value, axis) =>
        Math.abs(value - chartPoint[axis]!) < 1e-12
      ),
    'the slice chart round trip did not preserve its point and residual'
  );

  const surface = buildSurface(scenario);
  surface.object.updateMatrixWorld(true);
  const surfaceHits: Intersection[] = rayAtFirstTriangle(surface.geometry).intersectObject(
    surface.object,
    false
  );
  assert(surfaceHits.length > 0, 'the projection ray met no triangle');
  const surfaceReport = describeRepresentationHitN(
    representationHitFromProjectedSurface(surface, surfaceHits[0]!)
  );
  const projected = surfaceReport.ambient;
  assert(
    projected.claim === 'on-selected-primitive',
    `projection claim was ${projected.claim}`
  );
  assert(
    projected.ambiguity === 'projection-overlap',
    `the projection claim reported ambiguity ${projected.ambiguity}`
  );

  section.dispose();
  surface.dispose();
  edges.dispose();
}

/** Euclidean norm over a bivector's plane coefficients. */
const bivectorNorm = (bivector: BivectorN): number =>
  Math.hypot(...Array.from(bivector.coeffs));

/**
 * 4. Physics package composition.
 *
 * An installation smoke test over an existing golden path: mass properties
 * from the same source, a nonzero angular state, and a deterministic interval.
 */
export function physicsComposition(): void {
  const boundary = tetrahedralizeCuboidCells(
    createHypercube({ dim: 4, size: 1, maxCellDimension: 3 })
  );
  const properties = massPropertiesFromCellComplex4(boundary);
  const body = RigidBody4.fromMassProperties(properties);
  const spin = BivectorN.fromPlanes(4, [
    { i: 0, j: 3, angle: 0.7 },
    { i: 1, j: 2, angle: -0.2 }
  ]);
  body.setAngularVelocityWorld(spin);

  // Torque-free and gravity-free, so the angular state is conserved.
  const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] });
  world.addBody(body);
  const before = body.rotation.clone();
  for (let step = 0; step < 120; step += 1) world.step(1 / 120);

  assert(
    rotorIdentityResidual(before) !== rotorIdentityResidual(body.rotation),
    'the orientation did not change over 120 steps'
  );
  const pose = new TransformN(4, body.rotation, body.position);
  assert(
    Array.from(pose.position.data).every((value) => Number.isFinite(value)),
    'reported position is not finite'
  );
  // Spin(4): the rotor's matrix stays orthogonal, so its round trip through
  // SO(4) and back is identity to numerical tolerance.
  const matrix = body.rotation.toMatrix().data;
  assert(
    Array.from(matrix).every((value) => Number.isFinite(value)),
    'the orientation matrix is not finite'
  );
  assert(
    Math.abs(bivectorNorm(body.angularVelocityWorld()) - bivectorNorm(spin)) < 1e-6,
    'angular velocity magnitude drifted under a torque-free interval'
  );

  // Compose the open-domain initialization query through packed public
  // artifacts. The target is refused, the anchor is feasible, and the first
  // feasible geometric sample is alpha = 0.5.
  const particle = new XpbdParticleN({
    id: 'packed-open-domain',
    position: [0.2],
    inverseMass: 1
  });
  const provider: XpbdConservativeForceProviderN = {
    id: 'packed-positive-gap',
    dimension: 1,
    particles: [particle],
    evaluate: () => ({ potentialEnergy: 0, forces: [new VecN([0])] }),
    evaluateAt: (positionOf) => {
      if (!(positionOf(particle).data[0]! > 0.1)) {
        throw new XpbdPotentialDomainErrorN(
          'packed-positive-gap',
          'outside-open-domain',
          'the packed coordinate must exceed 0.1'
        );
      }
      return { potentialEnergy: 0, forces: [new VecN([0])] };
    }
  };
  const problem = compileXpbdIncrementalPotentialProblemN({
    dimension: 1,
    particles: [particle],
    predictedPositions: [new VecN([0.05])],
    deltaTime: 0.1,
    providers: [provider]
  });
  const recovery = recoverXpbdIncrementalPotentialFeasibleBaseN({
    problem,
    anchorCoordinates: [0.2],
    targetCoordinates: [0.05]
  });
  assert(
    recovery.status === 'recovered' && recovery.fraction === 0.5,
    `feasible-base recovery returned ${recovery.status}`
  );

  // The finite R4 source feature remains authoritative through the physics
  // package: the closest point reports barycentric source coordinates, while
  // its paired filter certifies a prefix rather than inventing an impact time.
  const simplexGroup = {
    dim: 3,
    verticesPerCell: 4,
    kind: 'simplex' as const,
    indices: new Uint32Array([0, 1, 2, 3])
  };
  const simplexSource = new CellComplex(4, new Float64Array([
    0, 0, 0, 0,
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0
  ]), [simplexGroup]);
  const simplexReference = createSourceSimplexReferenceN(
    createSourceCellReferenceN(simplexSource, simplexGroup, 0)
  );
  const simplexParticle = new XpbdParticleN({
    id: 'packed-simplex-point', position: [0.2, 0.2, 0.2, 0.5]
  });
  const simplexBarrierOptions: XpbdParticleSourceSimplexBarrierNOptions = {
    id: 'packed-simplex-barrier',
    particle: simplexParticle,
    simplex: simplexReference,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1,
    // Required on the exact source dimensions 1..3: a dimensionless Euclidean
    // radius on the published unit direction, authored by the caller because
    // no universal value exists.
    maximumDirectionError: 2 ** -12
  };
  const simplexBarrier = new XpbdParticleSourceSimplexBarrierN(
    simplexBarrierOptions
  );
  const simplexEvaluation: XpbdParticleSourceSimplexBarrierEvaluationN =
    simplexBarrier.evaluate();
  assert(
    Math.abs(simplexEvaluation.barrierCoordinate - 0.45) < 1e-12 &&
      Math.abs(simplexEvaluation.barrierActivation - 0.75) < 1e-12 &&
      Math.abs(simplexEvaluation.separationNormal.data[3]! - 1) < 1e-12,
    'the finite source-simplex barrier lost its distance differential'
  );
  assert(
    simplexEvaluation.projection.coordinate.reference === simplexReference,
    'the finite source-simplex barrier lost source identity'
  );

  const simplexFilterOptions:
    XpbdParticleSourceSimplexBarrierStepFilterNOptions = {
      id: 'packed-simplex-filter', barrier: simplexBarrier
    };
  const simplexFilter = new XpbdParticleSourceSimplexBarrierStepFilterN(
    simplexFilterOptions
  );
  const simplexFilterEvaluation:
    XpbdParticleSourceSimplexBarrierStepFilterEvaluationN =
      simplexFilter.evaluate({
        dimension: 4,
        requestedStepLength: 1,
        positionBefore: () => new VecN([0.2, 0.2, 0.2, 0.5]),
        positionAfter: () => new VecN([0.2, 0.2, 0.2, -0.5])
      });
  const simplexFilterEvidence:
    XpbdParticleSourceSimplexBarrierStepFilterEvidenceN =
      simplexFilterEvaluation;
  assert(
    simplexFilterEvaluation.status === 'limited' &&
      simplexFilterEvaluation.certification === 'global-lipschitz' &&
      simplexFilterEvidence.certifiedFraction > 0 &&
      simplexFilterEvidence.certifiedFraction < 0.5,
    'the finite source-simplex segment was not conservatively limited'
  );
  assert(
    !('endDistance' in simplexFilterEvaluation) &&
      !('endMargin' in simplexFilterEvaluation),
    'the step filter published endpoint evidence it never queries'
  );
  const domainReason: XpbdParticleSourceSimplexBarrierDomainReasonN =
    'at-or-below-minimum-distance';
  const filterReason:
    XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN =
      'initial-domain-violation';
  assert(
    String(domainReason) !== String(filterReason),
    'potential and step-filter refusal vocabularies collapsed together'
  );

  // ---------------------------------------------------------------------
  // The typed uncertainty boundary, exercised against the PACKED build.
  //
  // A consumer of the tarball must be able to branch on WHY an exact
  // point--simplex decision could not be published, must see the direction
  // policy applied consistently, and must not be handed fabricated evidence.
  // These are behavioural drives, not string or filename checks.
  // ---------------------------------------------------------------------
  const uncertaintySegment = (row: readonly number[]) => {
    const group: CellGroup = {
      dim: 1, verticesPerCell: 2, kind: 'simplex',
      indices: Uint32Array.from([0, 1])
    };
    const complex = new CellComplex(
      2, new Float64Array([0, 0, row[0]!, row[1]!]), [group]
    );
    return createSourceSimplexReferenceN(
      createSourceCellReferenceN(complex, group, 0)
    );
  };
  const uncertaintyBarrier = (
    at: readonly number[], row: readonly number[],
    options: { maximumDirectionError?: number, activationDistance?: number } = {}
  ) => new XpbdParticleSourceSimplexBarrierN({
    id: 'packed-uncertainty',
    particle: new XpbdParticleN({ id: 'packed-uncertainty-point', position: [...at] }),
    simplex: uncertaintySegment(row),
    minimumDistance: 0,
    activationDistance: options.activationDistance ?? 50,
    stiffness: 1,
    maximumDirectionError: options.maximumDirectionError ?? 2 ** -12
  });

  // Each of the four publication reasons reaches a consumer as its own typed
  // reason. Collapsing any two would leave this set short.
  const packedReasons = new Set<string>();
  for (const [at, row] of [
    [[7, Number.MIN_VALUE], [25, 0]],
    [[7 * 2 ** 600, 2 ** (600 - 1074 + 53)], [25 * 2 ** 600, 0]],
    [[2 ** -1070, 2 ** -1070], [2 ** -1070, 0]],
    [[5e-324, 2 ** -1074], [2 ** 500, 0]]
  ] as const) {
    try {
      uncertaintyBarrier(at, row).evaluate();
      assert(false, 'an unpublishable exact decision was silently accepted');
    } catch (error) {
      assert(
        error instanceof XpbdPotentialDomainErrorN,
        'an unpublishable exact decision arrived as an untyped Error'
      );
      packedReasons.add(
        (error as XpbdPotentialDomainErrorN<string>).reason
      );
    }
  }
  assert(
    packedReasons.size === 4,
    'the four exact publication reasons were collapsed before the consumer'
  );

  // The direction policy admits a bound exactly equal to it and refuses only a
  // strictly larger one, at BOTH released entry points.
  const policyProbe = uncertaintyBarrier([7, 2 ** -30], [25, 0]);
  const policyWitness = policyProbe.evaluate().pointSimplex;
  assert(
    policyWitness !== undefined && policyWitness.status === 'projected',
    'the exact arm published no point--simplex witness'
  );
  const measuredBound = policyWitness!.error.directionErrorBound;
  assert(
    measuredBound > 0, 'the direction probe published no positive bound'
  );
  uncertaintyBarrier([7, 2 ** -30], [25, 0], {
    maximumDirectionError: measuredBound
  }).evaluate();
  const strictPolicy = uncertaintyBarrier([7, 2 ** -30], [25, 0], {
    maximumDirectionError: measuredBound * (1 - 2 ** -52)
  });
  for (const call of [
    () => strictPolicy.evaluate(),
    () => strictPolicy.evaluateAt(() => new VecN([7, 2 ** -30]))
  ]) {
    let policyRefusal: unknown;
    try {
      call();
    } catch (error) {
      policyRefusal = error;
    }
    assert(
      policyRefusal instanceof XpbdPotentialDomainErrorN &&
        (policyRefusal as XpbdPotentialDomainErrorN<string>).reason ===
          'direction-error-exceeds-policy',
      'the direction policy was not applied at both entry points'
    );
  }

  // A segment whose ENDPOINT cannot be published still certifies: the proof
  // reads the start state and the displacement, never the endpoint distance.
  const unit = 2 ** -475;
  const endpointBarrier = uncertaintyBarrier(
    [4 * unit, 1], [2 ** 600, 0], { activationDistance: 4 }
  );
  const endpointFilter = new XpbdParticleSourceSimplexBarrierStepFilterN({
    id: 'packed-endpoint-filter', barrier: endpointBarrier
  });
  const endpointCertified = endpointFilter.evaluate({
    dimension: 2, requestedStepLength: 1,
    positionBefore: () => new VecN([4 * unit, 1]),
    positionAfter: () => new VecN([unit, 1])
  });
  assert(
    endpointCertified.status === 'safe' &&
      endpointCertified.certifiedFraction === 1,
    'an unpublishable endpoint destroyed a certifiable prefix'
  );

  // An unpublishable START refuses with the forwarded reason and reports no
  // start evidence at all — not NaN, not zero, not a sentinel.
  const startFilter = new XpbdParticleSourceSimplexBarrierStepFilterN({
    id: 'packed-start-filter',
    barrier: uncertaintyBarrier([5e-324, 2 ** -1074], [2 ** 500, 0])
  });
  const startRefusal = startFilter.evaluate({
    dimension: 2, requestedStepLength: 1,
    positionBefore: () => new VecN([5e-324, 2 ** -1074]),
    positionAfter: () => new VecN([1, 1])
  });
  assert(
    startRefusal.status === 'indeterminate' &&
      startRefusal.reason === 'point-simplex-weight-underflow',
    'an unpublishable start lost its typed cause'
  );
  assert(
    !('startDistance' in startRefusal) &&
      !('startMargin' in startRefusal) &&
      !('certification' in startRefusal) &&
      Object.values(startRefusal).every((value) => !Number.isNaN(value)),
    'a refusal fabricated evidence the filter never held'
  );

  // The packed graph must also compose the source-indexed candidate layer.
  // A far dynamic source point is culled while the near point retains the
  // same obstacle reference and the crossing segment names its blocker.
  const candidateSource = new CellComplex(4, new Float64Array([
    0.2, 0.2, 0.2, 0.5,
    5, 5, 5, 5
  ]), []);
  const candidateBinding = compileXpbdParticleBindingN({
    id: 'packed-candidates', source: candidateSource
  });
  const candidateFamily = compileXpbdParticleSourceSimplexBarrierFamilyN({
    maximumDirectionError: 2 ** -12,
    id: 'packed-finite-obstacle',
    binding: candidateBinding,
    obstacle: simplexSource,
    simplexGroup,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1
  });
  const candidateEvaluation:
    XpbdParticleSourceSimplexBarrierFamilyEvaluationN =
      candidateFamily.evaluate();
  assert(
    candidateEvaluation.candidateQuery.diagnostics.possiblePairs === 2 &&
      candidateEvaluation.candidateQuery.diagnostics.candidatePairs === 1 &&
      candidateEvaluation.activeCandidates.length === 1,
    'the packed finite-obstacle family lost candidate reduction'
  );
  assert(
    candidateEvaluation.activeCandidates[0]!.candidate.simplex ===
      candidateFamily.simplices[0],
    'the packed finite-obstacle family lost source identity'
  );
  const candidateStep:
    XpbdParticleSourceSimplexBarrierFamilyStepFilterEvaluationN =
      candidateFamily.stepFilter.evaluate({
        dimension: 4,
        requestedStepLength: 1,
        positionBefore: (candidate) => candidate.position.clone(),
        positionAfter: (candidate) => candidate === candidateBinding.particles[0]
          ? new VecN([0.2, 0.2, 0.2, -0.5])
          : candidate.position.clone()
      });
  assert(
    candidateStep.status === 'limited' &&
      candidateStep.blockingCandidateId ===
        'packed-finite-obstacle/source-vertex/0/obstacle-cell/0',
    'the packed finite-obstacle family lost its segment blocker'
  );

  // The world-scoped nonlinear advance must be reachable from the packed
  // graph by package name alone, with the world supplying dimension, particle
  // order, gravity, and providers. Registered projected-XPBD features are not
  // representable by this path and must be named rather than skipped.
  const worldSource = new CellComplex(
    4, new Float64Array([0.25, 0.25, 0.25, 0.06]), []
  );
  const worldBinding = compileXpbdParticleBindingN({
    id: 'packed-world-dynamic', source: worldSource
  });
  for (const bound of worldBinding.particles) bound.velocity.data[3] = -6;
  const worldFamily = compileXpbdParticleSourceSimplexBarrierFamilyN({
    maximumDirectionError: 2 ** -12,
    id: 'packed-world-contact',
    binding: worldBinding,
    obstacle: simplexSource,
    simplexGroup,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1.7
  });
  const optimizationWorld = new XpbdWorldN({
    dimension: 4, gravity: [0, 0, 0, -9.81]
  });
  worldBinding.addToWorld(optimizationWorld);
  worldFamily.addToWorld(optimizationWorld);

  const advance: XpbdIncrementalPotentialWorldStepN =
    stepXpbdIncrementalPotentialWorldN({
      world: optimizationWorld,
      deltaTime: 1 / 120,
      stepFilters: [worldFamily.stepFilter],
      warmStart: 'feasible-inertial-prediction',
      minimization: { directionPolicy: 'steepest-descent' }
    });
  const selection: XpbdIncrementalPotentialWorldSelectionN = advance.selection;
  assert(
    selection.dimension === 4 &&
      selection.particleIds.length === 1 &&
      selection.providerIds.join() === 'packed-world-contact' &&
      selection.stepFilterIds.join() === worldFamily.stepFilter.id,
    'the packed world-scoped step lost its registration evidence'
  );
  const worldDiagnosis: XpbdIncrementalPotentialDiagnosisN = advance.diagnosis;
  assert(
    advance.step.status === 'applied' && worldDiagnosis.condition === 'progressed',
    `the packed world-scoped step reported ${advance.step.status}`
  );
  // The inadmissible prediction never reaches the recovery uncertified: the
  // registered filter limits the warm-start movement to its certified prefix,
  // and the recovery then accepts that certified endpoint in one trial.
  const worldCertification = advance.step.warmStartCertification;
  assert(
    worldCertification !== undefined &&
      worldCertification.outcome === 'limited' &&
      worldCertification.certifiedStepLength > 0 &&
      worldCertification.certifiedStepLength <
        worldCertification.requestedStepLength,
    'the packed world-scoped step lost its warm-start certification evidence'
  );
  const worldRecovery = advance.step.feasibleBaseRecovery;
  assert(
    worldRecovery !== undefined &&
      worldRecovery.status === 'target-feasible',
    'the packed world-scoped step lost its feasible-base evidence'
  );

  // The same world with a projected velocity response registered is refused
  // by name, and nothing is advanced.
  const beforeRefusal = optimizationWorld.particles[0]!.position.toArray();
  const response: XpbdVelocityResponseN = {
    id: 'packed-damping',
    dimension: 4,
    particles: optimizationWorld.particles,
    apply: () => ({})
  };
  optimizationWorld.addVelocityResponse(response);
  let refusal = '';
  try {
    stepXpbdIncrementalPotentialWorldN({
      world: optimizationWorld,
      deltaTime: 1 / 120,
      stepFilters: [worldFamily.stepFilter]
    });
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  assert(
    refusal.includes('velocity response ("packed-damping")'),
    `an unsupported registry was not named: ${refusal || '(no error thrown)'}`
  );
  assert(
    optimizationWorld.particles[0]!.position.toArray().join() ===
      beforeRefusal.join(),
    'a refused world-scoped configuration still advanced the scene'
  );

  // The static candidate hierarchy must compile and run from the packed graph,
  // must agree with the exhaustive oracle on identity and order, and must
  // refuse a moved obstacle rather than answering from stale bounds.
  const hierarchy: XpbdSourceSimplexAabbHierarchyN =
    compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: simplexSource, simplexGroup, leafSize: 1
    });
  const hierarchyQuery: XpbdSourceSimplexAabbQueryN = hierarchy.query({
    min: [-0.5, -0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5, 0.5]
  });
  const hierarchyDiagnostics: XpbdSourceSimplexAabbQueryDiagnosticsN =
    hierarchyQuery.diagnostics;
  assert(
    hierarchyQuery.cellIndices.join() === '0' &&
      hierarchyDiagnostics.totalSimplices === 1 &&
      hierarchyQuery.simplices[0] === hierarchy.simplices[0],
    'the packed hierarchy lost source identity or cell order'
  );

  const acceleratedBinding = compileXpbdParticleBindingN({
    id: 'packed-accelerated', source: candidateSource
  });
  const acceleratedFamily = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: 'packed-finite-obstacle',
    binding: acceleratedBinding,
    obstacle: simplexSource,
    simplexGroup,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1,
    maximumDirectionError: 2 ** -12,
    candidateHierarchy: compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: simplexSource, simplexGroup, leafSize: 1
    })
  });
  const exhaustiveIds = candidateFamily
    .queryAt((particle) => particle.position.clone())
    .candidates.map((candidate) => candidate.id);
  const acceleratedQuery = acceleratedFamily
    .queryAt((particle) => particle.position.clone());
  assert(
    exhaustiveIds.length > 0,
    'the packed differential compared two empty candidate sets'
  );
  assert(
    acceleratedQuery.candidates.map((candidate) => candidate.id).join('|') ===
      exhaustiveIds.join('|'),
    'the packed hierarchy changed candidate identity or order'
  );
  assert(
    acceleratedQuery.diagnostics.strategy === 'static-aabb-hierarchy' &&
      candidateEvaluation.candidateQuery.diagnostics.strategy === 'exhaustive',
    'the packed strategy evidence was not inspectable'
  );

  // A moved static obstacle is a loud refusal, not a silent rebuild.
  const originalCoordinate = simplexSource.positions[0]!;
  simplexSource.positions[0] = originalCoordinate + 1;
  let staleRefusal = '';
  try {
    acceleratedFamily.queryAt((particle) => particle.position.clone());
  } catch (error) {
    staleRefusal = error instanceof Error ? error.message : String(error);
  }
  simplexSource.positions[0] = originalCoordinate;
  assert(
    staleRefusal.includes('indexed obstacle moved'),
    `a moved packed obstacle was not refused: ${staleRefusal || '(no error)'}`
  );
  assert(
    acceleratedFamily
      .queryAt((particle) => particle.position.clone())
      .candidates.length === exhaustiveIds.length,
    'restoring the packed obstacle did not restore the candidate set'
  );

  // Source-retained cosine-fold bending must compile and evaluate from the
  // packed graph, with its filter travelling alongside the provider.
  const bendPositions: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      bendPositions.push(column, row, row === 1 ? 0.45 : 0, 0);
    }
  }
  const bendIndices: number[] = [];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      const at = row * 3 + column;
      bendIndices.push(at, at + 1, at + 3, at + 1, at + 4, at + 3);
    }
  }
  const bendGroup = {
    key: 'packed-membrane', dim: 2, verticesPerCell: 3, kind: 'simplex' as const,
    indices: new Uint32Array(bendIndices)
  };
  const membrane = new CellComplex(
    4, new Float64Array(bendPositions), [bendGroup]
  );
  const membraneBinding = compileXpbdParticleBindingN({
    id: 'packed-membrane-points', source: membrane
  });
  const bending = compileXpbdSourceSimplexCosineBendingFamilyN({
    id: 'packed-membrane-bending',
    binding: membraneBinding,
    simplexGroup: bendGroup,
    stiffness: 25,
    restCoordinate: 1,
    minimumMeasureRatio: 0.05
  });
  const bendingEvaluation: XpbdSourceSimplexCosineBendingFamilyEvaluationN =
    bending.evaluate();
  const firstBendHinge: XpbdSourceSimplexBendingHingeN | undefined =
    bending.hinges[0];
  assert(
    bendingEvaluation.hingeCount === 8 &&
      bendingEvaluation.boundaryFaceCount === 8 &&
      firstBendHinge !== undefined,
    'the packed bending family lost its interior/boundary accounting'
  );
  assert(
    bendingEvaluation.potentialEnergy > 0,
    'the packed creased membrane reported no bending energy'
  );
  assert(
    bendingEvaluation.netForceResidual < 1e-12 &&
      bendingEvaluation.rotationalFirstMomentResidual < 1e-12,
    'the packed bending gradient lost its rigid null modes'
  );
  assert(
    bendingEvaluation.weighting === 'unit-discrete' &&
      bendingEvaluation.weight === 1,
    'the packed bending family hid its weighting policy'
  );

  // The pure evaluator reproduces any hinge exactly.
  const reproduced = evaluateSimplexHingeCosineN({
    sharedFace: firstBendHinge!.sharedVertices.map(
      (vertex) => membraneBinding.particles[vertex]!.position.clone()
    ),
    oppositeA:
      membraneBinding.particles[firstBendHinge!.oppositeVertexA]!.position.clone(),
    oppositeB:
      membraneBinding.particles[firstBendHinge!.oppositeVertexB]!.position.clone()
  });
  assert(
    reproduced.status === 'evaluated' &&
      reproduced.coordinate === bendingEvaluation.hinges[0]!.geometry.coordinate,
    'the packed pure evaluator disagreed with the family'
  );

  const bendingTerms: XpbdSourceSimplexCosineBendingFamilyTermsN =
    bending.incrementalPotentialTerms();
  assert(
    bendingTerms.providers.length === 1 && bendingTerms.stepFilters.length === 1 &&
      bendingTerms.stepFilters[0] === bending.stepFilter,
    'the packed bending provider arrived without its paired filter'
  );

  const bendingWorld = new XpbdWorldN({ dimension: 4 });
  membraneBinding.addToWorld(bendingWorld);
  bending.addToWorld(bendingWorld);
  const membraneBefore = membraneBinding.particles.map(
    (particle) => particle.position.toArray().join()
  );
  const membraneStep = stepXpbdIncrementalPotentialWorldN({
    world: bendingWorld,
    deltaTime: 1 / 120,
    stepFilters: [bending.stepFilter],
    warmStart: 'feasible-inertial-prediction',
    minimization: { directionPolicy: 'steepest-descent' }
  });
  const membraneAfter = membraneBinding.particles.map(
    (particle) => particle.position.toArray().join()
  );
  assert(
    membraneStep.step.status === 'applied',
    `the packed membrane step reported ${membraneStep.step.status}`
  );
  assert(
    membraneBefore.join('|') !== membraneAfter.join('|'),
    'the packed membrane step advanced nothing'
  );
}

/** Centroid of the first triangle the equivalent section product emits. */
function firstEmittedSectionPoint(): readonly [number, number, number] {
  const section = buildSection(buildScenario(2));
  const position = section.geometry.getAttribute('position') as unknown as PositionAttribute;
  const point: [number, number, number] = [
    (position.getX(0) + position.getX(1) + position.getX(2)) / 3,
    (position.getY(0) + position.getY(1) + position.getY(2)) / 3,
    (position.getZ(0) + position.getZ(1) + position.getZ(2)) / 3
  ];
  section.dispose();
  return point;
}

/**
 * 5. The orthotope source, end to end from packed artifacts.
 *
 * Composes all four non-adapter packages: core constructs it, physics
 * integrates its mass, and the two experiment packages compile a document that
 * advances it. Its analytic mass is closed-form, so the assertion is against
 * arithmetic rather than against another call.
 */
export async function hyperrectangleComposition(): Promise<void> {
  const edges = [2, 3, 5, 7];
  const body = tetrahedralizeCuboidCells(
    createHyperrectangle({ dim: 4, edgeLengths: edges, maxCellDimension: 3 })
  );

  const properties = massPropertiesFromCellComplex4(body);
  const volume = edges.reduce((product, edge) => product * edge, 1);
  assert(
    Math.abs(properties.volume - volume) < 1e-6,
    `volume was ${properties.volume}, expected ${volume}`
  );
  // I_ij = m(a_i^2 + a_j^2)/12, so the six plane inertias are all different.
  const inertia = Array.from(properties.inertiaDiagonal);
  assert(inertia.length === 6, `expected six plane inertias, got ${inertia.length}`);
  assert(
    Math.max(...inertia) - Math.min(...inertia) > 1,
    'the packed body is isotropic, so it is not the orthotope'
  );

  const document = {
    schema: 'holotope.experiment/0',
    title: 'Packed orthotope',
    ambientDim: 4,
    sources: {
      body: {
        kind: 'core.source.hyperrectangle',
        dim: 4,
        edgeLengths: edges,
        tetrahedralize: true
      }
    },
    models: {
      tumble: {
        kind: 'physics.model.rigid4',
        source: 'body',
        initialAngularMomentum: [0.4, 0.15, 0, 0.9, -0.3, 0],
        fixedStep: 1 / 120,
        substeps: 2
      }
    },
    representations: {
      shadow: {
        kind: 'core.representation.perspective',
        source: 'body',
        fromDim: 4,
        viewDistance: 14,
        transform: { fromModel: 'tumble' },
        product: 'both'
      }
    }
  } satisfies ExperimentDocumentV0;
  const prepared = await prepareExperimentDocumentV0(document);
  assert(prepared.ok, `orthotope document did not prepare: ${describeFailures(prepared)}`);

  const compiled = compileExperimentDocumentV0(prepared.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
  assert(compiled.ok, `orthotope document did not compile: ${describeFailures(compiled)}`);
  const compilation = compiled.value;

  const model = compilation.get('tumble');
  assert(model.ok && model.value.category === 'model', 'the rigid model did not compile');
  const runtime = model.value.runtime as ExperimentRigidModel4RuntimeV0;
  const before = Array.from(runtime.body.rotation.left);

  const advanced = compilation.advance(240);
  assert(advanced.ok, 'the orthotope model did not advance');
  assert(advanced.value.step === 240, `advanced ${advanced.value.step} steps`);

  const after = Array.from(runtime.body.rotation.left);
  assert(
    after.some((value, index) => value !== before[index]),
    'the orientation did not change over 240 steps'
  );
  assert(after.every((value) => Number.isFinite(value)), 'orientation is not finite');

  compilation.dispose();
}

interface ProbeOutput {
  readonly sourceCellStatus: ExperimentProbeSourceCellStatusV0;
  readonly sourceCell?: unknown;
  readonly sourceCellPrecision?: unknown;
  readonly ambientPoint?: unknown;
}

/**
 * Reads a probe result, checking rather than asserting its shape.
 *
 * `invoke` returns JSON, so a cast would let a probe that reported nothing
 * pass as one that reported a status. Validating here means the absence of
 * `sourceCellStatus` is itself a conformance failure.
 */
function readProbeOutput(output: unknown, label: string): ProbeOutput {
  assert(
    typeof output === 'object' && output !== null,
    `the ${label} probe returned ${typeof output}, not an object`
  );
  const record = output as Record<string, unknown>;
  assert(
    typeof record['sourceCellStatus'] === 'string',
    `the ${label} probe reported no sourceCellStatus`
  );
  return record as unknown as ProbeOutput;
}

/**
 * 3. Headless experiment probe.
 *
 * Prepares and compiles a v0 document with both public compilers, then probes
 * the section and the projection. The probe reports its reasoning as a status
 * whether or not it found a cell, so an absent `sourceCell` is never read as
 * the answer.
 */
export async function experimentProbe(): Promise<void> {
  const probeAction = {
    id: 'probe',
    title: 'Probe',
    description: 'Reports headless evidence for a chart point.',
    inputSchema: {
      type: 'object',
      properties: {
        representation: { type: 'string' },
        point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
      },
      required: ['representation', 'point'],
      additionalProperties: false
    },
    outputSchema: { type: 'object' },
    readOnly: true,
    destructive: false,
    idempotent: true,
    deterministic: true,
    supportsPreview: false,
    budget: { maxMillis: 50 },
    operation: { kind: 'probe' }
  } as const;

  const prepared = await prepareExperimentDocumentV0({
    schema: 'holotope.experiment/0',
    title: 'Packed consumer',
    ambientDim: 4,
    sources: {
      tesseract: {
        kind: 'core.source.hypercube',
        dim: 4,
        size: 2,
        tetrahedralize: true
      }
    },
    representations: {
      section: {
        kind: 'core.representation.section4',
        source: 'tesseract',
        normal: [0, 0, 0, 1],
        offset: 0,
        frame: 'canonical'
      },
      shadow: {
        kind: 'core.representation.perspective',
        source: 'tesseract',
        fromDim: 4,
        viewDistance: 4,
        product: 'both'
      }
    },
    actions: [probeAction]
  });
  assert(prepared.ok, `document did not prepare: ${describeFailures(prepared)}`);

  const compiled = compileExperimentDocumentV0(prepared.value, {
    compilers: [coreExperimentCompilerV0(), physicsExperimentCompilerV0()]
  });
  assert(compiled.ok, `document did not compile: ${describeFailures(compiled)}`);
  const compilation = compiled.value;

  // A point the section actually emitted, rather than a guessed coordinate:
  // the w = 0 cut of a solid tesseract is a solid cube, and its triangles are
  // that cube's boundary, so an interior point is on no emitted cell.
  const probePoint = firstEmittedSectionPoint();
  const inSection = compilation.invoke('probe', {
    representation: 'section',
    point: probePoint
  });
  const section = readProbeOutput(inSection.output, 'section');
  assert(
    section.sourceCellStatus === 'resolved',
    `section sourceCellStatus was ${section.sourceCellStatus}`
  );
  assert(section.sourceCell !== undefined, 'a resolved section probe named no source cell');
  assert(
    section.sourceCellPrecision === 'exact' || section.sourceCellPrecision === 'renderer',
    `section sourceCellPrecision was ${String(section.sourceCellPrecision)}`
  );

  const inProjection = compilation.invoke('probe', {
    representation: 'shadow',
    point: probePoint
  });
  const shadow = readProbeOutput(inProjection.output, 'projection');
  // A perspective projection is many-to-one, so it may not name one source
  // cell and a globally unique ambient point from a chart coordinate alone.
  assert(
    shadow.sourceCellStatus !== 'resolved' || shadow.ambientPoint === undefined,
    'a perspective probe manufactured a globally unique R4 point'
  );

  compilation.dispose();
}

export function barrierOrderGuard(): void {
  /**
   * NC1's permanent packed ownership: a JavaScript or erased consumer of the
   * PACKED package must not be able to omit or malform `order` silently.
   * Every call here goes through an erased alias, exactly the shape type
   * erasure leaves behind.
   */
  const erased = evaluateClampedLogBarrierAtOrderN as unknown as (
    inputs: { coordinate: number; activation: number; stiffness: number },
    order?: unknown
  ) => { readonly active: boolean };
  const inputs = { coordinate: 0.5, activation: 1, stiffness: 1 };
  const invalid: readonly unknown[] = [
    undefined, null, 3, '1', 1.5, -1, Number.NaN, new Number(1), true
  ];
  for (const order of invalid) {
    let outcome = 'returned';
    try {
      erased(inputs, order);
    } catch (error) {
      outcome = error instanceof ClampedLogBarrierInputErrorN
        ? 'typed' : 'untyped';
    }
    assert(outcome === 'typed',
      `order ${String(order)} was not rejected with the typed error`);
  }
  let omitted = 'returned';
  try {
    (erased as (i: typeof inputs) => unknown)(inputs);
  } catch (error) {
    omitted = error instanceof ClampedLogBarrierInputErrorN
      ? 'typed' : 'untyped';
  }
  assert(omitted === 'typed', 'an omitted order was not rejected');
  // Valid erased orders still return their exact promised arities.
  const arities = [0, 1, 2].map((order) =>
    Object.keys(erased(inputs, order)).length);
  assert(arities.join('/') === '3/4/5',
    `valid orders returned arities ${arities.join('/')}`);
}

export function barrierInputSnapshot(): void {
  /**
   * P66E-PUB-S: the packed evaluator must read each scalar from the caller's
   * object exactly once, and the value it validates, computes from and
   * publishes must be that one snapshot. Driven here with an accessor-backed
   * input, the ordinary JavaScript shape a lazy config or units wrapper has.
   */
  const scripted = (values: readonly number[]): {
    inputs: { coordinate: number; activation: number; stiffness: number };
    reads: { coordinate: number };
  } => {
    const reads = { coordinate: 0 };
    const inputs = {
      get coordinate(): number {
        const value = values[Math.min(reads.coordinate, values.length - 1)]!;
        reads.coordinate += 1;
        return value;
      },
      get activation(): number { return 1; },
      get stiffness(): number { return 1; }
    };
    return { inputs, reads };
  };

  // Three different valid values: one read, and the first is authoritative.
  const drifting = scripted([0.5, 0.25, 0.125]);
  const result = evaluateClampedLogBarrierAtOrderN(drifting.inputs, 2);
  assert(drifting.reads.coordinate === 1,
    `packed evaluator read coordinate ${drifting.reads.coordinate} times`);
  assert(result.inputs.coordinate === 0.5,
    `published coordinate was ${result.inputs.coordinate}, not the snapshot`);
  // The published record replays to the identical result on plain data.
  const replay = evaluateClampedLogBarrierAtOrderN(result.inputs, 2);
  assert(result.secondDerivative.available === replay.secondDerivative.available,
    'replay availability differs from the original');
  if (result.secondDerivative.available && replay.secondDerivative.available) {
    assert(Object.is(result.secondDerivative.value,
      replay.secondDerivative.value), 'replay value differs from the original');
  }

  // Valid first, invalid later: the first snapshot is evaluated.
  const later = scripted([0.5, -1]);
  const evaluated = evaluateClampedLogBarrierAtOrderN(later.inputs, 0);
  assert(evaluated.inputs.coordinate === 0.5
    && evaluated.energy.available,
  'a later invalid value reached the published result');

  // Invalid first, valid later: the captured invalid snapshot is rejected.
  const first = scripted([-1, 0.5]);
  let rejected = 'returned';
  try {
    evaluateClampedLogBarrierAtOrderN(first.inputs, 0);
  } catch (error) {
    rejected = error instanceof ClampedLogBarrierInputErrorN
      ? 'typed' : 'untyped';
  }
  assert(rejected === 'typed',
    `an invalid captured snapshot was ${rejected}, not rejected`);

  // A throwing caller getter escapes unchanged.
  class ConsumerFault extends Error {}
  const exploding = {
    get coordinate(): number { throw new ConsumerFault('consumer getter'); },
    get activation(): number { return 1; },
    get stiffness(): number { return 1; }
  };
  let escaped = 'none';
  try {
    evaluateClampedLogBarrierAtOrderN(exploding, 0);
  } catch (error) {
    escaped = error instanceof ConsumerFault ? 'unchanged'
      : error instanceof ClampedLogBarrierInputErrorN ? 'converted' : 'other';
  }
  assert(escaped === 'unchanged',
    `a caller getter exception was ${escaped}`);
}

const describeFailures = (result: { readonly ok: boolean }): string =>
  JSON.stringify('failures' in result ? result.failures : null);

/**
 * Measure-weighted normal contact, composed the way an outside caller must.
 *
 * The claim under test is the one that distinguishes this law from a
 * per-vertex barrier: a contact resists by the SIZE of the touching feature,
 * not by how many vertices happen to describe it, so splitting a cell does not
 * answer twice. The fixture below is at CONSTANT distance, which is the case
 * where subdivision is exactly additive — for a nonconstant integrand a fixed
 * finite quadrature samples different places and the estimate moves, and this
 * check asserts that too rather than implying the opposite. Both the published
 * types and the refusal channel are annotated explicitly, so the packed
 * declarations must carry each of them.
 */
export function measureWeightedContact(): void {
  const floor = new CellComplex(3, Float64Array.from([
    -40, 0, -40, 60, 0, -40, -40, 0, 60
  ]), [{
    dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2])
  }]);
  const obstacle = createSourceSimplexReferenceN(
    createSourceCellReferenceN(floor, floor.groups[0]!, 0)
  );

  /** One segment cell, parallel to the floor, as its own compiled term. */
  const segment = (from: number, to: number): XpbdSourceSimplexMeasureBarrierTermsN => {
    const complex = new CellComplex(3, Float64Array.from([
      from, 0.5, 0, to, 0.5, 0
    ]), [{
      dim: 1, verticesPerCell: 2, kind: 'simplex',
      indices: Uint32Array.from([0, 1])
    }]);
    const options: CompileXpbdSourceSimplexMeasureBarrierNOptions = {
      id: `contact-${from}`,
      binding: compileXpbdParticleBindingN({
        id: `sheet-${from}`, source: complex
      }),
      cell: createSourceSimplexReferenceN(
        createSourceCellReferenceN(complex, complex.groups[0]!, 0)
      ),
      obstacle,
      minimumDistance: 0.05,
      activationDistance: 1,
      stiffness: 2,
      maximumDirectionError: 1e-6
    };
    return compileXpbdSourceSimplexMeasureBarrierN(options);
  };

  const whole = segment(0, 1);
  const energy = (terms: XpbdSourceSimplexMeasureBarrierTermsN): number =>
    terms.provider.evaluate().potentialEnergy;
  const refined = energy(segment(0, 0.5)) + energy(segment(0.5, 1));
  assert(energy(whole) > 0, 'contact within the activation distance must resist');
  assert(Math.abs(refined - energy(whole)) / energy(whole) < 1e-12,
    'a CONSTANT-distance cell must be exactly additive under subdivision');

  // ...and the general case, so this check cannot be read as invariance. A
  // tilted cell samples different distances once it is split, and the fixed
  // rule returns a materially different estimate.
  const tilted = (from: readonly number[], to: readonly number[]): number => {
    const complex = new CellComplex(3, Float64Array.from([...from, ...to]), [{
      dim: 1, verticesPerCell: 2, kind: 'simplex',
      indices: Uint32Array.from([0, 1])
    }]);
    const id = `tilted-${from[0]}-${from[1]}`;
    return compileXpbdSourceSimplexMeasureBarrierN({
      id, binding: compileXpbdParticleBindingN({ id, source: complex }),
      cell: createSourceSimplexReferenceN(
        createSourceCellReferenceN(complex, complex.groups[0]!, 0)
      ),
      obstacle, minimumDistance: 0.05, activationDistance: 1, stiffness: 2,
      maximumDirectionError: 1e-6
    }).provider.evaluate().potentialEnergy;
  };
  const oneCell = tilted([0, 0.2, 0], [1, 0.8, 0]);
  const twoCells = tilted([0, 0.2, 0], [0.5, 0.5, 0])
    + tilted([0.5, 0.5, 0], [1, 0.8, 0]);
  assert(Math.abs((twoCells - oneCell) / oneCell - 0.27005799281125603) < 1e-12,
    'the tilted refinement must move the estimate by the measured 27.0%');

  // The provider registers as an ordinary conservative world term, and the
  // paired filter as an ordinary admissible-step policy.
  const world = new XpbdWorldN({ dimension: 3, gravity: [0, -9.81, 0] });
  for (const particle of whole.provider.particles) world.addParticle(particle);
  world.addForceProvider(whole.provider);
  const advance = stepXpbdIncrementalPotentialWorldN({
    world, deltaTime: 1 / 120, stepFilters: [whole.stepFilter],
    warmStart: 'feasible-inertial-prediction'
  });
  assert(advance.step.status === 'applied',
    'a measure-weighted contact term must drive a complete world step');

  // The refusal channel is the released one, and it names this law.
  let refusal: XpbdSourceSimplexMeasureBarrierDomainReasonN | undefined;
  try {
    whole.provider.evaluateAt((particle) => {
      const position = particle.position.clone();
      position.data[1] = 0;
      return position;
    });
  } catch (error) {
    if (!(error instanceof XpbdPotentialDomainErrorN)) throw error;
    assert(error.lawId === 'contact-0', 'a refusal must name the term it came from');
    refusal = error.reason as XpbdSourceSimplexMeasureBarrierDomainReasonN;
  }
  assert(refusal === 'zero-or-intersecting',
    'a cell in the obstacle\'s own plane has no separating direction');
  // The publication sub-union is nameable on its own, as its release is.
  const publication: XpbdSourceSimplexMeasureBarrierPublicationReasonN =
    'point-simplex-value-underflow';
  assert(publication.startsWith('point-simplex-'),
    'publication reasons stay distinguishable from measured-distance ones');
}

/**
 * Runtime privacy of the measure-weighted contact term, in erased JavaScript.
 *
 * This is the check the declaration lane structurally cannot make. TypeScript
 * `private` is an annotation: it erases, and against the first implementation's
 * packed artifacts an ordinary consumer could replace the non-authorable rule
 * (energy −16.4%), obtain and mutate the internal static-obstacle snapshot
 * (energy +88.2%), and set `filter.conservativeScale = 1.2` — moving the
 * certificate from `0.405` to `0.54` and covering a placement the law itself
 * refuses. The last one is a safety defect, not an encapsulation preference,
 * which is why this runs here, against the tarballs, and not only in a test.
 *
 * Closure captures are not claimed to be inspectable. What is established is
 * the absence of any outward route: no key, no symbol, no descriptor, no
 * getter, no prototype member, and nothing recoverable by copying.
 */
export function measureContactRuntimePrivacy(): void {
  const floor = new CellComplex(3, Float64Array.from([
    -40, 0, -40, 60, 0, -40, -40, 0, 60
  ]), [{
    dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2])
  }]);
  const obstacle = createSourceSimplexReferenceN(
    createSourceCellReferenceN(floor, floor.groups[0]!, 0)
  );
  let serial = 0;
  const build = (
    from: readonly number[], to: readonly number[]
  ): XpbdSourceSimplexMeasureBarrierTermsN => {
    const complex = new CellComplex(3, Float64Array.from([...from, ...to]), [{
      dim: 1, verticesPerCell: 2, kind: 'simplex',
      indices: Uint32Array.from([0, 1])
    }]);
    const id = `privacy-${serial++}`;
    return compileXpbdSourceSimplexMeasureBarrierN({
      id, binding: compileXpbdParticleBindingN({ id, source: complex }),
      cell: createSourceSimplexReferenceN(
        createSourceCellReferenceN(complex, complex.groups[0]!, 0)
      ),
      obstacle, minimumDistance: 0.05, activationDistance: 1, stiffness: 2,
      maximumDirectionError: 1e-6
    });
  };
  // The tilted fixture the review used, whose energy the attacks moved.
  const TILTED_A = [0, 0.2, 0];
  const TILTED_B = [1, 0.8, 0];
  const control = build(TILTED_A, TILTED_B).provider.evaluate().potentialEnergy;

  // --- what is reachable at all -------------------------------------------
  const { provider, stepFilter } = build(TILTED_A, TILTED_B);
  const providerKeys = Reflect.ownKeys(provider).map(String).sort().join(',');
  const filterKeys = Reflect.ownKeys(stepFilter).map(String).sort().join(',');
  assert(providerKeys === 'dimension,evaluate,evaluateAt,id,particles',
    `provider exposes exactly the released members, got: ${providerKeys}`);
  assert(filterKeys === 'dimension,evaluate,id,particles',
    `filter exposes exactly the released members, got: ${filterKeys}`);
  for (const exposed of [provider, stepFilter] as unknown as object[]) {
    assert(Object.isFrozen(exposed), 'exposed instances must be frozen');
    assert(!Object.isExtensible(exposed), 'exposed instances must be sealed');
    assert(Object.getPrototypeOf(exposed) === Object.prototype,
      'exposed instances must carry no class prototype');
    assert(Object.getOwnPropertySymbols(exposed).length === 0,
      'exposed instances must carry no symbol keys');
    for (const key of Reflect.ownKeys(exposed)) {
      const descriptor = Object.getOwnPropertyDescriptor(exposed, key)!;
      assert(descriptor.writable === false,
        `${String(key)} must be non-writable`);
      assert(descriptor.configurable === false,
        `${String(key)} must be non-configurable`);
      assert(descriptor.get === undefined,
        `${String(key)} must not be a getter`);
    }
    const copied = Object.keys({ ...exposed }).sort().join(',');
    assert(copied === Object.keys(exposed).sort().join(','),
      'a spread copy must not recover more than the original');
    const serialized = JSON.stringify(exposed) ?? '';
    for (const secret of ['rule', 'referenceMeasure', 'staticObstacle',
      'conservativeScale', 'provider', 'cellParticles', 'stiffness']) {
      assert(!(secret in (exposed as Record<string, unknown>)),
        `${secret} must not be reachable on an exposed instance`);
      assert(!serialized.includes(`"${secret}"`),
        `${secret} must not survive serialization`);
    }
  }
  assert(Object.isFrozen(provider.particles),
    'the exposed particle container must be frozen');

  // --- the eight named attacks --------------------------------------------
  const attacks: readonly [string, (t: XpbdSourceSimplexMeasureBarrierTermsN)
    => void][] = [
    ['provider.rule', (t) => {
      (t.provider as unknown as Record<string, unknown>).rule =
        [{ ownSlot: 0, coefficients: [0.5, 0.5], weight: 1 }];
    }],
    ['provider.referenceMeasure', (t) => {
      (t.provider as unknown as Record<string, unknown>).referenceMeasure = 1e9;
    }],
    ['provider.staticObstacle', (t) => {
      (t.provider as unknown as Record<string, unknown>).staticObstacle =
        new Float64Array(9);
    }],
    ['filter.conservativeScale', (t) => {
      (t.stepFilter as unknown as Record<string, unknown>)
        .conservativeScale = 1.2;
    }],
    ['filter.provider', (t) => {
      (t.stepFilter as unknown as Record<string, unknown>).provider =
        { evaluateAt: () => { throw new Error('attacker'); } };
    }],
    ['provider.id', (t) => {
      (t.provider as unknown as Record<string, unknown>).id = 'changed';
    }],
    ['provider.dimension', (t) => {
      (t.provider as unknown as Record<string, unknown>).dimension = 999;
    }],
    ['provider.particles', (t) => {
      (t.provider as unknown as Record<string, unknown>).particles = [];
    }]
  ];
  for (const [name, attack] of attacks) {
    const target = build(TILTED_A, TILTED_B);
    const keysBefore = Reflect.ownKeys(target.provider).length
      + Reflect.ownKeys(target.stepFilter).length;
    let threw = false;
    try { attack(target); } catch { threw = true; }
    assert(threw, `${name}: the assignment must throw`);
    assert(Reflect.ownKeys(target.provider).length
      + Reflect.ownKeys(target.stepFilter).length === keysBefore,
      `${name}: no new own property may appear`);
    assert(target.provider.evaluate().potentialEnergy === control,
      `${name}: the energy must remain bit-identical to the clean control`);
  }

  // --- the safety consequence, separately ---------------------------------
  // The endpoint-clear / interior-breach sweep: both ends admissible, the
  // middle not. The honest certificate stops short of the breach, and an
  // outside consumer cannot widen it.
  const sweep = build([0, 0.5, 0], [1, 0.5, 0]);
  const placedAt = (t: number) => (particle: XpbdParticleN): VecN => {
    const position = particle.position.clone();
    position.data[1] = 0.5 - t;
    return position;
  };
  const certify = (): number => {
    const evaluation = sweep.stepFilter.evaluate({
      dimension: 3, requestedStepLength: 1,
      positionBefore: placedAt(0), positionAfter: placedAt(1)
    });
    assert(evaluation.status === 'limited',
      'the sweep must be certified as a strict prefix');
    return evaluation.status === 'limited' ? evaluation.maximumStepLength : 0;
  };
  const honest = certify();
  let inflated = false;
  try {
    (sweep.stepFilter as unknown as Record<string, unknown>)
      .conservativeScale = 1.2;
    inflated = true;
  } catch { /* the frozen instance refuses, which is the point */ }
  assert(!inflated, 'the conservative scale must not be assignable');
  assert(certify() === honest,
    'the certificate must be unchanged by the attempt');
  // The breach the inflated certificate used to cover is still outside it.
  const breaches = (limit: number): boolean => {
    for (let sample = 0; sample <= 400; sample++) {
      try { sweep.provider.evaluateAt(placedAt(limit * sample / 400)); }
      catch (error) {
        if (error instanceof XpbdPotentialDomainErrorN) return true;
        throw error;
      }
    }
    return false;
  };
  assert(!breaches(honest),
    'the honest certified prefix must contain no refused placement');
  assert(breaches(honest * (1.2 / 0.9)),
    'the calibration must show the inflated prefix really did breach');

  // --- the caller's own inputs stay the caller's --------------------------
  // Mutating the source complex after compilation is harmless, which is what
  // makes the internal snapshot worth protecting in the first place.
  const stable = build(TILTED_A, TILTED_B);
  const beforeMutation = stable.provider.evaluate().potentialEnergy;
  for (let axis = 1; axis < floor.positions.length; axis += 3) {
    floor.positions[axis] = 0.1;
  }
  assert(stable.provider.evaluate().potentialEnergy === beforeMutation,
    'a post-compilation edit of the caller complex must not reach the term');
  for (let axis = 1; axis < floor.positions.length; axis += 3) {
    floor.positions[axis] = 0;
  }
}

/**
 * Inherited-operation receivers, in erased JavaScript against the tarballs.
 *
 * Own-property privacy is not the whole boundary. A closure variable has no
 * key and no descriptor, but the moment it is handed to an INHERITED operation
 * — a typed array's `length` accessor, an array's `forEach` or its
 * `Symbol.iterator` — the value arrives at a caller-replaceable function as
 * `this`. Against the previous implementation that was a permanent handle on
 * the law: a consumer could receive the persistent static-obstacle buffer,
 * restore the intrinsic, mutate the retained reference afterwards, and move a
 * later clean evaluation from `0.5211907392559832` to `1.7968655070577886`.
 *
 * What is asserted here is not that hostile same-realm metaprogramming can
 * observe nothing — it can, and the ephemeral per-call geometry below is
 * observed on purpose. It is that **no captured object can change a future
 * evaluation**: everything reachable this way is either immutable or freshly
 * built for one call and never read again.
 *
 * Caching the intrinsics at module load would not be a fix; a consumer can
 * replace them before this package is initialized. Nothing is cached. The
 * implementation reads persistent state only by index, and carries its counts
 * as plain numbers, because an Array's `length` is an own property while a
 * typed array's is inherited.
 */
export function measureContactInheritedReceiverPrivacy(): void {
  const buildFloor = (): CellComplex => new CellComplex(3, Float64Array.from([
    -40, 0, -40, 60, 0, -40, -40, 0, 60
  ]), [{
    dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2])
  }]);
  let serial = 0;
  const build = (
    from: readonly number[], to: readonly number[]
  ): XpbdSourceSimplexMeasureBarrierTermsN => {
    const floor = buildFloor();
    const complex = new CellComplex(3, Float64Array.from([...from, ...to]), [{
      dim: 1, verticesPerCell: 2, kind: 'simplex',
      indices: Uint32Array.from([0, 1])
    }]);
    const id = `receiver-${serial++}`;
    return compileXpbdSourceSimplexMeasureBarrierN({
      id, binding: compileXpbdParticleBindingN({ id, source: complex }),
      cell: createSourceSimplexReferenceN(
        createSourceCellReferenceN(complex, complex.groups[0]!, 0)
      ),
      obstacle: createSourceSimplexReferenceN(
        createSourceCellReferenceN(floor, floor.groups[0]!, 0)
      ),
      minimumDistance: 0.05, activationDistance: 1, stiffness: 2,
      maximumDirectionError: 1e-6
    });
  };
  const TILTED_A = [0, 0.2, 0];
  const TILTED_B = [1, 0.8, 0];
  const CONTROL = 0.5211907392559832;
  const typedArrayPrototype = Object.getPrototypeOf(
    Float64Array.prototype
  ) as object;
  const OBSTACLE_BYTES = 9 * 8;

  assert(build(TILTED_A, TILTED_B).provider.evaluate().potentialEnergy
    === CONTROL, 'the tilted control energy must be the documented one');

  /** Mutates every retained buffer the way the review's exploit did. */
  const raiseObstacle = (buffers: readonly Float64Array[]): void => {
    for (const buffer of buffers) {
      for (let entry = 1; entry < 9; entry += 3) buffer[entry] = 0.2;
    }
  };

  // --- 1. construction-time typed-array method interception ---------------
  {
    const seen = new Set<Float64Array>();
    const original = Float64Array.prototype.subarray;
    let terms: XpbdSourceSimplexMeasureBarrierTermsN;
    try {
      // eslint-disable-next-line func-names
      Float64Array.prototype.subarray = function (
        this: Float64Array, ...rest: readonly number[]
      ): Float64Array {
        if (this.byteLength === OBSTACLE_BYTES) seen.add(this);
        return original.apply(this, rest as unknown as [number, number]);
      };
      terms = build(TILTED_A, TILTED_B);
    } finally {
      Float64Array.prototype.subarray = original;
    }
    assert(Float64Array.prototype.subarray === original,
      'the intrinsic must be restored before the consequence is measured');
    assert(seen.size === 0,
      `construction must take no subarray of obstacle geometry, saw ${seen.size}`);
    raiseObstacle([...seen]);
    assert(terms.provider.evaluate().potentialEnergy === CONTROL,
      'construction-time interception must not reach a later evaluation');
  }

  // --- 2. evaluation-time typed-array getter interception -----------------
  //     and 6. restore, mutate, re-evaluate cleanly
  //     and 7. repeated evaluations prove the capture is per-call
  {
    const terms = build(TILTED_A, TILTED_B);
    const descriptor = Object.getOwnPropertyDescriptor(
      typedArrayPrototype, 'length'
    )!;
    const capture = (): Float64Array[] => {
      const seen = new Set<Float64Array>();
      try {
        Object.defineProperty(typedArrayPrototype, 'length', {
          configurable: true,
          get(this: Float64Array): number {
            if (this instanceof Float64Array
              && this.byteLength === OBSTACLE_BYTES) seen.add(this);
            return (descriptor.get as () => number).call(this);
          }
        });
        terms.provider.evaluate();
      } finally {
        Object.defineProperty(typedArrayPrototype, 'length', descriptor);
      }
      return [...seen];
    };
    const first = capture();
    const second = capture();
    assert(Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get
      === descriptor.get, 'the inherited accessor must be restored');
    // Captured — deliberately, and reported rather than denied.
    assert(first.length > 0,
      'the query does read its geometry through the inherited accessor');
    // EPHEMERAL: no captured object survives from one call to the next.
    const shared = first.filter((buffer) => second.includes(buffer));
    assert(shared.length === 0,
      `captured geometry must be per-call, ${shared.length} survived`);
    // Mutable in itself, which is why identity is what matters.
    const probe = first[0]!;
    const held = probe[1]!;
    probe[1] = 99;
    assert(probe[1] === 99, 'the ephemeral copy is an ordinary buffer');
    probe[1] = held;
    // The decisive consequence test: mutate everything retained, then run a
    // clean evaluation under genuine intrinsics.
    raiseObstacle([...first, ...second]);
    assert(terms.provider.evaluate().potentialEnergy === CONTROL,
      'mutating retained geometry must not change a later clean evaluation');
    assert(terms.provider.evaluate().potentialEnergy === CONTROL,
      'and must not change any evaluation after that either');
  }

  // --- 3, 4, 5. array forEach and iterator interception -------------------
  {
    const terms = build(TILTED_A, TILTED_B);
    const sweep = build([0, 0.5, 0], [1, 0.5, 0]);
    const captured: unknown[] = [];
    const originalForEach = Array.prototype.forEach;
    const originalIterator = Array.prototype[Symbol.iterator];
    try {
      // eslint-disable-next-line func-names
      Array.prototype.forEach = function (
        this: unknown[], ...rest: readonly unknown[]
      ): void {
        captured.push(this);
        return originalForEach.apply(
          this, rest as unknown as [(value: unknown) => void]
        );
      };
      Array.prototype[Symbol.iterator] = function (
        this: unknown[]
      ): IterableIterator<unknown> {
        captured.push(this);
        return originalIterator.call(this);
      };
      terms.provider.evaluate();
      sweep.stepFilter.evaluate({
        dimension: 3, requestedStepLength: 1,
        positionBefore: (particle) => particle.position.clone(),
        positionAfter: (particle) => particle.position.clone()
      });
    } finally {
      Array.prototype.forEach = originalForEach;
      Array.prototype[Symbol.iterator] = originalIterator;
    }
    assert(Array.prototype.forEach === originalForEach
      && Array.prototype[Symbol.iterator] === originalIterator,
      'both array intrinsics must be restored');
    const arrays = captured.filter((value): value is unknown[] =>
      Array.isArray(value) && value.length > 0);
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null;
    // No private partition array is a receiver. The PUBLIC particle list is
    // allowed to be one — it is published API, and no privacy claim covers it.
    const partitions = arrays.filter((value) =>
      isRecord(value[0]) && 'inverseMass' in value[0]
      && value !== terms.provider.particles
      && value !== sweep.provider.particles);
    assert(partitions.length === 0,
      `no private partition array may be a receiver, saw ${partitions.length}`);
    // The fixed rule is never a receiver at all.
    const rules = arrays.filter((value) =>
      isRecord(value[0]) && 'ownSlot' in value[0]);
    assert(rules.length === 0,
      `the fixed rule must never be a receiver, saw ${rules.length}`);
    assert(terms.provider.evaluate().potentialEnergy === CONTROL,
      'the law is unchanged after the array intrinsics are restored');
  }
}

/**
 * Warm-start segment certification, composed the way an outside caller must.
 *
 * The released `v0.0.20` composition installed an automatically selected
 * minimizer base without consulting any registered step filter, so an
 * unsigned contact law — which calls a far-side placement feasible with
 * energy exactly zero — let the warm start begin the solve on the other side
 * of the obstacle and the world applied the full crossing. The paired filter,
 * asked independently about the same movement, answered `limited` at 0.315.
 *
 * This drives that exact scene through the packed artifacts: the movement is
 * now certified, the 0.315 prefix is what gets installed, no crossing occurs,
 * and the uncertified paths (no filter registered; explicit
 * `initialPositions`) keep their measured behavior.
 */
export function warmStartSegmentCertification(): void {
  const scene = (velocityY: number): {
    readonly particles: readonly XpbdParticleN[];
    readonly provider: XpbdConservativeForceProviderN;
    readonly stepFilter: XpbdIncrementalPotentialStepFilterN;
  } => {
    const complex = new CellComplex(3,
      Float64Array.from([0, 0.4, 0, 1, 0.4, 0]),
      [{ dim: 1, verticesPerCell: 2, kind: 'simplex',
         indices: Uint32Array.from([0, 1]) }]);
    const binding = compileXpbdParticleBindingN({
      id: 'warm-cell', source: complex, velocity: () => [0, velocityY, 0]
    });
    const floor = new CellComplex(3,
      Float64Array.from([-40, 0, -40, 60, 0, -40, -40, 0, 60]),
      [{ dim: 2, verticesPerCell: 3, kind: 'simplex',
         indices: Uint32Array.from([0, 1, 2]) }]);
    const terms = compileXpbdSourceSimplexMeasureBarrierN({
      id: 'warm-contact',
      binding,
      cell: createSourceSimplexReferenceN(
        createSourceCellReferenceN(complex, complex.groups[0]!, 0)),
      obstacle: createSourceSimplexReferenceN(
        createSourceCellReferenceN(floor, floor.groups[0]!, 0)),
      minimumDistance: 0.05,
      activationDistance: 0.5,
      stiffness: 2,
      maximumDirectionError: 1e-6
    });
    return {
      particles: binding.particles,
      provider: terms.provider,
      stepFilter: terms.stepFilter
    };
  };
  const yOf = (particles: readonly XpbdParticleN[]): number =>
    particles[0]!.position.data[1]!;

  // The N1 counterexample: certified, limited to 0.315, never through.
  const certified = scene(-1);
  const result = stepXpbdIncrementalPotentialN({
    dimension: 3,
    particles: certified.particles,
    providers: [certified.provider],
    stepFilters: [certified.stepFilter],
    deltaTime: 1,
    warmStart: 'feasible-inertial-prediction'
  });
  const certification = result.warmStartCertification;
  assert(certification !== undefined,
    'the automatic warm start must carry certification evidence');
  assert(certification.outcome === 'limited',
    'the far-side movement must be limited, not accepted');
  assert(Math.abs(certification.certifiedStepLength /
    certification.requestedStepLength - 0.315) < 1e-12,
    'the certified prefix must be the filter\'s published 0.315');
  assert(yOf(certified.particles) > 0.05,
    'the cell must never cross the obstacle with the filter registered');

  // The uncertified paths keep their measured behavior.
  const unfiltered = scene(-1);
  const crossed = stepXpbdIncrementalPotentialN({
    dimension: 3,
    particles: unfiltered.particles,
    providers: [unfiltered.provider],
    deltaTime: 1,
    warmStart: 'feasible-inertial-prediction'
  });
  assert(crossed.status === 'applied'
    && !('warmStartCertification' in crossed)
    && Math.abs(yOf(unfiltered.particles) - -0.6) < 1e-12,
    'with no filter registered there is no certification and no protection');

  const safe = scene(-0.05);
  const preserved = stepXpbdIncrementalPotentialN({
    dimension: 3,
    particles: safe.particles,
    providers: [safe.provider],
    stepFilters: [safe.stepFilter],
    deltaTime: 1,
    warmStart: 'feasible-inertial-prediction'
  });
  assert(preserved.status === 'applied'
    && preserved.warmStartCertification?.outcome === 'safe',
    'a fully certified movement must remain a safe, applied step');
}
