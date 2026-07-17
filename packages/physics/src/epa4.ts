import { VecN } from '@holotope/core';
import {
  gjkDistance,
  type GjkFeaturePair,
  type GjkOptions,
  type GjkResult,
  type GjkSimplexVertexN
} from './gjk.js';
import type { SupportShapeN } from './support-shape.js';

export interface EpaOptions4 {
  /** GJK intersection policy used to enter EPA. */
  readonly gjkOptions?: GjkOptions;
  /** Expansion steps after the seed contains the origin. Default 96. */
  readonly maxIterations?: number;
  /** Support expansions allowed while enclosing the origin. Default 32. */
  readonly maxSeedIterations?: number;
  /** Hard tetrahedral-facet budget. Default 4096. */
  readonly maxFacets?: number;
  /** Relative support-gap termination tolerance. Default 1e-10. */
  readonly relativeTolerance?: number;
  /** World-space support-gap/contact tolerance. Default 1e-10. */
  readonly absoluteTolerance?: number;
  /** Scale-relative affine-rank and facet-volume band. Default 1e-12. */
  readonly degeneracyTolerance?: number;
  /** Scale-relative facet visibility band. Default 1e-12. */
  readonly visibilityTolerance?: number;
  /** Dimensionless tetrahedral barycentric band. Default 1e-10. */
  readonly barycentricTolerance?: number;
  /** Retain one compact record per expansion. Default false. */
  readonly recordTrace?: boolean;
}

export type EpaStatus4 =
  | 'separated'
  | 'touching'
  | 'penetrating'
  | 'indeterminate';

export type EpaTerminationReason4 =
  | 'gjk-separated'
  | 'gjk-iteration-limit'
  | 'support-gap'
  | 'duplicate-support'
  | 'degenerate-seed'
  | 'seed-iteration-limit'
  | 'seed-stalled'
  | 'degenerate-facet'
  | 'non-manifold-horizon'
  | 'invalid-hull'
  | 'invalid-closest-facet'
  | 'facet-limit'
  | 'iteration-limit';

export interface EpaFacetCertificate4 {
  readonly vertexIndices: readonly [number, number, number, number];
  readonly featurePairs: readonly GjkFeaturePair[];
  /** Convex weights aligned with vertexIndices and featurePairs. */
  readonly weights: Float64Array;
  /** Outward normal of the Minkowski-difference boundary facet. */
  readonly minkowskiNormal: VecN;
  readonly distance: number;
  readonly conditionEstimate: number;
  readonly projectionConditionEstimate: number;
  readonly witnessResidual: number;
}

/** Single ordered EPA witness; deliberately not a persistent manifold type. */
export interface EpaPointContactPatch4 {
  readonly kind: 'point';
  readonly normal: VecN;
  readonly pointA: VecN;
  readonly pointB: VecN;
  readonly alignmentShift: number;
  readonly translationA: VecN;
  readonly resolvedPoint: VecN;
  readonly penetrationDepth: number;
}

export interface EpaTraceEntry4 {
  readonly iteration: number;
  readonly facetCount: number;
  readonly supportCount: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly supportGap: number;
  readonly visibleFacetCount: number;
  readonly horizonTriangleCount: number;
}

export interface EpaTerminationCertificate4 {
  readonly reason: EpaTerminationReason4;
  readonly supportGap: number | null;
  readonly threshold: number | null;
  readonly seedIterations: number;
  readonly expansionIterations: number;
  readonly supportCount: number;
  readonly facetCount: number;
  readonly maxFacetCount: number;
}

export interface EpaPenetrationResult4 {
  readonly status: EpaStatus4;
  readonly intersects: boolean | null;
  /** Minimum-translation magnitude when convergence is certified. */
  readonly penetrationDepth: number | null;
  /** Unit direction from ordered B toward ordered A. */
  readonly normal: VecN | null;
  readonly pointA: VecN | null;
  readonly pointB: VecN | null;
  readonly patch: EpaPointContactPatch4 | null;
  /** Inner-polytope lower bound on penetration magnitude. */
  readonly lowerBound: number | null;
  /** Support-plane upper bound along the selected direction. */
  readonly upperBound: number | null;
  readonly errorBound: number | null;
  readonly facet: EpaFacetCertificate4 | null;
  readonly gjk: GjkResult;
  readonly termination: EpaTerminationCertificate4;
  readonly trace?: readonly EpaTraceEntry4[];
}

interface ResolvedEpaOptions4 {
  maxIterations: number;
  maxSeedIterations: number;
  maxFacets: number;
  relativeTolerance: number;
  absoluteTolerance: number;
  degeneracyTolerance: number;
  visibilityTolerance: number;
  barycentricTolerance: number;
  recordTrace: boolean;
  gjkOptions: GjkOptions;
}

interface Facet4 {
  indices: [number, number, number, number];
  normal: VecN;
  offset: number;
  conditionEstimate: number;
  projectionWeights: Float64Array | null;
  projectionConditionEstimate: number;
  key: string;
}

interface Hull4 {
  vertices: GjkSimplexVertexN[];
  facets: Facet4[];
  interiorPoint: VecN;
  seedIterations: number;
  maxFacetCount: number;
}

interface InsertResult4 {
  status: 'inserted' | 'inside' | 'failed';
  reason?: Extract<
    EpaTerminationReason4,
    'degenerate-facet' | 'non-manifold-horizon' | 'invalid-hull' | 'facet-limit'
  >;
  visibleFacetCount: number;
  horizonTriangleCount: number;
}

interface ClosestFacet4 {
  facet: Facet4;
  distance: number;
}

/**
 * Auditable Float64 EPA fallback for full-dimensional compact convex shapes
 * in R4. It returns one minimum-translation witness, not a persistent contact
 * manifold. Every numerical failure remains an explicit indeterminate result.
 */
export function epaPenetration4(
  shapeA: SupportShapeN,
  shapeB: SupportShapeN,
  options: EpaOptions4 = {}
): EpaPenetrationResult4 {
  if (shapeA.dim !== shapeB.dim) {
    throw new Error(
      `epaPenetration4: shape dimensions differ (${shapeA.dim} vs ${shapeB.dim})`
    );
  }
  if (shapeA.dim !== 4) {
    throw new Error('epaPenetration4: both shapes must be full-dimensional R4 shapes');
  }
  const resolved = resolveOptions(options);
  const gjk = gjkDistance(shapeA, shapeB, resolved.gjkOptions);
  if (gjk.status === 'separated') {
    return terminalResult(
      'separated',
      false,
      'gjk-separated',
      gjk,
      null,
      null,
      null,
      0,
      0,
      0,
      undefined
    );
  }
  if (gjk.status === 'iteration-limit') {
    return terminalResult(
      'indeterminate',
      null,
      'gjk-iteration-limit',
      gjk,
      null,
      null,
      null,
      0,
      0,
      0,
      undefined
    );
  }

  const seeded = seedHull(shapeA, shapeB, gjk, resolved);
  if ('reason' in seeded) {
    return terminalResult(
      'indeterminate',
      null,
      seeded.reason,
      gjk,
      seeded.lowerBound,
      null,
      null,
      seeded.seedIterations,
      0,
      seeded.supportCount,
      undefined,
      seeded.facetCount,
      seeded.maxFacetCount
    );
  }
  const hull = seeded;
  const trace: EpaTraceEntry4[] | undefined = resolved.recordTrace ? [] : undefined;

  for (let iteration = 0; iteration < resolved.maxIterations; iteration++) {
    const closest = closestFacet(hull, resolved);
    if (!closest) {
      return terminalResult(
        'indeterminate',
        null,
        'invalid-closest-facet',
        gjk,
        minimumNonnegativeOffset(hull.facets),
        null,
        null,
        hull.seedIterations,
        iteration,
        hull.vertices.length,
        trace,
        hull.facets.length,
        hull.maxFacetCount
      );
    }
    const support = supportDifference(shapeA, shapeB, closest.facet.normal);
    const supportDistance = closest.facet.normal.dot(support.point);
    const supportGap = supportDistance - closest.distance;
    const threshold =
      resolved.absoluteTolerance +
      resolved.relativeTolerance *
        Math.max(1, Math.abs(closest.distance), Math.abs(supportDistance));
    if (supportGap < -threshold) {
      return terminalResult(
        'indeterminate',
        null,
        'invalid-hull',
        gjk,
        closest.distance,
        supportDistance,
        supportGap,
        hull.seedIterations,
        iteration,
        hull.vertices.length,
        trace,
        hull.facets.length,
        hull.maxFacetCount,
        threshold
      );
    }

    const duplicate = hull.vertices.some((vertex) =>
      pointsCoincide(vertex.point, support.point, resolved.absoluteTolerance)
    );
    if (supportGap <= threshold || duplicate) {
      return convergedResult(
        closest,
        supportDistance,
        supportGap,
        duplicate ? 'duplicate-support' : 'support-gap',
        gjk,
        hull,
        iteration + 1,
        threshold,
        trace,
        resolved
      );
    }

    const newIndex = hull.vertices.length;
    hull.vertices.push(support);
    const inserted = insertVertex(hull, newIndex, resolved);
    trace?.push({
      iteration,
      facetCount: hull.facets.length,
      supportCount: hull.vertices.length,
      lowerBound: closest.distance,
      upperBound: supportDistance,
      supportGap,
      visibleFacetCount: inserted.visibleFacetCount,
      horizonTriangleCount: inserted.horizonTriangleCount
    });
    if (inserted.status !== 'inserted') {
      return terminalResult(
        'indeterminate',
        null,
        inserted.reason ?? 'invalid-hull',
        gjk,
        closest.distance,
        supportDistance,
        supportGap,
        hull.seedIterations,
        iteration + 1,
        hull.vertices.length,
        trace,
        hull.facets.length,
        hull.maxFacetCount,
        threshold
      );
    }
  }

  const closest = closestFacet(hull, resolved);
  return terminalResult(
    'indeterminate',
    null,
    'iteration-limit',
    gjk,
    closest?.distance ?? minimumNonnegativeOffset(hull.facets),
    null,
    null,
    hull.seedIterations,
    resolved.maxIterations,
    hull.vertices.length,
    trace,
    hull.facets.length,
    hull.maxFacetCount
  );
}

function seedHull(
  shapeA: SupportShapeN,
  shapeB: SupportShapeN,
  gjk: GjkResult,
  options: ResolvedEpaOptions4
): Hull4 | {
  reason: Extract<
    EpaTerminationReason4,
    | 'degenerate-seed'
    | 'seed-iteration-limit'
    | 'seed-stalled'
    | 'degenerate-facet'
    | 'non-manifold-horizon'
    | 'invalid-hull'
    | 'facet-limit'
  >;
  lowerBound: number | null;
  seedIterations: number;
  supportCount: number;
  facetCount: number;
  maxFacetCount: number;
} {
  const vertices: GjkSimplexVertexN[] = [];
  for (const vertex of gjk.simplex) addUniqueVertex(vertices, cloneVertex(vertex), options);
  if (vertices.length === 0) {
    addUniqueVertex(vertices, supportDifference(shapeA, shapeB, VecN.basis(4, 0)), options);
  }

  const selected: number[] = [];
  growIndependentSelection(vertices, selected, options);
  for (let attempt = 0; selected.length < 5 && attempt < 8; attempt++) {
    const direction = affineComplementDirection(vertices, selected, options);
    if (!direction) break;
    addUniqueVertex(vertices, supportDifference(shapeA, shapeB, direction), options);
    addUniqueVertex(
      vertices,
      supportDifference(shapeA, shapeB, direction.clone().multiplyScalar(-1)),
      options
    );
    growIndependentSelection(vertices, selected, options);
  }
  if (selected.length !== 5) {
    return {
      reason: 'degenerate-seed',
      lowerBound: null,
      seedIterations: 0,
      supportCount: vertices.length,
      facetCount: 0,
      maxFacetCount: 0
    };
  }

  const candidateVertices = vertices;
  const selectedSet = new Set(selected);
  const verticesInHull = selected.map((index) => candidateVertices[index]!);
  const remainingVertices = candidateVertices.filter((_, index) => !selectedSet.has(index));
  const interiorPoint = new VecN(4);
  for (const vertex of verticesInHull) interiorPoint.add(vertex.point);
  interiorPoint.multiplyScalar(1 / 5);
  const facets: Facet4[] = [];
  for (let omitted = 0; omitted < 5; omitted++) {
    const indices = [0, 1, 2, 3, 4].filter((index) => index !== omitted) as [
      number,
      number,
      number,
      number
    ];
    const facet = createFacet(indices, verticesInHull, interiorPoint, options);
    if (!facet) {
      return {
        reason: 'degenerate-facet',
        lowerBound: null,
        seedIterations: 0,
        supportCount: verticesInHull.length,
        facetCount: facets.length,
        maxFacetCount: facets.length
      };
    }
    facets.push(facet);
  }
  const hull: Hull4 = {
    vertices: verticesInHull,
    facets,
    interiorPoint,
    seedIterations: 0,
    maxFacetCount: facets.length
  };

  for (const vertex of remainingVertices) {
    if (hull.vertices.some((existing) =>
      pointsCoincide(existing.point, vertex.point, options.absoluteTolerance)
    )) continue;
    const index = hull.vertices.length;
    hull.vertices.push(vertex);
    const inserted = insertVertex(hull, index, options);
    if (inserted.status === 'failed') {
      return failedSeed(hull, inserted.reason ?? 'invalid-hull');
    }
  }

  for (let iteration = 0; iteration < options.maxSeedIterations; iteration++) {
    const violated = mostViolatedOriginFacet(hull.facets, options);
    if (!violated) {
      hull.seedIterations = iteration;
      return hull;
    }
    const support = supportDifference(shapeA, shapeB, violated.normal);
    const supportProjection = violated.normal.dot(support.point);
    const progress = supportProjection - violated.offset;
    const threshold = visibilityBand(violated, support.point, options);
    if (
      progress <= threshold ||
      hull.vertices.some((vertex) =>
        pointsCoincide(vertex.point, support.point, options.absoluteTolerance)
      )
    ) {
      return failedSeed(hull, 'seed-stalled', iteration);
    }
    const newIndex = hull.vertices.length;
    hull.vertices.push(support);
    const inserted = insertVertex(hull, newIndex, options);
    if (inserted.status !== 'inserted') {
      return failedSeed(
        hull,
        inserted.reason ?? 'seed-stalled',
        iteration + 1
      );
    }
  }
  return failedSeed(hull, 'seed-iteration-limit', options.maxSeedIterations);
}

function failedSeed(
  hull: Hull4,
  reason: Extract<
    EpaTerminationReason4,
    | 'seed-iteration-limit'
    | 'seed-stalled'
    | 'degenerate-facet'
    | 'non-manifold-horizon'
    | 'invalid-hull'
    | 'facet-limit'
  >,
  seedIterations = hull.seedIterations
) {
  return {
    reason,
    lowerBound: minimumNonnegativeOffset(hull.facets),
    seedIterations,
    supportCount: hull.vertices.length,
    facetCount: hull.facets.length,
    maxFacetCount: hull.maxFacetCount
  } as const;
}

function insertVertex(
  hull: Hull4,
  vertexIndex: number,
  options: ResolvedEpaOptions4
): InsertResult4 {
  const point = hull.vertices[vertexIndex]!.point;
  const visible = hull.facets.filter(
    (facet) => facet.normal.dot(point) - facet.offset > visibilityBand(facet, point, options)
  );
  if (visible.length === 0) {
    return { status: 'inside', visibleFacetCount: 0, horizonTriangleCount: 0 };
  }

  const visibleKeys = new Set(visible.map(({ key }) => key));
  const ridgeCounts = new Map<string, { indices: [number, number, number]; count: number }>();
  for (const facet of visible) {
    for (let omitted = 0; omitted < 4; omitted++) {
      const indices = facet.indices.filter((_, index) => index !== omitted) as [
        number,
        number,
        number
      ];
      indices.sort((left, right) => left - right);
      const key = indices.join(',');
      const existing = ridgeCounts.get(key);
      if (existing) existing.count++;
      else ridgeCounts.set(key, { indices, count: 1 });
    }
  }
  if (Array.from(ridgeCounts.values()).some(({ count }) => count > 2)) {
    return {
      status: 'failed',
      reason: 'non-manifold-horizon',
      visibleFacetCount: visible.length,
      horizonTriangleCount: 0
    };
  }
  const horizon = Array.from(ridgeCounts.values())
    .filter(({ count }) => count === 1)
    .map(({ indices }) => indices)
    .sort(compareIndexArrays);
  if (horizon.length < 4 || !isClosedTriangleSurface(horizon)) {
    return {
      status: 'failed',
      reason: 'non-manifold-horizon',
      visibleFacetCount: visible.length,
      horizonTriangleCount: horizon.length
    };
  }

  const retained = hull.facets.filter(({ key }) => !visibleKeys.has(key));
  const keys = new Set(retained.map(({ key }) => key));
  const added: Facet4[] = [];
  for (const triangle of horizon) {
    const indices = [...triangle, vertexIndex] as [number, number, number, number];
    const facet = createFacet(indices, hull.vertices, hull.interiorPoint, options);
    if (!facet || keys.has(facet.key)) {
      return {
        status: 'failed',
        reason: 'degenerate-facet',
        visibleFacetCount: visible.length,
        horizonTriangleCount: horizon.length
      };
    }
    keys.add(facet.key);
    added.push(facet);
  }
  if (retained.length + added.length > options.maxFacets) {
    return {
      status: 'failed',
      reason: 'facet-limit',
      visibleFacetCount: visible.length,
      horizonTriangleCount: horizon.length
    };
  }
  const facets = [...retained, ...added].sort(compareFacets);
  if (!validateHull(facets, hull.vertices, options)) {
    return {
      status: 'failed',
      reason: 'invalid-hull',
      visibleFacetCount: visible.length,
      horizonTriangleCount: horizon.length
    };
  }
  hull.facets = facets;
  hull.maxFacetCount = Math.max(hull.maxFacetCount, facets.length);
  return {
    status: 'inserted',
    visibleFacetCount: visible.length,
    horizonTriangleCount: horizon.length
  };
}

function createFacet(
  sourceIndices: [number, number, number, number],
  vertices: readonly GjkSimplexVertexN[],
  interiorPoint: VecN,
  options: ResolvedEpaOptions4
): Facet4 | undefined {
  const indices = [...sourceIndices].sort((left, right) => left - right) as [
    number,
    number,
    number,
    number
  ];
  const points = indices.map((index) => vertices[index]!.point);
  const edge1 = points[1]!.clone().sub(points[0]!);
  const edge2 = points[2]!.clone().sub(points[0]!);
  const edge3 = points[3]!.clone().sub(points[0]!);
  const rawNormal = generalizedCross4(edge1, edge2, edge3);
  const length = rawNormal.length();
  const edgeProduct = edge1.length() * edge2.length() * edge3.length();
  const scale = Math.max(1, ...points.map((point) => point.length()));
  if (
    !(length > options.degeneracyTolerance * Math.max(scale ** 3, edgeProduct)) ||
    !(edgeProduct > 0)
  ) {
    return undefined;
  }
  const normal = rawNormal.multiplyScalar(1 / length);
  let offset = normal.dot(points[0]!);
  if (normal.dot(interiorPoint) > offset) {
    normal.multiplyScalar(-1);
    offset *= -1;
  }
  const interiorGap = offset - normal.dot(interiorPoint);
  if (!(interiorGap > options.degeneracyTolerance * scale)) return undefined;
  const projection = facetProjection(points, normal, offset, options);
  return {
    indices,
    normal,
    offset,
    conditionEstimate: Math.min(1, length / edgeProduct),
    projectionWeights: projection?.weights ?? null,
    projectionConditionEstimate: projection?.conditionEstimate ?? 0,
    key: indices.join(',')
  };
}

function facetProjection(
  points: readonly VecN[],
  normal: VecN,
  offset: number,
  options: ResolvedEpaOptions4
): { weights: Float64Array; conditionEstimate: number } | undefined {
  const target = normal.clone().multiplyScalar(offset);
  const base = points[0]!;
  const edges = [
    points[1]!.clone().sub(base),
    points[2]!.clone().sub(base),
    points[3]!.clone().sub(base)
  ];
  const matrix = new Float64Array(9);
  const rhs = new Float64Array(3);
  const delta = target.clone().sub(base);
  for (let row = 0; row < 3; row++) {
    rhs[row] = edges[row]!.dot(delta);
    for (let col = 0; col < 3; col++) {
      matrix[row * 3 + col] = edges[row]!.dot(edges[col]!);
    }
  }
  const solved = solveLinearSystem(matrix, rhs, 3);
  if (!solved) return undefined;
  const weights = new Float64Array(4);
  let sum = 0;
  for (let index = 0; index < 3; index++) {
    weights[index + 1] = solved.solution[index]!;
    sum += solved.solution[index]!;
  }
  weights[0] = 1 - sum;
  if (Array.from(weights).some((weight) => weight < -options.barycentricTolerance)) {
    return undefined;
  }
  for (let index = 0; index < 4; index++) {
    if (Math.abs(weights[index]!) <= options.barycentricTolerance) weights[index] = 0;
  }
  const weightSum = weights.reduce((total, weight) => total + weight, 0);
  if (!(weightSum > 0)) return undefined;
  for (let index = 0; index < 4; index++) weights[index]! /= weightSum;
  return { weights, conditionEstimate: solved.conditionEstimate };
}

function closestFacet(
  hull: Hull4,
  options: ResolvedEpaOptions4
): ClosestFacet4 | undefined {
  const originBand = originContainmentBand(hull.vertices, options);
  let best: ClosestFacet4 | undefined;
  for (const facet of hull.facets) {
    if (facet.offset < -originBand || !facet.projectionWeights) continue;
    const candidate = { facet, distance: Math.max(0, facet.offset) };
    if (!best || closestFacetIsBetter(candidate, best)) best = candidate;
  }
  if (!best) return undefined;
  const minimumOffset = Math.max(
    0,
    Math.min(...hull.facets.map(({ offset }) => offset))
  );
  const tie = 128 * Number.EPSILON * Math.max(1, minimumOffset, best.distance);
  return minimumOffset < best.distance - tie ? undefined : best;
}

function closestFacetIsBetter(left: ClosestFacet4, right: ClosestFacet4): boolean {
  const tie = 128 * Number.EPSILON * Math.max(1, left.distance, right.distance);
  if (left.distance < right.distance - tie) return true;
  if (left.distance > right.distance + tie) return false;
  if (
    left.facet.projectionConditionEstimate !==
    right.facet.projectionConditionEstimate
  ) {
    return (
      left.facet.projectionConditionEstimate >
      right.facet.projectionConditionEstimate
    );
  }
  if (left.facet.conditionEstimate !== right.facet.conditionEstimate) {
    return left.facet.conditionEstimate > right.facet.conditionEstimate;
  }
  return left.facet.key < right.facet.key;
}

function convergedResult(
  closest: ClosestFacet4,
  supportDistance: number,
  supportGap: number,
  reason: 'support-gap' | 'duplicate-support',
  gjk: GjkResult,
  hull: Hull4,
  iterations: number,
  threshold: number,
  trace: EpaTraceEntry4[] | undefined,
  options: ResolvedEpaOptions4
): EpaPenetrationResult4 {
  const facet = closest.facet;
  const weights = facet.projectionWeights!;
  const pointA = new VecN(4);
  const pointB = new VecN(4);
  const featurePairs: GjkFeaturePair[] = [];
  for (let index = 0; index < 4; index++) {
    const vertex = hull.vertices[facet.indices[index]!]!;
    const weight = weights[index]!;
    pointA.add(vertex.pointA.clone().multiplyScalar(weight));
    pointB.add(vertex.pointB.clone().multiplyScalar(weight));
    featurePairs.push({ featureA: vertex.featureA, featureB: vertex.featureB });
  }
  const minkowskiWitness = pointA.clone().sub(pointB);
  const target = facet.normal.clone().multiplyScalar(closest.distance);
  const witnessResidual = minkowskiWitness.clone().sub(target).length();
  const normal = facet.normal.clone().multiplyScalar(-1);
  const translationA = pointB.clone().sub(pointA);
  const penetrationDepth = closest.distance;
  const patch: EpaPointContactPatch4 = {
    kind: 'point',
    normal: normal.clone(),
    pointA: pointA.clone(),
    pointB: pointB.clone(),
    alignmentShift: penetrationDepth,
    translationA,
    resolvedPoint: pointB.clone(),
    penetrationDepth
  };
  const status: EpaStatus4 = penetrationDepth <= options.absoluteTolerance
    ? 'touching'
    : 'penetrating';
  return {
    status,
    intersects: true,
    penetrationDepth,
    normal,
    pointA,
    pointB,
    patch,
    lowerBound: penetrationDepth,
    upperBound: supportDistance,
    errorBound: Math.max(0, supportGap),
    facet: {
      vertexIndices: facet.indices,
      featurePairs,
      weights: weights.slice(),
      minkowskiNormal: facet.normal.clone(),
      distance: penetrationDepth,
      conditionEstimate: facet.conditionEstimate,
      projectionConditionEstimate: facet.projectionConditionEstimate,
      witnessResidual
    },
    gjk,
    termination: {
      reason,
      supportGap,
      threshold,
      seedIterations: hull.seedIterations,
      expansionIterations: iterations,
      supportCount: hull.vertices.length,
      facetCount: hull.facets.length,
      maxFacetCount: hull.maxFacetCount
    },
    ...(trace ? { trace } : {})
  };
}

function terminalResult(
  status: EpaStatus4,
  intersects: boolean | null,
  reason: EpaTerminationReason4,
  gjk: GjkResult,
  lowerBound: number | null,
  upperBound: number | null,
  supportGap: number | null,
  seedIterations: number,
  expansionIterations: number,
  supportCount: number,
  trace: EpaTraceEntry4[] | undefined,
  facetCount = 0,
  maxFacetCount = facetCount,
  threshold: number | null = null
): EpaPenetrationResult4 {
  return {
    status,
    intersects,
    penetrationDepth: null,
    normal: null,
    pointA: null,
    pointB: null,
    patch: null,
    lowerBound,
    upperBound,
    errorBound:
      lowerBound !== null && upperBound !== null
        ? Math.max(0, upperBound - lowerBound)
        : null,
    facet: null,
    gjk,
    termination: {
      reason,
      supportGap,
      threshold,
      seedIterations,
      expansionIterations,
      supportCount,
      facetCount,
      maxFacetCount
    },
    ...(trace ? { trace } : {})
  };
}

function supportDifference(
  shapeA: SupportShapeN,
  shapeB: SupportShapeN,
  direction: VecN
): GjkSimplexVertexN {
  const supportA = shapeA.support(direction);
  const supportB = shapeB.support(direction.clone().multiplyScalar(-1));
  assertSupportPoint(supportA.point, 'shape A');
  assertSupportPoint(supportB.point, 'shape B');
  return {
    point: supportA.point.clone().sub(supportB.point),
    pointA: supportA.point.clone(),
    pointB: supportB.point.clone(),
    featureA: supportA.featureId,
    featureB: supportB.featureId
  };
}

function growIndependentSelection(
  vertices: readonly GjkSimplexVertexN[],
  selected: number[],
  options: ResolvedEpaOptions4
): void {
  for (let index = 0; index < vertices.length && selected.length < 5; index++) {
    if (selected.includes(index)) continue;
    if (selected.length === 0) {
      selected.push(index);
      continue;
    }
    const base = vertices[selected[0]!]!.point;
    const basis = affineBasis(vertices, selected, options);
    const residual = vertices[index]!.point.clone().sub(base);
    for (const axis of basis) {
      residual.sub(axis.clone().multiplyScalar(residual.dot(axis)));
    }
    const scale = vertexScale(vertices);
    if (residual.length() > options.degeneracyTolerance * scale) {
      selected.push(index);
    }
  }
}

function affineComplementDirection(
  vertices: readonly GjkSimplexVertexN[],
  selected: readonly number[],
  options: ResolvedEpaOptions4
): VecN | undefined {
  const basis = affineBasis(vertices, selected, options);
  let best: VecN | undefined;
  let bestLength = 0;
  for (let axis = 0; axis < 4; axis++) {
    const residual = VecN.basis(4, axis);
    for (const spanAxis of basis) {
      residual.sub(spanAxis.clone().multiplyScalar(residual.dot(spanAxis)));
    }
    const length = residual.length();
    if (length > bestLength) {
      best = residual;
      bestLength = length;
    }
  }
  return best && bestLength > options.degeneracyTolerance
    ? best.multiplyScalar(1 / bestLength)
    : undefined;
}

function affineBasis(
  vertices: readonly GjkSimplexVertexN[],
  selected: readonly number[],
  options: ResolvedEpaOptions4
): VecN[] {
  if (selected.length < 2) return [];
  const scale = vertexScale(vertices);
  const base = vertices[selected[0]!]!.point;
  const basis: VecN[] = [];
  for (let index = 1; index < selected.length; index++) {
    const residual = vertices[selected[index]!]!.point.clone().sub(base);
    for (const axis of basis) {
      residual.sub(axis.clone().multiplyScalar(residual.dot(axis)));
    }
    const length = residual.length();
    if (length > options.degeneracyTolerance * scale) {
      basis.push(residual.multiplyScalar(1 / length));
    }
  }
  return basis;
}

function generalizedCross4(a: VecN, b: VecN, c: VecN): VecN {
  const result = new VecN(4);
  for (let omitted = 0; omitted < 4; omitted++) {
    const columns = [0, 1, 2, 3].filter((axis) => axis !== omitted);
    const determinant = determinant3(
      a.data[columns[0]!]!, a.data[columns[1]!]!, a.data[columns[2]!]!,
      b.data[columns[0]!]!, b.data[columns[1]!]!, b.data[columns[2]!]!,
      c.data[columns[0]!]!, c.data[columns[1]!]!, c.data[columns[2]!]!
    );
    result.data[omitted] = (omitted & 1) === 0 ? determinant : -determinant;
  }
  return result;
}

function determinant3(
  a00: number, a01: number, a02: number,
  a10: number, a11: number, a12: number,
  a20: number, a21: number, a22: number
): number {
  return (
    a00 * (a11 * a22 - a12 * a21) -
    a01 * (a10 * a22 - a12 * a20) +
    a02 * (a10 * a21 - a11 * a20)
  );
}

function mostViolatedOriginFacet(
  facets: readonly Facet4[],
  options: ResolvedEpaOptions4
): Facet4 | undefined {
  const scale = Math.max(1, ...facets.map(({ offset }) => Math.abs(offset)));
  const tolerance = options.absoluteTolerance + options.visibilityTolerance * scale;
  return [...facets]
    .filter(({ offset }) => offset < -tolerance)
    .sort((left, right) => left.offset - right.offset || compareFacets(left, right))[0];
}

function validateHull(
  facets: readonly Facet4[],
  vertices: readonly GjkSimplexVertexN[],
  options: ResolvedEpaOptions4
): boolean {
  for (const facet of facets) {
    for (const vertex of vertices) {
      if (
        facet.normal.dot(vertex.point) - facet.offset >
        4 * visibilityBand(facet, vertex.point, options)
      ) {
        return false;
      }
    }
  }
  return true;
}

function isClosedTriangleSurface(
  triangles: readonly [number, number, number][]
): boolean {
  const edges = new Map<string, number>();
  for (const triangle of triangles) {
    for (const [left, right] of [
      [triangle[0], triangle[1]],
      [triangle[0], triangle[2]],
      [triangle[1], triangle[2]]
    ] as const) {
      const key = left < right ? `${left},${right}` : `${right},${left}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return Array.from(edges.values()).every((count) => count === 2);
}

function solveLinearSystem(
  matrix: Float64Array,
  rhs: Float64Array,
  size: number
): { solution: Float64Array; conditionEstimate: number } | undefined {
  const augmented = new Float64Array(size * (size + 1));
  let scale = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const value = matrix[row * size + col]!;
      augmented[row * (size + 1) + col] = value;
      scale = Math.max(scale, Math.abs(value));
    }
    augmented[row * (size + 1) + size] = rhs[row]!;
  }
  if (!(scale > 0)) return undefined;
  let minimumPivot = Number.POSITIVE_INFINITY;
  let maximumPivot = 0;
  for (let col = 0; col < size; col++) {
    let pivotRow = col;
    let pivotMagnitude = Math.abs(augmented[col * (size + 1) + col]!);
    for (let row = col + 1; row < size; row++) {
      const magnitude = Math.abs(augmented[row * (size + 1) + col]!);
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude;
        pivotRow = row;
      }
    }
    if (pivotMagnitude <= 64 * Number.EPSILON * scale) return undefined;
    if (pivotRow !== col) {
      for (let entry = col; entry <= size; entry++) {
        const first = col * (size + 1) + entry;
        const second = pivotRow * (size + 1) + entry;
        const temporary = augmented[first]!;
        augmented[first] = augmented[second]!;
        augmented[second] = temporary;
      }
    }
    const pivot = augmented[col * (size + 1) + col]!;
    minimumPivot = Math.min(minimumPivot, Math.abs(pivot));
    maximumPivot = Math.max(maximumPivot, Math.abs(pivot));
    for (let row = col + 1; row < size; row++) {
      const factor = augmented[row * (size + 1) + col]! / pivot;
      for (let entry = col; entry <= size; entry++) {
        augmented[row * (size + 1) + entry]! -=
          factor * augmented[col * (size + 1) + entry]!;
      }
    }
  }
  const solution = new Float64Array(size);
  for (let row = size - 1; row >= 0; row--) {
    let value = augmented[row * (size + 1) + size]!;
    for (let col = row + 1; col < size; col++) {
      value -= augmented[row * (size + 1) + col]! * solution[col]!;
    }
    solution[row] = value / augmented[row * (size + 1) + row]!;
  }
  if (Array.from(solution).some((value) => !Number.isFinite(value))) return undefined;
  return {
    solution,
    conditionEstimate: maximumPivot > 0 ? minimumPivot / maximumPivot : 0
  };
}

function resolveOptions(options: EpaOptions4): ResolvedEpaOptions4 {
  const resolved = {
    maxIterations: options.maxIterations ?? 96,
    maxSeedIterations: options.maxSeedIterations ?? 32,
    maxFacets: options.maxFacets ?? 4096,
    relativeTolerance: options.relativeTolerance ?? 1e-10,
    absoluteTolerance: options.absoluteTolerance ?? 1e-10,
    degeneracyTolerance: options.degeneracyTolerance ?? 1e-12,
    visibilityTolerance: options.visibilityTolerance ?? 1e-12,
    barycentricTolerance: options.barycentricTolerance ?? 1e-10,
    recordTrace: options.recordTrace ?? false,
    gjkOptions: { ...options.gjkOptions }
  };
  for (const [name, value] of [
    ['maxIterations', resolved.maxIterations],
    ['maxSeedIterations', resolved.maxSeedIterations],
    ['maxFacets', resolved.maxFacets]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`epaPenetration4: ${name} must be a positive integer`);
    }
  }
  for (const [name, value] of [
    ['relativeTolerance', resolved.relativeTolerance],
    ['absoluteTolerance', resolved.absoluteTolerance],
    ['degeneracyTolerance', resolved.degeneracyTolerance],
    ['visibilityTolerance', resolved.visibilityTolerance],
    ['barycentricTolerance', resolved.barycentricTolerance]
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`epaPenetration4: ${name} must be finite and non-negative`);
    }
  }
  return resolved;
}

function addUniqueVertex(
  vertices: GjkSimplexVertexN[],
  candidate: GjkSimplexVertexN,
  options: ResolvedEpaOptions4
): void {
  if (!vertices.some((vertex) =>
    pointsCoincide(vertex.point, candidate.point, options.absoluteTolerance)
  )) vertices.push(candidate);
}

function cloneVertex(vertex: GjkSimplexVertexN): GjkSimplexVertexN {
  return {
    point: vertex.point.clone(),
    pointA: vertex.pointA.clone(),
    pointB: vertex.pointB.clone(),
    featureA: vertex.featureA,
    featureB: vertex.featureB
  };
}

function pointsCoincide(left: VecN, right: VecN, tolerance: number): boolean {
  let distanceSquared = 0;
  let scaleSquared = 1;
  for (let axis = 0; axis < 4; axis++) {
    const difference = left.data[axis]! - right.data[axis]!;
    distanceSquared += difference * difference;
    scaleSquared = Math.max(
      scaleSquared,
      left.data[axis]! ** 2,
      right.data[axis]! ** 2
    );
  }
  const threshold = Math.max(tolerance, 64 * Number.EPSILON * Math.sqrt(scaleSquared));
  return distanceSquared <= threshold * threshold;
}

function visibilityBand(
  facet: Facet4,
  point: VecN,
  options: ResolvedEpaOptions4
): number {
  return (
    options.absoluteTolerance +
    options.visibilityTolerance * Math.max(1, Math.abs(facet.offset), point.length())
  );
}

function originContainmentBand(
  vertices: readonly GjkSimplexVertexN[],
  options: ResolvedEpaOptions4
): number {
  return options.absoluteTolerance + options.visibilityTolerance * vertexScale(vertices);
}

function vertexScale(vertices: readonly GjkSimplexVertexN[]): number {
  return Math.max(1, ...vertices.map(({ point }) => point.length()));
}

function minimumNonnegativeOffset(facets: readonly Facet4[]): number | null {
  const values = facets.map(({ offset }) => offset).filter((value) => value >= 0);
  return values.length > 0 ? Math.min(...values) : null;
}

function assertSupportPoint(point: VecN, owner: string): void {
  if (
    point.dim !== 4 ||
    Array.from(point.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error(`epaPenetration4: ${owner} support must contain four finite coordinates`);
  }
}

function compareFacets(left: Facet4, right: Facet4): number {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

function compareIndexArrays(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}
