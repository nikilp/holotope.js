import { VecN } from '../math/vecn.js';
import type {
  HomogeneousProjection,
  HomogeneousProjectionPointN,
  PerspectiveProjectionStage,
  ProjectionDomainHalfSpaceN,
  ProjectionFibreN
} from './types.js';

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
export class PerspectiveProjection implements HomogeneousProjection {
  readonly fromDim: number;
  viewDistance: number;
  epsilon: number;

  constructor({ fromDim, viewDistance = 2, epsilon = 1e-6 }: PerspectiveProjectionOptions) {
    if (!Number.isSafeInteger(fromDim) || fromDim < 3) {
      throw new Error(`PerspectiveProjection: fromDim must be an integer ≥ 3, got ${fromDim}`);
    }
    this.fromDim = fromDim;
    this.viewDistance = viewDistance;
    this.epsilon = epsilon;
    this.assertConfiguration();
  }

  projectPoint(p: ArrayLike<number>): [number, number, number] {
    this.assertConfiguration();
    const n = this.fromDim;
    assertFinitePoint(p, n, 'PerspectiveProjection');
    const work = Array.from({ length: n }, (_, i) => p[i]!);
    for (let d = n - 1; d >= 3; d--) {
      const s = this.viewDistance / Math.max(this.epsilon, this.viewDistance - work[d]!);
      for (let c = 0; c < d; c++) work[c]! *= s;
    }
    return [work[0]!, work[1]!, work[2]!];
  }

  projectPositions(src: Float64Array, count: number, dst: Float32Array): void {
    this.assertConfiguration();
    assertPackedBuffers(src, count, this.fromDim, dst, 3, 'PerspectiveProjection');
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

  /**
   * Row-major matrix for the unclamped projective chain.
   *
   * With one shared view distance the final denominator is
   * `q = 1 - sum(hiddenCoordinates) / viewDistance`. The validity report,
   * rather than final `q` alone, determines whether every intermediate divide
   * stays on this projective branch.
   */
  homogeneousMatrix(): Float64Array {
    this.assertConfiguration();
    const columns = this.fromDim + 1;
    const matrix = new Float64Array(4 * columns);
    matrix[0] = 1;
    matrix[columns + 1] = 1;
    matrix[2 * columns + 2] = 1;
    for (let axis = 3; axis < this.fromDim; axis++) {
      matrix[3 * columns + axis] = -1 / this.viewDistance;
    }
    matrix[3 * columns + this.fromDim] = 1;
    return matrix;
  }

  projectHomogeneousPoint(point: ArrayLike<number>): HomogeneousProjectionPointN {
    this.assertConfiguration();
    assertFinitePoint(
      point,
      this.fromDim,
      'PerspectiveProjection.projectHomogeneousPoint'
    );
    const work = Float64Array.from(point);
    const stages: PerspectiveProjectionStage[] = [];
    let qBefore = 1;
    let firstClampedAxis: number | null = null;
    for (let axis = this.fromDim - 1; axis >= 3; axis--) {
      const qAfter = qBefore - point[axis]! / this.viewDistance;
      const rawDenominator = this.viewDistance - work[axis]!;
      const legacyClampApplied = rawDenominator <= this.epsilon;
      const usedDenominator = Math.max(this.epsilon, rawDenominator);
      const domainMargin =
        this.viewDistance * qAfter - this.epsilon * qBefore;
      if (legacyClampApplied && firstClampedAxis === null) {
        firstClampedAxis = axis;
      }
      stages.push({
        hiddenAxis: axis,
        homogeneousDenominatorBefore: qBefore,
        homogeneousDenominatorAfter: qAfter,
        rawDenominator,
        usedDenominator,
        domainMargin,
        legacyClampApplied
      });
      const scale = this.viewDistance / usedDenominator;
      for (let coordinate = 0; coordinate < axis; coordinate++) {
        work[coordinate]! *= scale;
      }
      qBefore = qAfter;
    }
    return {
      coordinates: [point[0]!, point[1]!, point[2]!, qBefore],
      validity: {
        kind: 'iterated-perspective',
        valid: firstClampedAxis === null,
        firstClampedAxis,
        stages
      }
    };
  }

  projectHomogeneousPositions(
    src: Float64Array,
    count: number,
    dst: Float64Array,
    validity?: Uint8Array
  ): void {
    this.assertConfiguration();
    assertPackedBuffers(
      src,
      count,
      this.fromDim,
      dst,
      4,
      'PerspectiveProjection.projectHomogeneousPositions'
    );
    assertValidityBuffer(validity, count, 'PerspectiveProjection.projectHomogeneousPositions');
    const n = this.fromDim;
    for (let point = 0; point < count; point++) {
      const source = point * n;
      const target = point * 4;
      let qBefore = 1;
      let valid = true;
      for (let axis = n - 1; axis >= 3; axis--) {
        const coordinate = src[source + axis]!;
        if (!Number.isFinite(coordinate)) {
          throw new Error(
            'PerspectiveProjection.projectHomogeneousPositions: coordinates must be finite'
          );
        }
        const qAfter = qBefore - coordinate / this.viewDistance;
        if (this.viewDistance * qAfter - this.epsilon * qBefore <= 0) {
          valid = false;
        }
        qBefore = qAfter;
      }
      for (let coordinate = 0; coordinate < 3; coordinate++) {
        const value = src[source + coordinate]!;
        if (!Number.isFinite(value)) {
          throw new Error(
            'PerspectiveProjection.projectHomogeneousPositions: coordinates must be finite'
          );
        }
        dst[target + coordinate] = value;
      }
      dst[target + 3] = qBefore;
      if (validity !== undefined) validity[point] = valid ? 1 : 0;
    }
  }

  /**
   * Exact affine fibre of the unclamped projective matrix, intersected with
   * the open validity half-space contributed by every perspective stage.
   */
  inverseFibre(point: ArrayLike<number>): ProjectionFibreN {
    this.assertConfiguration();
    assertFinitePoint(point, 3, 'PerspectiveProjection.inverseFibre');
    const source = new VecN(this.fromDim);
    source.data[0] = point[0]!;
    source.data[1] = point[1]!;
    source.data[2] = point[2]!;
    const directions: VecN[] = [];
    for (let axis = 3; axis < this.fromDim; axis++) {
      const direction = new VecN(this.fromDim);
      direction.data[0] = -point[0]! / this.viewDistance;
      direction.data[1] = -point[1]! / this.viewDistance;
      direction.data[2] = -point[2]! / this.viewDistance;
      direction.data[axis] = 1;
      directions.push(direction);
    }

    const halfSpaces: ProjectionDomainHalfSpaceN[] = [];
    const previousHiddenCoefficient = -(1 - this.epsilon / this.viewDistance);
    for (let axis = this.fromDim - 1; axis >= 3; axis--) {
      const normal = new VecN(this.fromDim);
      normal.data[axis] = -1;
      for (let previous = axis + 1; previous < this.fromDim; previous++) {
        normal.data[previous] = previousHiddenCoefficient;
      }
      halfSpaces.push({
        stageAxis: axis,
        normal,
        offset: this.viewDistance - this.epsilon
      });
    }
    return {
      kind: 'affine-flat',
      ambientDim: this.fromDim,
      point: source,
      directions,
      domain: { kind: 'open-half-spaces', halfSpaces }
    };
  }

  private assertConfiguration(): void {
    if (!Number.isFinite(this.viewDistance) || this.viewDistance <= 0) {
      throw new Error(
        'PerspectiveProjection: viewDistance must be finite and positive'
      );
    }
    if (!Number.isFinite(this.epsilon) || this.epsilon <= 0) {
      throw new Error('PerspectiveProjection: epsilon must be finite and positive');
    }
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
