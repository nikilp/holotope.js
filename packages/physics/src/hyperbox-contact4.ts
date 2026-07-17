import { VecN } from '@holotope/core';
import {
  intersectContactHalfspaces4,
  type ContactHalfspace4,
  type ContactPatchKind4
} from './contact-polyhedron4.js';
import { HyperboxSupportShape4 } from './hyperbox4.js';
import {
  hyperboxSat4,
  type HyperboxSatAxisSource4,
  type HyperboxSatOptions4,
  type HyperboxSatResult4
} from './hyperbox-sat4.js';

export type HyperboxContactPatchKind4 = ContactPatchKind4;

/** Stable local feature identity on the boundary of a 4D box. */
export interface HyperboxBoundaryFeature4 {
  /** Local axes fixed at their positive half extent. */
  readonly positiveMask: number;
  /** Local axes fixed at their negative half extent. */
  readonly negativeMask: number;
  /** Dimension of the containing box feature: vertex=0 through facet=3. */
  readonly dimension: number;
}

export interface HyperboxContactVertex4 {
  /** Stable identity derived from the pair of local box features. */
  readonly id: string;
  /** World-space R4 point in the resolved, just-touching configuration. */
  readonly point: VecN;
  readonly featureA: HyperboxBoundaryFeature4;
  readonly featureB: HyperboxBoundaryFeature4;
}

export interface HyperboxContactPatchDiagnostics4 {
  readonly constraints: number;
  readonly effectiveConstraints: number;
  readonly triplesTested: number;
  readonly feasibleCandidates: number;
  readonly uniqueVertices: number;
  readonly solverPoints: number;
}

export interface HyperboxContactPatch4 {
  readonly kind: HyperboxContactPatchKind4;
  readonly intrinsicDim: 0 | 1 | 2 | 3;
  /** SAT normal from B toward A / A's escape direction. */
  readonly normal: VecN;
  /** The patch lies in `normal.dot(point) = planeOffset`. */
  readonly planeOffset: number;
  readonly penetrationDepth: number;
  /** Signed distance used to snap A onto the contact plane. */
  readonly alignmentShift: number;
  /** Translation applied to A before generating every returned point. */
  readonly translationA: VecN;
  /** Facet owner for facet SAT axes; cross-family contacts have no single owner. */
  readonly referenceBox: 'a' | 'b' | null;
  readonly satSource: HyperboxSatAxisSource4;
  /** Complete vertex set of the convex contact patch. */
  readonly vertices: readonly HyperboxContactVertex4[];
  /** Deterministic bounded subset intended for a later constraint solver. */
  readonly solverPoints: readonly HyperboxContactVertex4[];
  readonly diagnostics: HyperboxContactPatchDiagnostics4;
}

export interface HyperboxContactResult4 {
  readonly sat: HyperboxSatResult4;
  readonly patch: HyperboxContactPatch4 | null;
}

export interface HyperboxContactOptions4 extends HyperboxSatOptions4 {
  /** Halfspace feasibility band in world units. Default 1e-9. */
  clipTolerance?: number;
  /** Point merge band in world units. Default 1e-8. */
  vertexTolerance?: number;
  /** Linear-independence band used for patch dimension. Default 1e-10. */
  rankTolerance?: number;
  /** Maximum retained solver points. Default 8; must be in [4, 32]. */
  maxSolverPoints?: number;
}

/**
 * Constructs the complete convex contact set of two oriented R4 boxes.
 *
 * For an overlap, A is first translated along the SAT minimum-translation
 * axis into a just-touching configuration. The returned patch therefore has
 * exact contact geometry, while `translationA` preserves its relation to the
 * original poses. A separated pair has no patch.
 */
export function hyperboxContactPatch4(
  boxA: HyperboxSupportShape4,
  boxB: HyperboxSupportShape4,
  options: HyperboxContactOptions4 = {}
): HyperboxContactResult4 {
  const clipTolerance = resolvedTolerance(options.clipTolerance, 1e-9, 'clipTolerance');
  const vertexTolerance = resolvedTolerance(
    options.vertexTolerance,
    1e-8,
    'vertexTolerance'
  );
  const rankTolerance = resolvedTolerance(options.rankTolerance, 1e-10, 'rankTolerance');
  const maxSolverPoints = options.maxSolverPoints ?? 8;
  if (
    !Number.isSafeInteger(maxSolverPoints) ||
    maxSolverPoints < 4 ||
    maxSolverPoints > 32
  ) {
    throw new Error('hyperboxContactPatch4: maxSolverPoints must be an integer in [4, 32]');
  }

  const sat = hyperboxSat4(boxA, boxB, options);
  if (sat.status === 'separated') return { sat, patch: null };

  const normal = sat.axis.clone();
  const alignmentShift = sat.intervalB[1] - sat.intervalA[0];
  const translationA = normal.clone().multiplyScalar(alignmentShift);
  const resolvedCenterA = boxA.center.add(translationA);
  const centerB = boxB.center;
  const planeOffset = sat.intervalB[1];
  const axesA = boxA.worldAxes();
  const axesB = boxB.worldAxes();
  const constraints = [
    ...boxHalfspaces(axesA, boxA.halfExtents, resolvedCenterA),
    ...boxHalfspaces(axesB, boxB.halfExtents, centerB)
  ];
  const intersection = intersectContactHalfspaces4(normal, planeOffset, constraints, {
    feasibilityTolerance: clipTolerance,
    vertexTolerance,
    rankTolerance,
    maxSolverPoints
  });
  const featureTolerance = Math.max(clipTolerance * 4, vertexTolerance * 2);
  const vertices = intersection.vertices.map((candidate): HyperboxContactVertex4 => {
    const featureA = classifyBoundaryFeature(
      candidate.point,
      resolvedCenterA,
      axesA,
      boxA.halfExtents,
      featureTolerance
    );
    const featureB = classifyBoundaryFeature(
      candidate.point,
      centerB,
      axesB,
      boxB.halfExtents,
      featureTolerance
    );
    return {
      id: hyperboxContactVertexId4(featureA, featureB),
      point: candidate.point,
      featureA,
      featureB
    };
  });
  const solverPoints = intersection.solverIndices.map((index) => vertices[index]!);

  return {
    sat,
    patch: {
      kind: intersection.kind,
      intrinsicDim: intersection.intrinsicDim,
      normal,
      planeOffset,
      penetrationDepth: sat.penetrationDepth,
      alignmentShift,
      translationA,
      referenceBox: referenceBox(sat.source),
      satSource: sat.source,
      vertices,
      solverPoints,
      diagnostics: intersection.diagnostics
    }
  };
}

/** Canonical stable key for one local boundary feature of a 4D box. */
export function hyperboxBoundaryFeatureKey4(feature: HyperboxBoundaryFeature4): string {
  assertFeatureMasks(feature);
  return `p${feature.positiveMask.toString(16)}n${feature.negativeMask.toString(16)}`;
}

/** Canonical persistent identity for a pair of contributing box features. */
export function hyperboxContactVertexId4(
  featureA: HyperboxBoundaryFeature4,
  featureB: HyperboxBoundaryFeature4
): string {
  return `a:${hyperboxBoundaryFeatureKey4(featureA)}|b:${hyperboxBoundaryFeatureKey4(featureB)}`;
}

function boxHalfspaces(
  axes: readonly VecN[],
  halfExtents: ArrayLike<number>,
  center: VecN
): ContactHalfspace4[] {
  const result: ContactHalfspace4[] = [];
  for (let axis = 0; axis < 4; axis++) {
    const worldAxis = axes[axis]!;
    result.push({
      normal: worldAxis,
      offset: halfExtents[axis]! + worldAxis.dot(center)
    });
    const opposite = worldAxis.clone().multiplyScalar(-1);
    result.push({
      normal: opposite,
      offset: halfExtents[axis]! + opposite.dot(center)
    });
  }
  return result;
}

function classifyBoundaryFeature(
  point: VecN,
  center: VecN,
  axes: readonly VecN[],
  halfExtents: ArrayLike<number>,
  tolerance: number
): HyperboxBoundaryFeature4 {
  const local = point.clone().sub(center);
  let positiveMask = 0;
  let negativeMask = 0;
  for (let axis = 0; axis < 4; axis++) {
    const coordinate = axes[axis]!.dot(local);
    const extent = halfExtents[axis]!;
    const band = scaledTolerance(tolerance, coordinate, extent);
    if (Math.abs(coordinate - extent) <= band) positiveMask |= 1 << axis;
    if (Math.abs(coordinate + extent) <= band) negativeMask |= 1 << axis;
  }
  return {
    positiveMask,
    negativeMask,
    dimension: 4 - popcount4(positiveMask | negativeMask)
  };
}

function referenceBox(source: HyperboxSatAxisSource4): 'a' | 'b' | null {
  if (source.featureClass === 'facet-a') return 'a';
  if (source.featureClass === 'facet-b') return 'b';
  return null;
}

function popcount4(value: number): number {
  let count = 0;
  for (let bit = 0; bit < 4; bit++) if ((value & (1 << bit)) !== 0) count++;
  return count;
}

function assertFeatureMasks(feature: HyperboxBoundaryFeature4): void {
  for (const [name, mask] of [
    ['positiveMask', feature.positiveMask],
    ['negativeMask', feature.negativeMask]
  ] as const) {
    if (!Number.isSafeInteger(mask) || mask < 0 || mask > 0b1111) {
      throw new Error(`hyperboxBoundaryFeatureKey4: ${name} must be a four-bit mask`);
    }
  }
  if ((feature.positiveMask & feature.negativeMask) !== 0) {
    throw new Error('hyperboxBoundaryFeatureKey4: positive and negative masks must be disjoint');
  }
  const expectedDimension = 4 - popcount4(feature.positiveMask | feature.negativeMask);
  if (feature.dimension !== expectedDimension) {
    throw new Error(
      `hyperboxBoundaryFeatureKey4: dimension ${feature.dimension} does not match masks`
    );
  }
}

function scaledTolerance(tolerance: number, ...values: number[]): number {
  return tolerance * Math.max(1, ...values.map(Math.abs));
}

function resolvedTolerance(
  supplied: number | undefined,
  fallback: number,
  name: string
): number {
  const value = supplied ?? fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`hyperboxContactPatch4: ${name} must be finite and non-negative`);
  }
  return value;
}
