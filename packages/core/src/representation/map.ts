import type { Point3 } from '../field/sample.js';
import type { HyperplaneSlice4, HyperplaneSliceN } from '../projection/slice.js';
import { CoordinateProjection } from '../projection/coordinate.js';
import { OrthographicProjection } from '../projection/orthographic.js';
import { PerspectiveProjection } from '../projection/perspective.js';
import type { DisplayMap3D, Projection } from '../projection/types.js';
import { PlaneEmbedding3D } from '../projection/embedding.js';

export type { Point3 };

/** A point of R⁴ as a plain tuple, for recipes serialised without VecN. */
export type Point4 = readonly [number, number, number, number];

/**
 * One step of a representation's lineage: a named reduction and the numbers
 * that fix it.
 *
 * A recipe describes a map without being one. It is data — serializable,
 * comparable, and inspectable after the fact — which is what lets a hit
 * explain why its ambient point is exact, approximate, or unavailable
 * instead of merely asserting it. The steps chain, each step's `toDim`
 * meeting the next step's `fromDim`, from the source's dimension down to 3.
 */
interface RepresentationMapRecipeBase {
  /** Names the reduction; narrow on it to read the rest. */
  readonly kind: string;
  /** Dimension this step consumes. */
  readonly fromDim: number;
  /** Dimension it produces, which the next step consumes. */
  readonly toDim: number;
}

/** Restricts an R4 source to an affine hyperplane while keeping ambient coordinates. */
/**
 * Intersection with an affine hyperplane, staying in R⁴. Dimension is
 * unchanged because the result is still expressed in ambient coordinates;
 * `AffineSliceChartMapRecipe4` is the step that then reads it in the slice's
 * own three axes.
 */
export interface AffineSectionMapRecipe4 extends RepresentationMapRecipeBase {
  /** Names this reduction. */
  readonly kind: 'affine-section';
  /** Consumes R⁴. */
  readonly fromDim: 4;
  /** Produces R⁴ — the section is embedded, not yet charted. */
  readonly toDim: 4;
  /** Unit normal of the cutting hyperplane. */
  readonly normal: Point4;
  /** Its offset along that normal. */
  readonly offset: number;
}

/** Expresses an affine R4 hyperplane in its orthonormal R3 chart. */
/**
 * Reading a hyperplane's points in its own three axes. This step is a change
 * of chart rather than a loss of information, which is why a point picked on
 * a section can be lifted back to R⁴ exactly.
 */
export interface AffineSliceChartMapRecipe4 extends RepresentationMapRecipeBase {
  /** Names this reduction. */
  readonly kind: 'affine-slice-chart';
  /** Consumes R⁴. */
  readonly fromDim: 4;
  /** Produces the slice's own three coordinates. */
  readonly toDim: 3;
  /** Unit normal of the hyperplane being charted. */
  readonly normal: Point4;
  /** Its offset along that normal. */
  readonly offset: number;
  /** The orthonormal frame spanning it; the chart's axes, and what makes the
   * lift back to R⁴ well defined. */
  readonly basis: readonly [Point4, Point4, Point4];
}

/**
 * Intersection with an affine hyperplane in any ambient dimension, staying in
 * ambient coordinates — the dimension-generic form of
 * {@link AffineSectionMapRecipe4}, produced by sections of `HyperplaneSliceN`.
 */
export interface AffineSectionMapRecipeN extends RepresentationMapRecipeBase {
  /** Names this reduction. */
  readonly kind: 'affine-section-n';
  /** Unit normal of the cutting hyperplane; its length is the dimension. */
  readonly normal: readonly number[];
  /** Its offset along that normal. */
  readonly offset: number;
}

/**
 * Reading an affine hyperplane's points in its own orthonormal chart — the
 * dimension-generic form of {@link AffineSliceChartMapRecipe4}. A change of
 * chart rather than a loss, which is why a picked section point lifts back to
 * ambient coordinates through the same basis.
 */
export interface AffineSliceChartMapRecipeN extends RepresentationMapRecipeBase {
  /** Names this reduction. */
  readonly kind: 'affine-slice-chart-n';
  /** Unit normal of the hyperplane being charted. */
  readonly normal: readonly number[];
  /** Its offset along that normal. */
  readonly offset: number;
  /** The orthonormal frame spanning it: `toDim` rows of `fromDim` entries. */
  readonly basis: readonly (readonly number[])[];
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

/**
 * Perspective projection applied one dimension at a time until three remain.
 * Many-to-one, so a hit through this step reports `projection-overlap` and
 * offers no exact lift.
 */
export interface PerspectiveProjectionMapRecipeN extends RepresentationMapRecipeBase {
  /** Names this reduction. */
  readonly kind: 'iterated-perspective-projection';
  /** Produces R³. */
  readonly toDim: 3;
  /** Eye distance along each projected-away axis. */
  readonly viewDistance: number;
  /** Guard on the homogeneous divisor, below which a point is treated as
   * being at the horizon rather than divided by nearly zero. */
  readonly epsilon: number;
}

export interface CustomProjectionMapRecipeN extends RepresentationMapRecipeBase {
  readonly kind: 'custom-projection';
  readonly toDim: 3;
  readonly label: string;
}

/**
 * The injective coordinate-plane embedding `[x, y] -> [x, y, 0]`.
 *
 * Deliberately not any projection kind: the map collapses nothing, so a
 * lineage carrying this step keeps a unique preimage for every image point
 * and has no fibre to disclose.
 */
export interface PlaneEmbeddingMapRecipe3 extends RepresentationMapRecipeBase {
  readonly kind: 'plane-embedding';
  readonly fromDim: 2;
  readonly toDim: 3;
}

/** Exact restriction of an R4 field evaluator to an affine R3 chart. */
/**
 * Restricting a scalar field to a hyperplane and charting it there. The field
 * is named rather than held, so a lineage stays serializable.
 */
export interface FieldRestrictionMapRecipe4 extends RepresentationMapRecipeBase {
  /** Names this reduction. */
  readonly kind: 'field-restriction';
  /** Consumes R⁴. */
  readonly fromDim: 4;
  /** Produces the slice's own three coordinates. */
  readonly toDim: 3;
  /** Identifier of the field that was restricted. */
  readonly fieldId: string;
  /** Unit normal of the hyperplane. */
  readonly normal: Point4;
  /** Its offset along that normal. */
  readonly offset: number;
  /** The orthonormal frame spanning it. */
  readonly basis: readonly [Point4, Point4, Point4];
}

/** Approximate regular-grid realization of a restricted field. */
/**
 * A surface reconstructed from a field sampled on a regular grid. The surface
 * is known only where the field was evaluated, so a hit through this step is
 * `approximate` and its accuracy is the grid spacing implied by `shape` over
 * the box.
 */
export interface SampledIsosurfaceMapRecipe3 extends RepresentationMapRecipeBase {
  /** Names this reduction. */
  readonly kind: 'sampled-isosurface';
  /** Consumes a three-dimensional chart. */
  readonly fromDim: 3;
  /** Produces one. */
  readonly toDim: 3;
  /** Samples along each axis; with the box this fixes the spacing. */
  readonly shape: readonly [number, number, number];
  /** Lower corner of the sampled box. */
  readonly min: Point3;
  /** Its upper corner. */
  readonly max: Point3;
  /** Field value the extracted surface follows. */
  readonly isoValue: number;
}

/** First-surface realization obtained by tracing a ray through a restricted field. */
/**
 * A surface found by marching along a ray until the field is close enough to
 * the surface. Only the first crossing is reported, so a hit through this
 * step is ambiguous in depth: further surfaces lie behind it on the same ray.
 */
export interface RayRealizationMapRecipe3 extends RepresentationMapRecipeBase {
  /** Names this reduction. */
  readonly kind: 'ray-realization';
  /** Consumes a three-dimensional chart. */
  readonly fromDim: 3;
  /** Produces one. */
  readonly toDim: 3;
  /** Iteration cap; reaching it means the ray was abandoned, not that it
   * missed. */
  readonly maxSteps: number;
  /** Distance below which the march is considered to have arrived. */
  readonly surfaceEpsilon: number;
  /** Fraction of the estimated safe distance actually stepped, trading
   * marches against the risk of stepping through a thin feature. */
  readonly stepSafety: number;
}

/**
 * Every reduction a representation can be built from. A lineage is a sequence
 * of these, so the union is the vocabulary in which "how was this picture
 * made" is answered.
 */
export type RepresentationMapRecipeN =
  | AffineSectionMapRecipeN
  | AffineSliceChartMapRecipeN
  | AffineSectionMapRecipe4
  | AffineSliceChartMapRecipe4
  | OrthographicProjectionMapRecipeN
  | CoordinateProjectionMapRecipeN
  | PerspectiveProjectionMapRecipeN
  | CustomProjectionMapRecipeN
  | PlaneEmbeddingMapRecipe3
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

/** The recipe of the one shipped embedding; a zero-parameter map needs none. */
export function planeEmbeddingMapRecipe3(): PlaneEmbeddingMapRecipe3 {
  return { kind: 'plane-embedding', fromDim: 2, toDim: 3 };
}

/**
 * Total recipe factory over every display map a render product accepts.
 *
 * Records what the map *is*: the embedding gets its own kind rather than
 * being misfiled as a `'custom-projection'`, and lossy maps delegate to
 * {@link projectionMapRecipeN}, whose public signature this deliberately
 * leaves untouched — widening that function's return union would break
 * exhaustive switches over it.
 */
export function displayMapRecipe3(map: DisplayMap3D):
  | PlaneEmbeddingMapRecipe3
  | ReturnType<typeof projectionMapRecipeN> {
  if (map instanceof PlaneEmbedding3D) return planeEmbeddingMapRecipe3();
  return projectionMapRecipeN(map);
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

/** The dimension-generic section step of a `HyperplaneSliceN` cut. */
export function affineSectionMapRecipeN(slice: HyperplaneSliceN): AffineSectionMapRecipeN {
  return {
    kind: 'affine-section-n',
    fromDim: slice.ambientDim,
    toDim: slice.ambientDim,
    normal: Array.from(slice.normal.data),
    offset: slice.offset
  };
}

/** The dimension-generic chart step reading a section in its own axes. */
export function affineSliceChartMapRecipeN(
  slice: HyperplaneSliceN
): AffineSliceChartMapRecipeN {
  return {
    kind: 'affine-slice-chart-n',
    fromDim: slice.ambientDim,
    toDim: slice.chartDim,
    normal: Array.from(slice.normal.data),
    offset: slice.offset,
    basis: slice.basis.map((row) => Array.from(row))
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
