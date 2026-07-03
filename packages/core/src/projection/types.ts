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
