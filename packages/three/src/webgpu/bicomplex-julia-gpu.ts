import { Vector4 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { float, instanceIndex, storage, uint, uniform, wgslFn } from 'three/tsl';
import { BicomplexJuliaField } from '@holotope/core';
import type { ComputeCapableRenderer } from './sliced-complex-gpu.js';

export interface ComplexQuadraticGPURecordBatch {
  readonly magnitudes: Float32Array;
  readonly potentials: Float32Array;
  readonly distances: Float32Array;
  readonly derivativeBounds: Float32Array;
  readonly iterations: Uint32Array;
  readonly escaped: Uint8Array;
  readonly orbitTraps: Float32Array;
  /** Packed [imaginary, real] final values. */
  readonly finalPoints: Float32Array;
}

export interface BicomplexJuliaGPURecordBatch {
  readonly count: number;
  readonly values: Float32Array;
  readonly magnitudes: Float32Array;
  readonly potentials: Float32Array;
  readonly distances: Float32Array;
  readonly iterations: Uint32Array;
  readonly escaped: Uint8Array;
  readonly orbitTraps: Float32Array;
  readonly finalPoints: Float32Array;
  readonly factors: readonly [ComplexQuadraticGPURecordBatch, ComplexQuadraticGPURecordBatch];
}

export interface BicomplexJuliaGPUDifferential {
  readonly count: number;
  readonly escapeMismatches: number;
  readonly iterationMismatches: number;
  readonly factorEscapeMismatches: number;
  readonly factorIterationMismatches: number;
  readonly maxValueError: number;
  readonly maxDistanceError: number;
  readonly maxFactorDistanceError: number;
  readonly maxFinalPointError: number;
  readonly maxFactorFinalPointError: number;
}

/** Float32 compute realization of the exact bicomplex C x C factorization. */
export class BicomplexJuliaGPU {
  readonly field: BicomplexJuliaField;
  readonly count: number;

  private readonly computeNode: unknown;
  private readonly combinedMetrics: StorageBufferAttribute;
  private readonly firstMetrics: StorageBufferAttribute;
  private readonly firstState: StorageBufferAttribute;
  private readonly firstFinal: StorageBufferAttribute;
  private readonly secondMetrics: StorageBufferAttribute;
  private readonly secondState: StorageBufferAttribute;
  private readonly secondFinal: StorageBufferAttribute;

  constructor(field: BicomplexJuliaField, positions: Float32Array | readonly number[]) {
    if (positions.length === 0 || positions.length % 4 !== 0) {
      throw new Error(
        `BicomplexJuliaGPU: position length ${positions.length} must be a positive multiple of four`
      );
    }
    this.field = field;
    this.count = positions.length / 4;
    const packed = new Float32Array(positions.length);
    for (let index = 0; index < positions.length; index++) {
      const coordinate = positions[index]!;
      if (!Number.isFinite(coordinate)) {
        throw new Error('BicomplexJuliaGPU: point coordinates must be finite');
      }
      packed[index] = coordinate;
    }

    const points = new StorageBufferAttribute(packed, 4);
    this.combinedMetrics = new StorageBufferAttribute(new Float32Array(this.count * 4), 4);
    this.firstMetrics = new StorageBufferAttribute(new Float32Array(this.count * 4), 4);
    this.firstState = new StorageBufferAttribute(new Float32Array(this.count * 4), 4);
    this.firstFinal = new StorageBufferAttribute(new Float32Array(this.count * 4), 4);
    this.secondMetrics = new StorageBufferAttribute(new Float32Array(this.count * 4), 4);
    this.secondState = new StorageBufferAttribute(new Float32Array(this.count * 4), 4);
    this.secondFinal = new StorageBufferAttribute(new Float32Array(this.count * 4), 4);

    const evaluate = wgslFn(/* wgsl */ `
      fn evaluateBicomplexJulia(
        points: ptr<storage, array<vec4f>, read_write>,
        combinedMetrics: ptr<storage, array<vec4f>, read_write>,
        firstMetrics: ptr<storage, array<vec4f>, read_write>,
        firstState: ptr<storage, array<vec4f>, read_write>,
        firstFinal: ptr<storage, array<vec4f>, read_write>,
        secondMetrics: ptr<storage, array<vec4f>, read_write>,
        secondState: ptr<storage, array<vec4f>, read_write>,
        secondFinal: ptr<storage, array<vec4f>, read_write>,
        factorParameterFirst: vec4f,
        escapeSquared: f32,
        maxIterations: u32,
        count: u32,
        index: u32
      ) -> void {
        if (index >= count) { return; }
        let source = points[index];
        var first = vec2f(source.x - source.y, source.w + source.z);
        var second = vec2f(source.x + source.y, source.w - source.z);
        let parameterFirst = factorParameterFirst.xy;
        let parameterSecond = factorParameterFirst.zw;

        var firstRadiusSquared = dot(first, first);
        var firstDerivative = 1.0;
        var firstTrap = sqrt(firstRadiusSquared);
        var firstIterations = 0u;
        for (var step = 0u; step < maxIterations; step++) {
          if (firstRadiusSquared > escapeSquared) { break; }
          firstDerivative *= 2.0 * sqrt(firstRadiusSquared);
          first = vec2f(
            2.0 * first.y * first.x + parameterFirst.x,
            first.y * first.y - first.x * first.x + parameterFirst.y
          );
          firstRadiusSquared = dot(first, first);
          firstTrap = min(firstTrap, sqrt(firstRadiusSquared));
          firstIterations++;
        }

        var secondRadiusSquared = dot(second, second);
        var secondDerivative = 1.0;
        var secondTrap = sqrt(secondRadiusSquared);
        var secondIterations = 0u;
        for (var step = 0u; step < maxIterations; step++) {
          if (secondRadiusSquared > escapeSquared) { break; }
          secondDerivative *= 2.0 * sqrt(secondRadiusSquared);
          second = vec2f(
            2.0 * second.y * second.x + parameterSecond.x,
            second.y * second.y - second.x * second.x + parameterSecond.y
          );
          secondRadiusSquared = dot(second, second);
          secondTrap = min(secondTrap, sqrt(secondRadiusSquared));
          secondIterations++;
        }

        let firstEscaped = firstRadiusSquared > escapeSquared;
        let secondEscaped = secondRadiusSquared > escapeSquared;
        let firstMagnitude = sqrt(firstRadiusSquared);
        let secondMagnitude = sqrt(secondRadiusSquared);
        var firstPotential = 0.0;
        var secondPotential = 0.0;
        var firstDistance = 0.0;
        var secondDistance = 0.0;
        if (firstEscaped) {
          firstPotential = log(firstMagnitude) * exp2(-f32(firstIterations));
          if (firstDerivative > 0.0 && firstDerivative < 3.402823466e+38) {
            firstDistance = max(0.0, 0.5 * firstMagnitude * log(firstMagnitude) / firstDerivative);
          }
        }
        if (secondEscaped) {
          secondPotential = log(secondMagnitude) * exp2(-f32(secondIterations));
          if (secondDerivative > 0.0 && secondDerivative < 3.402823466e+38) {
            secondDistance = max(0.0, 0.5 * secondMagnitude * log(secondMagnitude) / secondDerivative);
          }
        }

        let escaped = firstEscaped || secondEscaped;
        let outsideFirst = select(0.0, firstDistance, firstEscaped);
        let outsideSecond = select(0.0, secondDistance, secondEscaped);
        let inverseRootTwo = 0.7071067811865476;
        let distance = length(vec2f(outsideFirst, outsideSecond)) * inverseRootTwo;
        let potential = max(firstPotential, secondPotential);
        let value = select(
          -1.0 / f32(maxIterations),
          max(distance, potential * 1.192092896e-7),
          escaped
        );
        let magnitude = length(vec2f(firstMagnitude, secondMagnitude)) * inverseRootTwo;

        combinedMetrics[index] = vec4f(value, magnitude, potential, distance);
        firstMetrics[index] = vec4f(firstMagnitude, firstPotential, firstDistance, firstDerivative);
        firstState[index] = vec4f(f32(firstIterations), select(0.0, 1.0, firstEscaped), firstTrap, 0.0);
        firstFinal[index] = vec4f(first, 0.0, 0.0);
        secondMetrics[index] = vec4f(secondMagnitude, secondPotential, secondDistance, secondDerivative);
        secondState[index] = vec4f(f32(secondIterations), select(0.0, 1.0, secondEscaped), secondTrap, 0.0);
        secondFinal[index] = vec4f(second, 0.0, 0.0);
      }
    `);

    const firstParameter = field.factorParameters.first;
    const secondParameter = field.factorParameters.second;
    this.computeNode = (
      evaluate({
        points: storage(points, 'vec4', this.count),
        combinedMetrics: storage(this.combinedMetrics, 'vec4', this.count),
        firstMetrics: storage(this.firstMetrics, 'vec4', this.count),
        firstState: storage(this.firstState, 'vec4', this.count),
        firstFinal: storage(this.firstFinal, 'vec4', this.count),
        secondMetrics: storage(this.secondMetrics, 'vec4', this.count),
        secondState: storage(this.secondState, 'vec4', this.count),
        secondFinal: storage(this.secondFinal, 'vec4', this.count),
        factorParameterFirst: uniform(
          new Vector4(
            firstParameter[0],
            firstParameter[1],
            secondParameter[0],
            secondParameter[1]
          )
        ),
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

  async read(renderer: ComputeCapableRenderer): Promise<BicomplexJuliaGPURecordBatch> {
    const buffers = await Promise.all([
      renderer.getArrayBufferAsync(this.combinedMetrics),
      renderer.getArrayBufferAsync(this.firstMetrics),
      renderer.getArrayBufferAsync(this.firstState),
      renderer.getArrayBufferAsync(this.firstFinal),
      renderer.getArrayBufferAsync(this.secondMetrics),
      renderer.getArrayBufferAsync(this.secondState),
      renderer.getArrayBufferAsync(this.secondFinal)
    ]);
    const combinedMetrics = new Float32Array(buffers[0]);
    const factorMetrics = [new Float32Array(buffers[1]), new Float32Array(buffers[4])] as const;
    const factorStates = [new Float32Array(buffers[2]), new Float32Array(buffers[5])] as const;
    const factorFinals = [new Float32Array(buffers[3]), new Float32Array(buffers[6])] as const;
    const values = new Float32Array(this.count);
    const magnitudes = new Float32Array(this.count);
    const potentials = new Float32Array(this.count);
    const distances = new Float32Array(this.count);
    const iterations = new Uint32Array(this.count);
    const escaped = new Uint8Array(this.count);
    const orbitTraps = new Float32Array(this.count);
    const finalPoints = new Float32Array(this.count * 4);
    const factors = [0, 1].map((factor): ComplexQuadraticGPURecordBatch => ({
      magnitudes: new Float32Array(this.count),
      potentials: new Float32Array(this.count),
      distances: new Float32Array(this.count),
      derivativeBounds: new Float32Array(this.count),
      iterations: new Uint32Array(this.count),
      escaped: new Uint8Array(this.count),
      orbitTraps: new Float32Array(this.count),
      finalPoints: new Float32Array(this.count * 2)
    })) as unknown as [ComplexQuadraticGPURecordBatch, ComplexQuadraticGPURecordBatch];

    for (let index = 0; index < this.count; index++) {
      const offset = index * 4;
      values[index] = combinedMetrics[offset]!;
      magnitudes[index] = combinedMetrics[offset + 1]!;
      potentials[index] = combinedMetrics[offset + 2]!;
      distances[index] = combinedMetrics[offset + 3]!;
      for (let factor = 0; factor < 2; factor++) {
        const target = factors[factor]!;
        const metrics = factorMetrics[factor]!;
        const state = factorStates[factor]!;
        const final = factorFinals[factor]!;
        target.magnitudes[index] = metrics[offset]!;
        target.potentials[index] = metrics[offset + 1]!;
        target.distances[index] = metrics[offset + 2]!;
        target.derivativeBounds[index] = metrics[offset + 3]!;
        target.iterations[index] = Math.round(state[offset]!);
        target.escaped[index] = state[offset + 1]! > 0.5 ? 1 : 0;
        target.orbitTraps[index] = state[offset + 2]!;
        target.finalPoints[index * 2] = final[offset]!;
        target.finalPoints[index * 2 + 1] = final[offset + 1]!;
      }
      iterations[index] = Math.max(factors[0].iterations[index]!, factors[1].iterations[index]!);
      escaped[index] = factors[0].escaped[index]! || factors[1].escaped[index]! ? 1 : 0;
      orbitTraps[index] = Math.hypot(
        factors[0].orbitTraps[index]!,
        factors[1].orbitTraps[index]!
      ) / Math.SQRT2;
      const firstImaginary = factors[0].finalPoints[index * 2]!;
      const firstReal = factors[0].finalPoints[index * 2 + 1]!;
      const secondImaginary = factors[1].finalPoints[index * 2]!;
      const secondReal = factors[1].finalPoints[index * 2 + 1]!;
      finalPoints[offset] = (firstImaginary + secondImaginary) / 2;
      finalPoints[offset + 1] = (secondImaginary - firstImaginary) / 2;
      finalPoints[offset + 2] = (firstReal - secondReal) / 2;
      finalPoints[offset + 3] = (firstReal + secondReal) / 2;
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
      finalPoints,
      factors
    };
  }

  async evaluate(renderer: ComputeCapableRenderer): Promise<BicomplexJuliaGPURecordBatch> {
    this.dispatch(renderer);
    return this.read(renderer);
  }
}

export function compareBicomplexJuliaGPU(
  field: BicomplexJuliaField,
  positions: Float32Array | readonly number[],
  gpu: BicomplexJuliaGPURecordBatch
): BicomplexJuliaGPUDifferential {
  if (positions.length !== gpu.count * 4) {
    throw new Error('compareBicomplexJuliaGPU: point count does not match GPU record count');
  }
  let escapeMismatches = 0;
  let iterationMismatches = 0;
  let factorEscapeMismatches = 0;
  let factorIterationMismatches = 0;
  let maxValueError = 0;
  let maxDistanceError = 0;
  let maxFactorDistanceError = 0;
  let maxFinalPointError = 0;
  let maxFactorFinalPointError = 0;
  for (let index = 0; index < gpu.count; index++) {
    const offset = index * 4;
    const cpu = field.evalCPU([
      Math.fround(positions[offset]!),
      Math.fround(positions[offset + 1]!),
      Math.fround(positions[offset + 2]!),
      Math.fround(positions[offset + 3]!)
    ]);
    if (Number(cpu.escaped) !== gpu.escaped[index]) escapeMismatches++;
    if (cpu.iterations !== gpu.iterations[index]) iterationMismatches++;
    maxValueError = Math.max(maxValueError, Math.abs(cpu.value - gpu.values[index]!));
    maxDistanceError = Math.max(maxDistanceError, Math.abs(cpu.distance - gpu.distances[index]!));
    for (let coordinate = 0; coordinate < 4; coordinate++) {
      maxFinalPointError = Math.max(
        maxFinalPointError,
        Math.abs(cpu.finalPoint[coordinate]! - gpu.finalPoints[offset + coordinate]!)
      );
    }
    for (let factor = 0; factor < 2; factor++) {
      const cpuFactor = cpu.factors[factor]!;
      const gpuFactor = gpu.factors[factor]!;
      if (Number(cpuFactor.escaped) !== gpuFactor.escaped[index]) factorEscapeMismatches++;
      if (cpuFactor.iterations !== gpuFactor.iterations[index]) factorIterationMismatches++;
      maxFactorDistanceError = Math.max(
        maxFactorDistanceError,
        Math.abs(cpuFactor.distance - gpuFactor.distances[index]!)
      );
      for (let coordinate = 0; coordinate < 2; coordinate++) {
        maxFactorFinalPointError = Math.max(
          maxFactorFinalPointError,
          Math.abs(
            cpuFactor.finalPoint[coordinate]! - gpuFactor.finalPoints[index * 2 + coordinate]!
          )
        );
      }
    }
  }
  return {
    count: gpu.count,
    escapeMismatches,
    iterationMismatches,
    factorEscapeMismatches,
    factorIterationMismatches,
    maxValueError,
    maxDistanceError,
    maxFactorDistanceError,
    maxFinalPointError,
    maxFactorFinalPointError
  };
}
