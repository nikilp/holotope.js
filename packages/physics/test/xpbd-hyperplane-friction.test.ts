import { CellComplex, MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneConstraintN,
  XpbdParticleHyperplaneFrictionN,
  XpbdParticleN,
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdParticleHyperplaneFamilyN,
  compileXpbdParticleHyperplaneFrictionFamilyN,
  type XpbdParticleHyperplaneFrictionEvaluationN,
  type XpbdParticleHyperplaneFrictionFamilyEvaluationN
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

function directStep(options: {
  dimension: number;
  normalAxis: number;
  velocity: ArrayLike<number>;
  friction: number;
  inverseMass?: number;
}): {
  particle: XpbdParticleN;
  evaluation: XpbdParticleHyperplaneFrictionEvaluationN;
} {
  const particle = new XpbdParticleN({
    id: `particle-r${options.dimension}`,
    position: new Float64Array(options.dimension),
    velocity: options.velocity,
    inverseMass: options.inverseMass ?? 1
  });
  const contact = new XpbdParticleHyperplaneConstraintN({
    id: `contact-r${options.dimension}`,
    point: particle,
    plane: new HyperplaneColliderN(
      VecN.basis(options.dimension, options.normalAxis),
      0
    )
  });
  const friction = new XpbdParticleHyperplaneFrictionN({
    id: `friction-r${options.dimension}`,
    contact,
    friction: options.friction
  });
  const result = new XpbdWorldN({
    dimension: options.dimension,
    solverIterations: 1
  })
    .addParticle(particle)
    .addConstraint(contact)
    .addVelocityResponse(friction)
    .step(0.1);
  return {
    particle,
    evaluation: result.constraintSolves[0]!
      .velocityResponses[0]!
      .evaluation as XpbdParticleHyperplaneFrictionEvaluationN
  };
}

function sourcePoints4(): CellComplex {
  return new CellComplex(4, new Float64Array([
    0, 0, 0, 0,
    1, 0, 0, 0,
    -1, 0, 0, 0
  ]));
}

describe('dimension-independent XPBD particle-hyperplane friction', () => {
  it('matches the analytic sliding impulse in R2, R4, and R7', () => {
    for (const dimension of [2, 4, 7]) {
      const velocity = new Float64Array(dimension);
      velocity[0] = 3;
      velocity[dimension - 1] = -2;
      const { particle, evaluation } = directStep({
        dimension,
        normalAxis: dimension - 1,
        velocity,
        friction: 0.5,
        inverseMass: 0.5
      });
      expect(evaluation.state).toBe('sliding');
      expect(evaluation.normalImpulse).toBeCloseTo(4, 13);
      expect(evaluation.frictionLimit).toBeCloseTo(2, 13);
      expect(evaluation.tangentImpulse.length()).toBeCloseTo(2, 13);
      expect(evaluation.tangentSpeedBefore).toBeCloseTo(3, 13);
      expect(evaluation.tangentSpeedAfter).toBeCloseTo(2, 13);
      expect(evaluation.normalSpeedAfter).toBeCloseTo(0, 13);
      expect(particle.velocity.data[0]).toBeCloseTo(2, 13);
      expect(evaluation.kineticEnergyChange).toBeLessThan(0);
    }
  });

  it('sticks inside the Coulomb ball and specializes to a zero tangent in R1', () => {
    const sticking = directStep({
      dimension: 4,
      normalAxis: 1,
      velocity: [1, -2, 0, 0],
      friction: 1
    });
    expect(sticking.evaluation.state).toBe('sticking');
    expect(sticking.evaluation.normalImpulse).toBeCloseTo(2, 13);
    expect(sticking.evaluation.tangentImpulse.length()).toBeCloseTo(1, 13);
    expect(sticking.evaluation.tangentSpeedAfter).toBeLessThan(1e-13);
    expectArrayClose(sticking.particle.velocity.data, [0, 0, 0, 0], 13);

    const r1 = directStep({
      dimension: 1,
      normalAxis: 0,
      velocity: [-2],
      friction: 10
    });
    expect(r1.evaluation.state).toBe('sticking');
    expect(r1.evaluation.tangentSpeedBefore).toBe(0);
    expect(r1.evaluation.tangentImpulse.length()).toBe(0);
    expectArrayClose(r1.particle.velocity.data, [0], 13);
  });

  it('projects the full R4 tangent three-ball isotropically', () => {
    const tangents = [
      [5, 0, 0],
      [3, 4, 0],
      [0, 0, 5]
    ];
    const outcomes = tangents.map(([x, z, w]) => directStep({
      dimension: 4,
      normalAxis: 1,
      velocity: [x!, -2, z!, w!],
      friction: 0.75
    }).evaluation);
    for (const evaluation of outcomes) {
      expect(evaluation.state).toBe('sliding');
      expect(evaluation.normalImpulse).toBeCloseTo(2, 13);
      expect(evaluation.tangentImpulse.length()).toBeCloseTo(1.5, 13);
      expect(evaluation.tangentSpeedAfter).toBeCloseTo(3.5, 13);
      expect(evaluation.kineticEnergyAfter).toBeCloseTo(
        outcomes[0]!.kineticEnergyAfter,
        12
      );
    }
  });

  it('is equivariant under a common R4 rotation and preserves normal speed', () => {
    const rotation = MatN.rotationInPlane(4, 0, 3, 0.71)
      .multiply(MatN.rotationInPlane(4, 1, 2, -0.43));
    const normal = new VecN([0, 1, 0, 0]);
    const velocity = new VecN([3, -2, 4, 0]);
    const solve = (
      id: string,
      inputNormal: VecN,
      inputVelocity: VecN
    ): XpbdParticleHyperplaneFrictionEvaluationN => {
      const particle = new XpbdParticleN({
        id: `${id}-particle`, position: [0, 0, 0, 0], velocity: inputVelocity
      });
      const contact = new XpbdParticleHyperplaneConstraintN({
        id: `${id}-contact`,
        point: particle,
        plane: new HyperplaneColliderN(inputNormal, 0)
      });
      const response = new XpbdParticleHyperplaneFrictionN({
        id: `${id}-friction`, contact, friction: 0.6
      });
      return new XpbdWorldN({ dimension: 4, solverIterations: 1 })
        .addParticle(particle)
        .addConstraint(contact)
        .addVelocityResponse(response)
        .step(0.1)
        .constraintSolves[0]!
        .velocityResponses[0]!
        .evaluation as XpbdParticleHyperplaneFrictionEvaluationN;
    };
    const original = solve('original', normal, velocity);
    const transformed = solve(
      'transformed',
      rotation.applyTo(normal),
      rotation.applyTo(velocity)
    );
    expect(transformed.state).toBe(original.state);
    expect(transformed.normalImpulse).toBeCloseTo(original.normalImpulse, 13);
    expect(transformed.tangentSpeedAfter).toBeCloseTo(
      original.tangentSpeedAfter,
      13
    );
    expect(transformed.kineticEnergyChange).toBeCloseTo(
      original.kineticEnergyChange,
      12
    );
    expectArrayClose(
      transformed.tangentImpulse.data,
      rotation.applyTo(original.tangentImpulse).data,
      12
    );
    expect(transformed.normalSpeedAfter).toBeCloseTo(
      transformed.normalSpeedBefore,
      13
    );
  });

  it('compiles one source-indexed response family over the normal contacts', () => {
    const source = sourcePoints4();
    const sourceBefore = source.positions.slice();
    const binding = compileXpbdParticleBindingN({
      id: 'points', source, mass: 2
    });
    binding.particles[0]!.velocity.data.set([3, -2, 0, 0]);
    binding.particles[1]!.velocity.data.set([0, -2, 4, 0]);
    binding.particles[2]!.velocity.data.set([0, -2, 0, 5]);
    const normalFamily = compileXpbdParticleHyperplaneFamilyN({
      id: 'floor',
      source,
      particles: binding.particles,
      plane: new HyperplaneColliderN([0, 1, 0, 0])
    });
    const frictionFamily = compileXpbdParticleHyperplaneFrictionFamilyN({
      id: 'floor-friction',
      contacts: normalFamily,
      friction: (vertex) => {
        vertex.sourcePosition.data.fill(99);
        return vertex.sourceVertexIndex === 0 ? 10 : 0.5;
      }
    });
    expect(source.positions).toEqual(sourceBefore);
    expect(frictionFamily.particles).toBe(normalFamily.particles);
    expect(frictionFamily.contacts.map((contact) =>
      contact.normalContact
    )).toEqual(normalFamily.contacts);
    expect(frictionFamily.contacts.map((contact) =>
      contact.frictionCoefficient
    )).toEqual([10, 0.5, 0.5]);

    const world = binding.addToWorld(new XpbdWorldN({
      dimension: 4, solverIterations: 1
    }));
    normalFamily.addToWorld(world);
    frictionFamily.addToWorld(world);
    frictionFamily.addToWorld(world);
    const result = world.step(0.1);
    const evaluation = result.constraintSolves[0]!
      .velocityResponses[0]!
      .evaluation as XpbdParticleHyperplaneFrictionFamilyEvaluationN;
    expect(evaluation.contacts.map((contact) =>
      contact.sourceVertexIndex
    )).toEqual([0, 1, 2]);
    expect(evaluation.activeContactCount).toBe(3);
    expect(evaluation.stickingContactCount).toBe(1);
    expect(evaluation.slidingContactCount).toBe(2);
    expect(evaluation.kineticEnergyChange).toBeLessThan(0);
    expect(world.velocityResponses).toEqual([frictionFamily]);
    expect(binding.particles.every(
      (particle) => particle.velocity.data[3] === 0
    )).toBe(false);
  });

  it('preserves an embedded R3 hidden velocity exactly', () => {
    const { particle, evaluation } = directStep({
      dimension: 4,
      normalAxis: 1,
      velocity: [1, -2, 3, 0],
      friction: 0.5
    });
    expect(evaluation.state).toBe('sliding');
    expect(particle.position.data[3]).toBe(0);
    expect(particle.velocity.data[3]).toBe(0);
    expect(evaluation.tangentImpulse.data[3]).toBe(0);
  });

  it('preflights family ownership and malformed coefficients atomically', () => {
    const source = sourcePoints4();
    const binding = compileXpbdParticleBindingN({ id: 'owned', source });
    const normalFamily = compileXpbdParticleHyperplaneFamilyN({
      id: 'owned-floor',
      source,
      particles: binding.particles,
      plane: new HyperplaneColliderN([0, 1, 0, 0])
    });
    const frictionFamily = compileXpbdParticleHyperplaneFrictionFamilyN({
      id: 'owned-friction', contacts: normalFamily, friction: 0.5
    });
    const world = binding.addToWorld(new XpbdWorldN({ dimension: 4 }));
    expect(() => frictionFamily.addToWorld(world)).toThrow(/normal constraint/);
    expect(world.velocityResponses).toHaveLength(0);
    normalFamily.addToWorld(world);
    frictionFamily.addToWorld(world);
    expect(() => frictionFamily.addToWorld(new XpbdWorldN({ dimension: 3 })))
      .toThrow(/world is R3/);

    expect(() => new XpbdParticleHyperplaneFrictionN({
      id: '', contact: normalFamily.constraints[0]!, friction: 0.5
    })).toThrow(/non-empty/);
    expect(() => new XpbdParticleHyperplaneFrictionN({
      id: 'bad', contact: normalFamily.constraints[0]!, friction: -1
    })).toThrow(/non-negative/);
    expect(() => compileXpbdParticleHyperplaneFrictionFamilyN({
      id: '', contacts: normalFamily
    })).toThrow(/non-empty/);
    expect(() => compileXpbdParticleHyperplaneFrictionFamilyN({
      id: 'nan', contacts: normalFamily, friction: () => Number.NaN
    })).toThrow(/finite/);
  });
});
