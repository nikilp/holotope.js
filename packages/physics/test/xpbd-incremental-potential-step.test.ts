import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneBarrierN,
  XpbdParticleHyperplaneBarrierStepFilterN,
  XpbdParticleN,
  stepXpbdIncrementalPotentialN,
  type XpbdConservativeForceProviderN,
  type XpbdIncrementalPotentialStepResultN
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

function snapshot(particles: readonly XpbdParticleN[]): unknown {
  return particles.map((particle) => ({
    id: particle.id,
    dimension: particle.dimension,
    position: particle.position.toArray(),
    velocity: particle.velocity.toArray(),
    force: particle.force.toArray(),
    inverseMass: particle.inverseMass,
    gravityScale: particle.gravityScale
  }));
}

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 14
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]).toBeCloseTo(expected[index]!, digits);
  }
}

function resultSummary(
  result: XpbdIncrementalPotentialStepResultN
): unknown {
  const minimization = result.minimization;
  return {
    status: result.status,
    stage: result.status === 'refused' ? result.stage : undefined,
    reason: result.status === 'refused' ? result.reason : undefined,
    prediction: result.prediction.positions.map((value) => value.toArray()),
    progress: result.progress,
    minimization: minimization.status === 'initial-state-refused'
      ? {
          status: minimization.status,
          lawId: minimization.lawId,
          reason: minimization.reason
        }
      : {
          status: minimization.status,
          objective: minimization.final.objective,
          gradientNorm: minimization.final.gradientNorm,
          coordinates: Array.from(minimization.final.coordinates),
          steps: minimization.iterations.map((iteration) => ({
            stepLength: iteration.search.stepLength,
            stepNorm: iteration.stepNorm,
            objectiveDecrease: iteration.objectiveDecrease
          }))
        },
    application: result.status === 'applied'
      ? {
          objective: result.application.verifiedFinal.objective,
          positions: result.application.particles.map(
            (particle) => particle.positionAfter.toArray()
          )
        }
      : undefined
  };
}

describe('integrated XPBD incremental-potential step', () => {
  it('advances inertial-only particles exactly from R1 through R4', () => {
    for (const dimension of [1, 2, 3, 4]) {
      const position = Float64Array.from(
        { length: dimension },
        (_, axis) => -0.2 * (axis + 1)
      );
      const velocity = Float64Array.from(
        { length: dimension },
        (_, axis) => 0.3 * (axis + 1)
      );
      const force = Float64Array.from(
        { length: dimension },
        (_, axis) => 0.4 * (axis + 1)
      );
      const gravity = Float64Array.from(
        { length: dimension },
        (_, axis) => -0.1 * (axis + 1)
      );
      const particle = new XpbdParticleN({
        id: `r${dimension}`,
        position,
        velocity,
        inverseMass: 0.5,
        gravityScale: 0.25
      });
      particle.applyForce(force);
      const deltaTime = 0.2;
      const expectedPosition = Float64Array.from(
        { length: dimension },
        (_, axis) => {
          const acceleration =
            0.25 * gravity[axis]! + 0.5 * force[axis]!;
          return position[axis]! +
            deltaTime * (velocity[axis]! + deltaTime * acceleration);
        }
      );
      const result = stepXpbdIncrementalPotentialN({
        dimension,
        particles: [particle],
        providers: [],
        deltaTime,
        gravity
      });

      expect(result.status).toBe('applied');
      expect(result.minimization).toMatchObject({
        status: 'converged',
        convergencePoint: 'initial'
      });
      expect(result.progress).toEqual({
        acceptedIterations: 0,
        displacementNorm: 0,
        objectiveDecrease: 0,
        convergencePoint: 'initial'
      });
      expectArrayClose(particle.position.data, expectedPosition);
      for (let axis = 0; axis < dimension; axis++) {
        expect(particle.velocity.data[axis]).toBeCloseTo(
          (expectedPosition[axis]! - position[axis]!) / deltaTime,
          14
        );
      }
      expect(particle.force.lengthSq()).toBe(0);
    }
  });

  it('matches the analytic isotropic implicit step from R1 through R4', () => {
    for (const dimension of [1, 2, 3, 4]) {
      const position = Float64Array.from(
        { length: dimension },
        (_, axis) => 0.5 * (axis + 1)
      );
      const particle = new XpbdParticleN({
        id: `quadratic-r${dimension}`,
        position,
        inverseMass: 0.25
      });
      const stiffness = 5;
      const deltaTime = 0.2;
      const mass = 1 / particle.inverseMass;
      const curvature = mass + deltaTime * deltaTime * stiffness;
      const expectedScale = mass / curvature;
      const result = stepXpbdIncrementalPotentialN({
        dimension,
        particles: [particle],
        providers: [quadraticProvider('quadratic', [particle], stiffness)],
        deltaTime,
        minimization: {
          initialStep: 1 / curvature,
          gradientTolerance: 1e-13
        }
      });

      expect(result.status).toBe('applied');
      expect(result.minimization.iterations).toHaveLength(1);
      expectArrayClose(
        particle.position.data,
        Float64Array.from(position, (coordinate) =>
          expectedScale * coordinate
        ),
        13
      );
    }
  });

  it('prescribes fixed particles and retains their velocity', () => {
    const fixed = new XpbdParticleN({
      id: 'fixed',
      position: [1, -2],
      velocity: [0.7, -0.4],
      inverseMass: 0
    });
    fixed.applyForce([9, 8]);
    const result = stepXpbdIncrementalPotentialN({
      dimension: 2,
      particles: [fixed],
      providers: [],
      deltaTime: 0.1,
      gravity: [0, -9.8]
    });

    expect(result.status).toBe('applied');
    expect(fixed.position.toArray()).toEqual([1, -2]);
    expect(fixed.velocity.toArray()).toEqual([0.7, -0.4]);
    expect(fixed.force.toArray()).toEqual([0, 0]);
    expect(result.problem.variableCount).toBe(0);
  });

  it('accepts an explicit warm start and preserves authored application policy', () => {
    const particle = new XpbdParticleN({
      id: 'warm',
      position: [1],
      velocity: [0.25],
      inverseMass: 1
    });
    particle.applyForce([2]);
    const result = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [],
      deltaTime: 0.5,
      warmStart: 'inertial-prediction',
      initialPositions: [new VecN([-1])],
      minimization: { initialStep: 1, gradientTolerance: 1e-14 },
      application: { velocityUpdate: 'preserve', clearForces: false }
    });

    expect(result.status).toBe('applied');
    expect(result.minimization.initial.coordinates[0]).toBe(-1);
    expect(result.progress.acceptedIterations).toBeGreaterThan(0);
    expect(particle.position.data[0]).toBeCloseTo(1.625, 14);
    expect(particle.velocity.data[0]).toBe(0.25);
    expect(particle.force.data[0]).toBe(2);
  });

  it('rejects unknown warm-start policy names before changing particle state', () => {
    const particle = new XpbdParticleN({
      id: 'invalid-warm-start',
      position: [1],
      velocity: [0.25],
      inverseMass: 1
    });
    const before = snapshot([particle]);

    expect(() => stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [],
      deltaTime: 0.5,
      warmStart: 'current' as never
    })).toThrow(/warmStart must be "inertial-prediction"/);
    expect(snapshot([particle])).toEqual(before);
  });

  it('keeps the omitted and explicit inertial-prediction paths identical', () => {
    const run = (explicit: boolean) => {
      const particle = new XpbdParticleN({
        id: 'unchanged-default',
        position: [1, -0.5],
        velocity: [0.2, 0.1],
        inverseMass: 0.5
      });
      particle.applyForce([0.3, -0.4]);
      const result = stepXpbdIncrementalPotentialN({
        dimension: 2,
        particles: [particle],
        providers: [],
        deltaTime: 0.125,
        ...(explicit ? { warmStart: 'inertial-prediction' as const } : {})
      });
      return {
        status: result.status,
        position: Array.from(particle.position.data),
        velocity: Array.from(particle.velocity.data),
        force: Array.from(particle.force.data),
        initial: Array.from(result.minimization.initial.coordinates),
        final: Array.from(result.minimization.final.coordinates),
        progress: result.progress,
        hasRecovery: 'feasibleBaseRecovery' in result
      };
    };

    expect(run(false)).toEqual(run(true));
  });

  it('recovers an inadmissible inertial prediction from a valid barrier state', () => {
    const run = (
      warmStart: 'inertial-prediction' | 'previous-positions' | 'feasible-inertial-prediction'
    ) => {
      const particle = new XpbdParticleN({
        id: warmStart,
        position: [0.2],
        velocity: [-1.5],
        inverseMass: 1
      });
      const barrier = new XpbdParticleHyperplaneBarrierN({
        id: `floor/${warmStart}`,
        particle,
        plane: new HyperplaneColliderN([1], 0),
        minimumDistance: 0.1,
        activationDistance: 0.8,
        stiffness: 1
      });
      return {
        particle,
        result: stepXpbdIncrementalPotentialN({
          dimension: 1,
          particles: [particle],
          providers: [barrier],
          stepFilters: [new XpbdParticleHyperplaneBarrierStepFilterN({
            id: `floor-filter/${warmStart}`,
            barrier
          })],
          deltaTime: 0.1,
          warmStart
        })
      };
    };

    const inertial = run('inertial-prediction');
    expect(inertial.result).toMatchObject({
      status: 'refused',
      minimization: { status: 'initial-state-refused' }
    });
    expect(inertial.particle.position.data[0]).toBe(0.2);

    const previous = run('previous-positions');
    const recovered = run('feasible-inertial-prediction');
    expect(previous.result.status).toBe('applied');
    expect(recovered.result.status).toBe('applied');
    expect(recovered.result.feasibleBaseRecovery).toMatchObject({
      status: 'recovered',
      fraction: 0.5
    });
    expect(recovered.result.feasibleBaseRecovery?.trials.map((trial) =>
      trial.status
    )).toEqual(['domain-refused', 'feasible', 'feasible']);
    expect(recovered.particle.position.data[0]).toBeCloseTo(
      previous.particle.position.data[0]!,
      8
    );
  });

  it('keeps explicit positions authoritative and rejects ignored recovery options', () => {
    const particle = new XpbdParticleN({ id: 'explicit-recovery', position: [0] });
    const explicit = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [],
      deltaTime: 0.1,
      warmStart: 'feasible-inertial-prediction',
      feasibleWarmStart: { contractionFactor: 0.25, maximumTrials: 4 },
      initialPositions: [new VecN([0.3])]
    });
    expect(explicit.status).toBe('applied');
    expect('feasibleBaseRecovery' in explicit).toBe(false);
    expect(explicit.minimization.initial.coordinates[0]).toBe(0.3);

    expect(() => stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [new XpbdParticleN({ id: 'ignored', position: [0] })],
      providers: [],
      deltaTime: 0.1,
      warmStart: 'previous-positions',
      feasibleWarmStart: {}
    })).toThrow(/requires warmStart "feasible-inertial-prediction"/);
    expect(() => stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [new XpbdParticleN({ id: 'unknown', position: [0] })],
      providers: [],
      deltaTime: 0.1,
      warmStart: 'feasible-inertial-prediction',
      feasibleWarmStart: { mystery: 1 } as never
    })).toThrow(/unknown option/);
  });

  it('returns bounded non-convergence without changing any particle state', () => {
    const particle = new XpbdParticleN({
      id: 'bounded',
      position: [1, 2],
      velocity: [0.2, -0.1],
      inverseMass: 1
    });
    particle.applyForce([3, 4]);
    const before = snapshot([particle]);
    const result = stepXpbdIncrementalPotentialN({
      dimension: 2,
      particles: [particle],
      providers: [],
      deltaTime: 0.1,
      initialPositions: [new VecN([-1, -2])],
      minimization: { maximumIterations: 0 }
    });

    expect(result).toMatchObject({
      status: 'refused',
      stage: 'minimization',
      reason: 'not-converged',
      minimization: { status: 'iteration-limit' }
    });
    expect(result.progress).toEqual({
      acceptedIterations: 0,
      displacementNorm: 0,
      objectiveDecrease: 0
    });
    expect(snapshot([particle])).toEqual(before);
  });

  it('rolls back a provider mutation on typed application refusal', () => {
    const particle = new XpbdParticleN({
      id: 'mutated',
      position: [0],
      velocity: [0.5],
      inverseMass: 1
    });
    particle.applyForce([2]);
    const positionReference = particle.position;
    const before = snapshot([particle]);
    const provider: XpbdConservativeForceProviderN = {
      id: 'mutating',
      dimension: 1,
      particles: [particle],
      evaluate: () => ({ potentialEnergy: 0, forces: [new VecN([0])] }),
      evaluateAt: () => {
        (particle as unknown as { position: VecN }).position =
          new VecN([99]);
        particle.velocity.data[0] = -77;
        return { potentialEnergy: 0, forces: [new VecN([0])] };
      }
    };
    const result = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [provider],
      deltaTime: 0.2
    });

    expect(result).toMatchObject({
      status: 'refused',
      stage: 'application',
      reason: 'stale-particle-state'
    });
    expect(particle.position).toBe(positionReference);
    expect(snapshot([particle])).toEqual(before);
  });

  it('rolls back a mutating provider before rethrowing its error', () => {
    const particle = new XpbdParticleN({
      id: 'throwing',
      position: [0, 1],
      velocity: [0.2, 0.3],
      inverseMass: 1
    });
    particle.applyForce([4, 5]);
    const before = snapshot([particle]);
    const positionReference = particle.position;
    const provider: XpbdConservativeForceProviderN = {
      id: 'throwing-provider',
      dimension: 2,
      particles: [particle],
      evaluate: () => {
        throw new Error('not used');
      },
      evaluateAt: () => {
        (particle as unknown as { position: VecN }).position =
          new VecN([7, 8]);
        particle.force.data.fill(-2);
        throw new Error('provider exploded');
      }
    };

    expect(() => stepXpbdIncrementalPotentialN({
      dimension: 2,
      particles: [particle],
      providers: [provider],
      deltaTime: 0.1
    })).toThrow('provider exploded');
    expect(particle.position).toBe(positionReference);
    expect(snapshot([particle])).toEqual(before);
  });

  it('is deterministic across equivalent inputs', () => {
    const run = (): {
      readonly state: unknown;
      readonly result: unknown;
    } => {
      const particle = new XpbdParticleN({
        id: 'repeat',
        position: [0.4, -0.7, 0.2],
        velocity: [0.1, 0.2, -0.3],
        inverseMass: 0.5
      });
      const result = stepXpbdIncrementalPotentialN({
        dimension: 3,
        particles: [particle],
        providers: [quadraticProvider('q', [particle], 2)],
        deltaTime: 0.1,
        minimization: {
          initialStep: 1 / (2 + 0.01 * 2),
          gradientTolerance: 1e-14
        }
      });
      return {
        state: snapshot([particle]),
        result: resultSummary(result)
      };
    };

    expect(run()).toEqual(run());
  });
});
