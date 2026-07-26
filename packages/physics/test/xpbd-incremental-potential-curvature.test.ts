import { MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneBarrierN,
  XpbdParticleN,
  XpbdPotentialDomainErrorN,
  compileXpbdIncrementalPotentialProblemN,
  estimateXpbdIncrementalPotentialHessianVectorN,
  evaluateClampedLogBarrier,
  type XpbdConservativeForceProviderN,
  type XpbdIncrementalPotentialProblemN
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

function rankOneProvider(
  id: string,
  particle: XpbdParticleN,
  axis: VecN,
  stiffness: number
): XpbdConservativeForceProviderN {
  const unitAxis = axis.clone().normalize();
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (
    positionOf
  ) => {
    const coordinate = unitAxis.dot(positionOf(particle));
    return {
      potentialEnergy: 0.5 * stiffness * coordinate * coordinate,
      forces: [unitAxis.clone().multiplyScalar(-stiffness * coordinate)]
    };
  };
  return {
    id,
    dimension: particle.dimension,
    particles: [particle],
    evaluate: () => evaluateAt(() => particle.position.clone()),
    evaluateAt
  };
}

function compileSingle(
  particle: XpbdParticleN,
  predictedPosition: VecN,
  deltaTime: number,
  providers: readonly XpbdConservativeForceProviderN[] = []
): XpbdIncrementalPotentialProblemN {
  return compileXpbdIncrementalPotentialProblemN({
    dimension: particle.dimension,
    particles: [particle],
    predictedPositions: [predictedPosition],
    deltaTime,
    providers
  });
}

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 10
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]).toBeCloseTo(expected[index]!, digits);
  }
}

describe('XPBD incremental-potential matrix-free curvature', () => {
  it('matches the exact inertial mass matrix in R1, R4, and R7', () => {
    for (const dimension of [1, 4, 7]) {
      const inverseMass = 0.4;
      const mass = 1 / inverseMass;
      const particle = new XpbdParticleN({
        id: `mass-r${dimension}`,
        position: new Float64Array(dimension),
        inverseMass
      });
      const coordinates = Float64Array.from(
        { length: dimension },
        (_, axis) => 0.2 * (axis + 1)
      );
      const direction = Float64Array.from(
        { length: dimension },
        (_, axis) => (axis % 2 === 0 ? 0.3 : -0.4) * (axis + 1)
      );
      const result = estimateXpbdIncrementalPotentialHessianVectorN({
        problem: compileSingle(
          particle,
          new VecN(new Float64Array(dimension)),
          0.2
        ),
        coordinates,
        direction
      });

      expect(result.status).toBe('evaluated');
      if (result.status !== 'evaluated') continue;
      expectArrayClose(
        result.product,
        direction.map((value) => mass * value),
        9
      );
      expect(result.quadraticForm).toBeCloseTo(
        mass * direction.reduce((sum, value) => sum + value * value, 0),
        9
      );
    }
  });

  it('matches an analytic quadratic conservative Hessian', () => {
    const dimension = 4;
    const inverseMass = 0.8;
    const mass = 1 / inverseMass;
    const stiffness = 3.7;
    const deltaTime = 0.12;
    const particle = new XpbdParticleN({
      id: 'quadratic',
      position: [0, 0, 0, 0],
      inverseMass
    });
    const provider = quadraticProvider('quadratic-law', [particle], stiffness);
    const direction = new Float64Array([0.2, -0.4, 0.7, 0.1]);
    const scale = mass + deltaTime ** 2 * stiffness;
    const result = estimateXpbdIncrementalPotentialHessianVectorN({
      problem: compileSingle(
        particle,
        new VecN([0.1, 0.2, -0.3, 0.4]),
        deltaTime,
        [provider]
      ),
      coordinates: [0.5, -0.2, 0.9, 0.3],
      direction,
      stepSize: 1e-4
    });

    expect(result.status).toBe('evaluated');
    if (result.status !== 'evaluated') return;
    expectArrayClose(
      result.product,
      direction.map((value) => scale * value),
      10
    );
  });

  it('matches the analytic R4 particle-hyperplane barrier chain rule', () => {
    const normal = new VecN([1, -2, 0.5, 1.5]).normalize();
    const inverseMass = 0.5;
    const mass = 1 / inverseMass;
    const deltaTime = 0.08;
    const minimumDistance = 0.1;
    const activationDistance = 1.4;
    const stiffness = 2.1;
    const particle = new XpbdParticleN({
      id: 'barrier-particle',
      position: normal.clone().multiplyScalar(0.7),
      inverseMass
    });
    const provider = new XpbdParticleHyperplaneBarrierN({
      id: 'barrier-law',
      particle,
      plane: new HyperplaneColliderN(normal),
      minimumDistance,
      activationDistance,
      stiffness
    });
    const coordinates = normal.clone().multiplyScalar(0.7);
    const direction = new VecN([0.4, 0.1, -0.3, 0.8]);
    const scalar = evaluateClampedLogBarrier({
      coordinate: 0.7 - minimumDistance,
      activation: activationDistance - minimumDistance,
      stiffness
    });
    const expected = direction.clone().multiplyScalar(mass).add(
      normal.clone().multiplyScalar(
        deltaTime ** 2 * scalar.secondDerivative * normal.dot(direction)
      )
    );
    const result = estimateXpbdIncrementalPotentialHessianVectorN({
      problem: compileSingle(
        particle,
        coordinates.clone(),
        deltaTime,
        [provider]
      ),
      coordinates: coordinates.data,
      direction: direction.data,
      stepSize: 1e-5
    });

    expect(result.status).toBe('evaluated');
    if (result.status !== 'evaluated') return;
    expectArrayClose(result.product, expected.data, 7);
  });

  it('agrees with an independent second directional objective difference', () => {
    const particle = new XpbdParticleN({
      id: 'second-difference',
      position: [0, 0, 0],
      inverseMass: 0.7
    });
    const provider = quadraticProvider('second-difference-law', [particle], 2.3);
    const problem = compileSingle(
      particle,
      new VecN([0.2, -0.1, 0.4]),
      0.15,
      [provider]
    );
    const coordinates = new Float64Array([0.8, 0.3, -0.5]);
    const direction = new Float64Array([0.2, -0.7, 0.4]);
    const stepSize = 1e-3;
    const result = estimateXpbdIncrementalPotentialHessianVectorN({
      problem,
      coordinates,
      direction,
      stepSize
    });

    expect(result.status).toBe('evaluated');
    if (result.status !== 'evaluated') return;
    const plus = coordinates.map(
      (value, index) => value + stepSize * direction[index]!
    );
    const minus = coordinates.map(
      (value, index) => value - stepSize * direction[index]!
    );
    const secondDifference = (
      problem.evaluate(plus).objective -
      2 * problem.evaluate(coordinates).objective +
      problem.evaluate(minus).objective
    ) / (stepSize * stepSize);
    expect(result.quadraticForm).toBeCloseTo(secondDifference, 8);
  });

  it('preserves direction scaling and common orthogonal covariance', () => {
    const rotation = MatN.rotationInPlane(4, 0, 3, 0.43)
      .multiply(MatN.rotationInPlane(4, 1, 2, -0.67));
    const axis = new VecN([0.3, -0.8, 0.2, 0.5]).normalize();
    const coordinates = new VecN([0.7, -0.2, 0.6, 0.1]);
    const direction = new VecN([0.2, 0.9, -0.4, 0.3]);
    const evaluate = (
      id: string,
      localAxis: VecN,
      localCoordinates: VecN,
      localDirection: VecN
    ) => {
      const particle = new XpbdParticleN({
        id,
        position: localCoordinates,
        inverseMass: 0.6
      });
      return estimateXpbdIncrementalPotentialHessianVectorN({
        problem: compileSingle(
          particle,
          localCoordinates.clone(),
          0.1,
          [rankOneProvider(`${id}-law`, particle, localAxis, 5)]
        ),
        coordinates: localCoordinates.data,
        direction: localDirection.data
      });
    };
    const base = evaluate('base', axis, coordinates, direction);
    const scaled = evaluate(
      'scaled',
      axis,
      coordinates,
      direction.clone().multiplyScalar(3)
    );
    const rotated = evaluate(
      'rotated',
      rotation.applyTo(axis),
      rotation.applyTo(coordinates),
      rotation.applyTo(direction)
    );

    expect(base.status).toBe('evaluated');
    expect(scaled.status).toBe('evaluated');
    expect(rotated.status).toBe('evaluated');
    if (base.status !== 'evaluated' ||
      scaled.status !== 'evaluated' ||
      rotated.status !== 'evaluated') return;
    expectArrayClose(
      scaled.product,
      base.product.map((value) => 3 * value),
      8
    );
    expectArrayClose(
      rotated.product,
      rotation.applyTo(new VecN(base.product)).data,
      8
    );
    expect(rotated.quadraticForm).toBeCloseTo(base.quadraticForm, 8);
  });

  it('returns exact zero evidence without evaluating offset probes', () => {
    const particle = new XpbdParticleN({
      id: 'zero',
      position: [0, 0],
      inverseMass: 1
    });
    let evaluations = 0;
    const provider = quadraticProvider('counted', [particle], 1);
    const counted: XpbdConservativeForceProviderN = {
      ...provider,
      evaluateAt: (positionOf) => {
        evaluations++;
        return provider.evaluateAt(positionOf);
      }
    };
    const result = estimateXpbdIncrementalPotentialHessianVectorN({
      problem: compileSingle(particle, new VecN([0, 0]), 0.1, [counted]),
      coordinates: [0.2, -0.1],
      direction: [0, 0]
    });

    expect(result.status).toBe('zero-direction');
    expect(result.product).toEqual(new Float64Array(2));
    expect(result.quadraticForm).toBe(0);
    expect(evaluations).toBe(1);
  });

  it('returns signed typed probe refusals but rejects an invalid base', () => {
    const particle = new XpbdParticleN({
      id: 'domain',
      position: [0.3],
      inverseMass: 1
    });
    const provider = new XpbdParticleHyperplaneBarrierN({
      id: 'domain-law',
      particle,
      plane: new HyperplaneColliderN([1]),
      minimumDistance: 0.1,
      activationDistance: 0.9,
      stiffness: 1
    });
    const problem = compileSingle(
      particle,
      new VecN([0.3]),
      0.1,
      [provider]
    );
    const result = estimateXpbdIncrementalPotentialHessianVectorN({
      problem,
      coordinates: [0.3],
      direction: [1],
      stepSize: 0.2
    });

    expect(result).toMatchObject({
      status: 'probe-refused',
      side: 'minus',
      refusal: {
        lawId: 'domain-law',
        reason: 'at-or-below-minimum-distance'
      }
    });
    if (result.status === 'probe-refused') {
      expect(result.plus?.coordinates[0]).toBeCloseTo(0.5, 14);
    }
    expect(() => estimateXpbdIncrementalPotentialHessianVectorN({
      problem,
      coordinates: [0.1],
      direction: [1],
      stepSize: 0.01
    })).toThrow(XpbdPotentialDomainErrorN);
  });

  it('does not swallow ordinary provider failures', () => {
    const particle = new XpbdParticleN({
      id: 'bug',
      position: [0],
      inverseMass: 1
    });
    const provider: XpbdConservativeForceProviderN = {
      id: 'buggy',
      dimension: 1,
      particles: [particle],
      evaluate: () => ({ potentialEnergy: 0, forces: [new VecN([0])] }),
      evaluateAt: (positionOf) => {
        if (positionOf(particle).data[0] !== 0) {
          throw new Error('provider implementation bug');
        }
        return { potentialEnergy: 0, forces: [new VecN([0])] };
      }
    };
    expect(() => estimateXpbdIncrementalPotentialHessianVectorN({
      problem: compileSingle(particle, new VecN([0]), 0.1, [provider]),
      coordinates: [0],
      direction: [1],
      stepSize: 0.1
    })).toThrow(/provider implementation bug/);
  });

  it('reports an unrepresentable Float64 coordinate displacement', () => {
    const coordinate = 1e16;
    const particle = new XpbdParticleN({
      id: 'resolution',
      position: [coordinate],
      inverseMass: 1
    });
    const result = estimateXpbdIncrementalPotentialHessianVectorN({
      problem: compileSingle(particle, new VecN([coordinate]), 0.1),
      coordinates: [coordinate],
      direction: [1],
      stepSize: 0.1
    });
    expect(result).toMatchObject({
      status: 'indeterminate',
      reason: 'coordinate-resolution',
      coordinateIndex: 0
    });
  });

  it('validates inputs and preserves caller and live state', () => {
    const particle = new XpbdParticleN({
      id: 'immutable',
      position: [0.3, -0.2],
      velocity: [0.1, 0.4],
      inverseMass: 0.5
    });
    const problem = compileSingle(
      particle,
      new VecN([0.2, -0.1]),
      0.1,
      [quadraticProvider('immutable-law', [particle], 1.2)]
    );
    const coordinates = new Float64Array([0.4, 0.6]);
    const direction = new Float64Array([-0.3, 0.2]);
    const coordinatesBefore = coordinates.slice();
    const directionBefore = direction.slice();
    const liveBefore = {
      position: particle.position.toArray(),
      velocity: particle.velocity.toArray()
    };
    const result = estimateXpbdIncrementalPotentialHessianVectorN({
      problem,
      coordinates,
      direction
    });

    expect(result.status).toBe('evaluated');
    expect(coordinates).toEqual(coordinatesBefore);
    expect(direction).toEqual(directionBefore);
    expect(particle.position.toArray()).toEqual(liveBefore.position);
    expect(particle.velocity.toArray()).toEqual(liveBefore.velocity);
    expect(() => estimateXpbdIncrementalPotentialHessianVectorN({
      problem,
      coordinates: [0],
      direction
    })).toThrow(/coordinates must have length 2/);
    expect(() => estimateXpbdIncrementalPotentialHessianVectorN({
      problem,
      coordinates,
      direction: [0, Number.NaN]
    })).toThrow(/direction\[1\] must be finite/);
    expect(() => estimateXpbdIncrementalPotentialHessianVectorN({
      problem,
      coordinates,
      direction,
      stepSize: 0
    })).toThrow(/stepSize must be finite and positive/);
  });
});
