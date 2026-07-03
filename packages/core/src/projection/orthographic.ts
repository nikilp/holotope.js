import type { Projection } from './types.js';

export interface OrthographicProjectionOptions {
  fromDim: number;
}

/**
 * Orthographic projection R^n → R^3: keeps the first three coordinates and
 * drops the rest. The simplest projection mode — useful for debugging,
 * CAD-like views, and as a reference against which other modes are tested.
 */
export class OrthographicProjection implements Projection {
  readonly fromDim: number;

  constructor({ fromDim }: OrthographicProjectionOptions) {
    if (fromDim < 3) throw new Error(`OrthographicProjection: fromDim must be ≥ 3, got ${fromDim}`);
    this.fromDim = fromDim;
  }

  projectPoint(p: ArrayLike<number>): [number, number, number] {
    if (p.length !== this.fromDim) {
      throw new Error(`OrthographicProjection: expected ${this.fromDim} coordinates, got ${p.length}`);
    }
    return [p[0]!, p[1]!, p[2]!];
  }

  projectPositions(src: Float64Array, count: number, dst: Float32Array): void {
    const n = this.fromDim;
    for (let p = 0; p < count; p++) {
      dst[p * 3] = src[p * n]!;
      dst[p * 3 + 1] = src[p * n + 1]!;
      dst[p * 3 + 2] = src[p * n + 2]!;
    }
  }
}
