import { BivectorN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConstraintBlockSolver4,
  ConstraintRowSolver4,
  RigidBody4,
  constraintBlockResponseMatrix4,
  constraintRowCoupling4,
  constraintRowSpeed4,
  type ConstraintRow4
} from '../src/index.js';

function body(
  inertia: ArrayLike<number> = new Float64Array(6).fill(1),
  momentum: ArrayLike<number> = new Float64Array(6)
): RigidBody4 {
  return new RigidBody4({
    mass: 1,
    inertiaDiagonal: inertia,
    angularMomentumWorld: momentum,
    gravityScale: 0
  });
}

function angularRow(
  id: string,
  participant: RigidBody4,
  coefficients: ArrayLike<number>,
  options: Pick<
    ConstraintRow4,
    'positionError' | 'velocityTarget' | 'minForce' | 'maxForce'
  > = {}
): ConstraintRow4 {
  return {
    id,
    participantA: participant,
    jacobianA: {
      linear: new VecN(4),
      angular: new BivectorN(4, coefficients)
    },
    participantB: null,
    jacobianB: { linear: new VecN(4), angular: new BivectorN(4) },
    ...options
  };
}

function solveDense(matrix: Float64Array, rhs: Float64Array): Float64Array {
  const n = rhs.length;
  const augmented = Array.from({ length: n }, (_, row) => [
    ...Array.from(matrix.slice(row * n, (row + 1) * n)),
    rhs[row]!
  ]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(augmented[row]![column]!) >
          Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [
      augmented[pivot]!,
      augmented[column]!
    ];
    const scale = augmented[column]![column]!;
    for (let entry = column; entry <= n; entry++) {
      augmented[column]![entry]! /= scale;
    }
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let entry = column; entry <= n; entry++) {
        augmented[row]![entry]! -= factor * augmented[column]![entry]!;
      }
    }
  }
  return Float64Array.from(augmented, (row) => row[n]!);
}

function oracle(
  response: Float64Array,
  requested: Float64Array,
  boundedIndex: number,
  minimum: number,
  maximum: number
): Float64Array {
  const unconstrained = solveDense(response, requested);
  const bounded = Math.max(
    minimum,
    Math.min(maximum, unconstrained[boundedIndex]!)
  );
  if (bounded === unconstrained[boundedIndex]) return unconstrained;
  const equality = Array.from(
    { length: requested.length },
    (_, index) => index
  ).filter((index) => index !== boundedIndex);
  const matrix = new Float64Array(equality.length ** 2);
  const rhs = new Float64Array(equality.length);
  for (let row = 0; row < equality.length; row++) {
    rhs[row] = requested[equality[row]!]! -
      response[equality[row]! * requested.length + boundedIndex]! * bounded;
    for (let column = 0; column < equality.length; column++) {
      matrix[row * equality.length + column] = response[
        equality[row]! * requested.length + equality[column]!
      ]!;
    }
  }
  const solved = solveDense(matrix, rhs);
  const result = new Float64Array(requested.length);
  result[boundedIndex] = bounded;
  for (let index = 0; index < equality.length; index++) {
    result[equality[index]!] = solved[index]!;
  }
  return result;
}

describe('one-bounded R4 constraint blocks', () => {
  it('is differentially identical to the scalar projected solver', () => {
    let seed = 0x6d2b79f5;
    const random = (): number => {
      seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
      return ((seed ^ (seed >>> 14)) >>> 0) / 0x100000000;
    };
    for (let sample = 0; sample < 32; sample++) {
      const inertia = Float64Array.from({ length: 6 }, () => 0.5 + 2 * random());
      const momentum = Float64Array.from({ length: 6 }, () => 2 * random() - 1);
      const coefficients = Float64Array.from({ length: 6 }, () => 2 * random() - 1);
      const dt = 1 / (30 + Math.floor(90 * random()));
      const options = {
        positionError: 0.4 * random() - 0.2,
        velocityTarget: 3 * random() - 1.5,
        minForce: -0.2 - 2 * random(),
        maxForce: 0.2 + 2 * random()
      };
      const scalarBody = body(inertia, momentum);
      const blockBody = body(inertia, momentum);
      const scalarRow = angularRow('row', scalarBody, coefficients, options);
      const blockRow = angularRow('row', blockBody, coefficients, options);
      const solverOptions = {
        iterations: 1,
        baumgarte: 0.31,
        positionSlop: 0.013,
        maxBiasSpeed: 1.7,
        warmStart: false
      } as const;
      const scalar = new ConstraintRowSolver4(solverOptions)
        .solve([scalarRow], dt).rows[0]!;
      const block = new ConstraintBlockSolver4(solverOptions).solve([{
        id: 'block',
        rows: [blockRow],
        projection: { kind: 'one-bounded' }
      }], dt).blocks[0]!;
      expect(block.accumulatedImpulse[0]).toBeCloseTo(
        scalar.accumulatedImpulse,
        12
      );
      expect(block.finalSpeed[0]).toBeCloseTo(scalar.finalSpeed, 12);
      expect(block.biasSpeed[0]).toBeCloseTo(scalar.biasSpeed, 13);
      expect(block.boundedCoordinate?.impulseState).toBe(scalar.impulseState);
      expect(block.boundedCoordinate?.projectedResidualSpeed).toBeCloseTo(
        scalar.projectedResidualSpeed,
        12
      );
    }
  });

  it('matches an independent anisotropic active-set oracle in every state', () => {
    const coefficients = [
      [1, 0.2, 0, 0, 0, 0],
      [0, 1, -0.3, 0, 0, 0],
      [0, 0, 1, 0.4, 0, 0],
      [0.1, 0, 0, 1, -0.2, 0],
      [0, -0.15, 0, 0, 1, 0.25],
      [0.2, 0, 0.1, 0, 0, 1]
    ];
    for (const boundedTarget of [-20, 0.17, 20]) {
      const value = body([0.7, 1.1, 1.6, 2.2, 2.9, 3.7]);
      const rows = coefficients.map((entry, index) => angularRow(
        `row:${index}`,
        value,
        entry,
        {
          velocityTarget: index === 5 ? boundedTarget : (index - 2) * 0.13,
          ...(index === 5 ? { minForce: -1.25, maxForce: 0.9 } : {})
        }
      ));
      const response = constraintBlockResponseMatrix4(rows);
      const requested = Float64Array.from(rows, (row) =>
        (row.velocityTarget ?? 0) - constraintRowSpeed4(row));
      const dt = 0.2;
      const expected = oracle(response, requested, 5, -1.25 * dt, 0.9 * dt);
      const solved = new ConstraintBlockSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      }).solve([{
        id: 'anisotropic',
        rows,
        projection: { kind: 'one-bounded' }
      }], dt).blocks[0]!;
      for (let index = 0; index < 6; index++) {
        expect(solved.accumulatedImpulse[index]).toBeCloseTo(expected[index]!, 11);
      }
      expect(solved.equalityResidualNorm).toBeLessThan(2e-12);
      expect(Math.abs(
        solved.boundedCoordinate?.projectedResidualSpeed ?? Infinity
      )).toBeLessThan(2e-12);
    }
  });

  it('re-solves equality coordinates when a transported warm impulse clamps', () => {
    const value = body([0.8, 1.1, 1.5, 2, 2.7, 3.4]);
    const makeRows = (maxForce: number): ConstraintRow4[] => [
      angularRow('e0', value, [1, 0.3, 0, 0, 0, 0]),
      angularRow('e1', value, [0, 1, 0.2, 0, 0, 0]),
      angularRow('bounded', value, [0.5, 0, 1, 0, 0, 0], {
        velocityTarget: 10,
        minForce: -maxForce,
        maxForce
      })
    ];
    const solver = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: true
    });
    const firstRows = makeRows(10);
    const first = solver.solve([{
      id: 'warm',
      rows: firstRows,
      projection: { kind: 'one-bounded' }
    }], 0.1).blocks[0]!;
    value.angularMomentumWorld.coeffs.fill(0);
    const nextRows = makeRows(0.1);
    const expectedEqualityEffect = new Float64Array(2);
    for (let row = 0; row < 2; row++) {
      for (let previous = 0; previous < firstRows.length; previous++) {
        expectedEqualityEffect[row]! += constraintRowCoupling4(
          nextRows[row]!,
          firstRows[previous]!
        ) * first.accumulatedImpulse[previous]!;
      }
    }
    const result = solver.solve([{
      id: 'warm',
      rows: nextRows,
      projection: { kind: 'one-bounded' }
    }], 0.1).blocks[0]!;
    expect(result.warmStartedImpulse[2]).toBeCloseTo(0.01, 13);
    const warmEqualityEffect = new Float64Array(2);
    const response = result.response;
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 3; column++) {
        warmEqualityEffect[row]! += response[row * 3 + column]! *
          result.warmStartedImpulse[column]!;
      }
    }
    expect(warmEqualityEffect[0]).toBeCloseTo(expectedEqualityEffect[0]!, 12);
    expect(warmEqualityEffect[1]).toBeCloseTo(expectedEqualityEffect[1]!, 12);
    expect(result.equalityResidualNorm).toBeLessThan(1e-12);
  });

  it('is invariant under an orthogonal equality-basis change', () => {
    const inertia = [0.8, 1.1, 1.7, 2.3, 3.2, 4.1];
    const initial = [0.4, -0.2, 0.3, -0.5, 0.25, 0.1];
    const a = body(inertia, initial);
    const b = body(inertia, initial);
    const c0 = [1, 0.2, -0.1, 0, 0, 0];
    const c1 = [0.1, 1, 0.25, 0.2, 0, 0];
    const cb = [0.35, -0.15, 1, 0.1, 0, 0];
    const target0 = 0.42;
    const target1 = -0.31;
    const angle = 0.73;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const combine = (
      left: readonly number[],
      right: readonly number[],
      leftScale: number,
      rightScale: number
    ): number[] => left.map(
      (value, index) => leftScale * value + rightScale * right[index]!
    );
    const original = [
      angularRow('e0', a, c0, { velocityTarget: target0 }),
      angularRow('e1', a, c1, { velocityTarget: target1 }),
      angularRow('b', a, cb, {
        velocityTarget: 6,
        minForce: -0.4,
        maxForce: 0.4
      })
    ];
    const transformed = [
      angularRow('q0', b, combine(c0, c1, cosine, sine), {
        velocityTarget: cosine * target0 + sine * target1
      }),
      angularRow('q1', b, combine(c0, c1, -sine, cosine), {
        velocityTarget: -sine * target0 + cosine * target1
      }),
      angularRow('b', b, cb, {
        velocityTarget: 6,
        minForce: -0.4,
        maxForce: 0.4
      })
    ];
    const solverOptions = {
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    } as const;
    new ConstraintBlockSolver4(solverOptions).solve([{
      id: 'original',
      rows: original,
      projection: { kind: 'one-bounded' }
    }], 0.2);
    new ConstraintBlockSolver4(solverOptions).solve([{
      id: 'transformed',
      rows: transformed,
      projection: { kind: 'one-bounded' }
    }], 0.2);
    for (let index = 0; index < 6; index++) {
      expect(a.angularMomentumWorld.coeffs[index]).toBeCloseTo(
        b.angularMomentumWorld.coeffs[index]!,
        11
      );
    }
  });

  it('requires one valid bounded row and a full-rank reject solve', () => {
    const value = body();
    const free = angularRow('free', value, [1, 0, 0, 0, 0, 0]);
    const bounded = angularRow('bounded', value, [0, 1, 0, 0, 0, 0], {
      maxForce: 1
    });
    const solve = (rows: ConstraintRow4[], rankPolicy?: 'minimum-norm') =>
      new ConstraintBlockSolver4({ rankPolicy }).solve([{
        id: 'invalid',
        rows,
        projection: { kind: 'one-bounded' }
      }], 1 / 60);
    expect(() => solve([free])).toThrow(/exactly one bounded row/);
    expect(() => solve([
      bounded,
      angularRow('also-bounded', value, [0, 0, 1, 0, 0, 0], { minForce: 0 })
    ])).toThrow(/exactly one bounded row/);
    expect(() => solve([bounded], 'minimum-norm')).toThrow(/rankPolicy reject/);
    expect(() => solve([{
      ...bounded,
      minForce: 2,
      maxForce: 1
    }])).toThrow(/force bounds/);
    expect(() => solve([
      bounded,
      angularRow('duplicate-coordinate', value, [0, 1, 0, 0, 0, 0])
    ])).toThrow(/effective rank 1\/2/);
  });
});
