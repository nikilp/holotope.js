import { MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  evaluateOrientedSimplexMeasureN,
  evaluateSimplexMetricDeformationN,
  evaluateSimplexSquaredMeasureN
} from '../src/index.js';

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
  digits = 11
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, digits);
  }
}

function expectMatrixClose(actual: MatN, expected: MatN, digits = 11): void {
  expect(actual.n).toBe(expected.n);
  expectArrayClose(actual.data, expected.data, digits);
}

describe('dimension-independent simplex metric deformation', () => {
  it('matches analytic line, membrane, and R4 solid stretches', () => {
    const line = evaluateSimplexMetricDeformationN(
      [new VecN([0]), new VecN([2])],
      [new VecN([0]), new VecN([6])]
    );
    expect(line).toMatchObject({
      ambientDimension: 1,
      simplexDimension: 1,
      measureRatio: 3,
      restConditioning: 1,
      strainFrobeniusNorm: 4,
      orientationChange: {
        kind: 'full-dimensional',
        signedMeasureRatio: 3,
        state: 'preserved'
      }
    });
    expectArrayClose(line.rightCauchyGreen.data, [9], 14);
    expectArrayClose(line.greenLagrangeStrain.data, [4], 14);
    expectArrayClose(line.principalStretches, [3], 14);

    const triangleRest = standardSimplex(2);
    const triangleMap = new MatN(2, [2, 0, 0, 0.5]);
    const triangle = evaluateSimplexMetricDeformationN(
      triangleRest,
      transform(triangleRest, triangleMap)
    );
    expectArrayClose(triangle.rightCauchyGreen.data, [4, 0, 0, 0.25], 14);
    expectArrayClose(triangle.greenLagrangeStrain.data, [1.5, 0, 0, -0.375], 14);
    expectArrayClose(triangle.principalStretches, [0.5, 2], 14);
    expect(triangle.measureRatio).toBeCloseTo(1, 14);
    expect(triangle.strainFrobeniusNorm).toBeCloseTo(Math.hypot(1.5, 0.375), 14);

    const solidRest = standardSimplex(4);
    const solidMap = new MatN(4, [
      2, 0, 0, 0,
      0, 3, 0, 0,
      0, 0, 0.5, 0,
      0, 0, 0, 0.25
    ]);
    const solid = evaluateSimplexMetricDeformationN(
      solidRest,
      transform(solidRest, solidMap)
    );
    expectArrayClose(solid.principalStretches, [0.25, 0.5, 2, 3], 13);
    expect(solid.measureRatio).toBeCloseTo(0.75, 13);
    expect(solid.orientationChange).toMatchObject({
      kind: 'full-dimensional',
      signedMeasureRatio: 0.75,
      state: 'preserved'
    });
  });

  it('specializes uniform intrinsic scaling from R2 through R7', () => {
    const scale = 1.7;
    for (const [ambientDimension, simplexDimension] of [
      [2, 1],
      [3, 2],
      [4, 3],
      [7, 4]
    ] as const) {
      const rest = standardSimplex(ambientDimension, simplexDimension);
      const current = rest.map((position) => position.clone().multiplyScalar(scale));
      const evaluated = evaluateSimplexMetricDeformationN(rest, current);
      const expectedC = MatN.identity(simplexDimension);
      for (let axis = 0; axis < simplexDimension; axis++) {
        expectedC.set(axis, axis, scale * scale);
      }
      expectMatrixClose(evaluated.rightCauchyGreen, expectedC, 13);
      expectArrayClose(
        evaluated.principalStretches,
        new Array<number>(simplexDimension).fill(scale),
        13
      );
      expect(evaluated.measureRatio).toBeCloseTo(scale ** simplexDimension, 12);
      expect(evaluated.orientationChange).toEqual({ kind: 'embedded' });
    }
  });

  it('is invariant under common ambient translation and SO(N) rotation', () => {
    const rest = [
      new VecN([0.2, -0.4, 0.7, 0.1, -0.3, 0.5]),
      new VecN([1.3, 0.2, -0.1, 0.5, 0.4, -0.2]),
      new VecN([-0.6, 1.1, 0.3, -0.8, 0.2, 0.6]),
      new VecN([0.4, -0.2, 1.5, 0.9, -0.7, 0.1])
    ];
    const current = rest.map((position, index) => position.clone().add(new VecN([
      0.05 * index,
      -0.03 * index * index,
      0.02 * (index + 1),
      0.04 * index,
      -0.01 * index,
      0.025 * index
    ])));
    const base = evaluateSimplexMetricDeformationN(rest, current);
    const rotation = MatN.rotationInPlane(6, 0, 5, 0.61)
      .multiply(MatN.rotationInPlane(6, 1, 4, -0.38))
      .multiply(MatN.rotationInPlane(6, 2, 3, 0.27));
    const translation = new VecN([3, -2, 0.4, 1.2, -0.7, 0.8]);
    const transformed = evaluateSimplexMetricDeformationN(
      transform(rest, rotation, translation),
      transform(current, rotation, translation)
    );

    expectMatrixClose(transformed.restMetric, base.restMetric, 11);
    expectMatrixClose(transformed.currentMetric, base.currentMetric, 11);
    expectMatrixClose(transformed.rightCauchyGreen, base.rightCauchyGreen, 10);
    expectArrayClose(transformed.principalStretches, base.principalStretches, 10);
    expect(transformed.measureRatio).toBeCloseTo(base.measureRatio, 11);
    expect(transformed.strainFrobeniusNorm).toBeCloseTo(
      base.strainFrobeniusNorm,
      11
    );
  });

  it('reports identity strain for rigid motion of an embedded simplex', () => {
    const rest = standardSimplex(6, 3);
    const rotation = MatN.rotationInPlane(6, 0, 5, 0.41)
      .multiply(MatN.rotationInPlane(6, 1, 4, -0.72));
    const current = transform(rest, rotation, new VecN([1, 2, -1, 0.4, 0.2, -0.3]));
    const evaluated = evaluateSimplexMetricDeformationN(rest, current);

    expectMatrixClose(evaluated.rightCauchyGreen, MatN.identity(3), 12);
    expectArrayClose(evaluated.principalStretches, [1, 1, 1], 12);
    expect(evaluated.measureRatio).toBeCloseTo(1, 12);
    expect(evaluated.strainFrobeniusNorm).toBeCloseTo(0, 12);
    expect(evaluated.orientationChange).toEqual({ kind: 'embedded' });
  });

  it('keeps invariant material evidence under consistent vertex permutation', () => {
    const rest = standardSimplex(4);
    const affine = new MatN(4, [
      1.2, 0.3, 0, 0.1,
      0.1, 0.8, -0.2, 0,
      0, 0.15, 1.4, 0.25,
      -0.1, 0, 0.2, 0.9
    ]);
    const current = transform(rest, affine, new VecN([0.4, -0.2, 0.3, 0.7]));
    const base = evaluateSimplexMetricDeformationN(rest, current);
    const order = [2, 0, 4, 1, 3];
    const permuted = evaluateSimplexMetricDeformationN(
      order.map((index) => rest[index]!),
      order.map((index) => current[index]!)
    );

    expectArrayClose(permuted.principalStretches, base.principalStretches, 10);
    expect(permuted.measureRatio).toBeCloseTo(base.measureRatio, 11);
    expect(permuted.strainFrobeniusNorm).toBeCloseTo(base.strainFrobeniusNorm, 10);
    expect(permuted.orientationChange.kind).toBe('full-dimensional');
    expect(base.orientationChange.kind).toBe('full-dimensional');
    if (
      permuted.orientationChange.kind === 'full-dimensional' &&
      base.orientationChange.kind === 'full-dimensional'
    ) {
      expect(permuted.orientationChange.signedMeasureRatio).toBeCloseTo(
        base.orientationChange.signedMeasureRatio,
        11
      );
    }
  });

  it('separates metric deformation from full-dimensional reflection', () => {
    const rest = standardSimplex(4);
    const current = transform(rest, new MatN(4, [
      1.2, 0.1, 0, 0,
      0, 0.8, 0.2, 0,
      0, 0, 1.1, 0.1,
      0.1, 0, 0, 0.9
    ]));
    const preserved = evaluateSimplexMetricDeformationN(rest, current);
    const reflectedCurrent = current.map((position) => {
      const reflected = position.clone();
      reflected.data[0] *= -1;
      return reflected;
    });
    const reflected = evaluateSimplexMetricDeformationN(rest, reflectedCurrent);

    expectMatrixClose(reflected.currentMetric, preserved.currentMetric, 13);
    expectMatrixClose(reflected.rightCauchyGreen, preserved.rightCauchyGreen, 13);
    expectArrayClose(reflected.principalStretches, preserved.principalStretches, 12);
    expect(reflected.measureRatio).toBeCloseTo(preserved.measureRatio, 12);
    expect(reflected.orientationChange).toMatchObject({
      kind: 'full-dimensional',
      state: 'inverted'
    });
    if (
      reflected.orientationChange.kind === 'full-dimensional' &&
      preserved.orientationChange.kind === 'full-dimensional'
    ) {
      expect(reflected.orientationChange.signedMeasureRatio).toBeCloseTo(
        -preserved.orientationChange.signedMeasureRatio,
        12
      );
    }

    const embeddedRest = standardSimplex(5, 3);
    const embeddedCurrent = embeddedRest.map((position) => {
      const reflectedPosition = position.clone();
      reflectedPosition.data[0] *= -1;
      return reflectedPosition;
    });
    expect(
      evaluateSimplexMetricDeformationN(embeddedRest, embeddedCurrent)
        .orientationChange
    ).toEqual({ kind: 'embedded' });
  });

  it('agrees with existing unsigned and oriented measure coordinates', () => {
    for (const [ambientDimension, simplexDimension] of [
      [3, 2],
      [4, 3],
      [4, 4],
      [7, 5]
    ] as const) {
      const rest = standardSimplex(ambientDimension, simplexDimension);
      const current = rest.map((position, index) => {
        const result = position.clone();
        for (let axis = 0; axis < ambientDimension; axis++) {
          result.data[axis] += 0.04 * Math.sin((index + 1) * (axis + 2));
        }
        return result;
      });
      const evaluated = evaluateSimplexMetricDeformationN(rest, current);
      const restMeasure = evaluateSimplexSquaredMeasureN(rest).measure;
      const currentMeasure = evaluateSimplexSquaredMeasureN(current).measure;
      expect(evaluated.measureRatio).toBeCloseTo(currentMeasure / restMeasure, 9);
      if (simplexDimension === ambientDimension) {
        const signedRatio =
          evaluateOrientedSimplexMeasureN(current).orientedMeasure /
          evaluateOrientedSimplexMeasureN(rest).orientedMeasure;
        expect(evaluated.orientationChange.kind).toBe('full-dimensional');
        if (evaluated.orientationChange.kind === 'full-dimensional') {
          expect(evaluated.orientationChange.signedMeasureRatio).toBeCloseTo(
            signedRatio,
            10
          );
        }
      }
    }
  });

  it('admits current collapse and reports rest conditioning without a hidden cutoff', () => {
    const rest = standardSimplex(4);
    const collapsed = [
      new VecN([0, 0, 0, 0]),
      new VecN([1, 0, 0, 0]),
      new VecN([0, 1, 0, 0]),
      new VecN([1, 1, 0, 0]),
      new VecN([2, 1, 0, 0])
    ];
    const evaluated = evaluateSimplexMetricDeformationN(rest, collapsed);
    expect(evaluated.measureRatio).toBe(0);
    expect(evaluated.principalStretches.filter((stretch) => stretch < 1e-7)).toHaveLength(2);
    expect(evaluated.orientationChange).toEqual({
      kind: 'full-dimensional',
      signedMeasureRatio: 0,
      state: 'collapsed'
    });

    const slenderRest = [
      new VecN([0, 0]),
      new VecN([1, 0]),
      new VecN([0, 1e-8])
    ];
    const slender = evaluateSimplexMetricDeformationN(slenderRest, slenderRest);
    expect(slender.restConditioning).toBeCloseTo(1e-8, 16);
    expect(slender.strainFrobeniusNorm).toBeCloseTo(0, 12);

    expect(() => evaluateSimplexMetricDeformationN(
      [new VecN([0, 0]), new VecN([1, 0]), new VecN([2, 0])],
      [new VecN([0, 0]), new VecN([1, 0]), new VecN([2, 0])]
    )).toThrow(/rest simplex must be non-degenerate/);
  });

  it('refuses malformed, mismatched, and non-finite geometry', () => {
    expect(() => evaluateSimplexMetricDeformationN([], [])).toThrow(/rest points/);
    expect(() => evaluateSimplexMetricDeformationN(
      [new VecN([0, 0]), new VecN([1, 0])],
      [new VecN([0, 0])]
    )).toThrow(/counts/);
    expect(() => evaluateSimplexMetricDeformationN(
      [new VecN([0, 0]), new VecN([1, 0])],
      [new VecN([0, 0]), new VecN([1, 0, 0])]
    )).toThrow(/dimension mismatch/);
    expect(() => evaluateSimplexMetricDeformationN(
      [new VecN([0, 0]), new VecN([1, 0]), new VecN([0, 1]), new VecN([1, 1])],
      [new VecN([0, 0]), new VecN([1, 0]), new VecN([0, 1]), new VecN([1, 1])]
    )).toThrow(/exceeds ambient/);
    expect(() => evaluateSimplexMetricDeformationN(
      [new VecN([0, 0]), new VecN([1, 0]), new VecN([0, 1])],
      [new VecN([0, 0]), new VecN([Number.NaN, 0]), new VecN([0, 1])]
    )).toThrow(/finite coordinates/);
    expect(() => evaluateSimplexMetricDeformationN(
      [new VecN([0, 0]), new VecN([1, 0]), new VecN([0, 1])],
      [new VecN([0, 0]), new VecN([1e308, 0]), new VecN([0, 1e308])]
    )).toThrow(/Float64 range/);
    expect(() => evaluateSimplexMetricDeformationN(
      [undefined as unknown as VecN, new VecN([1])],
      [new VecN([0]), new VecN([1])]
    )).toThrow(/rest point 0/);
  });
});
