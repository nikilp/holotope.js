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
  ContactSolver4,
  ConvexHullSupportShapeN,
  GlomeCollider4,
  GlomeSupportShapeN,
  HyperboxCollider4,
  HyperplaneColliderN,
  HyperplaneContactCollider4,
  PhysicsWorld4,
  PolytopeCollider4,
  RigidBody4,
  contactConstraintFromSmoothPointPatch4,
  contactPairId4,
  glomeHyperplaneContactN,
  type CompactContactCollider4
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

function dynamicGlome(
  id: string,
  value: RigidBody4,
  options: { radius?: number; friction?: number; restitution?: number } = {}
): GlomeCollider4 {
  return new GlomeCollider4({
    id,
    radius: options.radius ?? 1,
    participant: value,
    material: {
      friction: options.friction ?? 0,
      restitution: options.restitution ?? 0
    }
  });
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

describe('smooth point contact response adapter', () => {
  it('retains actual ordered anchors and feeds normal plus tangent response', () => {
    const value = body([0, 0.75, 0, 0], [2, -3, 4, 1]);
    const glome = new GlomeCollider4({ id: 'glome', radius: 1, participant: value });
    const floor = new HyperplaneContactCollider4({
      id: 'floor',
      normal: [0, 1, 0, 0],
      material: { friction: 0.8 }
    });
    const query = glomeHyperplaneContactN(glome.shape, floor.shape);
    const constraint = contactConstraintFromSmoothPointPatch4(
      query.patch!,
      value,
      null,
      { pairId: 'glome/floor', friction: 0.8 }
    );

    expect(constraint.id).toBe('glome/floor|smooth-point');
    expectArrayClose(constraint.anchorA.data, query.pointA.data);
    expectArrayClose(constraint.anchorB.data, query.pointB.data);
    const solved = new ContactSolver4({ iterations: 12, baumgarte: 0 })
      .solve([constraint], 1 / 60);
    expect(solved.points[0]!.finalNormalSpeed).toBeGreaterThanOrEqual(-1e-12);
    expect(solved.points[0]!.tangentImpulseWorld.length()).toBeGreaterThan(0);

    expect(() => contactConstraintFromSmoothPointPatch4(
      glomeHyperplaneContactN(
        // Deliberately construct a valid R3 patch at the public adapter boundary.
        new GlomeSupportShapeN([0, 0, 0], 1),
        new HyperplaneColliderN([0, 1, 0], 0)
      ).patch!,
      value,
      null,
      { pairId: 'wrong-dimension' }
    )).toThrow(/finite R4 vector/);
  });
});

describe('mixed ContactPipeline4', () => {
  it('stops a fast glome at an infinite floor through opt-in linear CCD', () => {
    const value = body([0, 5, 0, 0], [0, -100, 0, 0]);
    const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(value);
    const pipeline = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0 }
    })
      .addCollider(dynamicGlome('body', value))
      .addCollider(new HyperplaneContactCollider4({
        id: 'floor',
        normal: [0, 1, 0, 0]
      }));

    const result = pipeline.stepWorldContinuous(world, 0.1);
    expect(result.status).toBe('complete');
    expect(result.substeps[0]!.events).toHaveLength(1);
    expect(result.substeps[0]!.events[0]!.pairId).toBe(
      contactPairId4('body', 'floor')
    );
    expect(result.substeps[0]!.events[0]!.time).toBeCloseTo(0.04, 12);
    expect(result.substeps[0]!.events[0]!.cast.kind).toBe('hyperplane');
    expect(value.position.data[1]).toBeCloseTo(1, 10);
    expect(value.linearVelocity.data[1]).toBeCloseTo(0, 10);
    expect(result.final.contactPairs).toBe(1);
  });

  it('resolves a fast compact/compact impact before either discrete endpoint', () => {
    const value = body([-5, 0, 0, 0], [100, 0, 0, 0]);
    const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(value);
    const pipeline = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0 }
    })
      .addCollider(dynamicGlome('moving', value))
      .addCollider(new GlomeCollider4({
        id: 'fixed',
        center: [0, 0, 0, 0],
        radius: 1,
        material: { friction: 0 }
      }));

    const result = pipeline.stepWorldContinuous(world, 0.1);
    expect(result.status).toBe('complete');
    expect(result.substeps[0]!.events).toHaveLength(1);
    expect(result.substeps[0]!.events[0]!.time).toBeCloseTo(0.03, 10);
    expect(result.substeps[0]!.events[0]!.cast.kind).toBe('convex');
    expect(value.position.data[0]).toBeCloseTo(-2, 9);
    expect(value.linearVelocity.data[0]).toBeCloseTo(0, 9);
  });

  it('matches the exhaustive CCD lane while rejecting distant swept pairs', () => {
    const run = (exhaustive: boolean) => {
      const value = body([-5, 0, 0, 0], [100, 0, 0, 0]);
      const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(value);
      const pipeline = new ContactPipeline4({
        solverOptions: { iterations: 12, baumgarte: 0 },
        ...(exhaustive
          ? {
              candidateProvider:
                new AllPairsCandidateProviderN<CompactContactCollider4>()
            }
          : {})
      })
        .addCollider(dynamicGlome('moving', value))
        .addCollider(new GlomeCollider4({
          id: 'target',
          center: [0, 0, 0, 0],
          radius: 1,
          material: { friction: 0 }
        }));
      for (let index = 0; index < 10; index++) {
        pipeline.addCollider(new GlomeCollider4({
          id: `distant-${index.toString().padStart(2, '0')}`,
          center: [0, 20 + index * 4, 0, 0],
          radius: 1,
          material: { friction: 0 }
        }));
      }
      return {
        value,
        result: pipeline.stepWorldContinuous(world, 0.1)
      };
    };

    const swept = run(false);
    const exhaustive = run(true);
    expect(swept.result.status).toBe('complete');
    expect(exhaustive.result.status).toBe('complete');
    expect(swept.result.substeps[0]!.events.map(({ pairId }) => pairId))
      .toEqual(exhaustive.result.substeps[0]!.events.map(({ pairId }) => pairId));
    expect(swept.result.substeps[0]!.events[0]!.time)
      .toBeCloseTo(exhaustive.result.substeps[0]!.events[0]!.time, 12);
    expectArrayClose(swept.value.position.data, exhaustive.value.position.data, 10);
    expectArrayClose(
      swept.value.linearVelocity.data,
      exhaustive.value.linearVelocity.data,
      10
    );
    const sweptSubstep = swept.result.substeps[0]!;
    const exhaustiveSubstep = exhaustive.result.substeps[0]!;
    expect(sweptSubstep.sweptBroadphase[0]!.providerId).toBe('sweep-and-prune');
    expect(sweptSubstep.sweptBroadphase[0]!.rejectedPairs).toBeGreaterThan(0);
    expect(exhaustiveSubstep.sweptBroadphase[0]!.providerId).toBe('all-pairs');
    expect(sweptSubstep.castPairs).toBeLessThan(exhaustiveSubstep.castPairs);
  });

  it('uses general polytope/plane response for a fast non-spinning tesseract', () => {
    const source = ConvexHullSupportShapeN.fromCellComplex(
      createHypercube({ dim: 4, size: 2 })
    );
    const value = body([0, 5, 0, 0], [0, -100, 0, 0]);
    const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] }).addBody(value);
    const pipeline = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0 }
    })
      .addCollider(new PolytopeCollider4({
        id: 'body',
        source,
        participant: value,
        material: { friction: 0 }
      }))
      .addCollider(new HyperplaneContactCollider4({
        id: 'floor',
        normal: [0, 1, 0, 0],
        material: { friction: 0 }
      }));

    const result = pipeline.stepWorldContinuous(world, 0.1);
    // The impact itself is resolved continuously. Sequential manifold
    // response leaves a tiny spin, so the remaining trajectory is correctly
    // reported as a rotational discrete fallback.
    expect(result.status).toBe('partial');
    expect(result.substeps[0]!.events).toHaveLength(1);
    expect(result.substeps[0]!.events[0]!.solve.constraintCount).toBe(8);
    expect(result.substeps[0]!.angularFallbackPairIds).toEqual([
      contactPairId4('body', 'floor')
    ]);
    expect(value.position.data[1]).toBeCloseTo(1, 6);
    expect(Math.abs(value.linearVelocity.data[1]!)).toBeLessThan(1e-5);
    expect(result.final.pairs[0]!.narrowphase.kind).toBe('deep-manifold');
  });

  it('reports honest angular fallback and a bounded impact-event limit', () => {
    const source = ConvexHullSupportShapeN.fromCellComplex(
      createHypercube({ dim: 4, size: 2 })
    );
    const spinning = body([0, 5, 0, 0], [0, -1, 0, 0]);
    spinning.setAngularVelocityWorld(new BivectorN(4, [1, 0, 0, 0, 0, 0]));
    const spinningWorld = new PhysicsWorld4({ gravity: [0, 0, 0, 0] })
      .addBody(spinning);
    const spinningPipeline = new ContactPipeline4()
      .addCollider(new PolytopeCollider4({
        id: 'body',
        source,
        participant: spinning
      }))
      .addCollider(new HyperplaneContactCollider4({
        id: 'floor',
        normal: [0, 1, 0, 0]
      }));
    const partial = spinningPipeline.stepWorldContinuous(spinningWorld, 0.1);
    expect(partial.status).toBe('partial');
    expect(partial.substeps[0]!.angularFallbackPairIds).toEqual([
      contactPairId4('body', 'floor')
    ]);

    const projectile = body([0, 0, 0, 0], [100, 0, 0, 0]);
    const corridorWorld = new PhysicsWorld4({ gravity: [0, 0, 0, 0] })
      .addBody(projectile);
    const corridor = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0 }
    })
      .addCollider(dynamicGlome('ball', projectile, { radius: 0.5, restitution: 1 }))
      .addCollider(new HyperplaneContactCollider4({
        id: 'left',
        normal: [1, 0, 0, 0],
        offset: -2,
        material: { restitution: 1 }
      }))
      .addCollider(new HyperplaneContactCollider4({
        id: 'right',
        normal: [-1, 0, 0, 0],
        offset: -2,
        material: { restitution: 1 }
      }));
    const limited = corridor.stepWorldContinuous(corridorWorld, 0.1, 1, {
      maxEventsPerSubstep: 1
    });
    expect(limited.status).toBe('event-limit');
    expect(limited.substeps[0]!.events).toHaveLength(1);
    expect(limited.substeps[0]!.remainingDt).toBeGreaterThan(0);
    expect(limited.substeps[0]!.advancedDt).toBeCloseTo(0.015, 10);
  });

  it('dispatches stable general-polytope manifolds into shared response', () => {
    const source = ConvexHullSupportShapeN.fromCellComplex(
      createHypercube({ dim: 4, size: 2 })
    );
    const value = body([0, 0, 0, 0], [2, 0, 0, 0]);
    const moving = new PolytopeCollider4({
      id: 'body',
      source,
      participant: value,
      material: { friction: 0 }
    });
    const fixed = new PolytopeCollider4({
      id: 'wall',
      source,
      transform: new TransformN(4, undefined, new VecN([1.5, 0, 0, 0])),
      material: { friction: 0 }
    });
    const pipeline = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0 }
    }).addCollider(moving).addCollider(fixed);
    expect(moving.topology).toBe(fixed.topology);

    const first = pipeline.solve(1 / 60);
    expect(first).toMatchObject({
      compactColliderCount: 2,
      contactPairs: 1,
      respondingPairs: 1,
      constraintCount: 8
    });
    expect(first.pairs[0]!.narrowphase.kind).toBe('deep-manifold');
    const firstNarrowphase = first.pairs[0]!.narrowphase;
    if (firstNarrowphase.kind !== 'deep-manifold') {
      throw new Error('expected deep manifold');
    }
    expect(firstNarrowphase.algorithm).toBe('polytope4');
    if (firstNarrowphase.algorithm !== 'polytope4') {
      throw new Error('expected generic polytope algorithm');
    }
    expect(firstNarrowphase.query.patch?.diagnostics.hullA).toMatchObject({
      topologySource: 'compiled',
      facetCandidates: 1820,
      queryFacetCandidates: 0
    });
    expect(first.pairs[0]!.constraintIds).toHaveLength(8);
    expect(first.response.totalNormalImpulse).toBeGreaterThan(0);
    const ids = first.pairs[0]!.constraintIds;

    fixed.setTransform(
      new TransformN(4, undefined, new VecN([1.4, 0, 0, 0]))
    );
    const second = pipeline.solve(1 / 60);
    expect(second.pairs[0]!.constraintIds).toEqual(ids);
    expect(second.pairs[0]!.narrowphase.cacheStatus).toBe('hit');
    expect(second.response.points.some(({ warmStartedImpulse }) =>
      warmStartedImpulse > 0
    )).toBe(true);

    expect(() => new PolytopeCollider4({
      id: 'smooth',
      source: new GlomeSupportShapeN([0, 0, 0, 0], 1)
    })).toThrow(/vertex-enumerable/);
    expect(() => new PolytopeCollider4({
      id: 'owned-pose',
      source,
      participant: value,
      transform: TransformN.identity(4)
    })).toThrow(/owns its world transform/);
  });

  it('solves a complete general-polytope support face against an infinite plane', () => {
    const source = ConvexHullSupportShapeN.fromCellComplex(
      createHypercube({ dim: 4, size: 2 })
    );
    const value = body([0, 0.75, 0, 0], [0, -2, 0, 0]);
    const polytope = new PolytopeCollider4({
      id: 'body',
      source,
      participant: value,
      material: { friction: 0 }
    });
    const floor = new HyperplaneContactCollider4({
      id: 'floor',
      normal: [0, 1, 0, 0],
      material: { friction: 0 }
    });
    const pipeline = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0 }
    }).addCollider(polytope).addCollider(floor);

    const first = pipeline.solve(1 / 60);
    expect(first).toMatchObject({
      compactColliderCount: 1,
      hyperplaneColliderCount: 1,
      contactPairs: 1,
      respondingPairs: 1,
      constraintCount: 8
    });
    const narrowphase = first.pairs[0]!.narrowphase;
    expect(narrowphase.kind).toBe('deep-manifold');
    if (
      narrowphase.kind !== 'deep-manifold' ||
      narrowphase.algorithm !== 'polytope-hyperplane4'
    ) throw new Error('expected polytope-hyperplane4');
    expect(narrowphase.query.patch?.diagnostics).toMatchObject({
      topologySource: 'compiled',
      queryFacetCandidates: 0,
      supportVertices: 8,
      solverPoints: 8
    });
    expect(Math.abs(value.linearVelocity.data[1]!)).toBeLessThan(1e-7);
    const ids = first.pairs[0]!.constraintIds;

    value.linearVelocity.data[1] = -1;
    floor.setPlane([0, 1, 0, 0], 0.05);
    const second = pipeline.solve(1 / 60);
    expect(second.pairs[0]!.constraintIds).toEqual(ids);
    expect(second.response.points.some(({ warmStartedImpulse }) =>
      warmStartedImpulse > 0
    )).toBe(true);
  });

  it('synchronizes a body-local glome center', () => {
    const value = body([1, 2, 3, 4]);
    value.rotation = Rotor4.fromPlane(0, 1, Math.PI / 2);
    const collider = new GlomeCollider4({
      id: 'offset',
      radius: 0.5,
      participant: value,
      localCenter: [2, 0, 0, 0]
    });
    const expected = value.rotation.applyToPoint(new VecN([2, 0, 0, 0]))
      .add(value.position);
    expectArrayClose(collider.shape.center.data, expected.data);
    expect(() => collider.setCenter([0, 0, 0, 0])).toThrow(/authoritative/);

    collider.setParticipant(null);
    expectArrayClose(collider.shape.center.data, expected.data);
    collider.setCenter([-1, -2, -3, -4]);
    expectArrayClose(collider.shape.center.data, [-1, -2, -3, -4]);
    expect(() => new GlomeCollider4({
      id: 'invalid-local',
      radius: 1,
      localCenter: [1, 0, 0, 0]
    })).toThrow(/requires a dynamic body/);
    expect(() => new HyperplaneContactCollider4({
      id: 'dynamic-plane',
      normal: [0, 1, 0, 0],
      participant: value as never
    })).toThrow(/infinite plane/);
  });

  it('dispatches and solves an exact glome/hyperplane point contact', () => {
    const value = body([0, 0.75, 0, 0], [3, -2, 4, 1]);
    const glome = dynamicGlome('body', value, { friction: 0.5 });
    const floor = new HyperplaneContactCollider4({
      id: 'floor',
      normal: [0, 1, 0, 0],
      material: { friction: 0.5 }
    });
    const result = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0 }
    }).addCollider(floor).addCollider(glome).solve(1 / 60);

    expect(result).toMatchObject({
      colliderCount: 2,
      compactColliderCount: 1,
      hyperplaneColliderCount: 1,
      possiblePairs: 1,
      candidatePairs: 1,
      compactCandidatePairs: 0,
      hyperplaneCandidatePairs: 1,
      broadphaseRejectedPairs: 0,
      filteredPairs: 0,
      narrowphasePairs: 1,
      distancePairs: 0,
      unsupportedPairs: 0,
      contactPairs: 1,
      respondingPairs: 1,
      constraintCount: 1
    });
    expect(result.pairs[0]!.id).toBe(contactPairId4('body', 'floor'));
    expect(result.pairs[0]!.narrowphase.kind).toBe('deep-manifold');
    if (result.pairs[0]!.narrowphase.kind !== 'deep-manifold') {
      throw new Error('expected deep manifold');
    }
    expect(result.pairs[0]!.narrowphase.algorithm).toBe('glome-hyperplane');
    expect(result.response.points[0]!.finalNormalSpeed).toBeGreaterThanOrEqual(-1e-12);
    expect(result.response.points[0]!.frictionState).toBe('sliding');
  });

  it('preserves response direction when the hyperplane is ordered as shape A', () => {
    const value = body([0, 0.75, 0, 0], [0, -2, 0, 0]);
    const result = new ContactPipeline4({
      solverOptions: { iterations: 8, baumgarte: 0 }
    })
      .addCollider(dynamicGlome('z-body', value))
      .addCollider(new HyperplaneContactCollider4({
        id: 'a-floor',
        normal: [0, 1, 0, 0]
      }))
      .solve(1 / 60);

    expect(result.pairs[0]!.colliderA.id).toBe('a-floor');
    expect(result.pairs[0]!.patch?.normal.data[1]).toBeCloseTo(-1, 14);
    expect(value.linearVelocity.data[1]).toBeCloseTo(0, 12);
    expect(result.response.points[0]!.finalNormalSpeed).toBeGreaterThanOrEqual(-1e-12);
  });

  it('holds a glome at rest on an infinite floor through the world seam', () => {
    const value = body([0, 1, 0, 0]);
    const world = new PhysicsWorld4().addBody(value);
    const pipeline = new ContactPipeline4({
      solverOptions: { iterations: 8, baumgarte: 0.2 }
    })
      .addCollider(dynamicGlome('body', value))
      .addCollider(new HyperplaneContactCollider4({
        id: 'floor',
        normal: [0, 1, 0, 0]
      }));

    let final = pipeline.stepWorld(world, 1 / 120).final;
    for (let step = 1; step < 600; step++) {
      final = pipeline.stepWorld(world, 1 / 120).final;
    }
    expect(value.position.data[1]).toBeCloseTo(1, 11);
    expect(value.linearVelocity.data[1]).toBeCloseTo(0, 11);
    expect(final.contactPairs).toBe(1);
    expect(final.constraintCount).toBe(1);
    expect(final.response.points[0]!.warmStartedImpulse).toBeGreaterThan(0);
  });

  it('damps three rolling modes without touching the three hidden spin modes', () => {
    const value = body([0, 1, 0, 0], [2, -4, 3, 5]);
    value.setAngularVelocityWorld(new BivectorN(4, [1, 2, 3, 4, 5, 6]));
    const before = value.angularMomentumWorld.coeffs.slice();
    const result = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0 }
    })
      .addCollider(dynamicGlome('body', value, { friction: 10 }))
      .addCollider(new HyperplaneContactCollider4({
        id: 'floor',
        normal: [0, 1, 0, 0],
        material: { friction: 10 }
      }))
      .solve(1 / 60);

    const after = value.angularMomentumWorld.coeffs;
    // xz, xw, and zw lie wholly in the floor tangent 3-flat.
    for (const component of [1, 2, 5]) {
      expect(after[component]).toBeCloseTo(before[component]!, 13);
    }
    expect([0, 3, 4].some((component) =>
      Math.abs(after[component]! - before[component]!) > 1e-6
    )).toBe(true);
    expect(result.response.maxTangentialSpeed).toBeLessThan(1e-10);
  });

  it('resolves a central elastic glome pair independently of insertion order', () => {
    const run = (reverse: boolean) => {
      const leftBody = body([-0.9, 0, 0, 0], [1, 0, 0, 0]);
      const rightBody = body([0.9, 0, 0, 0], [-1, 0, 0, 0]);
      const left = dynamicGlome('left', leftBody, { restitution: 1 });
      const right = dynamicGlome('right', rightBody, { restitution: 1 });
      const pipeline = new ContactPipeline4({
        solverOptions: {
          iterations: 12,
          restitutionThreshold: 0,
          baumgarte: 0
        }
      });
      for (const collider of reverse ? [right, left] : [left, right]) {
        pipeline.addCollider(collider);
      }
      const result = pipeline.solve(1 / 60);
      return {
        ids: result.pairs.map(({ id }) => id),
        algorithms: result.pairs.map(({ narrowphase }) =>
          narrowphase.kind === 'deep-manifold' ? narrowphase.algorithm : narrowphase.kind
        ),
        leftVelocity: Array.from(leftBody.linearVelocity.data),
        rightVelocity: Array.from(rightBody.linearVelocity.data),
        constraints: result.constraintCount
      };
    };

    const result = run(false);
    expect(result).toEqual(run(true));
    expect(result.algorithms).toEqual(['glome-glome']);
    expect(result.leftVelocity[0]).toBeCloseTo(-1, 12);
    expect(result.rightVelocity[0]).toBeCloseTo(1, 12);
    expect(result.constraints).toBe(1);
  });

  it('retains the existing exact hyperbox algorithm inside mixed orchestration', () => {
    const leftBody = body([-0.75, 0, 0, 0], [1, 0, 0, 0]);
    const rightBody = body([0.75, 0, 0, 0], [-1, 0, 0, 0]);
    const result = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0 }
    })
      .addCollider(new HyperboxCollider4({
        id: 'left-box',
        halfExtents: [1, 1, 1, 1],
        participant: leftBody
      }))
      .addCollider(new HyperboxCollider4({
        id: 'right-box',
        halfExtents: [1, 1, 1, 1],
        participant: rightBody
      }))
      .solve(1 / 60);

    expect(result.pairs[0]!.narrowphase.kind).toBe('deep-manifold');
    if (result.pairs[0]!.narrowphase.kind !== 'deep-manifold') {
      throw new Error('expected deep manifold');
    }
    expect(result.pairs[0]!.narrowphase.algorithm).toBe('hyperbox4');
    expect(result.contactPairs).toBe(1);
    expect(result.constraintCount).toBe(8);
  });

  it('resolves a dynamic glome against a fixed hyperbox through exact mixed contact', () => {
    const value = body([1.5, 0, 0, 0], [-2, 0, 0, 0]);
    const result = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0 }
    })
      .addCollider(dynamicGlome('body-glome', value))
      .addCollider(new HyperboxCollider4({
        id: 'fixed-box',
        halfExtents: [1, 1, 1, 1]
      }))
      .solve(1 / 60);

    expect(result.pairs[0]!.narrowphase.kind).toBe('deep-manifold');
    if (result.pairs[0]!.narrowphase.kind !== 'deep-manifold') {
      throw new Error('expected deep manifold');
    }
    expect(result.pairs[0]!.narrowphase.algorithm).toBe('glome-hyperbox4');
    expect(result.constraintCount).toBe(1);
    expect(result.unsupportedPairs).toBe(0);
    expect(value.linearVelocity.data[0]).toBeCloseTo(0, 12);
    expect(result.response.points[0]!.finalNormalSpeed).toBeGreaterThanOrEqual(-1e-12);
  });

  it('holds a hyperbox on a plane with its complete 3D support feature', () => {
    const value = body([0, 1, 0, 0]);
    const world = new PhysicsWorld4().addBody(value);
    const pipeline = new ContactPipeline4({
      solverOptions: { iterations: 12, baumgarte: 0.2 }
    })
      .addCollider(new HyperboxCollider4({
        id: 'body-box',
        halfExtents: [1, 1, 1, 1],
        participant: value
      }))
      .addCollider(new HyperplaneContactCollider4({
        id: 'floor',
        normal: [0, 1, 0, 0]
      }));

    let final = pipeline.stepWorld(world, 1 / 120).final;
    for (let step = 1; step < 360; step++) {
      final = pipeline.stepWorld(world, 1 / 120).final;
    }
    expect(value.position.data[1]).toBeCloseTo(1, 10);
    expect(value.linearVelocity.data[1]).toBeCloseTo(0, 10);
    expect(final.pairs[0]!.narrowphase.kind).toBe('deep-manifold');
    if (final.pairs[0]!.narrowphase.kind !== 'deep-manifold') {
      throw new Error('expected deep manifold');
    }
    expect(final.pairs[0]!.narrowphase.algorithm).toBe('hyperbox-hyperplane4');
    expect(final.constraintCount).toBe(8);
    expect(final.response.points.every(({ warmStartedImpulse }) =>
      warmStartedImpulse > 0
    )).toBe(true);
  });

  it('preserves box-plane response when the plane is ordered as shape A', () => {
    const value = body([0, 0.75, 0, 0], [0, -2, 0, 0]);
    const result = new ContactPipeline4({
      solverOptions: { iterations: 32, baumgarte: 0 }
    })
      .addCollider(new HyperboxCollider4({
        id: 'z-box',
        halfExtents: [1, 1, 1, 1],
        participant: value
      }))
      .addCollider(new HyperplaneContactCollider4({
        id: 'a-floor',
        normal: [0, 1, 0, 0]
      }))
      .solve(1 / 60);

    expect(result.pairs[0]!.colliderA.id).toBe('a-floor');
    expect(result.pairs[0]!.patch?.normal.data[1]).toBeCloseTo(-1, 14);
    expect(value.linearVelocity.data[1]).toBeCloseTo(0, 12);
    expect(result.constraintCount).toBe(8);
  });

  it('keeps coincident glome centers observable without inventing response', () => {
    const result = new ContactPipeline4()
      .addCollider(new GlomeCollider4({
        id: 'first',
        radius: 1,
        center: [0, 0, 0, 0]
      }))
      .addCollider(new GlomeCollider4({
        id: 'second',
        radius: 2,
        center: [0, 0, 0, 0]
      }))
      .solve(1 / 60);

    const narrowphase = result.pairs[0]!.narrowphase;
    expect(narrowphase.kind).toBe('deep-manifold');
    if (
      narrowphase.kind !== 'deep-manifold' ||
      narrowphase.algorithm !== 'glome-glome'
    ) throw new Error('expected glome pair');
    expect(narrowphase.query.status).toBe('coincident-centers');
    expect(narrowphase.query.patch).toBeNull();
    expect(result.contactPairs).toBe(0);
    expect(result.constraintCount).toBe(0);
  });

  it('keeps finite broadphase and infinite-plane candidacy explicit', () => {
    const box = new HyperboxCollider4({
      id: 'box',
      halfExtents: [1, 1, 1, 1]
    });
    const glome = new GlomeCollider4({
      id: 'glome',
      radius: 0.75,
      center: [1.5, 4, 0, 0]
    });
    const plane = new HyperplaneContactCollider4({
      id: 'plane',
      normal: [0, 1, 0, 0],
      offset: -10
    });
    const pipeline = new ContactPipeline4()
      .addCollider(plane)
      .addCollider(glome)
      .addCollider(box);
    const first = pipeline.solve(1 / 60);

    expect(first.possiblePairs).toBe(3);
    expect(first.compactCandidatePairs).toBe(0);
    expect(first.hyperplaneCandidatePairs).toBe(2);
    expect(first.candidatePairs).toBe(2);
    expect(first.distancePairs).toBe(0);
    expect(first.unsupportedPairs).toBe(0);
    expect(first.pairs.map(({ narrowphase }) =>
      narrowphase.kind === 'deep-manifold' ? narrowphase.algorithm : narrowphase.kind
    )).toEqual(['hyperbox-hyperplane4', 'glome-hyperplane']);

    glome.setCenter([1.5, 0, 0, 0]);
    const overlapping = pipeline.solve(1 / 60);
    expect(overlapping.compactCandidatePairs).toBe(1);
    expect(overlapping.distancePairs).toBe(0);
    expect(overlapping.unsupportedPairs).toBe(0);
    expect(overlapping.pairs.map(({ narrowphase }) =>
      narrowphase.kind === 'deep-manifold' ? narrowphase.algorithm : narrowphase.kind
    )).toEqual([
      'glome-hyperbox4',
      'hyperbox-hyperplane4',
      'glome-hyperplane'
    ]);
    expect(overlapping.pairs.every(({ narrowphase }) =>
      narrowphase.cacheStatus === 'unused'
    )).toBe(true);

    glome.enabled = false;
    const retired = pipeline.solve(1 / 60);
    expect(retired.retiredNarrowphasePairIds).toEqual([]);
  });

  it('filters mixed pairs before dispatch and validates policy', () => {
    const glome = new GlomeCollider4({ id: 'glome', radius: 1 });
    const plane = new HyperplaneContactCollider4({
      id: 'plane',
      normal: [0, 1, 0, 0]
    });
    glome.collisionGroup = 1;
    glome.collisionMask = 1;
    plane.collisionGroup = 2;
    plane.collisionMask = 2;
    const pipeline = new ContactPipeline4().addCollider(glome).addCollider(plane);
    expect(pipeline.solve(1 / 60)).toMatchObject({
      candidatePairs: 1,
      filteredPairs: 1,
      narrowphasePairs: 0
    });
    glome.collisionMask = 2;
    plane.collisionMask = 1;
    glome.friction = Number.NaN;
    expect(() => pipeline.solve(1 / 60)).toThrow(/friction/);
  });
});
