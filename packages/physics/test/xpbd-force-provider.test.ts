import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdWorldN,
  type XpbdForceProviderN
} from '../src/index.js';

function provider(
  id: string,
  particles: readonly XpbdParticleN[],
  evaluate: XpbdForceProviderN['evaluate'],
  dimension = particles[0]?.dimension ?? 1
): XpbdForceProviderN {
  return { id, dimension, particles, evaluate };
}

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 12
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, digits);
  }
}

describe('XpbdWorldN force providers', () => {
  it('reevaluates state-dependent force at every substep', () => {
    const particle = new XpbdParticleN({ id: 'p', position: [1], inverseMass: 1 });
    const sampledPositions: number[] = [];
    const spring = provider('spring', [particle], () => {
      const position = particle.position.data[0]!;
      sampledPositions.push(position);
      return Object.freeze({
        forces: Object.freeze([new VecN([-2 * position])]),
        potentialEnergy: position * position
      });
    });
    const result = new XpbdWorldN({ dimension: 1 })
      .addParticle(particle)
      .addForceProvider(spring)
      .step(0.2, 2);

    expectArrayClose(sampledPositions, [1, 0.98], 14);
    expectArrayClose(particle.velocity.data, [-0.396], 14);
    expectArrayClose(particle.position.data, [0.9404], 14);
    expect(result.constraintSolves).toHaveLength(2);
    expect(result.constraintSolves[0]!.forceProviders[0]!.provider).toBe(spring);
    expect(result.constraintSolves[0]!.forceProviders[0]!.evaluation.potentialEnergy)
      .toBeCloseTo(1, 14);
    expect(result.constraintSolves[1]!.forceProviders[0]!.evaluation.potentialEnergy)
      .toBeCloseTo(0.9604, 14);
  });

  it('sums providers without accumulating them in external force buffers', () => {
    const dynamic = new XpbdParticleN({
      id: 'dynamic', position: [0, 0, 0, 0], inverseMass: 1
    }).applyForce([1, 0, 0, 0]);
    const fixed = new XpbdParticleN({
      id: 'fixed', position: [3, 2, 1, 0], velocity: [4, 3, 2, 1], inverseMass: 0
    });
    let positiveCalls = 0;
    const positive = provider('positive', [dynamic, fixed], () => {
      positiveCalls++;
      return {
        forces: [new VecN([2, 0, 0, 0]), new VecN([1e6, 1e6, 1e6, 1e6])]
      };
    });
    const negative = provider('negative', [dynamic], () => ({
      forces: [new VecN([-1, 0, 0, 0])]
    }));
    const world = new XpbdWorldN({ dimension: 4 })
      .addParticle(dynamic)
      .addParticle(fixed)
      .addForceProvider(positive)
      .addForceProvider(negative);
    const result = world.step(1, 2);

    expect(positiveCalls).toBe(2);
    expect(result.constraintSolves.map((substep) =>
      substep.forceProviders.map((entry) => entry.provider.id)
    )).toEqual([['positive', 'negative'], ['positive', 'negative']]);
    expectArrayClose(dynamic.velocity.data, [2, 0, 0, 0]);
    expectArrayClose(dynamic.position.data, [1.5, 0, 0, 0]);
    expectArrayClose(dynamic.force.data, [0, 0, 0, 0]);
    expectArrayClose(fixed.position.data, [3, 2, 1, 0]);
    expectArrayClose(fixed.velocity.data, [4, 3, 2, 1]);
  });

  it('rolls back a late provider failure after an earlier substep', () => {
    const particle = new XpbdParticleN({
      id: 'p', position: [1, 2], velocity: [0.3, -0.2]
    }).applyForce([4, 5]);
    let evaluations = 0;
    const failing = provider('failing', [particle], () => {
      evaluations++;
      if (evaluations === 2) throw new Error('late provider failure');
      return { forces: [new VecN([6, 7])] };
    });
    const world = new XpbdWorldN({ dimension: 2, gravity: [0, -3] })
      .addParticle(particle)
      .addForceProvider(failing);
    const before = {
      position: particle.position.toArray(),
      velocity: particle.velocity.toArray(),
      force: particle.force.toArray()
    };

    expect(() => world.step(0.2, 2)).toThrow(/late provider failure/);
    expect(particle.position.toArray()).toEqual(before.position);
    expect(particle.velocity.toArray()).toEqual(before.velocity);
    expect(particle.force.toArray()).toEqual(before.force);
  });

  it('enforces provider identity, ownership, dimensions, and finite evaluations', () => {
    const particle = new XpbdParticleN({ id: 'p', position: [0, 0] });
    const foreign = new XpbdParticleN({ id: 'foreign', position: [0, 0] });
    const world = new XpbdWorldN({ dimension: 2 }).addParticle(particle);
    expect(() => world.addForceProvider(provider(
      'foreign', [foreign], () => ({ forces: [new VecN([0, 0])] })
    ))).toThrow(/registered/);
    expect(() => world.addForceProvider(provider(
      'wrong-dimension', [particle], () => ({ forces: [new VecN([0, 0])] }), 3
    ))).toThrow(/world is R2/);
    expect(() => world.addForceProvider(provider(
      'repeated', [particle, particle], () => ({
        forces: [new VecN([0, 0]), new VecN([0, 0])]
      })
    ))).toThrow(/repeats/);

    const valid = provider('valid', [particle], () => ({ forces: [] }));
    world.addForceProvider(valid);
    expect(() => world.addForceProvider(provider(
      'valid', [particle], () => ({ forces: [new VecN([0, 0])] })
    ))).toThrow(/duplicate/);
    expect(() => world.removeParticle(particle)).toThrow(/still referenced/);
    expect(() => world.step(0.1)).toThrow(/force count mismatch/);
    world.removeForceProvider(valid);

    const nonFiniteForce = provider('nan-force', [particle], () => ({
      forces: [new VecN([Number.NaN, 0])]
    }));
    world.addForceProvider(nonFiniteForce);
    expect(() => world.step(0.1)).toThrow(/must be finite/);
    world.removeForceProvider(nonFiniteForce);

    const nonFiniteEnergy = provider('nan-energy', [particle], () => ({
      forces: [new VecN([0, 0])],
      potentialEnergy: Number.POSITIVE_INFINITY
    }));
    world.addForceProvider(nonFiniteEnergy);
    expect(() => world.step(0.1)).toThrow(/potentialEnergy/);
    world.removeForceProvider(nonFiniteEnergy).removeParticle(particle);
    expect(world.forceProviders).toEqual([]);
    expect(world.particles).toEqual([]);
  });
});
