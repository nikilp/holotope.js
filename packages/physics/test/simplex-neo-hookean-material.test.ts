import { MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  evaluateSimplexCompressibleNeoHookeanN,
  evaluateSimplexStVenantKirchhoffN,
  type SimplexCompressibleNeoHookeanMaterialN
} from '../src/index.js';

const material: SimplexCompressibleNeoHookeanMaterialN = {
  firstLameParameter: 2.3,
  shearModulus: 1.7
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

describe('dimension-independent compressible Neo-Hookean simplex material', () => {
  it('vanishes under rigid motion for full and embedded simplices', () => {
    for (const [ambientDimension, simplexDimension] of [
      [2, 2],
      [4, 4],
      [6, 3],
      [7, 2]
    ] as const) {
      const rest = standardSimplex(ambientDimension, simplexDimension);
      const rotation = MatN.rotationInPlane(
        ambientDimension,
        0,
        ambientDimension - 1,
        0.63
      );
      const translation = new VecN(
        Array.from({ length: ambientDimension }, (_, axis) => 0.2 * (axis + 1))
      );
      const evaluated = evaluateSimplexCompressibleNeoHookeanN(
        rest,
        transform(rest, rotation, translation),
        material
      );
      expect(evaluated.energyDensity).toBeCloseTo(0, 12);
      expect(evaluated.energy).toBeCloseTo(0, 12);
      expect(evaluated.volumetricLogStrain).toBeCloseTo(0, 12);
      expectArrayClose(
        evaluated.secondPiolaStress.data,
        new Float64Array(simplexDimension * simplexDimension),
        11
      );
      for (const gradient of evaluated.currentGradients) {
        expectArrayClose(gradient.data, new Float64Array(ambientDimension), 11);
      }
      expect(evaluated.netGradientResidual).toBeCloseTo(0, 15);
    }
  });

  it('matches the analytic R1 stretch energy, stress, and gradient', () => {
    const lambda = 4;
    const mu = 3;
    const stretch = 3;
    const logStretch = Math.log(stretch);
    const evaluated = evaluateSimplexCompressibleNeoHookeanN(
      [new VecN([0]), new VecN([2])],
      [new VecN([0]), new VecN([6])],
      { firstLameParameter: lambda, shearModulus: mu }
    );
    const expectedDensity = 0.5 * mu * (stretch ** 2 - 1) -
      mu * logStretch + 0.5 * lambda * logStretch ** 2;
    const expectedStress = mu * (1 - 1 / stretch ** 2) +
      lambda * logStretch / stretch ** 2;
    const expectedGradient = mu * (stretch - 1 / stretch) +
      lambda * logStretch / stretch;

    expect(evaluated.restMeasure).toBe(2);
    expect(evaluated.volumetricLogStrain).toBeCloseTo(logStretch, 14);
    expect(evaluated.energyDensity).toBeCloseTo(expectedDensity, 14);
    expect(evaluated.energy).toBeCloseTo(2 * expectedDensity, 14);
    expectArrayClose(evaluated.secondPiolaStress.data, [expectedStress], 14);
    expectArrayClose(evaluated.currentGradients[0]!.data, [-expectedGradient], 13);
    expectArrayClose(evaluated.currentGradients[1]!.data, [expectedGradient], 13);
  });

  it('matches central differences for embedded and full-dimensional elements', () => {
    for (const [ambientDimension, simplexDimension] of [
      [6, 3],
      [4, 4]
    ] as const) {
      const rest = standardSimplex(ambientDimension, simplexDimension).map(
        (position, vertex) => {
          const result = position.clone();
          for (let axis = 0; axis < ambientDimension; axis++) {
            result.data[axis] += 0.04 * Math.sin((vertex + 1) * (axis + 2));
          }
          return result;
        }
      );
      const current = rest.map((position, vertex) => {
        const result = position.clone();
        for (let axis = 0; axis < ambientDimension; axis++) {
          result.data[axis] += 0.07 * Math.cos((vertex + 2) * (axis + 1));
        }
        return result;
      });
      const evaluated = evaluateSimplexCompressibleNeoHookeanN(
        rest,
        current,
        material
      );
      const step = 1e-6;
      for (let vertex = 0; vertex < current.length; vertex++) {
        for (let axis = 0; axis < ambientDimension; axis++) {
          const plus = current.map((point) => point.clone());
          const minus = current.map((point) => point.clone());
          plus[vertex]!.data[axis] += step;
          minus[vertex]!.data[axis] -= step;
          const numeric = (
            evaluateSimplexCompressibleNeoHookeanN(rest, plus, material).energy -
            evaluateSimplexCompressibleNeoHookeanN(rest, minus, material).energy
          ) / (2 * step);
          const analytic = evaluated.currentGradients[vertex]!.data[axis]!;
          expect(Math.abs(numeric - analytic)).toBeLessThanOrEqual(
            4e-7 * Math.max(1, Math.abs(numeric), Math.abs(analytic))
          );
        }
      }
      expect(evaluated.netGradientResidual).toBeLessThan(1e-14);
    }
  });

  it('is SE(N)-invariant, rotates gradients, and respects vertex relabeling', () => {
    const rest = standardSimplex(6, 4);
    const current = rest.map((position, vertex) => {
      const result = position.clone();
      for (let axis = 0; axis < 6; axis++) {
        result.data[axis] += 0.06 * Math.sin((vertex + 1) * (axis + 3));
      }
      return result;
    });
    const base = evaluateSimplexCompressibleNeoHookeanN(rest, current, material);
    const rotation = MatN.rotationInPlane(6, 0, 5, 0.48)
      .multiply(MatN.rotationInPlane(6, 1, 4, -0.31));
    const translation = new VecN([1, -2, 0.5, 0.8, -0.3, 1.4]);
    const moved = evaluateSimplexCompressibleNeoHookeanN(
      transform(rest, rotation, translation),
      transform(current, rotation, translation),
      material
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
    const permuted = evaluateSimplexCompressibleNeoHookeanN(
      order.map((index) => rest[index]!),
      order.map((index) => current[index]!),
      material
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

  it('scales total energy and gradients with intrinsic rest measure', () => {
    const rest = standardSimplex(7, 3);
    const current = rest.map((position, vertex) => {
      const result = position.clone();
      result.data[0] += 0.1 * vertex;
      result.data[5] -= 0.035 * vertex * vertex;
      return result;
    });
    const base = evaluateSimplexCompressibleNeoHookeanN(rest, current, material);
    const scale = 2.5;
    const scaled = evaluateSimplexCompressibleNeoHookeanN(
      rest.map((point) => point.clone().multiplyScalar(scale)),
      current.map((point) => point.clone().multiplyScalar(scale)),
      material
    );
    expect(scaled.energyDensity).toBeCloseTo(base.energyDensity, 10);
    expect(scaled.energy).toBeCloseTo(base.energy * scale ** 3, 9);
    for (let vertex = 0; vertex < base.currentGradients.length; vertex++) {
      expectArrayClose(
        scaled.currentGradients[vertex]!.data,
        base.currentGradients[vertex]!.data.map((value) => value * scale ** 2),
        8
      );
    }
  });

  it('shares the StVK small-strain limit and penalizes near collapse', () => {
    const rest = standardSimplex(4);
    const epsilon = 1e-4;
    const current = transform(rest, new MatN(4, [
      1 + epsilon, 0, 0, 0,
      0, 1 - 0.5 * epsilon, 0, 0,
      0, 0, 1 + 0.3 * epsilon, 0,
      0, 0, 0, 1 + 0.1 * epsilon
    ]));
    const neo = evaluateSimplexCompressibleNeoHookeanN(rest, current, material);
    const stvk = evaluateSimplexStVenantKirchhoffN(rest, current, material);
    expect(Math.abs(neo.energy - stvk.energy) / Math.max(neo.energy, stvk.energy))
      .toBeLessThan(4e-4);

    const compressed = [0.5, 0.1, 0.01].map((stretch) =>
      evaluateSimplexCompressibleNeoHookeanN(
        [new VecN([0]), new VecN([1])],
        [new VecN([0]), new VecN([stretch])],
        material
      ).energy
    );
    expect(compressed[1]).toBeGreaterThan(compressed[0]!);
    expect(compressed[2]).toBeGreaterThan(compressed[1]!);
  });

  it('refuses collapse, full-dimensional inversion, and unstable parameters', () => {
    expect(() => evaluateSimplexCompressibleNeoHookeanN(
      [new VecN([0]), new VecN([1])],
      [new VecN([0]), new VecN([0])],
      material
    )).toThrow(/preserve orientation|positive finite measure ratio/);
    expect(() => evaluateSimplexCompressibleNeoHookeanN(
      [new VecN([0, 0]), new VecN([1, 0])],
      [new VecN([0, 0]), new VecN([0, 0])],
      material
    )).toThrow(/positive finite measure ratio/);

    const rest = standardSimplex(2);
    const inverted = rest.map((point) => {
      const result = point.clone();
      result.data[0] *= -1;
      return result;
    });
    expect(() => evaluateSimplexCompressibleNeoHookeanN(
      rest,
      inverted,
      material
    )).toThrow(/preserve orientation/);

    expect(() => evaluateSimplexCompressibleNeoHookeanN(
      rest,
      rest,
      { firstLameParameter: -1, shearModulus: 1 }
    )).toThrow(/non-negative/);
    expect(() => evaluateSimplexCompressibleNeoHookeanN(
      rest,
      rest,
      { firstLameParameter: 1, shearModulus: 0 }
    )).toThrow(/positive/);
  });
});
