import { MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  evaluateSimplexStVenantKirchhoffN,
  type SimplexStVenantKirchhoffMaterialN
} from '../src/index.js';

const material: SimplexStVenantKirchhoffMaterialN = {
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

describe('dimension-independent StVK simplex material', () => {
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
      const evaluated = evaluateSimplexStVenantKirchhoffN(
        rest,
        transform(rest, rotation, translation),
        material
      );
      expect(evaluated.energyDensity).toBeCloseTo(0, 12);
      expect(evaluated.energy).toBeCloseTo(0, 12);
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

  it('matches analytic line and membrane energy, stress, and gradients', () => {
    const line = evaluateSimplexStVenantKirchhoffN(
      [new VecN([0]), new VecN([2])],
      [new VecN([0]), new VecN([6])],
      { firstLameParameter: 4, shearModulus: 3 }
    );
    expect(line.restMeasure).toBe(2);
    expect(line.energyDensity).toBeCloseTo(80, 14);
    expect(line.energy).toBeCloseTo(160, 14);
    expectArrayClose(line.secondPiolaStress.data, [40], 14);
    expectArrayClose(line.currentGradients[0]!.data, [-120], 13);
    expectArrayClose(line.currentGradients[1]!.data, [120], 13);

    const rest = standardSimplex(2);
    const current = transform(rest, new MatN(2, [2, 0, 0, 0.5]));
    const membrane = evaluateSimplexStVenantKirchhoffN(
      rest,
      current,
      { firstLameParameter: 2, shearModulus: 3 }
    );
    expect(membrane.restMeasure).toBeCloseTo(0.5, 14);
    expect(membrane.energyDensity).toBeCloseTo(8.4375, 14);
    expect(membrane.energy).toBeCloseTo(4.21875, 14);
    expectArrayClose(membrane.secondPiolaStress.data, [11.25, 0, 0, 0], 14);
    expectArrayClose(membrane.currentGradients[0]!.data, [-11.25, 0], 13);
    expectArrayClose(membrane.currentGradients[1]!.data, [11.25, 0], 13);
    expectArrayClose(membrane.currentGradients[2]!.data, [0, 0], 13);

    const solidRest = standardSimplex(4);
    const solidCurrent = transform(solidRest, new MatN(4, [
      2, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]));
    const solid = evaluateSimplexStVenantKirchhoffN(
      solidRest,
      solidCurrent,
      { firstLameParameter: 2, shearModulus: 3 }
    );
    expect(solid.restMeasure).toBeCloseTo(1 / 24, 14);
    expect(solid.energyDensity).toBeCloseTo(9, 14);
    expect(solid.energy).toBeCloseTo(0.375, 14);
    expectArrayClose(solid.secondPiolaStress.data, [
      12, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 3, 0,
      0, 0, 0, 3
    ], 13);
    expectArrayClose(solid.currentGradients[0]!.data, [-1, -0.125, -0.125, -0.125], 13);
    expectArrayClose(solid.currentGradients[1]!.data, [1, 0, 0, 0], 13);
    expectArrayClose(solid.currentGradients[2]!.data, [0, 0.125, 0, 0], 13);
    expectArrayClose(solid.currentGradients[3]!.data, [0, 0, 0.125, 0], 13);
    expectArrayClose(solid.currentGradients[4]!.data, [0, 0, 0, 0.125], 13);
  });

  it('matches central differences for embedded and full-dimensional elements', () => {
    for (const [ambientDimension, simplexDimension] of [
      [5, 3],
      [4, 4]
    ] as const) {
      const rest = standardSimplex(ambientDimension, simplexDimension).map(
        (position, vertex) => {
          const result = position.clone();
          for (let axis = 0; axis < ambientDimension; axis++) {
            result.data[axis] += 0.07 * Math.sin((vertex + 1) * (axis + 2));
          }
          return result;
        }
      );
      const current = rest.map((position, vertex) => {
        const result = position.clone();
        for (let axis = 0; axis < ambientDimension; axis++) {
          result.data[axis] += 0.11 * Math.cos((vertex + 2) * (axis + 1));
        }
        return result;
      });
      const evaluated = evaluateSimplexStVenantKirchhoffN(rest, current, material);
      const step = 1e-6;
      for (let vertex = 0; vertex < current.length; vertex++) {
        for (let axis = 0; axis < ambientDimension; axis++) {
          const plus = current.map((point) => point.clone());
          const minus = current.map((point) => point.clone());
          plus[vertex]!.data[axis] += step;
          minus[vertex]!.data[axis] -= step;
          const numeric = (
            evaluateSimplexStVenantKirchhoffN(rest, plus, material).energy -
            evaluateSimplexStVenantKirchhoffN(rest, minus, material).energy
          ) / (2 * step);
          const analytic = evaluated.currentGradients[vertex]!.data[axis]!;
          expect(Math.abs(numeric - analytic)).toBeLessThanOrEqual(
            2e-7 * Math.max(1, Math.abs(numeric), Math.abs(analytic))
          );
        }
      }
      expect(evaluated.netGradientResidual).toBeLessThan(1e-14);
    }
  });

  it('is SE(N)-invariant and rotates gradients covariantly', () => {
    const rest = standardSimplex(6, 4);
    const current = rest.map((position, vertex) => {
      const result = position.clone();
      for (let axis = 0; axis < 6; axis++) {
        result.data[axis] += 0.08 * Math.sin((vertex + 1) * (axis + 3));
      }
      return result;
    });
    const base = evaluateSimplexStVenantKirchhoffN(rest, current, material);
    const rotation = MatN.rotationInPlane(6, 0, 5, 0.48)
      .multiply(MatN.rotationInPlane(6, 1, 4, -0.31));
    const translation = new VecN([1, -2, 0.5, 0.8, -0.3, 1.4]);
    const moved = evaluateSimplexStVenantKirchhoffN(
      transform(rest, rotation, translation),
      transform(current, rotation, translation),
      material
    );

    expect(moved.energyDensity).toBeCloseTo(base.energyDensity, 11);
    expect(moved.energy).toBeCloseTo(base.energy, 11);
    for (let vertex = 0; vertex < base.currentGradients.length; vertex++) {
      expectArrayClose(
        moved.currentGradients[vertex]!.data,
        rotation.applyTo(base.currentGradients[vertex]!).data,
        10
      );
    }
  });

  it('preserves energy and relabels gradients under vertex permutation', () => {
    const rest = standardSimplex(4);
    const current = transform(rest, new MatN(4, [
      1.2, 0.1, 0, 0.05,
      0, 0.8, -0.15, 0,
      0.1, 0, 1.3, 0.2,
      -0.05, 0.1, 0, 0.9
    ]));
    const base = evaluateSimplexStVenantKirchhoffN(rest, current, material);
    const order = [2, 0, 4, 1, 3];
    const permuted = evaluateSimplexStVenantKirchhoffN(
      order.map((index) => rest[index]!),
      order.map((index) => current[index]!),
      material
    );
    expect(permuted.energyDensity).toBeCloseTo(base.energyDensity, 10);
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
    const rest = standardSimplex(6, 3);
    const current = rest.map((position, vertex) => {
      const result = position.clone();
      result.data[0] += 0.12 * vertex;
      result.data[4] -= 0.04 * vertex * vertex;
      return result;
    });
    const base = evaluateSimplexStVenantKirchhoffN(rest, current, material);
    const scale = 2.5;
    const scaled = evaluateSimplexStVenantKirchhoffN(
      rest.map((point) => point.clone().multiplyScalar(scale)),
      current.map((point) => point.clone().multiplyScalar(scale)),
      material
    );
    expect(scaled.energyDensity).toBeCloseTo(base.energyDensity, 11);
    expect(scaled.energy).toBeCloseTo(base.energy * scale ** 3, 10);
    for (let vertex = 0; vertex < base.currentGradients.length; vertex++) {
      expectArrayClose(
        scaled.currentGradients[vertex]!.data,
        base.currentGradients[vertex]!.data.map((value) => value * scale ** 2),
        9
      );
    }
  });

  it('keeps reflection separate and refuses unstable material parameters', () => {
    const rest = standardSimplex(4);
    const stretched = transform(rest, new MatN(4, [
      1.2, 0, 0, 0,
      0, 0.8, 0, 0,
      0, 0, 1.1, 0,
      0, 0, 0, 0.9
    ]));
    const reflected = stretched.map((point) => {
      const result = point.clone();
      result.data[0] *= -1;
      return result;
    });
    const proper = evaluateSimplexStVenantKirchhoffN(rest, stretched, material);
    const inverted = evaluateSimplexStVenantKirchhoffN(rest, reflected, material);
    expect(inverted.energy).toBeCloseTo(proper.energy, 12);
    expect(inverted.deformation.orientationChange).toMatchObject({
      kind: 'full-dimensional',
      state: 'inverted'
    });

    expect(() => evaluateSimplexStVenantKirchhoffN(
      rest,
      stretched,
      { firstLameParameter: 1, shearModulus: 0 }
    )).toThrow(/shearModulus/);
    expect(() => evaluateSimplexStVenantKirchhoffN(
      rest,
      stretched,
      { firstLameParameter: Number.NaN, shearModulus: 1 }
    )).toThrow(/firstLameParameter/);
    expect(() => evaluateSimplexStVenantKirchhoffN(
      rest,
      stretched,
      { firstLameParameter: -0.49, shearModulus: 1 }
    )).not.toThrow();
    expect(() => evaluateSimplexStVenantKirchhoffN(
      rest,
      stretched,
      { firstLameParameter: -0.500000000001, shearModulus: 1 }
    )).toThrow(/lambda \+ 2 mu \/ k/);
  });
});
