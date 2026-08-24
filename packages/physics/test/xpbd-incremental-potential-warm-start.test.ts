import { CellComplex, VecN, createSourceCellReferenceN, createSourceSimplexReferenceN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneColliderN,
  diagnoseXpbdIncrementalPotentialStepN,
  XpbdParticleHyperplaneBarrierN,
  XpbdParticleHyperplaneBarrierStepFilterN,
  XpbdParticleN,
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  compileXpbdSourceSimplexMeasureBarrierN,
  stepXpbdIncrementalPotentialN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdConservativeForceProviderN,
  type XpbdIncrementalPotentialStepFilterN,
  type XpbdIncrementalPotentialStepResultN
} from '../src/index.js';

/**
 * The warm-start segment-certification contract.
 *
 * The released `v0.0.20` composition installed an automatically selected
 * minimizer base without consulting any registered step filter: an unsigned
 * contact law calls a far-side placement feasible with energy exactly zero, so
 * a warm start could put the base on the other side of an obstacle, the
 * minimizer would converge at that base without a single Armijo segment, and
 * the world applied the full crossing — while the paired filter, asked
 * independently about the same movement, answered `limited` at about `0.315`.
 *
 * The corrected rule, tested here: every AUTOMATICALLY selected base movement
 * away from the authored anchor is certified by every registered filter before
 * it is installed. `safe` installs the exact target, `limited` installs the
 * certified prefix, `indeterminate` installs the anchor. Explicit
 * `initialPositions` remain the authoritative uncertified bypass, and with no
 * filter registered nothing changes.
 *
 * The scene mirrors the release-boundary audit's N1 exactly: a cell authored
 * clear at `y = 0.4`, one step whose inertial target lies at `y = -0.6`
 * (velocity `-1`, `deltaTime 1`, no gravity), `minimumDistance 0.05`,
 * `activationDistance 0.5` — the far side is beyond activation, so the target
 * is endpoint-feasible with energy `0`.
 */

const MINIMUM = 0.05;
const ACTIVATION = 0.5;
const START_Y = 0.4;

const floorComplex = (): CellComplex => new CellComplex(3,
  Float64Array.from([-40, 0, -40, 60, 0, -40, -40, 0, 60]),
  [{ dim: 2, verticesPerCell: 3, kind: 'simplex',
     indices: Uint32Array.from([0, 1, 2]) }]);

interface UnsignedScene {
  readonly particles: readonly XpbdParticleN[];
  readonly provider: XpbdConservativeForceProviderN;
  readonly stepFilter: XpbdIncrementalPotentialStepFilterN;
}

/** The measure law over one k=1 cell falling toward the floor plane. */
function measureScene(velocityY = -1, startY = START_Y): UnsignedScene {
  const complex = new CellComplex(3,
    Float64Array.from([0, startY, 0, 1, startY, 0]),
    [{ dim: 1, verticesPerCell: 2, kind: 'simplex',
       indices: Uint32Array.from([0, 1]) }]);
  const binding = compileXpbdParticleBindingN({
    id: 'cell', source: complex, velocity: () => [0, velocityY, 0]
  });
  const floor = floorComplex();
  const terms = compileXpbdSourceSimplexMeasureBarrierN({
    id: 'contact',
    binding,
    cell: createSourceSimplexReferenceN(
      createSourceCellReferenceN(complex, complex.groups[0]!, 0)),
    obstacle: createSourceSimplexReferenceN(
      createSourceCellReferenceN(floor, floor.groups[0]!, 0)),
    minimumDistance: MINIMUM,
    activationDistance: ACTIVATION,
    stiffness: 2,
    maximumDirectionError: 1e-6
  });
  return {
    particles: binding.particles,
    provider: terms.provider,
    stepFilter: terms.stepFilter
  };
}

/** The pre-existing v0.0.19 family law over the identical scene. */
function familyScene(velocityY = -1, startY = START_Y): UnsignedScene {
  const complex = new CellComplex(3,
    Float64Array.from([0, startY, 0, 1, startY, 0]),
    [{ dim: 1, verticesPerCell: 2, kind: 'simplex',
       indices: Uint32Array.from([0, 1]) }]);
  const binding = compileXpbdParticleBindingN({
    id: 'cell', source: complex, velocity: () => [0, velocityY, 0]
  });
  const floor = floorComplex();
  const family = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: 'contact',
    binding,
    obstacle: floor,
    simplexGroup: floor.groups[0]!,
    minimumDistance: MINIMUM,
    activationDistance: ACTIVATION,
    stiffness: 2,
    maximumDirectionError: 1e-6
  });
  return {
    particles: binding.particles,
    provider: family,
    stepFilter: family.stepFilter
  };
}

function snapshotState(particles: readonly XpbdParticleN[]): number[][] {
  return particles.map((particle) => [
    ...particle.position.data,
    ...particle.velocity.data,
    ...particle.force.data
  ]);
}

function stateEquals(
  particles: readonly XpbdParticleN[],
  snapshot: readonly number[][]
): boolean {
  return particles.every((particle, index) => {
    const held = snapshot[index]!;
    const dimension = particle.dimension;
    for (let axis = 0; axis < dimension; axis++) {
      if (particle.position.data[axis] !== held[axis]) return false;
      if (particle.velocity.data[axis] !== held[dimension + axis]) return false;
      if (particle.force.data[axis] !== held[2 * dimension + axis]) return false;
    }
    return true;
  });
}

const yOf = (scene: UnsignedScene): number =>
  scene.particles[0]!.position.data[1]!;

const step = (
  scene: UnsignedScene,
  overrides: Partial<Parameters<typeof stepXpbdIncrementalPotentialN>[0]> = {}
): XpbdIncrementalPotentialStepResultN => stepXpbdIncrementalPotentialN({
  dimension: 3,
  particles: scene.particles,
  providers: [scene.provider],
  stepFilters: [scene.stepFilter],
  deltaTime: 1,
  warmStart: 'feasible-inertial-prediction',
  ...overrides
});

const baseYOf = (result: XpbdIncrementalPotentialStepResultN): number => {
  if (result.minimization.status === 'initial-state-refused') {
    throw new Error('test fixture: the minimizer base was refused');
  }
  return result.minimization.initial.positions[0]!.data[1]!;
};

describe('warm-start segment certification: the reproduced counterexamples', () => {
  it('no longer crosses the obstacle, for both unsigned laws and both '
    + 'automatic warm-start policies', () => {
    for (const build of [measureScene, familyScene]) {
      for (const warmStart of [
        'inertial-prediction', 'feasible-inertial-prediction'
      ] as const) {
        const scene = build();
        const held = snapshotState(scene.particles);
        const result = step(scene, { warmStart });
        // The invariant the filter exists to protect: never through the wall.
        // Whether the stiff crash resolves within default budgets is the
        // scene's problem; crossing it never is.
        expect(yOf(scene), `${build.name}/${warmStart}`)
          .toBeGreaterThan(MINIMUM);
        expect(baseYOf(result), `${build.name}/${warmStart} base`)
          .toBeGreaterThan(MINIMUM);
        if (result.status === 'refused') {
          expect(stateEquals(scene.particles, held),
            `${build.name}/${warmStart} rollback`).toBe(true);
        }
      }
    }
  });

  it('reaches the reported 0.315 limit and installs exactly that prefix as '
    + 'the base', () => {
    const scene = measureScene();
    const result = step(scene);
    const certification = result.warmStartCertification;
    expect(certification).toBeDefined();
    if (certification === undefined) return;
    expect(certification.outcome).toBe('limited');
    // The displacement is two particles each moving 1.0 in y, so the packed
    // requested length is sqrt(2) — a genuine length, not 1 and not a
    // fraction. The filter's certified prefix is 0.315 of it.
    expect(certification.requestedStepLength).toBeCloseTo(Math.SQRT2, 12);
    expect(certification.certifiedStepLength /
      certification.requestedStepLength).toBeCloseTo(0.315, 12);
    expect(certification.limitingFilter?.filterId).toBe(scene.stepFilter.id);
    // ...and the installed base sits at y = 0.4 - 0.315 * 1.0 = 0.085: the
    // certified LENGTH was converted through the requested length exactly
    // once. Treating it as a unitless fraction would place the base at
    // y = 0.4 - 0.315 * sqrt(2) = -0.045, through the boundary.
    expect(baseYOf(result)).toBeCloseTo(0.085, 12);
    expect(baseYOf(result)).toBeGreaterThan(MINIMUM);
    // Segment evidence and point evidence stay separate: the recovery ran on
    // the certified chord and accepted its endpoint.
    expect(result.feasibleBaseRecovery?.status).toBe('target-feasible');
  });

  it('never installs an endpoint-feasible but path-unsafe target unchanged',
    () => {
    for (const warmStart of [
      'inertial-prediction', 'feasible-inertial-prediction'
    ] as const) {
      const scene = measureScene();
      const result = step(scene, { warmStart });
      // The prediction is y = -0.6 and endpoint-feasible; the installed base
      // must not be it.
      expect(baseYOf(result), warmStart).not.toBeCloseTo(-0.6, 6);
      expect(baseYOf(result), warmStart).toBeCloseTo(0.085, 12);
    }
  });

  it('preserves a fully certified warm start bitwise: a safe outcome installs '
    + 'the exact prediction coordinates', () => {
    const scene = measureScene(-0.05);
    const result = step(scene);
    expect(result.status).toBe('applied');
    expect(result.warmStartCertification?.outcome).toBe('safe');
    expect(result.warmStartCertification?.certifiedStepLength)
      .toBe(result.warmStartCertification?.requestedStepLength);
    if (result.minimization.status !== 'converged') {
      throw new Error('test fixture: expected convergence');
    }
    // The base is the prediction, bitwise — no arithmetic touched it.
    const packed = result.problem.packPositions(result.prediction.positions);
    expect([...result.minimization.initial.coordinates]).toEqual([...packed]);
    expect(result.feasibleBaseRecovery?.status).toBe('target-feasible');
  });

  it('changes nothing when no filter is registered, and says so by carrying '
    + 'no certification', () => {
    const scene = measureScene();
    const result = step(scene, { stepFilters: undefined });
    // The uncertified behavior is measured, not hidden: with no filter there
    // is no certificate, and the far-side jump still happens. Registering the
    // paired filter is what the law's documentation requires.
    expect('warmStartCertification' in result).toBe(false);
    expect(result.status).toBe('applied');
    expect(yOf(scene)).toBeCloseTo(-0.6, 12);
  });

  it('resolves several filters to the most restrictive certified prefix',
    () => {
    const scene = measureScene();
    const scaled = (id: string, factor: number):
      XpbdIncrementalPotentialStepFilterN => ({
      id,
      dimension: 3,
      particles: scene.particles,
      evaluate: (context) => ({
        status: 'limited',
        maximumStepLength: factor * context.requestedStepLength
      })
    });
    const result = step(scene, {
      stepFilters: [scaled('loose', 0.4), scene.stepFilter, scaled('tight', 0.2)]
    });
    const certification = result.warmStartCertification;
    expect(certification?.outcome).toBe('limited');
    // 0.2 < 0.315 < 0.4: the tightest wins, whatever its registration order.
    expect(certification!.certifiedStepLength /
      certification!.requestedStepLength).toBeCloseTo(0.2, 12);
    expect(certification!.limitingFilter?.filterId).toBe('tight');
    expect(certification!.stepFilters.map((entry) => entry.filterId))
      .toEqual(['loose', scene.stepFilter.id, 'tight']);
    expect(baseYOf(result)).toBeCloseTo(START_Y - 0.2, 12);
  });

  it('installs the anchor when the certified prefix is a zero length, and '
    + 'still calls that a limit rather than a refusal', () => {
    // `limited` at zero is a distinct verdict from `indeterminate`: the
    // filters answered, and their answer is that no part of this movement is
    // admissible. The base must be the anchor either way, but the evidence
    // must not claim a filter refused to decide.
    const scene = measureScene();
    const pinned: XpbdIncrementalPotentialStepFilterN = {
      id: 'pinned',
      dimension: 3,
      particles: scene.particles,
      evaluate: () => ({ status: 'limited', maximumStepLength: 0 })
    };
    const result = step(scene, { stepFilters: [scene.stepFilter, pinned] });
    const certification = result.warmStartCertification;
    expect(certification?.outcome).toBe('limited');
    expect(certification?.certifiedStepLength).toBe(0);
    expect(certification?.limitingFilter?.filterId).toBe('pinned');
    expect(certification?.blockingFilter).toBeUndefined();
    // Bitwise the authored anchor, not an arithmetic reconstruction of it.
    expect(baseYOf(result)).toBe(START_Y);
    expect(scene.particles[0]!.position.data[1]!).toBeGreaterThan(MINIMUM);
  });

  it('fails closed on indeterminate: the base is the anchor, and nothing is '
    + 'applied partially', () => {
    const scene = measureScene();
    const refusing: XpbdIncrementalPotentialStepFilterN = {
      id: 'refusing',
      dimension: 3,
      particles: scene.particles,
      evaluate: () => ({ status: 'indeterminate', reason: 'test refusal' })
    };
    const held = snapshotState(scene.particles);
    const result = step(scene, {
      stepFilters: [scene.stepFilter, refusing]
    });
    const certification = result.warmStartCertification;
    expect(certification?.outcome).toBe('indeterminate');
    expect(certification?.certifiedStepLength).toBe(0);
    expect(certification?.blockingFilter?.filterId).toBe('refusing');
    expect(baseYOf(result)).toBe(START_Y);
    // The diagnosis retains the certification evidence as facts, every field.
    const diagnosis = diagnoseXpbdIncrementalPotentialStepN(result);
    expect(diagnosis.facts['warmStartCertificationOutcome'])
      .toBe('indeterminate');
    expect(diagnosis.facts['warmStartCertificationBlockingFilter'])
      .toBe('refusing');
    expect(diagnosis.facts['warmStartCertificationCertifiedStepLength'])
      .toBe(0);
    expect(diagnosis.facts['warmStartCertificationRequestedStepLength'])
      .toBe(certification!.requestedStepLength);
    expect(diagnosis.facts['warmStartCertificationFilters']).toBe(2);
    // The anchor is feasible, so the recovery accepted the zero-length chord;
    // the refusing filter then also refuses every Armijo segment, so the step
    // cannot move and must leave the state exactly as authored.
    expect(result.status).toBe('refused');
    expect(stateEquals(scene.particles, held)).toBe(true);
  });

  it('carries bound kinematic obstacle particles through the same generic '
    + 'mapping', () => {
    const complex = new CellComplex(3,
      Float64Array.from([0, START_Y, 0, 1, START_Y, 0]),
      [{ dim: 1, verticesPerCell: 2, kind: 'simplex',
         indices: Uint32Array.from([0, 1]) }]);
    const binding = compileXpbdParticleBindingN({
      id: 'cell', source: complex, velocity: () => [0, -1, 0]
    });
    const floor = floorComplex();
    const obstacleBinding = compileXpbdParticleBindingN({
      id: 'obstacle', source: floor, fixed: true
    });
    const terms = compileXpbdSourceSimplexMeasureBarrierN({
      id: 'contact',
      binding,
      cell: createSourceSimplexReferenceN(
        createSourceCellReferenceN(complex, complex.groups[0]!, 0)),
      obstacle: createSourceSimplexReferenceN(
        createSourceCellReferenceN(floor, floor.groups[0]!, 0)),
      obstacleBinding,
      minimumDistance: MINIMUM,
      activationDistance: ACTIVATION,
      stiffness: 2,
      maximumDirectionError: 1e-6
    });
    const particles = [...binding.particles, ...obstacleBinding.particles];
    const result = stepXpbdIncrementalPotentialN({
      dimension: 3,
      particles,
      providers: [terms.provider],
      stepFilters: [terms.stepFilter],
      deltaTime: 1,
      warmStart: 'feasible-inertial-prediction'
    });
    // The certification consulted the filter, whose context resolves the
    // bound obstacle particles through the same particle mapping as the cell
    // particles, and the same 0.315 limit holds.
    const certification = result.warmStartCertification;
    expect(certification?.outcome).toBe('limited');
    expect(certification!.certifiedStepLength /
      certification!.requestedStepLength).toBeCloseTo(0.315, 12);
    expect(binding.particles[0]!.position.data[1]!).toBeGreaterThan(MINIMUM);
    // The kinematic obstacle never moved.
    expect(obstacleBinding.particles.every(
      (particle) => particle.position.data[1] === 0
    )).toBe(true);
  });

  it('keeps explicit initialPositions as the authoritative uncertified '
    + 'bypass', () => {
    const scene = measureScene();
    const result = step(scene, {
      initialPositions: scene.particles.map((particle) => {
        const q = particle.position.clone();
        q.data[1] = -0.6;
        return q;
      })
    });
    // Explicit coordinates are the caller's own decision: no certification
    // runs and no recovery runs. This is the documented escape hatch.
    expect('warmStartCertification' in result).toBe(false);
    expect('feasibleBaseRecovery' in result).toBe(false);
    expect(baseYOf(result)).toBe(-0.6);
  });

  it('routes filter failures unchanged: a throwing filter aborts the step '
    + 'and restores every particle bitwise', () => {
    const scene = measureScene();
    const throwing: XpbdIncrementalPotentialStepFilterN = {
      id: 'throwing',
      dimension: 3,
      particles: scene.particles,
      evaluate: () => { throw new TypeError('deliberate filter failure'); }
    };
    const held = snapshotState(scene.particles);
    expect(() => step(scene, { stepFilters: [throwing] }))
      .toThrow('deliberate filter failure');
    expect(stateEquals(scene.particles, held)).toBe(true);

    const malformed: XpbdIncrementalPotentialStepFilterN = {
      id: 'malformed',
      dimension: 3,
      particles: scene.particles,
      evaluate: (context) => ({
        status: 'safe',
        // A safe evaluation must echo the requested length; half of it is a
        // contract violation the shared normalization refuses by name.
        maximumStepLength: context.requestedStepLength / 2
      })
    };
    const heldAgain = snapshotState(scene.particles);
    expect(() => step(scene, { stepFilters: [malformed] }))
      .toThrow(/warm-start certification.*safe evaluation must preserve/);
    expect(stateEquals(scene.particles, heldAgain)).toBe(true);
  });

  it('agrees between the world and direct-step entry points', () => {
    const direct = measureScene();
    const directResult = step(direct);

    const scoped = measureScene();
    const world = new XpbdWorldN({ dimension: 3, gravity: [0, 0, 0] });
    for (const particle of scoped.particles) world.addParticle(particle);
    world.addForceProvider(scoped.provider);
    const advance = stepXpbdIncrementalPotentialWorldN({
      world,
      deltaTime: 1,
      stepFilters: [scoped.stepFilter],
      warmStart: 'feasible-inertial-prediction'
    });

    expect(advance.step.status).toBe(directResult.status);
    expect(advance.step.warmStartCertification?.outcome)
      .toBe(directResult.warmStartCertification?.outcome);
    expect(advance.step.warmStartCertification?.certifiedStepLength)
      .toBe(directResult.warmStartCertification?.certifiedStepLength);
    expect(scoped.particles.map((particle) => [...particle.position.data]))
      .toEqual(direct.particles.map((particle) => [...particle.position.data]));
  });

  it('certifies from an inadmissible anchor as indeterminate rather than '
    + 'escaping through the obstacle', () => {
    // Released v0.0.20 behavior, measured in the Part 0 capsule: from an
    // anchor INSIDE the open boundary (y = 0.02 < 0.05) with a feasible
    // far-side target, the step applied a full crossing. The filter's own
    // vocabulary refuses to certify from an inadmissible start, so the
    // automatic movement now fails closed; recovering such a state is the
    // explicit `initialPositions` bypass's job.
    const scene = measureScene(-1, 0.02);
    const held = snapshotState(scene.particles);
    const result = step(scene);
    expect(result.warmStartCertification?.outcome).toBe('indeterminate');
    expect(result.status).toBe('refused');
    expect(result.feasibleBaseRecovery?.status).toBe('anchor-refused');
    expect(stateEquals(scene.particles, held)).toBe(true);
  });

  it('refuses even a retreating automatic movement from an inadmissible '
    + 'anchor, and the documented repair is explicit initialPositions', () => {
    // The v0.0.20 behaviour, measured in the Part 0 capsule, let a scene with
    // an inadmissible anchor jump to ANY endpoint-feasible prediction — the
    // same uncertified mechanism whether the jump retreated or tunnelled, and
    // an unsigned law cannot tell those apart. Filters refuse to certify any
    // segment from a start inside their open boundary, so the automatic warm
    // start now fails closed in BOTH directions. This pins the retreating
    // direction: the step refuses, loudly and repeatedly, rather than moving.
    const scene = measureScene(1, 0.02);
    const held = snapshotState(scene.particles);
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = step(scene);
      expect(result.warmStartCertification?.outcome).toBe('indeterminate');
      expect(result.status).toBe('refused');
      expect(stateEquals(scene.particles, held)).toBe(true);
    }
    // The documented repair: explicit initialPositions, the caller's own
    // uncertified decision, re-anchors the solve above the boundary.
    const repaired = step(scene, {
      initialPositions: scene.particles.map((particle) => {
        const q = particle.position.clone();
        q.data[1] = 0.4;
        return q;
      })
    });
    expect(repaired.status).toBe('applied');
    expect(yOf(scene)).toBeGreaterThan(MINIMUM);
  });

  it('samples the recovery chord WITHIN a limited certification when the '
    + 'certified endpoint is refused by an unpaired law', () => {
    // The measure filter limits the movement to y = 0.085; a second provider
    // WITHOUT a paired filter refuses everything below y = 0.2. The recovery
    // must contract along the certified chord — never the original one — and
    // settle at an interior fraction of the certified movement.
    const scene = measureScene();
    const unpaired = scene.particles.map((particle, index) =>
      new XpbdParticleHyperplaneBarrierN({
        id: `unpaired/${index}`,
        particle,
        plane: new HyperplaneColliderN(new VecN([0, 1, 0]), 0),
        minimumDistance: 0.2,
        activationDistance: 0.3,
        stiffness: 1
      }));
    const result = step(scene, {
      providers: [scene.provider, ...unpaired]
    });
    const certification = result.warmStartCertification;
    expect(certification?.outcome).toBe('limited');
    expect(certification!.certifiedStepLength /
      certification!.requestedStepLength).toBeCloseTo(0.315, 12);
    const recovery = result.feasibleBaseRecovery;
    expect(recovery?.status).toBe('recovered');
    if (recovery?.status !== 'recovered') return;
    // Fraction 0.5 of the CERTIFIED chord: y = 0.4 + 0.5 * (0.085 - 0.4).
    expect(recovery.fraction).toBe(0.5);
    expect(recovery.trials.map((trial) => trial.status))
      .toEqual(['domain-refused', 'feasible', 'feasible']);
    expect(baseYOf(result)).toBeCloseTo(0.2425, 12);
    // The base lies strictly inside the certified movement.
    expect(baseYOf(result)).toBeGreaterThan(0.085);
    expect(baseYOf(result)).toBeLessThan(START_Y);
  });
});
