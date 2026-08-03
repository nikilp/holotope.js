import { CellComplex, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it, vi } from 'vitest';
import {
  XpbdParticleN,
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  stepXpbdIncrementalPotentialN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdConservativeForceProviderN,
  type XpbdForceProviderN,
  type XpbdIncrementalPotentialStepFilterN,
  type XpbdIncrementalPotentialStepResultN,
  type XpbdScalarConstraintN,
  type XpbdStateGuardN,
  type XpbdVelocityResponseN
} from '../src/index.js';

/**
 * The world-scoped step is orchestration, so these tests are mostly about
 * agreement and refusal rather than numbers: the same scene advanced by hand
 * and through the wrapper must reach the same state, and every world feature
 * the optimization path cannot honor must be named rather than skipped.
 */

/** A conservative well centered on the origin; enough to make a step move. */
function quadraticProvider(
  id: string,
  particles: readonly XpbdParticleN[],
  stiffness: number
): XpbdConservativeForceProviderN {
  const dimension = particles[0]!.dimension;
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (
    positionOf
  ) => {
    let potentialEnergy = 0;
    const forces = particles.map((particle) => {
      const position = positionOf(particle);
      potentialEnergy += 0.5 * stiffness * position.lengthSq();
      return position.multiplyScalar(-stiffness);
    });
    return { potentialEnergy, forces };
  };
  return {
    id,
    dimension,
    particles,
    evaluate: () => evaluateAt((particle) => particle.position.clone()),
    evaluateAt
  };
}

/**
 * Every decision-bearing scalar in one step, flattened.
 *
 * Results retain live class instances, so object equality would compare
 * identity where the question is agreement. Candidate IDs, trial statuses, and
 * particle coordinates all appear at full Float64 precision because a wrapper
 * that rounds one of them is exactly the failure this is meant to catch.
 */
function digest(
  result: XpbdIncrementalPotentialStepResultN,
  particles: readonly XpbdParticleN[]
): string {
  const exact = (value: number): string => value.toExponential(17);
  const lines: string[] = [
    `status=${result.status}`,
    `stage=${result.status === 'refused' ? result.stage : '-'}`,
    `reason=${result.status === 'refused' ? result.reason : '-'}`,
    `minimization=${result.minimization.status}`,
    `acceptedIterations=${result.progress.acceptedIterations}`,
    `displacementNorm=${exact(result.progress.displacementNorm)}`,
    `objectiveDecrease=${exact(result.progress.objectiveDecrease)}`,
    `convergencePoint=${result.progress.convergencePoint ?? '-'}`,
    `problemDimension=${result.problem.dimension}`,
    `problemParticles=${result.problem.particles.map((p) => p.id).join('|')}`,
    `problemProviders=${result.problem.providers.map((p) => p.id).join('|')}`,
    `problemFilters=${result.problem.stepFilters.map((f) => f.id).join('|')}`,
    `predicted=${result.prediction.positions
      .map((position) => position.toArray().map(exact).join(','))
      .join(';')}`
  ];
  const recovery = result.feasibleBaseRecovery;
  if (recovery !== undefined) {
    lines.push(`recoveryStatus=${recovery.status}`);
    lines.push(`recoveryFraction=${String(recovery.fraction)}`);
    lines.push(`recoveryTrials=${recovery.trials.length}`);
    for (const trial of recovery.trials) {
      lines.push(
        `  trial fraction=${exact(trial.fraction)} status=${trial.status}`
      );
    }
  }
  for (const particle of particles) {
    lines.push(
      `particle=${particle.id}` +
        ` p=[${particle.position.toArray().map(exact).join(',')}]` +
        ` v=[${particle.velocity.toArray().map(exact).join(',')}]` +
        ` f=[${particle.force.toArray().map(exact).join(',')}]` +
        ` w=${exact(particle.inverseMass)}` +
        ` g=${exact(particle.gravityScale)}`
    );
  }
  return lines.join('\n');
}

const SIMPLEX_GROUP: CellGroup = {
  key: 'obstacle-simplices',
  dim: 3,
  verticesPerCell: 4,
  kind: 'simplex',
  indices: Uint32Array.from([0, 1, 2, 3])
};

/** The obstacle face spanning three axes at w = 0. */
const OBSTACLE_COORDINATES = [
  0, 0, 0, 0,
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0
];

/**
 * One R4 point approaching a finite static tetrahedron fast enough that its
 * inertial prediction is inadmissible while its current position is not.
 *
 * That is the configuration `feasible-inertial-prediction` exists for, so the
 * scene exercises P43 recovery and P45 candidate evidence in the same step.
 */
function contactScene(id: string): {
  world: XpbdWorldN;
  family: ReturnType<typeof compileXpbdParticleSourceSimplexBarrierFamilyN>;
} {
  const source = new CellComplex(
    4,
    Float64Array.from([0.25, 0.25, 0.25, 0.06]),
    []
  );
  const binding = compileXpbdParticleBindingN({ id: `${id}-dynamic`, source });
  for (const particle of binding.particles) particle.velocity.data[3] = -6;

  const obstacle = new CellComplex(
    4,
    Float64Array.from(OBSTACLE_COORDINATES),
    [SIMPLEX_GROUP]
  );
  const family = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: `${id}-contact`,
    binding,
    obstacle,
    simplexGroup: SIMPLEX_GROUP,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1.7
  });

  const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
  binding.addToWorld(world);
  family.addToWorld(world);
  return { world, family };
}

/** A plain quadratic world with no filters, for the cheaper contract checks. */
function simpleWorld(dimension: number, stiffness = 4): XpbdWorldN {
  const world = new XpbdWorldN({ dimension });
  const particle = new XpbdParticleN({
    id: 'p0',
    position: Array.from({ length: dimension }, (_, axis) => 0.5 + 0.1 * axis)
  });
  world.addParticle(particle);
  world.addForceProvider(quadraticProvider('well', [particle], stiffness));
  return world;
}

describe('stepXpbdIncrementalPotentialWorldN — manual differential', () => {
  it('reaches the same state as the manual lower-level call', () => {
    const manual = contactScene('manual');
    const scoped = contactScene('scoped');
    const options = {
      deltaTime: 1 / 120,
      warmStart: 'feasible-inertial-prediction' as const,
      minimization: { directionPolicy: 'steepest-descent' as const }
    };

    const manualResult = stepXpbdIncrementalPotentialN({
      dimension: manual.world.dimension,
      particles: manual.world.particles,
      providers: manual.world.forceProviders as
        readonly XpbdConservativeForceProviderN[],
      gravity: manual.world.gravity,
      stepFilters: [manual.family.stepFilter],
      ...options
    });
    const scopedResult = stepXpbdIncrementalPotentialWorldN({
      world: scoped.world,
      stepFilters: [scoped.family.stepFilter],
      ...options
    });

    // Scene IDs are the only legitimate difference between the two fixtures.
    const normalize = (text: string, from: string): string =>
      text.replace(new RegExp(from, 'g'), 'scene');
    expect(
      normalize(digest(scopedResult.step, scoped.world.particles), 'scoped')
    ).toBe(normalize(digest(manualResult, manual.world.particles), 'manual'));
    expect(scopedResult.step.status).toBe('applied');
    expect(scopedResult.step.feasibleBaseRecovery?.status).toBe('recovered');
  });

  it('agrees on a shared-coordinate fixture from R1 through R7', () => {
    // The step is dimension-generic, so the same coordinates embedded in
    // different ambient dimensions must run one implementation with no branch.
    for (let dimension = 1; dimension <= 7; dimension++) {
      const manualWorld = simpleWorld(dimension);
      const scopedWorld = simpleWorld(dimension);
      const manualResult = stepXpbdIncrementalPotentialN({
        dimension: manualWorld.dimension,
        particles: manualWorld.particles,
        providers: manualWorld.forceProviders as
          readonly XpbdConservativeForceProviderN[],
        gravity: manualWorld.gravity,
        deltaTime: 1 / 90
      });
      const scopedResult = stepXpbdIncrementalPotentialWorldN({
        world: scopedWorld,
        deltaTime: 1 / 90
      });
      expect(
        digest(scopedResult.step, scopedWorld.particles),
        `R${dimension}`
      ).toBe(digest(manualResult, manualWorld.particles));
      expect(scopedResult.selection.dimension).toBe(dimension);
    }
  });

  it('keeps R2, R3, and R4 bitwise equal on shared leading coordinates', () => {
    // Padding a fixture with zero coordinates must not change the answer on
    // the coordinates it shares, which is what "no ambient branch" buys.
    const displacements = [2, 3, 4].map((dimension) => {
      const world = new XpbdWorldN({ dimension });
      const coordinates = new Array<number>(dimension).fill(0);
      coordinates[0] = 0.4;
      coordinates[1] = -0.25;
      const particle = new XpbdParticleN({ id: 'p0', position: coordinates });
      world.addParticle(particle);
      world.addForceProvider(quadraticProvider('well', [particle], 3));
      const advance = stepXpbdIncrementalPotentialWorldN({
        world,
        deltaTime: 1 / 60
      });
      expect(advance.step.status).toBe('applied');
      return particle.position.toArray().slice(0, 2);
    });
    expect(displacements[1]).toEqual(displacements[0]);
    expect(displacements[2]).toEqual(displacements[0]);
  });
});

describe('stepXpbdIncrementalPotentialWorldN — delegation and authority', () => {
  it('runs one transaction, not two', () => {
    const world = simpleWorld(3);
    const provider = world.forceProviders[0] as XpbdConservativeForceProviderN;
    const evaluateAt = vi.spyOn(
      provider as { evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] },
      'evaluateAt'
    );

    const advance = stepXpbdIncrementalPotentialWorldN({
      world,
      deltaTime: 1 / 120,
      minimization: { maximumIterations: 0 }
    });

    // A zero-iteration budget is the one configuration whose evaluation count
    // the existing contract fixes: the objective is evaluated at the base and
    // nowhere else. Anything higher would assert an incidental minimizer count.
    expect(advance.step.progress.acceptedIterations).toBe(0);
    expect(evaluateAt).toHaveBeenCalledTimes(1);
  });

  it('takes dimension, particle order, gravity, and providers from the world', () => {
    const world = new XpbdWorldN({ dimension: 4, gravity: [0, -3, 0, 0.5] });
    const first = new XpbdParticleN({ id: 'b', position: [0.2, 0, 0, 0] });
    const second = new XpbdParticleN({ id: 'a', position: [0, 0.3, 0, 0] });
    world.addParticle(first);
    world.addParticle(second);
    world.addForceProvider(quadraticProvider('second', [second], 1));
    world.addForceProvider(quadraticProvider('first', [first], 2));

    const advance = stepXpbdIncrementalPotentialWorldN({
      world,
      deltaTime: 1 / 100
    });

    // Registration order, not sorted order, and not the caller's guess.
    expect(advance.selection.particleIds).toEqual(['b', 'a']);
    expect(advance.selection.providerIds).toEqual(['second', 'first']);
    expect(advance.selection.dimension).toBe(4);
    expect(advance.step.problem.particles.map((p) => p.id)).toEqual(['b', 'a']);
    expect(advance.step.problem.providers.map((p) => p.id))
      .toEqual(['second', 'first']);
    // Gravity reaches the prediction rather than being defaulted to zero.
    // The provider forces are radial here, so the world's gravity is the only
    // thing that can put a component on the third axis.
    expect(advance.step.prediction.accelerations.map((a) => a.toArray()))
      .toEqual([[0, -3, 0, 0.5], [0, -3, 0, 0.5]]);
  });

  it('never invokes the projected-XPBD solver paths', () => {
    const world = simpleWorld(4);
    const step = vi.spyOn(world, 'step');
    const stepAdaptive = vi.spyOn(world, 'stepAdaptive');
    stepXpbdIncrementalPotentialWorldN({ world, deltaTime: 1 / 120 });
    expect(step).not.toHaveBeenCalled();
    expect(stepAdaptive).not.toHaveBeenCalled();
  });
});

describe('stepXpbdIncrementalPotentialWorldN — retained evidence', () => {
  it('keeps P45 candidate identity and names the same blocking candidate', () => {
    const manual = contactScene('manual');
    const scoped = contactScene('scoped');
    const start = manual.world.particles[0]!.position.clone();
    const target = start.clone();
    target.data[3] = -0.4;

    // Query the filter directly on both scenes over the identical segment.
    const segment = {
      dimension: 4,
      requestedStepLength: 1,
      positionBefore: () => start.clone(),
      positionAfter: () => target.clone()
    };
    const manualFilter = manual.family.stepFilter.evaluate(segment);
    const scopedFilter = scoped.family.stepFilter.evaluate(segment);
    expect(manualFilter.status).toBe('limited');
    expect(scopedFilter.status).toBe(manualFilter.status);
    // A named pair, not a summary count, and the same pair on both scenes.
    expect(manualFilter.blockingCandidateId)
      .toBe('manual-contact/source-vertex/0/obstacle-cell/0');
    expect(scopedFilter.blockingCandidateId)
      .toBe('scoped-contact/source-vertex/0/obstacle-cell/0');
    expect(scopedFilter.candidates.length).toBe(manualFilter.candidates.length);
    expect(scopedFilter.candidates.length).toBeGreaterThan(0);

    // And the same filter, reached through the wrapper, still carries its
    // per-candidate records into the compiled problem rather than a count.
    const advance = stepXpbdIncrementalPotentialWorldN({
      world: scoped.world,
      deltaTime: 1 / 120,
      stepFilters: [scoped.family.stepFilter],
      warmStart: 'feasible-inertial-prediction',
      minimization: { directionPolicy: 'steepest-descent' }
    });
    expect(advance.step.problem.stepFilters).toEqual([scoped.family.stepFilter]);
    expect(advance.selection.stepFilterIds)
      .toEqual([scoped.family.stepFilter.id]);
  });

  it('returns complete feasible-base evidence and a matching diagnosis', () => {
    const scene = contactScene('recovery');
    const advance = stepXpbdIncrementalPotentialWorldN({
      world: scene.world,
      deltaTime: 1 / 120,
      stepFilters: [scene.family.stepFilter],
      warmStart: 'feasible-inertial-prediction',
      minimization: { directionPolicy: 'steepest-descent' }
    });

    const recovery = advance.step.feasibleBaseRecovery;
    expect(recovery).toBeDefined();
    expect(recovery!.status).toBe('recovered');
    expect(recovery!.fraction).toBeGreaterThan(0);
    expect(recovery!.fraction).toBeLessThan(1);
    // Every sampled chord point is retained, not just the accepted one.
    expect(recovery!.trials.length).toBeGreaterThan(1);

    // The diagnosis is computed from that same result, once.
    expect(advance.diagnosis.condition).toBe('progressed');
    expect(advance.diagnosis.facts['acceptedIterations'])
      .toBe(advance.step.progress.acceptedIterations);
  });

  it('preserves supplied filter order without reordering', () => {
    const scene = contactScene('order');
    const inert: XpbdIncrementalPotentialStepFilterN = {
      id: 'inert',
      dimension: 4,
      particles: scene.world.particles,
      evaluate: () => ({ status: 'safe', maximumStepLength: 1 })
    };
    const advance = stepXpbdIncrementalPotentialWorldN({
      world: scene.world,
      deltaTime: 1 / 120,
      stepFilters: [inert, scene.family.stepFilter]
    });
    expect(advance.selection.stepFilterIds)
      .toEqual(['inert', scene.family.stepFilter.id]);
    expect(advance.step.problem.stepFilters.map((f) => f.id))
      .toEqual(['inert', scene.family.stepFilter.id]);
  });

  it('leaves duplicate filter IDs to the existing compiler refusal', () => {
    const scene = contactScene('duplicate');
    expect(() =>
      stepXpbdIncrementalPotentialWorldN({
        world: scene.world,
        deltaTime: 1 / 120,
        stepFilters: [scene.family.stepFilter, scene.family.stepFilter]
      })
    ).toThrow(/duplicate/i);
  });

  it('cannot have its selection evidence rewritten after the call', () => {
    const scene = contactScene('frozen');
    const filters = [scene.family.stepFilter];
    const advance = stepXpbdIncrementalPotentialWorldN({
      world: scene.world,
      deltaTime: 1 / 120,
      stepFilters: filters
    });
    const observed = [...advance.selection.stepFilterIds];

    filters.length = 0;
    expect(() => {
      (advance.selection.stepFilterIds as string[]).push('injected');
    }).toThrow();
    expect(() => {
      (advance as { selection: unknown }).selection = null;
    }).toThrow();
    expect([...advance.selection.stepFilterIds]).toEqual(observed);
  });
});

describe('stepXpbdIncrementalPotentialWorldN — refusal stays typed', () => {
  it('returns an iteration-limit refusal rather than throwing', () => {
    const world = simpleWorld(3, 400);
    const before = world.particles.map((p) => p.position.toArray());
    const advance = stepXpbdIncrementalPotentialWorldN({
      world,
      deltaTime: 1 / 30,
      minimization: { maximumIterations: 1, gradientTolerance: 1e-18 }
    });
    expect(advance.step.status).toBe('refused');
    expect(advance.diagnosis.condition).toBe('iteration-limit');
    // A refused step rolls back to the exact pre-step positions.
    expect(world.particles.map((p) => p.position.toArray())).toEqual(before);
  });

  it('returns an application refusal rather than throwing', () => {
    // A provider that swaps a particle's live position vector makes the
    // compiled evidence stale, which the application stage refuses by
    // contract rather than by throwing.
    const world = new XpbdWorldN({ dimension: 1 });
    const particle = new XpbdParticleN({
      id: 'mutated',
      position: [0],
      velocity: [0.5]
    });
    particle.applyForce([2]);
    world.addParticle(particle);
    const positionReference = particle.position;
    const before = [
      particle.position.toArray(),
      particle.velocity.toArray(),
      particle.force.toArray()
    ];
    world.addForceProvider({
      id: 'mutating',
      dimension: 1,
      particles: [particle],
      evaluate: () => ({ potentialEnergy: 0, forces: [new VecN([0])] }),
      evaluateAt: () => {
        (particle as unknown as { position: VecN }).position = new VecN([99]);
        particle.velocity.data[0] = -77;
        return { potentialEnergy: 0, forces: [new VecN([0])] };
      }
    } satisfies XpbdConservativeForceProviderN);

    const advance = stepXpbdIncrementalPotentialWorldN({
      world,
      deltaTime: 0.2
    });

    expect(advance.step).toMatchObject({
      status: 'refused',
      stage: 'application',
      reason: 'stale-particle-state'
    });
    expect(advance.diagnosis.condition).toBe('application-refused');
    expect(particle.position).toBe(positionReference);
    expect([
      particle.position.toArray(),
      particle.velocity.toArray(),
      particle.force.toArray()
    ]).toEqual(before);
  });

  it('restores complete particle state when a provider throws', () => {
    const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
    const particle = new XpbdParticleN({
      id: 'p0',
      position: [0.3, -0.2, 0.1, 0.4],
      velocity: [0.05, 0, -0.02, 0.01],
      inverseMass: 0.5,
      gravityScale: 1.25
    });
    particle.force.data[1] = 0.75;
    world.addParticle(particle);

    let calls = 0;
    const saboteur: XpbdConservativeForceProviderN = {
      id: 'saboteur',
      dimension: 4,
      particles: [particle],
      evaluate: () => ({ potentialEnergy: 0, forces: [new VecN(4)] }),
      evaluateAt: () => {
        calls += 1;
        // Mutate live state first, so a missing rollback is visible.
        particle.position.data[0] = 99;
        particle.velocity.data[2] = -99;
        particle.force.data[3] = 99;
        particle.gravityScale = -7;
        throw new Error('provider failed mid-evaluation');
      }
    };
    world.addForceProvider(saboteur);

    expect(() =>
      stepXpbdIncrementalPotentialWorldN({ world, deltaTime: 1 / 120 })
    ).toThrow(/provider failed mid-evaluation/);
    expect(calls).toBeGreaterThan(0);
    expect(particle.position.toArray()).toEqual([0.3, -0.2, 0.1, 0.4]);
    expect(particle.velocity.toArray()).toEqual([0.05, 0, -0.02, 0.01]);
    expect(particle.force.toArray()).toEqual([0, 0.75, 0, 0]);
    expect(particle.inverseMass).toBe(0.5);
    expect(particle.gravityScale).toBe(1.25);
  });
});

describe('stepXpbdIncrementalPotentialWorldN — configuration refusal', () => {
  /** State that must be untouched when a configuration error is thrown. */
  const untouched = (world: XpbdWorldN): unknown =>
    world.particles.map((particle) => [
      particle.position.toArray(),
      particle.velocity.toArray(),
      particle.force.toArray()
    ]);

  it('names a registered force provider that is not conservative', () => {
    const world = simpleWorld(3);
    const particle = world.particles[0]!;
    const opaque: XpbdForceProviderN = {
      id: 'wind',
      dimension: 3,
      particles: [particle],
      evaluate: () => ({ forces: [new VecN(3)] })
    };
    world.addForceProvider(opaque);
    const before = untouched(world);

    expect(() =>
      stepXpbdIncrementalPotentialWorldN({ world, deltaTime: 1 / 120 })
    ).toThrow(/"wind".*conservative/s);
    expect(untouched(world)).toEqual(before);
  });

  it('names a registered scalar constraint', () => {
    const world = simpleWorld(3);
    const particle = world.particles[0]!;
    const constraint: XpbdScalarConstraintN = {
      id: 'leash',
      dimension: 3,
      points: [particle],
      compliance: 0,
      evaluate: () => ({
        value: 0,
        gradients: [new VecN(3)]
      })
    };
    world.addConstraint(constraint);
    const before = untouched(world);

    expect(() =>
      stepXpbdIncrementalPotentialWorldN({ world, deltaTime: 1 / 120 })
    ).toThrow(/scalar constraint \("leash"\)/);
    expect(untouched(world)).toEqual(before);
  });

  it('names a registered velocity response', () => {
    const world = simpleWorld(3);
    const particle = world.particles[0]!;
    const response: XpbdVelocityResponseN = {
      id: 'damping',
      dimension: 3,
      particles: [particle],
      apply: () => ({})
    };
    world.addVelocityResponse(response);
    const before = untouched(world);

    expect(() =>
      stepXpbdIncrementalPotentialWorldN({ world, deltaTime: 1 / 120 })
    ).toThrow(/velocity response \("damping"\)/);
    expect(untouched(world)).toEqual(before);
  });

  it('names a registered state guard', () => {
    const world = simpleWorld(3);
    const particle = world.particles[0]!;
    const guard: XpbdStateGuardN = {
      id: 'ceiling',
      dimension: 3,
      particles: [particle],
      evaluate: () => ({ accepted: true })
    };
    world.addStateGuard(guard);
    const before = untouched(world);

    expect(() =>
      stepXpbdIncrementalPotentialWorldN({ world, deltaTime: 1 / 120 })
    ).toThrow(/state guard \("ceiling"\)/);
    expect(untouched(world)).toEqual(before);
  });

  it('rejects unknown options, an empty world, and invalid intervals', () => {
    const world = simpleWorld(3);
    expect(() =>
      stepXpbdIncrementalPotentialWorldN({
        world,
        deltaTime: 1 / 120,
        substeps: 4
      } as never)
    ).toThrow(/unknown option "substeps"/);

    expect(() =>
      stepXpbdIncrementalPotentialWorldN({
        world: new XpbdWorldN({ dimension: 3 }),
        deltaTime: 1 / 120
      })
    ).toThrow(/no registered particles/);

    for (const deltaTime of [0, -1 / 120, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => stepXpbdIncrementalPotentialWorldN({ world, deltaTime }),
        String(deltaTime)
      ).toThrow(/deltaTime must be finite and positive/);
    }

    // Feasible sampling controls belong to one warm start; supplying them with
    // another is rejected by the existing contract rather than ignored here.
    expect(() =>
      stepXpbdIncrementalPotentialWorldN({
        world,
        deltaTime: 1 / 120,
        warmStart: 'previous-positions',
        feasibleWarmStart: { maximumTrials: 4 }
      })
    ).toThrow();
    expect(() =>
      stepXpbdIncrementalPotentialWorldN({
        world,
        deltaTime: 1 / 120,
        warmStart: 'nearest-admissible' as never
      })
    ).toThrow();
  });
});
