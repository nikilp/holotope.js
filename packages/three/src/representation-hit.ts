import { VecN } from '@holotope/core';
import type {
  CellComplex,
  FieldEvaluation4,
  ImplicitField4
} from '@holotope/core';
import type { Object3D, Vector3 } from 'three';
import type { ProjectedEdges3D } from './projected-edges.js';
import type { ProjectedSurface3D } from './projected-surface.js';
import type { SampledSlicedField3D } from './sampled-sliced-field.js';
import type { SlicedComplex3D } from './sliced-complex.js';

export type RepresentationKind3D =
  | 'projected-edge'
  | 'projected-surface'
  | 'sliced-complex'
  | 'sampled-sliced-field'
  | 'raymarched-field';

/** Precision of the represented ambient point, independent of source identity. */
export type AmbientPointStatus = 'exact' | 'approximate' | 'unavailable';

/** Why a visible 3D selection may or may not name one ambient source point. */
export type RepresentationAmbiguity =
  | 'none'
  | 'projection-overlap'
  | 'sampled-surface'
  | 'first-ray-hit';

export interface RepresentationCellSourceN {
  readonly kind: 'cell';
  readonly complex: CellComplex;
  readonly intrinsicDim: number;
  /** Index in the render product's documented concatenated cell sequence. */
  readonly cellIndex: number;
  readonly vertexIndices: readonly number[];
}

export interface RepresentationSampleCellSource4<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> {
  readonly kind: 'sample-cell';
  readonly field: ImplicitField4<Evaluation>;
  readonly cellIndex: number;
}

export interface RepresentationFieldRecordSource4<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> {
  readonly kind: 'field-record';
  readonly field: ImplicitField4<Evaluation>;
  readonly record: Evaluation;
}

export type RepresentationSourceN<Evaluation extends FieldEvaluation4 = FieldEvaluation4> =
  | RepresentationCellSourceN
  | RepresentationSampleCellSource4<Evaluation>
  | RepresentationFieldRecordSource4<Evaluation>;

/**
 * Common inspection result across explicit, sampled, and implicit products.
 *
 * `point3` is the selected world-space representation point. `ambientPoint`
 * exists only when the adapter can lift or trace it correctly. Source identity
 * is retained independently, so an unavailable inverse never erases which
 * higher-dimensional primitive generated a projected hit.
 */
export interface RepresentationHitN<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> {
  readonly representation: RepresentationKind3D;
  readonly point3: readonly [number, number, number];
  readonly ambientDim: number;
  readonly ambientPointStatus: AmbientPointStatus;
  readonly ambientPoint?: VecN;
  readonly ambiguity: RepresentationAmbiguity;
  readonly source: RepresentationSourceN<Evaluation>;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

/** Minimal Three.js intersection surface consumed by provenance adapters. */
export interface RepresentationIntersection3D {
  readonly point: Vector3;
  readonly faceIndex?: number | null;
  readonly index?: number;
}

/** Map a picked projected line segment to its exact source edge vertices. */
export function representationHitFromProjectedEdge(
  product: ProjectedEdges3D,
  intersection: RepresentationIntersection3D
): RepresentationHitN {
  const index = intersection.index;
  if (!Number.isSafeInteger(index) || index === undefined || index < 0) {
    throw new Error(
      'representationHitFromProjectedEdge: intersection.index must name an index-buffer position'
    );
  }
  const segmentIndex = Math.floor(index / 2);
  return {
    representation: 'projected-edge',
    point3: vector3Tuple(intersection.point),
    ambientDim: product.complex.ambientDim,
    ambientPointStatus: 'unavailable',
    ambiguity: 'projection-overlap',
    source: {
      kind: 'cell',
      complex: product.complex,
      intrinsicDim: 1,
      cellIndex: segmentIndex,
      vertexIndices: product.edgeVertices(segmentIndex)
    }
  };
}

/** Map a picked projected triangle to its exact source face and vertices. */
export function representationHitFromProjectedSurface(
  product: ProjectedSurface3D,
  intersection: RepresentationIntersection3D
): RepresentationHitN {
  const faceIndex = requireFaceIndex(
    intersection,
    'representationHitFromProjectedSurface'
  );
  return {
    representation: 'projected-surface',
    point3: vector3Tuple(intersection.point),
    ambientDim: product.complex.ambientDim,
    ambientPointStatus: 'unavailable',
    ambiguity: 'projection-overlap',
    source: {
      kind: 'cell',
      complex: product.complex,
      intrinsicDim: 2,
      cellIndex: product.sourceFaceOfTriangle(faceIndex),
      vertexIndices: product.faceVertices(faceIndex)
    }
  };
}

/**
 * Map a picked section triangle to its source tetrahedron. An unprojected
 * slice is an affine coordinate chart and therefore also yields an exact R4
 * point. A section rendered through a projection retains only source identity.
 */
export function representationHitFromSlicedComplex(
  product: SlicedComplex3D,
  intersection: RepresentationIntersection3D
): RepresentationHitN {
  const faceIndex = requireFaceIndex(
    intersection,
    'representationHitFromSlicedComplex'
  );
  const tetIndex = product.sourceTetOfFace(faceIndex);
  const ambientPoint = product.projection === undefined
    ? embedLocalSlicePoint(product.object, product.slice, intersection.point)
    : undefined;
  return {
    representation: 'sliced-complex',
    point3: vector3Tuple(intersection.point),
    ambientDim: 4,
    ambientPointStatus: ambientPoint ? 'exact' : 'unavailable',
    ...(ambientPoint ? { ambientPoint } : {}),
    ambiguity: ambientPoint ? 'none' : 'projection-overlap',
    source: {
      kind: 'cell',
      complex: product.complex,
      intrinsicDim: 3,
      cellIndex: tetIndex,
      vertexIndices: product.sourceTetVertices(tetIndex)
    }
  };
}

/** Map an approximate extracted field triangle to its exact source grid cell. */
export function representationHitFromSampledSlicedField<
  Record extends FieldEvaluation4
>(
  product: SampledSlicedField3D<Record>,
  intersection: RepresentationIntersection3D
): RepresentationHitN<Record> {
  const faceIndex = requireFaceIndex(
    intersection,
    'representationHitFromSampledSlicedField'
  );
  return {
    representation: 'sampled-sliced-field',
    point3: vector3Tuple(intersection.point),
    ambientDim: 4,
    ambientPointStatus: 'approximate',
    ambientPoint: embedLocalSlicePoint(
      product.object,
      product.slice,
      intersection.point
    ),
    ambiguity: 'sampled-surface',
    source: {
      kind: 'sample-cell',
      field: product.field,
      cellIndex: product.sourceCellOfFace(faceIndex)
    }
  };
}

function embedLocalSlicePoint(
  object: Object3D,
  slice: { embedPoint(point: ArrayLike<number>): [number, number, number, number] },
  pointWorld: Vector3
): VecN {
  object.updateWorldMatrix(true, false);
  const pointLocal = object.worldToLocal(pointWorld.clone());
  return new VecN(slice.embedPoint(pointLocal.toArray()));
}

function requireFaceIndex(
  intersection: RepresentationIntersection3D,
  caller: string
): number {
  const faceIndex = intersection.faceIndex;
  if (!Number.isSafeInteger(faceIndex) || faceIndex === undefined || faceIndex === null || faceIndex < 0) {
    throw new Error(`${caller}: intersection.faceIndex must be a non-negative integer`);
  }
  return faceIndex;
}

function vector3Tuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}
