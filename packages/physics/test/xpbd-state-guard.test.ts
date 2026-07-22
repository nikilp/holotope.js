import { describe, expect, it } from 'vitest';
import {
  XpbdAdaptiveStepFailureErrorN,
  XpbdParticleN,
  XpbdStateGuardRejectionErrorN,
  XpbdWorldN,
  type XpbdStateGuardN
} from '../src/index.js';

function thresholdGuard(
  particle: XpbdParticleN,
  threshold: number,
  id = 'positive-x'
): XpbdStateGuardN {
  return {
    id,
    dimension: particle.dimension,
    particles: [particle],
    evaluate: () => {
      const margin = particle.position.data[0]! - threshold;
      return {
        accepted: margin >= 0,
        margin,
        ...(margin >= 0 ? {} : { reason: 'x below threshold' })
      };
    }
  };
}

describe('XpbdWorldN accepted-state guards', () => {
  it('runs ordered read-only guards after every completed substep', () => {
    const particle = new XpbdParticleN({
      id: 'traveller',
      position: [0, 0],
      velocity: [1, 0]
    });
    const observed: string[] = [];
    const first: XpbdStateGuardN = {
      id: 'first',
      dimension: 2,
      particles: [particle],
      evaluate: (context) => {
        observed.push(`first:${context.substepIndex}:${particle.position.data[0]}`);
        return { accepted: true, margin: particle.position.data[0]! };
      }
    };
    const second: XpbdStateGuardN = {
      id: 'second',
      dimension: 2,
      particles: [particle],
      evaluate: (context) => {
        observed.push(`second:${context.substepIndex}:${particle.position.data[0]}`);
        return { accepted: true };
      }
    };
    const world = new XpbdWorldN({ dimension: 2 })
      .addParticle(particle)
      .addStateGuard(first)
      .addStateGuard(second);
    const result = world.step(0.2, 2);

    expect(observed).toEqual([
      'first:0:0.1', 'second:0:0.1',
      'first:1:0.2', 'second:1:0.2'
    ]);
    expect(result.constraintSolves.map((substep) =>
      substep.stateGuards.map((entry) => entry.guard.id)
    )).toEqual([['first', 'second'], ['first', 'second']]);
    expect(result.constraintSolves[0]!.stateGuards[0]!.evaluation.margin)
      .toBeCloseTo(0.1, 15);
    expect(Object.isFrozen(result.constraintSolves[0]!.stateGuards)).toBe(true);
    expect(Object.isFrozen(
      result.constraintSolves[0]!.stateGuards[0]!.evaluation
    )).toBe(true);
  });

  it('exposes exact defensive pre-substep positions and refuses foreign queries', () => {
    const particle = new XpbdParticleN({
      id: 'history', position: [1, 2], velocity: [3, -1]
    });
    const foreign = new XpbdParticleN({ id: 'history/foreign', position: [0, 0] });
    const observations: number[][] = [];
    const first: XpbdStateGuardN = {
      id: 'history/first',
      dimension: 2,
      particles: [particle],
      evaluate: (context) => {
        const previous = context.positionBeforeSubstep(particle);
        observations.push(previous.toArray());
        previous.data[0] = 999;
        expect(() => context.positionBeforeSubstep(foreign)).toThrow(/not registered/);
        return { accepted: true };
      }
    };
    const second: XpbdStateGuardN = {
      id: 'history/second',
      dimension: 2,
      particles: [particle],
      evaluate: (context) => {
        observations.push(context.positionBeforeSubstep(particle).toArray());
        return { accepted: true };
      }
    };
    const world = new XpbdWorldN({ dimension: 2 })
      .addParticle(particle)
      .addStateGuard(first)
      .addStateGuard(second);
    world.step(0.5);
    expect(observations).toEqual([[1, 2], [1, 2]]);
    expect(particle.position.toArray()).toEqual([2.5, 1.5]);
  });

  it('checks guard identity, dimension, ownership, and particle lifetime', () => {
    const a = new XpbdParticleN({ id: 'a', position: [0, 0] });
    const b = new XpbdParticleN({ id: 'b', position: [1, 0] });
    const foreign = new XpbdParticleN({ id: 'foreign', position: [0, 0] });
    const world = new XpbdWorldN({ dimension: 2 }).addParticle(a).addParticle(b);
    const guard = thresholdGuard(a, -1, 'guard');
    world.addStateGuard(guard).addStateGuard(guard);
    expect(world.stateGuards).toEqual([guard]);
    expect(() => world.addStateGuard({ ...guard })).toThrow(/duplicate/);
    expect(() => world.addStateGuard({ ...guard, id: 'wrong', dimension: 3 }))
      .toThrow(/world is R2/);
    expect(() => world.addStateGuard({ ...guard, id: 'foreign', particles: [foreign] }))
      .toThrow(/registered/);
    expect(() => world.addStateGuard({ ...guard, id: 'repeated', particles: [b, b] }))
      .toThrow(/repeats/);
    expect(() => world.removeParticle(a)).toThrow(/state guard/);
    world.removeStateGuard(guard).removeParticle(a);
    expect(world.stateGuards).toEqual([]);
  });

  it('refuses guard mutation and malformed evidence transactionally', () => {
    const run = (
      id: string,
      mutate: (a: XpbdParticleN, b: XpbdParticleN) => void
    ): void => {
      const a = new XpbdParticleN({
        id: `${id}/a`, position: [0, 0], velocity: [1, 0]
      }).applyForce([2, 0]);
      const b = new XpbdParticleN({
        id: `${id}/b`, position: [1, 0], velocity: [0, 1]
      });
      const guard: XpbdStateGuardN = {
        id,
        dimension: 2,
        particles: [a],
        evaluate: () => {
          mutate(a, b);
          return { accepted: true };
        }
      };
      const world = new XpbdWorldN({ dimension: 2 })
        .addParticle(a)
        .addParticle(b)
        .addStateGuard(guard);
      const before = [
        a.position.toArray(), a.velocity.toArray(), a.force.toArray(),
        a.gravityScale, b.position.toArray(), b.velocity.toArray()
      ];
      expect(() => world.step(0.1)).toThrow(/mutated/);
      expect([
        a.position.toArray(), a.velocity.toArray(), a.force.toArray(),
        a.gravityScale, b.position.toArray(), b.velocity.toArray()
      ]).toEqual(before);
    };

    run('position', (a) => { a.position.data[0]! += 1; });
    run('velocity', (a) => { a.velocity.data[0]! += 1; });
    run('force', (a) => { a.force.data[0]! += 1; });
    run('gravity-scale', (a) => { a.gravityScale += 1; });
    run('foreign-particle', (_a, b) => { b.position.data[0]! += 1; });

    const malformedCases = [
      null,
      { accepted: 'yes' },
      { accepted: true, margin: Number.NaN },
      { accepted: true, reason: '' }
    ];
    for (let index = 0; index < malformedCases.length; index++) {
      const particle = new XpbdParticleN({ id: `malformed/${index}`, position: [0] });
      const malformed = {
        id: `malformed-guard/${index}`,
        dimension: 1,
        particles: [particle],
        evaluate: () => malformedCases[index]
      } as unknown as XpbdStateGuardN;
      const world = new XpbdWorldN({ dimension: 1 })
        .addParticle(particle)
        .addStateGuard(malformed);
      expect(() => world.step(0.1)).toThrow();
      expect(particle.position.data[0]).toBe(0);
    }
  });

  it('rolls a final-substep rejection back to the complete initial state', () => {
    const particle = new XpbdParticleN({
      id: 'rollback', position: [1], velocity: [0], gravityScale: 0.5
    }).applyForce([-1.2]);
    const world = new XpbdWorldN({ dimension: 1 })
      .addParticle(particle)
      .addStateGuard(thresholdGuard(particle, 0.2));

    expect(() => world.step(1, 2)).toThrow(XpbdStateGuardRejectionErrorN);
    expect(particle.position.data[0]).toBe(1);
    expect(particle.velocity.data[0]).toBe(0);
    expect(particle.force.data[0]).toBe(-1.2);
    expect(particle.gravityScale).toBe(0.5);
  });
});

describe('XpbdWorldN bounded adaptive stepping', () => {
  it('retries a typed rejection and matches the accepted direct subdivision', () => {
    const adaptiveParticle = new XpbdParticleN({
      id: 'adaptive', position: [1], velocity: [0]
    }).applyForce([-1.2]);
    const adaptiveWorld = new XpbdWorldN({ dimension: 1 })
      .addParticle(adaptiveParticle)
      .addStateGuard(thresholdGuard(adaptiveParticle, 0.05));
    const adaptive = adaptiveWorld.stepAdaptive(1, { maximumSubsteps: 8 });

    const directParticle = new XpbdParticleN({
      id: 'direct', position: [1], velocity: [0]
    }).applyForce([-1.2]);
    const directWorld = new XpbdWorldN({ dimension: 1 })
      .addParticle(directParticle)
      .addStateGuard(thresholdGuard(directParticle, 0.05, 'direct-guard'));
    const direct = directWorld.step(1, 2);

    expect(adaptive.attempts.map((attempt) =>
      [attempt.substeps, attempt.status]
    )).toEqual([[1, 'rejected'], [2, 'accepted']]);
    expect(adaptive.attempts[0]!.rejectedSubstepIndex).toBe(0);
    expect(adaptive.result.substeps).toBe(2);
    expect(adaptiveParticle.position.data[0])
      .toBeCloseTo(directParticle.position.data[0]!, 15);
    expect(adaptiveParticle.velocity.data[0])
      .toBeCloseTo(directParticle.velocity.data[0]!, 15);
    expect(adaptive.result.constraintSolves.map((entry) => entry.stateGuards.length))
      .toEqual([1, 1]);
    expect(direct.constraintSolves).toHaveLength(2);
    expect(adaptiveParticle.force.data[0]).toBe(0);
  });

  it('throws typed exhaustion and preserves retryable world state', () => {
    const particle = new XpbdParticleN({
      id: 'exhausted', position: [1], velocity: [0]
    }).applyForce([-1.2]);
    const world = new XpbdWorldN({ dimension: 1 })
      .addParticle(particle)
      .addStateGuard(thresholdGuard(particle, 0.2));
    let failure: unknown;
    try {
      world.stepAdaptive(1, { maximumSubsteps: 2 });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(XpbdAdaptiveStepFailureErrorN);
    const typed = failure as XpbdAdaptiveStepFailureErrorN;
    expect(typed.attempts.map((attempt) => attempt.substeps)).toEqual([1, 2]);
    expect(typed.lastRejection.guard.id).toBe('positive-x');
    expect(particle.position.data[0]).toBe(1);
    expect(particle.velocity.data[0]).toBe(0);
    expect(particle.force.data[0]).toBe(-1.2);
  });

  it('never retries unrelated failures and validates its finite bounds', () => {
    const particle = new XpbdParticleN({ id: 'program-error', position: [0] });
    let calls = 0;
    const guard: XpbdStateGuardN = {
      id: 'throws',
      dimension: 1,
      particles: [particle],
      evaluate: () => {
        calls++;
        throw new Error('program error');
      }
    };
    const world = new XpbdWorldN({ dimension: 1 })
      .addParticle(particle)
      .addStateGuard(guard);
    expect(() => world.stepAdaptive(0.1)).toThrow(/program error/);
    expect(calls).toBe(1);
    expect(() => world.stepAdaptive(0)).toThrow(/positive/);
    expect(() => world.stepAdaptive(0.1, { initialSubsteps: 0 })).toThrow(/positive/);
    expect(() => world.stepAdaptive(0.1, {
      initialSubsteps: 4,
      maximumSubsteps: 2
    })).toThrow(/at least/);
    expect(() => world.stepAdaptive(0.1, { growthFactor: 1 })).toThrow(/at least two/);
  });
});
