import { Rotor4, VecN, wedgeVectors } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConstraintRowSolver4,
  DistanceIntervalJoint4,
  DistanceMotor4,
  PhysicsWorld4,
  RigidBody4
} from '../src/index.js';

function body(options: {
  mass?: number;
  inertia?: ArrayLike<number>;
  position?: ArrayLike<number>;
  rotation?: Rotor4;
  linearVelocity?: ArrayLike<number>;
  angularMomentum?: ArrayLike<number>;
  gravityScale?: number;
} = {}): RigidBody4 {
  return new RigidBody4({
    mass: options.mass ?? 1,
    inertiaDiagonal: options.inertia ?? new Float64Array(6).fill(1),
    position: options.position,
    rotation: options.rotation,
    linearVelocity: options.linearVelocity,
    angularMomentumWorld: options.angularMomentum,
    gravityScale: options.gravityScale ?? 0
  });
}

function totalLinearMomentum(...bodies: RigidBody4[]): Float64Array {
  const total = new Float64Array(4);
  for (const value of bodies) {
    for (let axis = 0; axis < 4; axis++) {
      total[axis]! += value.mass * value.linearVelocity.data[axis]!;
    }
  }
  return total;
}

function totalAngularMomentumAboutOrigin(...bodies: RigidBody4[]): Float64Array {
  const total = new Float64Array(6);
  for (const value of bodies) {
    for (let plane = 0; plane < 6; plane++) {
      total[plane]! += value.angularMomentumWorld.coeffs[plane]!;
    }
    const momentum = value.linearVelocity.clone().multiplyScalar(value.mass);
    const orbital = wedgeVectors(value.position, momentum);
    for (let plane = 0; plane < 6; plane++) {
      total[plane]! += orbital.coeffs[plane]!;
    }
  }
  return total;
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

describe('DistanceIntervalJoint4', () => {
  it('stays inactive in the interior and does not constrain safe motion', () => {
    const value = body({
      position: [2, 0, 0, 0],
      linearVelocity: [0.25, 0, 0, 0]
    });
    const interval = new DistanceIntervalJoint4({
      id: 'free-span',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      minLength: 1,
      maxLength: 3
    });

    const evaluated = interval.interval(0.1);
    expect(evaluated.state).toBe('inactive');
    expect(evaluated.predictedLength).toBeCloseTo(2.025, 14);
    const guards = interval.constraints(0.1);
    expect(guards.map((row) => row.limit)).toEqual(['minimum', 'maximum']);
    new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve(guards, 0.1);
    expectArrayClose(value.linearVelocity.data, [0.25, 0, 0, 0]);
  });

  it('predicts an upper crossing and lands exactly on the boundary', () => {
    const value = body({
      position: [2.9, 0, 0, 0],
      linearVelocity: [1, 0, 0, 0]
    });
    const interval = new DistanceIntervalJoint4({
      id: 'upper-arrival',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      minLength: 1,
      maxLength: 3
    });
    const active = interval.interval(0.2);
    const row = interval.constraints(0.2)
      .find((candidate) => candidate.limit === active.state)!;
    expect(active.state).toBe('maximum');
    expect(active.predictive).toBe(true);
    expect(row.predictive).toBe(true);
    expect(row.velocityTarget).toBeCloseTo(0.5, 14);

    const solved = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([row], 0.2);
    expect(solved.rows[0]!.accumulatedImpulse).toBeCloseTo(-0.5, 14);
    expect(value.linearVelocity.data[0]).toBeCloseTo(0.5, 14);
    expect(value.position.data[0]! + 0.2 * value.linearVelocity.data[0]!)
      .toBeCloseTo(3, 14);
  });

  it('predicts a lower crossing and lands exactly on the boundary', () => {
    const value = body({
      position: [1.1, 0, 0, 0],
      linearVelocity: [-1, 0, 0, 0]
    });
    const interval = new DistanceIntervalJoint4({
      id: 'lower-arrival',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      minLength: 1,
      maxLength: 3
    });
    const active = interval.interval(0.2);
    const row = interval.constraints(0.2)
      .find((candidate) => candidate.limit === active.state)!;
    expect(active.state).toBe('minimum');
    expect(active.predictive).toBe(true);
    expect(row.predictive).toBe(true);
    expect(row.velocityTarget).toBeCloseTo(-0.5, 14);

    const solved = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([row], 0.2);
    expect(solved.rows[0]!.accumulatedImpulse).toBeCloseTo(0.5, 14);
    expect(value.linearVelocity.data[0]).toBeCloseTo(-0.5, 14);
    expect(value.position.data[0]! + 0.2 * value.linearVelocity.data[0]!)
      .toBeCloseTo(1, 14);
  });

  it('uses opposite impulse signs for lower and upper violations', () => {
    for (const [position, state, impulseSign] of [
      [0.8, 'minimum', 1],
      [3.2, 'maximum', -1]
    ] as const) {
      const value = body({ position: [position, 0, 0, 0] });
      const interval = new DistanceIntervalJoint4({
        id: `violation-${state}`,
        bodyA: value,
        localAnchorA: [0, 0, 0, 0],
        worldAnchorB: [0, 0, 0, 0],
        minLength: 1,
        maxLength: 3
      });
      const active = interval.interval(0.1);
      const row = interval.constraints(0.1)
        .find((candidate) => candidate.limit === active.state)!;
      expect(active.state).toBe(state);
      expect(active.predictive).toBe(false);
      expect(row.predictive).toBe(false);
      const solved = new ConstraintRowSolver4({
        iterations: 1,
        baumgarte: 1,
        positionSlop: 0,
        maxBiasSpeed: 10,
        warmStart: false
      }).solve([row], 0.1);
      expect(Math.sign(solved.rows[0]!.accumulatedImpulse)).toBe(impulseSign);
      expect(Math.abs(solved.rows[0]!.projectedResidualSpeed)).toBeLessThan(1e-14);
    }
  });

  it('permits recovery motion at a violated boundary by complementarity', () => {
    for (const [position, speed] of [[0.8, 1], [3.2, -1]] as const) {
      const value = body({
        position: [position, 0, 0, 0],
        linearVelocity: [speed, 0, 0, 0]
      });
      const interval = new DistanceIntervalJoint4({
        id: `recovery-${position}`,
        bodyA: value,
        localAnchorA: [0, 0, 0, 0],
        worldAnchorB: [0, 0, 0, 0],
        minLength: 1,
        maxLength: 3
      });
      const limit = position < 1 ? 'minimum' : 'maximum';
      const row = interval.constraints(0.1)
        .find((candidate) => candidate.limit === limit)!;
      const solved = new ConstraintRowSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      }).solve([row], 0.1);
      expect(solved.rows[0]!.accumulatedImpulse).toBe(0);
      expect(value.linearVelocity.data[0]).toBe(speed);
      expect(Math.abs(solved.rows[0]!.projectedResidualSpeed)).toBeLessThan(1e-14);
    }
  });

  it('keeps two stable guardian IDs and retires both when the policy disappears', () => {
    const value = body({ position: [0.8, 0, 0, 0] });
    const interval = new DistanceIntervalJoint4({
      id: 'travel',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      minLength: 1,
      maxLength: 3
    });
    const solver = new ConstraintRowSolver4({ iterations: 1 });
    const lower = solver.solve(interval.constraints(0.1), 0.1);
    expect(lower.rows.map((row) => row.id)).toEqual([
      'travel:minimum',
      'travel:maximum'
    ]);
    value.position.data[0] = 3.2;
    value.linearVelocity.data.fill(0);
    const upper = solver.solve(interval.constraints(0.1), 0.1);
    expect(upper.rows.map((row) => row.id)).toEqual([
      'travel:minimum',
      'travel:maximum'
    ]);
    expect(upper.retiredIds).toEqual([]);
    expect(solver.solve([], 0.1).retiredIds).toEqual([
      'travel:maximum',
      'travel:minimum'
    ]);
  });

  it('removes a stale minimum warm impulse after returning to the interior', () => {
    const value = body({ position: [0.8, 0, 0, 0] });
    const interval = new DistanceIntervalJoint4({
      id: 'warm-guardians',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      minLength: 1,
      maxLength: 3
    });
    const solver = new ConstraintRowSolver4({
      iterations: 2,
      baumgarte: 1,
      positionSlop: 0
    });
    const violated = solver.solve(interval.constraints(0.1), 0.1);
    expect(violated.rows[0]!.accumulatedImpulse).toBeGreaterThan(0);
    value.position.data[0] = 2;
    value.linearVelocity.data.fill(0);
    const interior = solver.solve(interval.constraints(0.1), 0.1);
    const minimum = interior.rows.find((row) => row.id.endsWith(':minimum'))!;
    expect(minimum.warmStartedImpulse).toBeGreaterThan(0);
    expect(minimum.accumulatedImpulse).toBe(0);
    expect(Math.abs(minimum.projectedResidualSpeed)).toBeLessThan(1e-14);
  });

  it('uses observed motion at zero distance and requires hints for authored directions', () => {
    const outward = body({ linearVelocity: [0, 0, 0, 2] });
    const zeroMinimum = new DistanceIntervalJoint4({
      id: 'zero-minimum',
      bodyA: outward,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      minLength: 0,
      maxLength: 2
    });
    const active = zeroMinimum.interval(0.1);
    expect(active.state).toBe('inactive');
    expect(active.predictive).toBe(false);
    expect(() => zeroMinimum.constraints(0.1)).toThrow(/directionHint/);

    expect(() => new DistanceIntervalJoint4({
      id: 'positive-minimum',
      bodyA: body(),
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      minLength: 1,
      maxLength: 2
    })).toThrow(/directionHint/);
  });

  it('selects the destination bound when one step traverses the full interval', () => {
    for (const [position, speed, expected] of [
      [1, 30, 'maximum'],
      [0.5, 30, 'maximum'],
      [3, -30, 'minimum'],
      [3.5, -30, 'minimum']
    ] as const) {
      const value = body({
        position: [position, 0, 0, 0],
        linearVelocity: [speed, 0, 0, 0]
      });
      const interval = new DistanceIntervalJoint4({
        id: `full-span-${position}`,
        bodyA: value,
        localAnchorA: [0, 0, 0, 0],
        worldAnchorB: [0, 0, 0, 0],
        minLength: 1,
        maxLength: 3
      });
      const active = interval.interval(0.1);
      const row = interval.constraints(0.1)
        .find((candidate) => candidate.limit === active.state)!;
      expect(active.state).toBe(expected);
      expect(active.predictive).toBe(true);
      expect(row.predictive).toBe(true);
      const solved = new ConstraintRowSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      }).solve([row], 0.1);
      const destination = expected === 'maximum' ? 3 : 1;
      expect(position + solved.rows[0]!.finalSpeed * 0.1)
        .toBeCloseTo(destination, 13);
    }
  });

  it('diagnoses singular far-bound motion but requires one authored solve branch', () => {
    const value = body({ linearVelocity: [0, 20, 0, 0] });
    const interval = new DistanceIntervalJoint4({
      id: 'singular-crossing',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      minLength: 0,
      maxLength: 1,
      directionHint: [1, 0, 0, 0]
    });
    const active = interval.interval(0.1);
    expect(active.state).toBe('maximum');
    expect(active.predictive).toBe(true);
    expect(active.distanceSpeed).toBeCloseTo(20, 14);
    expect(() => interval.constraints(0.1)).toThrow(/positive direction branch/);

    const aligned = new DistanceIntervalJoint4({
      id: 'singular-aligned',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      minLength: 0,
      maxLength: 1,
      directionHint: [0, 1, 0, 0]
    });
    const maximum = aligned.constraints(0.1)
      .find((candidate) => candidate.limit === 'maximum')!;
    expectArrayClose(maximum.radialDirection.data, [0, 1, 0, 0]);
    const solved = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([maximum], 0.1);
    expect(solved.rows[0]!.finalSpeed).toBeCloseTo(10, 13);
  });

  it('refuses anti-aligned and transverse solve branches at zero length', () => {
    for (const hint of [[-1, 0, 0, 0], [0, 1, 0, 0]] as const) {
      const value = body({ linearVelocity: [2, 0, 0, 0] });
      const interval = new DistanceIntervalJoint4({
        id: `zero-safe-${hint[0]}-${hint[1]}`,
        bodyA: value,
        localAnchorA: [0, 0, 0, 0],
        worldAnchorB: [0, 0, 0, 0],
        minLength: 0,
        maxLength: 1,
        directionHint: hint
      });
      expect(interval.interval(0.1).state).toBe('inactive');
      expect(() => interval.constraints(0.1)).toThrow(/positive direction branch/);
      expectArrayClose(value.linearVelocity.data, [2, 0, 0, 0]);
    }

    const alignedValue = body({ linearVelocity: [2, 0, 0, 0] });
    const aligned = new DistanceIntervalJoint4({
      id: 'zero-safe-aligned',
      bodyA: alignedValue,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      minLength: 0,
      maxLength: 1,
      directionHint: [1, 0, 0, 0]
    });
    const rows = aligned.constraints(0.1);
    expect(rows[0]!.minForce).toBe(0);
    expect(rows[0]!.maxForce).toBe(0);
    new ConstraintRowSolver4({
      iterations: 2,
      baumgarte: 1,
      positionSlop: 0,
      warmStart: false
    }).solve(rows, 0.1);
    expectArrayClose(alignedValue.linearVelocity.data, [2, 0, 0, 0]);
  });

  it('seeds a coherent construction direction before later coincidence', () => {
    const value = body({ position: [1, 0, 0, 0] });
    const interval = new DistanceIntervalJoint4({
      id: 'seeded',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      minLength: 0.5,
      maxLength: 2
    });
    value.position.data.fill(0);
    const active = interval.interval(0.1);
    const minimum = interval.constraints(0.1)
      .find((candidate) => candidate.limit === 'minimum')!;
    expect(active.state).toBe('minimum');
    expectArrayClose(minimum.radialDirection.data, [1, 0, 0, 0]);
  });
});

describe('DistanceMotor4', () => {
  it('reaches an unsaturated target and defines the speed sign explicitly', () => {
    for (const targetSpeed of [-2, 2]) {
      const value = body({ mass: 2, position: [1, 0, 0, 0] });
      const motor = new DistanceMotor4({
        id: `target-${targetSpeed}`,
        bodyA: value,
        localAnchorA: [0, 0, 0, 0],
        worldAnchorB: [0, 0, 0, 0],
        targetSpeed,
        maxForce: 100
      });
      const solved = new ConstraintRowSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      }).solve([motor.constraint()], 0.1);
      expect(solved.rows[0]!.finalSpeed).toBeCloseTo(targetSpeed, 14);
      expect(value.linearVelocity.data[0]).toBeCloseTo(targetSpeed, 14);
      expect(solved.rows[0]!.impulseState).toBe('within-bounds');
    }
  });

  it('saturates at exactly force times timestep with a valid KKT residual', () => {
    for (const sign of [-1, 1]) {
      const value = body({ position: [1, 0, 0, 0] });
      const motor = new DistanceMotor4({
        id: `saturation-${sign}`,
        bodyA: value,
        localAnchorA: [0, 0, 0, 0],
        worldAnchorB: [0, 0, 0, 0],
        targetSpeed: sign * 10,
        maxForce: 3
      });
      const solved = new ConstraintRowSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      }).solve([motor.constraint()], 0.1);
      const result = solved.rows[0]!;
      expect(result.accumulatedImpulse).toBeCloseTo(sign * 0.3, 14);
      expect(result.impulseState).toBe(sign > 0 ? 'at-maximum' : 'at-minimum');
      expect(Math.abs(result.residualSpeed)).toBeGreaterThan(9);
      expect(Math.abs(result.projectedResidualSpeed)).toBeLessThan(1e-14);
    }
  });

  it('produces timestep-consistent acceleration while force-limited', () => {
    const run = (steps: number, dt: number): number => {
      const value = body({ position: [1, 0, 0, 0] });
      const motor = new DistanceMotor4({
        id: 'timestep',
        bodyA: value,
        localAnchorA: [0, 0, 0, 0],
        worldAnchorB: [0, 0, 0, 0],
        targetSpeed: 100,
        maxForce: 2
      });
      const solver = new ConstraintRowSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      });
      for (let step = 0; step < steps; step++) {
        solver.solve([motor.constraint()], dt);
      }
      return value.linearVelocity.data[0]!;
    };
    expect(run(1, 0.1)).toBeCloseTo(0.2, 14);
    expect(run(2, 0.05)).toBeCloseTo(0.2, 14);
  });

  it('scales and clamps warm impulses, but not across participant replacement', () => {
    const value = body({ position: [1, 0, 0, 0] });
    const motor = new DistanceMotor4({
      id: 'warm-motor',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      targetSpeed: 100,
      maxForce: 4
    });
    const solver = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0
    });
    expect(solver.solve([motor.constraint()], 0.1).rows[0]!
      .accumulatedImpulse).toBeCloseTo(0.4, 14);
    const scaled = solver.solve([motor.constraint()], 0.05).rows[0]!;
    expect(scaled.warmStartedImpulse).toBeCloseTo(0.2, 14);
    expect(scaled.accumulatedImpulse).toBeCloseTo(0.2, 14);

    motor.maxForce = 1;
    const clamped = solver.solve([motor.constraint()], 0.05).rows[0]!;
    expect(clamped.warmStartedImpulse).toBeCloseTo(0.05, 14);
    expect(clamped.accumulatedImpulse).toBeCloseTo(0.05, 14);

    const replacement = body({ position: [1, 0, 0, 0] });
    const replacementMotor = new DistanceMotor4({
      id: 'warm-motor',
      bodyA: replacement,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      targetSpeed: 100,
      maxForce: 1
    });
    const replaced = solver.solve([replacementMotor.constraint()], 0.05)
      .rows[0]!;
    expect(replaced.warmStartedImpulse).toBe(0);
  });

  it('conserves pair momentum while deliberately injecting kinetic energy', () => {
    const a = body({
      mass: 1.7,
      inertia: [0.8, 1.1, 1.4, 1.9, 2.2, 2.8],
      position: [0.8, 0.2, -0.3, 0.7],
      rotation: Rotor4.fromPlanes([
        { i: 0, j: 3, angle: 0.47 },
        { i: 1, j: 2, angle: -0.31 }
      ])
    });
    const b = body({
      mass: 2.3,
      inertia: [1.6, 0.9, 2.1, 1.2, 2.7, 1.5],
      position: [-0.6, -0.4, 0.5, -0.2],
      rotation: Rotor4.fromPlanes([
        { i: 0, j: 2, angle: -0.38 },
        { i: 1, j: 3, angle: 0.29 }
      ])
    });
    const motor = new DistanceMotor4({
      id: 'pair-motor',
      bodyA: a,
      localAnchorA: [0.2, -0.1, 0.3, 0.4],
      bodyB: b,
      localAnchorB: [-0.3, 0.2, -0.1, 0.5],
      targetSpeed: 1.25,
      maxForce: 100
    });
    const linearBefore = totalLinearMomentum(a, b);
    const angularBefore = totalAngularMomentumAboutOrigin(a, b);
    const energyBefore = a.kineticEnergy() + b.kineticEnergy();
    new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([motor.constraint()], 0.1);

    expectArrayClose(totalLinearMomentum(a, b), linearBefore, 12);
    expectArrayClose(totalAngularMomentumAboutOrigin(a, b), angularBefore, 11);
    expect(a.kineticEnergy() + b.kineticEnergy()).toBeGreaterThan(energyBefore);
  });

  it('preserves an embedded R3 subspace exactly', () => {
    const value = body({
      position: [1, 1, 0.4, 0],
      rotation: Rotor4.fromPlanes([
        { i: 0, j: 1, angle: 0.3 },
        { i: 1, j: 2, angle: -0.2 }
      ]),
      linearVelocity: [0.7, -0.2, 0.5, 0],
      angularMomentum: [0.2, -0.3, 0, 0.4, 0, 0]
    });
    const motor = new DistanceMotor4({
      id: 'embedded-r3',
      bodyA: value,
      localAnchorA: [0.2, -0.1, 0.3, 0],
      worldAnchorB: [0, 0, 0, 0],
      targetSpeed: 1,
      maxForce: 10
    });
    new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([motor.constraint()], 0.1);

    expect(Math.abs(value.linearVelocity.data[3]!)).toBeLessThan(1e-14);
    for (const [i, j] of [[0, 3], [1, 3], [2, 3]] as const) {
      expect(Math.abs(value.angularMomentumWorld.get(i, j))).toBeLessThan(1e-14);
    }
  });

  it('composes with an interval whose final projection prevents an outward step', () => {
    const value = body({ position: [3, 0, 0, 0] });
    const shared = {
      bodyA: value,
      localAnchorA: [0, 0, 0, 0] as const,
      worldAnchorB: [0, 0, 0, 0] as const
    };
    const motor = new DistanceMotor4({
      id: 'actuator',
      ...shared,
      targetSpeed: 2,
      maxForce: 10
    });
    const interval = new DistanceIntervalJoint4({
      id: 'travel',
      ...shared,
      minLength: 1,
      maxLength: 3
    });
    const dt = 0.1;
    const solved = new ConstraintRowSolver4({
      iterations: 8,
      baumgarte: 0,
      warmStart: false
    }).solve([motor.constraint(), ...interval.constraints(dt)], dt);

    expect(solved.rows.map((row) => row.id)).toEqual([
      'actuator:motor',
      'travel:minimum',
      'travel:maximum'
    ]);
    expect(Math.abs(value.linearVelocity.data[0]!)).toBeLessThan(1e-14);
    expect(value.position.data[0]! + dt * value.linearVelocity.data[0]!)
      .toBeLessThanOrEqual(3);
    expect(solved.maxProjectedResidualSpeed).toBeLessThan(1e-14);
  });

  it('guards a near-bound interior against velocity created by the motor solve', () => {
    for (const [position, targetSpeed, expectedPosition] of [
      [2.95, 1, 3],
      [1.05, -1, 1]
    ] as const) {
      const value = body({ position: [position, 0, 0, 0] });
      const shared = {
        bodyA: value,
        localAnchorA: [0, 0, 0, 0] as const,
        worldAnchorB: [0, 0, 0, 0] as const
      };
      const motor = new DistanceMotor4({
        id: `near-motor-${position}`,
        ...shared,
        targetSpeed,
        maxForce: 10
      });
      const interval = new DistanceIntervalJoint4({
        id: `near-interval-${position}`,
        ...shared,
        minLength: 1,
        maxLength: 3
      });
      const dt = 0.1;
      const solved = new ConstraintRowSolver4({
        iterations: 8,
        baumgarte: 0,
        warmStart: false
      }).solve([motor.constraint(), ...interval.constraints(dt)], dt);
      expect(position + value.linearVelocity.data[0]! * dt)
        .toBeCloseTo(expectedPosition, 13);
      expect(solved.maxProjectedResidualSpeed).toBeLessThan(1e-13);
    }
  });

  it('guards dangerous current motion even when the motor targets recovery', () => {
    for (const [position, currentSpeed, targetSpeed, boundary] of [
      [1.05, -20, 1, 1],
      [2.95, 20, -1, 3]
    ] as const) {
      const value = body({
        position: [position, 0, 0, 0],
        linearVelocity: [currentSpeed, 0, 0, 0]
      });
      const shared = {
        bodyA: value,
        localAnchorA: [0, 0, 0, 0] as const,
        worldAnchorB: [0, 0, 0, 0] as const
      };
      const motor = new DistanceMotor4({
        id: `recovery-motor-${position}`,
        ...shared,
        targetSpeed,
        maxForce: 10
      });
      const interval = new DistanceIntervalJoint4({
        id: `recovery-interval-${position}`,
        ...shared,
        minLength: 1,
        maxLength: 3
      });
      const dt = 0.1;
      const solved = new ConstraintRowSolver4({
        iterations: 8,
        baumgarte: 0,
        warmStart: false
      }).solve([motor.constraint(), ...interval.constraints(dt)], dt);
      expect(position + value.linearVelocity.data[0]! * dt)
        .toBeCloseTo(boundary, 12);
      expect(solved.maxProjectedResidualSpeed).toBeLessThan(1e-12);
    }
  });

  it('leaves a guardian impulse at zero when the motor is too weak to reach it', () => {
    const value = body({ position: [2.95, 0, 0, 0] });
    const shared = {
      bodyA: value,
      localAnchorA: [0, 0, 0, 0] as const,
      worldAnchorB: [0, 0, 0, 0] as const
    };
    const motor = new DistanceMotor4({
      id: 'weak-motor',
      ...shared,
      targetSpeed: 1,
      maxForce: 0.1
    });
    const interval = new DistanceIntervalJoint4({
      id: 'weak-interval',
      ...shared,
      minLength: 1,
      maxLength: 3
    });
    const solved = new ConstraintRowSolver4({
      iterations: 4,
      baumgarte: 0,
      warmStart: false
    }).solve([motor.constraint(), ...interval.constraints(0.1)], 0.1);
    const maximum = solved.rows.find((row) => row.id.endsWith(':maximum'))!;
    expect(maximum.accumulatedImpulse).toBe(0);
    expect(value.linearVelocity.data[0]).toBeCloseTo(0.01, 14);
  });

  it('runs through the world velocity-constraint seam', () => {
    const value = body({ position: [1, 0, 0, 0] });
    const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(value);
    const motor = new DistanceMotor4({
      id: 'world-motor',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      targetSpeed: 0.5,
      maxForce: 100
    });
    const solver = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    });
    world.step(0.2, 1, (dt) => solver.solve([motor.constraint()], dt));
    expect(value.position.data[0]).toBeCloseTo(1.1, 14);
  });

  it('rejects malformed policies and coincidence without an authored direction', () => {
    const value = body({ position: [1, 0, 0, 0] });
    const shared = {
      id: 'invalid',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0] as const,
      worldAnchorB: [0, 0, 0, 0] as const
    };
    expect(() => new DistanceIntervalJoint4({
      ...shared,
      minLength: -1,
      maxLength: 2
    })).toThrow(/minLength/);
    expect(() => new DistanceIntervalJoint4({
      ...shared,
      minLength: 2,
      maxLength: 2
    })).toThrow(/greater than minLength/);
    expect(() => new DistanceMotor4({
      ...shared,
      targetSpeed: Number.NaN,
      maxForce: 1
    })).toThrow(/targetSpeed/);
    expect(() => new DistanceMotor4({
      ...shared,
      targetSpeed: 1,
      maxForce: -1
    })).toThrow(/maxForce/);
    expect(() => new DistanceMotor4({
      id: 'coincident',
      bodyA: body(),
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      targetSpeed: 1,
      maxForce: 1
    })).toThrow(/directionHint/);
  });
});
