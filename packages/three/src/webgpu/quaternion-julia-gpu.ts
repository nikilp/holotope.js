import { Vector4 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { float, instanceIndex, storage, uint, uniform, wgslFn } from 'three/tsl';
import { QuaternionJuliaField } from '@holotope/core';
import type { ComputeCapableRenderer } from './sliced-complex-gpu.js';

export interface QuaternionJuliaGPURecordBatch {
  readonly count: number;
  readonly values: Float32Array;
  readonly magnitudes: Float32Array;
  readonly potentials: Float32Array;
  readonly distances: Float32Array;
  readonly iterations: Uint32Array;
  readonly escaped: Uint8Array;
  readonly orbitTraps: Float32Array;
  readonly derivativeBounds: Float32Array;
  readonly finalPoints: Float32Array;
}

export interface QuaternionJuliaGPUDifferential {
  readonly count: number;
  readonly escapeMismatches: number;
  readonly iterationMismatches: number;
  readonly maxValueError: number;
  readonly maxMagnitudeError: number;
  readonly maxPotentialError: number;
  readonly maxDistanceError: number;
  readonly maxFinalPointError: number;
}

/**
 * Compute-shader evaluator for packed quaternion points. The Float64
 * `QuaternionJuliaField` remains the source of truth; this product is its
 * Float32 realization for differential checks and GPU render pipelines.
 */
export class QuaternionJuliaGPU {
  readonly field: QuaternionJuliaField;
  readonly count: number;

  private readonly computeNode: unknown;
  private readonly metricsBuffer: StorageBufferAttribute;
  private readonly stateBuffer: StorageBufferAttribute;
  private readonly finalPointBuffer: StorageBufferAttribute;

  constructor(field: QuaternionJuliaField, positions: Float32Array | readonly number[]) {
    if (positions.length === 0 || positions.length % 4 !== 0) {
      throw new Error(
        `QuaternionJuliaGPU: position length ${positions.length} must be a positive multiple of four`
      );
    }
    this.field = field;
    this.count = positions.length / 4;

    const packed = new Float32Array(positions.length);
    for (let index = 0; index < positions.length; index++) {
      const coordinate = positions[index]!;
      if (!Number.isFinite(coordinate)) {
        throw new Error('QuaternionJuliaGPU: point coordinates must be finite');
      }
      packed[index] = coordinate;
    }

    const pointBuffer = new StorageBufferAttribute(packed, 4);
    this.metricsBuffer = new StorageBufferAttribute(new Float32Array(this.count * 4), 4);
    this.stateBuffer = new StorageBufferAttribute(new Float32Array(this.count * 4), 4);
    this.finalPointBuffer = new StorageBufferAttribute(new Float32Array(this.count * 4), 4);

    const evaluate = wgslFn(/* wgsl */ `
      fn evaluateQuaternionJulia(
        points: ptr<storage, array<vec4f>, read_write>,
        metrics: ptr<storage, array<vec4f>, read_write>,
        states: ptr<storage, array<vec4f>, read_write>,
        finalPoints: ptr<storage, array<vec4f>, read_write>,
        parameter: vec4f,
        escapeSquared: f32,
        maxIterations: u32,
        count: u32,
        index: u32
      ) -> void {
        if (index >= count) { return; }

        var q = points[index];
        var radiusSquared = dot(q, q);
        var derivativeBound = 1.0;
        var orbitTrap = sqrt(radiusSquared);
        var iterations = 0u;

        for (var step = 0u; step < maxIterations; step++) {
          if (radiusSquared > escapeSquared) { break; }
          let radius = sqrt(radiusSquared);
          derivativeBound *= 2.0 * radius;
          let next = vec4f(
            2.0 * q.w * q.x + parameter.x,
            2.0 * q.w * q.y,
            2.0 * q.w * q.z,
            q.w * q.w - q.x * q.x - q.y * q.y - q.z * q.z + parameter.w
          );
          q = next;
          radiusSquared = dot(q, q);
          orbitTrap = min(orbitTrap, sqrt(radiusSquared));
          iterations++;
        }

        let escaped = radiusSquared > escapeSquared;
        let magnitude = sqrt(radiusSquared);
        var potential = 0.0;
        var distance = 0.0;
        if (escaped) {
          potential = log(magnitude) * exp2(-f32(iterations));
          if (derivativeBound > 0.0 && derivativeBound < 3.402823466e+38) {
            distance = max(0.0, 0.5 * magnitude * log(magnitude) / derivativeBound);
          }
        }
        let value = select(
          -1.0 / f32(maxIterations),
          max(distance, potential * 1.192092896e-7),
          escaped
        );

        metrics[index] = vec4f(value, magnitude, potential, distance);
        states[index] = vec4f(f32(iterations), select(0.0, 1.0, escaped), orbitTrap, derivativeBound);
        finalPoints[index] = q;
      }
    `);

    const parameter = field.parameter;
    this.computeNode = (
      evaluate({
        points: storage(pointBuffer, 'vec4', this.count),
        metrics: storage(this.metricsBuffer, 'vec4', this.count),
        states: storage(this.stateBuffer, 'vec4', this.count),
        finalPoints: storage(this.finalPointBuffer, 'vec4', this.count),
        parameter: uniform(new Vector4(parameter[0], parameter[1], parameter[2], parameter[3])),
        escapeSquared: float(field.options.escapeRadius * field.options.escapeRadius),
        maxIterations: uint(field.options.maxIterations),
        count: uint(this.count),
        index: instanceIndex
      }) as unknown as { compute(count: number): unknown }
    ).compute(this.count);
  }

  dispatch(renderer: ComputeCapableRenderer): void {
    renderer.compute(this.computeNode);
  }

  async read(renderer: ComputeCapableRenderer): Promise<QuaternionJuliaGPURecordBatch> {
    const [metricsBytes, stateBytes, finalPointBytes] = await Promise.all([
      renderer.getArrayBufferAsync(this.metricsBuffer),
      renderer.getArrayBufferAsync(this.stateBuffer),
      renderer.getArrayBufferAsync(this.finalPointBuffer)
    ]);
    const metrics = new Float32Array(metricsBytes);
    const states = new Float32Array(stateBytes);
    const finalPoints = new Float32Array(finalPointBytes);
    const values = new Float32Array(this.count);
    const magnitudes = new Float32Array(this.count);
    const potentials = new Float32Array(this.count);
    const distances = new Float32Array(this.count);
    const iterations = new Uint32Array(this.count);
    const escaped = new Uint8Array(this.count);
    const orbitTraps = new Float32Array(this.count);
    const derivativeBounds = new Float32Array(this.count);
    for (let index = 0; index < this.count; index++) {
      const offset = index * 4;
      values[index] = metrics[offset]!;
      magnitudes[index] = metrics[offset + 1]!;
      potentials[index] = metrics[offset + 2]!;
      distances[index] = metrics[offset + 3]!;
      iterations[index] = Math.round(states[offset]!);
      escaped[index] = states[offset + 1]! > 0.5 ? 1 : 0;
      orbitTraps[index] = states[offset + 2]!;
      derivativeBounds[index] = states[offset + 3]!;
    }
    return {
      count: this.count,
      values,
      magnitudes,
      potentials,
      distances,
      iterations,
      escaped,
      orbitTraps,
      derivativeBounds,
      finalPoints
    };
  }

  async evaluate(renderer: ComputeCapableRenderer): Promise<QuaternionJuliaGPURecordBatch> {
    this.dispatch(renderer);
    return this.read(renderer);
  }
}

/** Compare a GPU readback against the field's Float64 evaluation. */
export function compareQuaternionJuliaGPU(
  field: QuaternionJuliaField,
  positions: Float32Array | readonly number[],
  gpu: QuaternionJuliaGPURecordBatch
): QuaternionJuliaGPUDifferential {
  if (positions.length !== gpu.count * 4) {
    throw new Error('compareQuaternionJuliaGPU: point count does not match GPU record count');
  }
  let escapeMismatches = 0;
  let iterationMismatches = 0;
  let maxValueError = 0;
  let maxMagnitudeError = 0;
  let maxPotentialError = 0;
  let maxDistanceError = 0;
  let maxFinalPointError = 0;
  for (let index = 0; index < gpu.count; index++) {
    const offset = index * 4;
    const cpu = field.evalCPU([
      Math.fround(positions[offset]!),
      Math.fround(positions[offset + 1]!),
      Math.fround(positions[offset + 2]!),
      Math.fround(positions[offset + 3]!)
    ]);
    if (Number(gpu.escaped[index]) !== Number(cpu.escaped)) escapeMismatches++;
    if (gpu.iterations[index] !== cpu.iterations) iterationMismatches++;
    maxValueError = Math.max(maxValueError, Math.abs(gpu.values[index]! - cpu.value));
    maxMagnitudeError = Math.max(maxMagnitudeError, Math.abs(gpu.magnitudes[index]! - cpu.magnitude));
    maxPotentialError = Math.max(maxPotentialError, Math.abs(gpu.potentials[index]! - cpu.potential));
    maxDistanceError = Math.max(maxDistanceError, Math.abs(gpu.distances[index]! - cpu.distance));
    for (let coordinate = 0; coordinate < 4; coordinate++) {
      maxFinalPointError = Math.max(
        maxFinalPointError,
        Math.abs(gpu.finalPoints[offset + coordinate]! - cpu.finalPoint[coordinate]!)
      );
    }
  }
  return {
    count: gpu.count,
    escapeMismatches,
    iterationMismatches,
    maxValueError,
    maxMagnitudeError,
    maxPotentialError,
    maxDistanceError,
    maxFinalPointError
  };
}
