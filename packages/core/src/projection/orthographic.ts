import { VecN } from '../math/vecn.js';
import type {
  HomogeneousProjection,
  HomogeneousProjectionPointN,
  ProjectionFibreN
} from './types.js';

export interface OrthographicProjectionOptions {
  fromDim: number;
}

/**
 * Orthographic projection R^n → R^3: keeps the first three coordinates and
 * drops the rest. The simplest projection mode — useful for debugging,
 * CAD-like views, and as a reference against which other modes are tested.
 */
export class OrthographicProjection implements HomogeneousProjection {
  readonly fromDim: number;

  constructor({ fromDim }: OrthographicProjectionOptions) {
    if (!Number.isSafeInteger(fromDim) || fromDim < 3) {
      throw new Error(`OrthographicProjection: fromDim must be an integer ≥ 3, got ${fromDim}`);
    }
    this.fromDim = fromDim;
  }

  projectPoint(p: ArrayLike<number>): [number, number, number] {
    assertFinitePoint(p, this.fromDim, 'OrthographicProjection');
    return [p[0]!, p[1]!, p[2]!];
  }

  projectPositions(src: Float64Array, count: number, dst: Float32Array): void {
    assertPackedBuffers(src, count, this.fromDim, dst, 3, 'OrthographicProjection');
    const n = this.fromDim;
    for (let p = 0; p < count; p++) {
      dst[p * 3] = src[p * n]!;
      dst[p * 3 + 1] = src[p * n + 1]!;
      dst[p * 3 + 2] = src[p * n + 2]!;
    }
  }

  /** Exact row-major homogeneous matrix `[x0,x1,x2,1]`. */
  homogeneousMatrix(): Float64Array {
    const columns = this.fromDim + 1;
    const matrix = new Float64Array(4 * columns);
    matrix[0] = 1;
    matrix[columns + 1] = 1;
    matrix[2 * columns + 2] = 1;
    matrix[3 * columns + this.fromDim] = 1;
    return matrix;
  }

  projectHomogeneousPoint(point: ArrayLike<number>): HomogeneousProjectionPointN {
    assertFinitePoint(point, this.fromDim, 'OrthographicProjection.projectHomogeneousPoint');
    return {
      coordinates: [point[0]!, point[1]!, point[2]!, 1],
      validity: { kind: 'unconditional', valid: true }
    };
  }

  projectHomogeneousPositions(
    src: Float64Array,
    count: number,
    dst: Float64Array,
    validity?: Uint8Array
  ): void {
    assertPackedBuffers(
      src,
      count,
      this.fromDim,
      dst,
      4,
      'OrthographicProjection.projectHomogeneousPositions'
    );
    assertValidityBuffer(validity, count, 'OrthographicProjection.projectHomogeneousPositions');
    const n = this.fromDim;
    for (let p = 0; p < count; p++) {
      const source = p * n;
      const target = p * 4;
      dst[target] = src[source]!;
      dst[target + 1] = src[source + 1]!;
      dst[target + 2] = src[source + 2]!;
      dst[target + 3] = 1;
      if (validity !== undefined) validity[p] = 1;
    }
  }

  /** Exact `(n - 3)`-flat obtained by restoring the dropped coordinates. */
  inverseFibre(point: ArrayLike<number>): ProjectionFibreN {
    assertFinitePoint(point, 3, 'OrthographicProjection.inverseFibre');
    const source = new VecN(this.fromDim);
    source.data[0] = point[0]!;
    source.data[1] = point[1]!;
    source.data[2] = point[2]!;
    const directions: VecN[] = [];
    for (let axis = 3; axis < this.fromDim; axis++) {
      directions.push(VecN.basis(this.fromDim, axis));
    }
    return {
      kind: 'affine-flat',
      ambientDim: this.fromDim,
      point: source,
      directions,
      domain: { kind: 'unbounded' }
    };
  }
}

function assertFinitePoint(
  point: ArrayLike<number>,
  dimension: number,
  caller: string
): void {
  if (point.length !== dimension) {
    throw new Error(`${caller}: expected ${dimension} coordinates, got ${point.length}`);
  }
  for (let coordinate = 0; coordinate < dimension; coordinate++) {
    if (!Number.isFinite(point[coordinate])) {
      throw new Error(`${caller}: coordinates must be finite`);
    }
  }
}

function assertPackedBuffers(
  src: Float64Array,
  count: number,
  sourceStride: number,
  dst: Float32Array | Float64Array,
  targetStride: number,
  caller: string
): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${caller}: count must be a non-negative integer`);
  }
  if (src.length < count * sourceStride || dst.length < count * targetStride) {
    throw new Error(`${caller}: packed buffer is too small for count`);
  }
}

function assertValidityBuffer(
  validity: Uint8Array | undefined,
  count: number,
  caller: string
): void {
  if (validity !== undefined && validity.length < count) {
    throw new Error(`${caller}: validity buffer is too small for count`);
  }
}
