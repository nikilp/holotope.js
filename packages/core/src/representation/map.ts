import type { HyperplaneSlice4 } from '../projection/slice.js';
import { CoordinateProjection } from '../projection/coordinate.js';
import { OrthographicProjection } from '../projection/orthographic.js';
import { PerspectiveProjection } from '../projection/perspective.js';
import type { Projection } from '../projection/types.js';

type Point3 = readonly [number, number, number];
type Point4 = readonly [number, number, number, number];

interface RepresentationMapRecipeBase {
  readonly kind: string;
  readonly fromDim: number;
  readonly toDim: number;
}

/** Restricts an R4 source to an affine hyperplane while keeping ambient coordinates. */
export interface AffineSectionMapRecipe4 extends RepresentationMapRecipeBase {
  readonly kind: 'affine-section';
  readonly fromDim: 4;
  readonly toDim: 4;
  readonly normal: Point4;
  readonly offset: number;
}

/** Expresses an affine R4 hyperplane in its orthonormal R3 chart. */
export interface AffineSliceChartMapRecipe4 extends RepresentationMapRecipeBase {
  readonly kind: 'affine-slice-chart';
  readonly fromDim: 4;
  readonly toDim: 3;
  readonly normal: Point4;
  readonly offset: number;
  readonly basis: readonly [Point4, Point4, Point4];
}

export interface OrthographicProjectionMapRecipeN extends RepresentationMapRecipeBase {
  readonly kind: 'orthographic-projection';
  readonly toDim: 3;
  readonly retainedAxes: readonly [0, 1, 2];
}

export interface CoordinateProjectionMapRecipeN extends RepresentationMapRecipeBase {
  readonly kind: 'coordinate-subspace-projection';
  readonly toDim: 3;
  readonly retainedAxes: readonly [number, number, number];
}

export interface PerspectiveProjectionMapRecipeN extends RepresentationMapRecipeBase {
  readonly kind: 'iterated-perspective-projection';
  readonly toDim: 3;
  readonly viewDistance: number;
  readonly epsilon: number;
}

export interface CustomProjectionMapRecipeN extends RepresentationMapRecipeBase {
  readonly kind: 'custom-projection';
  readonly toDim: 3;
  readonly label: string;
}

/** Exact restriction of an R4 field evaluator to an affine R3 chart. */
export interface FieldRestrictionMapRecipe4 extends RepresentationMapRecipeBase {
  readonly kind: 'field-restriction';
  readonly fromDim: 4;
  readonly toDim: 3;
  readonly fieldId: string;
  readonly normal: Point4;
  readonly offset: number;
  readonly basis: readonly [Point4, Point4, Point4];
}

/** Approximate regular-grid realization of a restricted field. */
export interface SampledIsosurfaceMapRecipe3 extends RepresentationMapRecipeBase {
  readonly kind: 'sampled-isosurface';
  readonly fromDim: 3;
  readonly toDim: 3;
  readonly shape: readonly [number, number, number];
  readonly min: Point3;
  readonly max: Point3;
  readonly isoValue: number;
}

/** First-surface realization obtained by tracing a ray through a restricted field. */
export interface RayRealizationMapRecipe3 extends RepresentationMapRecipeBase {
  readonly kind: 'ray-realization';
  readonly fromDim: 3;
  readonly toDim: 3;
  readonly maxSteps: number;
  readonly surfaceEpsilon: number;
  readonly stepSafety: number;
}

export type RepresentationMapRecipeN =
  | AffineSectionMapRecipe4
  | AffineSliceChartMapRecipe4
  | OrthographicProjectionMapRecipeN
  | CoordinateProjectionMapRecipeN
  | PerspectiveProjectionMapRecipeN
  | CustomProjectionMapRecipeN
  | FieldRestrictionMapRecipe4
  | SampledIsosurfaceMapRecipe3
  | RayRealizationMapRecipe3;

/** Ordered, dimension-checked recipe from authoritative state to one representation. */
export interface RepresentationLineageN {
  readonly sourceDim: number;
  readonly representationDim: number;
  readonly steps: readonly RepresentationMapRecipeN[];
}

export function createRepresentationLineageN(
  sourceDim: number,
  steps: readonly RepresentationMapRecipeN[]
): RepresentationLineageN {
  if (!Number.isSafeInteger(sourceDim) || sourceDim < 1) {
    throw new Error('createRepresentationLineageN: sourceDim must be a positive integer');
  }
  let currentDim = sourceDim;
  for (let step = 0; step < steps.length; step++) {
    const recipe = steps[step]!;
    if (
      !Number.isSafeInteger(recipe.fromDim) ||
      recipe.fromDim < 1 ||
      !Number.isSafeInteger(recipe.toDim) ||
      recipe.toDim < 1
    ) {
      throw new Error(
        `createRepresentationLineageN: step ${step} dimensions must be positive integers`
      );
    }
    if (recipe.fromDim !== currentDim) {
      throw new Error(
        `createRepresentationLineageN: step ${step} expects R${recipe.fromDim}, received R${currentDim}`
      );
    }
    currentDim = recipe.toDim;
  }
  return {
    sourceDim,
    representationDim: currentDim,
    steps: Object.freeze([...steps])
  };
}

export function projectionMapRecipeN(projection: Projection):
  | OrthographicProjectionMapRecipeN
  | CoordinateProjectionMapRecipeN
  | PerspectiveProjectionMapRecipeN
  | CustomProjectionMapRecipeN {
  if (projection instanceof OrthographicProjection) {
    return {
      kind: 'orthographic-projection',
      fromDim: projection.fromDim,
      toDim: 3,
      retainedAxes: [0, 1, 2]
    };
  }
  if (projection instanceof CoordinateProjection) {
    return {
      kind: 'coordinate-subspace-projection',
      fromDim: projection.fromDim,
      toDim: 3,
      retainedAxes: projection.axes
    };
  }
  if (projection instanceof PerspectiveProjection) {
    return {
      kind: 'iterated-perspective-projection',
      fromDim: projection.fromDim,
      toDim: 3,
      viewDistance: projection.viewDistance,
      epsilon: projection.epsilon
    };
  }
  return {
    kind: 'custom-projection',
    fromDim: projection.fromDim,
    toDim: 3,
    label: projection.constructor.name || 'Projection'
  };
}

export function affineSectionMapRecipe4(
  slice: HyperplaneSlice4
): AffineSectionMapRecipe4 {
  return {
    kind: 'affine-section',
    fromDim: 4,
    toDim: 4,
    normal: point4(slice.normal.data),
    offset: slice.offset
  };
}

export function affineSliceChartMapRecipe4(
  slice: HyperplaneSlice4
): AffineSliceChartMapRecipe4 {
  return {
    kind: 'affine-slice-chart',
    fromDim: 4,
    toDim: 3,
    normal: point4(slice.normal.data),
    offset: slice.offset,
    basis: [point4(slice.basis[0]), point4(slice.basis[1]), point4(slice.basis[2])]
  };
}

export function fieldRestrictionMapRecipe4(
  fieldId: string,
  slice: HyperplaneSlice4
): FieldRestrictionMapRecipe4 {
  return {
    kind: 'field-restriction',
    fromDim: 4,
    toDim: 3,
    fieldId,
    normal: point4(slice.normal.data),
    offset: slice.offset,
    basis: [point4(slice.basis[0]), point4(slice.basis[1]), point4(slice.basis[2])]
  };
}

function point4(values: ArrayLike<number>): [number, number, number, number] {
  return [values[0]!, values[1]!, values[2]!, values[3]!];
}
