import { BivectorN, Rotor4, VecN, wedgeVectors } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConstraintBlockSolver4,
  PlanarRotationJoint4,
  RigidBody4,
  constraintRowSpeed4,
  planarRotationConstraintBlock4
} from '../src/index.js';

const e0 = VecN.basis(4, 0);
const e1 = VecN.basis(4, 1);
const e2 = VecN.basis(4, 2);
const e3 = VecN.basis(4, 3);

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

function scale(value: BivectorN, factor: number): BivectorN {
  return new BivectorN(4, Array.from(value.coeffs, (entry) => entry * factor));
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

describe('R4 planar-rotation constraint', () => {
  it('pins all five angular rows against frozen-frame Rotor4 finite differences', () => {
    const rotationA = Rotor4.fromPlanes([
      { i: 0, j: 2, angle: 0.37 },
      { i: 1, j: 3, angle: -0.29 }
    ]);
    const rotationB = Rotor4.fromPlanes([
      { i: 0, j: 3, angle: -0.23 },
      { i: 1, j: 2, angle: 0.41 }
    ]);
    const frameA = [
      rotationA.applyToPoint(e0),
      rotationA.applyToPoint(e1)
    ] as const;
    const frameB = [
      rotationB.applyToPoint(e0),
      rotationB.applyToPoint(e1)
    ] as const;
    const omega = new BivectorN(4, [0.21, -0.34, 0.17, 0.29, -0.13, 0.26]);
    const evaluation = planarRotationConstraintBlock4({
      id: 'finite-difference',
      participantA: null,
      participantB: null,
      fixedFrameA: frameA,
      fixedFrameB: frameB
    });
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;

    const epsilon = 2e-7;
    const increment = Rotor4.fromBivector(scale(omega, epsilon));
    const perturbedA0 = increment.applyToPoint(frameA[0]);
    const perturbedA1 = increment.applyToPoint(frameA[1]);
    const perturbedB0 = increment.applyToPoint(frameB[0]);
    const perturbedB1 = increment.applyToPoint(frameB[1]);
    for (let row = 0; row < 5; row++) {
      const directionA = row < 3 ? frameA[0] : frameA[1];
      const directionB = row < 3 ? frameB[0] : frameB[1];
      const perturbedA = row < 3 ? perturbedA0 : perturbedA1;
      const perturbedB = row < 3 ? perturbedB0 : perturbedB1;
      const tangent = row < 3
        ? evaluation.firstTangentBasis[row]!
        : evaluation.complementBasis[row - 3]!;
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

  it('has rank five and leaves exactly the complementary SO(2) generator free', () => {
    const value = body();
    const joint = new PlanarRotationJoint4({
      id: 'stabilizer',
      bodyA: value,
      localFixedFrameA: [e0, e1],
      worldFixedFrameB: [e0, e1]
    });
    const evaluation = joint.constraint();
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    const freeGenerator = wedgeVectors(
      evaluation.complementBasis[0],
      evaluation.complementBasis[1]
    );
    value.angularMomentumWorld.coeffs.set(freeGenerator.coeffs);
    expectClose(
      evaluation.block.rows.map((row) => constraintRowSpeed4(row)),
      [0, 0, 0, 0, 0],
      1e-14
    );
    const result = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([evaluation.block], 1 / 60).blocks[0]!;
    expect(result.effectiveRank).toBe(5);
    expectClose(result.accumulatedImpulse, [0, 0, 0, 0, 0], 1e-14);
    expectClose(value.angularMomentumWorld.coeffs, freeGenerator.coeffs, 1e-14);
  });

  it('annuls randomized anisotropic constrained speed in one block visit', () => {
    let state = 0x4b91_73ed;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 100; sample++) {
      const rotation = Rotor4.fromPlanes([
        { i: 0, j: 1, angle: random() * 1.4 - 0.7 },
        { i: 0, j: 2, angle: random() * 1.4 - 0.7 },
        { i: 1, j: 3, angle: random() * 1.4 - 0.7 },
        { i: 2, j: 3, angle: random() * 1.4 - 0.7 }
      ]);
      const value = body({
        rotation,
        inertia: Float64Array.from({ length: 6 }, () => 0.4 + random() * 3),
        angularMomentum: Float64Array.from({ length: 6 }, () => random() * 4 - 2)
      });
      const joint = new PlanarRotationJoint4({
        id: `random-${sample}`,
        bodyA: value,
        localFixedFrameA: [e0, e1],
        worldFixedFrameB: [e0, e1]
      });
      const evaluation = joint.constraint();
      expect(evaluation.status).toBe('regular');
      if (evaluation.status !== 'regular') continue;
      const result = new ConstraintBlockSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      }).solve([evaluation.block], 1 / 120).blocks[0]!;
      expect(result.effectiveRank).toBe(5);
      expect(result.residualNorm).toBeLessThan(5e-10);
    }
  });

  it('reports both bisector singularities without manufacturing a block', () => {
    const first = planarRotationConstraintBlock4({
      id: 'first-antipodal',
      participantA: null,
      participantB: null,
      fixedFrameA: [e0, e1],
      fixedFrameB: [e0.clone().multiplyScalar(-1), e1]
    });
    expect(first.status).toBe('first-antipodal');
    expect(first.firstAntipodalGuard).toBe(0);

    const second = planarRotationConstraintBlock4({
      id: 'second-degenerate',
      participantA: null,
      participantB: null,
      fixedFrameA: [e0, e1],
      fixedFrameB: [e0, e1.clone().multiplyScalar(-1)]
    });
    expect(second.status).toBe('second-degenerate');
    if (second.status === 'second-degenerate') {
      expect(second.secondBisectorGuard).toBe(0);
    }
  });

  it('transports both coordinate frames continuously', () => {
    const initial = planarRotationConstraintBlock4({
      id: 'transport',
      participantA: null,
      participantB: null,
      fixedFrameA: [e0, e1],
      fixedFrameB: [e0, e1]
    });
    expect(initial.status).toBe('regular');
    if (initial.status !== 'regular') return;
    const delta = Rotor4.fromPlanes([
      { i: 0, j: 2, angle: 2e-4 },
      { i: 1, j: 3, angle: -3e-4 }
    ]);
    const next = planarRotationConstraintBlock4({
      id: 'transport',
      participantA: null,
      participantB: null,
      fixedFrameA: [delta.applyToPoint(e0), delta.applyToPoint(e1)],
      fixedFrameB: [e0, e1],
      previousFirstTangentBasis: initial.firstTangentBasis,
      previousComplementBasis: initial.complementBasis
    });
    expect(next.status).toBe('regular');
    if (next.status !== 'regular') return;
    for (let index = 0; index < 3; index++) {
      expect(next.firstTangentBasis[index]!.dot(initial.firstTangentBasis[index]!))
        .toBeGreaterThan(0.999999);
    }
    for (let index = 0; index < 2; index++) {
      expect(next.complementBasis[index]!.dot(initial.complementBasis[index]!))
        .toBeGreaterThan(0.999999);
    }
  });

  it('is invariant under orthogonal changes of both row-coordinate frames', () => {
    const makeBody = (): RigidBody4 => body({
      inertia: [0.7, 1.1, 1.6, 2.2, 2.7, 3.1],
      angularMomentum: [0.8, -0.4, 0.3, 0.2, -0.5, 0.7]
    });
    const a = makeBody();
    const b = makeBody();
    const base = planarRotationConstraintBlock4({
      id: 'basis',
      participantA: a,
      participantB: null,
      fixedFrameA: [e0, e1],
      fixedFrameB: [e0, e1]
    });
    expect(base.status).toBe('regular');
    if (base.status !== 'regular') return;
    const inverseSqrt2 = 1 / Math.sqrt(2);
    const rotatedFirst = [
      base.firstTangentBasis[0].clone().add(base.firstTangentBasis[1])
        .multiplyScalar(inverseSqrt2),
      base.firstTangentBasis[1].clone().sub(base.firstTangentBasis[0])
        .multiplyScalar(inverseSqrt2),
      base.firstTangentBasis[2].clone()
    ] as const;
    const rotatedComplement = [
      base.complementBasis[0].clone().add(base.complementBasis[1])
        .multiplyScalar(inverseSqrt2),
      base.complementBasis[1].clone().sub(base.complementBasis[0])
        .multiplyScalar(inverseSqrt2)
    ] as const;
    const rotated = planarRotationConstraintBlock4({
      id: 'basis',
      participantA: b,
      participantB: null,
      fixedFrameA: [e0, e1],
      fixedFrameB: [e0, e1],
      previousFirstTangentBasis: rotatedFirst,
      previousComplementBasis: rotatedComplement
    });
    expect(rotated.status).toBe('regular');
    if (rotated.status !== 'regular') return;
    const options = { iterations: 1, baumgarte: 0, warmStart: false } as const;
    new ConstraintBlockSolver4(options).solve([base.block], 1 / 60);
    new ConstraintBlockSolver4(options).solve([rotated.block], 1 / 60);
    expectClose(a.angularMomentumWorld.coeffs, b.angularMomentumWorld.coeffs, 3e-11);
  });

  it('conserves pair momentum on the constraint manifold', () => {
    const a = body({ angularMomentum: [0.8, -0.4, 0.3, 0.2, -0.5, 0.7] });
    const b = body({ angularMomentum: [-0.1, 0.9, -0.6, 0.4, 0.3, -0.2] });
    const joint = new PlanarRotationJoint4({
      id: 'pair',
      bodyA: a,
      localFixedFrameA: [e0, e1],
      bodyB: b,
      localFixedFrameB: [e0, e1]
    });
    const evaluation = joint.constraint();
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    const before = Float64Array.from(
      a.angularMomentumWorld.coeffs,
      (value, index) => value + b.angularMomentumWorld.coeffs[index]!
    );
    const result = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([evaluation.block], 1 / 60).blocks[0]!;
    const after = Float64Array.from(
      a.angularMomentumWorld.coeffs,
      (value, index) => value + b.angularMomentumWorld.coeffs[index]!
    );
    expectClose(after, before, 2e-14);
    expect(result.residualNorm).toBeLessThan(1e-12);
    let power = 0;
    for (let index = 0; index < 5; index++) {
      power += result.accumulatedImpulse[index]! * result.finalSpeed[index]!;
    }
    expect(Math.abs(power)).toBeLessThan(1e-12);
  });

  it('reduces to one in-plane rotational freedom in an embedded R3', () => {
    const value = body({ angularMomentum: wedgeVectors(e0, e1).coeffs });
    const joint = new PlanarRotationJoint4({
      id: 'embedded-r3',
      bodyA: value,
      localFixedFrameA: [e2, e3],
      worldFixedFrameB: [e2, e3]
    });
    const evaluation = joint.constraint();
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    const before = value.angularMomentumWorld.coeffs.slice();
    const result = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([evaluation.block], 1 / 60).blocks[0]!;
    expect(result.effectiveRank).toBe(5);
    expectClose(result.initialSpeed, [0, 0, 0, 0, 0], 1e-14);
    expectClose(value.angularMomentumWorld.coeffs, before, 1e-14);
  });

  it('rejects malformed frames and self-joints without repair', () => {
    expect(() => planarRotationConstraintBlock4({
      id: 'non-unit',
      participantA: null,
      participantB: null,
      fixedFrameA: [[2, 0, 0, 0], e1],
      fixedFrameB: [e0, e1]
    })).toThrow(/orthonormal/);
    expect(() => planarRotationConstraintBlock4({
      id: 'non-orthogonal',
      participantA: null,
      participantB: null,
      fixedFrameA: [e0, new VecN([1, 1, 0, 0]).normalize()],
      fixedFrameB: [e0, e1]
    })).toThrow(/orthonormal/);
    expect(() => planarRotationConstraintBlock4({
      id: 'previous',
      participantA: null,
      participantB: null,
      fixedFrameA: [e0, e1],
      fixedFrameB: [e0, e1],
      previousComplementBasis: [e2]
    })).toThrow(/previousComplementBasis/);
    const value = body();
    expect(() => new PlanarRotationJoint4({
      id: 'self',
      bodyA: value,
      localFixedFrameA: [e0, e1],
      bodyB: value,
      localFixedFrameB: [e0, e1]
    })).toThrow(/itself/);
  });
});
