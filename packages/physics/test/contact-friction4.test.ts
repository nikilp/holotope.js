import { BivectorN, Rotor4, TransformN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ContactSolver4,
  HyperboxSupportShape4,
  RigidBody4,
  contactConstraintsFromHyperboxPatch4,
  hyperboxContactPatch4,
  type ContactConstraint4
} from '../src/index.js';

function body(
  position: ArrayLike<number>,
  velocity: ArrayLike<number>,
  options: {
    mass?: number;
    inertia?: ArrayLike<number>;
    rotation?: Rotor4;
  } = {}
): RigidBody4 {
  return new RigidBody4({
    mass: options.mass ?? 1,
    inertiaDiagonal: options.inertia ?? new Float64Array(6).fill(1),
    position,
    linearVelocity: velocity,
    ...(options.rotation === undefined ? {} : { rotation: options.rotation })
  });
}

function contact(
  id: string,
  participantA: RigidBody4,
  participantB: RigidBody4 | null,
  normal: ArrayLike<number>,
  anchorA: ArrayLike<number>,
  anchorB: ArrayLike<number>,
  friction: number
): ContactConstraint4 {
  return {
    id,
    participantA,
    participantB,
    normal: new VecN(normal),
    anchorA: new VecN(anchorA),
    anchorB: new VecN(anchorB),
    friction
  };
}

function length3(value: ArrayLike<number>): number {
  return Math.hypot(value[0]!, value[1]!, value[2]!);
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
    for (let component = 0; component < 6; component++) {
      total[component]! += value.angularMomentumWorld.coeffs[component]!;
    }
    const momentum = value.linearVelocity.clone().multiplyScalar(value.mass);
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        total[BivectorN.planeIndex(4, i, j)]! +=
          value.position.data[i]! * momentum.data[j]! -
          value.position.data[j]! * momentum.data[i]!;
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

describe('coupled R4 contact friction', () => {
  it('projects the complete tangent impulse onto one Coulomb 3-ball', () => {
    const value = body([0, 0, 0, 0], [3, -2, 4, 0]);
    const energyBefore = value.kineticEnergy();
    const result = new ContactSolver4({ iterations: 1, baumgarte: 0 }).solve([
      contact('sliding', value, null, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], 0.5)
    ], 1 / 60);
    const point = result.points[0]!;

    expect(point.accumulatedImpulse).toBeCloseTo(2, 14);
    expect(point.frictionLimit).toBeCloseTo(1, 14);
    expect(length3(point.accumulatedTangentImpulse)).toBeCloseTo(1, 14);
    expectArrayClose(point.tangentImpulseWorld.data, [-0.6, 0, -0.8, 0], 13);
    expect(length3(point.finalTangentSpeeds)).toBeCloseTo(4, 13);
    expect(point.frictionState).toBe('sliding');
    expect(value.kineticEnergy()).toBeLessThan(energyBefore);
  });

  it('sticks an unconstrained three-component tangent velocity', () => {
    const value = body([0, 0, 0, 0], [1, -2, 2, 3]);
    const result = new ContactSolver4({ iterations: 1, baumgarte: 0 }).solve([
      contact('sticking', value, null, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], 10)
    ], 1 / 60);
    const point = result.points[0]!;

    expect(length3(point.initialTangentSpeeds)).toBeCloseTo(Math.sqrt(14), 14);
    expect(length3(point.finalTangentSpeeds)).toBeLessThan(1e-13);
    expect(point.frictionState).toBe('sticking');
    expectArrayClose(value.linearVelocity.data, [0, 0, 0, 0], 13);
  });

  it('treats all three normal-tangent spin modes isotropically', () => {
    const value = body([0, 1, 0, 0], [0, -4, 0, 0]);
    value.setAngularVelocityWorld(new BivectorN(4, [1, 0, 0, 2, 3, 0]));
    const energyBefore = value.kineticEnergy();
    const result = new ContactSolver4({ iterations: 1, baumgarte: 0 }).solve([
      contact('spinning-glome', value, null, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], 10)
    ], 1 / 60);
    const point = result.points[0]!;

    expect(point.initialTangentSpeeds.every((speed) => Math.abs(speed) > 0.5)).toBe(true);
    expect(length3(point.finalTangentSpeeds)).toBeLessThan(1e-13);
    expect(value.kineticEnergy()).toBeLessThan(energyBefore);
    // Point friction establishes rolling contact; it does not pretend to be
    // rolling resistance and therefore need not erase angular velocity.
    expect(value.angularVelocityWorld().coeffs.some((speed) => Math.abs(speed) > 0)).toBe(true);
  });

  it('reports the exact full 3x3 point-response differential', () => {
    const rotation = Rotor4.fromPlanes([
      { i: 0, j: 1, angle: 0.41 },
      { i: 0, j: 3, angle: -0.73 },
      { i: 1, j: 2, angle: 0.29 },
      { i: 2, j: 3, angle: 0.57 }
    ]);
    const inertia = new Float64Array([0.7, 1.1, 1.9, 2.3, 3.1, 4.2]);
    const position = new VecN([0.2, -0.4, 0.1, 0.7]);
    const anchor = new VecN([0.9, 0.3, -0.6, 0.2]);
    const normal = new VecN([0.3, 0.8, -0.2, 0.45]).normalize();
    const value = body(position.data, normal.clone().multiplyScalar(-1).data, {
      mass: 1.7,
      inertia,
      rotation
    });
    const result = new ContactSolver4({ iterations: 1, baumgarte: 0 }).solve([
      contact('differential', value, null, normal.data, anchor.data, anchor.data, 0)
    ], 1 / 120).points[0]!;

    let largestOffDiagonal = 0;
    for (let column = 0; column < 3; column++) {
      const probe = body(position.data, [0, 0, 0, 0], {
        mass: 1.7,
        inertia,
        rotation
      });
      probe.applyImpulseAtWorldPoint(result.tangentBasis[column]!, anchor);
      const response = probe.velocityAtWorldPoint(anchor);
      for (let row = 0; row < 3; row++) {
        const actual = result.tangentResponse[row * 3 + column]!;
        const expected = result.tangentBasis[row]!.dot(response);
        expect(actual).toBeCloseTo(expected, 12);
        if (row !== column) largestOffDiagonal = Math.max(largestOffDiagonal, Math.abs(actual));
      }
    }
    expect(largestOffDiagonal).toBeGreaterThan(1e-3);
  });

  it('is tangent-coordinate invariant for an isotropic central contact', () => {
    const tangents = [
      [13, 0, 0],
      [3, 4, 12],
      [-5, 12, 0]
    ];
    const outcomes = tangents.map(([x, z, w], index) => {
      const value = body([0, 0, 0, 0], [x!, -2, z!, w!]);
      const point = new ContactSolver4({ iterations: 1, baumgarte: 0 }).solve([
        contact(`isotropic-${index}`, value, null, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], 0.75)
      ], 1 / 60).points[0]!;
      return {
        impulse: point.tangentImpulseWorld.length(),
        finalSpeed: length3(point.finalTangentSpeeds),
        energy: value.kineticEnergy()
      };
    });
    for (const outcome of outcomes) {
      expect(outcome.impulse).toBeCloseTo(1.5, 13);
      expect(outcome.finalSpeed).toBeCloseTo(11.5, 13);
      expect(outcome.energy).toBeCloseTo(outcomes[0]!.energy, 12);
    }
  });

  it('conserves pair momentum when both impulses act at the same contact point', () => {
    const a = body([0, 1, 0, 0], [1, -2, 2, 3], { mass: 2 });
    const b = body([0, -1, 0, 0], [-0.5, 1, -1, 0], { mass: 3 });
    const linearBefore = totalLinearMomentum(a, b);
    const angularBefore = totalAngularMomentumAboutOrigin(a, b);
    new ContactSolver4({ iterations: 12, baumgarte: 0 }).solve([
      contact('pair', a, b, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], 0.8)
    ], 1 / 120);

    expectArrayClose(totalLinearMomentum(a, b), linearBefore, 11);
    expectArrayClose(totalAngularMomentumAboutOrigin(a, b), angularBefore, 11);
  });

  it('warm-starts the world tangent impulse with timestep scaling', () => {
    const value = body([0, 0, 0, 0], [3, -2, 4, 0]);
    const solver = new ContactSolver4({ iterations: 1, baumgarte: 0 });
    const make = () =>
      contact('persistent', value, null, [0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], 0.5);
    solver.solve([make()], 0.1);

    value.linearVelocity.data.set([3, -2, 4, 0]);
    const second = solver.solve([make()], 0.05).points[0]!;
    expect(second.warmStartedImpulse).toBeCloseTo(1, 14);
    expect(length3(second.warmStartedTangentImpulse)).toBeCloseTo(0.5, 14);
    expect(second.accumulatedImpulse).toBeCloseTo(2, 14);
    expect(length3(second.accumulatedTangentImpulse)).toBeCloseTo(1, 14);
  });

  it('carries friction policy through the hyperbox patch adapter', () => {
    const shapeA = new HyperboxSupportShape4(
      [1, 1, 1, 1],
      new TransformN(4, undefined, new VecN([0, 0, 0, 0]))
    );
    const shapeB = new HyperboxSupportShape4(
      [1, 1, 1, 1],
      new TransformN(4, undefined, new VecN([1.5, 0, 0, 0]))
    );
    const constraints = contactConstraintsFromHyperboxPatch4(
      hyperboxContactPatch4(shapeA, shapeB).patch!,
      body([0, 0, 0, 0], [0, 0, 0, 0]),
      null,
      { pairId: 'boxes', friction: 0.6 }
    );
    expect(constraints).toHaveLength(8);
    expect(constraints.every(({ friction }) => friction === 0.6)).toBe(true);
    expect(() => contactConstraintsFromHyperboxPatch4(
      hyperboxContactPatch4(shapeA, shapeB).patch!,
      body([0, 0, 0, 0], [0, 0, 0, 0]),
      null,
      { pairId: 'boxes', friction: -1 }
    )).toThrow(/friction/);
  });
});
