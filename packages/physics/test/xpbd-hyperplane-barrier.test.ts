import { MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneBarrierN,
  XpbdParticleN,
  XpbdPotentialDomainErrorN,
  compileXpbdIncrementalPotentialProblemN,
  evaluateClampedLogBarrierAtOrderN,
  type BarrierComponentN,
  searchXpbdIncrementalPotentialArmijoN,
  stepXpbdIncrementalPotentialN
} from '../src/index.js';

function expectVector(
  actual: VecN,
  expected: ArrayLike<number>,
  digits = 12
): void {
  expect(actual.dim).toBe(expected.length);
  for (let axis = 0; axis < actual.dim; axis++) {
    expect(actual.data[axis]).toBeCloseTo(expected[axis]!, digits);
  }
}


/** Narrows a graded component the fixture knows is representable. */
function availableValue(
  component: BarrierComponentN
): number {
  if (!component.available) {
    throw new Error('test fixture: component unexpectedly outside Float64');
  }
  return component.value;
}

describe('RN particle-hyperplane conservative barrier', () => {
  it('specializes the same scalar energy and normal force from R1 through R7', () => {
    const graded = evaluateClampedLogBarrierAtOrderN({
      coordinate: 0.4,
      activation: 0.8,
      stiffness: 2.3
    }, 1);
    const expected = {
      energy: availableValue(graded.energy),
      firstDerivative: availableValue(graded.firstDerivative)
    };
    for (const dimension of [1, 2, 4, 7]) {
      const axis = dimension - 1;
      const position = new Float64Array(dimension);
      position[axis] = 0.6;
      const particle = new XpbdParticleN({
        id: `r${dimension}`,
        position
      });
      const provider = new XpbdParticleHyperplaneBarrierN({
        id: `barrier-r${dimension}`,
        particle,
        plane: new HyperplaneColliderN(
          VecN.basis(dimension, axis),
          0.1
        ),
        minimumDistance: 0.1,
        activationDistance: 0.9,
        stiffness: 2.3
      });
      const evaluated = provider.evaluate();

      expect(evaluated.signedDistance).toBeCloseTo(0.5, 14);
      expect(evaluated.barrierCoordinate).toBeCloseTo(0.4, 14);
      expect(evaluated.barrierActivation).toBeCloseTo(0.8, 14);
      expect(evaluated.potentialEnergy).toBeCloseTo(expected.energy, 14);
      expect(availableValue(evaluated.barrier.firstDerivative))
        .toBeCloseTo(expected.firstDerivative, 14);
      expect(evaluated.forces).toHaveLength(1);
      const force = new Float64Array(dimension);
      force[axis] = -expected.firstDerivative;
      expectVector(evaluated.forces[0], force, 13);
    }
  });

  it('is equivariant under common R4 rotation and translation', () => {
    const normal = new VecN([1, -2, 0.5, 1.5]).normalize();
    const offset = 0.2;
    const position = new VecN([0.8, -0.1, 0.4, 0.7]);
    const rotation = MatN.rotationInPlane(4, 0, 3, 0.63)
      .multiply(MatN.rotationInPlane(4, 1, 2, -0.47));
    const translation = new VecN([1, -0.5, 2, 0.3]);
    const transformedNormal = rotation.applyTo(normal);
    const transformedPosition = rotation.applyTo(position).add(translation);
    const transformedOffset = offset + transformedNormal.dot(translation);

    const evaluate = (
      candidate: VecN,
      plane: HyperplaneColliderN,
      id: string
    ) => {
      const particle = new XpbdParticleN({ id, position: candidate });
      return new XpbdParticleHyperplaneBarrierN({
        id: `${id}-barrier`,
        particle,
        plane,
        activationDistance: 1.2,
        stiffness: 0.8
      }).evaluate();
    };
    const base = evaluate(
      position,
      new HyperplaneColliderN(normal, offset),
      'base'
    );
    const moved = evaluate(
      transformedPosition,
      new HyperplaneColliderN(transformedNormal, transformedOffset),
      'moved'
    );

    expect(moved.signedDistance).toBeCloseTo(base.signedDistance, 13);
    expect(moved.potentialEnergy).toBeCloseTo(base.potentialEnergy, 13);
    expectVector(
      moved.forces[0],
      rotation.applyTo(base.forces[0]).data,
      12
    );
  });

  it('matches candidate-position energy differences without live mutation', () => {
    const particle = new XpbdParticleN({
      id: 'candidate',
      position: [0.6, 0.7, -0.2, 0.4]
    });
    const normal = new VecN([1, 2, -1, 0.5]).normalize();
    const provider = new XpbdParticleHyperplaneBarrierN({
      id: 'finite-difference',
      particle,
      plane: new HyperplaneColliderN(normal, -0.3),
      minimumDistance: 0.1,
      activationDistance: 1.5,
      stiffness: 1.7
    });
    const liveBefore = particle.position.toArray();
    const candidate = particle.position.clone();
    const evaluated = provider.evaluateAt(() => candidate);
    const step = 1e-6;
    for (let axis = 0; axis < 4; axis++) {
      const plus = candidate.clone();
      const minus = candidate.clone();
      plus.data[axis] += step;
      minus.data[axis] -= step;
      const numericGradient = (
        provider.evaluateAt(() => plus).potentialEnergy -
        provider.evaluateAt(() => minus).potentialEnergy
      ) / (2 * step);
      expect(numericGradient).toBeCloseTo(
        -evaluated.forces[0].data[axis]!,
        7
      );
    }
    expect(particle.position.toArray()).toEqual(liveBefore);
    expect(candidate.toArray()).toEqual(liveBefore);
  });

  it('exposes typed open-domain refusals and rejects malformed candidates', () => {
    const particle = new XpbdParticleN({ id: 'p', position: [0, 0.5] });
    const provider = new XpbdParticleHyperplaneBarrierN({
      id: 'floor',
      particle,
      plane: new HyperplaneColliderN([0, 1]),
      minimumDistance: 0.1,
      activationDistance: 0.8,
      stiffness: 1
    });
    expect(() => provider.evaluateAt(() => new VecN([0, 0.1])))
      .toThrow(XpbdPotentialDomainErrorN);
    try {
      provider.evaluateAt(() => new VecN([0, 0]));
    } catch (error) {
      expect(error).toMatchObject({
        lawId: 'floor',
        reason: 'at-or-below-minimum-distance'
      });
    }
    expect(() => provider.evaluateAt(() => new VecN([0, 0.5, 0])))
      .toThrow(/R2/);
    expect(() => provider.evaluateAt(() => new VecN([0, Number.NaN])))
      .toThrow(/finite/);
  });

  it('lets Armijo backtrack the common typed domain without swallowing bugs', () => {
    const particle = new XpbdParticleN({
      id: 'search',
      position: [0.5],
      inverseMass: 1
    });
    const provider = new XpbdParticleHyperplaneBarrierN({
      id: 'search-barrier',
      particle,
      plane: new HyperplaneColliderN([1]),
      minimumDistance: 0.1,
      activationDistance: 0.9,
      stiffness: 1e-3
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 0.1,
      providers: [provider]
    });
    const result = searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [0.5],
      direction: [-0.6]
    });

    expect(result.status).toBe('accepted');
    expect(result.trials[0]).toMatchObject({
      stepLength: 1,
      status: 'domain-refused',
      refusal: {
        lawId: 'search-barrier',
        reason: 'at-or-below-minimum-distance'
      }
    });
    expect(result.trials[1]!.status).toBe('accepted');
  });

  it('plugs into the transactional incremental-potential step', () => {
    const deltaTime = 0.1;
    const targetDistance = 0.5;
    const scalar = evaluateClampedLogBarrierAtOrderN({
      coordinate: targetDistance - 0.1,
      activation: 0.9 - 0.1,
      stiffness: 1
    }, 1);
    const predictedDistance = targetDistance +
      deltaTime ** 2 * availableValue(scalar.firstDerivative);
    const particle = new XpbdParticleN({
      id: 'step',
      position: [predictedDistance],
      inverseMass: 1
    });
    const provider = new XpbdParticleHyperplaneBarrierN({
      id: 'step-barrier',
      particle,
      plane: new HyperplaneColliderN([1]),
      minimumDistance: 0.1,
      activationDistance: 0.9,
      stiffness: 1
    });
    const result = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: [particle],
      providers: [provider],
      deltaTime,
      initialPositions: [new VecN([targetDistance])],
      minimization: { gradientTolerance: 1e-13 }
    });

    expect(result.status).toBe('applied');
    expect(result.minimization).toMatchObject({
      status: 'converged',
      convergencePoint: 'initial'
    });
    expect(particle.position.data[0]).toBeCloseTo(targetDistance, 13);
    expect(
      result.minimization.initial.evaluation.potential.providers[0]!.provider
    ).toBe(provider);
  });

  it('validates identities, dimensions, and distance policy', () => {
    const particle = new XpbdParticleN({ id: 'valid', position: [0, 1] });
    const plane = new HyperplaneColliderN([0, 1]);
    expect(() => new XpbdParticleHyperplaneBarrierN({
      id: '',
      particle,
      plane,
      activationDistance: 1,
      stiffness: 1
    })).toThrow(/id/);
    expect(() => new XpbdParticleHyperplaneBarrierN({
      id: 'dimension',
      particle,
      plane: new HyperplaneColliderN([0, 1, 0]),
      activationDistance: 1,
      stiffness: 1
    })).toThrow(/plane is R3/);
    expect(() => new XpbdParticleHyperplaneBarrierN({
      id: 'activation',
      particle,
      plane,
      minimumDistance: 0.5,
      activationDistance: 0.5,
      stiffness: 1
    })).toThrow(/activationDistance/);
  });
});
