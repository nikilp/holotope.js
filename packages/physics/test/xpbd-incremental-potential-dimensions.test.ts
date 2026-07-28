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
  });

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
  });

  it('completes once each solve starts from the current feasible state', () => {
    for (const dimension of [2, 3, 4]) {
      const result = run(dimension, 90, { fromCurrentState: true });
      expect(result.refusal).toBeNull();
      expect(result.completed).toBe(90);
    }
  });

  /**
   * Resting contact does not converge at this tolerance, which is the
   * matrix-free solver's known limitation rather than a defect in the scene:
   * the barrier Hessian conditions like 1/d² as the gap closes, and a
   * Jacobi-preconditioned conjugate gradient stalls there. The state is stable
   * even so, which is why this is worth pinning rather than hiding.
   */
  it('reaches its iteration budget in resting contact while staying stable', () => {
    const result = run(4, 90, { fromCurrentState: true });
    expect(result.terminals['converged']).toBeGreaterThan(0);
    expect(result.terminals['iteration-limit']).toBeGreaterThan(0);

    const settled = run(4, 120, { fromCurrentState: true });
    // Stable: more stepping does not push the particles through the floor.
    for (const height of settled.heights) expect(height).toBeGreaterThan(0);
  });
});
