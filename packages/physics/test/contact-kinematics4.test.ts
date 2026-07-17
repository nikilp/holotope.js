import { describe, expect, it } from 'vitest';
import { BivectorN, MatN, Rotor4, TransformN, VecN } from '@holotope/core';
import {
  HyperboxContactTracker4,
  HyperboxSupportShape4,
  RigidBody4,
  contactTangentBasis4,
  hyperboxBoundaryFeatureKey4,
  hyperboxContactKinematics4,
  hyperboxContactPatch4,
  hyperboxContactVertexId4,
  rigidMotionFromTransforms4,
  velocityAtWorldPoint4,
  type RigidMotion4
} from '../src/index.js';

function unitBox(position: ArrayLike<number>): HyperboxSupportShape4 {
  return new HyperboxSupportShape4(
    [1, 1, 1, 1],
    new TransformN(4, undefined, new VecN(position))
  );
}

function zeroMotion(center: ArrayLike<number>, velocity: ArrayLike<number>): RigidMotion4 {
  return {
    center: new VecN(center),
    linearVelocity: new VecN(velocity),
    angularVelocityWorld: new BivectorN(4)
  };
}

function expectVectorClose(
  actual: VecN,
  expected: ArrayLike<number>,
  digits = 11
): void {
  for (let axis = 0; axis < 4; axis++) {
    expect(actual.data[axis]!).toBeCloseTo(expected[axis]!, digits);
  }
}

describe('persistent R4 hyperbox contact identities', () => {
  it('derives canonical IDs from local feature pairs', () => {
    const featureA = { positiveMask: 0b0101, negativeMask: 0b0010, dimension: 1 };
    const featureB = { positiveMask: 0b1000, negativeMask: 0b0001, dimension: 2 };
    expect(hyperboxBoundaryFeatureKey4(featureA)).toBe('p5n2');
    expect(hyperboxContactVertexId4(featureA, featureB)).toBe('a:p5n2|b:p8n1');
    expect(() => hyperboxBoundaryFeatureKey4({
      positiveMask: 0b0001,
      negativeMask: 0b0001,
      dimension: 3
    })).toThrow(/disjoint/);
    expect(() => hyperboxBoundaryFeatureKey4({
      positiveMask: 0b0001,
      negativeMask: 0,
      dimension: 2
    })).toThrow(/does not match masks/);
  });

  it('keeps feature identities and ages through coherent penetration changes', () => {
    const boxA = unitBox([0, 0, 0, 0]);
    const tracker = new HyperboxContactTracker4();
    const firstPatch = hyperboxContactPatch4(boxA, unitBox([1.5, 0, 0, 0])).patch!;
    const first = tracker.update(firstPatch);
    expect(first.points).toHaveLength(8);
    expect(new Set(first.points.map((point) => point.id)).size).toBe(8);
    expect(first.points.every((point) => point.age === 1 && point.isNew)).toBe(true);
    expect(first.retiredIds).toEqual([]);

    const secondPatch = hyperboxContactPatch4(boxA, unitBox([1.4, 0, 0, 0])).patch!;
    const second = tracker.update(secondPatch);
    expect(second.points.map((point) => point.id)).toEqual(
      first.points.map((point) => point.id)
    );
    expect(second.points.every((point) => point.age === 2 && !point.isNew)).toBe(true);

    const absent = tracker.update(null);
    expect(absent.points).toEqual([]);
    expect(absent.retiredIds).toEqual(first.points.map((point) => point.id).sort());
    const reentered = tracker.update(secondPatch);
    expect(reentered.points.every((point) => point.age === 1 && point.isNew)).toBe(true);
  });

  it('can track the complete geometric patch independently of solver reduction', () => {
    const boxA = new HyperboxSupportShape4([1, 1.2, 0.8, 0.7]);
    const boxB = new HyperboxSupportShape4(
      [0.9, 0.7, 1.1, 0.6],
      new TransformN(
        4,
        Rotor4.fromPlanes([
          { i: 1, j: 2, angle: -0.899726302629064 },
          { i: 1, j: 3, angle: 0.6268973517395783 },
          { i: 2, j: 3, angle: 1.514587983023192 }
        ]),
        new VecN([1.5, -0.06495272982865573, -0.0537636648863554, -0.375440582446754])
      )
    );
    const patch = hyperboxContactPatch4(boxA, boxB).patch!;
    expect(new HyperboxContactTracker4().update(patch).points).toHaveLength(8);
    expect(new HyperboxContactTracker4({ pointSource: 'vertices' }).update(patch).points)
      .toHaveLength(20);
  });
});

describe('R4 rigid and kinematic-driver velocity extraction', () => {
  it('evaluates v + Ωr with the kernel plane convention', () => {
    const body = new RigidBody4({
      mass: 1,
      inertiaDiagonal: new Float64Array(6).fill(2),
      position: [1, 0, 0, 0],
      linearVelocity: [0.5, -0.25, 0, 0]
    }).setAngularVelocityWorld(
      BivectorN.fromPlanes(4, [{ i: 0, j: 1, angle: 2 }])
    );
    expectVectorClose(body.velocityAtWorldPoint([2, 0, 0, 0]), [0.5, 1.75, 0, 0]);

    const snapshot: RigidMotion4 = {
      center: body.position,
      linearVelocity: body.linearVelocity,
      angularVelocityWorld: body.angularVelocityWorld()
    };
    expectVectorClose(
      velocityAtWorldPoint4(snapshot, new VecN([2, 0, 0, 0])),
      [0.5, 1.75, 0, 0]
    );
  });

  it('recovers translation and a full six-component world angular velocity from poses', () => {
    const dt = 0.025;
    const velocity = new VecN([1.2, -0.4, 0.7, 0.3]);
    const angularVelocity = new BivectorN(4, [0.4, -0.3, 0.2, 0.7, -0.5, 0.6]);
    const previousRotation = Rotor4.fromPlanes([
      { i: 0, j: 3, angle: 0.35 },
      { i: 1, j: 2, angle: -0.2 }
    ]);
    const previous = new TransformN(
      4,
      previousRotation.toMatrix(),
      new VecN([-1, 2, 0.5, 0.25])
    );
    const currentRotation = Rotor4.fromBivector(
      angularVelocity.clone().scale(dt)
    ).multiply(previousRotation);
    const currentPosition = previous.position.clone().add(velocity.clone().multiplyScalar(dt));
    const current = new TransformN(4, currentRotation.toMatrix(), currentPosition);
    const motion = rigidMotionFromTransforms4(previous, current, dt);

    expectVectorClose(motion.center, currentPosition.data, 13);
    expectVectorClose(motion.linearVelocity, velocity.data, 13);
    for (let component = 0; component < 6; component++) {
      expect(motion.angularVelocityWorld.coeffs[component]!).toBeCloseTo(
        angularVelocity.coeffs[component]!,
        11
      );
    }
  });

  it('rejects non-rigid and temporally ambiguous pose samples', () => {
    const identity = TransformN.identity(4);
    expect(() => rigidMotionFromTransforms4(identity, identity, 0)).toThrow(/dt/);
    const scaled = MatN.identity(4).set(0, 0, 2);
    expect(() => rigidMotionFromTransforms4(
      identity,
      new TransformN(4, scaled),
      1
    )).toThrow(/orthonormal/);
    const centralInversion = new TransformN(
      4,
      Rotor4.fromPlanes([
        { i: 0, j: 1, angle: Math.PI },
        { i: 2, j: 3, angle: Math.PI }
      ])
    );
    expect(() => rigidMotionFromTransforms4(identity, centralInversion, 1)).toThrow(
      /no unique logarithm/
    );
  });
});

describe('R4 contact frames and relative velocity', () => {
  it('parallel-transports all three tangent directions under a small normal change', () => {
    const first = contactTangentBasis4(new VecN([1, 0, 0, 0]));
    const angle = 0.03;
    const normal = new VecN([Math.cos(angle), Math.sin(angle), 0, 0]);
    const second = contactTangentBasis4(normal, first);
    for (let tangent = 0; tangent < 3; tangent++) {
      expect(second[tangent].dot(normal)).toBeCloseTo(0, 13);
      expect(second[tangent].length()).toBeCloseTo(1, 13);
      expect(second[tangent].dot(first[tangent])).toBeGreaterThan(0.999);
      for (let other = 0; other < tangent; other++) {
        expect(second[tangent].dot(second[other])).toBeCloseTo(0, 13);
      }
    }
  });

  it('uses original-pose anchors and decomposes velocity into 1+3 components', () => {
    const boxA = unitBox([0, 0, 0, 0]);
    const boxB = unitBox([1.5, 0, 0, 0]);
    const patch = hyperboxContactPatch4(boxA, boxB).patch!;
    const result = hyperboxContactKinematics4(
      patch,
      zeroMotion([0, 0, 0, 0], [1, 2, 3, 4]),
      zeroMotion([1.5, 0, 0, 0], [0, 0, 0, 0])
    );
    expectVectorClose(result.normal, [-1, 0, 0, 0], 13);
    expect(result.points).toHaveLength(8);

    for (const point of result.points) {
      expect(point.anchorA.data[0]!).toBeCloseTo(1, 13);
      expect(point.anchorB.data[0]!).toBeCloseTo(0.5, 13);
      expectVectorClose(point.relativeVelocity, [1, 2, 3, 4], 13);
      expect(point.normalSpeed).toBeCloseTo(-1, 13);
      expectVectorClose(point.tangentialVelocity, [0, 2, 3, 4], 13);
      expect(point.tangentSpeeds).toEqual([2, 3, 4]);

      const reconstructed = result.normal.clone().multiplyScalar(point.normalSpeed);
      result.tangentBasis.forEach((tangent, index) => {
        reconstructed.add(tangent.clone().multiplyScalar(point.tangentSpeeds[index]!));
      });
      expectVectorClose(reconstructed, point.relativeVelocity.data, 12);
    }
  });

  it('validates tangent-frame and point-source policies', () => {
    expect(() => contactTangentBasis4(new VecN([0, 0, 0, 0]))).toThrow(/nonzero/);
    expect(() => contactTangentBasis4(
      new VecN([1, 0, 0, 0]),
      [new VecN(4)]
    )).toThrow(/three vectors/);
    const patch = hyperboxContactPatch4(
      unitBox([0, 0, 0, 0]),
      unitBox([1.5, 0, 0, 0])
    ).patch!;
    expect(() => hyperboxContactKinematics4(
      patch,
      zeroMotion([0, 0, 0, 0], [0, 0, 0, 0]),
      zeroMotion([1.5, 0, 0, 0], [0, 0, 0, 0]),
      { pointSource: 'invalid' as never }
    )).toThrow(/pointSource/);
  });
});
