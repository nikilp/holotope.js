import type { Projection } from './types.js';

export interface PerspectiveProjectionOptions {
  fromDim: number;
  /**
   * Distance from the projection viewpoint to the origin along each hidden
   * axis. Points at hidden coordinate 0 project at unit scale; points
   * nearer the viewpoint appear larger. Default 2.
   */
  viewDistance?: number;
  /** Denominator clamp guarding the perspective divide. Default 1e-6. */
  epsilon?: number;
}

/**
 * Iterated perspective projection R^n → R^3.
 *
 * Projects one dimension at a time (n → n−1 → … → 3): at each step the
 * highest remaining coordinate x_d becomes a depth, scaling the surviving
 * coordinates by viewDistance / (viewDistance − x_d). For n = 4 this is the
 * classic "tesseract" perspective; for n = 3 it is the identity.
 *
 * Points at or behind the viewpoint (x_d ≥ viewDistance) are clamped, not
 * clipped — geometry that crosses the viewpoint will distort. Proper 4D
 * frustum clipping is a planned, separate stage.
 */
export class PerspectiveProjection implements Projection {
  readonly fromDim: number;
  viewDistance: number;
  epsilon: number;

  constructor({ fromDim, viewDistance = 2, epsilon = 1e-6 }: PerspectiveProjectionOptions) {
    if (fromDim < 3) throw new Error(`PerspectiveProjection: fromDim must be ≥ 3, got ${fromDim}`);
    this.fromDim = fromDim;
    this.viewDistance = viewDistance;
    this.epsilon = epsilon;
  }

  projectPoint(p: ArrayLike<number>): [number, number, number] {
    const n = this.fromDim;
    if (p.length !== n) {
      throw new Error(`PerspectiveProjection: expected ${n} coordinates, got ${p.length}`);
    }
    const work = Array.from({ length: n }, (_, i) => p[i]!);
    for (let d = n - 1; d >= 3; d--) {
      const s = this.viewDistance / Math.max(this.epsilon, this.viewDistance - work[d]!);
      for (let c = 0; c < d; c++) work[c]! *= s;
    }
    return [work[0]!, work[1]!, work[2]!];
  }

  projectPositions(src: Float64Array, count: number, dst: Float32Array): void {
    const n = this.fromDim;
    const work = new Float64Array(n);
    for (let p = 0; p < count; p++) {
      const base = p * n;
      for (let c = 0; c < n; c++) work[c] = src[base + c]!;
      for (let d = n - 1; d >= 3; d--) {
        const s = this.viewDistance / Math.max(this.epsilon, this.viewDistance - work[d]!);
        for (let c = 0; c < d; c++) work[c]! *= s;
      }
      dst[p * 3] = work[0]!;
      dst[p * 3 + 1] = work[1]!;
      dst[p * 3 + 2] = work[2]!;
    }
  }
}
