import { BivectorN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConstraintBlockSolver4,
  RigidBody4,
  type ConstraintRow4
} from '../src/index.js';

function body(angularMomentum: ArrayLike<number> = new Float64Array(6)): RigidBody4 {
  return new RigidBody4({
    mass: 1,
    inertiaDiagonal: new Float64Array(6).fill(1),
    angularMomentumWorld: angularMomentum
  });
}

function angularRow(
  id: string,
  participantA: ConstraintRow4['participantA'],
  participantB: ConstraintRow4['participantB'],
  coefficients: ArrayLike<number>
): ConstraintRow4 {
  return {
    id,
    participantA,
    jacobianA: {
      linear: new VecN(4),
      angular: new BivectorN(4, coefficients)
    },
    participantB,
    jacobianB: {
      linear: new VecN(4),
      angular: new BivectorN(4)
    }
  };
}

describe('small R4 equality blocks', () => {
  it('makes rank loss an explicit policy', () => {
    const rejectBody = body([1, 0, 0, 0, 0, 0]);
    const rejectRows = [
      angularRow('a', rejectBody, null, [1, 0, 0, 0, 0, 0]),
      angularRow('b', rejectBody, null, [1, 0, 0, 0, 0, 0])
    ];
    expect(() => new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([{ id: 'duplicate-coordinate', rows: rejectRows }], 1 / 60))
      .toThrow(/effective rank 1\/2/);

    const minimumNormBody = body([1, 0, 0, 0, 0, 0]);
    const minimumNormRows = [
      angularRow('a', minimumNormBody, null, [1, 0, 0, 0, 0, 0]),
      angularRow('b', minimumNormBody, null, [1, 0, 0, 0, 0, 0])
    ];
    const result = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false,
      rankPolicy: 'minimum-norm'
    }).solve([{ id: 'duplicate-coordinate', rows: minimumNormRows }], 1 / 60);
    expect(result.blocks[0]!.effectiveRank).toBe(1);
    expect(result.blocks[0]!.residualNorm).toBeLessThan(1e-13);
    expect(minimumNormBody.angularMomentumWorld.get(0, 1)).toBeCloseTo(0, 13);
  });

  it('refuses non-equality, inconsistent, static, duplicate, and malformed blocks', () => {
    const a = body();
    const b = body();
    const row = angularRow('row', a, null, [1, 0, 0, 0, 0, 0]);
    const solver = new ConstraintBlockSolver4();
    expect(() => solver.solve([{ id: 'bounded', rows: [{
      ...row,
      maxForce: 1
    }] }], 1 / 60)).toThrow(/bounded rows/);
    expect(() => solver.solve([{ id: 'participants', rows: [
      row,
      angularRow('other', b, null, [0, 1, 0, 0, 0, 0])
    ] }], 1 / 60)).toThrow(/identical participants/);
    expect(() => solver.solve([{ id: 'static', rows: [
      angularRow('static-row', null, null, [1, 0, 0, 0, 0, 0])
    ] }], 1 / 60)).toThrow(/dynamic participant/);
    expect(() => solver.solve([
      { id: 'same', rows: [row] },
      { id: 'same', rows: [row] }
    ], 1 / 60)).toThrow(/duplicate block ID/);
    expect(() => solver.solve([{ id: 'empty', rows: [] }], 1 / 60))
      .toThrow(/one to six/);
    expect(() => solver.solve([{ id: 'valid', rows: [row] }], 0)).toThrow(/dt/);
  });
});
