import {
  VecN,
  affineSectionMapRecipe4,
  affineSliceChartMapRecipe4,
  createRepresentationLineageN,
  fieldRestrictionMapRecipe4,
  projectionMapRecipeN
} from '@holotope/core';
import type {
  FieldEvaluation4,
  RepresentationDetailValue,
  RepresentationHitN,
  SampledIsosurfaceMapRecipe3
} from '@holotope/core';
import type { Object3D, Vector3 } from 'three';
import type { ProjectedEdges3D } from './projected-edges.js';
import type { ProjectedSurface3D } from './projected-surface.js';
import type { SampledSlicedField3D } from './sampled-sliced-field.js';
import type { SlicedComplex3D } from './sliced-complex.js';

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
  const pointLocal = representationPointLocal(product.object, intersection.point);
  const lift = product.liftSegmentPoint(segmentIndex, pointLocal.toArray());
  const ambientPoint = lift.kind === 'exact' ? lift.point : undefined;
  return {
    representation: 'projected-edge',
    point3: vector3Tuple(intersection.point),
    ambientDim: product.complex.ambientDim,
    ambientPointStatus: ambientPoint ? 'exact' : 'unavailable',
    ...(ambientPoint ? { ambientPoint } : {}),
    ambiguity: 'projection-overlap',
    lineage: createRepresentationLineageN(product.complex.ambientDim, [
      projectionMapRecipeN(product.projection)
    ]),
    source: {
      kind: 'cell',
      complex: product.complex,
      intrinsicDim: 1,
      cellIndex: segmentIndex,
      vertexIndices: product.edgeVertices(segmentIndex),
      reference: product.sourceReferenceOfSegment(segmentIndex)
    },
    details: liftDetails(lift)
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
  const pointLocal = representationPointLocal(product.object, intersection.point);
  const lift = product.liftTrianglePoint(faceIndex, pointLocal.toArray());
  const ambientPoint = lift.kind === 'exact' ? lift.point : undefined;
  return {
    representation: 'projected-surface',
    point3: vector3Tuple(intersection.point),
    ambientDim: product.complex.ambientDim,
    ambientPointStatus: ambientPoint ? 'exact' : 'unavailable',
    ...(ambientPoint ? { ambientPoint } : {}),
    ambiguity: 'projection-overlap',
    lineage: createRepresentationLineageN(product.complex.ambientDim, [
      projectionMapRecipeN(product.projection)
    ]),
    source: {
      kind: 'cell',
      complex: product.complex,
      intrinsicDim: 2,
      cellIndex: product.sourceFaceOfTriangle(faceIndex),
      vertexIndices: product.faceVertices(faceIndex),
      reference: product.sourceReferenceOfTriangle(faceIndex)
    },
    details: liftDetails(lift)
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
  const crossings = product.sourceCrossingsOfFace(faceIndex);
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
    lineage: createRepresentationLineageN(4, [
      affineSectionMapRecipe4(product.slice),
      product.projection === undefined
        ? affineSliceChartMapRecipe4(product.slice)
        : projectionMapRecipeN(product.projection)
    ]),
    source: {
      kind: 'cell',
      complex: product.complex,
      intrinsicDim: 3,
      cellIndex: tetIndex,
      vertexIndices: product.sourceTetVertices(tetIndex),
      reference: product.sourceReferenceOfTet(tetIndex)
    },
    details: {
      sliceConstruction: 'edge-interpolation',
      crossingEdgeVertices: crossings.flatMap((crossing) => crossing.edgeVertices),
      crossingParameters: crossings.map((crossing) => crossing.parameter)
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
  const sampledRecipe: SampledIsosurfaceMapRecipe3 = {
    kind: 'sampled-isosurface',
    fromDim: 3,
    toDim: 3,
    shape: [...product.sample.shape],
    min: [...product.sample.min],
    max: [...product.sample.max],
    isoValue: product.surface.isoValue
  };
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
    lineage: createRepresentationLineageN(4, [
      fieldRestrictionMapRecipe4(product.field.id, product.slice),
      sampledRecipe
    ]),
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

function representationPointLocal(object: Object3D, pointWorld: Vector3): Vector3 {
  object.updateWorldMatrix(true, false);
  return object.worldToLocal(pointWorld.clone());
}

function liftDetails(
  lift: ReturnType<ProjectedEdges3D['liftSegmentPoint']>
): Readonly<Record<string, RepresentationDetailValue>> {
  if (lift.kind === 'unavailable') {
    return {
      liftMethod: 'homogeneous-simplex',
      liftFailure: lift.reason,
      ...lift.details
    };
  }
  return {
    liftMethod: 'homogeneous-simplex',
    minAbsQ: lift.minAbsQ,
    simplexConditioning: lift.simplexConditioning,
    representationResidual: lift.representationResidual,
    representationWeights: Array.from(lift.representationWeights),
    sourceWeights: Array.from(lift.sourceWeights)
  };
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
