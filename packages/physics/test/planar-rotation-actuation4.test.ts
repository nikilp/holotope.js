import { Rotor4, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConstraintBlockSolver4,
  PlanarRotationCoordinate4,
  PlanarRotationIntervalJoint4,
  PlanarRotationJoint4,
  PlanarRotationMotor4,
  RigidBody4,
  constraintRowSpeed4
} from '../src/index.js';

const e0 = VecN.basis(4, 0);
const e1 = VecN.basis(4, 1);
const e2 = VecN.basis(4, 2);
const e3 = VecN.basis(4, 3);

function body(options: {
  rotation?: Rotor4;
  inertia?: ArrayLike<number>;
  momentum?: ArrayLike<number>;
} = {}): RigidBody4 {
  return new RigidBody4({
    mass: 1,
    inertiaDiagonal: options.inertia ?? new Float64Array(6).fill(1),
    rotation: options.rotation,
    angularMomentumWorld: options.momentum,
    gravityScale: 0
  });
}

function fixedCoordinate(
  value: RigidBody4,
  id = 'actuation'
): PlanarRotationCoordinate4 {
  return new PlanarRotationCoordinate4({
    joint: new PlanarRotationJoint4({
      id,
      bodyA: value,
      localFixedFrameA: [e0, e1],
      worldFixedFrameB: [e0, e1]
    }),
    localPhaseDirectionA: e2,
    worldPhaseDirectionB: e2
  });
}

function momentum(value: RigidBody4): number[] {
  return Array.from(value.angularMomentumWorld.coeffs);
}

describe('planar SO(2) motor and interval policies', () => {
  it('drives signed one-body speeds and exposes exact torque saturation', () => {
    for (const targetSpeed of [-1.7, 1.25]) {
      const value = body();
      const motor = new PlanarRotationMotor4({
        coordinate: fixedCoordinate(value, `signed:${targetSpeed}`),
        targetSpeed,
        maxTorque: 100
      });
      const constraint = motor.constraint();
      expect(constraint.status).toBe('regular');
      if (constraint.status !== 'regular') continue;
      const result = new ConstraintBlockSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      }).solve([constraint.block], 0.1).blocks[0]!;
      expect(constraintRowSpeed4(constraint.phaseRow)).toBeCloseTo(targetSpeed, 12);
      expect(result.equalityResidualNorm).toBeLessThan(1e-12);
      expect(result.boundedCoordinate?.impulseState).toBe('within-bounds');
    }

    const saturatedBody = body();
    const saturatedMotor = new PlanarRotationMotor4({
      coordinate: fixedCoordinate(saturatedBody, 'saturated'),
      targetSpeed: 20,
      maxTorque: 0.35
    });
    const saturatedConstraint = saturatedMotor.constraint();
    expect(saturatedConstraint.status).toBe('regular');
    if (saturatedConstraint.status !== 'regular') return;
    const dt = 0.2;
    const saturated = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([saturatedConstraint.block], dt).blocks[0]!;
    expect(saturated.accumulatedImpulse[5]).toBeCloseTo(0.35 * dt, 14);
    expect(saturated.boundedCoordinate?.impulseState).toBe('at-maximum');
    expect(saturated.residualSpeed[5]).not.toBeCloseTo(0, 4);
    expect(saturated.equalityResidualNorm).toBeLessThan(1e-12);
    expect(Math.abs(
      saturated.boundedCoordinate?.projectedResidualSpeed ?? Infinity
    )).toBeLessThan(1e-12);
  });

  it('preserves pair angular momentum while coupling all six coordinates', () => {
    const a = body({
      inertia: [0.7, 1.1, 1.8, 2.4, 3.1, 4.2],
      momentum: [0.3, -0.2, 0.4, 0.15, -0.35, 0.1]
    });
    const b = body({
      inertia: [1.3, 0.9, 2.2, 1.7, 3.8, 2.9],
      momentum: [-0.1, 0.5, -0.25, -0.2, 0.15, -0.4]
    });
    const coordinate = new PlanarRotationCoordinate4({
      joint: new PlanarRotationJoint4({
        id: 'pair',
        bodyA: a,
        localFixedFrameA: [e0, e1],
        bodyB: b,
        localFixedFrameB: [e0, e1]
      }),
      localPhaseDirectionA: e2,
      localPhaseDirectionB: e2
    });
    const motor = new PlanarRotationMotor4({
      coordinate,
      targetSpeed: 0.8,
      maxTorque: 20
    });
    const initial = momentum(a).map((value, index) => value + momentum(b)[index]!);
    const constraint = motor.constraint();
    expect(constraint.status).toBe('regular');
    if (constraint.status !== 'regular') return;
    const result = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([constraint.block], 0.1).blocks[0]!;
    const final = momentum(a).map((value, index) => value + momentum(b)[index]!);
    for (let index = 0; index < 6; index++) {
      expect(final[index]).toBeCloseTo(initial[index]!, 13);
    }
    expect(result.equalityResidualNorm).toBeLessThan(2e-12);
    expect(constraintRowSpeed4(constraint.phaseRow)).toBeCloseTo(0.8, 12);
  });

  it('keeps multi-turn limits attached to the unwrapped branch', () => {
    const value = body({ momentum: [0, 0, 0, 0, 0, 2] });
    const coordinate = fixedCoordinate(value, 'multi-turn');
    for (let step = 0; step <= 8; step++) {
      value.rotation = Rotor4.fromPlanes([{
        i: 2,
        j: 3,
        angle: step * Math.PI / 4
      }]);
      expect(coordinate.evaluation().status).toBe('regular');
    }
    value.rotation = Rotor4.fromPlanes([{
      i: 2,
      j: 3,
      angle: 2 * Math.PI + 0.2
    }]);
    const interval = new PlanarRotationIntervalJoint4({
      coordinate,
      minAngle: 2 * Math.PI - 0.5,
      maxAngle: 2 * Math.PI + 0.5
    });
    const observation = interval.interval(0.2);
    expect(observation.status).toBe('regular');
    if (observation.status === 'regular') {
      expect(observation.angle).toBeCloseTo(2 * Math.PI + 0.2, 11);
      expect(observation.state).toBe('maximum');
      expect(observation.predictive).toBe(true);
    }
    const constraints = interval.constraints(0.2);
    expect(constraints.status).toBe('regular');
    if (constraints.status !== 'regular') return;
    const [minimum, maximum] = constraints.constraints;
    const result = new ConstraintBlockSolver4({
      iterations: 2,
      baumgarte: 0.2,
      warmStart: false
    }).solve([minimum.block, maximum.block], 0.2);
    expect(constraintRowSpeed4(maximum.phaseRow)).toBeCloseTo(1.5, 11);
    expect(result.maxEqualityResidualNorm).toBeLessThan(2e-12);
    expect(result.maxProjectedResidualSpeed).toBeLessThan(2e-12);
    expect(maximum.phaseRow.maxForce).toBe(0);
    expect(minimum.phaseRow.minForce).toBe(0);
  });

  it('lets guardians correct unsafe speed introduced by a motor in the same solve', () => {
    const value = body();
    value.rotation = Rotor4.fromPlanes([{ i: 2, j: 3, angle: 0.25 }]);
    const coordinate = fixedCoordinate(value, 'motor-and-limit');
    const motor = new PlanarRotationMotor4({
      coordinate,
      targetSpeed: 8,
      maxTorque: 100
    });
    const interval = new PlanarRotationIntervalJoint4({
      coordinate,
      minAngle: -0.5,
      maxAngle: 0.5
    });
    const motorConstraint = motor.constraint();
    const intervalConstraints = interval.constraints(0.1);
    expect(motorConstraint.status).toBe('regular');
    expect(intervalConstraints.status).toBe('regular');
    if (
      motorConstraint.status !== 'regular' ||
      intervalConstraints.status !== 'regular'
    ) return;
    const [minimum, maximum] = intervalConstraints.constraints;
    const result = new ConstraintBlockSolver4({
      iterations: 4,
      baumgarte: 0,
      warmStart: false
    }).solve([
      motorConstraint.block,
      minimum.block,
      maximum.block
    ], 0.1);
    expect(constraintRowSpeed4(maximum.phaseRow)).toBeLessThanOrEqual(2.5 + 1e-12);
    expect(constraintRowSpeed4(maximum.phaseRow)).toBeCloseTo(2.5, 11);
    expect(result.maxEqualityResidualNorm).toBeLessThan(2e-12);
    expect(result.maxProjectedResidualSpeed).toBeLessThan(2e-12);
  });

  it('returns branch ambiguity and rejects malformed policies', () => {
    const value = body();
    const coordinate = fixedCoordinate(value, 'typed');
    const motor = new PlanarRotationMotor4({
      coordinate,
      targetSpeed: 1,
      maxTorque: 1
    });
    expect(motor.constraint().status).toBe('regular');
    value.rotation = Rotor4.fromPlanes([{ i: 2, j: 3, angle: Math.PI }]);
    expect(motor.constraint().status).toBe('unwrap-ambiguous');
    expect(() => new PlanarRotationMotor4({
      coordinate,
      targetSpeed: Number.NaN,
      maxTorque: 1
    })).toThrow(/targetSpeed/);
    expect(() => new PlanarRotationMotor4({
      coordinate,
      targetSpeed: 0,
      maxTorque: -1
    })).toThrow(/maxTorque/);
    expect(() => new PlanarRotationIntervalJoint4({
      coordinate,
      minAngle: 1,
      maxAngle: 1
    })).toThrow(/maxAngle/);
    const interval = new PlanarRotationIntervalJoint4({
      coordinate,
      minAngle: -1,
      maxAngle: 1
    });
    expect(() => interval.constraints(0)).toThrow(/dt/);
  });
});
