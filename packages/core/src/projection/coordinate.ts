import { VecN } from '../math/vecn.js';
import type {
  HomogeneousProjection,
  HomogeneousProjectionPointN,
  ProjectionFibreN
} from './types.js';

export type CoordinateProjectionAxes = readonly [number, number, number];

export interface CoordinateProjectionOptions {
  readonly fromDim: number;
  /** Three distinct source axes, in output x/y/z order. */
  readonly axes: CoordinateProjectionAxes;
}

/**
 * Exact coordinate-subspace projection R^n → R^3.
 *
 * Unlike `OrthographicProjection`, which always retains axes `[0, 1, 2]`,
 * this map makes the three retained coordinates explicit. It is useful for
 * coordinated views such as XYW without permuting or copying source data.
 */
export class CoordinateProjection implements HomogeneousProjection {
  readonly fromDim: number;
  readonly axes: CoordinateProjectionAxes;

  constructor({ fromDim, axes }: CoordinateProjectionOptions) {
    if (!Number.isSafeInteger(fromDim) || fromDim < 3) {
      throw new Error(
        `CoordinateProjection: fromDim must be an integer ≥ 3, got ${fromDim}`
      );
    }
    if (axes.length !== 3) {
      throw new Error('CoordinateProjection: axes must contain exactly 3 entries');
    }
    const uniqueAxes = new Set<number>();
    for (const axis of axes) {
      if (!Number.isSafeInteger(axis) || axis < 0 || axis >= fromDim) {
        throw new Error(
          `CoordinateProjection: axis ${axis} lies outside R${fromDim}`
        );
      }
      uniqueAxes.add(axis);
    }
    if (uniqueAxes.size !== 3) {
      throw new Error('CoordinateProjection: axes must be distinct');
    }
    this.fromDim = fromDim;
    this.axes = Object.freeze([axes[0], axes[1], axes[2]]);
  }

  projectPoint(point: ArrayLike<number>): [number, number, number] {
    assertFinitePoint(point, this.fromDim, 'CoordinateProjection');
    return [
      point[this.axes[0]]!,
      point[this.axes[1]]!,
      point[this.axes[2]]!
    ];
  }

  projectPositions(
    source: Float64Array,
    count: number,
    destination: Float32Array
  ): void {
    assertPackedBuffers(
      source,
      count,
      this.fromDim,
      destination,
      3,
      'CoordinateProjection.projectPositions'
    );
    for (let point = 0; point < count; point++) {
      const sourceOffset = point * this.fromDim;
      const destinationOffset = point * 3;
      for (let coordinate = 0; coordinate < 3; coordinate++) {
        destination[destinationOffset + coordinate] =
          source[sourceOffset + this.axes[coordinate]!]!;
      }
    }
  }

  homogeneousMatrix(): Float64Array {
    const columns = this.fromDim + 1;
    const matrix = new Float64Array(4 * columns);
    for (let coordinate = 0; coordinate < 3; coordinate++) {
      matrix[coordinate * columns + this.axes[coordinate]!] = 1;
    }
    matrix[3 * columns + this.fromDim] = 1;
    return matrix;
  }

  projectHomogeneousPoint(
    point: ArrayLike<number>
  ): HomogeneousProjectionPointN {
    const projected = this.projectPoint(point);
    return {
      coordinates: [projected[0], projected[1], projected[2], 1],
      validity: { kind: 'unconditional', valid: true }
    };
  }

  projectHomogeneousPositions(
    source: Float64Array,
    count: number,
    destination: Float64Array,
    validity?: Uint8Array
  ): void {
    assertPackedBuffers(
      source,
      count,
      this.fromDim,
      destination,
      4,
      'CoordinateProjection.projectHomogeneousPositions'
    );
    assertValidityBuffer(
      validity,
      count,
      'CoordinateProjection.projectHomogeneousPositions'
    );
    for (let point = 0; point < count; point++) {
      const sourceOffset = point * this.fromDim;
      const destinationOffset = point * 4;
      for (let coordinate = 0; coordinate < 3; coordinate++) {
        destination[destinationOffset + coordinate] =
          source[sourceOffset + this.axes[coordinate]!]!;
      }
      destination[destinationOffset + 3] = 1;
      if (validity !== undefined) validity[point] = 1;
    }
  }

  inverseFibre(point: ArrayLike<number>): ProjectionFibreN {
    assertFinitePoint(point, 3, 'CoordinateProjection.inverseFibre');
    const source = new VecN(this.fromDim);
    for (let coordinate = 0; coordinate < 3; coordinate++) {
      source.data[this.axes[coordinate]!] = point[coordinate]!;
    }
    const retained = new Set(this.axes);
    const directions: VecN[] = [];
    for (let axis = 0; axis < this.fromDim; axis++) {
      if (!retained.has(axis)) directions.push(VecN.basis(this.fromDim, axis));
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
  source: Float64Array,
  count: number,
  sourceStride: number,
  destination: Float32Array | Float64Array,
  destinationStride: number,
  caller: string
): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`${caller}: count must be a non-negative integer`);
  }
  if (
    source.length < count * sourceStride ||
    destination.length < count * destinationStride
  ) {
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
