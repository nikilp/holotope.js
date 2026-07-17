import { BivectorN, Rotor4, TransformN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperboxSupportShape4,
  NormalContactSolver4,
  PhysicsWorld4,
  RigidBody4,
  hyperboxContactPatch4,
  normalContactConstraintsFromHyperboxPatch4,
  type NormalContactConstraint4,
  type RigidMotion4
} from '../src/index.js';

function body(
  position: ArrayLike<number>,
  velocity: ArrayLike<number>,
  mass = 1,
  inertia = 1
): RigidBody4 {
  return new RigidBody4({
    mass,
    inertiaDiagonal: new Float64Array(6).fill(inertia),
    position,
    linearVelocity: velocity
  });
}

function contact(
  id: string,
  participantA: RigidBody4 | RigidMotion4 | null,
  participantB: RigidBody4 | RigidMotion4 | null,
  normal: ArrayLike<number>,
  anchorA: ArrayLike<number>,
  anchorB: ArrayLike<number>,
  options: { restitution?: number; penetrationDepth?: number } = {}
): NormalContactConstraint4 {
  return {
    id,
    participantA,
    participantB,
    normal: new VecN(normal),
    anchorA: new VecN(anchorA),
    anchorB: new VecN(anchorB),
    ...(options.restitution === undefined ? {} : { restitution: options.restitution }),
    ...(options.penetrationDepth === undefined
      ? {}
      : { penetrationDepth: options.penetrationDepth })
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
    total.set(
      total.map(
        (entry, index) => entry + value.angularMomentumWorld.coeffs[index]!
      )
    );
    const linearMomentum = value.linearVelocity.clone().multiplyScalar(value.mass);
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const index = BivectorN.planeIndex(4, i, j);
        total[index]! +=
          value.position.data[i]! * linearMomentum.data[j]! -
          value.position.data[j]! * linearMomentum.data[i]!;
      }
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

describe('RigidBody4 impulses', () => {
  it('applies linear and exterior-product angular impulse at a world point', () => {
    const value = body([0, 0, 0, 0], [0, 0, 0, 0], 2, 4);
    value.applyImpulseAtWorldPoint([0, 2, 0, 0], [3, 0, 0, 0]);
    expectArrayClose(value.linearVelocity.data, [0, 1, 0, 0]);
    expectArrayClose(value.angularMomentumWorld.coeffs, [6, 0, 0, 0, 0, 0]);
    expectArrayClose(
      value.inverseInertiaWorld(value.angularMomentumWorld).coeffs,
      [1.5, 0, 0, 0, 0, 0]
    );
  });
});

describe('normal-only R4 sequential impulses', () => {
  it('matches Newton restitution for equal-mass central impacts', () => {
    for (const restitution of [0, 0.25, 0.5, 1]) {
      const a = body([0, 0, 0, 0], [1, 0, 0, 0]);
      const b = body([2, 0, 0, 0], [-1, 0, 0, 0]);
      const initialEnergy = a.kineticEnergy() + b.kineticEnergy();
      const result = new NormalContactSolver4({
        iterations: 1,
        restitutionThreshold: 0,
        baumgarte: 0
      }).solve([
        contact('pair', a, b, [-1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], {
          restitution
        })
      ], 1 / 60);

      expect(a.linearVelocity.data[0]!).toBeCloseTo(-restitution, 13);
      expect(b.linearVelocity.data[0]!).toBeCloseTo(restitution, 13);
      expect(result.points[0]!.finalNormalSpeed).toBeCloseTo(2 * restitution, 13);
      expect((a.kineticEnergy() + b.kineticEnergy()) / initialEnergy)
        .toBeCloseTo(restitution * restitution, 13);
    }
  });

  it('conserves total linear and angular momentum for off-center body pairs', () => {
    const a = body([0, 1, 0, 0], [0, -2, 0.5, 0], 2, 3);
    const b = body([0, -1, 0, 0], [0, 0.5, -0.25, 0], 3, 5);
    const anchorA = [1, 0.1, 0, 0];
    const anchorB = [1, 0, 0, 0]; // witness separation is parallel to the normal
    const linearBefore = totalLinearMomentum(a, b);
    const angularBefore = totalAngularMomentumAboutOrigin(a, b);
    new NormalContactSolver4({
      iterations: 1,
      restitutionThreshold: 0,
      baumgarte: 0
    }).solve([
      contact('off-center-pair', a, b, [0, 1, 0, 0], anchorA, anchorB, {
        restitution: 0.6
      })
    ], 1 / 120);
    expectArrayClose(totalLinearMomentum(a, b), linearBefore, 11);
    expectArrayClose(totalAngularMomentumAboutOrigin(a, b), angularBefore, 11);
  });

  it('includes rotational response in effective mass', () => {
    const value = body([0, 0, 0, 0], [0, -1, 3, 0]);
    const result = new NormalContactSolver4({
      iterations: 1,
      restitutionThreshold: 0,
      baumgarte: 0
    }).solve([
      contact('off-center-wall', value, null, [0, 1, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0])
    ], 1 / 60);
    const point = result.points[0]!;
    expect(point.effectiveMass).toBeCloseTo(0.5, 14);
    expect(point.accumulatedImpulse).toBeCloseTo(0.5, 14);
    expect(point.finalNormalSpeed).toBeCloseTo(0, 14);
    expect(value.angularMomentumWorld.get(0, 1)).toBeCloseTo(0.5, 14);
    // Normal-only means no impulse is applied to the independent tangent speed.
    expect(value.linearVelocity.data[2]!).toBe(3);
  });

  it('differentially matches rotated anisotropic point response', () => {
    let state = 0x51a7c0de;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 100; sample++) {
      const position = Float64Array.from({ length: 4 }, () => random() * 2 - 1);
      const normal = new VecN(
        Float64Array.from({ length: 4 }, () => random() * 2 - 1)
      ).normalize();
      const lever = new VecN(
        Float64Array.from({ length: 4 }, () => random() * 1.5 - 0.75)
      );
      const rotation = Rotor4.fromPlanes([
        { i: 0, j: 1, angle: random() * 2 - 1 },
        { i: 0, j: 2, angle: random() * 2 - 1 },
        { i: 0, j: 3, angle: random() * 2 - 1 },
        { i: 1, j: 2, angle: random() * 2 - 1 },
        { i: 1, j: 3, angle: random() * 2 - 1 },
        { i: 2, j: 3, angle: random() * 2 - 1 }
      ]);
      const value = new RigidBody4({
        mass: 0.5 + random() * 3,
        inertiaDiagonal: Float64Array.from(
          { length: 6 },
          () => 0.4 + random() * 4
        ),
        position,
        rotation,
        linearVelocity: normal.clone().multiplyScalar(-1)
      });
      const anchor = value.position.clone().add(lever);
      const result = new NormalContactSolver4({
        iterations: 1,
        baumgarte: 0
      }).solve([
        contact(
          `anisotropic-${sample}`,
          value,
          null,
          normal.data,
          anchor.data,
          anchor.data
        )
      ], 1 / 120);
      expect(result.points[0]!.effectiveMass).toBeGreaterThan(0);
      expect(Math.abs(result.points[0]!.finalNormalSpeed)).toBeLessThan(2e-12);
    }
  });

  it('suppresses low-speed bounce and exposes bounded penetration bias', () => {
    const slow = body([0, 0, 0, 0], [0, -0.1, 0, 0]);
    const slowResult = new NormalContactSolver4({
      iterations: 1,
      restitutionThreshold: 0.5,
      baumgarte: 0
    }).solve([
      contact('slow', slow, null, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], {
        restitution: 1
      })
    ], 0.1);
    expect(slowResult.points[0]!.restitutionSpeed).toBe(0);
    expect(slowResult.points[0]!.finalNormalSpeed).toBeCloseTo(0, 14);

    const penetrating = body([0, 0, 0, 0], [0, 0, 0, 0]);
    const biasResult = new NormalContactSolver4({
      iterations: 1,
      baumgarte: 0.2,
      penetrationSlop: 0.005,
      maxBiasSpeed: 0.15
    }).solve([
      contact('bias', penetrating, null, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], {
        penetrationDepth: 0.105
      })
    ], 0.1);
    expect(biasResult.points[0]!.biasSpeed).toBeCloseTo(0.15, 14);
    expect(biasResult.points[0]!.finalNormalSpeed).toBeCloseTo(0.15, 14);
  });

  it('uses prescribed kinematic motion without applying momentum to it', () => {
    const dynamic = body([0, 0, 0, 0], [0, 0, 0, 0]);
    const driver: RigidMotion4 = {
      center: new VecN([0, 0, 0, 0]),
      linearVelocity: new VecN([1, 0, 0, 0]),
      angularVelocityWorld: new BivectorN(4)
    };
    const result = new NormalContactSolver4({ iterations: 1, baumgarte: 0 }).solve([
      contact('driver', dynamic, driver, [1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])
    ], 1 / 60);
    expect(dynamic.linearVelocity.data[0]!).toBeCloseTo(1, 14);
    expect(result.points[0]!.initialNormalSpeed).toBeCloseTo(-1, 14);
    expect(result.points[0]!.finalNormalSpeed).toBeCloseTo(0, 14);
  });
});

describe('normal-contact persistence and world seam', () => {
  it('warm-starts by persistent ID, timestep ratio, and normal coherence', () => {
    const value = body([0, 0, 0, 0], [0, -1, 0, 0]);
    const solver = new NormalContactSolver4({ iterations: 1, baumgarte: 0 });
    const make = (normal: ArrayLike<number>) =>
      contact('persistent', value, null, normal, [0, 0, 0, 0], [0, 0, 0, 0]);

    const first = solver.solve([make([0, 1, 0, 0])], 0.1);
    expect(first.points[0]!.warmStartedImpulse).toBe(0);
    expect(first.points[0]!.accumulatedImpulse).toBeCloseTo(1, 14);

    value.linearVelocity.data.set([0, -1, 0, 0]);
    const second = solver.solve([make([0, 1, 0, 0])], 0.05);
    expect(second.points[0]!.warmStartedImpulse).toBeCloseTo(0.5, 14);
    expect(second.points[0]!.accumulatedImpulse).toBeCloseTo(1, 14);

    value.linearVelocity.data.set([-1, 0, 0, 0]);
    const turned = solver.solve([make([1, 0, 0, 0])], 0.05);
    expect(turned.points[0]!.warmStartedImpulse).toBe(0);
    const retired = solver.solve([], 0.05);
    expect(retired.retiredIds).toEqual(['persistent']);
  });

  it('converts hyperbox patches to namespaced constraints at actual anchors', () => {
    const shapeA = new HyperboxSupportShape4(
      [1, 1, 1, 1],
      new TransformN(4, undefined, new VecN([0, 0, 0, 0]))
    );
    const shapeB = new HyperboxSupportShape4(
      [1, 1, 1, 1],
      new TransformN(4, undefined, new VecN([1.5, 0, 0, 0]))
    );
    const patch = hyperboxContactPatch4(shapeA, shapeB).patch!;
    const constraints = normalContactConstraintsFromHyperboxPatch4(
      patch,
      body([0, 0, 0, 0], [0, 0, 0, 0]),
      null,
      { pairId: 'box-a/box-b', restitution: 0.25 }
    );
    expect(constraints).toHaveLength(8);
    expect(constraints.every(({ id }) => id.startsWith('box-a/box-b|a:'))).toBe(true);
    for (const constraint of constraints) {
      expect(constraint.anchorA.data[0]!).toBeCloseTo(1, 13);
      expect(constraint.anchorB.data[0]!).toBeCloseTo(0.5, 13);
      expect(constraint.penetrationDepth).toBeCloseTo(0.5, 13);
      expect(constraint.restitution).toBe(0.25);
    }
  });

  it('holds a two-body stack at rest through the world constraint callback', () => {
    const lower = body([0, 0.5, 0, 0], [0, 0, 0, 0]);
    const upper = body([0, 1.5, 0, 0], [0, 0, 0, 0]);
    const world = new PhysicsWorld4({ gravity: [0, -10, 0, 0] })
      .addBody(lower)
      .addBody(upper);
    const solver = new NormalContactSolver4({
      iterations: 12,
      baumgarte: 0,
      restitutionThreshold: 0.5
    });
    const dt = 1 / 120;
    for (let step = 0; step < 600; step++) {
      world.step(dt, 1, (substepDt) => {
        solver.solve([
          contact(
            'lower/floor',
            lower,
            null,
            [0, 1, 0, 0],
            [0, lower.position.data[1]! - 0.5, 0, 0],
            [0, 0, 0, 0]
          ),
          contact(
            'upper/lower',
            upper,
            lower,
            [0, 1, 0, 0],
            [0, upper.position.data[1]! - 0.5, 0, 0],
            [0, lower.position.data[1]! + 0.5, 0, 0]
          )
        ], substepDt);
      });
    }
    // The first frame starts cold: 12 Gauss-Seidel passes leave a geometric
    // residual whose one-step position error remains bounded thereafter.
    expect(Math.abs(lower.position.data[1]! - 0.5)).toBeLessThan(2e-7);
    expect(Math.abs(upper.position.data[1]! - 1.5)).toBeLessThan(2e-7);
    expect(Math.abs(lower.linearVelocity.data[1]!)).toBeLessThan(1e-10);
    expect(Math.abs(upper.linearVelocity.data[1]!)).toBeLessThan(1e-10);
  });

  it('rejects invalid policies and ambiguous constraints', () => {
    expect(() => new NormalContactSolver4({ iterations: 0 })).toThrow(/iterations/);
    const value = body([0, 0, 0, 0], [0, 0, 0, 0]);
    const solver = new NormalContactSolver4();
    const valid = contact('same', value, null, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(() => solver.solve([valid, valid], 1 / 60)).toThrow(/duplicate/);
    expect(() => solver.solve([
      contact('self', value, value, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])
    ], 1 / 60)).toThrow(/itself/);
    expect(() => solver.solve([
      contact('fixed', null, null, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])
    ], 1 / 60)).toThrow(/dynamic/);
    expect(() => solver.solve([
      contact('bounce', value, null, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], {
        restitution: 1.1
      })
    ], 1 / 60)).toThrow(/restitution/);
  });
});
