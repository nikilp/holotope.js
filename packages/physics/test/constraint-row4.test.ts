import { BivectorN, Rotor4, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConstraintRowSolver4,
  RigidBody4,
  applyConstraintRowImpulse4,
  constraintRowCoupling4,
  constraintRowResponse4,
  constraintRowSpeed4,
  pointConstraintRow4,
  type ConstraintRow4
} from '../src/index.js';

function body(options: {
  mass?: number;
  inertia?: ArrayLike<number>;
  position?: ArrayLike<number>;
  rotation?: Rotor4;
  linearVelocity?: ArrayLike<number>;
  angularMomentum?: ArrayLike<number>;
} = {}): RigidBody4 {
  return new RigidBody4({
    mass: options.mass ?? 1,
    inertiaDiagonal: options.inertia ?? new Float64Array(6).fill(1),
    position: options.position,
    rotation: options.rotation,
    linearVelocity: options.linearVelocity,
    angularMomentumWorld: options.angularMomentum
  });
}

function pointRow(
  id: string,
  a: RigidBody4,
  direction: ArrayLike<number>,
  options: { positionError?: number; velocityTarget?: number } = {}
): ConstraintRow4 {
  return pointConstraintRow4({
    id,
    participantA: a,
    participantB: null,
    anchorA: a.position,
    anchorB: a.position,
    direction,
    ...options
  });
}

describe('R4 scalar constraint rows', () => {
  it('solves an analytic translational equality in one unrestricted update', () => {
    const value = body({ mass: 2, linearVelocity: [3, 0, 0, 0] });
    const solved = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([pointRow('translation', value, [1, 0, 0, 0])], 1 / 60);

    expect(solved.rows[0]!.response).toBeCloseTo(0.5, 14);
    expect(solved.rows[0]!.effectiveMass).toBeCloseTo(2, 14);
    expect(solved.rows[0]!.accumulatedImpulse).toBeCloseTo(-6, 14);
    expect(value.linearVelocity.length()).toBeLessThan(1e-14);
    expect(Math.abs(solved.rows[0]!.residualSpeed)).toBeLessThan(1e-14);
    expect(solved.rows[0]!.projectedResidualSpeed)
      .toBeCloseTo(solved.rows[0]!.residualSpeed, 14);
  });

  it('supports a pure six-plane angular row without a point-joint fiction', () => {
    const value = body({
      inertia: [1, 1, 2, 1, 1, 1],
      angularMomentum: [0, 0, 2, 0, 0, 0]
    });
    const row: ConstraintRow4 = {
      id: 'xw-motor',
      participantA: value,
      jacobianA: {
        linear: new VecN(4),
        angular: new BivectorN(4, [0, 0, 1, 0, 0, 0])
      },
      participantB: null,
      jacobianB: {
        linear: new VecN(4),
        angular: new BivectorN(4)
      },
      velocityTarget: -0.5
    };
    const solved = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([row], 1 / 60);

    expect(solved.rows[0]!.response).toBeCloseTo(0.5, 14);
    expect(solved.rows[0]!.accumulatedImpulse).toBeCloseTo(-3, 14);
    expect(value.angularVelocityWorld().get(0, 3)).toBeCloseTo(-0.5, 13);
    expect(Math.abs(solved.rows[0]!.residualSpeed)).toBeLessThan(1e-13);
  });

  it('responds to prescribed motion without mutating the kinematic side', () => {
    const value = body();
    const prescribed = {
      center: new VecN(4),
      linearVelocity: new VecN([1, 0, 0, 0]),
      angularVelocityWorld: new BivectorN(4)
    };
    const row = pointConstraintRow4({
      id: 'kinematic-driver',
      participantA: value,
      participantB: prescribed,
      anchorA: new VecN(4),
      anchorB: new VecN(4),
      direction: [1, 0, 0, 0]
    });
    const solved = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([row], 1 / 60);

    expect(value.linearVelocity.data[0]).toBeCloseTo(1, 14);
    expect(prescribed.linearVelocity.data[0]).toBe(1);
    expect(Math.abs(solved.rows[0]!.residualSpeed)).toBeLessThan(1e-14);
  });

  it('matches finite impulse response for full-SO(4) anisotropic point rows', () => {
    let state = 0x517a_91d3;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 100; sample++) {
      const a = body({
        mass: 0.4 + random() * 3,
        inertia: Float64Array.from({ length: 6 }, () => 0.3 + random() * 3),
        position: Float64Array.from({ length: 4 }, () => random() * 2 - 1),
        rotation: Rotor4.fromPlanes([
          { i: 0, j: 1, angle: random() * 2 - 1 },
          { i: 0, j: 3, angle: random() * 2 - 1 },
          { i: 1, j: 2, angle: random() * 2 - 1 },
          { i: 2, j: 3, angle: random() * 2 - 1 }
        ]),
        linearVelocity: Float64Array.from({ length: 4 }, () => random() * 4 - 2),
        angularMomentum: Float64Array.from({ length: 6 }, () => random() * 2 - 1)
      });
      const b = body({
        mass: 0.4 + random() * 3,
        inertia: Float64Array.from({ length: 6 }, () => 0.3 + random() * 3),
        position: Float64Array.from({ length: 4 }, () => random() * 2 - 1),
        rotation: Rotor4.fromPlanes([
          { i: 0, j: 2, angle: random() * 2 - 1 },
          { i: 1, j: 3, angle: random() * 2 - 1 }
        ]),
        linearVelocity: Float64Array.from({ length: 4 }, () => random() * 4 - 2),
        angularMomentum: Float64Array.from({ length: 6 }, () => random() * 2 - 1)
      });
      const row = pointConstraintRow4({
        id: `random-${sample}`,
        participantA: a,
        participantB: b,
        anchorA: Float64Array.from({ length: 4 }, () => random() * 2 - 1),
        anchorB: Float64Array.from({ length: 4 }, () => random() * 2 - 1),
        direction: Float64Array.from({ length: 4 }, () => random() * 2 - 1)
      });
      const before = constraintRowSpeed4(row);
      const response = constraintRowResponse4(row);
      const probeImpulse = 1e-6;
      applyConstraintRowImpulse4(row, probeImpulse);
      const finiteResponse = (constraintRowSpeed4(row) - before) / probeImpulse;
      expect(finiteResponse).toBeCloseTo(response, 8);

      const solved = new ConstraintRowSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      }).solve([row], 1 / 120);
      expect(Math.abs(solved.rows[0]!.residualSpeed)).toBeLessThan(2e-11);
    }
  });

  it('applies signed symmetric bias with slop and a speed bound', () => {
    for (const error of [-2, 2]) {
      const value = body();
      const solved = new ConstraintRowSolver4({
        iterations: 1,
        baumgarte: 1,
        positionSlop: 0.25,
        maxBiasSpeed: 0.5,
        warmStart: false
      }).solve([
        pointRow(`bias-${error}`, value, [1, 0, 0, 0], {
          positionError: error
        })
      ], 1 / 60);
      expect(solved.rows[0]!.biasSpeed).toBe(-Math.sign(error) * 0.5);
      expect(solved.rows[0]!.finalSpeed).toBeCloseTo(-Math.sign(error) * 0.5, 14);
    }
    const insideSlop = new ConstraintRowSolver4({
      iterations: 1,
      positionSlop: 0.25,
      warmStart: false
    }).solve([
      pointRow('slop', body(), [1, 0, 0, 0], { positionError: 0.2 })
    ], 1 / 60);
    expect(insideSlop.rows[0]!.biasSpeed).toBe(0);
  });

  it('reports a signed projected residual after a coupled row is disturbed', () => {
    const value = body({ linearVelocity: [1, 1, 0, 0] });
    const rows = [
      pointConstraintRow4({
        id: 'coupled-x',
        participantA: value,
        participantB: null,
        anchorA: value.position,
        anchorB: value.position,
        direction: [1, 0, 0, 0]
      }),
      pointConstraintRow4({
        id: 'coupled-diagonal',
        participantA: value,
        participantB: null,
        anchorA: value.position,
        anchorB: value.position,
        direction: [1, 1, 0, 0]
      })
    ];
    const solved = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve(rows, 1 / 60);
    expect(Math.abs(solved.rows[0]!.residualSpeed)).toBeGreaterThan(0.1);
    expect(solved.rows[0]!.projectedResidualSpeed)
      .toBeCloseTo(solved.rows[0]!.residualSpeed, 14);
  });

  it('projects warm impulses across a coherent row sign change and retires IDs', () => {
    const value = body({ linearVelocity: [1, 0, 0, 0] });
    const solver = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0
    });
    const first = solver.solve([
      pointRow('coherent', value, [1, 0, 0, 0])
    ], 1 / 60);
    expect(first.rows[0]!.accumulatedImpulse).toBeCloseTo(-1, 14);
    value.linearVelocity.data[0] = 1;
    const flipped = solver.solve([
      pointRow('coherent', value, [-1, 0, 0, 0])
    ], 1 / 30);
    expect(flipped.rows[0]!.warmStartedImpulse).toBeCloseTo(2, 14);
    expect(Math.abs(flipped.rows[0]!.residualSpeed)).toBeLessThan(1e-14);
    expect(solver.solve([], 1 / 30).retiredIds).toEqual(['coherent']);
  });

  it('projects changing warm rows in the rigid-body mass metric', () => {
    const value = body({
      inertia: [0.4, 0.7, 1.3, 2.1, 3.4, 5.5],
      rotation: Rotor4.fromPlanes([
        { i: 0, j: 3, angle: 0.43 },
        { i: 1, j: 2, angle: -0.27 }
      ]),
      linearVelocity: [1.2, -0.4, 0.7, 0.2]
    });
    const solver = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0
    });
    const oldRow = pointConstraintRow4({
      id: 'mass-metric',
      participantA: value,
      participantB: null,
      anchorA: [0.2, -0.3, 0.4, 0.9],
      anchorB: [0, 0, 0, 0],
      direction: [1, 0.2, -0.1, 0.3]
    });
    const first = solver.solve([oldRow], 1 / 120);
    const oldImpulse = first.rows[0]!.accumulatedImpulse;
    value.linearVelocity.data.fill(0);
    value.angularMomentumWorld.coeffs.fill(0);
    const newRow = pointConstraintRow4({
      id: 'mass-metric',
      participantA: value,
      participantB: null,
      anchorA: [-0.4, 0.7, 0.1, 0.5],
      anchorB: [0, 0, 0, 0],
      direction: [0.3, -0.6, 0.5, 0.8]
    });
    const expected = oldImpulse *
      constraintRowCoupling4(newRow, oldRow) /
      constraintRowResponse4(newRow) * 2;
    const second = solver.solve([newRow], 1 / 60);
    expect(second.rows[0]!.warmStartedImpulse).toBeCloseTo(expected, 13);
    expect(Math.abs(second.rows[0]!.residualSpeed)).toBeLessThan(1e-13);
  });

  it('converts force bounds to timestep-scaled impulse saturation', () => {
    for (const sign of [-1, 1]) {
      const value = body();
      const row = pointConstraintRow4({
        id: `bounded-${sign}`,
        participantA: value,
        participantB: null,
        anchorA: value.position,
        anchorB: value.position,
        direction: [1, 0, 0, 0],
        velocityTarget: sign * 10,
        minForce: -3,
        maxForce: 3
      });
      const solved = new ConstraintRowSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      }).solve([row], 0.1);
      const result = solved.rows[0]!;
      expect(result.accumulatedImpulse).toBeCloseTo(sign * 0.3, 14);
      expect(result.impulseState).toBe(sign > 0 ? 'at-maximum' : 'at-minimum');
      expect(Math.abs(result.residualSpeed)).toBeGreaterThan(9);
      expect(Math.abs(result.projectedResidualSpeed)).toBeLessThan(1e-14);
      expect(solved.maxProjectedResidualSpeed).toBeLessThan(1e-14);
    }
  });

  it('enforces one-sided complementarity and clamps inadmissible warm starts', () => {
    const value = body({ linearVelocity: [-1, 0, 0, 0] });
    const solver = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0
    });
    const positiveOnly = (direction: ArrayLike<number>) => pointConstraintRow4({
      id: 'one-sided',
      participantA: value,
      participantB: null,
      anchorA: value.position,
      anchorB: value.position,
      direction,
      minForce: 0
    });
    const first = solver.solve([positiveOnly([1, 0, 0, 0])], 1 / 60);
    expect(first.rows[0]!.accumulatedImpulse).toBeCloseTo(1, 14);
    value.linearVelocity.data.fill(0);
    const flipped = solver.solve([positiveOnly([-1, 0, 0, 0])], 1 / 60);
    expect(flipped.rows[0]!.warmStartedImpulse).toBe(0);
    expect(flipped.rows[0]!.accumulatedImpulse).toBe(0);
    expect(flipped.rows[0]!.impulseState).toBe('at-minimum');

    value.linearVelocity.data[0] = 1;
    const allowed = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([positiveOnly([1, 0, 0, 0])], 1 / 60);
    expect(allowed.rows[0]!.accumulatedImpulse).toBe(0);
    expect(value.linearVelocity.data[0]).toBe(1);
    expect(Math.abs(allowed.rows[0]!.projectedResidualSpeed)).toBeLessThan(1e-14);
  });

  it('accepts a fixed zero-force row and rejects malformed force intervals', () => {
    const value = body({ linearVelocity: [1, 0, 0, 0] });
    const fixed = pointConstraintRow4({
      id: 'fixed',
      participantA: value,
      participantB: null,
      anchorA: value.position,
      anchorB: value.position,
      direction: [1, 0, 0, 0],
      minForce: 0,
      maxForce: 0
    });
    const fixedResult = new ConstraintRowSolver4({ iterations: 1 }).solve(
      [fixed],
      1 / 60
    );
    expect(fixedResult.rows[0]!.impulseState).toBe('fixed');
    expect(value.linearVelocity.data[0]).toBe(1);

    for (const [minimum, maximum] of [
      [2, 1],
      [Infinity, Infinity],
      [-Infinity, -Infinity],
      [Number.NaN, 1]
    ]) {
      const malformed = { ...fixed, minForce: minimum, maxForce: maximum };
      expect(() => new ConstraintRowSolver4().solve(
        [malformed],
        1 / 60
      )).toThrow(/force bounds/);
    }
  });

  it('refuses duplicate, self, static-only, and malformed rows', () => {
    const value = body();
    const solver = new ConstraintRowSolver4();
    const row = pointRow('one', value, [1, 0, 0, 0]);
    expect(() => solver.solve([row, row], 1 / 60)).toThrow(/duplicate/);
    expect(() => solver.solve([
      pointConstraintRow4({
        id: 'self',
        participantA: value,
        participantB: value,
        anchorA: value.position,
        anchorB: value.position,
        direction: [1, 0, 0, 0]
      })
    ], 1 / 60)).toThrow(/itself/);
    expect(() => solver.solve([
      pointConstraintRow4({
        id: 'static',
        participantA: null,
        participantB: null,
        anchorA: new VecN(4),
        anchorB: new VecN(4),
        direction: [1, 0, 0, 0]
      })
    ], 1 / 60)).toThrow(/dynamic participant/);
    expect(() => pointConstraintRow4({
      id: 'bad-direction',
      participantA: value,
      participantB: null,
      anchorA: value.position,
      anchorB: value.position,
      direction: [0, 0, 0, 0]
    })).toThrow(/nonzero/);
  });
});
