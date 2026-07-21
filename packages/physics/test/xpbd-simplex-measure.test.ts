import { MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdConstraintSolverN,
  XpbdSimplexSquaredMeasureConstraintN,
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

describe('dimension-generic simplex squared measure', () => {
  it('matches an analytic triangle value and every point gradient', () => {
    const evaluated = evaluateSimplexSquaredMeasureN([
      new VecN([0, 0]),
      new VecN([2, 0]),
      new VecN([0, 1])
    ]);

    expect(evaluated).toMatchObject({
      ambientDimension: 2,
      simplexDimension: 2,
      gramDeterminant: 4,
      squaredMeasure: 1,
      measure: 1
    });
    expectArrayClose(evaluated.gradients[0]!.data, [-1, -2], 14);
    expectArrayClose(evaluated.gradients[1]!.data, [1, 0], 14);
    expectArrayClose(evaluated.gradients[2]!.data, [0, 2], 14);
  });

  it('agrees with central differences for an irregular 3-simplex in R5', () => {
    const positions = [
      new VecN([0.2, -0.4, 0.7, 0.1, -0.3]),
      new VecN([1.3, 0.2, -0.1, 0.5, 0.4]),
      new VecN([-0.6, 1.1, 0.3, -0.8, 0.2]),
      new VecN([0.4, -0.2, 1.5, 0.9, -0.7])
    ];
    const evaluated = evaluateSimplexSquaredMeasureN(positions);
    const step = 1e-6;

    for (let pointIndex = 0; pointIndex < positions.length; pointIndex++) {
      for (let coordinate = 0; coordinate < 5; coordinate++) {
        const plus = positions.map((position) => position.clone());
        const minus = positions.map((position) => position.clone());
        plus[pointIndex]!.data[coordinate] += step;
        minus[pointIndex]!.data[coordinate] -= step;
        const finiteDifference = (
          evaluateSimplexSquaredMeasureN(plus).squaredMeasure -
          evaluateSimplexSquaredMeasureN(minus).squaredMeasure
        ) / (2 * step);
        expect(evaluated.gradients[pointIndex]!.data[coordinate]!).toBeCloseTo(
          finiteDifference,
          7
        );
      }
    }
  });

  it('is translation invariant and orthogonally covariant', () => {
    const positions = [
      new VecN([0.2, -0.4, 0.7, 0.1, -0.3]),
      new VecN([1.3, 0.2, -0.1, 0.5, 0.4]),
      new VecN([-0.6, 1.1, 0.3, -0.8, 0.2]),
      new VecN([0.4, -0.2, 1.5, 0.9, -0.7])
    ];
    const base = evaluateSimplexSquaredMeasureN(positions);
    const rotation = MatN.rotationInPlane(5, 0, 4, 0.61)
      .multiply(MatN.rotationInPlane(5, 1, 3, -0.38));
    const translation = new VecN([3, -2, 0.4, 1.2, -0.7]);
    const transformed = evaluateSimplexSquaredMeasureN(
      positions.map((position) => rotation.applyTo(position).add(translation))
    );

    expect(transformed.squaredMeasure).toBeCloseTo(base.squaredMeasure, 12);
    expect(transformed.measure).toBeCloseTo(base.measure, 12);
    for (let pointIndex = 0; pointIndex < positions.length; pointIndex++) {
      expectArrayClose(
        transformed.gradients[pointIndex]!.data,
        rotation.applyTo(base.gradients[pointIndex]!).data,
        10
      );
    }
  });

  it('specializes identically for one triangle embedded from R2 through R7', () => {
    const records = [2, 3, 4, 7].map((dimension) => {
      const embed = (x: number, y: number): VecN => new VecN([
        x,
        y,
        ...new Array<number>(dimension - 2).fill(0)
      ]);
      return evaluateSimplexSquaredMeasureN([
        embed(0.1, -0.2),
        embed(1.4, 0.3),
        embed(-0.5, 1.1)
      ]);
    });

    for (const record of records.slice(1)) {
      expect(record.squaredMeasure).toBeCloseTo(records[0]!.squaredMeasure, 14);
      for (let pointIndex = 0; pointIndex < 3; pointIndex++) {
        expectArrayClose(
          record.gradients[pointIndex]!.data.subarray(0, 2),
          records[0]!.gradients[pointIndex]!.data,
          14
        );
        expect(
          record.gradients[pointIndex]!.data
            .subarray(2)
            .every((coordinate) => coordinate === 0)
        ).toBe(true);
      }
    }
  });

  it('matches the generic XPBD scalar update for one compliant visit', () => {
    const points = [
      point([0, 0, 0, 0], 0.5),
      point([2, 0, 0, 0], 1.25),
      point([0, 1, 0, 0], 0.75)
    ];
    const initial = evaluateSimplexSquaredMeasureN(
      points.map((candidate) => candidate.position)
    );
    const restSquaredMeasure = 0.8;
    const compliance = 0.02;
    const deltaTime = 0.1;
    let weightedInverseMass = 0;
    for (let index = 0; index < points.length; index++) {
      weightedInverseMass += points[index]!.inverseMass *
        initial.gradients[index]!.lengthSq();
    }
    const scaledCompliance = compliance / (deltaTime * deltaTime);
    const expectedMultiplier = -(
      initial.squaredMeasure - restSquaredMeasure
    ) / (weightedInverseMass + scaledCompliance);
    const expectedPositions = points.map((candidate, index) => candidate.position
      .clone()
      .add(
        initial.gradients[index]!.clone().multiplyScalar(
          candidate.inverseMass * expectedMultiplier
        )
      ));
    const constraint = new XpbdSimplexSquaredMeasureConstraintN({
      id: 'triangle-area-squared',
      points,
      restSquaredMeasure,
      compliance
    });

    const result = new XpbdConstraintSolverN({ dimension: 4, iterations: 1 })
      .solve([constraint], deltaTime)
      .constraints[0]!;

    expect(result.initialValue).toBeCloseTo(0.2, 14);
    expect(result.weightedInverseMass).toBeGreaterThan(0);
    expect(result.totalMultiplier).toBeCloseTo(expectedMultiplier, 14);
    expect(result.signedForce).toBeCloseTo(
      expectedMultiplier / (deltaTime * deltaTime),
      13
    );
    for (let index = 0; index < points.length; index++) {
      expectArrayClose(points[index]!.position.data, expectedPositions[index]!.data, 13);
    }
  });

  it('converges from a non-degenerate perturbation while retaining a fixed point', () => {
    const solve = (iterations: number): { residual: number; fixed: number[] } => {
      const points = [
        point([0, 0, 0, 0], 0),
        point([1.8, 0.2, 0, 0]),
        point([0.2, 0.7, 0, 0])
      ];
      const result = new XpbdConstraintSolverN({ dimension: 4, iterations }).solve([
        new XpbdSimplexSquaredMeasureConstraintN({
          id: 'area',
          points,
          restSquaredMeasure: 0.25
        })
      ], 1 / 60).constraints[0]!;
      return { residual: Math.abs(result.finalValue), fixed: points[0]!.position.toArray() };
    };

    expect(solve(8).residual).toBeLessThan(solve(1).residual * 1e-4);
    expect(solve(8).fixed).toEqual([0, 0, 0, 0]);
  });

  it('reports a collapsed simplex as finite no-dynamic-response evidence', () => {
    const points = [point([0, 0]), point([1, 0]), point([2, 0])];
    const constraint = new XpbdSimplexSquaredMeasureConstraintN({
      id: 'collapsed',
      points,
      restSquaredMeasure: 1
    });
    const evaluated = constraint.evaluate();
    expect(evaluated.squaredMeasure).toBe(0);
    expect(evaluated.gradients.every((gradient) => gradient.lengthSq() === 0)).toBe(true);

    const result = new XpbdConstraintSolverN({ dimension: 2 }).solve(
      [constraint],
      1 / 60
    ).constraints[0]!;
    expect(result).toMatchObject({
      status: 'no-dynamic-response',
      initialValue: -1,
      finalValue: -1,
      totalMultiplier: 0,
      weightedInverseMass: 0
    });
  });

  it('refuses malformed dimensions, identities, policies, and live coordinates', () => {
    expect(() => evaluateSimplexSquaredMeasureN([new VecN([0, 0])])).toThrow(
      /at least two/
    );
    expect(() => evaluateSimplexSquaredMeasureN([
      new VecN([0, 0]),
      new VecN([1, 0]),
      new VecN([0, 1]),
      new VecN([1, 1])
    ])).toThrow(/exceeds ambient/);
    expect(() => evaluateSimplexSquaredMeasureN([
      new VecN([0, 0]),
      new VecN([1, 0, 0])
    ])).toThrow(/dimension mismatch/);
    expect(() => evaluateSimplexSquaredMeasureN([
      new VecN([0, 0]),
      new VecN([1e308, 0])
    ])).toThrow(/non-finite/);

    const a = point([0, 0]);
    const b = point([1, 0]);
    expect(() => new XpbdSimplexSquaredMeasureConstraintN({
      id: '', points: [a, b], restSquaredMeasure: 1
    })).toThrow(/non-empty/);
    expect(() => new XpbdSimplexSquaredMeasureConstraintN({
      id: 'duplicate', points: [a, a], restSquaredMeasure: 1
    })).toThrow(/distinct/);
    expect(() => new XpbdSimplexSquaredMeasureConstraintN({
      id: 'rest', points: [a, b], restSquaredMeasure: -1
    })).toThrow(/restSquaredMeasure/);
    expect(() => new XpbdSimplexSquaredMeasureConstraintN({
      id: 'compliance', points: [a, b], restSquaredMeasure: 1, compliance: Infinity
    })).toThrow(/compliance/);

    const live = new XpbdSimplexSquaredMeasureConstraintN({
      id: 'live', points: [a, b], restSquaredMeasure: 1
    });
    b.position.data[1] = Number.NaN;
    expect(() => live.evaluate()).toThrow(/finite coordinates/);
  });
});
