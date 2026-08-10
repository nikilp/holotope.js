import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdPotentialDomainErrorN,
  diagnoseXpbdIncrementalPotentialStepN,
  stepXpbdIncrementalPotentialN,
  type XpbdConservativeForceProviderN
} from '../src/index.js';

function openHalfLineProvider(
  particle: XpbdParticleN
): XpbdConservativeForceProviderN {
  return {
    id: 'open-half-line',
    dimension: 1,
    particles: [particle],
    evaluate: () => ({ potentialEnergy: 0, forces: [new VecN([0])] }),
    evaluateAt: (positionOf) => {
      if (!(positionOf(particle).data[0]! > 0)) {
        throw new XpbdPotentialDomainErrorN(
          'open-half-line',
          'non-positive-coordinate',
          'candidate must remain positive'
        );
      }
      return { potentialEnergy: 0, forces: [new VecN([0])] };
    }
  };
}

describe('incremental-potential step diagnosis', () => {
  it('turns an inadmissible inertial base into typed evidence and legitimate levers', () => {
    const particle = new XpbdParticleN({
      id: 'falling',
      position: [0.1],
      velocity: [-1],
      inverseMass: 1
    });
    const result = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [openHalfLineProvider(particle)],
      deltaTime: 1
    });

    expect(result).toMatchObject({
      status: 'refused',
      stage: 'minimization',
      minimization: {
        status: 'initial-state-refused',
        lawId: 'open-half-line',
        reason: 'non-positive-coordinate'
      },
      progress: {
        acceptedIterations: 0,
        displacementNorm: 0,
        objectiveDecrease: 0
      }
    });
    expect(particle.position.toArray()).toEqual([0.1]);
    expect(diagnoseXpbdIncrementalPotentialStepN(result)).toMatchObject({
      condition: 'initial-state-refused',
      levers: [
        'warm-start-previous-positions',
        'warm-start-feasible-inertial-prediction',
        'repair-initial-state'
      ]
    });
  });

  it('reports that an invalid authored anchor requires repair', () => {
    const particle = new XpbdParticleN({
      id: 'invalid-anchor',
      position: [-0.1],
      inverseMass: 1
    });
    const result = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [openHalfLineProvider(particle)],
      deltaTime: 0.1,
      warmStart: 'feasible-inertial-prediction'
    });
    const diagnosis = diagnoseXpbdIncrementalPotentialStepN(result);

    expect(result.minimization.status).toBe('initial-state-refused');
    expect(result.feasibleBaseRecovery?.status).toBe('anchor-refused');
    expect(diagnosis).toMatchObject({
      condition: 'initial-state-refused',
      levers: ['repair-initial-state'],
      facts: {
        feasibleBaseRecoveryStatus: 'anchor-refused',
        feasibleBaseRecoveryTrials: 2,
        feasibleBaseFeasibleTrials: 0,
        feasibleBaseDomainRefusals: 2,
        feasibleBaseLastRefusalLawId: 'open-half-line',
        feasibleBaseLastRefusalReason: 'non-positive-coordinate'
      }
    });
    expect(particle.position.data[0]).toBe(-0.1);
  });

  it('lets previous positions or explicit positions replace the inadmissible base', () => {
    for (const explicit of [false, true]) {
      const particle = new XpbdParticleN({
        id: explicit ? 'explicit' : 'previous',
        position: [0.1],
        velocity: [-1],
        inverseMass: 1
      });
      const result = stepXpbdIncrementalPotentialN({
        dimension: 1,
        particles: [particle],
        providers: [openHalfLineProvider(particle)],
        deltaTime: 1,
        warmStart: explicit ? 'inertial-prediction' : 'previous-positions',
        ...(explicit ? { initialPositions: [new VecN([0.2])] } : {}),
        minimization: { maximumIterations: 0 }
      });
      expect(result.minimization.status).toBe('iteration-limit');
      if (result.minimization.status === 'initial-state-refused') return;
      expect(result.minimization.initial.coordinates[0]).toBe(
        explicit ? 0.2 : 0.1
      );
    }
  });

  it('surfaces zero-iteration convergence without deciding whether it is wrong', () => {
    const particle = new XpbdParticleN({
      id: 'inertial',
      position: [0],
      velocity: [1],
      inverseMass: 1
    });
    const result = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [],
      deltaTime: 0.25
    });
    const diagnosis = diagnoseXpbdIncrementalPotentialStepN(result);

    expect(result.status).toBe('applied');
    expect(particle.position.data[0]).toBe(0.25);
    expect(diagnosis.condition).toBe('converged-without-iteration');
    // Under the packed-gradient criterion an immediate accept can mean a real
    // force fell below `tolerance / deltaTime²`, so re-authoring the stop test
    // in a timestep-independent unit is offered alongside lowering it.
    expect(diagnosis.levers).toEqual([
      'lower-gradient-tolerance',
      'timestep-independent-convergence'
    ]);
    expect(diagnosis.facts).toMatchObject({
      acceptedIterations: 0,
      displacementNorm: 0,
      convergencePoint: 'initial',
      convergenceKind: 'packed-gradient'
    });
  });

  it('classifies real progress and bounded exhaustion without pulling a lever', () => {
    const progressedParticle = new XpbdParticleN({
      id: 'progressed',
      position: [1],
      inverseMass: 1
    });
    const spring = {
      id: 'spring',
      dimension: 1,
      particles: [progressedParticle],
      evaluate: () => ({
        potentialEnergy: 0.5 * progressedParticle.position.data[0]! ** 2,
        forces: [new VecN([-progressedParticle.position.data[0]!])]
      }),
      evaluateAt: (positionOf: (particle: XpbdParticleN) => VecN) => {
        const x = positionOf(progressedParticle).data[0]!;
        return { potentialEnergy: 0.5 * x * x, forces: [new VecN([-x])] };
      }
    } satisfies XpbdConservativeForceProviderN;
    const progressed = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [progressedParticle],
      providers: [spring],
      deltaTime: 0.1,
      minimization: {
        gradientTolerance: 1e-12,
        // Exact inverse curvature of the 1D incremental objective.
        initialStep: 1 / 1.01
      }
    });
    expect(diagnoseXpbdIncrementalPotentialStepN(progressed)).toMatchObject({
      condition: 'progressed',
      levers: []
    });

    const limitedParticle = new XpbdParticleN({
      id: 'limited',
      position: [1],
      inverseMass: 1
    });
    const limited = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [limitedParticle],
      providers: [],
      deltaTime: 0.1,
      initialPositions: [new VecN([0])],
      minimization: { maximumIterations: 0 }
    });
    const diagnosis = diagnoseXpbdIncrementalPotentialStepN(limited);
    expect(diagnosis.condition).toBe('iteration-limit');
    expect(diagnosis.levers).toEqual([
      'newton-direction-policy',
      'mass-diagonal-policy',
      'raise-iteration-budget'
    ]);
    expect(diagnosis.levers).not.toContain('lower-gradient-tolerance');
  });

  it('classifies every search and direction refusal from retained evidence', () => {
    const lineSearchParticle = new XpbdParticleN({
      id: 'line-search',
      position: [0],
      inverseMass: 1
    });
    const lineSearchExhausted = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [lineSearchParticle],
      providers: [],
      deltaTime: 1,
      initialPositions: [new VecN([1])],
      minimization: {
        initialStep: 10,
        maximumLineSearchTrials: 1
      }
    });
    expect(diagnoseXpbdIncrementalPotentialStepN(lineSearchExhausted))
      .toMatchObject({
        condition: 'line-search-exhausted',
        levers: ['newton-direction-policy', 'mass-diagonal-policy']
      });

    const filterParticle = new XpbdParticleN({
      id: 'filter',
      position: [0],
      inverseMass: 1
    });
    const lineSearchRefused = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [filterParticle],
      providers: [],
      stepFilters: [{
        id: 'declines',
        dimension: 1,
        particles: [filterParticle],
        evaluate: () => ({ status: 'indeterminate', reason: 'not-certified' })
      }],
      deltaTime: 1,
      initialPositions: [new VecN([1])]
    });
    expect(diagnoseXpbdIncrementalPotentialStepN(lineSearchRefused))
      .toMatchObject({
        condition: 'line-search-refused',
        facts: {
          blockingFilterId: 'declines',
          filterReason: 'not-certified'
        }
      });

    const directionParticle = new XpbdParticleN({
      id: 'direction',
      position: [0],
      inverseMass: 1
    });
    const directionRefused = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [directionParticle],
      providers: [],
      deltaTime: 1,
      initialPositions: [new VecN([1])],
      minimization: {
        directionPolicy: {
          id: 'declining-direction',
          evaluate: () => ({
            status: 'refused',
            reason: 'no-certified-direction'
          })
        }
      }
    });
    expect(diagnoseXpbdIncrementalPotentialStepN(directionRefused))
      .toMatchObject({
        condition: 'direction-refused',
        facts: { directionReason: 'no-certified-direction' }
      });

    const huge = new XpbdParticleN({
      id: 'stalled',
      position: [1e16],
      inverseMass: 1
    });
    const stalled = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [huge],
      providers: [{
        id: 'linear',
        dimension: 1,
        particles: [huge],
        evaluate: () => ({
          potentialEnergy: huge.position.data[0]!,
          forces: [new VecN([-1])]
        }),
        evaluateAt: (positionOf) => ({
          potentialEnergy: positionOf(huge).data[0]!,
          forces: [new VecN([-1])]
        })
      }],
      deltaTime: 1,
      minimization: { gradientTolerance: 0 }
    });
    expect(diagnoseXpbdIncrementalPotentialStepN(stalled)).toMatchObject({
      condition: 'stalled',
      facts: { stallReason: 'coordinate-resolution' }
    });
  });

  it('separates application refusal from minimization refusal', () => {
    const particle = new XpbdParticleN({
      id: 'mutated-during-verification',
      position: [0],
      velocity: [0.5],
      inverseMass: 1
    });
    const provider: XpbdConservativeForceProviderN = {
      id: 'mutating',
      dimension: 1,
      particles: [particle],
      evaluate: () => ({ potentialEnergy: 0, forces: [new VecN([0])] }),
      evaluateAt: () => {
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
    expect(diagnoseXpbdIncrementalPotentialStepN(result)).toMatchObject({
      condition: 'application-refused',
      levers: ['inspect-application-evidence'],
      facts: { applicationReason: 'stale-particle-state' }
    });
  });

  it('is deterministic and pure', () => {
    const particle = new XpbdParticleN({
      id: 'pure',
      position: [1],
      inverseMass: 1
    });
    const result = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [],
      deltaTime: 0.1,
      initialPositions: [new VecN([0])],
      minimization: { maximumIterations: 0 }
    });
    const before = JSON.stringify(result);
    expect(diagnoseXpbdIncrementalPotentialStepN(result))
      .toEqual(diagnoseXpbdIncrementalPotentialStepN(result));
    expect(JSON.stringify(result)).toBe(before);
  });
});
