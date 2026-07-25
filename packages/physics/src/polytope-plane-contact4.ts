import { VecN } from '@holotope/core';
import {
  reduceContactPoints4,
  type ContactPatchKind4
} from './contact-polyhedron4.js';
import { HyperplaneColliderN } from './hyperplane-collider.js';
import type { PolytopeBoundaryFeature4 } from './polytope-contact4.js';
import {
  polytopeFaceKeyN,
  resolveConvexPolytopeTopologyN,
  type ConvexPolytopeTopologyOptionsN
} from './polytope-topology.js';
import {
  supportFeatureKeyN,
  type SupportFeatureId,
  type SupportShapeN,
  type SupportVertexN
} from './support-shape.js';

export interface PolytopeHyperplaneContactOptions4
extends ConvexPolytopeTopologyOptionsN {
  /** Separation/contact band in world units. Default 1e-12. */
  readonly tolerance?: number;
  /** Band for identifying every vertex of the support face. Default 1e-10. */
  readonly manifoldTolerance?: number;
  /** Spherical Minkowski radius around the polytope. Default 0. */
  readonly polytopeMargin?: number;
  /** Maximum retained solver points. Default 8; must be in [4, 32]. */
  readonly maxSolverPoints?: number;
}

/**
 * What a polytope–hyperplane test established. Three of these are answers
 * about the geometry; two are statements about the query itself.
 *
 * `unsupported` means the polytope cannot be handled by this path at all —
 * it is not vertex-enumerable — and no amount of retrying changes that.
 * `indeterminate` means this attempt failed, at a candidate limit or on a
 * degeneracy, and a different tolerance might succeed. Neither carries a
 * measurement, and neither means the shapes are apart.
 */
export type PolytopeHyperplaneContactStatus4 =
  | 'unsupported'
  | 'indeterminate'
  | 'separated'
  | 'touching'
  | 'overlapping';

/**
 * Why the test stopped where it did. `complete` accompanies every genuine
 * answer; the rest name what prevented one.
 */
export type PolytopeHyperplaneContactReason4 =
  | 'complete'
  | 'polytope-not-vertex-enumerable'
  | 'facet-candidate-limit'
  | 'degenerate-polytope'
  | 'facet-enumeration-failed'
  | 'compiled-topology-invalid'
  | 'support-feature-invalid';

export interface PolytopeHyperplaneContactVertex4 {
  readonly id: string;
  readonly polytopeVertexId: SupportFeatureId;
  readonly pointA: VecN;
  readonly pointB: VecN;
  readonly resolvedPoint: VecN;
}

export interface PolytopeHyperplaneContactDiagnostics4 {
  readonly topologySource: 'compiled' | 'enumerated';
  readonly sourceVertices: number;
  readonly facets: number;
  readonly facetCandidates: number;
  readonly queryFacetCandidates: number;
  readonly supportVertices: number;
  readonly solverPoints: number;
}

export interface PolytopeHyperplaneContactPatch4 {
  readonly kind: ContactPatchKind4;
  readonly intrinsicDim: 0 | 1 | 2 | 3;
  /** Ordered minimum-translation direction from B toward A. */
  readonly normal: VecN;
  readonly planeNormal: VecN;
  readonly originalPlaneOffset: number;
  readonly resolvedPlaneOffset: number;
  readonly penetrationDepth: number;
  readonly alignmentShift: number;
  readonly translationA: VecN;
  readonly polytopeRole: 'a' | 'b';
  readonly polytopeFeature: PolytopeBoundaryFeature4;
  readonly vertices: readonly PolytopeHyperplaneContactVertex4[];
  readonly solverPoints: readonly PolytopeHyperplaneContactVertex4[];
  readonly maxResolvedPlaneResidual: number;
  readonly diagnostics: PolytopeHyperplaneContactDiagnostics4;
}

/**
 * Result of testing a convex polytope against an infinite hyperplane.
 *
 * Every measurement is nullable because the test can decline to answer: the
 * polytope may not be vertex-enumerable, or facet enumeration may fail. On
 * `unsupported` and `indeterminate` all of them are `null` together, so a
 * caller checks `status` once rather than each field in turn.
 *
 * A null measurement is not a separation. Treating either non-answer as
 * "apart" is the mistake this type is shaped to prevent, and `reason`
 * distinguishes a permanent limitation from a retryable failure.
 */
export interface PolytopeHyperplaneContactResult4 {
  /** Whether the geometry was decided, and if not, why not. */
  readonly status: PolytopeHyperplaneContactStatus4;
  /** `complete` on an answer; otherwise what prevented one. */
  readonly reason: PolytopeHyperplaneContactReason4;
  /** `null` unless the test produced an answer. */
  readonly intersects: boolean | null;
  /** Signed separation, negative once the polytope crosses; `null` on a
   * non-answer. */
  readonly signedDistance: number | null;
  /** Its magnitude, or `null`. */
  readonly distance: number | null;
  /** Depth of overlap, or `null`. */
  readonly penetrationDepth: number | null;
  /** The plane's unit normal, known regardless of the outcome. */
  readonly normal: VecN;
  /** Which kind of shape was supplied first. */
  readonly shapeAType: 'polytope' | 'hyperplane';
  /** Which was supplied second. */
  readonly shapeBType: 'polytope' | 'hyperplane';
  /** Spherical Minkowski radius the polytope was grown by for this test. */
  readonly polytopeMargin: number;
  /** The polytope feature meeting the plane, or `null` on a non-answer. */
  readonly polytopeFeature: PolytopeBoundaryFeature4 | null;
  /** The shared region; `null` when separated, and also on a non-answer. */
  readonly patch: PolytopeHyperplaneContactPatch4 | null;
}

/** Ordered complete support-face contact between an R4 polytope and plane. */
export function polytopeHyperplaneContact4(
  shapeA: SupportShapeN | HyperplaneColliderN,
  shapeB: SupportShapeN | HyperplaneColliderN,
  options: PolytopeHyperplaneContactOptions4 = {}
): PolytopeHyperplaneContactResult4 {
  const aIsPlane = shapeA instanceof HyperplaneColliderN;
  const bIsPlane = shapeB instanceof HyperplaneColliderN;
  if (aIsPlane === bIsPlane) {
    throw new Error(
      'polytopeHyperplaneContact4: expected exactly one support shape and one hyperplane'
    );
  }
  if (shapeA.dim !== shapeB.dim || shapeA.dim !== 4) {
    throw new Error('polytopeHyperplaneContact4: both shapes must be in R4');
  }
  const polytope = (aIsPlane ? shapeB : shapeA) as SupportShapeN;
  const plane = (aIsPlane ? shapeA : shapeB) as HyperplaneColliderN;
  const polytopeIsA = !aIsPlane;
  const resolved = resolveOptions(options);
  const orderedNormal = polytopeIsA
    ? plane.normal.clone()
    : plane.normal.clone().multiplyScalar(-1);
  const base = {
    normal: orderedNormal,
    shapeAType: polytopeIsA ? 'polytope' as const : 'hyperplane' as const,
    shapeBType: polytopeIsA ? 'hyperplane' as const : 'polytope' as const,
    polytopeMargin: resolved.polytopeMargin
  };

  const hull = resolveConvexPolytopeTopologyN(polytope, {
    facetTolerance: resolved.facetTolerance,
    rankTolerance: resolved.rankTolerance,
    maxFacetCandidates: resolved.maxFacetCandidates
  });
  if (hull.status !== 'complete' || !hull.topology || !hull.vertices || !hull.facets) {
    const reason = mapHullFailure(hull.reason);
    return {
      ...base,
      status: hull.status === 'unsupported' ? 'unsupported' : 'indeterminate',
      reason,
      intersects: null,
      signedDistance: null,
      distance: null,
      penetrationDepth: null,
      polytopeFeature: null,
      patch: null
    };
  }

  const orderedVertices = [...hull.vertices].sort(compareSupportVertices);
  const projections = orderedVertices.map(({ point }) => plane.normal.dot(point));
  const minimumProjection = Math.min(...projections);
  const supportVertices = orderedVertices.filter((_, index) =>
    projections[index]! <= minimumProjection + resolved.manifoldTolerance
  );
  const supportKeys = supportVertices.map(({ featureId }) =>
    supportFeatureKeyN(featureId)
  );
  const supportKeySet = new Set(supportKeys);
  const containingFacets = hull.facets.filter((facet) => {
    const facetKeys = new Set(facet.vertexFeatureIds.map(supportFeatureKeyN));
    return supportKeys.every((key) => facetKeys.has(key));
  });
  let commonKeys = containingFacets.length > 0
    ? new Set(containingFacets[0]!.vertexFeatureIds.map(supportFeatureKeyN))
    : new Set<string>();
  for (let index = 1; index < containingFacets.length; index++) {
    const next = new Set(
      containingFacets[index]!.vertexFeatureIds.map(supportFeatureKeyN)
    );
    commonKeys = new Set(Array.from(commonKeys).filter((key) => next.has(key)));
  }
  if (
    supportVertices.length === 0 ||
    commonKeys.size !== supportKeySet.size ||
    Array.from(commonKeys).some((key) => !supportKeySet.has(key))
  ) {
    return {
      ...base,
      status: 'indeterminate',
      reason: 'support-feature-invalid',
      intersects: null,
      signedDistance: null,
      distance: null,
      penetrationDepth: null,
      polytopeFeature: null,
      patch: null
    };
  }

  const marginPoints = supportVertices.map(({ point }) =>
    point.clone().sub(
      plane.normal.clone().multiplyScalar(resolved.polytopeMargin)
    )
  );
  const reduction = reduceContactPoints4(
    marginPoints,
    plane.normal,
    resolved.maxSolverPoints,
    resolved.rankTolerance
  );
  const polytopeFeature: PolytopeBoundaryFeature4 = {
    key: polytopeFaceKeyN(supportVertices.map(({ featureId }) => featureId)),
    vertexFeatureIds: supportVertices.map(({ featureId }) => featureId),
    dimension: reduction.intrinsicDim
  };
  const signedDistance = minimumProjection - plane.offset - resolved.polytopeMargin;
  const penetrationDepth = Math.max(0, -signedDistance);
  const status = contactStatus(signedDistance, resolved.tolerance);
  const resultBase = {
    ...base,
    status,
    reason: 'complete' as const,
    intersects: status !== 'separated',
    signedDistance,
    distance: Math.max(0, signedDistance),
    penetrationDepth,
    polytopeFeature
  };
  if (status === 'separated') return { ...resultBase, patch: null };

  const alignmentShift = -signedDistance;
  const translationA = orderedNormal.clone().multiplyScalar(alignmentShift);
  const planeTranslation = polytopeIsA ? new VecN(4) : translationA;
  const resolvedPlaneOffset = plane.offset + plane.normal.dot(planeTranslation);
  let maxResolvedPlaneResidual = 0;
  const vertices = supportVertices.map((vertex, index) => {
    const polytopePoint = marginPoints[index]!;
    const pointA = polytopeIsA
      ? polytopePoint.clone()
      : polytopePoint.clone().sub(translationA);
    const pointB = polytopeIsA
      ? polytopePoint.clone().add(translationA)
      : polytopePoint.clone();
    const resolvedPoint = pointA.clone().add(translationA);
    maxResolvedPlaneResidual = Math.max(
      maxResolvedPlaneResidual,
      Math.abs(plane.normal.dot(resolvedPoint) - resolvedPlaneOffset)
    );
    return {
      id: `polytope:${supportFeatureKeyN(vertex.featureId)}`,
      polytopeVertexId: vertex.featureId,
      pointA,
      pointB,
      resolvedPoint
    };
  });
  const solverPoints = reduction.solverIndices.map((index) => vertices[index]!);
  return {
    ...resultBase,
    patch: {
      kind: reduction.kind,
      intrinsicDim: reduction.intrinsicDim,
      normal: orderedNormal,
      planeNormal: plane.normal.clone(),
      originalPlaneOffset: plane.offset,
      resolvedPlaneOffset,
      penetrationDepth,
      alignmentShift,
      translationA,
      polytopeRole: polytopeIsA ? 'a' : 'b',
      polytopeFeature,
      vertices,
      solverPoints,
      maxResolvedPlaneResidual,
      diagnostics: {
        topologySource: hull.topologySource!,
        sourceVertices: hull.vertices.length,
        facets: hull.facets.length,
        facetCandidates: hull.topology.diagnostics.facetCandidates,
        queryFacetCandidates: hull.queryFacetCandidates,
        supportVertices: vertices.length,
        solverPoints: solverPoints.length
      }
    }
  };
}

interface ResolvedOptions4 {
  tolerance: number;
  manifoldTolerance: number;
  polytopeMargin: number;
  facetTolerance: number;
  rankTolerance: number;
  maxFacetCandidates: number;
  maxSolverPoints: number;
}

function resolveOptions(
  options: PolytopeHyperplaneContactOptions4
): ResolvedOptions4 {
  const resolved = {
    tolerance: options.tolerance ?? 1e-12,
    manifoldTolerance: options.manifoldTolerance ?? 1e-10,
    polytopeMargin: options.polytopeMargin ?? 0,
    facetTolerance: options.facetTolerance ?? 1e-10,
    rankTolerance: options.rankTolerance ?? 1e-10,
    maxFacetCandidates: options.maxFacetCandidates ?? 250_000,
    maxSolverPoints: options.maxSolverPoints ?? 8
  };
  for (const [name, value] of [
    ['tolerance', resolved.tolerance],
    ['manifoldTolerance', resolved.manifoldTolerance],
    ['polytopeMargin', resolved.polytopeMargin],
    ['facetTolerance', resolved.facetTolerance],
    ['rankTolerance', resolved.rankTolerance]
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `polytopeHyperplaneContact4: ${name} must be finite and non-negative`
      );
    }
  }
  if (
    !Number.isSafeInteger(resolved.maxFacetCandidates) ||
    resolved.maxFacetCandidates < 1
  ) {
    throw new Error(
      'polytopeHyperplaneContact4: maxFacetCandidates must be a positive integer'
    );
  }
  if (
    !Number.isSafeInteger(resolved.maxSolverPoints) ||
    resolved.maxSolverPoints < 4 ||
    resolved.maxSolverPoints > 32
  ) {
    throw new Error('polytopeHyperplaneContact4: maxSolverPoints must be in [4, 32]');
  }
  return resolved;
}

function mapHullFailure(reason: string): PolytopeHyperplaneContactReason4 {
  if (reason === 'shape-not-vertex-enumerable') {
    return 'polytope-not-vertex-enumerable';
  }
  if (
    reason === 'facet-candidate-limit' ||
    reason === 'degenerate-polytope' ||
    reason === 'facet-enumeration-failed' ||
    reason === 'compiled-topology-invalid'
  ) {
    return reason;
  }
  return 'facet-enumeration-failed';
}

function contactStatus(
  signedDistance: number,
  tolerance: number
): 'separated' | 'touching' | 'overlapping' {
  return signedDistance > tolerance
    ? 'separated'
    : signedDistance < -tolerance
      ? 'overlapping'
      : 'touching';
}

function compareSupportVertices(left: SupportVertexN, right: SupportVertexN): number {
  const leftKey = supportFeatureKeyN(left.featureId);
  const rightKey = supportFeatureKeyN(right.featureId);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
