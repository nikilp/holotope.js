import { MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdConstraintSolverN,
  XpbdOrientedSimplexMeasureConstraintN,
  evaluateOrientedSimplexMeasureN,
  evaluateSimplexSquaredMeasureN,
  type XpbdPointN
} from '../src/index.js';

function point(position: ArrayLike<number>, inverseMass = 1): XpbdPointN {
  return { position: new VecN(position), inverseMass };
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

function irregularSimplex(dimension: number): VecN[] {
  const origin = new VecN(Array.from(
    { length: dimension },
    (_, coordinate) => 0.17 * (coordinate + 1) - 0.31
  ));
  const positions = [origin];
  for (let column = 0; column < dimension; column++) {
    const endpoint = origin.clone();
    for (let row = 0; row < dimension; row++) {
      endpoint.data[row] += row === column
        ? 1.15 + 0.09 * column
        : 0.08 * Math.sin((row + 1) * (column + 2));
    }
    positions.push(endpoint);
  }
  return positions;
}

describe('oriented full-dimensional simplex measure', () => {
  it('matches analytic R1 through R4 values and gradients', () => {
    const line = evaluateOrientedSimplexMeasureN([
      new VecN([2]),
      new VecN([5])
    ]);
    expect(line).toMatchObject({
      ambientDimension: 1,
      simplexDimension: 1,
      determinant: 3,
      orientedMeasure: 3,
      measure: 3,
      orientation: 1
    });
    expectArrayClose(line.gradients[0]!.data, [-1], 14);
    expectArrayClose(line.gradients[1]!.data, [1], 14);

    const triangle = evaluateOrientedSimplexMeasureN([
      new VecN([0, 0]),
      new VecN([2, 0]),
      new VecN([0, 1])
    ]);
    expect(triangle).toMatchObject({ determinant: 2, orientedMeasure: 1, orientation: 1 });
    expectArrayClose(triangle.gradients[0]!.data, [-0.5, -1], 14);
    expectArrayClose(triangle.gradients[1]!.data, [0.5, 0], 14);
    expectArrayClose(triangle.gradients[2]!.data, [0, 1], 14);

    const tetrahedron = evaluateOrientedSimplexMeasureN([
      new VecN([0, 0, 0]),
      new VecN([1, 0, 0]),
      new VecN([0, 2, 0]),
      new VecN([0, 0, 3])
    ]);
    expect(tetrahedron).toMatchObject({ determinant: 6, orientedMeasure: 1, orientation: 1 });
    expectArrayClose(tetrahedron.gradients[0]!.data, [-1, -0.5, -1 / 3], 14);
    expectArrayClose(tetrahedron.gradients[1]!.data, [1, 0, 0], 14);
    expectArrayClose(tetrahedron.gradients[2]!.data, [0, 0.5, 0], 14);
    expectArrayClose(tetrahedron.gradients[3]!.data, [0, 0, 1 / 3], 14);

    const pentatope = evaluateOrientedSimplexMeasureN([
      new VecN([0, 0, 0, 0]),
      new VecN([1, 0, 0, 0]),
      new VecN([0, 1, 0, 0]),
      new VecN([0, 0, 1, 0]),
      new VecN([0, 0, 0, 1])
    ]);
    expect(pentatope).toMatchObject({
      determinant: 1,
      orientedMeasure: 1 / 24,
      measure: 1 / 24,
      orientation: 1
    });
    expectArrayClose(pentatope.gradients[0]!.data, new Array(4).fill(-1 / 24), 14);
    for (let pointIndex = 1; pointIndex <= 4; pointIndex++) {
      const expected = new Array<number>(4).fill(0);
      expected[pointIndex - 1] = 1 / 24;
      expectArrayClose(pentatope.gradients[pointIndex]!.data, expected, 14);
    }
  });

  it('agrees with central differences in R2, R3, R4, and R7', () => {
    const step = 1e-6;
    for (const dimension of [2, 3, 4, 7]) {
      const positions = irregularSimplex(dimension);
      const evaluated = evaluateOrientedSimplexMeasureN(positions);
      for (let pointIndex = 0; pointIndex < positions.length; pointIndex++) {
        for (let coordinate = 0; coordinate < dimension; coordinate++) {
          const plus = positions.map((position) => position.clone());
          const minus = positions.map((position) => position.clone());
          plus[pointIndex]!.data[coordinate] += step;
          minus[pointIndex]!.data[coordinate] -= step;
          const finiteDifference = (
            evaluateOrientedSimplexMeasureN(plus).orientedMeasure -
            evaluateOrientedSimplexMeasureN(minus).orientedMeasure
          ) / (2 * step);
          expect(evaluated.gradients[pointIndex]!.data[coordinate]!).toBeCloseTo(
            finiteDifference,
            7
          );
        }
      }
    }
  });

  it('is translation invariant and SO(N)-covariant', () => {
    const positions = irregularSimplex(5);
    const base = evaluateOrientedSimplexMeasureN(positions);
    const rotation = MatN.rotationInPlane(5, 0, 4, 0.61)
      .multiply(MatN.rotationInPlane(5, 1, 3, -0.38))
      .multiply(MatN.rotationInPlane(5, 0, 2, 0.27));
    const translation = new VecN([3, -2, 0.4, 1.2, -0.7]);
    const transformed = evaluateOrientedSimplexMeasureN(
      positions.map((position) => rotation.applyTo(position).add(translation))
    );

    expect(transformed.determinant).toBeCloseTo(base.determinant, 11);
    expect(transformed.orientedMeasure).toBeCloseTo(base.orientedMeasure, 12);
    for (let pointIndex = 0; pointIndex < positions.length; pointIndex++) {
      expectArrayClose(
        transformed.gradients[pointIndex]!.data,
        rotation.applyTo(base.gradients[pointIndex]!).data,
        10
      );
    }
  });

  it('changes sign under reflection and odd vertex permutation', () => {
    const positions = irregularSimplex(4);
    const base = evaluateOrientedSimplexMeasureN(positions);
    const reflectedPositions = positions.map((position) => {
      const reflected = position.clone();
      reflected.data[0] = -reflected.data[0]!;
      return reflected;
    });
    const reflected = evaluateOrientedSimplexMeasureN(reflectedPositions);

    expect(reflected.orientedMeasure).toBeCloseTo(-base.orientedMeasure, 13);
    expect(reflected.orientation).toBe(-base.orientation);
    for (let pointIndex = 0; pointIndex < positions.length; pointIndex++) {
      const expected = base.gradients[pointIndex]!.clone();
      expected.data[0] = -expected.data[0]!;
      expected.multiplyScalar(-1);
      expectArrayClose(reflected.gradients[pointIndex]!.data, expected.data, 11);
    }

    const swappedPositions = [...positions];
    [swappedPositions[1], swappedPositions[2]] = [
      swappedPositions[2]!,
      swappedPositions[1]!
    ];
    const swapped = evaluateOrientedSimplexMeasureN(swappedPositions);
    expect(swapped.orientedMeasure).toBeCloseTo(-base.orientedMeasure, 13);
    expect(swapped.orientation).toBe(-base.orientation);
  });

  it('agrees in magnitude with the Gram coordinate in R2 through R7', () => {
    for (const dimension of [2, 3, 4, 5, 7]) {
      const positions = irregularSimplex(dimension);
      const oriented = evaluateOrientedSimplexMeasureN(positions);
      const unsigned = evaluateSimplexSquaredMeasureN(positions);
      expect(oriented.measure).toBeCloseTo(unsigned.measure, 10);
      expect(oriented.orientedMeasure ** 2).toBeCloseTo(unsigned.squaredMeasure, 10);
    }
  });

  it('retains a recovery gradient at rank N - 1 and reports deeper collapse', () => {
    const flattened = evaluateOrientedSimplexMeasureN([
      new VecN([0, 0, 0, 0]),
      new VecN([1, 0, 0, 0]),
      new VecN([0, 1, 0, 0]),
      new VecN([0, 0, 1, 0]),
      new VecN([1, 1, 1, 0])
    ]);
    expect(flattened).toMatchObject({ orientedMeasure: 0, orientation: 0 });
    expect(flattened.gradients.some((gradient) => gradient.lengthSq() > 0)).toBe(true);

    const deeperCollapse = evaluateOrientedSimplexMeasureN([
      new VecN([0, 0, 0, 0]),
      new VecN([1, 0, 0, 0]),
      new VecN([0, 1, 0, 0]),
      new VecN([1, 1, 0, 0]),
      new VecN([2, 1, 0, 0])
    ]);
    expect(deeperCollapse).toMatchObject({ orientedMeasure: 0, orientation: 0 });
    expect(deeperCollapse.gradients.every((gradient) => gradient.lengthSq() === 0)).toBe(true);
  });

  it('matches the generic XPBD scalar update for one compliant visit', () => {
    const points = [
      point([0, 0], 0.5),
      point([2, 0], 1.25),
      point([0, 1], 0.75)
    ];
    const initial = evaluateOrientedSimplexMeasureN(
      points.map((candidate) => candidate.position)
    );
    const restOrientedMeasure = 0.8;
    const compliance = 0.02;
    const deltaTime = 0.1;
    let weightedInverseMass = 0;
    for (let index = 0; index < points.length; index++) {
      weightedInverseMass += points[index]!.inverseMass *
        initial.gradients[index]!.lengthSq();
    }
    const scaledCompliance = compliance / (deltaTime * deltaTime);
    const expectedMultiplier = -(
      initial.orientedMeasure - restOrientedMeasure
    ) / (weightedInverseMass + scaledCompliance);
    const expectedPositions = points.map((candidate, index) => candidate.position
      .clone()
      .add(
        initial.gradients[index]!.clone().multiplyScalar(
          candidate.inverseMass * expectedMultiplier
        )
      ));
    const constraint = new XpbdOrientedSimplexMeasureConstraintN({
      id: 'triangle-area',
      points,
      restOrientedMeasure,
      compliance
    });

    const result = new XpbdConstraintSolverN({ dimension: 2, iterations: 1 })
      .solve([constraint], deltaTime)
      .constraints[0]!;

    expect(result.initialValue).toBeCloseTo(0.2, 14);
    expect(result.weightedInverseMass).toBeGreaterThan(0);
    expect(result.totalMultiplier).toBeCloseTo(expectedMultiplier, 14);
    for (let index = 0; index < points.length; index++) {
      expectArrayClose(points[index]!.position.data, expectedPositions[index]!.data, 13);
    }
  });

  it('reduces an inverted residual while retaining a fixed point', () => {
    const solve = (iterations: number): { residual: number; fixed: number[] } => {
      const points = [
        point([0, 0], 0),
        point([0, 1.2]),
        point([1, 0.2])
      ];
      const result = new XpbdConstraintSolverN({ dimension: 2, iterations }).solve([
        new XpbdOrientedSimplexMeasureConstraintN({
          id: 'signed-area',
          points,
          restOrientedMeasure: 0.5
        })
      ], 1 / 60).constraints[0]!;
      return { residual: Math.abs(result.finalValue), fixed: points[0]!.position.toArray() };
    };

    expect(solve(12).residual).toBeLessThan(solve(1).residual * 1e-5);
    expect(solve(12).fixed).toEqual([0, 0]);
  });

  it('does not invent a later direction after a symmetric Newton step collapses', () => {
    const points = [
      point([0, 0], 0),
      point([0, 1]),
      point([1, 0])
    ];
    const result = new XpbdConstraintSolverN({ dimension: 2, iterations: 2 }).solve([
      new XpbdOrientedSimplexMeasureConstraintN({
        id: 'symmetric-inversion',
        points,
        restOrientedMeasure: 0.5
      })
    ], 1 / 60).constraints[0]!;

    expect(points[1]!.position.toArray()).toEqual([0, 0]);
    expect(points[2]!.position.toArray()).toEqual([0, 0]);
    expect(result).toMatchObject({
      status: 'solved',
      finalValue: -0.5,
      weightedInverseMass: 0
    });
  });

  it('refuses non-full-dimensional and malformed inputs and policies', () => {
    expect(() => evaluateOrientedSimplexMeasureN([])).toThrow(/at least two/);
    expect(() => evaluateOrientedSimplexMeasureN([
      new VecN([0, 0, 0]),
      new VecN([1, 0, 0]),
      new VecN([0, 1, 0])
    ])).toThrow(/dimension \+ 1/);
    expect(() => evaluateOrientedSimplexMeasureN([
      new VecN([0, 0]),
      new VecN([1, 0]),
      new VecN([0, 1, 0])
    ])).toThrow(/dimension mismatch/);
    expect(() => evaluateOrientedSimplexMeasureN([
      new VecN([0, 0]),
      new VecN([Number.NaN, 0]),
      new VecN([0, 1])
    ])).toThrow(/finite coordinates/);

    const a = point([0, 0]);
    const b = point([1, 0]);
    const c = point([0, 1]);
    expect(() => new XpbdOrientedSimplexMeasureConstraintN({
      id: '', points: [a, b, c], restOrientedMeasure: 0.5
    })).toThrow(/non-empty/);
    expect(() => new XpbdOrientedSimplexMeasureConstraintN({
      id: 'duplicate', points: [a, b, b], restOrientedMeasure: 0.5
    })).toThrow(/distinct/);
    expect(() => new XpbdOrientedSimplexMeasureConstraintN({
      id: 'arity', points: [a, b], restOrientedMeasure: 0.5
    })).toThrow(/dimension \+ 1/);
    expect(() => new XpbdOrientedSimplexMeasureConstraintN({
      id: 'rest', points: [a, b, c], restOrientedMeasure: Infinity
    })).toThrow(/restOrientedMeasure/);
    expect(() => new XpbdOrientedSimplexMeasureConstraintN({
      id: 'compliance', points: [a, b, c], restOrientedMeasure: 0.5, compliance: -1
    })).toThrow(/compliance/);

    const live = new XpbdOrientedSimplexMeasureConstraintN({
      id: 'live', points: [a, b, c], restOrientedMeasure: 0.5
    });
    c.position.data[1] = Number.NaN;
    expect(() => live.evaluate()).toThrow(/finite coordinates/);
  });
});
