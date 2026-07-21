import { MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdConstraintSolverN,
  XpbdDistanceConstraintN,
  type XpbdPointN,
  type XpbdScalarConstraintN
} from '../src/index.js';

function point(position: ArrayLike<number>, inverseMass = 1): XpbdPointN {
  return { position: new VecN(position), inverseMass };
}

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 12
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, digits);
  }
}

describe('dimension-generic XPBD scalar constraints', () => {
  it('matches the closed-form scalar update and compliant residual', () => {
    const a = point([1.5, 0, 0, 0], 0.5);
    const b = point([0, 0, 0, 0], 2);
    const compliance = 1e-3;
    const deltaTime = 0.1;
    const constraint = new XpbdDistanceConstraintN({
      id: 'analytic',
      pointA: a,
      pointB: b,
      restLength: 1,
      compliance
    });
    const result = new XpbdConstraintSolverN({ dimension: 4, iterations: 1 })
      .solve([constraint], deltaTime)
      .constraints[0]!;

    const scaledCompliance = compliance / (deltaTime * deltaTime);
    const weightedInverseMass = a.inverseMass + b.inverseMass;
    const expectedMultiplier = -0.5 / (weightedInverseMass + scaledCompliance);
    expect(result.initialValue).toBeCloseTo(0.5, 14);
    expect(result.weightedInverseMass).toBeCloseTo(weightedInverseMass, 14);
    expect(result.totalMultiplier).toBeCloseTo(expectedMultiplier, 14);
    expect(result.signedForce).toBeCloseTo(
      expectedMultiplier / (deltaTime * deltaTime),
      13
    );
    expect(a.position.data[0]).toBeCloseTo(1.5 + 0.5 * expectedMultiplier, 14);
    expect(b.position.data[0]).toBeCloseTo(-2 * expectedMultiplier, 14);
    expect(Math.abs(result.compliantResidual)).toBeLessThan(1e-14);
  });

  it('reaches a hard rest length in one visit and preserves mass geometry', () => {
    const a = point([2, 0, 0], 0.25);
    const b = point([-0.5, 0, 0], 1);
    const centerNumeratorBefore = a.position.data[0]! / a.inverseMass +
      b.position.data[0]! / b.inverseMass;
    const result = new XpbdConstraintSolverN({ dimension: 3, iterations: 1 }).solve([
      new XpbdDistanceConstraintN({
        id: 'hard', pointA: a, pointB: b, restLength: 1, compliance: 0
      })
    ], 1 / 60).constraints[0]!;

    expect(a.position.distanceTo(b.position)).toBeCloseTo(1, 14);
    expect(result.finalValue).toBeCloseTo(0, 14);
    expect(result.compliantResidual).toBeCloseTo(0, 14);
    expect(
      a.position.data[0]! / a.inverseMass + b.position.data[0]! / b.inverseMass
    ).toBeCloseTo(centerNumeratorBefore, 14);

    const moving = point([2, 0, 0], 1);
    const fixed = point([0, 0, 0], 0);
    new XpbdConstraintSolverN({ dimension: 3, iterations: 1 }).solve([
      new XpbdDistanceConstraintN({
        id: 'fixed', pointA: moving, pointB: fixed, restLength: 1
      })
    ], 1 / 60);
    expectArrayClose(moving.position.data, [1, 0, 0]);
    expectArrayClose(fixed.position.data, [0, 0, 0]);
  });

  it('specializes identically in R2, R3, R4, and R7', () => {
    const records: Array<{
      multiplier: number;
      finalValue: number;
      a: number[];
      b: number[];
    }> = [];
    for (const dimension of [2, 3, 4, 7]) {
      const a = point([1.4, ...new Array<number>(dimension - 1).fill(0)], 0.5);
      const b = point([0, ...new Array<number>(dimension - 1).fill(0)], 1.5);
      const result = new XpbdConstraintSolverN({ dimension, iterations: 3 }).solve([
        new XpbdDistanceConstraintN({
          id: `r${dimension}`,
          pointA: a,
          pointB: b,
          restLength: 1,
          compliance: 2e-3
        })
      ], 0.2).constraints[0]!;
      records.push({
        multiplier: result.totalMultiplier,
        finalValue: result.finalValue,
        a: a.position.toArray(),
        b: b.position.toArray()
      });
    }
    for (const record of records.slice(1)) {
      expect(record.multiplier).toBeCloseTo(records[0]!.multiplier, 14);
      expect(record.finalValue).toBeCloseTo(records[0]!.finalValue, 14);
      expect(record.a[0]).toBeCloseTo(records[0]!.a[0]!, 14);
      expect(record.b[0]).toBeCloseTo(records[0]!.b[0]!, 14);
      expect(record.a.slice(1).every((coordinate) => coordinate === 0)).toBe(true);
      expect(record.b.slice(1).every((coordinate) => coordinate === 0)).toBe(true);
    }
  });

  it('is invariant under common translation and rotation', () => {
    const solve = (a0: VecN, b0: VecN): {
      result: ReturnType<XpbdConstraintSolverN['solve']>['constraints'][number];
      correctionA: VecN;
      correctionB: VecN;
    } => {
      const a = point(a0.data, 0.7);
      const b = point(b0.data, 1.3);
      const result = new XpbdConstraintSolverN({ dimension: 4, iterations: 2 }).solve([
        new XpbdDistanceConstraintN({
          id: 'euclidean', pointA: a, pointB: b, restLength: 0.9, compliance: 1e-3
        })
      ], 0.05).constraints[0]!;
      return {
        result,
        correctionA: a.position.clone().sub(a0),
        correctionB: b.position.clone().sub(b0)
      };
    };

    const a0 = new VecN([1.2, -0.3, 0.5, 0.9]);
    const b0 = new VecN([-0.4, 0.6, 0.2, -0.7]);
    const base = solve(a0, b0);
    const rotation = MatN.rotationInPlane(4, 0, 3, 0.73);
    const shift = new VecN([4, -2, 1, 3]);
    const transformedA = rotation.applyTo(a0).add(shift);
    const transformedB = rotation.applyTo(b0).add(shift);
    const transformed = solve(transformedA, transformedB);

    expect(transformed.result.totalMultiplier).toBeCloseTo(
      base.result.totalMultiplier,
      13
    );
    expect(transformed.result.finalValue).toBeCloseTo(base.result.finalValue, 13);
    expectArrayClose(
      transformed.correctionA.data,
      rotation.applyTo(base.correctionA).data,
      12
    );
    expectArrayClose(
      transformed.correctionB.data,
      rotation.applyTo(base.correctionB).data,
      12
    );
  });

  it('keeps an isolated branch iteration-independent and converges a coupled chain', () => {
    const isolated = (iterations: number): number[] => {
      const a = point([1.7, 0, 0, 0]);
      const b = point([0, 0, 0, 0]);
      const result = new XpbdConstraintSolverN({ dimension: 4, iterations }).solve([
        new XpbdDistanceConstraintN({
          id: 'isolated', pointA: a, pointB: b, restLength: 1, compliance: 1e-3
        })
      ], 0.1).constraints[0]!;
      return [a.position.data[0]!, b.position.data[0]!, result.totalMultiplier];
    };
    expectArrayClose(isolated(8), isolated(1), 14);

    const chainResidual = (iterations: number): number => {
      const points = [
        point([0, 0, 0, 0], 0),
        point([1.45, 0, 0, 0], 1),
        point([2.9, 0, 0, 0], 1)
      ];
      const constraints = [0, 1].map((edge) => new XpbdDistanceConstraintN({
        id: `edge-${edge}`,
        pointA: points[edge]!,
        pointB: points[edge + 1]!,
        restLength: 1,
        compliance: 1e-5
      }));
      return new XpbdConstraintSolverN({ dimension: 4, iterations })
        .solve(constraints, 0.1)
        .maxAbsCompliantResidual;
    };
    expect(chainResidual(8)).toBeLessThan(chainResidual(1) * 0.02);
  });

  it('reports immovable constraints and requires an explicit coincidence branch', () => {
    const fixedA = point([2, 0, 0, 0], 0);
    const fixedB = point([0, 0, 0, 0], 0);
    const result = new XpbdConstraintSolverN({ dimension: 4 }).solve([
      new XpbdDistanceConstraintN({
        id: 'immovable', pointA: fixedA, pointB: fixedB, restLength: 1
      })
    ], 1 / 60);
    expect(result.constraints[0]).toMatchObject({
      status: 'no-dynamic-response',
      initialValue: 1,
      finalValue: 1,
      totalMultiplier: 0,
      compliantResidual: 1
    });
    expect(result.noDynamicResponseIds).toEqual(['immovable']);

    const coincidentA = point([0, 0, 0, 0]);
    const coincidentB = point([0, 0, 0, 0]);
    const unbranched = new XpbdDistanceConstraintN({
      id: 'coincident', pointA: coincidentA, pointB: coincidentB, restLength: 1
    });
    expect(() => new XpbdConstraintSolverN({ dimension: 4 }).solve(
      [unbranched],
      1 / 60
    )).toThrow(/directionHint/);
    new XpbdConstraintSolverN({ dimension: 4, iterations: 1 }).solve([
      new XpbdDistanceConstraintN({
        id: 'branched',
        pointA: coincidentA,
        pointB: coincidentB,
        restLength: 1,
        directionHint: [0, 0, 0, 1]
      })
    ], 1 / 60);
    expect(coincidentA.position.distanceTo(coincidentB.position)).toBeCloseTo(1, 14);
  });

  it('refuses malformed batches and restores positions after runtime failure', () => {
    const a = point([1.5, 0]);
    const b = point([0, 0]);
    const distance = new XpbdDistanceConstraintN({
      id: 'first', pointA: a, pointB: b, restLength: 1
    });
    let evaluations = 0;
    const failing: XpbdScalarConstraintN = {
      id: 'failing',
      dimension: 2,
      points: [a],
      compliance: 0,
      evaluate: () => {
        evaluations++;
        if (evaluations > 1) throw new Error('deliberate evaluator failure');
        return { value: 0, gradients: [new VecN([1, 0])] };
      }
    };
    const beforeA = a.position.toArray();
    const beforeB = b.position.toArray();
    expect(() => new XpbdConstraintSolverN({ dimension: 2, iterations: 1 }).solve(
      [distance, failing],
      0.1
    )).toThrow(/deliberate/);
    expect(a.position.toArray()).toEqual(beforeA);
    expect(b.position.toArray()).toEqual(beforeB);

    expect(() => new XpbdConstraintSolverN({ dimension: 3 }).solve(
      [distance],
      0.1
    )).toThrow(/solver is R3/);
    const repeated: XpbdScalarConstraintN = {
      id: 'repeated',
      dimension: 2,
      points: [a, a],
      compliance: 0,
      evaluate: () => ({ value: 0, gradients: [new VecN(2), new VecN(2)] })
    };
    expect(() => new XpbdConstraintSolverN({ dimension: 2 }).solve(
      [repeated],
      0.1
    )).toThrow(/repeats a point identity/);
    const malformed: XpbdScalarConstraintN = {
      id: 'malformed',
      dimension: 2,
      points: [a],
      compliance: 0,
      evaluate: () => ({ value: Number.NaN, gradients: [new VecN(2)] })
    };
    expect(() => new XpbdConstraintSolverN({ dimension: 2 }).solve(
      [malformed],
      0.1
    )).toThrow(/value must be finite/);
  });
});
