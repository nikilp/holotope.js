import { Rotor4, TransformN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  AllPairsCandidateProviderN,
  HyperboxCollider4,
  HyperboxContactPipeline4,
  PhysicsWorld4,
  RigidBody4,
  hyperboxPairId4,
  type BroadphaseCandidateProviderN
} from '../src/index.js';

function body(
  position: ArrayLike<number>,
  velocity: ArrayLike<number> = [0, 0, 0, 0]
): RigidBody4 {
  return new RigidBody4({
    mass: 1,
    inertiaDiagonal: new Float64Array(6).fill(1),
    position,
    linearVelocity: velocity
  });
}

function dynamicCollider(
  id: string,
  value: RigidBody4,
  options: {
    friction?: number;
    restitution?: number;
    halfExtents?: ArrayLike<number>;
  } = {}
): HyperboxCollider4 {
  return new HyperboxCollider4({
    id,
    participant: value,
    halfExtents: options.halfExtents ?? [1, 1, 1, 1],
    material: {
      friction: options.friction ?? 0,
      restitution: options.restitution ?? 0
    }
  });
}

function fixedCollider(
  id: string,
  position: ArrayLike<number>,
  options: {
    friction?: number;
    restitution?: number;
    halfExtents?: ArrayLike<number>;
  } = {}
): HyperboxCollider4 {
  return new HyperboxCollider4({
    id,
    participant: null,
    transform: new TransformN(4, undefined, new VecN(position)),
    halfExtents: options.halfExtents ?? [1, 1, 1, 1],
    material: {
      friction: options.friction ?? 0,
      restitution: options.restitution ?? 0
    }
  });
}

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 11
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, digits);
  }
}

describe('HyperboxCollider4 synchronization', () => {
  it('composes a dynamic body pose with a collider-local pose', () => {
    const value = body([1, 2, 3, 4]);
    value.rotation = Rotor4.fromPlane(0, 1, Math.PI / 2);
    const local = new TransformN(
      4,
      Rotor4.fromPlane(2, 3, 0.31),
      new VecN([2, 0, 0, 0])
    );
    const collider = new HyperboxCollider4({
      id: 'offset',
      participant: value,
      halfExtents: [1, 2, 3, 4],
      localTransform: local
    });
    const expected = new TransformN(
      4,
      value.rotation,
      value.position
    ).compose(local);

    expectArrayClose(collider.shape.transform.position.data, expected.position.data);
    expectArrayClose(
      collider.shape.transform.rotation.toMatrix().data,
      expected.rotation.toMatrix().data
    );

    value.position.data.set([-4, 3, 2, 1]);
    value.rotation = Rotor4.fromPlane(0, 3, -0.47);
    collider.sync();
    const moved = new TransformN(4, value.rotation, value.position).compose(local);
    expectArrayClose(collider.shape.transform.position.data, moved.position.data);
    expect(() => collider.setTransform(TransformN.identity(4))).toThrow(/authoritative/);
    expect(() => new HyperboxCollider4({
      id: 'ambiguous',
      participant: value,
      transform: TransformN.identity(4),
      halfExtents: [1, 1, 1, 1]
    })).toThrow(/owns its world transform/);
  });
});

describe('HyperboxContactPipeline4 dispatch and response', () => {
  it('automatically resolves a central elastic collision', () => {
    const left = body([-0.9, 0, 0, 0], [1, 0, 0, 0]);
    const right = body([0.9, 0, 0, 0], [-1, 0, 0, 0]);
    const pipeline = new HyperboxContactPipeline4({
      solverOptions: {
        iterations: 24,
        restitutionThreshold: 0,
        baumgarte: 0
      }
    })
      .addCollider(dynamicCollider('left', left, { restitution: 1 }))
      .addCollider(dynamicCollider('right', right, { restitution: 1 }));

    const result = pipeline.solve(1 / 60);

    expect(result.colliderCount).toBe(2);
    expect(result.possiblePairs).toBe(1);
    expect(result.candidatePairs).toBe(1);
    expect(result.broadphaseRejectedPairs).toBe(0);
    expect(result.broadphase.providerId).toBe('sweep-and-prune');
    expect(result.filteredPairs).toBe(0);
    expect(result.narrowphasePairs).toBe(1);
    expect(result.contactPairs).toBe(1);
    expect(result.respondingPairs).toBe(1);
    expect(result.constraintCount).toBe(8);
    expect(result.pairs[0]!.narrowphase.kind).toBe('deep-manifold');
    expect(result.pairs[0]!.narrowphase.capability).toBe('deep-manifold');
    expect(result.pairs[0]!.id).toBe(hyperboxPairId4('left', 'right'));
    expect(result.pairs[0]!.constraintIds).toEqual(
      result.response.points.map(({ id }) => id)
    );
    expect(left.linearVelocity.data[0]!).toBeCloseTo(-1, 10);
    expect(right.linearVelocity.data[0]!).toBeCloseTo(1, 10);
  });

  it('is independent of collider insertion order', () => {
    const run = (reverse: boolean) => {
      const alphaBody = body([-0.9, 0, 0, 0], [1, 0.2, -0.1, 0.3]);
      const betaBody = body([0.9, 0, 0, 0], [-1, -0.3, 0.4, -0.2]);
      const alpha = dynamicCollider('alpha', alphaBody, { friction: 0.6 });
      const beta = dynamicCollider('beta', betaBody, { friction: 0.6 });
      const pipeline = new HyperboxContactPipeline4({
        solverOptions: { iterations: 12, baumgarte: 0 }
      });
      for (const collider of reverse ? [beta, alpha] : [alpha, beta]) {
        pipeline.addCollider(collider);
      }
      const result = pipeline.solve(1 / 120);
      return {
        pairIds: result.pairs.map(({ id }) => id),
        pointIds: result.response.points.map(({ id }) => id),
        impulses: result.response.points.map(({ accumulatedImpulse }) => accumulatedImpulse),
        alphaVelocity: Array.from(alphaBody.linearVelocity.data),
        betaVelocity: Array.from(betaBody.linearVelocity.data)
      };
    };

    expect(run(true)).toEqual(run(false));
  });

  it('filters before narrowphase and reports mixed material policy', () => {
    const first = fixedCollider('first', [0, 0, 0, 0], {
      friction: 0.25,
      restitution: 0.2
    });
    const second = dynamicCollider('second', body([1.5, 0, 0, 0]), {
      friction: 1,
      restitution: 0.8
    });
    first.collisionGroup = 0b0001;
    first.collisionMask = 0b0001;
    second.collisionGroup = 0b0010;
    second.collisionMask = 0b0010;
    const pipeline = new HyperboxContactPipeline4()
      .addCollider(second)
      .addCollider(first);

    const filtered = pipeline.solve(1 / 60);
    expect(filtered.candidatePairs).toBe(1);
    expect(filtered.filteredPairs).toBe(1);
    expect(filtered.narrowphasePairs).toBe(0);
    expect(filtered.pairs).toHaveLength(0);

    first.collisionMask = 0b0010;
    second.collisionMask = 0b0001;
    const admitted = pipeline.solve(1 / 60);
    expect(admitted.filteredPairs).toBe(0);
    expect(admitted.contactPairs).toBe(1);
    expect(admitted.pairs[0]!.friction).toBeCloseTo(0.5, 14);
    expect(admitted.pairs[0]!.restitution).toBe(0.8);
    expect(admitted.response.points.every(({ frictionCoefficient }) =>
      frictionCoefficient === 0.5
    )).toBe(true);
  });

  it('reports geometric fixed-fixed contact without inventing a response', () => {
    const pipeline = new HyperboxContactPipeline4()
      .addCollider(fixedCollider('a', [0, 0, 0, 0]))
      .addCollider(fixedCollider('b', [1.5, 0, 0, 0]));

    const result = pipeline.solve(1 / 60);
    expect(result.contactPairs).toBe(1);
    expect(result.respondingPairs).toBe(0);
    expect(result.constraintCount).toBe(0);
    expect(result.pairs[0]!.patch).not.toBeNull();
    expect(result.pairs[0]!.responded).toBe(false);
    expect(result.response.points).toHaveLength(0);
  });

  it('keeps exhaustive dispatch as a differential path around the default broadphase', () => {
    const makeColliders = () => [
      fixedCollider('a', [0, 0, 0, 0]),
      fixedCollider('b', [8, 0, 0, 0])
    ] as const;
    const sweep = new HyperboxContactPipeline4();
    for (const collider of makeColliders()) sweep.addCollider(collider);
    const sweepResult = sweep.solve(1 / 60);
    expect(sweepResult.possiblePairs).toBe(1);
    expect(sweepResult.candidatePairs).toBe(0);
    expect(sweepResult.broadphaseRejectedPairs).toBe(1);
    expect(sweepResult.narrowphasePairs).toBe(0);
    expect(sweepResult.pairs).toHaveLength(0);

    const exhaustive = new HyperboxContactPipeline4({
      candidateProvider: new AllPairsCandidateProviderN<HyperboxCollider4>()
    });
    for (const collider of makeColliders()) exhaustive.addCollider(collider);
    const exhaustiveResult = exhaustive.solve(1 / 60);
    expect(exhaustiveResult.broadphase.providerId).toBe('all-pairs');
    expect(exhaustiveResult.candidatePairs).toBe(1);
    expect(exhaustiveResult.narrowphasePairs).toBe(1);
    expect(exhaustiveResult.contactPairs).toBe(0);
    expect(exhaustiveResult.pairs[0]!.patch).toBeNull();
  });

  it('retires warm-start IDs when a contact disappears or is disabled', () => {
    const movingBody = body([0, 1, 0, 0], [0, -1, 0, 0]);
    const moving = dynamicCollider('moving', movingBody);
    const floor = fixedCollider('floor', [0, 0, 0, 0]);
    const pipeline = new HyperboxContactPipeline4({
      solverOptions: { iterations: 4, baumgarte: 0 }
    }).addCollider(moving).addCollider(floor);

    const first = pipeline.solve(1 / 60);
    const activeIds = first.response.points.map(({ id }) => id);
    expect(activeIds).toHaveLength(8);

    movingBody.position.data[1] = 10;
    const second = pipeline.solve(1 / 60);
    expect(second.constraintCount).toBe(0);
    expect(second.broadphaseRejectedPairs).toBe(1);
    expect(second.response.retiredIds).toEqual([...activeIds].sort());
    floor.enabled = false;
    expect(pipeline.solve(1 / 60).response.retiredIds).toEqual([]);
  });

  it('advances a gravity stack through the world constraint seam', () => {
    const value = body([0, 0.5, 0, 0]);
    const world = new PhysicsWorld4({ gravity: [0, -10, 0, 0] }).addBody(value);
    const box = dynamicCollider('box', value, {
      halfExtents: [0.5, 0.5, 0.5, 0.5]
    });
    const floor = fixedCollider('floor', [0, -0.5, 0, 0], {
      halfExtents: [5, 0.5, 5, 5]
    });
    const pipeline = new HyperboxContactPipeline4({
      solverOptions: {
        iterations: 12,
        baumgarte: 0,
        restitutionThreshold: 0.5
      }
    }).addCollider(floor).addCollider(box);

    let final = pipeline.stepWorld(world, 1 / 120);
    for (let step = 1; step < 600; step++) {
      final = pipeline.stepWorld(world, 1 / 120);
    }

    expect(final.substeps).toHaveLength(1);
    expect(final.final.contactPairs).toBe(1);
    expect(Math.abs(value.position.data[1]! - 0.5)).toBeLessThan(2e-7);
    expect(Math.abs(value.linearVelocity.data[1]!)).toBeLessThan(1e-10);
    expectArrayClose(box.shape.transform.position.data, value.position.data, 13);
  });

  it('rejects ambiguous IDs and invalid mutable policies', () => {
    const pipeline = new HyperboxContactPipeline4();
    pipeline.addCollider(fixedCollider('same', [0, 0, 0, 0]));
    expect(() => pipeline.addCollider(fixedCollider('same', [4, 0, 0, 0])))
      .toThrow(/duplicate/);
    expect(() => new HyperboxContactPipeline4({
      solver: pipeline.solver,
      solverOptions: {}
    })).toThrow(/provide solver or solverOptions/);
    expect(() => hyperboxPairId4('', 'valid')).toThrow(/must not be empty/);

    const dynamic = dynamicCollider('dynamic', body([1.5, 0, 0, 0]));
    pipeline.addCollider(dynamic);
    dynamic.friction = -1;
    expect(() => pipeline.solve(1 / 60)).toThrow(/friction/);
    dynamic.friction = 0;
    dynamic.restitution = 2;
    expect(() => pipeline.solve(1 / 60)).toThrow(/restitution/);
    dynamic.restitution = 0;
    dynamic.collisionMask = -1;
    expect(() => pipeline.solve(1 / 60)).toThrow(/unsigned 32-bit/);
  });

  it('rejects duplicate pairs from a custom candidate provider', () => {
    const golden = new AllPairsCandidateProviderN<HyperboxCollider4>();
    const duplicateProvider: BroadphaseCandidateProviderN<HyperboxCollider4> = {
      id: 'duplicate-test',
      compute(proxies) {
        const result = golden.compute(proxies);
        return { ...result, pairs: [...result.pairs, ...result.pairs] };
      }
    };
    const pipeline = new HyperboxContactPipeline4({
      candidateProvider: duplicateProvider
    })
      .addCollider(fixedCollider('a', [0, 0, 0, 0]))
      .addCollider(fixedCollider('b', [1, 0, 0, 0]));
    expect(() => pipeline.solve(1 / 60)).toThrow(/duplicate candidate pair/);
  });
});
