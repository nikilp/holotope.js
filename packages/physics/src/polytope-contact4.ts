import { VecN } from '@holotope/core';
import {
  intersectContactHalfspaces4,
  type ContactHalfspace4,
  type ContactPatchKind4,
  type ContactPlaneIntersectionDiagnostics4
} from './contact-polyhedron4.js';
import {
  epaPenetration4,
  type EpaOptions4,
  type EpaPenetrationResult4
} from './epa4.js';
import {
  supportFeatureKeyN,
  supportShapeVerticesN,
  type SupportFeatureId,
  type SupportShapeN,
  type SupportVertexN
} from './support-shape.js';
import {
  polytopeFaceKeyN,
  resolveConvexPolytopeTopologyN
} from './polytope-topology.js';

export interface PolytopeContactOptions4 {
  readonly epaOptions?: EpaOptions4;
  /** Supporting-facet classification band. Default 1e-10. */
  readonly facetTolerance?: number;
  /** Halfspace feasibility band in world units. Default 1e-9. */
  readonly clipTolerance?: number;
  /** Point merge and boundary-feature band. Default 1e-8. */
  readonly vertexTolerance?: number;
  /** Affine-rank band. Default 1e-10. */
  readonly rankTolerance?: number;
  /** Maximum retained solver points. Default 8; must be in [4, 32]. */
  readonly maxSolverPoints?: number;
  /** Maximum four-vertex facet candidates per shape. Default 250000. */
  readonly maxFacetCandidates?: number;
}

export type PolytopeContactStatus4 =
  | 'unsupported'
  | 'separated'
  | 'touching'
  | 'penetrating'
  | 'indeterminate';

export type PolytopeContactReason4 =
  | 'complete'
  | 'shape-a-not-vertex-enumerable'
  | 'shape-b-not-vertex-enumerable'
  | 'epa-separated'
  | 'epa-indeterminate'
  | 'facet-candidate-limit'
  | 'degenerate-polytope'
  | 'facet-enumeration-failed'
  | 'compiled-topology-invalid'
  | 'contact-intersection-failed';

/** Stable minimal boundary face expressed in source vertex identities. */
export interface PolytopeBoundaryFeature4 {
  readonly key: string;
  readonly vertexFeatureIds: readonly SupportFeatureId[];
  readonly dimension: 0 | 1 | 2 | 3;
}

export interface PolytopeContactVertex4 {
  /** Persistent identity derived from the two minimal source faces. */
  readonly id: string;
  /** World-space point after translating A into just-touching alignment. */
  readonly point: VecN;
  readonly featureA: PolytopeBoundaryFeature4;
  readonly featureB: PolytopeBoundaryFeature4;
}

export interface PolytopeFacet4 {
  /** Outward world-space facet normal for the halfspace normal · point <= offset. */
  readonly normal: VecN;
  readonly offset: number;
  readonly key: string;
  readonly vertexFeatureIds: readonly SupportFeatureId[];
  readonly conditionEstimate: number;
}

export interface PolytopeHullDiagnostics4 {
  readonly sourceVertices: number;
  /** Candidate count paid during original compilation. */
  readonly facetCandidates: number;
  readonly supportingCandidates: number;
  readonly facets: number;
  readonly topologySource: 'compiled' | 'enumerated';
  /** Candidate hyperplanes evaluated by this contact query. */
  readonly queryFacetCandidates: number;
}

export interface PolytopeContactPatchDiagnostics4
  extends ContactPlaneIntersectionDiagnostics4 {
  readonly hullA: PolytopeHullDiagnostics4;
  readonly hullB: PolytopeHullDiagnostics4;
  readonly epaSupports: number;
  readonly epaFacets: number;
  readonly epaExpansions: number;
  readonly epaErrorBound: number;
}

export interface PolytopeContactPatch4 {
  readonly kind: ContactPatchKind4;
  readonly intrinsicDim: 0 | 1 | 2 | 3;
  /** Minimum-translation direction from ordered B toward ordered A. */
  readonly normal: VecN;
  readonly planeOffset: number;
  /** Conservative directional separation required to align the support faces. */
  readonly penetrationDepth: number;
  readonly alignmentShift: number;
  readonly translationA: VecN;
  readonly vertices: readonly PolytopeContactVertex4[];
  readonly solverPoints: readonly PolytopeContactVertex4[];
  readonly diagnostics: PolytopeContactPatchDiagnostics4;
}

export interface PolytopeContactResult4 {
  readonly status: PolytopeContactStatus4;
  readonly reason: PolytopeContactReason4;
  readonly epa: EpaPenetrationResult4 | null;
  readonly patch: PolytopeContactPatch4 | null;
}

interface PolytopeHull4 {
  vertices: readonly SupportVertexN[];
  facets: readonly PolytopeFacet4[];
  diagnostics: PolytopeHullDiagnostics4;
}

interface ResolvedOptions4 {
  facetTolerance: number;
  clipTolerance: number;
  vertexTolerance: number;
  rankTolerance: number;
  maxSolverPoints: number;
  maxFacetCandidates: number;
  epaOptions: EpaOptions4;
}

interface HullFailure4 {
  reason: Extract<
    PolytopeContactReason4,
    | 'facet-candidate-limit'
    | 'degenerate-polytope'
    | 'facet-enumeration-failed'
    | 'compiled-topology-invalid'
  >;
}

/**
 * EPA-seeded complete contact patch for vertex-enumerable convex R4 polytopes.
 * Facets are derived from source vertex IDs, then both resolved hulls are
 * intersected with the common contact hyperplane.
 */
export function polytopeContactPatch4(
  shapeA: SupportShapeN,
  shapeB: SupportShapeN,
  options: PolytopeContactOptions4 = {}
): PolytopeContactResult4 {
  if (shapeA.dim !== shapeB.dim) {
    throw new Error(
      `polytopeContactPatch4: shape dimensions differ (${shapeA.dim} vs ${shapeB.dim})`
    );
  }
  if (shapeA.dim !== 4) {
    throw new Error('polytopeContactPatch4: both shapes must be R4');
  }
  const resolved = resolveOptions(options);
  const verticesA = supportShapeVerticesN(shapeA);
  if (!verticesA) {
    return {
      status: 'unsupported',
      reason: 'shape-a-not-vertex-enumerable',
      epa: null,
      patch: null
    };
  }
  const verticesB = supportShapeVerticesN(shapeB);
  if (!verticesB) {
    return {
      status: 'unsupported',
      reason: 'shape-b-not-vertex-enumerable',
      epa: null,
      patch: null
    };
  }

  const epa = epaPenetration4(shapeA, shapeB, resolved.epaOptions);
  if (epa.status === 'separated') {
    return { status: 'separated', reason: 'epa-separated', epa, patch: null };
  }
  if (epa.status === 'indeterminate' || !epa.normal) {
    return { status: 'indeterminate', reason: 'epa-indeterminate', epa, patch: null };
  }

  const hullA = polytopeHull4(shapeA, verticesA, resolved);
  if ('reason' in hullA) {
    return { status: 'indeterminate', reason: hullA.reason, epa, patch: null };
  }
  const hullB = polytopeHull4(shapeB, verticesB, resolved);
  if ('reason' in hullB) {
    return { status: 'indeterminate', reason: hullB.reason, epa, patch: null };
  }

  const normal = epa.normal.clone().normalize();
  const supportA = shapeA.support(normal.clone().multiplyScalar(-1));
  const supportB = shapeB.support(normal);
  const alignmentShift = Math.max(
    0,
    normal.dot(supportB.point) - normal.dot(supportA.point)
  );
  const translationA = normal.clone().multiplyScalar(alignmentShift);
  const planeOffset = normal.dot(supportB.point);
  const halfspaces: ContactHalfspace4[] = [
    ...hullA.facets.map((facet) => ({
      normal: facet.normal,
      offset: facet.offset + facet.normal.dot(translationA)
    })),
    ...hullB.facets
  ];

  let intersection;
  try {
    intersection = intersectContactHalfspaces4(normal, planeOffset, halfspaces, {
      feasibilityTolerance: resolved.clipTolerance,
      vertexTolerance: resolved.vertexTolerance,
      rankTolerance: resolved.rankTolerance,
      maxSolverPoints: resolved.maxSolverPoints
    });
  } catch {
    return {
      status: 'indeterminate',
      reason: 'contact-intersection-failed',
      epa,
      patch: null
    };
  }

  let vertices: PolytopeContactVertex4[];
  try {
    vertices = intersection.vertices.map(({ point }): PolytopeContactVertex4 => {
      const featureA = boundaryFeature(
        point,
        hullA,
        translationA,
        resolved.vertexTolerance,
        resolved.rankTolerance
      );
      const featureB = boundaryFeature(
        point,
        hullB,
        new VecN(4),
        resolved.vertexTolerance,
        resolved.rankTolerance
      );
      return {
        id: polytopeContactVertexId4(featureA, featureB),
        point,
        featureA,
        featureB
      };
    });
  } catch {
    return {
      status: 'indeterminate',
      reason: 'contact-intersection-failed',
      epa,
      patch: null
    };
  }
  if (new Set(vertices.map(({ id }) => id)).size !== vertices.length) {
    return {
      status: 'indeterminate',
      reason: 'contact-intersection-failed',
      epa,
      patch: null
    };
  }
  const solverPoints = intersection.solverIndices.map((index) => vertices[index]!);
  const penetrationDepth = alignmentShift;
  return {
    status: penetrationDepth <= resolved.clipTolerance ? 'touching' : 'penetrating',
    reason: 'complete',
    epa,
    patch: {
      kind: intersection.kind,
      intrinsicDim: intersection.intrinsicDim,
      normal,
      planeOffset,
      penetrationDepth,
      alignmentShift,
      translationA,
      vertices,
      solverPoints,
      diagnostics: {
        ...intersection.diagnostics,
        hullA: hullA.diagnostics,
        hullB: hullB.diagnostics,
        epaSupports: epa.termination.supportCount,
        epaFacets: epa.termination.facetCount,
        epaExpansions: epa.termination.expansionIterations,
        epaErrorBound: epa.errorBound ?? 0
      }
    }
  };
}

/** Canonical persistent identity for a pair of minimal polytope faces. */
export function polytopeContactVertexId4(
  featureA: PolytopeBoundaryFeature4,
  featureB: PolytopeBoundaryFeature4
): string {
  return `a:${featureA.key}|b:${featureB.key}`;
}

function polytopeHull4(
  shape: SupportShapeN,
  vertices: readonly SupportVertexN[],
  options: ResolvedOptions4
): PolytopeHull4 | HullFailure4 {
  const resolved = resolveConvexPolytopeTopologyN(shape, {
    facetTolerance: options.facetTolerance,
    rankTolerance: options.rankTolerance,
    maxFacetCandidates: options.maxFacetCandidates
  });
  if (resolved.status !== 'complete') {
    if (resolved.reason === 'shape-not-vertex-enumerable') {
      return { reason: 'facet-enumeration-failed' };
    }
    if (
      resolved.reason === 'facet-candidate-limit' ||
      resolved.reason === 'degenerate-polytope' ||
      resolved.reason === 'facet-enumeration-failed' ||
      resolved.reason === 'compiled-topology-invalid'
    ) {
      return { reason: resolved.reason };
    }
    return { reason: 'facet-enumeration-failed' };
  }
  const topology = resolved.topology!;
  const facets: PolytopeFacet4[] = resolved.facets!.map((facet) => ({
    key: facet.key,
    normal: facet.normal,
    offset: facet.offset,
    vertexFeatureIds: facet.vertexFeatureIds,
    conditionEstimate: facet.conditionEstimate
  }));
  return {
    vertices,
    facets,
    diagnostics: {
      sourceVertices: vertices.length,
      facetCandidates: topology.diagnostics.facetCandidates,
      supportingCandidates: topology.diagnostics.supportingCandidates,
      facets: facets.length,
      topologySource: resolved.topologySource!,
      queryFacetCandidates: resolved.queryFacetCandidates
    }
  };
}

function boundaryFeature(
  point: VecN,
  hull: PolytopeHull4,
  translation: VecN,
  tolerance: number,
  rankTolerance: number
): PolytopeBoundaryFeature4 {
  const active = hull.facets.filter((facet) => {
    const offset = facet.offset + facet.normal.dot(translation);
    const projection = facet.normal.dot(point);
    return Math.abs(projection - offset) <= scaledTolerance(
      tolerance,
      projection,
      offset
    );
  });
  if (active.length === 0) {
    throw new Error('polytopeContactPatch4: contact vertex has no active source facet');
  }
  let common = new Set(active[0]!.vertexFeatureIds.map(supportFeatureKeyN));
  for (let index = 1; index < active.length; index++) {
    const next = new Set(active[index]!.vertexFeatureIds.map(supportFeatureKeyN));
    common = new Set(Array.from(common).filter((key) => next.has(key)));
  }
  const vertices = hull.vertices
    .filter(({ featureId }) => common.has(supportFeatureKeyN(featureId)))
    .sort(compareSupportVertices);
  if (vertices.length === 0) {
    throw new Error('polytopeContactPatch4: active facets have no common source feature');
  }
  const dimension = affineRank4(
    vertices.map(({ point: sourcePoint }) => sourcePoint),
    rankTolerance
  );
  if (dimension > 3) {
    throw new Error('polytopeContactPatch4: contact feature is not on the boundary');
  }
  const vertexFeatureIds = vertices.map(({ featureId }) => featureId);
  return {
    key: polytopeFaceKeyN(vertexFeatureIds),
    vertexFeatureIds,
    dimension: dimension as 0 | 1 | 2 | 3
  };
}

function affineRank4(points: readonly VecN[], tolerance: number): number {
  if (points.length <= 1) return 0;
  const origin = points[0]!;
  const scale = Math.max(
    1,
    ...points.slice(1).map((point) => point.clone().sub(origin).length())
  );
  const basis: VecN[] = [];
  for (let index = 1; index < points.length && basis.length < 4; index++) {
    const residual = points[index]!.clone().sub(origin);
    for (const axis of basis) {
      residual.sub(axis.clone().multiplyScalar(residual.dot(axis)));
    }
    const length = residual.length();
    if (length > tolerance * scale) basis.push(residual.multiplyScalar(1 / length));
  }
  return basis.length;
}

function compareSupportVertices(left: SupportVertexN, right: SupportVertexN): number {
  return compareStrings(
    supportFeatureKeyN(left.featureId),
    supportFeatureKeyN(right.featureId)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scaledTolerance(tolerance: number, ...values: number[]): number {
  return tolerance * Math.max(1, ...values.map(Math.abs));
}

function resolveOptions(options: PolytopeContactOptions4): ResolvedOptions4 {
  const resolved = {
    facetTolerance: options.facetTolerance ?? 1e-10,
    clipTolerance: options.clipTolerance ?? 1e-9,
    vertexTolerance: options.vertexTolerance ?? 1e-8,
    rankTolerance: options.rankTolerance ?? 1e-10,
    maxSolverPoints: options.maxSolverPoints ?? 8,
    maxFacetCandidates: options.maxFacetCandidates ?? 250_000,
    epaOptions: options.epaOptions ?? {}
  };
  for (const [name, value] of [
    ['facetTolerance', resolved.facetTolerance],
    ['clipTolerance', resolved.clipTolerance],
    ['vertexTolerance', resolved.vertexTolerance],
    ['rankTolerance', resolved.rankTolerance]
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`polytopeContactPatch4: ${name} must be finite and non-negative`);
    }
  }
  if (
    !Number.isSafeInteger(resolved.maxSolverPoints) ||
    resolved.maxSolverPoints < 4 ||
    resolved.maxSolverPoints > 32
  ) {
    throw new Error('polytopeContactPatch4: maxSolverPoints must be in [4, 32]');
  }
  if (
    !Number.isSafeInteger(resolved.maxFacetCandidates) ||
    resolved.maxFacetCandidates < 5
  ) {
    throw new Error('polytopeContactPatch4: maxFacetCandidates must be an integer >= 5');
  }
  return resolved;
}
