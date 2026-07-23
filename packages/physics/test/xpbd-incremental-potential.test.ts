import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdWorldN,
  evaluateXpbdIncrementalPotentialN,
  predictXpbdInertialStateN,
  type XpbdConservativeForceProviderN
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
    const positions = particles.map(positionOf);
    let potentialEnergy = 0;
    const forces = positions.map((position) => {
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
    gravityScale: particle.gravityScale,
    inverseMass: particle.inverseMass
  }));
}

function expectVectorClose(
  actual: VecN,
  expected: VecN,
  digits = 12
): void {
  expect(actual.dim).toBe(expected.dim);
  for (let axis = 0; axis < actual.dim; axis++) {
    expect(actual.data[axis]).toBeCloseTo(expected.data[axis]!, digits);
  }
}

describe('XPBD incremental potential', () => {
  it('predicts the same unconstrained state as XpbdWorldN in R1, R2, and R4', () => {
    for (const dimension of [1, 2, 4]) {
      const dynamic = new XpbdParticleN({
        id: `dynamic-${dimension}`,
        position: Array.from({ length: dimension }, (_, axis) => axis - 0.25),
        velocity: Array.from(
          { length: dimension },
          (_, axis) => 0.2 * (axis + 1)
        ),
        inverseMass: 0.4,
        gravityScale: 1.25
      }).applyForce(Array.from(
        { length: dimension },
        (_, axis) => -0.3 * (axis + 1)
      ));
      const fixed = new XpbdParticleN({
        id: `fixed-${dimension}`,
        position: Array.from({ length: dimension }, (_, axis) => 2 + axis),
        velocity: Array.from({ length: dimension }, () => 7),
        inverseMass: 0
      }).applyForce(Array.from({ length: dimension }, () => 9));
      const particles = [dynamic, fixed];
      const gravity = Array.from(
        { length: dimension },
        (_, axis) => axis === 0 ? -9.8 : 0.15 * axis
      );
      const world = new XpbdWorldN({ dimension, gravity })
        .addParticle(dynamic)
        .addParticle(fixed);
      const before = particleSnapshot(particles);
      const prediction = predictXpbdInertialStateN({
        dimension,
        particles,
        deltaTime: 0.03,
        gravity
      });

      expect(particleSnapshot(particles)).toEqual(before);
      world.step(0.03);
      expectVectorClose(dynamic.position, prediction.positions[0]!, 15);
      expectVectorClose(fixed.position, prediction.positions[1]!, 15);
      expect(prediction.accelerations[1]!.lengthSq()).toBe(0);
    }
  });

  it('matches a quadratic closed form and its stationary point', () => {
    const particle = new XpbdParticleN({
      id: 'quadratic',
      position: [0, 0],
      inverseMass: 0.5
    });
    const provider = quadraticProvider('spring-to-origin', [particle], 3);
    const predicted = new VecN([1.2, -0.8]);
    const candidate = new VecN([0.7, -0.2]);
    const deltaTime = 0.25;
    const mass = 2;
    const expectedInertial =
      0.5 * mass * candidate.clone().sub(predicted).lengthSq();
    const expectedPotential = 0.5 * 3 * candidate.lengthSq();
    const expectedGradient = candidate.clone()
      .sub(predicted)
      .multiplyScalar(mass)
      .add(candidate.clone().multiplyScalar(deltaTime ** 2 * 3));
    const evaluated = evaluateXpbdIncrementalPotentialN({
      dimension: 2,
      particles: [particle],
      positions: [candidate],
      predictedPositions: [predicted],
      deltaTime,
      providers: [provider]
    });

    expect(evaluated.inertialObjective).toBeCloseTo(expectedInertial, 14);
    expect(evaluated.conservativePotentialEnergy)
      .toBeCloseTo(expectedPotential, 14);
    expect(evaluated.scaledConservativeObjective)
      .toBeCloseTo(deltaTime ** 2 * expectedPotential, 14);
    expect(evaluated.objective).toBeCloseTo(
      expectedInertial + deltaTime ** 2 * expectedPotential,
      14
    );
    expectVectorClose(evaluated.gradients[0]!, expectedGradient, 14);

    const stationary = predicted.clone().multiplyScalar(
      mass / (mass + deltaTime ** 2 * 3)
    );
    const atStationary = evaluateXpbdIncrementalPotentialN({
      dimension: 2,
      particles: [particle],
      positions: [stationary],
      predictedPositions: [predicted],
      deltaTime,
      providers: [provider]
    });
    expect(atStationary.gradientNorm).toBeLessThan(1e-14);
  });

  it('matches centered differences with overlapping providers in R4', () => {
    const particles = [
      new XpbdParticleN({ id: 'a', position: [0, 0, 0, 0], inverseMass: 0.5 }),
      new XpbdParticleN({ id: 'b', position: [0, 0, 0, 0], inverseMass: 0.8 }),
      new XpbdParticleN({ id: 'c', position: [0, 0, 0, 0], inverseMass: 1.2 })
    ];
    const providers = [
      quadraticProvider('left', particles.slice(0, 2), 1.7),
      quadraticProvider('right', particles.slice(1), 0.9)
    ];
    const positions = particles.map((_, index) =>
      new VecN(Array.from(
        { length: 4 },
        (_, axis) => 0.08 * (index + 1) * (axis - 1.5)
      ))
    );
    const predictedPositions = particles.map((_, index) =>
      new VecN(Array.from(
        { length: 4 },
        (_, axis) => -0.03 * (index + axis + 1)
      ))
    );
    const options = {
      dimension: 4,
      particles,
      positions,
      predictedPositions,
      deltaTime: 0.07,
      providers
    } as const;
    const before = particleSnapshot(particles);
    const evaluated = evaluateXpbdIncrementalPotentialN(options);
    const step = 1e-6;

    for (let particle = 0; particle < particles.length; particle++) {
      for (let axis = 0; axis < 4; axis++) {
        const plus = positions.map((position) => position.clone());
        const minus = positions.map((position) => position.clone());
        plus[particle]!.data[axis]! += step;
        minus[particle]!.data[axis]! -= step;
        const plusObjective = evaluateXpbdIncrementalPotentialN({
          ...options,
          positions: plus
        }).objective;
        const minusObjective = evaluateXpbdIncrementalPotentialN({
          ...options,
          positions: minus
        }).objective;
        expect(evaluated.gradients[particle]!.data[axis]).toBeCloseTo(
          (plusObjective - minusObjective) / (2 * step),
          7
        );
      }
    }
    expect(particleSnapshot(particles)).toEqual(before);
  });

  it('treats fixed particles as prescribed coordinates and retains reactions', () => {
    const dynamic = new XpbdParticleN({
      id: 'dynamic',
      position: [0],
      inverseMass: 1
    });
    const fixed = new XpbdParticleN({
      id: 'fixed',
      position: [2],
      inverseMass: 0
    });
    const provider = quadraticProvider('pair', [dynamic, fixed], 2);
    const evaluated = evaluateXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [dynamic, fixed],
      positions: [new VecN([0.5]), new VecN([2])],
      predictedPositions: [new VecN([0]), new VecN([2])],
      deltaTime: 0.1,
      providers: [provider]
    });

    expect(evaluated.freeParticleMask).toEqual([true, false]);
    expect(evaluated.freeParticleCount).toBe(1);
    expect(evaluated.gradients[1]!.data[0]).toBe(0);
    expect(evaluated.inertialGradients[1]!.data[0]).toBe(0);
    expect(evaluated.potential.gradients[1]!.data[0]).toBe(4);
    expect(() => evaluateXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [dynamic, fixed],
      positions: [new VecN([0.5]), new VecN([2.01])],
      predictedPositions: [new VecN([0]), new VecN([2])],
      deltaTime: 0.1,
      providers: [provider]
    })).toThrow(/fixed particle 1 candidate must equal its prediction/);
  });

  it('assembles by identity under particle-order permutation', () => {
    const particles = [
      new XpbdParticleN({ id: 'p0', position: [0, 0], inverseMass: 0.5 }),
      new XpbdParticleN({ id: 'p1', position: [0, 0], inverseMass: 0.75 }),
      new XpbdParticleN({ id: 'p2', position: [0, 0], inverseMass: 1.25 })
    ];
    const provider = quadraticProvider('all', particles, 1.1);
    const positions = [
      new VecN([0.2, -0.1]),
      new VecN([0.4, 0.3]),
      new VecN([-0.2, 0.5])
    ];
    const predictedPositions = [
      new VecN([0, 0]),
      new VecN([0.1, 0.2]),
      new VecN([-0.3, 0.4])
    ];
    const canonical = evaluateXpbdIncrementalPotentialN({
      dimension: 2,
      particles,
      positions,
      predictedPositions,
      deltaTime: 0.12,
      providers: [provider]
    });
    const order = [2, 0, 1];
    const permuted = evaluateXpbdIncrementalPotentialN({
      dimension: 2,
      particles: order.map((index) => particles[index]!),
      positions: order.map((index) => positions[index]!),
      predictedPositions: order.map((index) => predictedPositions[index]!),
      deltaTime: 0.12,
      providers: [provider]
    });

    expect(permuted.objective).toBeCloseTo(canonical.objective, 14);
    expect(permuted.inertialObjective)
      .toBeCloseTo(canonical.inertialObjective, 14);
    for (let output = 0; output < order.length; output++) {
      expectVectorClose(
        permuted.gradients[output]!,
        canonical.gradients[order[output]!]!,
        14
      );
    }
  });

  it('keeps one objective contract from R1 through R4', () => {
    for (const dimension of [1, 2, 3, 4]) {
      const particle = new XpbdParticleN({
        id: `p-${dimension}`,
        position: new VecN(dimension),
        inverseMass: 0.25
      });
      const provider = quadraticProvider(`q-${dimension}`, [particle], 0.8);
      const candidate = new VecN(
        Array.from({ length: dimension }, (_, axis) => 0.1 * (axis + 1))
      );
      const evaluated = evaluateXpbdIncrementalPotentialN({
        dimension,
        particles: [particle],
        positions: [candidate],
        predictedPositions: [new VecN(dimension)],
        deltaTime: 0.2,
        providers: [provider]
      });
      expect(evaluated.objective).toBeGreaterThan(0);
      expect(evaluated.gradients[0]!.dim).toBe(dimension);
    }
  });

  it('refuses malformed time, prediction, and mass evidence', () => {
    const particle = new XpbdParticleN({
      id: 'p',
      position: [0, 0],
      inverseMass: 1
    });
    const provider = quadraticProvider('q', [particle], 1);
    const options = {
      dimension: 2,
      particles: [particle],
      positions: [new VecN([0, 0])],
      predictedPositions: [new VecN([0, 0])],
      deltaTime: 0.1,
      providers: [provider]
    } as const;
    expect(() => evaluateXpbdIncrementalPotentialN({
      ...options,
      deltaTime: 0
    })).toThrow(/deltaTime must be finite and positive/);
    expect(() => evaluateXpbdIncrementalPotentialN({
      ...options,
      predictedPositions: [new VecN(3)]
    })).toThrow(/predicted position 0 must be R2/);
    expect(() => evaluateXpbdIncrementalPotentialN({
      ...options,
      predictedPositions: [new VecN([0, Number.NaN])]
    })).toThrow(/predicted position 0 must be finite/);

    const enormousMass = new XpbdParticleN({
      id: 'enormous',
      position: [0],
      inverseMass: Number.MIN_VALUE
    });
    expect(() => evaluateXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [enormousMass],
      positions: [new VecN([0])],
      predictedPositions: [new VecN([0])],
      deltaTime: 0.1,
      providers: []
    })).toThrow(/mass is outside Float64/);

    expect(() => predictXpbdInertialStateN({
      dimension: 2,
      particles: [particle],
      deltaTime: Number.POSITIVE_INFINITY
    })).toThrow(/deltaTime must be finite and positive/);
    expect(() => predictXpbdInertialStateN({
      dimension: 2,
      particles: [particle],
      deltaTime: 0.1,
      gravity: [0, Number.NaN]
    })).toThrow(/gravity must be finite/);
  });
});
