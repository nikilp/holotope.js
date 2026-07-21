import type { VecN } from '../math/vecn.js';

/**
 * A projection from ambient R^fromDim into displayable R^3.
 *
 * Projections are first-class, explicit objects: what you see on screen is
 * always the output of a named projection mode, never an implicit default.
 * Output is Float32 because it is destined for GPU vertex buffers; all
 * upstream math stays Float64.
 */
export interface Projection {
  readonly fromDim: number;

  /**
   * Projects `count` packed fromDim-vectors from `src` into packed
   * 3-vectors in `dst` (length ≥ count * 3).
   */
  projectPositions(src: Float64Array, count: number, dst: Float32Array): void;

  /** Projects a single point given as a packed coordinate array. */
  projectPoint(p: ArrayLike<number>): [number, number, number];
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
  projectHomogeneousPoint(point: ArrayLike<number>): HomogeneousProjectionPointN;
  projectHomogeneousPositions(
    src: Float64Array,
    count: number,
    dst: Float64Array,
    validity?: Uint8Array
  ): void;
}
