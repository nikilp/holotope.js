import { Rotor4, VecN, wedgeVectors } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConstraintRowSolver4,
  DistanceJoint4,
  PhysicsWorld4,
  RigidBody4,
  evaluateDistanceConstraintN
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

describe('dimension-independent distance geometry', () => {
  it('matches finite-difference gradients in dimensions 2, 3, 4, and 7', () => {
    for (const dim of [2, 3, 4, 7]) {
      const anchorA = new VecN(
        Float64Array.from({ length: dim }, (_, axis) => 0.2 + axis * 0.31)
      );
      const anchorB = new VecN(
        Float64Array.from({ length: dim }, (_, axis) => -0.4 + axis * 0.07)
      );
      const evaluation = evaluateDistanceConstraintN(anchorA, anchorB, 1.7);
      const step = 1e-6;
      for (let axis = 0; axis < dim; axis++) {
        const plus = anchorA.clone();
        const minus = anchorA.clone();
        plus.data[axis]! += step;
        minus.data[axis]! -= step;
        const derivative = (
          evaluateDistanceConstraintN(plus, anchorB, 1.7).distance -
          evaluateDistanceConstraintN(minus, anchorB, 1.7).distance
        ) / (2 * step);
        expect(derivative).toBeCloseTo(evaluation.direction.data[axis]!, 9);
      }
    }
  });

  it('is translation- and embedding-invariant', () => {
    const a3 = new VecN([1.2, -0.7, 0.4]);
    const b3 = new VecN([-0.3, 0.1, 0.8]);
    const base = evaluateDistanceConstraintN(a3, b3, 1.1);
    const shift = new VecN([7, -3, 2]);
    const translated = evaluateDistanceConstraintN(
      a3.clone().add(shift),
      b3.clone().add(shift),
      1.1
    );
    const embedded = evaluateDistanceConstraintN(
      new VecN([...a3.data, 0]),
      new VecN([...b3.data, 0]),
      1.1
    );
    expect(translated.distance).toBeCloseTo(base.distance, 14);
    expect(translated.error).toBeCloseTo(base.error, 14);
    expectArrayClose(embedded.direction.data, [...base.direction.data, 0], 14);
  });

  it('requires an explicit coherent direction at coincident anchors', () => {
    const origin = new VecN(4);
    expect(() => evaluateDistanceConstraintN(origin, origin, 1)).toThrow(
      /directionHint/
    );
    const evaluated = evaluateDistanceConstraintN(
      origin,
      origin,
      1,
      new VecN([0, 0, 0, 3])
    );
    expectArrayClose(evaluated.direction.data, [0, 0, 0, 1]);
    expect(evaluated.error).toBe(-1);
  });

  it('validates an authored direction eagerly away from coincidence', () => {
    const a = new VecN([1, 0, 0, 0]);
    const b = new VecN(4);
    expect(() => evaluateDistanceConstraintN(
      a,
      b,
      1,
      new VecN([1, 0, 0])
    )).toThrow(/match the anchor dimension/);
    expect(() => evaluateDistanceConstraintN(
      a,
      b,
      1,
      new VecN([1, Number.NaN, 0, 0])
    )).toThrow(/finite vector/);
  });
});

describe('DistanceJoint4', () => {
  it('captures the construction distance when restLength is omitted', () => {
    const value = body({ position: [1, 2, 2, 0] });
    const joint = new DistanceJoint4({
      id: 'captured',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0]
    });
    expect(joint.restLength).toBeCloseTo(3, 14);
    expect(joint.constraint().positionError).toBeCloseTo(0, 14);
  });

  it('annuls analytic central separation speed in one scalar solve', () => {
    const a = body({ position: [1, 0, 0, 0], linearVelocity: [1, 0, 0, 0] });
    const b = body({ position: [-1, 0, 0, 0], linearVelocity: [-1, 0, 0, 0] });
    const joint = new DistanceJoint4({
      id: 'central',
      bodyA: a,
      localAnchorA: [0, 0, 0, 0],
      bodyB: b,
      localAnchorB: [0, 0, 0, 0],
      restLength: 2
    });
    const solved = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([joint.constraint()], 1 / 60);

    expect(solved.rows[0]!.response).toBeCloseTo(2, 14);
    expect(solved.rows[0]!.accumulatedImpulse).toBeCloseTo(-1, 14);
    expectArrayClose(a.linearVelocity.data, [0, 0, 0, 0]);
    expectArrayClose(b.linearVelocity.data, [0, 0, 0, 0]);
    expect(Math.abs(solved.rows[0]!.residualSpeed)).toBeLessThan(1e-14);
  });

  it('uses opposite unrestricted impulse signs when stretched and compressed', () => {
    for (const [position, expectedSign] of [[2, -1], [0.5, 1]] as const) {
      const value = body({ position: [position, 0, 0, 0] });
      const joint = new DistanceJoint4({
        id: `signed-${position}`,
        bodyA: value,
        localAnchorA: [0, 0, 0, 0],
        worldAnchorB: [0, 0, 0, 0],
        restLength: 1
      });
      const solved = new ConstraintRowSolver4({
        iterations: 1,
        baumgarte: 1,
        positionSlop: 0,
        maxBiasSpeed: 0.25,
        warmStart: false
      }).solve([joint.constraint()], 1 / 60);
      expect(Math.sign(solved.rows[0]!.accumulatedImpulse)).toBe(expectedSign);
      expect(solved.rows[0]!.finalSpeed).toBeCloseTo(expectedSign * 0.25, 14);
    }
  });

  it('conserves total linear and six-plane angular momentum at separated anchors', () => {
    const a = body({
      mass: 1.7,
      inertia: [0.8, 1.1, 1.4, 1.9, 2.2, 2.8],
      position: [0.8, 0.2, -0.3, 0.7],
      rotation: Rotor4.fromPlanes([
        { i: 0, j: 3, angle: 0.47 },
        { i: 1, j: 2, angle: -0.31 }
      ]),
      linearVelocity: [1, -0.2, 0.4, -0.7],
      angularMomentum: [0.2, -0.4, 0.1, 0.5, -0.3, 0.6]
    });
    const b = body({
      mass: 2.3,
      inertia: [1.6, 0.9, 2.1, 1.2, 2.7, 1.5],
      position: [-0.6, -0.4, 0.5, -0.2],
      rotation: Rotor4.fromPlanes([
        { i: 0, j: 2, angle: -0.38 },
        { i: 1, j: 3, angle: 0.29 }
      ]),
      linearVelocity: [-0.3, 0.8, -0.5, 0.9],
      angularMomentum: [-0.1, 0.3, 0.4, -0.2, 0.7, -0.5]
    });
    const joint = new DistanceJoint4({
      id: 'conservation',
      bodyA: a,
      localAnchorA: [0.2, -0.1, 0.3, 0.4],
      bodyB: b,
      localAnchorB: [-0.3, 0.2, -0.1, 0.5]
    });
    const linearBefore = totalLinearMomentum(a, b);
    const angularBefore = totalAngularMomentumAboutOrigin(a, b);
    new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([joint.constraint()], 1 / 120);

    expectArrayClose(totalLinearMomentum(a, b), linearBefore, 12);
    expectArrayClose(totalAngularMomentumAboutOrigin(a, b), angularBefore, 11);
  });

  it('preserves the embedded R3 subspace exactly', () => {
    const value = body({
      position: [1, 1, 0.4, 0],
      rotation: Rotor4.fromPlanes([
        { i: 0, j: 1, angle: 0.3 },
        { i: 1, j: 2, angle: -0.2 }
      ]),
      linearVelocity: [0.7, -0.2, 0.5, 0],
      angularMomentum: [0.2, -0.3, 0, 0.4, 0, 0]
    });
    const joint = new DistanceJoint4({
      id: 'r3',
      bodyA: value,
      localAnchorA: [0.2, -0.1, 0.3, 0],
      worldAnchorB: [0, 0, 0, 0]
    });
    const solved = new ConstraintRowSolver4({
      iterations: 1,
      baumgarte: 0,
      warmStart: false
    }).solve([joint.constraint()], 1 / 60);

    expect(Math.abs(solved.rows[0]!.residualSpeed)).toBeLessThan(1e-13);
    expect(value.linearVelocity.data[3]).toBeCloseTo(0, 14);
    for (const [i, j] of [[0, 3], [1, 3], [2, 3]] as const) {
      expect(value.angularMomentumWorld.get(i, j)).toBeCloseTo(0, 14);
    }
  });

  it('holds a gravity-driven body on a world tether through the world seam', () => {
    const value = body({ position: [1, 0, 0, 0] });
    const world = new PhysicsWorld4().addBody(value);
    const joint = new DistanceJoint4({
      id: 'tether',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      restLength: 1
    });
    const solver = new ConstraintRowSolver4({
      iterations: 4,
      positionSlop: 0
    });
    let lastResidual = 0;
    for (let step = 0; step < 2400; step++) {
      world.step(1 / 480, 1, (dt) => {
        const solved = solver.solve([joint.constraint()], dt);
        lastResidual = Math.abs(solved.rows[0]!.residualSpeed);
      });
    }
    expect(Math.abs(value.position.length() - 1)).toBeLessThan(1e-4);
    expect(lastResidual).toBeLessThan(1e-12);
  });

  it('retains a direction hint through coincidence and refuses zero length', () => {
    const value = body();
    const joint = new DistanceJoint4({
      id: 'hinted',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0],
      restLength: 1,
      directionHint: [0, 0, 0, 1]
    });
    expectArrayClose(joint.constraint().direction.data, [0, 0, 0, 1]);
    expect(() => new DistanceJoint4({
      id: 'zero',
      bodyA: value,
      localAnchorA: [0, 0, 0, 0],
      worldAnchorB: [0, 0, 0, 0]
    })).toThrow(/PointJoint4/);
  });
});
