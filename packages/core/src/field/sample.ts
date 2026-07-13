import type { HyperplaneSlice4 } from '../projection/slice.js';
import type { FieldEvaluation4, ImplicitField4 } from './types.js';

export type GridShape3 = readonly [number, number, number];
export type Point3 = readonly [number, number, number];

export interface FieldSampleBatch<Record extends FieldEvaluation4 = FieldEvaluation4> {
  readonly count: number;
  /** Full family-specific records in deterministic sample order. */
  readonly records: readonly Record[];
  readonly values: Float64Array;
  readonly potentials: Float64Array;
  readonly distances: Float64Array;
  readonly iterations: Uint32Array;
  readonly escaped: Uint8Array;
  readonly finalPoints: Float64Array;
  readonly escapedCount: number;
  readonly valueRange: readonly [number, number];
}

export interface SampleFieldSlice3Options {
  resolution: number | GridShape3;
  /** Symmetric slice-frame extent, shorthand for min/max on all axes. */
  extent?: number;
  min?: Point3;
  max?: Point3;
  /** Safety cap. Default 2,000,000 samples. */
  maxSamples?: number;
}

export interface SampledFieldSlice3<Record extends FieldEvaluation4 = FieldEvaluation4>
  extends FieldSampleBatch<Record> {
  readonly shape: GridShape3;
  readonly min: Point3;
  readonly max: Point3;
  readonly step: Point3;
  readonly slice: HyperplaneSlice4;
}

function sampleRecords<Record extends FieldEvaluation4>(
  field: ImplicitField4<Record>,
  count: number,
  pointAt: (index: number, out: Float64Array) => void
): FieldSampleBatch<Record> {
  const records = new Array<Record>(count);
  const values = new Float64Array(count);
  const potentials = new Float64Array(count);
  const distances = new Float64Array(count);
  const iterations = new Uint32Array(count);
  const escaped = new Uint8Array(count);
  const finalPoints = new Float64Array(count * 4);
  const point = new Float64Array(4);
  let escapedCount = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < count; index++) {
    pointAt(index, point);
    const record = field.evalCPU(point);
    records[index] = record;
    values[index] = record.value;
    potentials[index] = record.potential;
    distances[index] = record.distance;
    iterations[index] = record.iterations;
    escaped[index] = record.escaped ? 1 : 0;
    if (record.escaped) escapedCount++;
    minimum = Math.min(minimum, record.value);
    maximum = Math.max(maximum, record.value);
    finalPoints.set(record.finalPoint, index * 4);
  }
  return {
    count,
    records,
    values,
    potentials,
    distances,
    iterations,
    escaped,
    finalPoints,
    escapedCount,
    valueRange: [minimum, maximum]
  };
}

/** Direct packed-point probe for tests, scripts, and CPU/GPU comparison. */
export function sampleFieldPoints4<Record extends FieldEvaluation4>(
  field: ImplicitField4<Record>,
  positions: Float64Array | readonly number[]
): FieldSampleBatch<Record> {
  if (positions.length % 4 !== 0) {
    throw new Error(`sampleFieldPoints4: position length ${positions.length} is not divisible by four`);
  }
  const count = positions.length / 4;
  return sampleRecords(field, count, (index, out) => {
    const offset = index * 4;
    for (let coordinate = 0; coordinate < 4; coordinate++) {
      const value = positions[offset + coordinate]!;
      if (!Number.isFinite(value)) throw new Error('sampleFieldPoints4: coordinates must be finite');
      out[coordinate] = value;
    }
  });
}

/** Evaluate a field on a regular grid in an affine three-dimensional slice. */
export function sampleFieldSlice3<Record extends FieldEvaluation4>(
  field: ImplicitField4<Record>,
  slice: HyperplaneSlice4,
  {
    resolution,
    extent = 2,
    min = [-extent, -extent, -extent],
    max = [extent, extent, extent],
    maxSamples = 2_000_000
  }: SampleFieldSlice3Options
): SampledFieldSlice3<Record> {
  const shape: GridShape3 =
    typeof resolution === 'number' ? [resolution, resolution, resolution] : resolution;
  if (shape.some((value) => !Number.isSafeInteger(value) || value < 2)) {
    throw new Error(`sampleFieldSlice3: every resolution must be an integer of at least two`);
  }
  if (min.some((value) => !Number.isFinite(value)) || max.some((value) => !Number.isFinite(value))) {
    throw new Error('sampleFieldSlice3: bounds must be finite');
  }
  if (min.some((value, axis) => value >= max[axis]!)) {
    throw new Error('sampleFieldSlice3: each minimum must be less than its maximum');
  }
  const count = shape[0] * shape[1] * shape[2];
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 1 || count > maxSamples) {
    throw new Error(`sampleFieldSlice3: ${count} samples exceed cap ${maxSamples}`);
  }
  const step: Point3 = [
    (max[0] - min[0]) / (shape[0] - 1),
    (max[1] - min[1]) / (shape[1] - 1),
    (max[2] - min[2]) / (shape[2] - 1)
  ];
  const normal = slice.normal.data;
  const sampled = sampleRecords(field, count, (index, out) => {
    const i = index % shape[0];
    const j = Math.floor(index / shape[0]) % shape[1];
    const k = Math.floor(index / (shape[0] * shape[1]));
    const coordinates: Point3 = [
      min[0] + i * step[0],
      min[1] + j * step[1],
      min[2] + k * step[2]
    ];
    for (let component = 0; component < 4; component++) {
      out[component] = normal[component]! * slice.offset;
      for (let axis = 0; axis < 3; axis++) {
        out[component]! += slice.basis[axis]![component]! * coordinates[axis]!;
      }
    }
  });
  return { ...sampled, shape, min, max, step, slice };
}
