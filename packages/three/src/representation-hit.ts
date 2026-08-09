import {
  VecN,
  affineSectionMapRecipe4,
  affineSectionMapRecipeN,
  affineSliceChartMapRecipe4,
  affineSliceChartMapRecipeN,
  createRepresentationLineageN,
  createSourceCellIdN,
  createSourceCellReferenceN,
  displayMapRecipe3,
  fieldRestrictionMapRecipe4,
  isInvertibleDisplayMap3D,
  projectionMapRecipeN,
  resolveRepresentationChartPointToSourceCellN
} from '@holotope/core';
import type { DisplayMap3D, DisplayMapInverse3D, RepresentationAmbiguity } from '@holotope/core';
import type {
  AffineSectionMapRecipeN,
  AffineSliceChartMapRecipeN,
  FieldEvaluation4,
  RepresentationDetailValue,
  RepresentationChartSourceCellResolutionN,
  RepresentationHitN,
  SampledIsosurfaceMapRecipe3
} from '@holotope/core';
import type { Object3D, Vector3 } from 'three';
import type { ProjectedEdges3D } from './projected-edges.js';
import type { ProjectedSurface3D } from './projected-surface.js';
import type { SampledSlicedField3D } from './sampled-sliced-field.js';
import type { SectionChart3D } from './section-chart.js';
import type { SlicedComplex3D } from './sliced-complex.js';

/**
 * Minimal Three.js intersection surface consumed by provenance adapters.
 *
 * The optional members admit `undefined` explicitly so a Three `Intersection`
 * is structurally assignable under `exactOptionalPropertyTypes`. Three declares
 * `faceIndex?: number`, this adapter distinguishes an absent index from a null
 * one, and without the explicit `| undefined` the two are not compatible.
 */
export interface RepresentationIntersection3D {
  readonly point: Vector3;
  readonly faceIndex?: number | null | undefined;
  readonly index?: number | undefined;
}


/**
 * Observed display points are Float32 and, on a posed object, carry a
 * world-to-local round trip; exact `z === 0` membership would refuse almost
 * every honest pick. The band is explicit here because the recovered point is
 * *qualified approximate* in the hit — acceptance within the band and the
 * qualification are the same statement.
 */
const OBSERVED_POINT_INVERSE_TOLERANCE = 1e-5;

/** Details of an embedding-inverse recovery, in place of a lift record. */
function displayMapInverseDetails(
  inverse: DisplayMapInverse3D
): Readonly<Record<string, RepresentationDetailValue>> {
  return inverse.status === 'on-image'
    ? { liftMethod: 'display-map-inverse', inverseStatus: 'on-image' }
    : {
        liftMethod: 'display-map-inverse',
        inverseStatus: 'off-image',
        distanceFromImage: inverse.distanceFromImage
      };
}

/** Inverse of a picked local point through an injective display map, if any. */
function invertObservedPoint(
  map: DisplayMap3D,
  pointLocal: ArrayLike<number>
): { inverse: DisplayMapInverse3D; ambiguity: RepresentationAmbiguity } | null {
  if (!isInvertibleDisplayMap3D(map)) return null;
  return {
    inverse: map.invertPoint(pointLocal, {
      tolerance: OBSERVED_POINT_INVERSE_TOLERANCE
    }),
    // Injectivity is exactly the absence of projection overlap.
    ambiguity: 'none'
  };
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
  const inverted = invertObservedPoint(product.projection, pointLocal.toArray());
  const ambientPoint = lift.kind === 'exact'
    ? lift.point
    : inverted?.inverse.status === 'on-image'
      ? new VecN(inverted.inverse.point)
      : undefined;
  const sourceReference = product.sourceReferenceOfSegment(segmentIndex);
  return {
    representation: 'projected-edge',
    point3: vector3Tuple(intersection.point),
    ambientDim: product.complex.ambientDim,
    // An inverse of an observed Float32 point is approximate by provenance;
    // only the homogeneous lift may say 'exact'.
    ambientPointStatus: lift.kind === 'exact'
      ? 'exact'
      : ambientPoint ? 'approximate' : 'unavailable',
    ...(ambientPoint ? { ambientPoint } : {}),
    ambiguity: inverted?.ambiguity ?? 'projection-overlap',
    lineage: createRepresentationLineageN(product.complex.ambientDim, [
      displayMapRecipe3(product.projection)
    ]),
    source: {
      kind: 'cell',
      complex: product.complex,
      intrinsicDim: 1,
      cellIndex: segmentIndex,
      vertexIndices: product.edgeVertices(segmentIndex),
      reference: sourceReference,
      id: createSourceCellIdN(sourceReference)
    },
    details: inverted ? displayMapInverseDetails(inverted.inverse) : liftDetails(lift)
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
  const inverted = invertObservedPoint(product.projection, pointLocal.toArray());
  const ambientPoint = lift.kind === 'exact'
    ? lift.point
    : inverted?.inverse.status === 'on-image'
      ? new VecN(inverted.inverse.point)
      : undefined;
  const sourceReference = product.sourceReferenceOfTriangle(faceIndex);
  return {
    representation: 'projected-surface',
    point3: vector3Tuple(intersection.point),
    ambientDim: product.complex.ambientDim,
    ambientPointStatus: lift.kind === 'exact'
      ? 'exact'
      : ambientPoint ? 'approximate' : 'unavailable',
    ...(ambientPoint ? { ambientPoint } : {}),
    ambiguity: inverted?.ambiguity ?? 'projection-overlap',
    lineage: createRepresentationLineageN(product.complex.ambientDim, [
      displayMapRecipe3(product.projection)
    ]),
    source: {
      kind: 'cell',
      complex: product.complex,
      intrinsicDim: 2,
      cellIndex: product.sourceFaceOfTriangle(faceIndex),
      vertexIndices: product.faceVertices(faceIndex),
      reference: sourceReference,
      id: createSourceCellIdN(sourceReference)
    },
    details: inverted ? displayMapInverseDetails(inverted.inverse) : liftDetails(lift)
  };
}

/**
 * Map a picked section triangle to its source tetrahedron. An unprojected
 * slice is an affine coordinate chart and therefore also yields an exact R4
 * point in the **posed ambient source frame used for the latest update**. It
 * is not already transformed back into the complex's unposed local frame. A
 * section rendered through a projection retains only source identity.
 */
export function representationHitFromSlicedComplex(
  product: SlicedComplex3D,
  intersection: RepresentationIntersection3D
): RepresentationHitN {
  const faceIndex = requireFaceIndex(
    intersection,
    'representationHitFromSlicedComplex'
  );
  const pointLocal = representationPointLocal(product.object, intersection.point);
  const chart = product.sourceCellChart();
  const resolved: RepresentationChartSourceCellResolutionN =
    resolveRepresentationChartPointToSourceCellN(
      chart,
      pointLocal.toArray(),
      {
        triangleIndex: faceIndex
      }
    );
  if (resolved.kind !== 'resolved') {
    throw new Error(
      `representationHitFromSlicedComplex: source cell ${resolved.reason}`
    );
  }
  const tetIndex = product.sourceTetOfFace(resolved.triangleIndex);
  const crossings = product.sourceCrossingsOfFace(faceIndex);
  const sourceReference = resolved.reference;
  const ambientPoint = resolved.sourceCoordinate.kind === 'exact'
    ? resolved.sourceCoordinate.ambientPoint
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
      reference: sourceReference,
      id: createSourceCellIdN(sourceReference)
    },
    details: {
      sliceConstruction: 'edge-interpolation',
      crossingEdgeVertices: crossings.flatMap((crossing) => crossing.edgeVertices),
      crossingParameters: crossings.map((crossing) => crossing.parameter)
    }
  };
}

/**
 * Map a picked RN section primitive to its parent source cell and ancestry.
 *
 * The chart is injective — a section names its source, so `ambiguity` is
 * `'none'` — but the picked point travelled through Float32 display buffers
 * and barycentric interpolation, so its embedded ambient point is reported as
 * `'approximate'`, never upgraded to `'exact'`. Source **identity** is exact:
 * the parent cell index comes from the section's own `parentCells`, and each
 * corner's original-source affine ancestry rides along in the details, which
 * is what survives a chained section.
 *
 * Points and segments report through `intersection.index`; triangles through
 * `intersection.faceIndex` — the same convention as the other adapters.
 */
export function representationHitFromSectionChart(
  product: SectionChart3D,
  intersection: RepresentationIntersection3D
): RepresentationHitN {
  const section = product.section;
  const slotsPerPrimitive = section.verticesPerCell;
  let primitive: number;
  if (product.cellDim >= 2) {
    primitive = requireFaceIndex(intersection, 'representationHitFromSectionChart');
  } else {
    const index = intersection.index;
    if (index === undefined || !Number.isSafeInteger(index) || index < 0) {
      throw new Error(
        'representationHitFromSectionChart: intersection.index is required for ' +
        'point and segment sections'
      );
    }
    primitive = Math.floor(index / slotsPerPrimitive);
  }
  if (primitive >= section.cellCount) {
    throw new Error(
      `representationHitFromSectionChart: primitive ${primitive} is outside ` +
      `0…${section.cellCount - 1}`
    );
  }

  const parentCell = product.sourceCellOfPrimitive(primitive);
  const vertices = product.primitiveVertices(primitive);
  const ancestrySources: number[] = [];
  const ancestryWeights: number[] = [];
  const ancestryOffsets: number[] = [0];
  for (const vertex of vertices) {
    const row = product.vertexAncestry(vertex);
    ancestrySources.push(...row.sourceVertices);
    ancestryWeights.push(...row.weights);
    ancestryOffsets.push(ancestrySources.length);
  }

  // The two lineage steps a section pick travelled: the intersection with the
  // hyperplane (dimension unchanged), then the reading in its own chart.
  const sectionStep: AffineSectionMapRecipeN = affineSectionMapRecipeN(product.slice);
  const chartStep: AffineSliceChartMapRecipeN = affineSliceChartMapRecipeN(product.slice);

  // The picked display point IS a chart point (the chart's axes are the
  // display axes), so embedding it through the slice gives the ambient point —
  // approximate, because the display coordinates are Float32.
  const chart: number[] = [];
  const pointTuple = vector3Tuple(intersection.point);
  for (let axis = 0; axis < product.slice.chartDim; axis++) {
    chart.push(pointTuple[axis] ?? 0);
  }
  const ambientPoint = new VecN(product.slice.embedPoint(chart));

  return {
    representation: 'section-chart',
    point3: pointTuple,
    ambientDim: section.ambientDim,
    ambientPointStatus: 'approximate',
    ambientPoint,
    ambiguity: 'none',
    lineage: createRepresentationLineageN(section.ambientDim, [sectionStep, chartStep]),
    source: {
      kind: 'cell',
      complex: product.complex,
      intrinsicDim: product.group.dim,
      cellIndex: parentCell,
      vertexIndices: (() => {
        const per = product.group.verticesPerCell;
        const out: number[] = [];
        for (let corner = 0; corner < per; corner++) {
          out.push(product.group.indices[parentCell * per + corner]!);
        }
        return out;
      })(),
      reference: createSourceCellReferenceN(product.complex, product.group, parentCell),
      id: createSourceCellIdN(
        createSourceCellReferenceN(product.complex, product.group, parentCell)
      )
    },
    details: {
      sectionPrimitive: primitive,
      sectionVertices: vertices,
      ancestryOffsets,
      ancestrySourceVertices: ancestrySources,
      ancestryWeights
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
