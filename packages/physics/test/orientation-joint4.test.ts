import { BivectorN, MatN, Rotor4 } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConstraintBlockSolver4,
  OrientationJoint4,
  PhysicsWorld4,
  RigidBody4,
  constraintRowSpeed4,
  orientationConstraintBlock4,
  relativeOrientationCoordinates4
} from '../src/index.js';

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance = 1e-11
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(Math.abs(actual[index]! - expected[index]!)).toBeLessThan(tolerance);
  }
}

function body(options: {
  rotation?: Rotor4;
  inertia?: ArrayLike<number>;
  angularVelocity?: BivectorN;
} = {}): RigidBody4 {
  const result = new RigidBody4({
    mass: 1,
    inertiaDiagonal: options.inertia ?? [0.8, 1.1, 1.7, 2.2, 3.1, 4.3],
    rotation: options.rotation ?? Rotor4.identity(),
    gravityScale: 0
  });
  if (options.angularVelocity) {
    result.setAngularVelocityWorld(options.angularVelocity);
  }
  return result;
}

function basisBivector(index: number, scale = 1): BivectorN {
  const result = new BivectorN(4);
  result.coeffs[index] = scale;
  return result;
}

function totalAngularMomentum(
  bodyA: RigidBody4,
  bodyB: RigidBody4
): Float64Array {
  return Float64Array.from(
    bodyA.angularMomentumWorld.coeffs,
    (value, index) => value + bodyB.angularMomentumWorld.coeffs[index]!
  );
}

describe('fixed-relative-frame orientation coordinates', () => {
  it('matches all A and B world-left finite differences', () => {
    const frameA = Rotor4.fromBivector(
      new BivectorN(4, [0.31, -0.22, 0.17, 0.28, -0.19, 0.11])
    );
    const frameB = Rotor4.fromBivector(
      new BivectorN(4, [-0.18, 0.25, -0.14, 0.09, 0.21, -0.27])
    );
    const evaluation = orientationConstraintBlock4({
      id: 'finite-difference',
      participantA: null,
      participantB: null,
      frameA,
      frameB
    });
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;

    const epsilon = 2e-7;
    for (let column = 0; column < 6; column++) {
      const increment = Rotor4.fromBivector(basisBivector(column, epsilon));
      const perturbedA = relativeOrientationCoordinates4(
        increment.multiply(frameA),
        frameB,
        {
          trivialization: 'body-right',
          previousBranch: evaluation.branch
        }
      );
      const perturbedB = relativeOrientationCoordinates4(
        frameA,
        increment.multiply(frameB),
        {
          trivialization: 'body-right',
          previousBranch: evaluation.branch
        }
      );
      expect(perturbedA.status).toBe('regular');
      expect(perturbedB.status).toBe('regular');
      if (perturbedA.status !== 'regular' || perturbedB.status !== 'regular') {
        continue;
      }
      for (let row = 0; row < 6; row++) {
        const numericA = (
          perturbedA.error.coeffs[row]! - evaluation.error.coeffs[row]!
        ) / epsilon;
        const numericB = (
          perturbedB.error.coeffs[row]! - evaluation.error.coeffs[row]!
        ) / epsilon;
        expect(Math.abs(
          numericA - evaluation.jacobianA.data[row * 6 + column]!
        )).toBeLessThan(5e-7);
        expect(Math.abs(
          numericB - evaluation.jacobianB.data[row * 6 + column]!
        )).toBeLessThan(5e-7);
      }
    }
  });

  it('is globally invariant and reduces to +I/-I at the identity target', () => {
    const identity = orientationConstraintBlock4({
      id: 'identity',
      participantA: null,
      participantB: null,
      frameA: Rotor4.identity(),
      frameB: Rotor4.identity()
    });
    expect(identity.status).toBe('regular');
    if (identity.status !== 'regular') return;
    expectArrayClose(identity.error.coeffs, new Float64Array(6), 1e-15);
    expectArrayClose(identity.jacobianA.data, MatN.identity(6).data, 1e-15);
    expectArrayClose(
      identity.jacobianB.data,
      Array.from(MatN.identity(6).data, (value) => -value),
      1e-15
    );

    const common = Rotor4.fromBivector(
      new BivectorN(4, [0.4, -0.1, 0.3, 0.2, -0.35, 0.18])
    );
    const frameA = Rotor4.fromBivector(
      new BivectorN(4, [0.2, 0.1, -0.15, 0.3, 0.05, -0.1])
    );
    const frameB = Rotor4.fromBivector(
      new BivectorN(4, [-0.1, 0.25, 0.08, -0.2, 0.17, 0.11])
    );
    const original = orientationConstraintBlock4({
      id: 'global-original',
      participantA: null,
      participantB: null,
      frameA,
      frameB
    });
    const rotated = orientationConstraintBlock4({
      id: 'global-rotated',
      participantA: null,
      participantB: null,
      frameA: common.multiply(frameA),
      frameB: common.multiply(frameB)
    });
    expect(original.status).toBe('regular');
    expect(rotated.status).toBe('regular');
    if (original.status !== 'regular' || rotated.status !== 'regular') return;
    expectArrayClose(rotated.error.coeffs, original.error.coeffs, 2e-14);
    expectArrayClose(
      original.jacobianB.data,
      Array.from(original.jacobianA.data, (value) => -value),
      1e-15
    );
  });

  it('returns no block on the full non-central SO(4) cut locus', () => {
    const phiLeft = 0.73;
    const frameA = Rotor4.fromBivector(new BivectorN(4, [
      0, 0, 0, 0, 0, 0
    ]));
    // Construct through the verified pair chart using two commuting planes.
    frameA.left.set([
      Math.sin(phiLeft), 0, 0, Math.cos(phiLeft)
    ]);
    const phiRight = Math.PI - phiLeft;
    frameA.right.set([
      0, Math.sin(phiRight), 0, Math.cos(phiRight)
    ]);
    const result = orientationConstraintBlock4({
      id: 'cut',
      participantA: null,
      participantB: null,
      frameA,
      frameB: Rotor4.identity(),
      cutLocusTolerance: 1e-12
    });
    expect(result.status).toBe('cut-locus');
    expect(result.cutLocusGuard).toBeLessThan(1e-14);
    expect('block' in result).toBe(false);
  });
});

describe('OrientationJoint4 binding and block response', () => {
  it('annihilates coupled anisotropic relative speed and conserves world momentum', () => {
    const bodyA = body({
      rotation: Rotor4.fromBivector(
        new BivectorN(4, [0.2, -0.1, 0.3, 0.15, -0.22, 0.18])
      ),
      inertia: [0.7, 1.2, 1.9, 2.5, 3.4, 4.8],
      angularVelocity: new BivectorN(4, [1.2, -0.7, 0.4, 0.9, -0.5, 0.8])
    });
    const bodyB = body({
      rotation: Rotor4.fromBivector(
        new BivectorN(4, [-0.17, 0.26, -0.12, 0.21, 0.09, -0.31])
      ),
      inertia: [1.1, 1.5, 2.1, 2.8, 3.7, 5.2],
      angularVelocity: new BivectorN(4, [-0.4, 0.8, -0.6, 0.2, 0.7, -0.3])
    });
    const evaluation = orientationConstraintBlock4({
      id: 'pair',
      participantA: bodyA,
      participantB: bodyB,
      frameA: bodyA.rotation,
      frameB: bodyB.rotation
    });
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    const initialSpeed = evaluation.block.rows.map(constraintRowSpeed4);
    expect(Math.hypot(...initialSpeed)).toBeGreaterThan(0.1);
    const momentumBefore = totalAngularMomentum(bodyA, bodyB);
    const solved = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([evaluation.block], 1 / 60);
    expect(solved.blocks[0]!.effectiveRank).toBe(6);
    expect(solved.blocks[0]!.residualNorm).toBeLessThan(2e-10);
    expectArrayClose(totalAngularMomentum(bodyA, bodyB), momentumBefore, 2e-14);
  });

  it('transfers angular momentum only to a dynamic body at a fixed world frame', () => {
    const value = body({
      rotation: Rotor4.fromBivector(
        new BivectorN(4, [0.21, -0.16, 0.08, 0.14, -0.19, 0.11])
      ),
      angularVelocity: new BivectorN(4, [0.7, -0.3, 0.5, 0.2, -0.6, 0.4])
    });
    const worldFrame = Rotor4.fromBivector(
      new BivectorN(4, [-0.12, 0.18, -0.09, 0.23, 0.07, -0.15])
    );
    const joint = new OrientationJoint4({
      id: 'fixed-world',
      bodyA: value,
      worldFrameB: worldFrame
    });
    const targetBefore = joint.worldFrameB();
    const evaluation = joint.constraint();
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    expect(evaluation.block.rows.every((row) => row.participantB === null))
      .toBe(true);
    new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([evaluation.block], 1 / 60);
    expect(Math.hypot(...evaluation.block.rows.map(constraintRowSpeed4)))
      .toBeLessThan(2e-10);
    expectArrayClose(joint.worldFrameB().left, targetBefore.left, 1e-15);
    expectArrayClose(joint.worldFrameB().right, targetBefore.right, 1e-15);
  });

  it('binds authored local frames and preserves explicit branch history', () => {
    const rotationA = Rotor4.fromBivector(
      new BivectorN(4, [0.2, -0.15, 0.08, 0.17, -0.11, 0.13])
    );
    const rotationB = Rotor4.fromBivector(
      new BivectorN(4, [-0.14, 0.12, 0.19, -0.09, 0.16, -0.07])
    );
    const localFrameA = Rotor4.fromBivector(
      new BivectorN(4, [0.1, 0.03, -0.08, 0.06, -0.04, 0.02])
    );
    const localFrameB = rotationB.conjugate()
      .multiply(rotationA)
      .multiply(localFrameA)
      .normalize();
    const bodyA = body({ rotation: rotationA });
    const bodyB = body({ rotation: rotationB });
    const joint = new OrientationJoint4({
      id: 'material-frames',
      bodyA,
      localFrameA,
      bodyB,
      localFrameB
    });
    const equal = joint.constraint();
    expect(equal.status).toBe('regular');
    if (equal.status === 'regular') {
      expect(Math.hypot(...equal.error.coeffs)).toBeLessThan(2e-14);
    }

    const phiLeft = 1.2;
    const below = Rotor4.identity();
    below.left.set([Math.sin(phiLeft), 0, 0, Math.cos(phiLeft)]);
    const belowRight = Math.PI - phiLeft - 0.005;
    below.right.set([0, Math.sin(belowRight), 0, Math.cos(belowRight)]);
    const above = Rotor4.identity();
    above.left.set([Math.sin(phiLeft), 0, 0, Math.cos(phiLeft)]);
    const aboveRight = Math.PI - phiLeft + 0.005;
    above.right.set([0, Math.sin(aboveRight), 0, Math.cos(aboveRight)]);
    const branchBody = body({ rotation: below });
    const branchJoint = new OrientationJoint4({
      id: 'branch',
      bodyA: branchBody,
      worldFrameB: Rotor4.identity(),
      cutLocusTolerance: 1e-12,
      branchHysteresis: 0.02
    });
    expect(branchJoint.constraint().branch.pairSign).toBe(1);
    branchBody.rotation = above;
    const retained = branchJoint.constraint();
    expect(retained.status).toBe('regular');
    expect(retained.branch.pairSign).toBe(1);
    expect(retained.shortestPairSign).toBe(-1);
    branchJoint.resetBranch();
    const switched = branchJoint.constraint();
    expect(switched.status).toBe('regular');
    expect(switched.branch.pairSign).toBe(-1);
  });

  it('keeps an embedded-R3 solve inside its bivector subalgebra', () => {
    const bodyA = body({
      rotation: Rotor4.fromBivector(
        new BivectorN(4, [0.25, -0.18, 0, 0.12, 0, 0])
      ),
      angularVelocity: new BivectorN(4, [0.8, -0.4, 0, 0.5, 0, 0])
    });
    const bodyB = body({
      rotation: Rotor4.fromBivector(
        new BivectorN(4, [-0.12, 0.2, 0, -0.17, 0, 0])
      ),
      angularVelocity: new BivectorN(4, [-0.3, 0.6, 0, -0.2, 0, 0])
    });
    const evaluation = orientationConstraintBlock4({
      id: 'embedded-r3',
      participantA: bodyA,
      participantB: bodyB,
      frameA: bodyA.rotation,
      frameB: bodyB.rotation
    });
    expect(evaluation.status).toBe('regular');
    if (evaluation.status !== 'regular') return;
    for (const index of [2, 4, 5]) {
      expect(Math.abs(constraintRowSpeed4(evaluation.block.rows[index]!)))
        .toBeLessThan(2e-14);
      expect(Math.abs(evaluation.error.coeffs[index]!)).toBeLessThan(2e-14);
    }
    const solved = new ConstraintBlockSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([evaluation.block], 1 / 60);
    for (const index of [2, 4, 5]) {
      expect(Math.abs(solved.blocks[0]!.accumulatedImpulse[index]!))
        .toBeLessThan(2e-12);
    }
    for (const index of [2, 4, 5]) {
      expect(Math.abs(bodyA.angularMomentumWorld.coeffs[index]!)).toBeLessThan(2e-12);
      expect(Math.abs(bodyB.angularMomentumWorld.coeffs[index]!)).toBeLessThan(2e-12);
    }
  });

  it('holds a relative material frame through the world constraint seam', () => {
    const bodyA = body({
      inertia: [0.8, 1.3, 1.9, 2.6, 3.2, 4.1],
      angularVelocity: new BivectorN(4, [0.9, -0.4, 0.6, 0.2, -0.5, 0.7])
    });
    const bodyB = body({
      inertia: [1.1, 1.6, 2.2, 2.9, 3.8, 4.9],
      angularVelocity: new BivectorN(4, [-0.3, 0.7, -0.2, 0.8, 0.4, -0.6])
    });
    const joint = new OrientationJoint4({ id: 'world-seam', bodyA, bodyB });
    const solver = new ConstraintBlockSolver4({
      iterations: 4,
      baumgarte: 0.2,
      positionSlop: 1e-10,
      maxBiasSpeed: 4
    });
    const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] })
      .addBody(bodyA)
      .addBody(bodyB);
    const momentumBefore = totalAngularMomentum(bodyA, bodyB);
    for (let step = 0; step < 400; step++) {
      world.step(1 / 240, 1, (dt) => {
        const evaluation = joint.constraint();
        if (evaluation.status !== 'regular') {
          throw new Error(`unexpected orientation ${evaluation.status}`);
        }
        solver.solve([evaluation.block], dt);
      });
    }
    const final = joint.constraint();
    expect(final.status).toBe('regular');
    if (final.status === 'regular') {
      // This is a split velocity/pose integration seam, so the remaining
      // coordinate error is the timestep discretization error rather than a
      // block-solve residual. Keep it substantially below the joint slop.
      expect(Math.hypot(...final.error.coeffs)).toBeLessThan(5e-6);
    }
    expectArrayClose(totalAngularMomentum(bodyA, bodyB), momentumBefore, 3e-12);
  });

  it('refuses malformed bindings and leaves static-only rank policy explicit', () => {
    const value = body();
    expect(() => new OrientationJoint4({
      id: '',
      bodyA: value,
      worldFrameB: Rotor4.identity()
    })).toThrow(/id/);
    expect(() => new OrientationJoint4({
      id: 'self',
      bodyA: value,
      bodyB: value
    })).toThrow(/itself/);
    expect(() => new OrientationJoint4({
      id: 'bad-tolerance',
      bodyA: value,
      worldFrameB: Rotor4.identity(),
      cutLocusTolerance: -1
    })).toThrow(/non-negative/);
    const invalid = Rotor4.identity();
    invalid.left[3] = 2;
    expect(() => orientationConstraintBlock4({
      id: 'invalid-frame',
      participantA: value,
      participantB: null,
      frameA: invalid,
      frameB: Rotor4.identity()
    })).toThrow(/normalized/);
    const staticOnly = orientationConstraintBlock4({
      id: 'static-only',
      participantA: null,
      participantB: null,
      frameA: Rotor4.identity(),
      frameB: Rotor4.identity()
    });
    expect(staticOnly.status).toBe('regular');
    if (staticOnly.status === 'regular') {
      expect(() => new ConstraintBlockSolver4().solve(
        [staticOnly.block],
        1 / 60
      )).toThrow(/dynamic participant/);
    }
  });
});
