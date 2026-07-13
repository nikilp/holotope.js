import type { SampledFieldSlice3 } from './sample.js';

export interface ExtractedIsosurface3 {
  readonly approximate: true;
  readonly isoValue: number;
  readonly positions: Float32Array;
  /** Interpolated escape iteration, one value per emitted vertex. */
  readonly iterations: Float32Array;
  /** Source grid-cell index, one value per triangle. */
  readonly sourceCells: Uint32Array;
  readonly triangleCount: number;
}

const TETRAHEDRA = [
  [0, 1, 3, 7],
  [0, 3, 2, 7],
  [0, 2, 6, 7],
  [0, 6, 4, 7],
  [0, 4, 5, 7],
  [0, 5, 1, 7]
] as const;

const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1]
] as const;

function triangleCountFor(negative: number): number {
  if (negative === 0 || negative === 4) return 0;
  return negative === 2 ? 2 : 1;
}

/** Marching-tetrahedra extraction over a sampled slice grid. */
export function extractSampledIsosurface3(
  sample: SampledFieldSlice3,
  isoValue = 0
): ExtractedIsosurface3 {
  if (!Number.isFinite(isoValue)) throw new Error('extractSampledIsosurface3: isoValue must be finite');
  const [nx, ny, nz] = sample.shape;
  const pointIndex = (i: number, j: number, k: number): number => i + nx * (j + ny * k);
  let triangleCount = 0;
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const cornerIndices = CORNERS.map(([di, dj, dk]) => pointIndex(i + di, j + dj, k + dk));
        for (const tetrahedron of TETRAHEDRA) {
          let negative = 0;
          for (const corner of tetrahedron) {
            if (sample.values[cornerIndices[corner]!]! < isoValue) negative++;
          }
          triangleCount += triangleCountFor(negative);
        }
      }
    }
  }

  const positions = new Float32Array(triangleCount * 9);
  const iterations = new Float32Array(triangleCount * 3);
  const sourceCells = new Uint32Array(triangleCount);
  let vertex = 0;
  let triangle = 0;
  const emit = (
    a: number,
    b: number,
    cornerIndices: readonly number[],
    cellOrigin: readonly [number, number, number],
    cellIndex: number
  ): void => {
    const ia = cornerIndices[a]!;
    const ib = cornerIndices[b]!;
    const valueA = sample.values[ia]!;
    const valueB = sample.values[ib]!;
    const denominator = valueB - valueA;
    const t = denominator === 0 ? 0.5 : (isoValue - valueA) / denominator;
    for (let axis = 0; axis < 3; axis++) {
      const ca = CORNERS[a]![axis]!;
      const cb = CORNERS[b]![axis]!;
      positions[vertex * 3 + axis] =
        sample.min[axis]! + (cellOrigin[axis]! + ca + t * (cb - ca)) * sample.step[axis]!;
    }
    iterations[vertex] = sample.iterations[ia]! + t * (sample.iterations[ib]! - sample.iterations[ia]!);
    vertex++;
    if (vertex % 3 === 0) sourceCells[triangle++] = cellIndex;
  };

  let cellIndex = 0;
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++, cellIndex++) {
        const cornerIndices = CORNERS.map(([di, dj, dk]) => pointIndex(i + di, j + dj, k + dk));
        for (const tetrahedron of TETRAHEDRA) {
          const negative: number[] = [];
          const nonnegative: number[] = [];
          for (const corner of tetrahedron) {
            (sample.values[cornerIndices[corner]!]! < isoValue ? negative : nonnegative).push(corner);
          }
          if (negative.length === 0 || negative.length === 4) continue;
          const origin: [number, number, number] = [i, j, k];
          if (negative.length === 1) {
            for (const positive of nonnegative) emit(negative[0]!, positive, cornerIndices, origin, cellIndex);
          } else if (negative.length === 3) {
            for (const below of negative) emit(below, nonnegative[0]!, cornerIndices, origin, cellIndex);
          } else {
            emit(negative[0]!, nonnegative[0]!, cornerIndices, origin, cellIndex);
            emit(negative[0]!, nonnegative[1]!, cornerIndices, origin, cellIndex);
            emit(negative[1]!, nonnegative[1]!, cornerIndices, origin, cellIndex);
            emit(negative[0]!, nonnegative[0]!, cornerIndices, origin, cellIndex);
            emit(negative[1]!, nonnegative[1]!, cornerIndices, origin, cellIndex);
            emit(negative[1]!, nonnegative[0]!, cornerIndices, origin, cellIndex);
          }
        }
      }
    }
  }

  return {
    approximate: true,
    isoValue,
    positions,
    iterations,
    sourceCells,
    triangleCount
  };
}
