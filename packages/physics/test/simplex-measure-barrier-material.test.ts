import { CellComplex, MatN, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  SimplexConstitutiveDomainErrorN,
  XpbdParticleN,
  XpbdWorldN,
  compileSimplexConstitutiveFamilyN,
  evaluateSimplexMeasureBarrierN,
  simplexCompressibleNeoHookeanLawN,
  simplexMeasureBarrierLawN,
  type SimplexMeasureBarrierMaterialN
} from '../src/index.js';

const barrier: SimplexMeasureBarrierMaterialN = {
  minimumMeasureRatio: 0.1,
  activationMeasureRatio: 0.9,
  stiffness: 2.3
};

function standardSimplex(
  ambientDimension: number,
  simplexDimension = ambientDimension
): VecN[] {
  const positions = [new VecN(ambientDimension)];
  for (let axis = 0; axis < simplexDimension; axis++) {
    const point = new VecN(ambientDimension);
    point.data[axis] = 1;
    positions.push(point);
  }
  return positions;
}

function transform(
  positions: readonly VecN[],
  matrix: MatN,
  translation = new VecN(matrix.n)
): VecN[] {
  return positions.map((position) => matrix.applyTo(position).add(translation));
}

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 10
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, digits);
  }
}

function analyticBarrier(
  measureRatio: number,
  material = barrier
): { energyDensity: number; first: number; second: number; gap: number } {
  const width = material.activationMeasureRatio - material.minimumMeasureRatio;
  const gap = (measureRatio - material.minimumMeasureRatio) / width;
  if (gap >= 1) return { energyDensity: 0, first: 0, second: 0, gap };
  const remaining = 1 - gap;
  const logGap = Math.log(gap);
  return {
    energyDensity: -material.stiffness * width ** 2 * remaining ** 2 * logGap,
    first: material.stiffness * width * (
      2 * remaining * logGap - remaining ** 2 / gap
    ),
    second: material.stiffness * (
      -2 * logGap + 4 * remaining / gap + remaining ** 2 / gap ** 2
    ),
    gap
  };
}

describe('dimension-independent simplex measure barrier', () => {
  it('is exactly inactive and stress-free at and above activation', () => {
    for (const [ambientDimension, simplexDimension] of [
      [1, 1],
      [4, 2],
      [4, 4],
      [7, 3]
    ] as const) {
      const rest = standardSimplex(ambientDimension, simplexDimension);
      const rotation = ambientDimension === 1
        ? MatN.identity(1)
        : MatN.rotationInPlane(
          ambientDimension,
          0,
          ambientDimension - 1,
          0.37
        );
      const translation = new VecN(
        Array.from({ length: ambientDimension }, (_, axis) => 0.2 * axis)
      );
      const evaluated = evaluateSimplexMeasureBarrierN(
        rest,
        transform(rest, rotation, translation),
        barrier
      );
      expect(evaluated.active).toBe(false);
      expect(evaluated.energyDensity).toBe(0);
      expect(evaluated.energy).toBe(0);
      expect(evaluated.energyDerivativeByMeasureRatio).toBe(0);
      expect(evaluated.energySecondDerivativeByMeasureRatio).toBe(0);
      expectArrayClose(
        evaluated.secondPiolaStress.data,
        new Float64Array(simplexDimension ** 2)
      );
      for (const gradient of evaluated.currentGradients) {
        expectArrayClose(gradient.data, new Float64Array(ambientDimension));
      }
    }
    const atActivation = evaluateSimplexMeasureBarrierN(
      [new VecN([0]), new VecN([1])],
      [new VecN([0]), new VecN([barrier.activationMeasureRatio])],
      barrier
    );
    expect(atActivation.active).toBe(false);
    expect(atActivation.energyDensity).toBe(0);
    expect(atActivation.energyDerivativeByMeasureRatio).toBe(0);
    expect(atActivation.energySecondDerivativeByMeasureRatio).toBe(0);
  });

  it('matches uniform-scaling energy and stress in full and embedded dimensions', () => {
    const measureRatio = 0.52;
    for (const [ambientDimension, simplexDimension] of [
      [3, 1],
      [4, 2],
      [4, 4]
    ] as const) {
      const rest = standardSimplex(ambientDimension, simplexDimension);
      const stretch = measureRatio ** (1 / simplexDimension);
      const current = rest.map((point) => point.clone().multiplyScalar(stretch));
      const evaluated = evaluateSimplexMeasureBarrierN(rest, current, barrier);
      const expected = analyticBarrier(measureRatio);
      const expectedStress = expected.first * measureRatio / stretch ** 2;

      expect(evaluated.active).toBe(true);
      expect(evaluated.measureRatio).toBeCloseTo(measureRatio, 13);
      expect(evaluated.normalizedGap).toBeCloseTo(expected.gap, 13);
      expect(evaluated.energyDensity).toBeCloseTo(expected.energyDensity, 13);
      expect(evaluated.energyDerivativeByMeasureRatio)
        .toBeCloseTo(expected.first, 13);
      expect(evaluated.energySecondDerivativeByMeasureRatio)
        .toBeCloseTo(expected.second, 12);
      for (let row = 0; row < simplexDimension; row++) {
        for (let column = 0; column < simplexDimension; column++) {
          expect(evaluated.secondPiolaStress.get(row, column)).toBeCloseTo(
            row === column ? expectedStress : 0,
            12
          );
        }
      }
    }
  });

  it('matches centered current-position differences across k-in-N cases', () => {
    for (const [ambientDimension, simplexDimension] of [
      [3, 1],
      [4, 2],
      [4, 3],
      [4, 4]
    ] as const) {
      const rest = standardSimplex(ambientDimension, simplexDimension);
      const current = rest.map((position, vertex) => {
        const result = position.clone().multiplyScalar(0.82);
        for (let axis = 0; axis < ambientDimension; axis++) {
          result.data[axis] += 0.025 * Math.sin((vertex + 2) * (axis + 1));
        }
        return result;
      });
      const evaluated = evaluateSimplexMeasureBarrierN(rest, current, barrier);
      expect(evaluated.active).toBe(true);
      const step = 1e-6;
      for (let vertex = 0; vertex < current.length; vertex++) {
        for (let axis = 0; axis < ambientDimension; axis++) {
          const plus = current.map((point) => point.clone());
          const minus = current.map((point) => point.clone());
          plus[vertex]!.data[axis] += step;
          minus[vertex]!.data[axis] -= step;
          const numeric = (
            evaluateSimplexMeasureBarrierN(rest, plus, barrier).energy -
            evaluateSimplexMeasureBarrierN(rest, minus, barrier).energy
          ) / (2 * step);
          const analytic = evaluated.currentGradients[vertex]!.data[axis]!;
          expect(Math.abs(numeric - analytic)).toBeLessThanOrEqual(
            8e-7 * Math.max(1, Math.abs(numeric), Math.abs(analytic))
          );
        }
      }
      expect(evaluated.netGradientResidual).toBeLessThan(1e-13);
    }
  });

  it('is ambient-isometry invariant and respects vertex relabeling', () => {
    const rest = standardSimplex(6, 4);
    const current = rest.map((position, vertex) => {
      const result = position.clone().multiplyScalar(0.84);
      for (let axis = 0; axis < 6; axis++) {
        result.data[axis] += 0.02 * Math.cos((vertex + 1) * (axis + 3));
      }
      return result;
    });
    const base = evaluateSimplexMeasureBarrierN(rest, current, barrier);
    const rotation = MatN.rotationInPlane(6, 0, 5, 0.48)
      .multiply(MatN.rotationInPlane(6, 1, 4, -0.31));
    const translation = new VecN([1, -2, 0.5, 0.8, -0.3, 1.4]);
    const moved = evaluateSimplexMeasureBarrierN(
      transform(rest, rotation, translation),
      transform(current, rotation, translation),
      barrier
    );
    expect(moved.energy).toBeCloseTo(base.energy, 10);
    for (let vertex = 0; vertex < base.currentGradients.length; vertex++) {
      expectArrayClose(
        moved.currentGradients[vertex]!.data,
        rotation.applyTo(base.currentGradients[vertex]!).data,
        9
      );
    }

    const order = [2, 0, 4, 1, 3];
    const permuted = evaluateSimplexMeasureBarrierN(
      order.map((index) => rest[index]!),
      order.map((index) => current[index]!),
      barrier
    );
    expect(permuted.energy).toBeCloseTo(base.energy, 10);
    for (let index = 0; index < order.length; index++) {
      expectArrayClose(
        permuted.currentGradients[index]!.data,
        base.currentGradients[order[index]!]!.data,
        9
      );
    }
  });

  it('grows toward the lower boundary and refuses the forbidden chart', () => {
    const rest = [new VecN([0]), new VecN([1])];
    const samples = [0.75, 0.5, 0.2].map((ratio) =>
      evaluateSimplexMeasureBarrierN(
        rest,
        [new VecN([0]), new VecN([ratio])],
        barrier
      )
    );
    expect(samples[1]!.energy).toBeGreaterThan(samples[0]!.energy);
    expect(samples[2]!.energy).toBeGreaterThan(samples[1]!.energy);
    expect(Math.abs(samples[1]!.energyDerivativeByMeasureRatio))
      .toBeGreaterThan(Math.abs(samples[0]!.energyDerivativeByMeasureRatio));
    expect(Math.abs(samples[2]!.energyDerivativeByMeasureRatio))
      .toBeGreaterThan(Math.abs(samples[1]!.energyDerivativeByMeasureRatio));
    expect(samples.every(
      (sample) => sample.energySecondDerivativeByMeasureRatio >= 0
    )).toBe(true);

    let thresholdError: unknown;
    try {
      evaluateSimplexMeasureBarrierN(
        rest,
        [new VecN([0]), new VecN([barrier.minimumMeasureRatio])],
        barrier
      );
    } catch (error) {
      thresholdError = error;
    }
    expect(thresholdError).toBeInstanceOf(SimplexConstitutiveDomainErrorN);
    expect((thresholdError as SimplexConstitutiveDomainErrorN).reason)
      .toBe('below-minimum-measure');

    const rest2 = standardSimplex(2);
    const inverted = rest2.map((point) => point.clone());
    inverted[1]!.data[0] = -1;
    expect(() => evaluateSimplexMeasureBarrierN(rest2, inverted, barrier))
      .toThrow(/preserve orientation/);
  });

  it('validates the authored activation band and coordinates', () => {
    const rest = standardSimplex(2);
    expect(() => evaluateSimplexMeasureBarrierN(rest, rest, {
      ...barrier,
      minimumMeasureRatio: -0.1
    })).toThrow(/non-negative/);
    expect(() => evaluateSimplexMeasureBarrierN(rest, rest, {
      ...barrier,
      activationMeasureRatio: 0.1
    })).toThrow(/greater than/);
    expect(() => evaluateSimplexMeasureBarrierN(rest, rest, {
      ...barrier,
      activationMeasureRatio: 1.1
    })).toThrow(/at most one/);
    expect(() => evaluateSimplexMeasureBarrierN(rest, rest, {
      ...barrier,
      stiffness: 0
    })).toThrow(/positive/);
    expect(() => evaluateSimplexMeasureBarrierN(
      rest,
      [new VecN([0, 0]), new VecN([Number.NaN, 0]), new VecN([0, 1])],
      barrier
    )).toThrow(/finite coordinates/);
  });

  it('composes as a source-identified family beside Neo-Hookean forces', () => {
    const group: CellGroup = {
      key: 'triangles',
      dim: 2,
      verticesPerCell: 3,
      kind: 'simplex',
      indices: new Uint32Array([0, 1, 2, 1, 3, 2])
    };
    const source = new CellComplex(2, new Float64Array([
      0, 0,
      1, 0,
      0, 1,
      1, 1
    ]), [group]);
    const particles = [
      [0, 0],
      [0.78, 0.02],
      [-0.01, 0.73],
      [0.77, 0.75]
    ].map((position, index) => new XpbdParticleN({
      id: `p/${index}`,
      position
    }));
    const elastic = compileSimplexConstitutiveFamilyN({
      id: 'elastic',
      source,
      simplexGroup: group,
      particles,
      law: simplexCompressibleNeoHookeanLawN,
      material: { firstLameParameter: 2, shearModulus: 3 }
    });
    const barrierFamily = compileSimplexConstitutiveFamilyN({
      id: 'barrier',
      source,
      simplexGroup: group,
      particles,
      law: simplexMeasureBarrierLawN,
      material: barrier
    });
    const elasticEvaluation = elastic.evaluate();
    const barrierEvaluation = barrierFamily.evaluate();
    expect(barrierEvaluation.lawId).toBe('simplex-measure-barrier');
    expect(barrierEvaluation.potentialEnergy).toBeGreaterThan(0);
    expect(barrierFamily.elements.map((element) => element.sourceId))
      .toEqual(elastic.elements.map((element) => element.sourceId));
    expect(barrierFamily.particles).toEqual(elastic.particles);

    const world = new XpbdWorldN({ dimension: 2 });
    for (const particle of particles) world.addParticle(particle);
    elastic.addToWorld(world);
    barrierFamily.addToWorld(world);
    const deltaTime = 1e-4;
    const stepped = world.step(deltaTime);
    expect(stepped.constraintSolves[0]!.forceProviders.map(
      (entry) => entry.provider.id
    )).toEqual(['elastic', 'barrier']);
    for (let vertex = 0; vertex < particles.length; vertex++) {
      const expectedVelocity = elasticEvaluation.forces[vertex]!.clone()
        .add(barrierEvaluation.forces[vertex]!)
        .multiplyScalar(deltaTime);
      expectArrayClose(particles[vertex]!.velocity.data, expectedVelocity.data, 10);
    }
  });
});
