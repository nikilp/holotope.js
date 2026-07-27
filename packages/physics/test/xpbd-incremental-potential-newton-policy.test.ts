import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  applyXpbdIncrementalPotentialResultN,
  compileXpbdIncrementalPotentialProblemN,
  minimizeXpbdIncrementalPotentialN,
  stepXpbdIncrementalPotentialN,
  xpbdMassPreconditionedDirectionN,
  xpbdNewtonDirectionPolicyN,
  xpbdSteepestDescentDirectionN,
  type XpbdConservativeForceProviderN,
  type XpbdConservativeHessianVectorProviderN,
  type XpbdIncrementalPotentialProblemN,
  type XpbdNewtonDirectionPolicyEvidenceN
} from '../src/index.js';

// --- dense oracles ----------------------------------------------------------
const applyDense = (
  matrix: readonly (readonly number[])[],
  vector: ArrayLike<number>
): Float64Array => {
  const out = new Float64Array(matrix.length);
  for (let row = 0; row < matrix.length; row++) {
    let sum = 0;
    for (let column = 0; column < matrix.length; column++) {
      sum += matrix[row]![column]! * vector[column]!;
    }
    out[row] = sum;
  }
  return out;
};

/** Independent dense solve of `A x = b` by Gaussian elimination. */
const denseSolve = (
  matrix: readonly (readonly number[])[],
  rhs: ArrayLike<number>
): Float64Array => {
  const n = matrix.length;
  const a = matrix.map((row, index) => [...row, rhs[index]!]);
  for (let pivot = 0; pivot < n; pivot++) {
    let best = pivot;
    for (let row = pivot + 1; row < n; row++) {
      if (Math.abs(a[row]![pivot]!) > Math.abs(a[best]![pivot]!)) best = row;
    }
    [a[pivot], a[best]] = [a[best]!, a[pivot]!];
    const scale = a[pivot]![pivot]!;
    for (let column = pivot; column <= n; column++) a[pivot]![column]! /= scale;
    for (let row = 0; row < n; row++) {
      if (row === pivot) continue;
      const factor = a[row]![pivot]!;
      for (let column = pivot; column <= n; column++) {
        a[row]![column]! -= factor * a[pivot]![column]!;
      }
    }
  }
  return Float64Array.from(a, (row) => row[n]!);
};

/** Conservative provider whose potential is the quadratic form of `matrix`. */
function quadraticProvider(
  id: string,
  particles: readonly XpbdParticleN[],
  matrix: readonly (readonly number[])[]
): XpbdConservativeHessianVectorProviderN {
  const dimension = particles[0]!.dimension;
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (
    positionOf
  ) => {
    const coordinates = Float64Array.from(
      particles.flatMap((particle) => positionOf(particle).toArray())
    );
    const gradient = applyDense(matrix, coordinates);
    let energy = 0;
    for (let index = 0; index < coordinates.length; index++) {
      energy += 0.5 * coordinates[index]! * gradient[index]!;
    }
    return {
      potentialEnergy: energy,
      forces: particles.map((_, particle) =>
        new VecN(gradient.subarray(
          particle * dimension,
          (particle + 1) * dimension
        )).multiplyScalar(-1)
      )
    };
  };
  return {
    id,
    dimension,
    particles,
    evaluate: () => evaluateAt((particle) => particle.position.clone()),
    evaluateAt,
    evaluatePotentialHessianVectorAt: (_positionOf, directionOf) => {
      const direction = Float64Array.from(
        particles.flatMap((particle) => directionOf(particle).toArray())
      );
      const product = applyDense(matrix, direction);
      return {
        products: particles.map((_, particle) =>
          new VecN(product.subarray(
            particle * dimension,
            (particle + 1) * dimension
          ))
        )
      };
    }
  };
}

/** First-order-only provider: forces without any curvature capability. */
function firstOrderOnlyProvider(
  id: string,
  particle: XpbdParticleN
): XpbdConservativeForceProviderN {
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (
    positionOf
  ) => {
    const position = positionOf(particle);
    return {
      potentialEnergy: 0.5 * position.lengthSq(),
      forces: [position.multiplyScalar(-1)]
    };
  };
  return {
    id,
    dimension: particle.dimension,
    particles: [particle],
    evaluate: () => evaluateAt(() => particle.position.clone()),
    evaluateAt
  };
}

function scene(
  dimension: number,
  matrix: readonly (readonly number[])[] | null,
  options: { readonly inverseMass?: number; readonly deltaTime?: number } = {}
): {
  particle: XpbdParticleN;
  problem: XpbdIncrementalPotentialProblemN;
  providers: XpbdConservativeForceProviderN[];
} {
  const particle = new XpbdParticleN({
    id: 'p',
    position: new VecN(dimension),
    inverseMass: options.inverseMass ?? 1
  });
  const providers = matrix === null
    ? []
    : [quadraticProvider('quadratic', [particle], matrix)];
  return {
    particle,
    providers,
    problem: compileXpbdIncrementalPotentialProblemN({
      dimension,
      particles: [particle],
      predictedPositions: [new VecN(dimension)],
      deltaTime: options.deltaTime ?? 1,
      providers
    })
  };
}

/** The exact packed objective Hessian for an SPD provider plus inertia. */
const denseObjectiveHessian = (
  matrix: readonly (readonly number[])[],
  inverseMass: number,
  deltaTime: number
): number[][] =>
  matrix.map((row, i) =>
    row.map((value, j) =>
      deltaTime * deltaTime * value + (i === j ? 1 / inverseMass : 0)
    )
  );

const SPD_2D = [[3, 0.5], [0.5, 2]] as const;
const INDEFINITE_2D = [[1, 0], [0, -4]] as const;

const evidenceOf = (
  value: unknown
): XpbdNewtonDirectionPolicyEvidenceN =>
  value as XpbdNewtonDirectionPolicyEvidenceN;

describe('xpbdNewtonDirectionPolicyN', () => {
  // 1. Exact Newton on an SPD quadratic plus inertia.
  it('matches an independent dense solve and converges in one iteration', () => {
    const { problem } = scene(2, SPD_2D);
    const start = [0.7, -0.4];
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: start,
      directionPolicy: xpbdNewtonDirectionPolicyN({ problem })
    });

    expect(result.status).toBe('converged');
    expect(result.iterations).toHaveLength(1);

    const iteration = result.iterations[0]!;
    const hessian = denseObjectiveHessian(SPD_2D, 1, 1);
    const expected = denseSolve(
      hessian,
      Float64Array.from(result.initial.gradient, (g) => -g)
    );
    for (let index = 0; index < expected.length; index++) {
      expect(iteration.direction[index]!).toBeCloseTo(expected[index]!, 12);
    }

    const evidence = evidenceOf(iteration.directionEvidence);
    expect(evidence.kind).toBe('newton-cg');
    expect(evidence.outcome).toBe('newton');
    expect(evidence.fallbackPolicyId).toBeNull();
    // Armijo accepted the full Newton step on its first trial.
    expect(iteration.search.stepLength).toBe(1);
  });

  it('is not a default anywhere', () => {
    const { problem } = scene(2, SPD_2D);
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0.7, -0.4]
    });
    expect(result.directionPolicyId).toBe('steepest-descent');
  });

  // 4. Refusal without an authored fallback.
  it('refuses on non-positive curvature and mutates nothing', () => {
    const { particle, problem } = scene(2, INDEFINITE_2D);
    const before = particle.position.clone();
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0.5, 0.5],
      directionPolicy: xpbdNewtonDirectionPolicyN({ problem })
    });

    expect(result.status).toBe('direction-refused');
    if (result.status !== 'direction-refused') throw new Error('unreachable');
    expect(result.reason).toBe('non-positive-curvature');
    expect(result.directionPolicyId).toBe('newton-cg');

    const evidence = evidenceOf(result.directionEvidence);
    expect(evidence.outcome).toBe('refused');
    expect(evidence.newton.status).toBe('non-positive-curvature');
    if (evidence.newton.status !== 'non-positive-curvature') {
      throw new Error('unreachable');
    }
    // The rejected ray and its curvature survive the terminal.
    expect(evidence.newton.krylovDirection.length).toBe(2);
    expect(evidence.newton.quadraticForm)
      .toBeLessThanOrEqual(evidence.newton.curvatureThreshold);
    expect(evidence.newton.product.length).toBe(2);

    expect(particle.position.toArray()).toEqual(before.toArray());
  });

  it('is refused by the application boundary as not-converged', () => {
    const { particle, problem } = scene(2, INDEFINITE_2D);
    const before = particle.position.clone();
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0.5, 0.5],
      directionPolicy: xpbdNewtonDirectionPolicyN({ problem })
    });
    const applied = applyXpbdIncrementalPotentialResultN({ result });

    expect(applied.status).toBe('refused');
    if (applied.status !== 'refused') throw new Error('unreachable');
    expect(applied.reason).toBe('not-converged');
    expect(applied.minimizationStatus).toBe('direction-refused');
    expect(particle.position.toArray()).toEqual(before.toArray());
  });

  // 5. Authored fallback.
  it('uses an authored fallback bitwise and retains the refusal evidence', () => {
    const { problem } = scene(2, INDEFINITE_2D);
    const policy = xpbdNewtonDirectionPolicyN({
      problem,
      fallback: {
        policy: xpbdMassPreconditionedDirectionN,
        on: ['non-positive-curvature']
      }
    });
    expect(policy.id).toBe('newton-cg+fallback:mass-diagonal');

    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0.5, 0.5],
      directionPolicy: policy,
      maximumIterations: 1
    });

    expect(result.iterations.length).toBeGreaterThanOrEqual(1);
    const iteration = result.iterations[0]!;
    const evidence = evidenceOf(iteration.directionEvidence);
    expect(evidence.outcome).toBe('fallback');
    expect(evidence.fallbackPolicyId).toBe('mass-diagonal');
    expect(evidence.newton.status).toBe('non-positive-curvature');

    // The direction is the fallback policy's own, evaluated on the same state.
    const reference = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0.5, 0.5],
      directionPolicy: xpbdMassPreconditionedDirectionN,
      maximumIterations: 1
    });
    expect(Array.from(iteration.direction))
      .toEqual(Array.from(reference.iterations[0]!.direction));
  });

  // 6. Unsupported provider.
  it('reports the exact incapable provider ids', () => {
    const particle = new XpbdParticleN({ id: 'p', position: new VecN(2) });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 2,
      particles: [particle],
      predictedPositions: [new VecN([0.3, 0.2])],
      deltaTime: 1,
      providers: [firstOrderOnlyProvider('first-order-only', particle)]
    });
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0, 0],
      directionPolicy: xpbdNewtonDirectionPolicyN({ problem })
    });

    expect(result.status).toBe('direction-refused');
    if (result.status !== 'direction-refused') throw new Error('unreachable');
    expect(result.reason).toBe('unsupported-provider');
    const evidence = evidenceOf(result.directionEvidence);
    if (evidence.newton.status !== 'unsupported-provider') {
      throw new Error('unreachable');
    }
    expect(evidence.newton.providerIds).toEqual(['first-order-only']);
  });

  // 7. Truncated Newton and the empty budget.
  it('truncates honestly and refuses an empty budget', () => {
    const { problem } = scene(2, SPD_2D);
    const truncated = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0.7, -0.4],
      directionPolicy: xpbdNewtonDirectionPolicyN({
        problem,
        maximumIterations: 1,
        relativeResidualTolerance: 0
      }),
      maximumIterations: 1
    });
    const iteration = truncated.iterations[0]!;
    const evidence = evidenceOf(iteration.directionEvidence);
    expect(evidence.outcome).toBe('truncated-newton');
    // A curvature-certified partial direction is still a descent direction.
    let slope = 0;
    for (let index = 0; index < iteration.direction.length; index++) {
      slope += truncated.initial.gradient[index]! * iteration.direction[index]!;
    }
    expect(slope).toBeLessThan(0);

    const empty = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0.7, -0.4],
      directionPolicy: xpbdNewtonDirectionPolicyN({
        problem,
        maximumIterations: 0
      })
    });
    expect(empty.status).toBe('direction-refused');
    if (empty.status !== 'direction-refused') throw new Error('unreachable');
    expect(empty.reason).toBe('empty-iteration-limit');
  });

  // 8. Determinism and purity.
  it('is deterministic and does not expose mutable evidence', () => {
    const build = () => {
      const { problem } = scene(2, SPD_2D);
      return minimizeXpbdIncrementalPotentialN({
        problem,
        initialCoordinates: [0.7, -0.4],
        directionPolicy: xpbdNewtonDirectionPolicyN({ problem })
      });
    };
    const first = build();
    const second = build();
    expect(Array.from(first.iterations[0]!.direction))
      .toEqual(Array.from(second.iterations[0]!.direction));
    expect(first.final.objective).toBe(second.final.objective);

    const evidence = evidenceOf(first.iterations[0]!.directionEvidence);
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  // 9. Transactional step through the factory seam.
  it('threads through stepXpbdIncrementalPotentialN by factory', () => {
    const particle = new XpbdParticleN({ id: 'p', position: new VecN(2) });
    const providers = [quadraticProvider('quadratic', [particle], SPD_2D)];
    const stepped = stepXpbdIncrementalPotentialN({
      dimension: 2,
      particles: [particle],
      deltaTime: 1,
      providers,
      minimization: {
        directionPolicyFactory: (problem) =>
          xpbdNewtonDirectionPolicyN({ problem })
      }
    });
    expect(stepped.minimization.directionPolicyId).toBe('newton-cg');
  });

  // 10. Seam validation.
  it('refuses ambiguous and malformed authoring', () => {
    const particle = new XpbdParticleN({ id: 'p', position: new VecN(2) });
    const providers = [quadraticProvider('quadratic', [particle], SPD_2D)];
    expect(() => stepXpbdIncrementalPotentialN({
      dimension: 2,
      particles: [particle],
      deltaTime: 1,
      providers,
      minimization: {
        directionPolicy: xpbdSteepestDescentDirectionN,
        directionPolicyFactory: (problem) =>
          xpbdNewtonDirectionPolicyN({ problem })
      }
    })).toThrow(/mutually exclusive/);

    const { problem } = scene(2, SPD_2D);
    expect(() => xpbdNewtonDirectionPolicyN({
      problem,
      fallback: { policy: xpbdMassPreconditionedDirectionN, on: [] }
    })).toThrow(/at least one trigger/);
    expect(() => xpbdNewtonDirectionPolicyN({
      problem,
      fallback: {
        policy: xpbdMassPreconditionedDirectionN,
        on: ['non-positive-curvature', 'non-positive-curvature']
      }
    })).toThrow(/duplicate/);
    expect(() => xpbdNewtonDirectionPolicyN({
      problem,
      fallback: {
        policy: xpbdMassPreconditionedDirectionN,
        on: ['not-descent' as 'non-positive-curvature']
      }
    })).toThrow(/unknown fallback trigger/);

    // A context sized against another objective is host wiring, not a state.
    const other = scene(3, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    const policy = xpbdNewtonDirectionPolicyN({ problem });
    expect(() => minimizeXpbdIncrementalPotentialN({
      problem: other.problem,
      initialCoordinates: [0.2, 0.2, 0.2],
      directionPolicy: policy
    })).toThrow(/coordinates/);
  });

  it('leaves a refusing fallback policy as an authoring error', () => {
    const { problem } = scene(2, INDEFINITE_2D);
    const refusing = {
      id: 'refuses',
      evaluate: () => ({ status: 'refused' as const, reason: 'no' })
    };
    const policy = xpbdNewtonDirectionPolicyN({
      problem,
      fallback: { policy: refusing, on: ['non-positive-curvature'] }
    });
    expect(() => minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0.5, 0.5],
      directionPolicy: policy
    })).toThrow(/must return a direction/);
  });
});
