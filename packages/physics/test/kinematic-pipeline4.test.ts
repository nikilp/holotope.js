import {
  BivectorN,
  Rotor4,
  TransformN,
  VecN,
  createHypercube
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  AllPairsCandidateProviderN,
  ContactPipeline4,
  ConvexHullSupportShapeN,
  GlomeCollider4,
  HyperboxCollider4,
  HyperboxContactPipeline4,
  KinematicBody4,
  PhysicsWorld4,
  PolytopeCollider4,
  RigidBody4,
  contactPairId4,
  type CompactContactCollider4,
  type RigidMotion4
} from '../src/index.js';

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance = 1e-10
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(Math.abs(actual[index]! - expected[index]!)).toBeLessThan(tolerance);
  }
}

function expectTransformClose(
  actual: TransformN,
  expected: TransformN,
  tolerance = 1e-11
): void {
  expectArrayClose(actual.position.data, expected.position.data, tolerance);
  const actualMatrix = actual.rotation instanceof Rotor4
    ? actual.rotation.toMatrix()
    : actual.rotation;
  const expectedMatrix = expected.rotation instanceof Rotor4
    ? expected.rotation.toMatrix()
    : expected.rotation;
  expectArrayClose(actualMatrix.data, expectedMatrix.data, tolerance);
}

function dynamicBody(position: ArrayLike<number>): RigidBody4 {
  return new RigidBody4({
    mass: 1,
    inertiaDiagonal: new Float64Array(6).fill(1),
    position,
    gravityScale: 0
  });
}

describe('pose-owning kinematic colliders', () => {
  it('synchronizes local hyperbox, polytope, and offset-glome geometry', () => {
    const start = new TransformN(4, Rotor4.identity(), new VecN([1, 2, 3, 4]));
    const end = new TransformN(
      4,
      Rotor4.fromBivector(
        new BivectorN(4, [0.4, -0.2, 0.1, 0.3, -0.15, 0.25])
      ),
      new VecN([-2, 1, 0.5, 3])
    );
    const body = KinematicBody4.fromTransforms(start, end, 0.2);
    const local = new TransformN(
      4,
      Rotor4.fromPlane(0, 3, 0.25),
      new VecN([0.3, -0.2, 0.1, 0.4])
    );
    const box = new HyperboxCollider4({
      id: 'box',
      halfExtents: [1, 0.5, 0.3, 0.2],
      participant: body,
      localTransform: local
    });
    const source = ConvexHullSupportShapeN.fromCellComplex(
      createHypercube({ dim: 4, size: 1 })
    );
    const polytope = new PolytopeCollider4({
      id: 'polytope',
      source,
      participant: body,
      localTransform: local
    });
    const localCenter = new VecN([0.5, -0.25, 0.1, 0.3]);
    const glome = new GlomeCollider4({
      id: 'glome',
      radius: 0.4,
      participant: body,
      localCenter
    });

    new HyperboxContactPipeline4()
      .addCollider(box)
      .addCollider(new HyperboxCollider4({
        id: 'second-box',
        halfExtents: [0.1, 0.1, 0.1, 0.1],
        participant: body,
        localTransform: new TransformN(
          4,
          Rotor4.identity(),
          new VecN([10, 0, 0, 0])
        )
      }))
      .stepWorld(new PhysicsWorld4({ gravity: [0, 0, 0, 0] }), 0.2, 4);
    expect(body.elapsedTime).toBeCloseTo(0.2, 14);
    box.sync();
    polytope.sync();
    glome.sync();
    const root = body.pose();
    expectTransformClose(box.shape.transform, root.compose(local), 3e-13);
    expectTransformClose(polytope.shape.transform, root.compose(local), 3e-13);
    expectArrayClose(
      glome.shape.center.data,
      body.rotation.applyToPoint(localCenter).add(body.position).data,
      3e-13
    );
    expect(() => box.setTransform(TransformN.identity(4))).toThrow(/authoritative/);
    expect(() => glome.setCenter([0, 0, 0, 0])).toThrow(/authoritative/);
  });

  it('advances the mixed discrete world seam exactly once per substep', () => {
    const start = new TransformN(
      4,
      Rotor4.fromPlane(1, 3, -0.2),
      new VecN([-1, 0.5, 0.2, 0])
    );
    const end = new TransformN(
      4,
      Rotor4.fromBivector(new BivectorN(4, [0.2, 0, -0.1, 0.3, 0, 0.15]))
        .multiply(start.rotation as Rotor4),
      new VecN([0.8, -0.4, 0.6, 0.3])
    );
    const body = KinematicBody4.fromTransforms(start, end, 0.12);
    const collider = new GlomeCollider4({
      id: 'driver',
      radius: 0.25,
      participant: body
    });
    const result = new ContactPipeline4()
      .addCollider(collider)
      .stepWorld(
        new PhysicsWorld4({ gravity: [0, 0, 0, 0] }),
        0.12,
        3
      );
    expect(result.substeps).toHaveLength(3);
    expect(body.elapsedTime).toBeCloseTo(0.12, 14);
    expectTransformClose(body.pose(), end, 3e-13);
    expectArrayClose(collider.shape.center.data, end.position.data, 3e-13);
  });

  it('catches a translating prescribed body and transfers impulse only to dynamics', () => {
    const run = (exhaustive: boolean) => {
      const start = new TransformN(
        4,
        Rotor4.identity(),
        new VecN([-5, 0, 0, 0])
      );
      const end = new TransformN(
        4,
        Rotor4.identity(),
        new VecN([5, 0, 0, 0])
      );
      const kinematic = KinematicBody4.fromTransforms(start, end, 0.1);
      const target = dynamicBody([0, 0, 0, 0]);
      const result = new ContactPipeline4({
        solverOptions: { iterations: 12, baumgarte: 0 },
        ...(exhaustive
          ? {
              candidateProvider:
                new AllPairsCandidateProviderN<CompactContactCollider4>()
            }
          : {})
      })
        .addCollider(new GlomeCollider4({
          id: 'driver',
          radius: 1,
          participant: kinematic,
          material: { friction: 0 }
        }))
        .addCollider(new GlomeCollider4({
          id: 'target',
          radius: 1,
          participant: target,
          material: { friction: 0 }
        }))
        .stepWorldContinuous(
          new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(target),
          0.1
        );
      return { result, kinematic, target, end };
    };

    const swept = run(false);
    const exhaustive = run(true);
    expect(swept.result.status).toBe('complete');
    expect(swept.result.substeps[0]!.kinematicFallbackPairIds).toEqual([]);
    expect(swept.result.substeps[0]!.events).toHaveLength(1);
    expect(swept.result.substeps[0]!.events[0]!.time).toBeCloseTo(0.03, 10);
    expect(swept.result.substeps[0]!.events[0]!.cast.kind).toBe('convex');
    expect(swept.result.substeps[0]!.events.map(({ pairId }) => pairId))
      .toEqual(exhaustive.result.substeps[0]!.events.map(({ pairId }) => pairId));
    expect(swept.result.substeps[0]!.events[0]!.time).toBeCloseTo(
      exhaustive.result.substeps[0]!.events[0]!.time,
      12
    );
    expectArrayClose(swept.kinematic.position.data, swept.end.position.data, 2e-10);
    expectArrayClose(swept.kinematic.linearVelocity.data, [100, 0, 0, 0], 1e-12);
    expect(swept.target.linearVelocity.data[0]).toBeCloseTo(100, 8);
  });

  it('catches pure-spin kinematic tunneling through the rigid-cast lane', () => {
    const start = new TransformN(
      4,
      Rotor4.identity(),
      new VecN([1, 0, 0, 0])
    );
    const end = new TransformN(
      4,
      Rotor4.fromBivector(new BivectorN(4, [Math.PI, 0, 0, 0, 0, 0])),
      start.position
    );
    const kinematic = KinematicBody4.fromTransforms(start, end, 1);
    const obstacle = dynamicBody([0, 0, 0, 0]);
    const result = new ContactPipeline4({
      solverOptions: { iterations: 16, baumgarte: 0 }
    })
      .addCollider(new HyperboxCollider4({
        id: 'driver',
        halfExtents: [0.2, 1.5, 0.2, 0.2],
        participant: kinematic,
        material: { friction: 0 }
      }))
      .addCollider(new HyperboxCollider4({
        id: 'obstacle',
        halfExtents: [0.1, 0.1, 0.1, 0.1],
        participant: obstacle,
        material: { friction: 0 }
      }))
      .stepWorldContinuous(
        new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(obstacle),
        1,
        1,
        { castOptions: { maxIterations: 96, distanceTolerance: 1e-10 } }
      );

    expect(result.substeps[0]!.events.length).toBeGreaterThan(0);
    expect(result.substeps[0]!.events[0]!.cast.kind).toBe('rigid-convex');
    expect(result.substeps[0]!.events[0]!.time).toBeGreaterThan(0);
    expect(result.substeps[0]!.events[0]!.time).toBeLessThan(0.5);
    expect(result.substeps[0]!.kinematicFallbackPairIds).toEqual([]);
    expectTransformClose(kinematic.pose(), end, 3e-12);
    expectArrayClose(
      kinematic.angularVelocityWorld.coeffs,
      [Math.PI, 0, 0, 0, 0, 0],
      2e-13
    );
  });

  it('retains a typed partial fallback for velocity-only prescribed motion', () => {
    const prescribed: RigidMotion4 = {
      center: new VecN([-5, 0, 0, 0]),
      linearVelocity: new VecN([100, 0, 0, 0]),
      angularVelocityWorld: new BivectorN(4)
    };
    const target = dynamicBody([0, 0, 0, 0]);
    const result = new ContactPipeline4()
      .addCollider(new GlomeCollider4({
        id: 'legacy-driver',
        radius: 1,
        center: prescribed.center,
        participant: prescribed
      }))
      .addCollider(new GlomeCollider4({
        id: 'target',
        radius: 1,
        participant: target
      }))
      .stepWorldContinuous(
        new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(target),
        0.1
      );
    expect(result.status).toBe('partial');
    expect(result.substeps[0]!.kinematicFallbackPairIds).toEqual([
      contactPairId4('legacy-driver', 'target')
    ]);
    expect(result.substeps[0]!.events).toEqual([]);
  });

  it('refuses trajectory overrun before integrating a dynamic world', () => {
    const start = TransformN.identity(4);
    const end = new TransformN(
      4,
      Rotor4.identity(),
      new VecN([1, 0, 0, 0])
    );
    const kinematic = KinematicBody4.fromTransforms(start, end, 0.05);
    const target = dynamicBody([10, 0, 0, 0]);
    target.applyForce([2, 0, 0, 0]);
    const pipeline = new ContactPipeline4()
      .addCollider(new GlomeCollider4({
        id: 'driver',
        radius: 1,
        participant: kinematic
      }))
      .addCollider(new GlomeCollider4({
        id: 'target',
        radius: 1,
        participant: target
      }));
    expect(() => pipeline.stepWorldContinuous(
      new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(target),
      0.1
    )).toThrow(/exceeds/);
    expectArrayClose(target.linearVelocity.data, [0, 0, 0, 0], 1e-15);
    expect(kinematic.elapsedTime).toBe(0);
  });
});
