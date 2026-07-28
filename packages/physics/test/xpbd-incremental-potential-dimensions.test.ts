import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneBarrierN,
  XpbdParticleHyperplaneBarrierStepFilterN,
  XpbdParticleN,
  XpbdPotentialDomainErrorN,
  stepXpbdIncrementalPotentialN
} from '../src/index.js';

/**
 * The same contact scene expressed only in terms of `dimension`.
 *
 * Construction may branch on dimension — a corner needs one wall per axis —
 * but nothing here is written for a particular one, and the stepping below
 * branches not at all. That separation is the property under test.
 */
function cornerScene(dimension: number) {
  const axis = (index: number): number[] => {
    const components = new Array<number>(dimension).fill(0);
    components[index] = 1;
    return components;
  };

  const particles = [0, 1, 2, 3].map((k) => {
    const position = new Array<number>(dimension).fill(0);
    position[1] = 0.6 + k * 0.15;
    position[0] = (k - 1.5) * 0.2;
    return new XpbdParticleN({ id: `p${k}`, position: new VecN(position) });
  });

  // A floor on axis 1, and one wall on every other axis.
  const planes = [new HyperplaneColliderN(new VecN(axis(1)), 0)];
  for (let index = 0; index < dimension; index++) {
    if (index === 1) continue;
    planes.push(new HyperplaneColliderN(new VecN(axis(index)), -1));
  }

  const providers: XpbdParticleHyperplaneBarrierN[] = [];
  const stepFilters: XpbdParticleHyperplaneBarrierStepFilterN[] = [];
  for (const [pi, particle] of particles.entries()) {
    for (const [wi, plane] of planes.entries()) {
      const barrier = new XpbdParticleHyperplaneBarrierN({
        id: `barrier/${pi}/${wi}`,
        particle,
        plane,
        activationDistance: 0.05,
        stiffness: 1
      });
      providers.push(barrier);
      stepFilters.push(new XpbdParticleHyperplaneBarrierStepFilterN({
        id: `filter/${pi}/${wi}`,
        barrier
      }));
    }
  }
  return { particles, providers, stepFilters, planes };
}

const gravityFor = (dimension: number): VecN =>
  new VecN(Array.from({ length: dimension }, (_, i) => (i === 1 ? -9.81 : 0)));

/** Steps the scene, optionally starting each solve from the current state. */
function run(
  dimension: number,
  steps: number,
  options: { readonly fromCurrentState: boolean }
): {
  readonly completed: number;
  readonly terminals: Record<string, number>;
  readonly heights: number[];
  readonly refusal: string | null;
} {
  const scene = cornerScene(dimension);
  const gravity = gravityFor(dimension);
  const terminals: Record<string, number> = {};

  for (let step = 0; step < steps; step++) {
    try {
      // One call site; `dimension` is data, never a branch.
      const result = stepXpbdIncrementalPotentialN({
        dimension,
        particles: scene.particles,
        providers: scene.providers,
        stepFilters: scene.stepFilters,
        deltaTime: 1 / 120,
        gravity,
        ...(options.fromCurrentState
          ? { initialPositions: scene.particles.map((p) => p.position.clone()) }
          : {})
      });
      const status = result.minimization.status;
      terminals[status] = (terminals[status] ?? 0) + 1;
    } catch (error) {
      return {
        completed: step,
        terminals,
        heights: scene.particles.map((p) => p.position.data[1]!),
        refusal: error instanceof XpbdPotentialDomainErrorN ? error.reason : null
      };
    }
  }
  return {
    completed: steps,
    terminals,
    heights: scene.particles.map((p) => p.position.data[1]!),
    refusal: null
  };
}

describe('the incremental-potential step across dimensions', () => {
  it('produces bitwise identical trajectories in R2, R3, and R4', () => {
    const runs = [2, 3, 4].map(
      (dimension) => run(dimension, 60, { fromCurrentState: true })
    );

    // The shared coordinates are the whole claim: a scene that differs only in
    // how many axes it has must evolve identically in the axes it shares. Not
    // "close" — the same doubles, because the same code ran on them.
    expect(runs[1]!.heights).toEqual(runs[0]!.heights);
    expect(runs[2]!.heights).toEqual(runs[1]!.heights);
    expect(runs[0]!.terminals).toEqual(runs[1]!.terminals);
    expect(runs[1]!.terminals).toEqual(runs[2]!.terminals);

    for (const result of runs) {
      expect(result.completed).toBe(60);
      // Resting above the floor rather than through it.
      for (const height of result.heights) expect(height).toBeGreaterThan(0);
    }
  }, 60_000);

  /**
   * The one-call entry point defaults `initialPositions` to the inertial
   * prediction, which for a particle already resting near a barrier lands
   * outside the barrier's open domain. Armijo recovers a domain refusal at a
   * *trial* point; one at the base point is fatal by design, so the step
   * throws rather than silently accepting an infeasible state.
   */
  it('refuses when the inertial prediction leaves the admissible domain', () => {
    for (const dimension of [2, 3, 4]) {
      const result = run(dimension, 60, { fromCurrentState: false });
      expect(result.refusal).toBe('at-or-below-minimum-distance');
      expect(result.completed).toBeLessThan(60);
    }
  }, 60_000);

  it('completes once each solve starts from the current feasible state', () => {
    // 60 steps clears the refusal point at 41, which is the whole property.
    for (const dimension of [2, 3, 4]) {
      const result = run(dimension, 60, { fromCurrentState: true });
      expect(result.refusal).toBeNull();
      expect(result.completed).toBe(60);
    }
  }, 60_000);

  /**
   * What actually happens once the solve stops converging.
   *
   * The application boundary refuses any non-converged minimization, and the
   * step policy exposes no override, so from the first `iteration-limit`
   * onward every step is refused wholesale. The scene does not come to rest —
   * it halts mid-fall, carrying an unresolved downward velocity forever.
   *
   * An earlier version of this test asserted that heights stayed above the
   * floor and called that stability. That assertion cannot fail once nothing
   * is being applied, so it certified a frozen simulation as a working one.
   * The lesson generalizes: in a library whose guarantees are refusals, "the
   * bad thing did not happen" is satisfied by a refusal that stopped the test
   * from doing anything, so a guarantee needs a liveness companion.
   */
  it('halts rather than resting once the solve stops converging', () => {
    const scene = cornerScene(4);
    const gravity = gravityFor(4);
    const applications: Record<string, number> = {};
    let firstLimit = -1;
    let movedAfterLimit = 0;
    let previous = '';

    for (let step = 0; step < 120; step++) {
      const result = stepXpbdIncrementalPotentialN({
        dimension: 4,
        particles: scene.particles,
        providers: scene.providers,
        stepFilters: scene.stepFilters,
        deltaTime: 1 / 120,
        gravity,
        initialPositions: scene.particles.map((p) => p.position.clone())
      });
      applications[result.status] = (applications[result.status] ?? 0) + 1;
      if (firstLimit < 0 && result.minimization.status === 'iteration-limit') {
        firstLimit = step;
      }
      const heights = scene.particles.map((p) => p.position.data[1]!).join(',');
      if (firstLimit >= 0 && previous !== '' && heights !== previous) movedAfterLimit++;
      previous = heights;
    }

    // Liveness first: the scene really did fall before it stopped.
    expect(applications['applied']).toBeGreaterThan(0);
    expect(firstLimit).toBeGreaterThan(0);

    // Then the guarantee, stated as what it is rather than as stability.
    expect(applications['refused']).toBeGreaterThan(0);
    expect(movedAfterLimit).toBe(0);
    // Halted mid-fall: the velocity it had is still there, unresolved.
    expect(scene.particles[0]!.velocity.data[1]!).toBeLessThan(-1);
  }, 60_000);

  /**
   * The escape a caller reaches for first, and why it is worse.
   *
   * Loosening the gradient tolerance past the objective's gradient norm at the
   * current state makes every solve converge at `initial` in zero iterations.
   * Every step then reports `applied` and nothing moves at all — a loud
   * failure traded for a silent one. `convergencePoint` already distinguishes
   * the two cases; nothing currently acts on it.
   */
  it('reports success while moving nothing when the tolerance is loosened', () => {
    const scene = cornerScene(3);
    const gravity = gravityFor(3);
    const before = scene.particles.map((p) => p.position.data[1]!);
    const applications: Record<string, number> = {};

    for (let step = 0; step < 120; step++) {
      const result = stepXpbdIncrementalPotentialN({
        dimension: 3,
        particles: scene.particles,
        providers: scene.providers,
        stepFilters: scene.stepFilters,
        deltaTime: 1 / 120,
        gravity,
        initialPositions: scene.particles.map((p) => p.position.clone()),
        minimization: { gradientTolerance: 1e-2 }
      });
      applications[result.status] = (applications[result.status] ?? 0) + 1;
      if (step === 0 && result.minimization.status === 'converged') {
        expect(result.minimization.convergencePoint).toBe('initial');
        expect(result.minimization.iterations).toHaveLength(0);
      }
    }

    expect(applications['applied']).toBe(120);
    expect(applications['refused']).toBeUndefined();
    // Every step succeeded and the scene never moved.
    expect(scene.particles.map((p) => p.position.data[1]!)).toEqual(before);
  }, 60_000);
});
