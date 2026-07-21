import { BivectorN, Rotor4, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConstraintBlockSolver4,
  DirectionJoint4,
  RigidBody4,
  constraintRowSpeed4,
  directionConstraintBlock4
} from '../src/index.js';

function body(options: {
  rotation?: Rotor4;
  inertia?: ArrayLike<number>;
  angularMomentum?: ArrayLike<number>;
} = {}): RigidBody4 {
  return new RigidBody4({
    mass: 1,
    inertiaDiagonal: options.inertia ?? new Float64Array(6).fill(1),
    rotation: options.rotation,
    angularMomentumWorld: options.angularMomentum
  });
}

function bivectorDot(left: BivectorN, right: BivectorN): number {
  let dot = 0;
  for (let index = 0; index < 6; index++) {
    dot += left.coeffs[index]! * right.coeffs[index]!;
  }
  return dot;
}

function scale(bivector: BivectorN, factor: number): BivectorN {
  return new BivectorN(4, Array.from(bivector.coeffs, (value) => value * factor));
}

function expectClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance = 1e-11
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(Math.abs(actual[index]! - expected[index]!)).toBeLessThan(tolerance);
  }
}

describe('R4 direction-preservation coordinate', () => {
  it('pins all three angular rows against Rotor4 finite differences', () => {
    const directionA = new VecN([0.72, -0.31, 0.44, 0.43]).normalize();
    const directionB = new VecN([-0.12, 0.81, 0.33, 0.47]).normalize();
    const omega = new BivectorN(4, [0.21, -0.34, 0.17, 0.29, -0.13, 0.26]);
    const evaluation = directionConstraintBlock4({
      id: 'finite-difference',
      participantA: null,
      participantB: null,
      directionA,
      directionB
    });
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    const epsilon = 2e-7;
    const increment = Rotor4.fromBivector(scale(omega, epsilon));
    const perturbedA = increment.applyToPoint(directionA);
    const perturbedB = increment.applyToPoint(directionB);
    for (let row = 0; row < 3; row++) {
      const tangent = evaluation.tangentBasis[row]!;
      const numericA = tangent.dot(perturbedA.clone().sub(directionA)) / epsilon;
      const numericB = -tangent.dot(perturbedB.clone().sub(directionB)) / epsilon;
      expect(numericA).toBeCloseTo(
        bivectorDot(evaluation.block.rows[row]!.jacobianA.angular, omega),
        6
      );
      expect(numericB).toBeCloseTo(
        bivectorDot(evaluation.block.rows[row]!.jacobianB.angular, omega),
        6
      );
    }
  });

  it('annuls randomized full-SO(4) direction speed in one block visit', () => {
    let state = 0x71a9_4c2d;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 100; sample++) {
      const value = body({
        rotation: Rotor4.fromPlanes([
          { i: 0, j: 1, angle: random() * 2 - 1 },
          { i: 0, j: 3, angle: random() * 2 - 1 },
          { i: 1, j: 2, angle: random() * 2 - 1 },
          { i: 2, j: 3, angle: random() * 2 - 1 }
        ]),
        inertia: Float64Array.from({ length: 6 }, () => 0.4 + random() * 3),
        angularMomentum: Float64Array.from({ length: 6 }, () => random() * 4 - 2)
      });
      const joint = new DirectionJoint4({
        id: `random-${sample}`,
        bodyA: value,
        localDirectionA: [1, 0, 0, 0],
        worldDirectionB: [0.31, -0.27, 0.74, 0.52]
      });
      const evaluation = joint.constraint();
      expect(evaluation.status).toBe('regular');
      if (evaluation.status !== 'regular') continue;
      const result = new ConstraintBlockSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      }).solve([evaluation.block], 1 / 120);
      expect(result.blocks[0]!.residualNorm).toBeLessThan(2e-10);
    }
  });

  it('reports the antipodal singularity without manufacturing a frame', () => {
    const aligned = directionConstraintBlock4({
      id: 'aligned',
      participantA: null,
      participantB: null,
      directionA: [1, 0, 0, 0],
      directionB: [1, 0, 0, 0]
    });
    expect(aligned.status).toBe('regular');
    if (aligned.status === 'regular') {
      expectClose(aligned.positionError, [0, 0, 0], 1e-15);
    }
    const antipodal = directionConstraintBlock4({
      id: 'antipodal',
      participantA: null,
      participantB: null,
      directionA: [1, 0, 0, 0],
      directionB: [-1, 0, 0, 0]
    });
    expect(antipodal.status).toBe('antipodal');
    expect(antipodal.antipodalGuard).toBe(0);
  });

  it('leaves the complete SO(3) direction stabilizer free', () => {
    const value = body({ angularMomentum: [0, 0, 0, 0.7, -0.4, 0.9] });
    const joint = new DirectionJoint4({
      id: 'stabilizer',
      bodyA: value,
      localDirectionA: [1, 0, 0, 0],
      worldDirectionB: [1, 0, 0, 0]
    });
    const evaluation = joint.constraint();
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    const before = value.angularMomentumWorld.coeffs.slice();
    const result = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([evaluation.block], 1 / 60);
    expectClose(result.blocks[0]!.initialSpeed, [0, 0, 0], 1e-15);
    expectClose(result.blocks[0]!.accumulatedImpulse, [0, 0, 0], 1e-15);
    expectClose(value.angularMomentumWorld.coeffs, before, 1e-15);
  });

  it('is invariant under an orthogonal change of tangent coordinates', () => {
    const makeBody = (): RigidBody4 => body({
      inertia: [0.7, 1.1, 1.6, 2.2, 2.7, 3.1],
      angularMomentum: [0.8, -0.4, 0.3, 0.2, -0.5, 0.7]
    });
    const a = makeBody();
    const b = makeBody();
    const base = directionConstraintBlock4({
      id: 'basis',
      participantA: a,
      participantB: null,
      directionA: [1, 0, 0, 0],
      directionB: [1, 0, 0, 0]
    });
    expect(base.status).toBe('regular');
    if (base.status !== 'regular') return;
    const inverseSqrt2 = 1 / Math.sqrt(2);
    const rotatedBasis: [VecN, VecN, VecN] = [
      base.tangentBasis[0].clone().add(base.tangentBasis[1]).multiplyScalar(inverseSqrt2),
      base.tangentBasis[1].clone().sub(base.tangentBasis[0]).multiplyScalar(inverseSqrt2),
      base.tangentBasis[2].clone()
    ];
    const rotated = directionConstraintBlock4({
      id: 'basis',
      participantA: b,
      participantB: null,
      directionA: [1, 0, 0, 0],
      directionB: [1, 0, 0, 0],
      previousTangentBasis: rotatedBasis
    });
    expect(rotated.status).toBe('regular');
    if (rotated.status !== 'regular') return;
    const solverOptions = { iterations: 1, baumgarte: 0, warmStart: false } as const;
    new ConstraintBlockSolver4(solverOptions).solve([base.block], 1 / 60);
    new ConstraintBlockSolver4(solverOptions).solve([rotated.block], 1 / 60);
    expectClose(a.angularMomentumWorld.coeffs, b.angularMomentumWorld.coeffs, 2e-11);
  });

  it('projects a warm impulse into a transported tangent basis', () => {
    const initialMomentum = Float64Array.of(0.8, -0.4, 0.3, 0.2, -0.5, 0.7);
    const value = body({
      inertia: [0.7, 1.1, 1.6, 2.2, 2.7, 3.1],
      angularMomentum: initialMomentum
    });
    const base = directionConstraintBlock4({
      id: 'warm-basis',
      participantA: value,
      participantB: null,
      directionA: [1, 0, 0, 0],
      directionB: [1, 0, 0, 0]
    });
    expect(base.status).toBe('regular');
    if (base.status !== 'regular') return;
    const solver = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: true
    });
    const first = solver.solve([base.block], 1 / 60).blocks[0]!;
    expect(Math.hypot(...first.accumulatedImpulse)).toBeGreaterThan(0.1);

    value.angularMomentumWorld.coeffs.set(initialMomentum);
    const inverseSqrt2 = 1 / Math.sqrt(2);
    const transported: [VecN, VecN, VecN] = [
      base.tangentBasis[0].clone().add(base.tangentBasis[1]).multiplyScalar(inverseSqrt2),
      base.tangentBasis[1].clone().sub(base.tangentBasis[0]).multiplyScalar(inverseSqrt2),
      base.tangentBasis[2].clone()
    ];
    const rotated = directionConstraintBlock4({
      id: 'warm-basis',
      participantA: value,
      participantB: null,
      directionA: [1, 0, 0, 0],
      directionB: [1, 0, 0, 0],
      previousTangentBasis: transported
    });
    expect(rotated.status).toBe('regular');
    if (rotated.status !== 'regular') return;
    const second = solver.solve([rotated.block], 1 / 60).blocks[0]!;
    expect(Math.hypot(...second.warmStartedImpulse)).toBeGreaterThan(0.1);
    expect(second.residualNorm).toBeLessThan(1e-12);
  });

  it('conserves pair angular momentum on the constraint manifold', () => {
    const a = body({ angularMomentum: [0.8, -0.4, 0.3, 0.2, -0.5, 0.7] });
    const b = body({ angularMomentum: [-0.1, 0.9, -0.6, 0.4, 0.3, -0.2] });
    const joint = new DirectionJoint4({
      id: 'pair',
      bodyA: a,
      localDirectionA: [1, 0, 0, 0],
      bodyB: b,
      localDirectionB: [1, 0, 0, 0]
    });
    const evaluation = joint.constraint();
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    const before = Float64Array.from(
      a.angularMomentumWorld.coeffs,
      (value, index) => value + b.angularMomentumWorld.coeffs[index]!
    );
    const solved = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([evaluation.block], 1 / 60);
    const after = Float64Array.from(
      a.angularMomentumWorld.coeffs,
      (value, index) => value + b.angularMomentumWorld.coeffs[index]!
    );
    expectClose(after, before, 2e-12);
    expect(solved.blocks[0]!.residualNorm).toBeLessThan(1e-12);
    const power = solved.blocks[0]!.accumulatedImpulse.reduce(
      (sum, impulse, index) => sum + impulse * constraintRowSpeed4(
        evaluation.block.rows[index]!
      ),
      0
    );
    expect(Math.abs(power)).toBeLessThan(1e-12);
  });

  it('keeps the embedded R3 state closed', () => {
    const value = body({
      rotation: Rotor4.fromPlanes([{ i: 0, j: 1, angle: 0.4 }]),
      angularMomentum: [0.6, -0.3, 0, 0.8, 0, 0]
    });
    const joint = new DirectionJoint4({
      id: 'embedded-r3',
      bodyA: value,
      localDirectionA: [1, 0, 0, 0],
      worldDirectionB: [1, 0, 0, 0]
    });
    const evaluation = joint.constraint();
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    const solved = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([evaluation.block], 1 / 60);
    expect(solved.blocks[0]!.effectiveRank).toBe(3);
    for (const [i, j] of [[0, 3], [1, 3], [2, 3]] as const) {
      expect(value.angularMomentumWorld.get(i, j)).toBeCloseTo(0, 13);
    }
  });
});
