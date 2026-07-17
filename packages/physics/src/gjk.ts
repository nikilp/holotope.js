import { VecN } from '@holotope/core';
import {
  type SupportFeatureId,
  type SupportShapeN
} from './support-shape.js';

export type GjkSign = -1 | 0 | 1;

/** One support point of the Minkowski difference A-B, with witnesses. */
export interface GjkSimplexVertexN {
  readonly point: VecN;
  readonly pointA: VecN;
  readonly pointB: VecN;
  readonly featureA: SupportFeatureId;
  readonly featureB: SupportFeatureId;
}

/**
 * Optional exact classifier for the barycentric signs of the origin's
 * projection onto one affine sub-simplex. Numerical weights are still used
 * for returned witness coordinates; these signs decide which face is active.
 */
export interface GjkBarycentricSignResult {
  readonly affineIndependent: boolean;
  readonly weightSigns: readonly GjkSign[];
  /** Human-readable predicate family, e.g. `exact-ring:phi`. */
  readonly source: string;
}

export type GjkBarycentricSignOracle = (
  simplex: readonly GjkSimplexVertexN[],
  subset: readonly number[]
) => GjkBarycentricSignResult | undefined;

export interface GjkFeaturePair {
  readonly featureA: SupportFeatureId;
  readonly featureB: SupportFeatureId;
}

/** Reusable, pose-independent seed for temporally coherent shape pairs. */
export interface GjkWarmStartN {
  readonly dim: number;
  readonly direction: VecN;
  readonly featurePairs: readonly GjkFeaturePair[];
}

export interface GjkOptions {
  /** Default 32. */
  maxIterations?: number;
  /** van den Bergen relative progress tolerance. Default 1e-12. */
  relativeTolerance?: number;
  /** Distance/contact tolerance in world units. Default 1e-12. */
  absoluteTolerance?: number;
  /** Floating barycentric zero band. Default 1e-12. */
  barycentricTolerance?: number;
  /** Warm-start direction; the previous result normal is a good choice. */
  initialDirection?: VecN | ArrayLike<number>;
  /** Previous result seed. Explicit `initialDirection` takes axis precedence. */
  warmStart?: GjkWarmStartN;
  /** Exact or higher-precision branch classifier for provenance-aware shapes. */
  signOracle?: GjkBarycentricSignOracle;
  /** Retain one compact diagnostic record per support iteration. */
  recordTrace?: boolean;
}

export type GjkTerminationReason =
  | 'origin-within-tolerance'
  | 'relative-progress'
  | 'duplicate-support'
  | 'iteration-limit';

export interface GjkSimplexCertificate {
  /** Convex weights aligned with `result.simplex`. */
  readonly weights: Float64Array;
  /** Predicate signs before numerical clamping. */
  readonly weightSigns: Int8Array;
  readonly predicateSource: string;
  /** Pivot-ratio proxy in [0,1]; larger is better conditioned. */
  readonly conditionEstimate: number;
  /** Determinant of the numerical affine Gram system. */
  readonly determinant: number;
  /** Origin strictly inside a full-dimensional simplex, when provable. */
  readonly strictInterior: boolean;
}

export interface GjkTerminationCertificate {
  readonly reason: GjkTerminationReason;
  readonly supportGap: number;
  readonly threshold: number;
  readonly exactPredicateCalls: number;
  readonly maxSimplexSize: number;
  /** Number of cached feature pairs successfully rehydrated at this pose. */
  readonly warmStartSize: number;
}

export interface GjkTraceEntry {
  readonly iteration: number;
  readonly simplexSize: number;
  readonly distanceSquared: number;
  readonly supportGap: number;
  readonly predicateSource: string;
}

export interface GjkResult {
  readonly status: 'separated' | 'intersecting' | 'iteration-limit';
  /** `null` only when the iteration budget cannot certify either answer. */
  readonly intersects: boolean | null;
  /** Numerical distance at convergence, or the best current upper bound at limit. */
  readonly distance: number;
  /** Unit vector from B toward A for separated shapes; null at zero distance. */
  readonly normal: VecN | null;
  readonly closestPointA: VecN;
  readonly closestPointB: VecN;
  readonly iterations: number;
  readonly simplex: readonly GjkSimplexVertexN[];
  readonly simplexCertificate: GjkSimplexCertificate;
  readonly termination: GjkTerminationCertificate;
  /** Feed this into the next coherent query for the same ordered shape pair. */
  readonly warmStart: GjkWarmStartN;
  readonly trace?: readonly GjkTraceEntry[];
}

interface ResolvedOptions {
  maxIterations: number;
  relativeTolerance: number;
  absoluteTolerance: number;
  barycentricTolerance: number;
  initialDirection?: VecN | ArrayLike<number>;
  warmStart?: GjkWarmStartN;
  signOracle?: GjkBarycentricSignOracle;
  recordTrace: boolean;
}

interface Diagnostics {
  exactPredicateCalls: number;
  maxSimplexSize: number;
  warmStartSize: number;
}

interface Projection {
  simplex: GjkSimplexVertexN[];
  closest: VecN;
  weights: Float64Array;
  signs: Int8Array;
  predicateSource: string;
  conditionEstimate: number;
  determinant: number;
}

interface Candidate {
  indices: number[];
  closest: VecN;
  distanceSquared: number;
  weights: Float64Array;
  signs: Int8Array;
  predicateSource: string;
  conditionEstimate: number;
  determinant: number;
}

/**
 * Distance/intersection query for two compact convex support shapes in R^n.
 * The implementation is dimension-generic; in R4 the active simplex has at
 * most five vertices. EPA/contact response are intentionally separate APIs.
 */
export function gjkDistance(
  shapeA: SupportShapeN,
  shapeB: SupportShapeN,
  options: GjkOptions = {}
): GjkResult {
  if (shapeA.dim !== shapeB.dim) {
    throw new Error(`gjkDistance: shape dimensions differ (${shapeA.dim} vs ${shapeB.dim})`);
  }
  const dim = shapeA.dim;
  if (dim < 1) throw new Error('gjkDistance: shape dimension must be positive');
  const resolved = resolveOptions(options, dim);
  const diagnostics: Diagnostics = {
    exactPredicateCalls: 0,
    maxSimplexSize: 1,
    warmStartSize: 0
  };
  const trace: GjkTraceEntry[] | undefined = resolved.recordTrace ? [] : undefined;

  let direction = initialDirection(shapeA, shapeB, resolved, dim);
  let simplex = hydrateWarmStart(shapeA, shapeB, resolved.warmStart, dim);
  diagnostics.warmStartSize = simplex.length;
  if (simplex.length === 0) simplex = [supportDifference(shapeA, shapeB, direction)];
  diagnostics.maxSimplexSize = simplex.length;
  const supportHistory = simplex.slice();
  let projection = projectSimplex(simplex, dim, resolved, diagnostics);
  simplex = projection.simplex;
  let lastGap = Number.POSITIVE_INFINITY;
  let lastThreshold = 0;

  if (projection.closest.lengthSq() <= resolved.absoluteTolerance ** 2) {
    return buildResult(
      'intersecting',
      true,
      0,
      projection,
      0,
      'origin-within-tolerance',
      0,
      resolved.absoluteTolerance ** 2,
      diagnostics,
      trace,
      dim
    );
  }

  for (let iteration = 0; iteration < resolved.maxIterations; iteration++) {
    const closest = projection.closest;
    const distanceSquared = closest.lengthSq();
    direction = closest.clone().multiplyScalar(-1);
    const support = supportDifference(shapeA, shapeB, direction);
    const supportProjection = closest.dot(support.point);
    lastGap = distanceSquared - supportProjection;
    lastThreshold =
      resolved.relativeTolerance * distanceSquared +
      resolved.absoluteTolerance ** 2 +
      64 * Number.EPSILON * Math.max(1, distanceSquared, Math.abs(supportProjection));

    trace?.push({
      iteration,
      simplexSize: simplex.length,
      distanceSquared,
      supportGap: lastGap,
      predicateSource: projection.predicateSource
    });

    if (lastGap <= lastThreshold) {
      return buildResult(
        'separated',
        false,
        Math.sqrt(distanceSquared),
        projection,
        iteration + 1,
        'relative-progress',
        lastGap,
        lastThreshold,
        diagnostics,
        trace,
        dim
      );
    }

    if (supportHistory.some((vertex) => pointsCoincide(vertex.point, support.point, resolved))) {
      // A support point discarded from the active simplex can reappear later.
      // Projecting the convex hull of all points seen so far distinguishes a
      // genuine no-progress repeat from a cycle whose union already encloses
      // the origin. The next iteration applies the normal progress criterion
      // to this globally best sampled hull.
      projection = projectSimplex(supportHistory, dim, resolved, diagnostics);
      simplex = projection.simplex;
      if (projection.closest.lengthSq() <= resolved.absoluteTolerance ** 2) {
        return buildResult(
          'intersecting',
          true,
          0,
          projection,
          iteration + 1,
          'origin-within-tolerance',
          lastGap,
          lastThreshold,
          diagnostics,
          trace,
          dim
        );
      }
      continue;
    }

    supportHistory.push(support);
    simplex = [...simplex, support];
    diagnostics.maxSimplexSize = Math.max(diagnostics.maxSimplexSize, simplex.length);
    projection = projectSimplex(simplex, dim, resolved, diagnostics);
    simplex = projection.simplex;

    if (projection.closest.lengthSq() <= resolved.absoluteTolerance ** 2) {
      return buildResult(
        'intersecting',
        true,
        0,
        projection,
        iteration + 1,
        'origin-within-tolerance',
        lastGap,
        lastThreshold,
        diagnostics,
        trace,
        dim
      );
    }
  }

  return buildResult(
    'iteration-limit',
    null,
    Math.sqrt(projection.closest.lengthSq()),
    projection,
    resolved.maxIterations,
    'iteration-limit',
    lastGap,
    lastThreshold,
    diagnostics,
    trace,
    dim
  );
}

function resolveOptions(options: GjkOptions, dim: number): ResolvedOptions {
  const maxIterations = options.maxIterations ?? 32;
  const relativeTolerance = options.relativeTolerance ?? 1e-12;
  const absoluteTolerance = options.absoluteTolerance ?? 1e-12;
  const barycentricTolerance = options.barycentricTolerance ?? 1e-12;
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new Error('gjkDistance: maxIterations must be a positive integer');
  }
  for (const [name, value] of [
    ['relativeTolerance', relativeTolerance],
    ['absoluteTolerance', absoluteTolerance],
    ['barycentricTolerance', barycentricTolerance]
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`gjkDistance: ${name} must be finite and non-negative`);
    }
  }
  if (options.initialDirection !== undefined) {
    const direction = options.initialDirection instanceof VecN
      ? options.initialDirection
      : new VecN(options.initialDirection);
    if (
      direction.dim !== dim ||
      Array.from(direction.data).some((value) => !Number.isFinite(value)) ||
      direction.lengthSq() === 0
    ) {
      throw new Error(`gjkDistance: initialDirection must be a nonzero finite R${dim} vector`);
    }
  }
  if (options.warmStart !== undefined) {
    if (options.warmStart.dim !== dim) {
      throw new Error(
        `gjkDistance: warmStart dimension ${options.warmStart.dim} != shape dimension ${dim}`
      );
    }
    assertNonzeroFiniteDirection(options.warmStart.direction, dim, 'warmStart direction');
    if (options.warmStart.featurePairs.length > dim + 1) {
      throw new Error(`gjkDistance: warmStart may contain at most ${dim + 1} feature pairs`);
    }
  }
  return {
    maxIterations,
    relativeTolerance,
    absoluteTolerance,
    barycentricTolerance,
    ...(options.initialDirection !== undefined
      ? { initialDirection: options.initialDirection }
      : {}),
    ...(options.warmStart !== undefined ? { warmStart: options.warmStart } : {}),
    ...(options.signOracle !== undefined ? { signOracle: options.signOracle } : {}),
    recordTrace: options.recordTrace ?? false
  };
}

function initialDirection(
  shapeA: SupportShapeN,
  shapeB: SupportShapeN,
  options: ResolvedOptions,
  dim: number
): VecN {
  if (options.initialDirection !== undefined) {
    return options.initialDirection instanceof VecN
      ? options.initialDirection.clone()
      : new VecN(options.initialDirection);
  }
  if (options.warmStart !== undefined) return options.warmStart.direction.clone();
  const centerDifference = shapeA.center.clone().sub(shapeB.center);
  return centerDifference.lengthSq() > 0 ? centerDifference : VecN.basis(dim, 0);
}

function hydrateWarmStart(
  shapeA: SupportShapeN,
  shapeB: SupportShapeN,
  warmStart: GjkWarmStartN | undefined,
  dim: number
): GjkSimplexVertexN[] {
  if (!warmStart || !shapeA.resolveFeature || !shapeB.resolveFeature) return [];
  const simplex: GjkSimplexVertexN[] = [];
  for (const pair of warmStart.featurePairs) {
    if (
      simplex.some(
        (vertex) =>
          vertex.featureA === pair.featureA && vertex.featureB === pair.featureB
      )
    ) {
      continue;
    }
    const pointA = shapeA.resolveFeature(pair.featureA);
    const pointB = shapeB.resolveFeature(pair.featureB);
    if (!pointA || !pointB) continue;
    assertSupportPoint(pointA.point, dim, 'warmStart shape A feature');
    assertSupportPoint(pointB.point, dim, 'warmStart shape B feature');
    simplex.push({
      point: pointA.point.clone().sub(pointB.point),
      pointA: pointA.point,
      pointB: pointB.point,
      featureA: pointA.featureId,
      featureB: pointB.featureId
    });
  }
  return simplex;
}

function supportDifference(
  shapeA: SupportShapeN,
  shapeB: SupportShapeN,
  direction: VecN
): GjkSimplexVertexN {
  const supportA = shapeA.support(direction);
  const supportB = shapeB.support(direction.clone().multiplyScalar(-1));
  assertSupportPoint(supportA.point, shapeA.dim, 'shape A support');
  assertSupportPoint(supportB.point, shapeB.dim, 'shape B support');
  return {
    point: supportA.point.clone().sub(supportB.point),
    pointA: supportA.point,
    pointB: supportB.point,
    featureA: supportA.featureId,
    featureB: supportB.featureId
  };
}

function assertSupportPoint(point: VecN, dim: number, owner: string): void {
  if (
    point.dim !== dim ||
    Array.from(point.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error(`gjkDistance: ${owner} must contain ${dim} finite coordinates`);
  }
}

function assertNonzeroFiniteDirection(direction: VecN, dim: number, owner: string): void {
  if (
    direction.dim !== dim ||
    Array.from(direction.data).some((value) => !Number.isFinite(value)) ||
    direction.lengthSq() === 0
  ) {
    throw new Error(`gjkDistance: ${owner} must be a nonzero finite R${dim} vector`);
  }
}

function projectSimplex(
  simplex: readonly GjkSimplexVertexN[],
  dim: number,
  options: ResolvedOptions,
  diagnostics: Diagnostics
): Projection {
  const count = simplex.length;
  let best: Candidate | undefined;
  const indices: number[] = [];
  const visit = (start: number): void => {
    if (indices.length > 0) {
      const candidate = affineCandidate(
        simplex,
        indices.slice(),
        dim,
        options,
        diagnostics
      );
      if (candidate && (!best || candidateIsBetter(candidate, best))) best = candidate;
    }
    if (indices.length === dim + 1) return;
    for (let index = start; index < count; index++) {
      indices.push(index);
      visit(index + 1);
      indices.pop();
    }
  };
  visit(0);
  if (!best) {
    // Every non-empty hull has at least a valid single-vertex candidate.
    throw new Error('gjkDistance: failed to project a non-empty simplex');
  }
  return {
    simplex: best.indices.map((index) => simplex[index]!),
    closest: best.closest,
    weights: best.weights,
    signs: best.signs,
    predicateSource: best.predicateSource,
    conditionEstimate: best.conditionEstimate,
    determinant: best.determinant
  };
}

function affineCandidate(
  simplex: readonly GjkSimplexVertexN[],
  indices: number[],
  dim: number,
  options: ResolvedOptions,
  diagnostics: Diagnostics
): Candidate | undefined {
  if (indices.length === 1) {
    const closest = simplex[indices[0]!]!.point.clone();
    return {
      indices,
      closest,
      distanceSquared: closest.lengthSq(),
      weights: Float64Array.of(1),
      signs: Int8Array.of(1),
      predicateSource: 'floating',
      conditionEstimate: 1,
      determinant: 1
    };
  }

  const base = simplex[indices[0]!]!.point;
  const edgeCount = indices.length - 1;
  const edges = Array.from({ length: edgeCount }, (_, edge) =>
    simplex[indices[edge + 1]!]!.point.clone().sub(base)
  );
  const matrix = new Float64Array(edgeCount * edgeCount);
  const rhs = new Float64Array(edgeCount);
  for (let row = 0; row < edgeCount; row++) {
    rhs[row] = -edges[row]!.dot(base);
    for (let col = 0; col < edgeCount; col++) {
      matrix[row * edgeCount + col] = edges[row]!.dot(edges[col]!);
    }
  }
  const solved = solveLinearSystem(matrix, rhs, edgeCount);
  if (!solved) return undefined;

  const weights = new Float64Array(indices.length);
  let edgeWeightSum = 0;
  for (let edge = 0; edge < edgeCount; edge++) {
    weights[edge + 1] = solved.solution[edge]!;
    edgeWeightSum += solved.solution[edge]!;
  }
  weights[0] = 1 - edgeWeightSum;

  let predicateSource = 'floating';
  let signs = Int8Array.from(weights, (weight) =>
    weight < -options.barycentricTolerance
      ? -1
      : weight > options.barycentricTolerance
        ? 1
        : 0
  );
  const exact = options.signOracle?.(simplex, indices);
  if (exact) {
    diagnostics.exactPredicateCalls++;
    if (!exact.affineIndependent) return undefined;
    if (exact.weightSigns.length !== weights.length) {
      throw new Error(
        `gjkDistance: sign oracle returned ${exact.weightSigns.length} signs for ${weights.length} weights`
      );
    }
    if (!exact.source) throw new Error('gjkDistance: sign oracle source must be non-empty');
    signs = Int8Array.from(exact.weightSigns);
    predicateSource = exact.source;
  }
  if (Array.from(signs).some((sign) => sign < 0)) return undefined;

  for (let index = 0; index < weights.length; index++) {
    if (signs[index] === 0 || Math.abs(weights[index]!) <= options.barycentricTolerance) {
      weights[index] = 0;
    } else if (weights[index]! < -options.barycentricTolerance) {
      // Exact feasibility with a numerically unusable witness representation:
      // let a better-conditioned sub-simplex win instead of fabricating a point.
      return undefined;
    }
  }
  let weightSum = 0;
  for (const weight of weights) weightSum += weight;
  if (!(weightSum > 0) || !Number.isFinite(weightSum)) return undefined;
  for (let index = 0; index < weights.length; index++) weights[index]! /= weightSum;

  const closest = new VecN(dim);
  for (let index = 0; index < indices.length; index++) {
    const point = simplex[indices[index]!]!.point;
    const weight = weights[index]!;
    for (let axis = 0; axis < dim; axis++) {
      closest.data[axis]! += point.data[axis]! * weight;
    }
  }
  return {
    indices,
    closest,
    distanceSquared: closest.lengthSq(),
    weights,
    signs,
    predicateSource,
    conditionEstimate: solved.conditionEstimate,
    determinant: solved.determinant
  };
}

function candidateIsBetter(candidate: Candidate, best: Candidate): boolean {
  const distanceScale = Math.max(1, candidate.distanceSquared, best.distanceSquared);
  const tie = 64 * Number.EPSILON * distanceScale;
  if (candidate.distanceSquared < best.distanceSquared - tie) return true;
  if (candidate.distanceSquared > best.distanceSquared + tie) return false;
  if (candidate.conditionEstimate > best.conditionEstimate + 16 * Number.EPSILON) return true;
  if (candidate.conditionEstimate < best.conditionEstimate - 16 * Number.EPSILON) return false;
  if (candidate.indices.length !== best.indices.length) {
    return candidate.indices.length < best.indices.length;
  }
  for (let index = 0; index < candidate.indices.length; index++) {
    if (candidate.indices[index] !== best.indices[index]) {
      return candidate.indices[index]! < best.indices[index]!;
    }
  }
  return false;
}

function solveLinearSystem(
  matrix: Float64Array,
  rhs: Float64Array,
  size: number
): { solution: Float64Array; determinant: number; conditionEstimate: number } | undefined {
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
  if (!(scale > 0) || !Number.isFinite(scale)) return undefined;

  let determinant = 1;
  let minPivot = Number.POSITIVE_INFINITY;
  let maxPivot = 0;
  let swapSign = 1;
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
        const left = col * (size + 1) + entry;
        const right = pivotRow * (size + 1) + entry;
        const temporary = augmented[left]!;
        augmented[left] = augmented[right]!;
        augmented[right] = temporary;
      }
      swapSign *= -1;
    }
    const pivot = augmented[col * (size + 1) + col]!;
    determinant *= pivot;
    const absolutePivot = Math.abs(pivot);
    minPivot = Math.min(minPivot, absolutePivot);
    maxPivot = Math.max(maxPivot, absolutePivot);
    for (let row = col + 1; row < size; row++) {
      const factor = augmented[row * (size + 1) + col]! / pivot;
      augmented[row * (size + 1) + col] = 0;
      for (let entry = col + 1; entry <= size; entry++) {
        augmented[row * (size + 1) + entry]! -=
          factor * augmented[col * (size + 1) + entry]!;
      }
    }
  }
  determinant *= swapSign;
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
    determinant,
    conditionEstimate: maxPivot > 0 ? minPivot / maxPivot : 0
  };
}

function pointsCoincide(left: VecN, right: VecN, options: ResolvedOptions): boolean {
  let distanceSquared = 0;
  let scaleSquared = 1;
  for (let axis = 0; axis < left.dim; axis++) {
    const difference = left.data[axis]! - right.data[axis]!;
    distanceSquared += difference * difference;
    scaleSquared = Math.max(
      scaleSquared,
      left.data[axis]! ** 2,
      right.data[axis]! ** 2
    );
  }
  const toleranceSquared = Math.max(
    options.absoluteTolerance ** 2,
    64 * Number.EPSILON ** 2 * scaleSquared
  );
  return distanceSquared <= toleranceSquared;
}

function buildResult(
  status: GjkResult['status'],
  intersects: boolean | null,
  distance: number,
  projection: Projection,
  iterations: number,
  reason: GjkTerminationReason,
  supportGap: number,
  threshold: number,
  diagnostics: Diagnostics,
  trace: GjkTraceEntry[] | undefined,
  dim: number
): GjkResult {
  const closestPointA = new VecN(dim);
  const closestPointB = new VecN(dim);
  for (let index = 0; index < projection.simplex.length; index++) {
    const vertex = projection.simplex[index]!;
    const weight = projection.weights[index]!;
    for (let axis = 0; axis < dim; axis++) {
      closestPointA.data[axis]! += vertex.pointA.data[axis]! * weight;
      closestPointB.data[axis]! += vertex.pointB.data[axis]! * weight;
    }
  }
  const normal = distance > 0
    ? closestPointA.clone().sub(closestPointB).multiplyScalar(1 / distance)
    : null;
  const strictInterior =
    status === 'intersecting' &&
    projection.simplex.length === dim + 1 &&
    Array.from(projection.signs).every((sign) => sign > 0);
  const warmDirection = projection.closest.lengthSq() > 0
    ? projection.closest.clone().normalize()
    : projection.simplex.find((vertex) => vertex.point.lengthSq() > 0)?.point.clone().normalize()
      ?? VecN.basis(dim, 0);
  const result: GjkResult = {
    status,
    intersects,
    distance,
    normal,
    closestPointA,
    closestPointB,
    iterations,
    simplex: projection.simplex,
    simplexCertificate: {
      weights: projection.weights,
      weightSigns: projection.signs,
      predicateSource: projection.predicateSource,
      conditionEstimate: projection.conditionEstimate,
      determinant: projection.determinant,
      strictInterior
    },
    termination: {
      reason,
      supportGap,
      threshold,
      exactPredicateCalls: diagnostics.exactPredicateCalls,
      maxSimplexSize: diagnostics.maxSimplexSize,
      warmStartSize: diagnostics.warmStartSize
    },
    warmStart: {
      dim,
      direction: warmDirection,
      featurePairs: projection.simplex.map((vertex) => ({
        featureA: vertex.featureA,
        featureB: vertex.featureB
      }))
    }
  };
  if (trace) return { ...result, trace };
  return result;
}
