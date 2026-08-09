import type { VecN } from '../math/vecn.js';

/**
 * What a render product needs in order to draw `fromDim`-dimensional content
 * in displayable ℝ³: a dimension and the map, nothing more.
 *
 * Display maps are first-class, explicit objects: what you see on screen is
 * always the output of a named map, never an implicit default. Output is
 * Float32 because it is destined for GPU vertex buffers; all upstream math
 * stays Float64.
 *
 * Two specializations are admitted, and they lose different things — the
 * distinction this type exists to keep sayable. A {@link Projection} is
 * many-to-one: several ambient points share one image, an image point does
 * not name a source point, and what was collapsed is disclosed as an explicit
 * fibre where the projection supports one. An **embedding** (such as
 * {@link PlaneEmbedding3D}) is injective: every image point has exactly one
 * preimage, recoverable through a typed inverse, and there is no fibre to
 * disclose — asking for one is a category error, not a missing feature.
 * TypeScript is structural, so the compiler cannot brand this distinction;
 * the names carry it, and the evidence path records which kind of map
 * actually produced an image.
 *
 * The two member names say `project` for historical reasons — they predate
 * the embedding, and renaming a shipped method for vocabulary alone would be
 * an API break with no behavioural content.
 */
export interface DisplayMap3D {
  /** Dimension of the content this map displays; drives product dimension checks. */
  readonly fromDim: number;

  /**
   * Maps `count` packed fromDim-vectors from `src` into packed
   * 3-vectors in `dst` (length ≥ count * 3).
   */
  projectPositions(src: Float64Array, count: number, dst: Float32Array): void;

  /** Maps a single point given as a packed coordinate array. */
  projectPoint(p: ArrayLike<number>): [number, number, number];
}

/**
 * A genuinely lossy display map: an ambient space of dimension `fromDim`
 * projected into displayable ℝ³, many-to-one.
 *
 * The members are exactly {@link DisplayMap3D}'s — the lossiness lives in the
 * name, in this documentation, and in the subtypes that disclose what was
 * lost ({@link FibreProjection}, {@link HomogeneousProjection}). Injective
 * maps must not claim this name: implement {@link DisplayMap3D} (or
 * {@link InvertibleDisplayMap3D}) instead, as {@link PlaneEmbedding3D} does.
 */
export interface Projection extends DisplayMap3D {}

/**
 * The typed answer of an invertible display map's inverse.
 *
 * `'on-image'` carries the unique preimage (`fromDim` coordinates).
 * `'off-image'` is the typed refusal for a display point not on the map's
 * image, carrying its Euclidean distance from that image instead of a
 * fabricated nearest point — collapsing an off-image point onto the image
 * would be a projection, which is the operation an embedding is not.
 */
export type DisplayMapInverse3D =
  | { readonly status: 'on-image'; readonly point: readonly number[] }
  | { readonly status: 'off-image'; readonly distanceFromImage: number };

/** Options for {@link InvertibleDisplayMap3D.invertPoint}. */
export interface DisplayMapInvertOptions {
  /**
   * Acceptance band for observed display points: a point within
   * `tolerance * max(1, |x|, |y|, |z|)` of the image counts as on it.
   * Default `0` — the mathematical inverse, exact membership only. Callers
   * inverting renderer-derived Float32 observations pass an explicit positive
   * tolerance and must qualify the recovered point as approximate.
   */
  readonly tolerance?: number;
}

/**
 * A display map that is injective and says so: every image point has exactly
 * one preimage, and {@link invertPoint} recovers it or refuses by type.
 *
 * This is a capability interface in the same family as
 * {@link HomogeneousProjection} — probe it with
 * {@link isInvertibleDisplayMap3D} rather than by subclass identity. It is
 * deliberately disjoint from the fibre vocabulary: an injective map's
 * preimage is a single point on the image and empty off it, and
 * {@link ProjectionFibreN} can express neither honestly.
 */
export interface InvertibleDisplayMap3D extends DisplayMap3D {
  /** The unique preimage of a display point, or a typed off-image refusal. */
  invertPoint(
    point: ArrayLike<number>,
    options?: DisplayMapInvertOptions
  ): DisplayMapInverse3D;
}

/** One open affine half-space `offset + dot(normal, point) > 0`. */
export interface ProjectionDomainHalfSpaceN {
  /** Hidden axis whose perspective divide introduces this condition. */
  readonly stageAxis: number;
  readonly normal: VecN;
  readonly offset: number;
}

/** Domain on which an inverse fibre agrees with the declared projection. */
export type ProjectionFibreDomainN =
  | { readonly kind: 'unbounded' }
  | {
      readonly kind: 'open-half-spaces';
      readonly halfSpaces: readonly ProjectionDomainHalfSpaceN[];
    };

/**
 * Exact affine preimage of one R3 point under a rank-three projection.
 *
 * Every point on the flat is `point + sum(parameters[i] * directions[i])`.
 * `domain` states which part of that flat is valid for the projection; it is
 * unbounded for orthographic projection and an intersection of open
 * half-spaces for iterated perspective.
 */
export interface ProjectionFibreN {
  readonly kind: 'affine-flat';
  readonly ambientDim: number;
  readonly point: VecN;
  readonly directions: readonly VecN[];
  readonly domain: ProjectionFibreDomainN;
}

/** One actual divide performed by the legacy iterated-perspective path. */
export interface PerspectiveProjectionStage {
  readonly hiddenAxis: number;
  /** Homogeneous denominator before this axis is removed. */
  readonly homogeneousDenominatorBefore: number;
  /** Homogeneous denominator after this axis is removed. */
  readonly homogeneousDenominatorAfter: number;
  /** `viewDistance - currentHiddenCoordinate` in the legacy affine loop. */
  readonly rawDenominator: number;
  /** The denominator actually used by the legacy path after clamping. */
  readonly usedDenominator: number;
  /** Positive exactly inside this stage's projective validity half-space. */
  readonly domainMargin: number;
  /** True when the guard boundary is reached (`rawDenominator <= epsilon`). */
  readonly legacyClampApplied: boolean;
}

/** Whether homogeneous evaluation is certified inside the projection domain. */
export type HomogeneousProjectionValidity =
  | {
      readonly kind: 'unconditional';
      readonly valid: true;
    }
  | {
      readonly kind: 'iterated-perspective';
      readonly valid: boolean;
      readonly firstClampedAxis: number | null;
      readonly stages: readonly PerspectiveProjectionStage[];
    };

/** Float64 homogeneous image of one source point plus its validity evidence. */
export interface HomogeneousProjectionPointN {
  /** `[xTilde, yTilde, zTilde, q]`; divide the first three entries by `q`. */
  readonly coordinates: readonly [number, number, number, number];
  readonly validity: HomogeneousProjectionValidity;
}

/** A projection that exposes the full affine preimage of an R3 point. */
export interface FibreProjection extends Projection {
  /**
   * The preimage of one projected point: everything the projection collapsed.
   *
   * Projection is lossy by construction, so this recovers what was lost as an
   * explicit fibre rather than leaving it implicit in the mapping.
   */
  inverseFibre(point: ArrayLike<number>): ProjectionFibreN;
}

/**
 * A projection with a Float64 homogeneous reference path.
 *
 * Packed validity entries are `1` strictly inside the projection's certified
 * domain and `0` on or beyond a guard boundary.
 */
export interface HomogeneousProjection extends FibreProjection {
  /** Row-major 4 x (`fromDim + 1`) matrix. */
  homogeneousMatrix(): Float64Array;
  /** Projects one point, reporting its homogeneous fibre and domain validity. */
  projectHomogeneousPoint(point: ArrayLike<number>): HomogeneousProjectionPointN;
  /**
   * Projects `count` packed points, optionally recording per-point validity.
   *
   * Bulk form of the single-point path: a caller that needs the certified
   * domain per point supplies `validity` rather than testing afterwards.
   */
  projectHomogeneousPositions(
    src: Float64Array,
    count: number,
    dst: Float64Array,
    validity?: Uint8Array
  ): void;
}
