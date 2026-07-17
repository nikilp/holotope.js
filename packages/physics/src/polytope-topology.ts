import { VecN } from '@holotope/core';
import {
  supportFeatureKeyN,
  supportShapeVerticesN,
  type SupportFeatureId,
  type SupportShapeN,
  type SupportVertexN
} from './support-shape.js';

export interface ConvexPolytopeTopologyOptionsN {
  /** Supporting-facet classification band. Default 1e-10. */
  readonly facetTolerance?: number;
  /** Affine-rank band. Default 1e-10. */
  readonly rankTolerance?: number;
  /** Maximum candidate hyperplanes examined. Default 250000. */
  readonly maxFacetCandidates?: number;
}

export interface CompiledPolytopeFacetN {
  readonly key: string;
  readonly vertexFeatureIds: readonly SupportFeatureId[];
  /** Unit outward normal in the frame in which compilation occurred. */
  readonly referenceNormal: readonly number[];
  readonly referenceOffset: number;
  readonly conditionEstimate: number;
}

export interface ConvexPolytopeTopologyDiagnosticsN {
  readonly dim: number;
  readonly sourceVertices: number;
  readonly facetCandidates: number;
  readonly supportingCandidates: number;
  readonly facets: number;
}

/**
 * Pose-independent convex-polytope incidence compiled from stable source IDs.
 * Reference planes are retained for audit; live planes are reconstructed and
 * validated from the shape's current vertex positions.
 */
export interface ConvexPolytopeTopologyN {
  readonly schema: 'holotope-convex-polytope-topology-v1';
  readonly dim: number;
  readonly vertexFeatureIds: readonly SupportFeatureId[];
  readonly facets: readonly CompiledPolytopeFacetN[];
  readonly diagnostics: ConvexPolytopeTopologyDiagnosticsN;
}

export type ConvexPolytopeTopologyReasonN =
  | 'complete'
  | 'shape-not-vertex-enumerable'
  | 'facet-candidate-limit'
  | 'degenerate-polytope'
  | 'facet-enumeration-failed';

export interface ConvexPolytopeTopologyResultN {
  readonly status: 'complete' | 'unsupported' | 'indeterminate';
  readonly reason: ConvexPolytopeTopologyReasonN;
  readonly topology: ConvexPolytopeTopologyN | null;
  readonly facetCandidates: number;
}

export interface InstantiatedPolytopeFacetN {
  readonly key: string;
  readonly normal: VecN;
  readonly offset: number;
  readonly vertexFeatureIds: readonly SupportFeatureId[];
  readonly conditionEstimate: number;
}

export type PolytopeTopologyInstantiationReasonN =
  | 'complete'
  | 'invalid-schema'
  | 'dimension-mismatch'
  | 'vertex-feature-mismatch'
  | 'facet-geometry-mismatch';

export interface PolytopeTopologyInstantiationResultN {
  readonly status: 'complete' | 'invalid';
  readonly reason: PolytopeTopologyInstantiationReasonN;
  readonly facets: readonly InstantiatedPolytopeFacetN[] | null;
}

export type ConvexPolytopeResolutionReasonN =
  | ConvexPolytopeTopologyReasonN
  | 'compiled-topology-invalid';

export interface ConvexPolytopeResolutionResultN {
  readonly status: 'complete' | 'unsupported' | 'indeterminate';
  readonly reason: ConvexPolytopeResolutionReasonN;
  readonly topology: ConvexPolytopeTopologyN | null;
  readonly vertices: readonly SupportVertexN[] | null;
  readonly facets: readonly InstantiatedPolytopeFacetN[] | null;
  readonly topologySource: 'compiled' | 'enumerated' | null;
  readonly queryFacetCandidates: number;
}

/** Compile the complete boundary-facet incidence of a full-dimensional hull. */
export function compileConvexPolytopeTopologyN(
  shape: SupportShapeN,
  options: ConvexPolytopeTopologyOptionsN = {}
): ConvexPolytopeTopologyResultN {
  const vertices = supportShapeVerticesN(shape);
  if (!vertices) {
    return {
      status: 'unsupported',
      reason: 'shape-not-vertex-enumerable',
      topology: null,
      facetCandidates: 0
    };
  }
  const resolved = resolveOptions(options, 'compileConvexPolytopeTopologyN');
  const facetCandidates = choose(vertices.length, shape.dim);
  if (
    vertices.length < shape.dim + 1 ||
    affineRankN(vertices.map(({ point }) => point), resolved.rankTolerance) < shape.dim
  ) {
    return {
      status: 'indeterminate',
      reason: 'degenerate-polytope',
      topology: null,
      facetCandidates
    };
  }
  if (facetCandidates > resolved.maxFacetCandidates) {
    return {
      status: 'indeterminate',
      reason: 'facet-candidate-limit',
      topology: null,
      facetCandidates
    };
  }

  const scale = geometricScaleN(vertices.map(({ point }) => point));
  const facets = new Map<string, CompiledPolytopeFacetN>();
  let supportingCandidates = 0;
  forEachCombination(vertices.length, shape.dim, (indices) => {
    const candidateVertices = indices.map((index) => vertices[index]!);
    const plane = planeFromFacetVertices(
      candidateVertices,
      vertices,
      scale,
      resolved.facetTolerance,
      resolved.rankTolerance
    );
    if (!plane) return;
    const coplanar = vertices.filter(({ point }) =>
      Math.abs(plane.normal.dot(point) - plane.offset) <= plane.band
    );
    if (
      coplanar.length < shape.dim ||
      affineRankN(coplanar.map(({ point }) => point), resolved.rankTolerance) < shape.dim - 1
    ) {
      return;
    }
    supportingCandidates++;
    const ordered = [...coplanar].sort(compareSupportVertices);
    const vertexFeatureIds = ordered.map(({ featureId }) => featureId);
    const key = polytopeFaceKeyN(vertexFeatureIds);
    const candidate: CompiledPolytopeFacetN = {
      key,
      vertexFeatureIds: Object.freeze(vertexFeatureIds),
      referenceNormal: Object.freeze(Array.from(plane.normal.data)),
      referenceOffset: plane.offset,
      conditionEstimate: plane.conditionEstimate
    };
    const existing = facets.get(key);
    if (!existing || candidate.conditionEstimate > existing.conditionEstimate) {
      facets.set(key, candidate);
    }
  });

  const orderedFacets = Array.from(facets.values())
    .sort((left, right) => compareStrings(left.key, right.key))
    .map((facet) => Object.freeze(facet));
  if (orderedFacets.length < shape.dim + 1) {
    return {
      status: 'indeterminate',
      reason: 'facet-enumeration-failed',
      topology: null,
      facetCandidates
    };
  }
  const vertexFeatureIds = [...vertices]
    .sort(compareSupportVertices)
    .map(({ featureId }) => featureId);
  const diagnostics = Object.freeze({
    dim: shape.dim,
    sourceVertices: vertices.length,
    facetCandidates,
    supportingCandidates,
    facets: orderedFacets.length
  });
  const topology: ConvexPolytopeTopologyN = Object.freeze({
    schema: 'holotope-convex-polytope-topology-v1' as const,
    dim: shape.dim,
    vertexFeatureIds: Object.freeze(vertexFeatureIds),
    facets: Object.freeze(orderedFacets),
    diagnostics
  });
  return {
    status: 'complete',
    reason: 'complete',
    topology,
    facetCandidates
  };
}

/**
 * Reconstruct and validate current facet planes from a compiled incidence.
 * This is O(facets × vertices), rather than the compiler's O(choose(vertices,n)).
 */
export function instantiateConvexPolytopeTopologyN(
  topology: ConvexPolytopeTopologyN,
  vertices: readonly SupportVertexN[],
  options: Omit<ConvexPolytopeTopologyOptionsN, 'maxFacetCandidates'> = {}
): PolytopeTopologyInstantiationResultN {
  const resolved = resolveOptions(options, 'instantiateConvexPolytopeTopologyN');
  if (topology.schema !== 'holotope-convex-polytope-topology-v1') {
    return { status: 'invalid', reason: 'invalid-schema', facets: null };
  }
  if (!hasValidTopologyMetadata(topology)) {
    return { status: 'invalid', reason: 'invalid-schema', facets: null };
  }
  if (
    !Number.isSafeInteger(topology.dim) ||
    topology.dim < 1 ||
    vertices.some(({ point }) => point.dim !== topology.dim)
  ) {
    return { status: 'invalid', reason: 'dimension-mismatch', facets: null };
  }
  const currentByKey = new Map<string, SupportVertexN>();
  for (const vertex of vertices) {
    const key = supportFeatureKeyN(vertex.featureId);
    if (currentByKey.has(key)) {
      return { status: 'invalid', reason: 'vertex-feature-mismatch', facets: null };
    }
    currentByKey.set(key, vertex);
  }
  const expectedKeys = topology.vertexFeatureIds.map(supportFeatureKeyN).sort(compareStrings);
  const currentKeys = Array.from(currentByKey.keys()).sort(compareStrings);
  if (!sameStrings(expectedKeys, currentKeys)) {
    return { status: 'invalid', reason: 'vertex-feature-mismatch', facets: null };
  }
  if (
    vertices.length < topology.dim + 1 ||
    affineRankN(vertices.map(({ point }) => point), resolved.rankTolerance) < topology.dim
  ) {
    return { status: 'invalid', reason: 'facet-geometry-mismatch', facets: null };
  }

  const scale = geometricScaleN(vertices.map(({ point }) => point));
  const facets: InstantiatedPolytopeFacetN[] = [];
  const seen = new Set<string>();
  for (const sourceFacet of topology.facets) {
    if (seen.has(sourceFacet.key)) {
      return { status: 'invalid', reason: 'facet-geometry-mismatch', facets: null };
    }
    seen.add(sourceFacet.key);
    const facetVertices: SupportVertexN[] = [];
    for (const featureId of sourceFacet.vertexFeatureIds) {
      const vertex = currentByKey.get(supportFeatureKeyN(featureId));
      if (!vertex) {
        return { status: 'invalid', reason: 'vertex-feature-mismatch', facets: null };
      }
      facetVertices.push(vertex);
    }
    const expectedFacetKeys = sourceFacet.vertexFeatureIds
      .map(supportFeatureKeyN)
      .sort(compareStrings);
    if (
      sourceFacet.key !== polytopeFaceKeyN(sourceFacet.vertexFeatureIds) ||
      facetVertices.length < topology.dim ||
      affineRankN(facetVertices.map(({ point }) => point), resolved.rankTolerance) < topology.dim - 1
    ) {
      return { status: 'invalid', reason: 'facet-geometry-mismatch', facets: null };
    }
    const basisVertices = independentFacetBasis(
      facetVertices,
      topology.dim,
      scale,
      resolved.rankTolerance
    );
    if (!basisVertices) {
      return { status: 'invalid', reason: 'facet-geometry-mismatch', facets: null };
    }
    const plane = planeFromFacetVertices(
      basisVertices,
      vertices,
      scale,
      resolved.facetTolerance,
      resolved.rankTolerance
    );
    if (!plane) {
      return { status: 'invalid', reason: 'facet-geometry-mismatch', facets: null };
    }
    const actualFacetKeys = vertices
      .filter(({ point }) =>
        Math.abs(plane.normal.dot(point) - plane.offset) <= plane.band
      )
      .map(({ featureId }) => supportFeatureKeyN(featureId))
      .sort(compareStrings);
    if (!sameStrings(expectedFacetKeys, actualFacetKeys)) {
      return { status: 'invalid', reason: 'facet-geometry-mismatch', facets: null };
    }
    facets.push({
      key: sourceFacet.key,
      normal: plane.normal,
      offset: plane.offset,
      vertexFeatureIds: sourceFacet.vertexFeatureIds,
      conditionEstimate: plane.conditionEstimate
    });
  }
  if (facets.length < topology.dim + 1) {
    return { status: 'invalid', reason: 'facet-geometry-mismatch', facets: null };
  }
  return { status: 'complete', reason: 'complete', facets };
}

/** Resolve an attached topology, or compile the exhaustive golden product. */
export function resolveConvexPolytopeTopologyN(
  shape: SupportShapeN,
  options: ConvexPolytopeTopologyOptionsN = {}
): ConvexPolytopeResolutionResultN {
  const vertices = supportShapeVerticesN(shape);
  if (!vertices) {
    return {
      status: 'unsupported',
      reason: 'shape-not-vertex-enumerable',
      topology: null,
      vertices: null,
      facets: null,
      topologySource: null,
      queryFacetCandidates: 0
    };
  }
  const attached = shape.polytopeTopology;
  const compilation = attached
    ? null
    : compileConvexPolytopeTopologyN(shape, options);
  if (compilation && compilation.status !== 'complete') {
    return {
      status: compilation.status,
      reason: compilation.reason,
      topology: null,
      vertices,
      facets: null,
      topologySource: 'enumerated',
      queryFacetCandidates: compilation.facetCandidates
    };
  }
  const topology = attached ?? compilation!.topology!;
  const instantiated = instantiateConvexPolytopeTopologyN(topology, vertices, options);
  if (instantiated.status !== 'complete' || !instantiated.facets) {
    return {
      status: 'indeterminate',
      reason: 'compiled-topology-invalid',
      topology,
      vertices,
      facets: null,
      topologySource: attached ? 'compiled' : 'enumerated',
      queryFacetCandidates: attached ? 0 : topology.diagnostics.facetCandidates
    };
  }
  return {
    status: 'complete',
    reason: 'complete',
    topology,
    vertices,
    facets: instantiated.facets,
    topologySource: attached ? 'compiled' : 'enumerated',
    queryFacetCandidates: attached ? 0 : topology.diagnostics.facetCandidates
  };
}

/** Attach a compiled topology to any compatible support shape without copying it. */
export class CompiledPolytopeSupportShapeN implements SupportShapeN {
  readonly source: SupportShapeN;
  readonly polytopeTopology: ConvexPolytopeTopologyN;

  constructor(source: SupportShapeN, topology: ConvexPolytopeTopologyN) {
    const vertices = supportShapeVerticesN(source);
    if (!vertices) {
      throw new Error('CompiledPolytopeSupportShapeN: source is not vertex-enumerable');
    }
    const instantiated = instantiateConvexPolytopeTopologyN(topology, vertices);
    if (instantiated.status !== 'complete') {
      throw new Error(
        `CompiledPolytopeSupportShapeN: incompatible topology (${instantiated.reason})`
      );
    }
    this.source = source;
    this.polytopeTopology = topology;
  }

  get dim(): number {
    return this.source.dim;
  }

  get center(): VecN {
    return this.source.center;
  }

  support(direction: VecN): SupportVertexN {
    return this.source.support(direction);
  }

  resolveFeature(featureId: SupportFeatureId): SupportVertexN | undefined {
    return this.source.resolveFeature?.(featureId);
  }

  enumerateVertices(): readonly SupportVertexN[] | undefined {
    return this.source.enumerateVertices?.();
  }
}

export function polytopeFaceKeyN(featureIds: readonly SupportFeatureId[]): string {
  return `v[${[...featureIds]
    .sort(compareFeatureIds)
    .map(supportFeatureKeyN)
    .join(',')}]`;
}

interface ResolvedOptionsN {
  facetTolerance: number;
  rankTolerance: number;
  maxFacetCandidates: number;
}

interface FacetPlaneN {
  normal: VecN;
  offset: number;
  band: number;
  conditionEstimate: number;
}

function planeFromFacetVertices(
  facetVertices: readonly SupportVertexN[],
  allVertices: readonly SupportVertexN[],
  scale: number,
  facetTolerance: number,
  rankTolerance: number
): FacetPlaneN | null {
  const dim = allVertices[0]!.point.dim;
  const origin = facetVertices[0]!.point;
  const edges = facetVertices.slice(1, dim).map(({ point }) => point.clone().sub(origin));
  if (edges.length !== dim - 1) return null;
  const rawNormal = generalizedCrossN(edges, dim);
  const length = rawNormal.length();
  const edgeProduct = edges.reduce((product, edge) => product * edge.length(), 1);
  if (
    !(edgeProduct > 0) ||
    length <= rankTolerance * Math.max(scale ** Math.max(1, dim - 1), edgeProduct)
  ) {
    return null;
  }
  const normal = rawNormal.multiplyScalar(1 / length);
  let offset = normal.dot(origin);
  let band = facetTolerance * Math.max(1, scale, Math.abs(offset));
  const distances = allVertices.map(({ point }) => normal.dot(point) - offset);
  const positive = distances.some((distance) => distance > band);
  const negative = distances.some((distance) => distance < -band);
  if ((positive && negative) || (!positive && !negative)) return null;
  if (positive) {
    normal.multiplyScalar(-1);
    offset *= -1;
    band = facetTolerance * Math.max(1, scale, Math.abs(offset));
  }
  return {
    normal,
    offset,
    band,
    conditionEstimate: Math.min(1, length / edgeProduct)
  };
}

function independentFacetBasis(
  vertices: readonly SupportVertexN[],
  dim: number,
  scale: number,
  tolerance: number
): readonly SupportVertexN[] | null {
  const origin = vertices[0]!;
  const result: SupportVertexN[] = [origin];
  const orthonormal: VecN[] = [];
  for (let index = 1; index < vertices.length && result.length < dim; index++) {
    const raw = vertices[index]!.point.clone().sub(origin.point);
    const residual = raw.clone();
    for (const axis of orthonormal) {
      residual.sub(axis.clone().multiplyScalar(residual.dot(axis)));
    }
    const length = residual.length();
    if (length > tolerance * scale) {
      result.push(vertices[index]!);
      orthonormal.push(residual.multiplyScalar(1 / length));
    }
  }
  return result.length === dim ? result : null;
}

function generalizedCrossN(edges: readonly VecN[], dim: number): VecN {
  if (edges.length !== dim - 1) {
    throw new Error('generalizedCrossN: expected n-1 edge vectors');
  }
  const result = new VecN(dim);
  for (let omitted = 0; omitted < dim; omitted++) {
    const matrix = edges.map((edge) =>
      Array.from({ length: dim }, (_, axis) => axis)
        .filter((axis) => axis !== omitted)
        .map((axis) => edge.data[axis]!)
    );
    const value = determinant(matrix);
    result.data[omitted] = (omitted & 1) === 0 ? value : -value;
  }
  return result;
}

function determinant(source: readonly (readonly number[])[]): number {
  const n = source.length;
  if (n === 0) return 1;
  const matrix = source.map((row) => [...row]);
  let sign = 1;
  let result = 1;
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!)) {
        pivot = row;
      }
    }
    const pivotValue = matrix[pivot]![column]!;
    if (pivotValue === 0) return 0;
    if (pivot !== column) {
      [matrix[pivot], matrix[column]] = [matrix[column]!, matrix[pivot]!];
      sign *= -1;
    }
    result *= matrix[column]![column]!;
    for (let row = column + 1; row < n; row++) {
      const factor = matrix[row]![column]! / matrix[column]![column]!;
      for (let other = column + 1; other < n; other++) {
        matrix[row]![other]! -= factor * matrix[column]![other]!;
      }
    }
  }
  return sign * result;
}

function affineRankN(points: readonly VecN[], tolerance: number): number {
  if (points.length <= 1) return 0;
  const dim = points[0]!.dim;
  const scale = geometricScaleN(points);
  const origin = points[0]!;
  const basis: VecN[] = [];
  for (let index = 1; index < points.length && basis.length < dim; index++) {
    const residual = points[index]!.clone().sub(origin);
    for (const axis of basis) {
      residual.sub(axis.clone().multiplyScalar(residual.dot(axis)));
    }
    const length = residual.length();
    if (length > tolerance * scale) basis.push(residual.multiplyScalar(1 / length));
  }
  return basis.length;
}

function geometricScaleN(points: readonly VecN[]): number {
  if (points.length <= 1) return 1;
  const origin = points[0]!;
  return Math.max(
    1,
    ...points.slice(1).map((point) => point.clone().sub(origin).length())
  );
}

function forEachCombination(
  count: number,
  size: number,
  visit: (indices: readonly number[]) => void
): void {
  const indices = Array.from({ length: size }, (_, index) => index);
  while (size > 0 && indices[0]! <= count - size) {
    visit(indices);
    let cursor = size - 1;
    while (cursor >= 0 && indices[cursor] === count - size + cursor) cursor--;
    if (cursor < 0) return;
    indices[cursor]!++;
    for (let index = cursor + 1; index < size; index++) {
      indices[index] = indices[index - 1]! + 1;
    }
  }
}

function choose(count: number, size: number): number {
  if (size < 0 || size > count) return 0;
  const reduced = Math.min(size, count - size);
  let result = 1;
  for (let index = 1; index <= reduced; index++) {
    result = result * (count - reduced + index) / index;
    if (!Number.isSafeInteger(result)) return Number.POSITIVE_INFINITY;
  }
  return result;
}

function compareSupportVertices(left: SupportVertexN, right: SupportVertexN): number {
  return compareFeatureIds(left.featureId, right.featureId);
}

function compareFeatureIds(left: SupportFeatureId, right: SupportFeatureId): number {
  return compareStrings(supportFeatureKeyN(left), supportFeatureKeyN(right));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasValidTopologyMetadata(topology: ConvexPolytopeTopologyN): boolean {
  const diagnostics = topology.diagnostics;
  return (
    Number.isSafeInteger(topology.dim) &&
    topology.dim >= 1 &&
    diagnostics.dim === topology.dim &&
    diagnostics.sourceVertices === topology.vertexFeatureIds.length &&
    diagnostics.facets === topology.facets.length &&
    Number.isSafeInteger(diagnostics.facetCandidates) &&
    diagnostics.facetCandidates >= 1 &&
    Number.isSafeInteger(diagnostics.supportingCandidates) &&
    diagnostics.supportingCandidates >= diagnostics.facets &&
    diagnostics.supportingCandidates <= diagnostics.facetCandidates &&
    topology.facets.every((facet) =>
      facet.key.length > 0 &&
      facet.referenceNormal.length === topology.dim &&
      facet.referenceNormal.every(Number.isFinite) &&
      Number.isFinite(facet.referenceOffset) &&
      Number.isFinite(facet.conditionEstimate) &&
      facet.conditionEstimate > 0 &&
      facet.conditionEstimate <= 1
    )
  );
}

function resolveOptions(
  options: ConvexPolytopeTopologyOptionsN,
  owner: string
): ResolvedOptionsN {
  const facetTolerance = options.facetTolerance ?? 1e-10;
  const rankTolerance = options.rankTolerance ?? 1e-10;
  const maxFacetCandidates = options.maxFacetCandidates ?? 250_000;
  for (const [name, value] of [
    ['facetTolerance', facetTolerance],
    ['rankTolerance', rankTolerance]
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${owner}: ${name} must be finite and non-negative`);
    }
  }
  if (!Number.isSafeInteger(maxFacetCandidates) || maxFacetCandidates < 1) {
    throw new Error(`${owner}: maxFacetCandidates must be a positive integer`);
  }
  return { facetTolerance, rankTolerance, maxFacetCandidates };
}
