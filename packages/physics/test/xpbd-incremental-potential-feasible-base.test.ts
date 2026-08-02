import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdPotentialDomainErrorN,
  compileXpbdIncrementalPotentialProblemN,
  recoverXpbdIncrementalPotentialFeasibleBaseN,
  type XpbdConservativeForceProviderN
} from '../src/index.js';

function halfLineProblem(
  dimension: number,
  threshold = 0
) {
  const particle = new XpbdParticleN({
    id: `half-line-r${dimension}`,
    position: new VecN(dimension),
    inverseMass: 1
  });
  let evaluations = 0;
  const provider: XpbdConservativeForceProviderN = {
    id: 'positive-first-coordinate',
    dimension,
    particles: [particle],
    evaluate: () => ({
      potentialEnergy: 0,
      forces: [new VecN(dimension)]
    }),
    evaluateAt: (positionOf) => {
      evaluations++;
      const position = positionOf(particle);
      if (!(position.data[0]! > threshold)) {
        throw new XpbdPotentialDomainErrorN(
          provider.id,
          'outside-open-half-line',
          'first coordinate must exceed the threshold'
        );
      }
      return {
        potentialEnergy: 0,
        forces: [new VecN(dimension)]
      };
    }
  };
  const problem = compileXpbdIncrementalPotentialProblemN({
    dimension,
    particles: [particle],
    predictedPositions: [new VecN(dimension)],
    deltaTime: 1,
    providers: [provider]
  });
  return { particle, problem, evaluations: () => evaluations };
}

describe('bounded incremental-potential feasible-base recovery', () => {
  it('accepts a feasible target without evaluating the anchor', () => {
    const fixture = halfLineProblem(1);
    const result = recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem: fixture.problem,
      anchorCoordinates: [-1],
      targetCoordinates: [2]
    });

    expect(result.status).toBe('target-feasible');
    expect(result.fraction).toBe(1);
    expect(result.trials).toHaveLength(1);
    expect(result.trials[0]).toMatchObject({
      index: 0,
      fraction: 1,
      status: 'feasible'
    });
    expect(fixture.evaluations()).toBe(1);
  });

  it('returns the first tested feasible interior fraction with complete evidence', () => {
    const fixture = halfLineProblem(1);
    const result = recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem: fixture.problem,
      anchorCoordinates: [1],
      targetCoordinates: [-1]
    });

    expect(result.status).toBe('recovered');
    if (result.status !== 'recovered') return;
    expect(result.fraction).toBe(0.25);
    expect(result.evaluation.coordinates[0]).toBe(0.5);
    expect(result.trials.map((trial) => ({
      index: trial.index,
      fraction: trial.fraction,
      status: trial.status
    }))).toEqual([
      { index: 0, fraction: 1, status: 'domain-refused' },
      { index: 1, fraction: 0, status: 'feasible' },
      { index: 2, fraction: 0.5, status: 'domain-refused' },
      { index: 3, fraction: 0.25, status: 'feasible' }
    ]);
    expect(fixture.evaluations()).toBe(4);
  });

  it('returns the validated anchor when no positive sampled fraction succeeds', () => {
    const fixture = halfLineProblem(1, 0.99);
    const result = recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem: fixture.problem,
      anchorCoordinates: [1],
      targetCoordinates: [-1],
      maximumTrials: 3
    });

    expect(result.status).toBe('anchor-only');
    if (result.status !== 'anchor-only') return;
    expect(result.fraction).toBe(0);
    expect(result.evaluation.coordinates[0]).toBe(1);
    expect(result.trials).toHaveLength(5);
  });

  it('retains distinct target and anchor refusals without searching from either', () => {
    const fixture = halfLineProblem(1);
    const result = recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem: fixture.problem,
      anchorCoordinates: [0],
      targetCoordinates: [-1]
    });

    expect(result).toMatchObject({
      status: 'anchor-refused',
      targetRefusal: {
        lawId: 'positive-first-coordinate',
        reason: 'outside-open-half-line'
      },
      anchorRefusal: {
        lawId: 'positive-first-coordinate',
        reason: 'outside-open-half-line'
      }
    });
    expect(result.trials).toHaveLength(2);
    expect(fixture.evaluations()).toBe(2);
  });

  it('rethrows an ordinary provider failure from an interior sample', () => {
    const fixture = halfLineProblem(1);
    const original = fixture.problem.providers[0]!.evaluateAt;
    (fixture.problem.providers[0] as XpbdConservativeForceProviderN).evaluateAt =
      (positionOf) => {
        const coordinate = positionOf(fixture.particle).data[0]!;
        if (coordinate === 0) throw new Error('interior provider bug');
        return original(positionOf);
      };
    expect(() => recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem: fixture.problem,
      anchorCoordinates: [1],
      targetCoordinates: [-1]
    })).toThrow(/interior provider bug/);
  });

  it('selects the same active-coordinate fraction in R1, R2, R4, and R7', () => {
    const fractions: number[] = [];
    for (const dimension of [1, 2, 4, 7]) {
      const fixture = halfLineProblem(dimension);
      const anchor = new Float64Array(dimension);
      const target = new Float64Array(dimension);
      anchor[0] = 1;
      target[0] = -1;
      const result = recoverXpbdIncrementalPotentialFeasibleBaseN({
        problem: fixture.problem,
        anchorCoordinates: anchor,
        targetCoordinates: target
      });
      expect(result.status).toBe('recovered');
      if (result.status !== 'recovered') continue;
      fractions.push(result.fraction);
      expect(result.evaluation.coordinates[0]).toBe(0.5);
      expect(Array.from(result.evaluation.coordinates.subarray(1))).toEqual(
        new Array(dimension - 1).fill(0)
      );
    }
    expect(fractions).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('does not turn sampled endpoint feasibility into a segment claim', () => {
    const particle = new XpbdParticleN({
      id: 'disconnected-domain',
      position: [0],
      inverseMass: 1
    });
    const provider: XpbdConservativeForceProviderN = {
      id: 'disconnected-open-set',
      dimension: 1,
      particles: [particle],
      evaluate: () => ({ potentialEnergy: 0, forces: [new VecN([0])] }),
      evaluateAt: (positionOf) => {
        const x = positionOf(particle).data[0]!;
        if (!(x < 0.05 || (x > 0.3 && x < 0.4))) {
          throw new XpbdPotentialDomainErrorN(
            'disconnected-open-set',
            'outside-components',
            'coordinate belongs to neither open component'
          );
        }
        return { potentialEnergy: 0, forces: [new VecN([0])] };
      }
    };
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([1])],
      deltaTime: 1,
      providers: [provider]
    });
    const result = recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem,
      anchorCoordinates: [0],
      targetCoordinates: [1],
      maximumTrials: 3
    });

    expect(result.status).toBe('anchor-only');
    // The unsampled alpha=0.35 is feasible. The bounded result honestly says
    // only what its geometric samples established.
    expect(() => problem.evaluate([0.35])).not.toThrow();
    expect('segmentSafe' in result).toBe(false);
  });

  it('defensively copies caller inputs and does not mutate live particles', () => {
    const fixture = halfLineProblem(2);
    const anchor = new Float64Array([1, 0.3]);
    const target = new Float64Array([-1, -0.2]);
    const liveBefore = fixture.particle.position.toArray();
    const result = recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem: fixture.problem,
      anchorCoordinates: anchor,
      targetCoordinates: target
    });
    anchor.fill(9);
    target.fill(8);
    expect(Array.from(result.trials[0]!.coordinates)).toEqual([-1, -0.2]);
    expect(Array.from(result.trials[1]!.coordinates)).toEqual([1, 0.3]);
    expect(fixture.particle.position.toArray()).toEqual(liveBefore);
  });

  it('rejects malformed coordinates and search policies before evaluation', () => {
    const fixture = halfLineProblem(1);
    expect(() => recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem: fixture.problem,
      anchorCoordinates: [1, 2],
      targetCoordinates: [-1]
    })).toThrow(/anchorCoordinates must have length 1/);
    expect(() => recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem: fixture.problem,
      anchorCoordinates: [1],
      targetCoordinates: [Number.NaN]
    })).toThrow(/targetCoordinates must be finite/);
    expect(() => recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem: fixture.problem,
      anchorCoordinates: [1],
      targetCoordinates: [-1],
      contractionFactor: 1
    })).toThrow(/contractionFactor/);
    expect(() => recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem: fixture.problem,
      anchorCoordinates: [1],
      targetCoordinates: [-1],
      maximumTrials: 0
    })).toThrow(/maximumTrials/);
    expect(() => recoverXpbdIncrementalPotentialFeasibleBaseN({
      problem: fixture.problem,
      anchorCoordinates: [1],
      targetCoordinates: [-1],
      nearest: true
    } as never)).toThrow(/unknown option "nearest"/);
    expect(fixture.evaluations()).toBe(0);
  });
});
