import { BivectorN, Rotor4, VecN, wedgeVectors } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  PhysicsWorld4,
  PointJoint4,
  PointJointSolver4,
  RigidBody4,
  applyPairPointImpulse4,
  pointJointResponseMatrix4,
  type PointJointConstraint4
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
    gravityScale: options.gravityScale
  });
}

function constraint(
  id: string,
  participantA: PointJointConstraint4['participantA'],
  participantB: PointJointConstraint4['participantB'],
  anchorA: ArrayLike<number>,
  anchorB: ArrayLike<number>
): PointJointConstraint4 {
  return {
    id,
    participantA,
    participantB,
    anchorA: new VecN(anchorA),
    anchorB: new VecN(anchorB)
  };
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
    const linearMomentum = value.linearVelocity.clone().multiplyScalar(value.mass);
    const orbital = wedgeVectors(value.position, linearMomentum);
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

describe('R4 point-joint block response', () => {
  it('solves the analytic four-coordinate central constraint in one pass', () => {
    const a = body({
      mass: 2,
      linearVelocity: [1, 2, 3, 4]
    });
    const b = body({
      mass: 2,
      linearVelocity: [-1, -2, -3, -4]
    });
    const result = new PointJointSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([
      constraint('central', a, b, [0, 0, 0, 0], [0, 0, 0, 0])
    ], 1 / 60);

    const joint = result.joints[0]!;
    expectArrayClose(joint.response, [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
    expectArrayClose(joint.accumulatedImpulse.data, [-2, -4, -6, -8]);
    expectArrayClose(a.linearVelocity.data, [0, 0, 0, 0]);
    expectArrayClose(b.linearVelocity.data, [0, 0, 0, 0]);
    expect(joint.residualVelocity.length()).toBeLessThan(1e-13);
  });

  it('matches finite impulse columns for rotated anisotropic bodies', () => {
    const makePair = (): [RigidBody4, RigidBody4] => [
      body({
        mass: 1.7,
        inertia: [0.8, 1.1, 1.4, 1.9, 2.2, 2.8],
        position: [-0.3, 0.4, -0.2, 0.1],
        rotation: Rotor4.fromPlanes([
          { i: 0, j: 3, angle: 0.47 },
          { i: 1, j: 2, angle: -0.31 }
        ])
      }),
      body({
        mass: 2.3,
        inertia: [1.6, 0.9, 2.1, 1.2, 2.7, 1.5],
        position: [0.5, -0.1, 0.3, -0.4],
        rotation: Rotor4.fromPlanes([
          { i: 0, j: 2, angle: -0.38 },
          { i: 1, j: 3, angle: 0.29 }
        ])
      })
    ];
    const anchorA = new VecN([0.4, 0.2, -0.1, 0.7]);
    const anchorB = new VecN([-0.2, 0.3, 0.6, -0.1]);
    const [referenceA, referenceB] = makePair();
    const reference = constraint(
      'response', referenceA, referenceB, anchorA.data, anchorB.data
    );
    const matrix = pointJointResponseMatrix4(reference);

    for (let column = 0; column < 4; column++) {
      const [a, b] = makePair();
      const probe = constraint('probe', a, b, anchorA.data, anchorB.data);
      const impulse = VecN.basis(4, column);
      applyPairPointImpulse4(probe, impulse);
      const relative = a.velocityAtWorldPoint(anchorA)
        .sub(b.velocityAtWorldPoint(anchorB));
      for (let row = 0; row < 4; row++) {
        expect(relative.data[row]!).toBeCloseTo(matrix[row * 4 + column]!, 12);
      }
    }
  });

  it('annuls randomized full-SO(4) anchor velocity in one block solve', () => {
    let state = 0x4a71_c2e9;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 100; sample++) {
      const makeBody = (): RigidBody4 => body({
        mass: 0.5 + random() * 3,
        inertia: Float64Array.from({ length: 6 }, () => 0.4 + random() * 3),
        position: Float64Array.from({ length: 4 }, () => random() * 2 - 1),
        rotation: Rotor4.fromPlanes([
          { i: 0, j: 1, angle: random() * 2 - 1 },
          { i: 0, j: 3, angle: random() * 2 - 1 },
          { i: 1, j: 2, angle: random() * 2 - 1 },
          { i: 2, j: 3, angle: random() * 2 - 1 }
        ]),
        linearVelocity: Float64Array.from(
          { length: 4 }, () => random() * 4 - 2
        ),
        angularMomentum: Float64Array.from(
          { length: 6 }, () => random() * 2 - 1
        )
      });
      const a = makeBody();
      const b = makeBody();
      const anchorA = Float64Array.from({ length: 4 }, () => random() * 2 - 1);
      const anchorB = Float64Array.from({ length: 4 }, () => random() * 2 - 1);
      const result = new PointJointSolver4({
        iterations: 1,
        baumgarte: 0,
        warmStart: false
      }).solve([
        constraint(`random-${sample}`, a, b, anchorA, anchorB)
      ], 1 / 120);
      expect(result.joints[0]!.residualVelocity.length()).toBeLessThan(2e-11);
    }
  });

  it('couples a hidden-axis lever into the xw angular plane', () => {
    const value = body({ linearVelocity: [1, 0, 0, 0] });
    const anchor = [0, 0, 0, 1];
    const result = new PointJointSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([constraint('hidden-lever', value, null, anchor, anchor)], 1 / 60);

    expect(result.joints[0]!.residualVelocity.length()).toBeLessThan(1e-13);
    expect(Math.abs(value.angularMomentumWorld.get(0, 3))).toBeGreaterThan(0.1);
    expect(Math.abs(result.joints[0]!.accumulatedImpulse.data[0]!)).toBeGreaterThan(0.1);
  });

  it('conserves pair momentum when the two impulse anchors coincide', () => {
    const a = body({
      mass: 1.8,
      inertia: [1, 1.3, 1.7, 2, 2.4, 2.9],
      position: [0, 1, 0, -0.2],
      linearVelocity: [0.4, -1.2, 0.7, 0.3],
      angularMomentum: [0.2, -0.3, 0.1, 0.4, -0.2, 0.5]
    });
    const b = body({
      mass: 2.6,
      inertia: [2.2, 1.9, 1.4, 1.1, 2.7, 1.6],
      position: [0, -1, 0.3, 0.4],
      linearVelocity: [-0.6, 0.5, -0.2, -0.8],
      angularMomentum: [-0.1, 0.2, 0.3, -0.4, 0.6, -0.2]
    });
    const anchor = [0.8, 0.1, -0.4, 0.9];
    const linearBefore = totalLinearMomentum(a, b);
    const angularBefore = totalAngularMomentumAboutOrigin(a, b);
    new PointJointSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([constraint('pair', a, b, anchor, anchor)], 1 / 120);

    expectArrayClose(totalLinearMomentum(a, b), linearBefore, 12);
    expectArrayClose(totalAngularMomentumAboutOrigin(a, b), angularBefore, 11);
  });

  it('preserves the embedded R3 subspace exactly', () => {
    const rotation = Rotor4.fromPlanes([
      { i: 0, j: 1, angle: 0.37 },
      { i: 1, j: 2, angle: -0.21 }
    ]);
    const a = body({
      position: [-0.5, 0.2, 0.3, 0],
      rotation,
      linearVelocity: [1, -0.4, 0.8, 0],
      angularMomentum: [0.3, -0.2, 0, 0.5, 0, 0]
    });
    const b = body({
      position: [0.4, -0.3, 0.1, 0],
      linearVelocity: [-0.2, 0.7, -0.5, 0],
      angularMomentum: [-0.1, 0.4, 0, -0.3, 0, 0]
    });
    const anchor = [0.1, 0.3, -0.2, 0];
    const result = new PointJointSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([constraint('r3', a, b, anchor, anchor)], 1 / 60);

    expect(result.joints[0]!.accumulatedImpulse.data[3]!).toBeCloseTo(0, 14);
    expect(a.linearVelocity.data[3]!).toBeCloseTo(0, 14);
    expect(b.linearVelocity.data[3]!).toBeCloseTo(0, 14);
    for (const [i, j] of [[0, 3], [1, 3], [2, 3]] as const) {
      expect(a.angularMomentumWorld.get(i, j)).toBeCloseTo(0, 14);
      expect(b.angularMomentumWorld.get(i, j)).toBeCloseTo(0, 14);
    }
  });
});

describe('PointJoint4 binding and world seam', () => {
  it('resolves body-local and fixed-world anchors at the current pose', () => {
    const value = body({
      position: [0.4, -0.2, 0.7, 0.1],
      rotation: Rotor4.fromPlanes([{ i: 0, j: 3, angle: Math.PI / 2 }])
    });
    const joint = new PointJoint4({
      id: 'world-pin',
      bodyA: value,
      localAnchorA: [1, 0, 0, 0],
      worldAnchorB: [2, 3, 4, 5]
    });
    expectArrayClose(
      joint.worldAnchorA().data,
      value.rotation.applyToPoint(new VecN([1, 0, 0, 0])).add(value.position).data
    );
    expectArrayClose(joint.worldAnchorB().data, [2, 3, 4, 5]);
  });

  it('holds a body center against gravity through the world callback', () => {
    const value = body();
    const world = new PhysicsWorld4().addBody(value);
    const joint = new PointJoint4({
      id: 'gravity-pin',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0]
    });
    const solver = new PointJointSolver4({ iterations: 1 });
    let lastWarmImpulse = 0;
    for (let step = 0; step < 240; step++) {
      world.step(1 / 120, 1, (dt) => {
        const solved = solver.solve([joint.constraint()], dt);
        lastWarmImpulse = solved.joints[0]!.warmStartedImpulse.length();
      });
    }
    expect(value.position.length()).toBeLessThan(1e-12);
    expect(value.linearVelocity.length()).toBeLessThan(1e-12);
    expect(lastWarmImpulse).toBeGreaterThan(0);
  });

  it('bounds positional bias and retires missing persistent IDs', () => {
    const value = body({ position: [1, 0, 0, 0] });
    const solver = new PointJointSolver4({
      iterations: 1,
      baumgarte: 1,
      positionSlop: 0,
      maxBiasSpeed: 0.25
    });
    const first = solver.solve([
      constraint('biased', value, null, [1, 0, 0, 0], [0, 0, 0, 0])
    ], 0.1);
    expectArrayClose(first.joints[0]!.targetRelativeVelocity.data, [-0.25, 0, 0, 0]);
    expect(first.joints[0]!.finalRelativeVelocity.data[0]!).toBeCloseTo(-0.25, 14);
    expect(solver.solve([], 0.1).retiredIds).toEqual(['biased']);
  });

  it('refuses malformed, duplicate, self, and static-only constraints', () => {
    const value = body();
    const solver = new PointJointSolver4();
    const valid = constraint('valid', value, null, [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(() => solver.solve([valid], 0)).toThrow(/dt/);
    expect(() => solver.solve([valid, valid], 1 / 60)).toThrow(/duplicate/);
    expect(() => solver.solve([
      constraint('self', value, value, [0, 0, 0, 0], [0, 0, 0, 0])
    ], 1 / 60)).toThrow(/itself/);
    expect(() => solver.solve([
      constraint('static', null, null, [0, 0, 0, 0], [0, 0, 0, 0])
    ], 1 / 60)).toThrow(/dynamic participant/);
    expect(() => new PointJoint4({
      id: '',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0]
    })).toThrow(/id/);
    expect(() => new PointJointSolver4({ iterations: 0 })).toThrow(/iterations/);
  });
});
