import { CellComplex, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  SimplexConstitutiveDomainErrorN,
  XpbdParticleN,
  compileSimplexConstitutiveFamilyN,
  compileXpbdIncrementalPotentialProblemN,
  minimizeXpbdIncrementalPotentialN,
  simplexMeasureBarrierLawN,
  type XpbdConservativeForceProviderN,
  type XpbdIncrementalPotentialMinimizationResultN
} from '../src/index.js';

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

function particleSnapshot(particles: readonly XpbdParticleN[]): unknown {
  return particles.map((particle) => ({
    position: particle.position.toArray(),
    velocity: particle.velocity.toArray(),
    force: particle.force.toArray(),
    inverseMass: particle.inverseMass,
    gravityScale: particle.gravityScale
  }));
}

function minimizationSummary(
  result: XpbdIncrementalPotentialMinimizationResultN
): unknown {
  return {
    status: result.status,
    finalCoordinates: Array.from(result.final.coordinates),
    finalObjective: result.final.objective,
    finalGradientNorm: result.final.gradientNorm,
    iterations: result.iterations.map((iteration) => ({
      index: iteration.index,
      direction: Array.from(iteration.direction),
      stepNorm: iteration.stepNorm,
      objectiveDecrease: iteration.objectiveDecrease,
      stepLength: iteration.search.stepLength,
      trialStatuses: iteration.search.trials.map((trial) => trial.status),
      coordinates: Array.from(iteration.search.accepted.coordinates)
    }))
  };
}

describe('bounded XPBD incremental-potential minimizer', () => {
  it('reaches a one-coordinate quadratic closed form in one accepted step', () => {
    const particle = new XpbdParticleN({
      id: 'p',
      position: [-1],
      inverseMass: 0.5
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([3])],
      deltaTime: 0.5,
      providers: [quadraticProvider('spring', [particle], 4)]
    });
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [-1],
      initialStep: 1 / 3,
      gradientTolerance: 1e-14
    });

    expect(result.status).toBe('converged');
    expect(result.iterations).toHaveLength(1);
    expect(result.final.coordinates[0]).toBeCloseTo(2, 14);
    expect(result.final.gradientNorm).toBeLessThanOrEqual(1e-14);
    expect(result.iterations[0]).toMatchObject({
      index: 0,
      stepNorm: 3,
      objectiveDecrease: 13.5
    });
  });

  it('preserves the analytic isotropic solution from R1 through R4', () => {
    for (const dimension of [1, 2, 3, 4]) {
      const particle = new XpbdParticleN({
        id: `p-${dimension}`,
        position: new VecN(dimension),
        inverseMass: 0.25
      });
      const prediction = new VecN(Array.from(
        { length: dimension },
        (_, axis) => 0.4 * (axis + 1)
      ));
      const stiffness = 5;
      const deltaTime = 0.2;
      const curvature =
        1 / particle.inverseMass + deltaTime * deltaTime * stiffness;
      const expectedScale = (1 / particle.inverseMass) / curvature;
      const initial = Float64Array.from(
        { length: dimension },
        (_, axis) => -0.3 * (axis + 1)
      );
      const problem = compileXpbdIncrementalPotentialProblemN({
        dimension,
        particles: [particle],
        predictedPositions: [prediction],
        deltaTime,
        providers: [quadraticProvider('quadratic', [particle], stiffness)]
      });
      const result = minimizeXpbdIncrementalPotentialN({
        problem,
        initialCoordinates: initial,
        initialStep: 1 / curvature,
        gradientTolerance: 1e-13
      });

      expect(result.status).toBe('converged');
      expect(result.iterations).toHaveLength(1);
      for (let axis = 0; axis < dimension; axis++) {
        expect(result.final.coordinates[axis]).toBeCloseTo(
          expectedScale * prediction.data[axis]!,
          14
        );
      }
    }
  });

  it('retains real barrier refusals and accepts only in-domain iterates', () => {
    const source = new CellComplex(1, new Float64Array([0, 1]));
    const group: CellGroup = {
      key: 'line',
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    source.addGroup(group);
    const particles = [
      new XpbdParticleN({ id: 'fixed', position: [0], inverseMass: 0 }),
      new XpbdParticleN({ id: 'free', position: [1], inverseMass: 1 })
    ];
    const barrier = compileSimplexConstitutiveFamilyN({
      id: 'barrier',
      source,
      simplexGroup: group,
      particles,
      law: simplexMeasureBarrierLawN,
      material: {
        minimumMeasureRatio: 0.2,
        activationMeasureRatio: 0.9,
        stiffness: 1
      }
    });
    const before = particleSnapshot(particles);
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles,
      predictedPositions: [new VecN([0]), new VecN([0])],
      deltaTime: 0.1,
      providers: [barrier]
    });
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [1],
      gradientTolerance: 0,
      maximumIterations: 6
    });

    expect(result.iterations.length).toBeGreaterThan(0);
    expect(result.iterations[0]!.search.trials[0]).toMatchObject({
      status: 'domain-refused',
      refusal: { lawId: 'simplex-measure-barrier' }
    });
    for (const iteration of result.iterations) {
      expect(iteration.search.accepted.coordinates[0]).toBeGreaterThan(0.2);
    }
    expect(particleSnapshot(particles)).toEqual(before);
  });

  it('reports bounded exhaustion and zero-iteration evaluation exactly', () => {
    const particle = new XpbdParticleN({
      id: 'p',
      position: [0],
      inverseMass: 1
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 0.1,
      providers: []
    });
    const initialCoordinates = Float64Array.of(1);
    const zero = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates,
      maximumIterations: 0
    });
    expect(zero).toMatchObject({
      status: 'iteration-limit',
      maximumIterations: 0,
      iterations: []
    });
    expect(Array.from(zero.final.coordinates)).toEqual([1]);

    const exhausted = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates,
      initialStep: 10,
      maximumLineSearchTrials: 1
    });
    expect(exhausted.status).toBe('line-search-exhausted');
    if (exhausted.status !== 'line-search-exhausted') return;
    expect(exhausted.iterations).toEqual([]);
    expect(exhausted.search.trials).toHaveLength(1);
    expect(exhausted.search.trials[0]!.status)
      .toBe('insufficient-decrease');
    expect(Array.from(initialCoordinates)).toEqual([1]);
  });

  it('reports coordinate-resolution stall rather than false progress', () => {
    const particle = new XpbdParticleN({
      id: 'p',
      position: [1e16],
      inverseMass: 1
    });
    const linear: XpbdConservativeForceProviderN = {
      id: 'linear',
      dimension: 1,
      particles: [particle],
      evaluate: () => ({
        potentialEnergy: particle.position.data[0]!,
        forces: [new VecN([-1])]
      }),
      evaluateAt: (positionOf) => ({
        potentialEnergy: positionOf(particle).data[0]!,
        forces: [new VecN([-1])]
      })
    };
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([1e16])],
      deltaTime: 1,
      providers: [linear]
    });
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [1e16],
      gradientTolerance: 0
    });

    expect(result).toMatchObject({
      status: 'stalled',
      reason: 'coordinate-resolution'
    });
    expect(result.iterations).toHaveLength(1);
    expect(result.iterations[0]!.objectiveDecrease).toBe(0);
    expect(result.iterations[0]!.search.status).toBe('accepted');
    expect(result.final.coordinates[0]).toBe(1e16);
  });

  it('is deterministic and does not mutate caller or particle state', () => {
    const particle = new XpbdParticleN({
      id: 'p',
      position: [0.5, -0.25, 0.75],
      velocity: [0.1, 0.2, -0.3],
      force: [0.4, -0.5, 0.6],
      inverseMass: 0.75
    });
    const before = particleSnapshot([particle]);
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 3,
      particles: [particle],
      predictedPositions: [new VecN([0.8, -0.4, 0.2])],
      deltaTime: 0.25,
      providers: [quadraticProvider('quadratic', [particle], 2.5)]
    });
    const initial = Float64Array.of(-0.7, 0.6, 0.9);
    const first = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: initial,
      initialStep: 0.8,
      maximumIterations: 12,
      gradientTolerance: 1e-12
    });
    const second = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: initial,
      initialStep: 0.8,
      maximumIterations: 12,
      gradientTolerance: 1e-12
    });

    expect(minimizationSummary(second)).toEqual(minimizationSummary(first));
    expect(Array.from(initial)).toEqual([-0.7, 0.6, 0.9]);
    expect(particleSnapshot([particle])).toEqual(before);
  });

  it('rethrows invalid bases, stale maps, provider bugs, and bad policies', () => {
    const particle = new XpbdParticleN({
      id: 'p',
      position: [1],
      inverseMass: 1
    });
    const buggy: XpbdConservativeForceProviderN = {
      id: 'buggy',
      dimension: 1,
      particles: [particle],
      evaluate: () => ({
        potentialEnergy: 0.5,
        forces: [new VecN([-1])]
      }),
      evaluateAt: () => {
        throw new Error('provider bug');
      }
    };
    const buggyProblem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 1,
      providers: [buggy]
    });
    expect(() => minimizeXpbdIncrementalPotentialN({
      problem: buggyProblem,
      initialCoordinates: [1]
    })).toThrow(/provider bug/);
    expect(() => minimizeXpbdIncrementalPotentialN({
      problem: buggyProblem,
      initialCoordinates: [1],
      maximumIterations: -1
    })).toThrow(/maximumIterations must be a non-negative integer/);
    expect(() => minimizeXpbdIncrementalPotentialN({
      problem: buggyProblem,
      initialCoordinates: [1],
      maximumIterations: 0,
      contractionFactor: 1
    })).toThrow(/contractionFactor must be in/);

    const validProblem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 1,
      providers: []
    });
    expect(() => minimizeXpbdIncrementalPotentialN({
      problem: validProblem,
      initialCoordinates: [Number.NaN]
    })).toThrow(/coordinates must be finite/);
    (particle as { inverseMass: number }).inverseMass = 0;
    expect(() => minimizeXpbdIncrementalPotentialN({
      problem: validProblem,
      initialCoordinates: [1]
    })).toThrow(/inverseMass changed after compilation/);

    const source = new CellComplex(1, new Float64Array([0, 1]));
    const group: CellGroup = {
      key: 'line',
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    source.addGroup(group);
    const fixed = new XpbdParticleN({
      id: 'fixed',
      position: [0],
      inverseMass: 0
    });
    const free = new XpbdParticleN({
      id: 'free',
      position: [1],
      inverseMass: 1
    });
    const barrier = compileSimplexConstitutiveFamilyN({
      id: 'barrier',
      source,
      simplexGroup: group,
      particles: [fixed, free],
      law: simplexMeasureBarrierLawN,
      material: {
        minimumMeasureRatio: 0.2,
        activationMeasureRatio: 0.9,
        stiffness: 1
      }
    });
    const invalidBase = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [fixed, free],
      predictedPositions: [new VecN([0]), new VecN([1])],
      deltaTime: 0.1,
      providers: [barrier]
    });
    expect(() => minimizeXpbdIncrementalPotentialN({
      problem: invalidBase,
      initialCoordinates: [0]
    })).toThrow(SimplexConstitutiveDomainErrorN);
  });
});
