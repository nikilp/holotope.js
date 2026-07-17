import type { HyperplaneSlice4 } from '../projection/slice.js';
import type { Point3 } from './sample.js';
import type { FieldEvaluation4, ImplicitField4, Vec4f64 } from './types.js';

export interface TraceFieldSliceRay3Options {
  /** Half-width of the axis-aligned trace box in slice coordinates. Default 1.65. */
  extent?: number;
  /** Maximum conservative-advancement steps. Default 112. */
  maxSteps?: number;
  /** Surface hit threshold in slice coordinates. Default 0.0015. */
  surfaceEpsilon?: number;
  /** Finite-difference step for the slice-space normal. Default 0.004. */
  normalEpsilon?: number;
  /** Defaults to the field's declared distance-estimator recommendation. */
  stepSafety?: number;
}

export interface FieldSliceRayHit3<Record extends FieldEvaluation4 = FieldEvaluation4> {
  readonly hit: true;
  readonly position: Point3;
  readonly point4: Vec4f64;
  /** Unit slice-space normal, oriented against the incoming ray. */
  readonly normal: Point3;
  readonly distance: number;
  readonly steps: number;
  /** True when the first in-box evaluation was already classified inside. */
  readonly startedInside: boolean;
  readonly record: Record;
}

export interface FieldSliceRayMiss3 {
  readonly hit: false;
  readonly reason: 'box' | 'bounds' | 'steps';
  readonly steps: number;
}

export type FieldSliceRayResult3<Record extends FieldEvaluation4 = FieldEvaluation4> =
  | FieldSliceRayHit3<Record>
  | FieldSliceRayMiss3;

interface ResolvedTraceOptions {
  readonly extent: number;
  readonly maxSteps: number;
  readonly surfaceEpsilon: number;
  readonly normalEpsilon: number;
  readonly stepSafety: number;
}

function point3(value: ArrayLike<number>, label: string): Point3 {
  if (value.length !== 3) throw new Error(`${label}: expected a 3D point, got ${value.length}D`);
  const out: Point3 = [value[0]!, value[1]!, value[2]!];
  if (out.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error(`${label}: coordinates must be finite`);
  }
  return out;
}

function resolveOptions(
  field: ImplicitField4,
  options: TraceFieldSliceRay3Options
): ResolvedTraceOptions {
  const extent = options.extent ?? 1.65;
  const maxSteps = options.maxSteps ?? 112;
  const surfaceEpsilon = options.surfaceEpsilon ?? 0.0015;
  const normalEpsilon = options.normalEpsilon ?? 0.004;
  const stepSafety = options.stepSafety ?? field.distanceEstimator?.recommendedStepSafety;
  if (!Number.isFinite(extent) || extent <= 0) {
    throw new Error('traceFieldSliceRay3: extent must be positive and finite');
  }
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 65535) {
    throw new Error('traceFieldSliceRay3: maxSteps must be an integer in [1, 65535]');
  }
  for (const [label, value] of [
    ['surfaceEpsilon', surfaceEpsilon],
    ['normalEpsilon', normalEpsilon]
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`traceFieldSliceRay3: ${label} must be positive and finite`);
    }
  }
  if (stepSafety === undefined) {
    throw new Error(
      'traceFieldSliceRay3: stepSafety is required when the field declares no distance estimator'
    );
  }
  if (!Number.isFinite(stepSafety) || stepSafety <= 0 || stepSafety > 1) {
    throw new Error('traceFieldSliceRay3: stepSafety must be finite and in (0, 1]');
  }
  return { extent, maxSteps, surfaceEpsilon, normalEpsilon, stepSafety };
}

function rayBoxInterval(origin: Point3, direction: Point3, extent: number): [number, number] | null {
  let near = Number.NEGATIVE_INFINITY;
  let far = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis++) {
    const component = direction[axis]!;
    if (Math.abs(component) < Number.EPSILON) {
      if (origin[axis]! < -extent || origin[axis]! > extent) return null;
      continue;
    }
    const first = (-extent - origin[axis]!) / component;
    const second = (extent - origin[axis]!) / component;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return null;
  }
  if (far < 0) return null;
  return [Math.max(near, 0), far];
}

function sliceNormal<Record extends FieldEvaluation4>(
  field: ImplicitField4<Record>,
  slice: HyperplaneSlice4,
  position: Point3,
  rayDirection: Point3,
  epsilon: number
): Point3 {
  const gradient: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const before: [number, number, number] = [...position];
    const after: [number, number, number] = [...position];
    before[axis] = before[axis]! - epsilon;
    after[axis] = after[axis]! + epsilon;
    gradient[axis] =
      field.evalCPU(slice.embedPoint(after)).distance -
      field.evalCPU(slice.embedPoint(before)).distance;
  }
  let length = Math.hypot(...gradient);
  if (!Number.isFinite(length) || length < 1e-12) {
    gradient[0] = -rayDirection[0];
    gradient[1] = -rayDirection[1];
    gradient[2] = -rayDirection[2];
    length = 1;
  }
  gradient[0] /= length;
  gradient[1] /= length;
  gradient[2] /= length;
  const facing =
    gradient[0] * rayDirection[0] +
    gradient[1] * rayDirection[1] +
    gradient[2] * rayDirection[2];
  if (facing > 0) {
    gradient[0] *= -1;
    gradient[1] *= -1;
    gradient[2] *= -1;
  }
  return [gradient[0] || 0, gradient[1] || 0, gradient[2] || 0];
}

/**
 * Deterministic CPU reference for the same affine-slice sphere tracing used by
 * `RaymarchedField3D`. It supports headless inspection and renderer picking.
 *
 * The distance channel is assumed conservative under `stepSafety`. Fields
 * without a declared estimator must provide that option explicitly.
 */
export function traceFieldSliceRay3<Record extends FieldEvaluation4>(
  field: ImplicitField4<Record>,
  slice: HyperplaneSlice4,
  originValue: ArrayLike<number>,
  directionValue: ArrayLike<number>,
  options: TraceFieldSliceRay3Options = {}
): FieldSliceRayResult3<Record> {
  const resolved = resolveOptions(field, options);
  const origin = point3(originValue, 'traceFieldSliceRay3 origin');
  const suppliedDirection = point3(directionValue, 'traceFieldSliceRay3 direction');
  const directionLength = Math.hypot(...suppliedDirection);
  if (directionLength === 0) throw new Error('traceFieldSliceRay3: direction must be non-zero');
  const direction: Point3 = [
    suppliedDirection[0] / directionLength,
    suppliedDirection[1] / directionLength,
    suppliedDirection[2] / directionLength
  ];
  const interval = rayBoxInterval(origin, direction, resolved.extent);
  if (interval === null) return { hit: false, reason: 'box', steps: 0 };

  let travelled = interval[0];
  for (let step = 0; step < resolved.maxSteps; step++) {
    if (travelled > interval[1]) return { hit: false, reason: 'bounds', steps: step };
    const position: Point3 = [
      origin[0] + direction[0] * travelled,
      origin[1] + direction[1] * travelled,
      origin[2] + direction[2] * travelled
    ];
    const point4 = slice.embedPoint(position);
    const record = field.evalCPU(point4);
    const startedInside = step === 0 && !record.escaped;
    if (!record.escaped || record.distance < resolved.surfaceEpsilon) {
      return {
        hit: true,
        position,
        point4,
        normal: sliceNormal(field, slice, position, direction, resolved.normalEpsilon),
        distance: travelled,
        steps: step + 1,
        startedInside,
        record
      };
    }
    const advance = Math.max(
      record.distance * resolved.stepSafety,
      resolved.surfaceEpsilon * 0.25
    );
    travelled += advance;
  }
  return { hit: false, reason: 'steps', steps: resolved.maxSteps };
}
