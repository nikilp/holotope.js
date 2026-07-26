import { MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneBarrierN,
  XpbdParticleHyperplaneBarrierStepFilterN,
  XpbdParticleN,
  applyXpbdIncrementalPotentialResultN,
  compileXpbdIncrementalPotentialProblemN,
  minimizeXpbdIncrementalPotentialN,
  searchXpbdIncrementalPotentialArmijoN,
  stepXpbdIncrementalPotentialN,
  type XpbdIncrementalPotentialStepFilterContextN,
  type XpbdIncrementalPotentialStepFilterN
} from '../src/index.js';

function context(
  before: VecN,
  after: VecN,
  requestedStepLength = 1
): XpbdIncrementalPotentialStepFilterContextN {
  return {
    dimension: before.dim,
    requestedStepLength,
    positionBefore: () => before,
    positionAfter: () => after
  };
}

function barrier(
  particle: XpbdParticleN,
  plane: HyperplaneColliderN,
  minimumDistance = 0.1
): XpbdParticleHyperplaneBarrierN {
  return new XpbdParticleHyperplaneBarrierN({
    id: `${particle.id}-barrier`,
    particle,
    plane,
    minimumDistance,
    activationDistance: minimumDistance + 0.8,
    stiffness: 1e-3
  });
}

describe('incremental-potential admissible-step filters', () => {
  it('solves the same exact affine point-plane impact from R1 through R7', () => {
    for (const dimension of [1, 2, 4, 7]) {
      const axis = dimension - 1;
      const start = new Float64Array(dimension);
      const end = new Float64Array(dimension);
      start[axis] = 0.6;
      end[axis] = -0.2;
      const particle = new XpbdParticleN({
        id: `r${dimension}`,
        position: start
      });
      const filter = new XpbdParticleHyperplaneBarrierStepFilterN({
        id: `filter-r${dimension}`,
        barrier: barrier(
          particle,
          new HyperplaneColliderN(VecN.basis(dimension, axis), 0.1),
          0.1
        )
      });
      const result = filter.evaluate(
        context(new VecN(start), new VecN(end), 2)
      );

      expect(result.status).toBe('limited');
      if (result.status !== 'limited') continue;
      expect(result.startMargin).toBeCloseTo(0.4, 14);
      expect(result.endMargin).toBeCloseTo(-0.4, 14);
      expect(result.impactFraction).toBeCloseTo(0.5, 14);
      expect(result.impactStepLength).toBeCloseTo(1, 14);
      expect(result.maximumStepLength).toBeCloseTo(0.9, 14);
    }
  });

  it('is covariant under a common R4 rotation and translation', () => {
    const normal = new VecN([1, -2, 0.5, 1.5]).normalize();
    const planeOffset = 0.2;
    const before = new VecN([0.8, -0.1, 0.4, 0.7]);
    const after = before.clone().add(normal.clone().multiplyScalar(-1.4));
    const rotation = MatN.rotationInPlane(4, 0, 3, 0.63)
      .multiply(MatN.rotationInPlane(4, 1, 2, -0.47));
    const translation = new VecN([1, -0.5, 2, 0.3]);
    const movedNormal = rotation.applyTo(normal);
    const movedBefore = rotation.applyTo(before).add(translation);
    const movedAfter = rotation.applyTo(after).add(translation);
    const movedOffset = planeOffset + movedNormal.dot(translation);

    const evaluate = (
      id: string,
      start: VecN,
      end: VecN,
      plane: HyperplaneColliderN
    ) => {
      const particle = new XpbdParticleN({ id, position: start });
      return new XpbdParticleHyperplaneBarrierStepFilterN({
        id: `${id}-filter`,
        barrier: barrier(particle, plane)
      }).evaluate(context(start, end, 1.7));
    };
    const base = evaluate(
      'base',
      before,
      after,
      new HyperplaneColliderN(normal, planeOffset)
    );
    const moved = evaluate(
      'moved',
      movedBefore,
      movedAfter,
      new HyperplaneColliderN(movedNormal, movedOffset)
    );

    expect(moved.status).toBe(base.status);
    expect(moved.startMargin).toBeCloseTo(base.startMargin, 13);
    expect(moved.endMargin).toBeCloseTo(base.endMargin, 13);
    expect(moved.impactFraction).toBeCloseTo(base.impactFraction!, 13);
    if (base.status === 'limited' && moved.status === 'limited') {
      expect(moved.maximumStepLength)
        .toBeCloseTo(base.maximumStepLength, 13);
    }
  });

  it('distinguishes safe, limited, and initial-domain-refused segments', () => {
    const particle = new XpbdParticleN({ id: 'branches', position: [0.5] });
    const filter = new XpbdParticleHyperplaneBarrierStepFilterN({
      id: 'branches-filter',
      barrier: barrier(
        particle,
        new HyperplaneColliderN([1]),
        0.1
      ),
      conservativeScale: 0.75
    });
    expect(filter.evaluate(
      context(new VecN([0.5]), new VecN([0.3]), 2)
    )).toMatchObject({
      status: 'safe',
      maximumStepLength: 2,
      impactFraction: null
    });
    expect(filter.evaluate(
      context(new VecN([0.5]), new VecN([-0.1]), 2)
    )).toMatchObject({
      status: 'limited',
      impactFraction: 2 / 3,
      impactStepLength: 4 / 3,
      maximumStepLength: 1
    });
    expect(filter.evaluate(
      context(new VecN([0.1]), new VecN([0.5]), 2)
    )).toMatchObject({
      status: 'indeterminate',
      reason: 'initial-domain-violation'
    });
  });

  it('does not mutate live particles or caller endpoint vectors', () => {
    const particle = new XpbdParticleN({ id: 'immutable', position: [0.5, 2] });
    const before = new VecN([0.5, 2]);
    const after = new VecN([-0.1, 7]);
    const filter = new XpbdParticleHyperplaneBarrierStepFilterN({
      id: 'immutable-filter',
      barrier: barrier(particle, new HyperplaneColliderN([1, 0]))
    });
    const liveSnapshot = particle.position.toArray();
    const beforeSnapshot = before.toArray();
    const afterSnapshot = after.toArray();

    filter.evaluate(context(before, after));

    expect(particle.position.toArray()).toEqual(liveSnapshot);
    expect(before.toArray()).toEqual(beforeSnapshot);
    expect(after.toArray()).toEqual(afterSnapshot);
  });

  it('caps Armijo before an otherwise domain-crossing first trial', () => {
    const particle = new XpbdParticleN({
      id: 'search',
      position: [0.5],
      inverseMass: 1
    });
    const provider = barrier(particle, new HyperplaneColliderN([1]));
    const filter = new XpbdParticleHyperplaneBarrierStepFilterN({
      id: 'search-filter',
      barrier: provider
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 0.1,
      providers: [provider],
      stepFilters: [filter]
    });
    const result = searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [0.5],
      direction: [-0.6]
    });

    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    expect(result.stepFilters).toHaveLength(1);
    expect(result.stepFilters[0]).toMatchObject({
      filterId: 'search-filter',
      evaluation: { status: 'limited' }
    });
    const evaluation = result.stepFilters[0]!.evaluation;
    if (evaluation.status !== 'limited') return;
    expect(
      (evaluation as { readonly impactFraction: number }).impactFraction
    ).toBeCloseTo(2 / 3, 14);
    expect(evaluation.maximumStepLength).toBeCloseTo(0.6, 14);
    expect(result.trials[0]).toMatchObject({
      index: 0,
      status: 'accepted'
    });
    expect(result.trials[0]!.stepLength).toBeCloseTo(0.6, 14);
    expect(result.accepted.positions[0]!.data[0]).toBeCloseTo(0.14, 14);
  });

  it('composes authored filters by the smallest certified prefix', () => {
    const particle = new XpbdParticleN({
      id: 'composed',
      position: [1],
      inverseMass: 1
    });
    const outerBarrier = barrier(
      particle,
      new HyperplaneColliderN([1]),
      0
    );
    const innerBarrier = barrier(
      particle,
      new HyperplaneColliderN([1]),
      0.4
    );
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 1,
      providers: [],
      stepFilters: [
        new XpbdParticleHyperplaneBarrierStepFilterN({
          id: 'outer',
          barrier: outerBarrier
        }),
        new XpbdParticleHyperplaneBarrierStepFilterN({
          id: 'inner',
          barrier: innerBarrier,
          conservativeScale: 0.5
        })
      ]
    });
    const result = searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [1],
      direction: [-1],
      initialStep: 1.5
    });

    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    expect(result.stepFilters.map((entry) => entry.filterId))
      .toEqual(['outer', 'inner']);
    expect(result.stepLength).toBeCloseTo(0.3, 14);
    expect(result.trials[0]!.stepLength).toBeCloseTo(0.3, 14);
  });

  it('promotes indeterminate and zero-prefix results to typed refusals', () => {
    const particle = new XpbdParticleN({
      id: 'refusal',
      position: [0.1],
      inverseMass: 1
    });
    const exact = new XpbdParticleHyperplaneBarrierStepFilterN({
      id: 'exact-refusal',
      barrier: barrier(particle, new HyperplaneColliderN([1]))
    });
    const compile = (stepFilter: XpbdIncrementalPotentialStepFilterN) =>
      compileXpbdIncrementalPotentialProblemN({
        dimension: 1,
        particles: [particle],
        predictedPositions: [new VecN([0])],
        deltaTime: 1,
        providers: [],
        stepFilters: [stepFilter]
      });
    const indeterminate = searchXpbdIncrementalPotentialArmijoN({
      problem: compile(exact),
      coordinates: [0.1],
      direction: [-1]
    });
    expect(indeterminate).toMatchObject({
      status: 'step-filter-refused',
      reason: 'indeterminate',
      blockingFilter: {
        filterId: 'exact-refusal',
        evaluation: {
          status: 'indeterminate',
          reason: 'initial-domain-violation'
        }
      },
      trials: []
    });

    const zero: XpbdIncrementalPotentialStepFilterN = {
      id: 'zero',
      dimension: 1,
      particles: [particle],
      evaluate: () => ({ status: 'limited', maximumStepLength: 0 })
    };
    const zeroSearch = searchXpbdIncrementalPotentialArmijoN({
      problem: compile(zero),
      coordinates: [0.1],
      direction: [-1]
    });
    expect(zeroSearch).toMatchObject({
      status: 'step-filter-refused',
      reason: 'no-positive-step',
      blockingFilter: { filterId: 'zero' },
      trials: []
    });
    const minimized = minimizeXpbdIncrementalPotentialN({
      problem: compile(exact),
      initialCoordinates: [0.1]
    });
    expect(minimized).toMatchObject({
      status: 'line-search-refused',
      search: { status: 'step-filter-refused' }
    });
    expect(applyXpbdIncrementalPotentialResultN({
      result: minimized
    })).toMatchObject({
      status: 'refused',
      reason: 'not-converged',
      minimizationStatus: 'line-search-refused'
    });
  });

  it('validates filter ownership and evaluation contracts', () => {
    const particle = new XpbdParticleN({
      id: 'valid',
      position: [1],
      inverseMass: 1
    });
    const foreign = new XpbdParticleN({ id: 'foreign', position: [1] });
    const compile = (stepFilter: XpbdIncrementalPotentialStepFilterN) =>
      compileXpbdIncrementalPotentialProblemN({
        dimension: 1,
        particles: [particle],
        predictedPositions: [new VecN([0])],
        deltaTime: 1,
        providers: [],
        stepFilters: [stepFilter]
      });
    expect(() => compile({
      id: 'wrong-dimension',
      dimension: 2,
      particles: [particle],
      evaluate: () => ({ status: 'safe', maximumStepLength: 1 })
    })).toThrow(/is R2/);
    expect(() => compile({
      id: 'foreign',
      dimension: 1,
      particles: [foreign],
      evaluate: () => ({ status: 'safe', maximumStepLength: 1 })
    })).toThrow(/foreign particle/);

    const malformed = compile({
      id: 'malformed',
      dimension: 1,
      particles: [particle],
      evaluate: () => ({
        status: 'safe',
        maximumStepLength: 0.5
      })
    });
    expect(() => searchXpbdIncrementalPotentialArmijoN({
      problem: malformed,
      coordinates: [1],
      direction: [-1]
    })).toThrow(/safe evaluation must preserve/);
  });

  it('threads filter evidence through the atomic step and rolls back', () => {
    const particle = new XpbdParticleN({
      id: 'transaction',
      position: [0.5],
      inverseMass: 1
    });
    particle.applyForce([-60]);
    const before = {
      position: particle.position.toArray(),
      velocity: particle.velocity.toArray(),
      force: particle.force.toArray()
    };
    const provider = barrier(particle, new HyperplaneColliderN([1]));
    const filter = new XpbdParticleHyperplaneBarrierStepFilterN({
      id: 'transaction-filter',
      barrier: provider
    });
    const result = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [provider],
      stepFilters: [filter],
      deltaTime: 0.1,
      initialPositions: [new VecN([0.5])],
      minimization: { maximumIterations: 1 }
    });

    expect(result).toMatchObject({
      status: 'refused',
      stage: 'minimization',
      reason: 'not-converged',
      minimization: { status: 'iteration-limit' }
    });
    expect(result.minimization.iterations).toHaveLength(1);
    expect(result.minimization.iterations[0]!.search.stepFilters[0])
      .toMatchObject({
        filterId: 'transaction-filter',
        evaluation: { status: 'limited' }
      });
    expect(particle.position.toArray()).toEqual(before.position);
    expect(particle.velocity.toArray()).toEqual(before.velocity);
    expect(particle.force.toArray()).toEqual(before.force);
  });
});
