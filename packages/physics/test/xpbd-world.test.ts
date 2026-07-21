import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdDistanceConstraintN,
  XpbdParticleN,
  XpbdWorldN,
  type XpbdScalarConstraintN
} from '../src/index.js';

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

function coordinates(dimension: number, entries: Readonly<Record<number, number>>): number[] {
  return Array.from({ length: dimension }, (_, axis) => entries[axis] ?? 0);
}

describe('XpbdWorldN', () => {
  it('matches semi-implicit free flight in R2, R4, and R7', () => {
    for (const dimension of [2, 4, 7]) {
      const particle = new XpbdParticleN({
        id: `p${dimension}`,
        position: coordinates(dimension, {}),
        velocity: coordinates(dimension, { 0: 1 }),
        inverseMass: 0.5
      }).applyForce(coordinates(dimension, { 0: 4 }));
      const world = new XpbdWorldN({
        dimension,
        gravity: coordinates(dimension, { 1: -2 })
      }).addParticle(particle);
      const result = world.step(0.2, 2);

      expect(result.constraintSolves).toHaveLength(2);
      expect(result.constraintSolves.map((entry) => entry.deltaTime)).toEqual([0.1, 0.1]);
      expectArrayClose(
        particle.velocity.data,
        coordinates(dimension, { 0: 1.4, 1: -0.4 }),
        14
      );
      expectArrayClose(
        particle.position.data,
        coordinates(dimension, { 0: 0.26, 1: -0.06 }),
        14
      );
      expectArrayClose(particle.force.data, coordinates(dimension, {}));
      expect(particle.kineticEnergy()).toBeCloseTo(
        0.5 * 2 * (1.4 * 1.4 + 0.4 * 0.4),
        14
      );
    }
  });

  it('keeps fixed particles outside prediction and velocity reconstruction', () => {
    const fixed = new XpbdParticleN({
      id: 'fixed',
      position: [1, 2, 3, 4],
      velocity: [5, 6, 7, 8],
      inverseMass: 0
    }).applyForce([10, 20, 30, 40]);
    new XpbdWorldN({ dimension: 4, gravity: [0, -9.81, 0, 0] })
      .addParticle(fixed)
      .step(1, 4);
    expectArrayClose(fixed.position.data, [1, 2, 3, 4]);
    expectArrayClose(fixed.velocity.data, [5, 6, 7, 8]);
    expectArrayClose(fixed.force.data, [0, 0, 0, 0]);
    expect(fixed.kineticEnergy()).toBe(0);
  });

  it('aggregates inequality slack separately from projected KKT error', () => {
    const particle = new XpbdParticleN({ id: 'slack', position: [2, 0, 0, 0] });
    const floor: XpbdScalarConstraintN = {
      id: 'floor',
      dimension: 4,
      points: [particle],
      relation: 'greater-than-or-equal',
      compliance: 0,
      evaluate: () => ({
        value: particle.position.data[0]!,
        gradients: [VecN.basis(4, 0)]
      })
    };
    const result = new XpbdWorldN({ dimension: 4 })
      .addParticle(particle)
      .addConstraint(floor)
      .step(0.1);
    expect(result.maxAbsConstraintValue).toBe(2);
    expect(result.maxAbsCompliantResidual).toBe(2);
    expect(result.maxAbsProjectedKktResidual).toBe(0);
  });

  it('holds a hard RN distance under gravity with the expected support force', () => {
    const fixed = new XpbdParticleN({
      id: 'fixed', position: [0, 0, 0, 0], inverseMass: 0
    });
    const particle = new XpbdParticleN({
      id: 'particle', position: [0, -1, 0, 0], inverseMass: 1
    });
    const constraint = new XpbdDistanceConstraintN({
      id: 'rod', pointA: particle, pointB: fixed, restLength: 1
    });
    const world = new XpbdWorldN({
      dimension: 4,
      gravity: [0, -9.81, 0, 0],
      solverIterations: 2
    }).addParticle(fixed).addParticle(particle).addConstraint(constraint);

    let supportForce = 0;
    for (let step = 0; step < 600; step++) {
      const result = world.step(1 / 120);
      supportForce = result.constraintSolves[0]!.solve.constraints[0]!.signedForce;
    }
    expectArrayClose(particle.position.data, [0, -1, 0, 0], 12);
    expectArrayClose(particle.velocity.data, [0, 0, 0, 0], 12);
    expect(supportForce).toBeCloseTo(-9.81, 10);
  });

  it('converges to timestep-stable compliant extension and weight', () => {
    const settle = (deltaTime: number): { extension: number; force: number } => {
      const fixed = new XpbdParticleN({
        id: 'fixed', position: [0, 0, 0, 0], inverseMass: 0
      });
      const particle = new XpbdParticleN({
        id: 'particle', position: [0, -1, 0, 0], inverseMass: 1
      });
      const constraint = new XpbdDistanceConstraintN({
        id: 'spring',
        pointA: particle,
        pointB: fixed,
        restLength: 1,
        compliance: 0.01
      });
      const world = new XpbdWorldN({
        dimension: 4,
        gravity: [0, -9.81, 0, 0],
        solverIterations: 1
      }).addParticle(fixed).addParticle(particle).addConstraint(constraint);
      let force = 0;
      for (let time = 0; time < 20; time += deltaTime) {
        force = world.step(deltaTime)
          .constraintSolves[0]!
          .solve.constraints[0]!
          .signedForce;
      }
      return {
        extension: particle.position.distanceTo(fixed.position) - 1,
        force
      };
    };

    const coarse = settle(1 / 60);
    const fine = settle(1 / 120);
    const expectedExtension = 9.81 * 0.01;
    expect(coarse.extension).toBeCloseTo(expectedExtension, 4);
    expect(fine.extension).toBeCloseTo(expectedExtension, 4);
    expect(coarse.extension).toBeCloseTo(fine.extension, 4);
    expect(coarse.force).toBeCloseTo(-9.81, 3);
    expect(fine.force).toBeCloseTo(-9.81, 3);
  });

  it('matches the independent compliant oscillator recurrence step for step', () => {
    const deltaTime = 0.01;
    const compliance = 1e-3;
    const fixed = new XpbdParticleN({ id: 'fixed', position: [0, 0], inverseMass: 0 });
    const particle = new XpbdParticleN({ id: 'particle', position: [1.5, 0] });
    const world = new XpbdWorldN({ dimension: 2, solverIterations: 1 })
      .addParticle(fixed)
      .addParticle(particle)
      .addConstraint(new XpbdDistanceConstraintN({
        id: 'oscillator',
        pointA: particle,
        pointB: fixed,
        restLength: 1,
        compliance
      }));

    let displacement = 0.5;
    let velocity = 0;
    const scaledCompliance = compliance / (deltaTime * deltaTime);
    for (let step = 0; step < 100; step++) {
      const predicted = displacement + deltaTime * velocity;
      const multiplier = -predicted / (1 + scaledCompliance);
      const next = predicted + multiplier;
      velocity = (next - displacement) / deltaTime;
      displacement = next;
      world.step(deltaTime);
      expect(particle.position.data[0]! - 1).toBeCloseTo(displacement, 12);
      expect(particle.velocity.data[0]).toBeCloseTo(velocity, 11);
      expect(particle.position.data[1]).toBe(0);
      expect(particle.velocity.data[1]).toBe(0);
    }
  });

  it('preserves center of mass and embedded coordinates for internal correction', () => {
    const a = new XpbdParticleN({
      id: 'a', position: [1.5, 0, 0, 0, 0, 0], inverseMass: 0.5
    });
    const b = new XpbdParticleN({
      id: 'b', position: [-0.5, 0, 0, 0, 0, 0], inverseMass: 2
    });
    const massA = 1 / a.inverseMass;
    const massB = 1 / b.inverseMass;
    const centerBefore = (
      massA * a.position.data[0]! + massB * b.position.data[0]!
    ) / (massA + massB);
    const world = new XpbdWorldN({ dimension: 6 })
      .addParticle(a)
      .addParticle(b)
      .addConstraint(new XpbdDistanceConstraintN({
        id: 'pair', pointA: a, pointB: b, restLength: 1
      }));
    world.step(1 / 60);

    const centerAfter = (
      massA * a.position.data[0]! + massB * b.position.data[0]!
    ) / (massA + massB);
    expect(centerAfter).toBeCloseTo(centerBefore, 14);
    expect(a.position.distanceTo(b.position)).toBeCloseTo(1, 14);
    expect(massA * a.velocity.data[0]! + massB * b.velocity.data[0]!).toBeCloseTo(0, 12);
    expect(a.position.toArray().slice(1)).toEqual([0, 0, 0, 0, 0]);
    expect(b.position.toArray().slice(1)).toEqual([0, 0, 0, 0, 0]);
  });

  it('restores the complete world state after a late evaluator failure', () => {
    const a = new XpbdParticleN({
      id: 'a', position: [1.5, 0], velocity: [0.2, -0.1]
    }).applyForce([3, 4]);
    const b = new XpbdParticleN({ id: 'b', position: [0, 0] });
    const distance = new XpbdDistanceConstraintN({
      id: 'first', pointA: a, pointB: b, restLength: 1
    });
    let evaluations = 0;
    const failing: XpbdScalarConstraintN = {
      id: 'failing',
      dimension: 2,
      points: [a],
      compliance: 0,
      evaluate: () => {
        evaluations++;
        if (evaluations > 1) throw new Error('late world failure');
        return { value: 0, gradients: [new VecN([1, 0])] };
      }
    };
    const world = new XpbdWorldN({ dimension: 2, gravity: [0, -2] })
      .addParticle(a)
      .addParticle(b)
      .addConstraint(distance)
      .addConstraint(failing);
    const before = [
      a.position.toArray(), a.velocity.toArray(), a.force.toArray(),
      b.position.toArray(), b.velocity.toArray(), b.force.toArray()
    ];
    expect(() => world.step(0.1)).toThrow(/late world failure/);
    expect([
      a.position.toArray(), a.velocity.toArray(), a.force.toArray(),
      b.position.toArray(), b.velocity.toArray(), b.force.toArray()
    ]).toEqual(before);
  });

  it('enforces dimension, identity, ownership, and valid-step boundaries', () => {
    const world = new XpbdWorldN({ dimension: 4 });
    const a = new XpbdParticleN({ id: 'a', position: [0, 0, 0, 0] });
    const sameId = new XpbdParticleN({ id: 'a', position: [1, 0, 0, 0] });
    const b = new XpbdParticleN({ id: 'b', position: [1, 0, 0, 0] });
    const external = new XpbdParticleN({ id: 'external', position: [2, 0, 0, 0] });
    const wrongDimension = new XpbdParticleN({ id: 'r3', position: [0, 0, 0] });
    world.addParticle(a).addParticle(b);
    expect(() => world.addParticle(sameId)).toThrow(/duplicate particle id/);
    expect(() => world.addParticle(wrongDimension)).toThrow(/world is R4/);
    expect(() => world.addConstraint(new XpbdDistanceConstraintN({
      id: 'external-link', pointA: a, pointB: external, restLength: 1
    }))).toThrow(/registered particle/);

    const constraint = new XpbdDistanceConstraintN({
      id: 'link', pointA: a, pointB: b, restLength: 1
    });
    world.addConstraint(constraint);
    expect(() => world.removeParticle(a)).toThrow(/still referenced/);
    expect(() => world.addConstraint(new XpbdDistanceConstraintN({
      id: 'link', pointA: a, pointB: b, restLength: 1
    }))).toThrow(/duplicate constraint id/);
    expect(() => world.step(0)).toThrow(/positive/);
    expect(() => world.step(0.1, 0)).toThrow(/substeps/);

    a.force.data[0] = Number.NaN;
    expect(() => world.step(0.1)).toThrow(/force must be finite/);
    expect(Number.isNaN(a.force.data[0])).toBe(true);
    a.force.data[0] = 0;
    world.removeConstraint(constraint).removeParticle(a);
    expect(world.particles).toEqual([b]);
    expect(world.constraints).toEqual([]);
  });
});
