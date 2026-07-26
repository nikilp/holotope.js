import { MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneBarrierN,
  XpbdParticleN,
  XpbdPotentialDomainErrorN,
  compileXpbdIncrementalPotentialProblemN,
  estimateXpbdIncrementalPotentialHessianVectorN,
  evaluateXpbdIncrementalPotentialAnalyticHessianVectorN,
  type XpbdConservativeForceProviderN,
  type XpbdConservativeHessianVectorProviderN,
  type XpbdIncrementalPotentialProblemN
} from '../src/index.js';

function analyticQuadraticProvider(
  id: string,
  particles: readonly XpbdParticleN[],
  stiffness: number,
  onCurvature?: () => void
): XpbdConservativeHessianVectorProviderN {
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
    evaluateAt,
    evaluatePotentialHessianVectorAt: (_positionOf, directionOf) => {
      onCurvature?.();
      return {
        products: particles.map(
          (particle) => directionOf(particle).multiplyScalar(stiffness)
        )
      };
    }
  };
}

function analyticPairProvider(
  dynamic: XpbdParticleN,
  fixed: XpbdParticleN,
  stiffness: number
): XpbdConservativeHessianVectorProviderN {
  const particles = [dynamic, fixed] as const;
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (
    positionOf
  ) => {
    const displacement = positionOf(dynamic).sub(positionOf(fixed));
    return {
      potentialEnergy: 0.5 * stiffness * displacement.lengthSq(),
      forces: [
        displacement.clone().multiplyScalar(-stiffness),
        displacement.multiplyScalar(stiffness)
      ]
    };
  };
  return {
    id: 'pair',
    dimension: dynamic.dimension,
    particles,
    evaluate: () => evaluateAt((particle) => particle.position.clone()),
    evaluateAt,
    evaluatePotentialHessianVectorAt: (_positionOf, directionOf) => {
      const difference = directionOf(dynamic).sub(directionOf(fixed));
      return {
        products: [
          difference.clone().multiplyScalar(stiffness),
          difference.multiplyScalar(-stiffness)
        ]
      };
    }
  };
}

function ordinaryQuadraticProvider(
  id: string,
  particle: XpbdParticleN,
  stiffness: number
): XpbdConservativeForceProviderN {
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (
    positionOf
  ) => {
    const position = positionOf(particle);
    return {
      potentialEnergy: 0.5 * stiffness * position.lengthSq(),
      forces: [position.multiplyScalar(-stiffness)]
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

function compile(
  particles: readonly XpbdParticleN[],
  predictedPositions: readonly VecN[],
  deltaTime: number,
  providers: readonly XpbdConservativeForceProviderN[]
): XpbdIncrementalPotentialProblemN {
  return compileXpbdIncrementalPotentialProblemN({
    dimension: particles[0]!.dimension,
    particles,
    predictedPositions,
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

describe('XPBD incremental-potential analytic curvature', () => {
  it('matches the exact inertial mass block in R1, R4, and R7', () => {
    for (const dimension of [1, 4, 7]) {
      const inverseMass = 0.4;
      const mass = 1 / inverseMass;
      const particle = new XpbdParticleN({
        id: `inertial-r${dimension}`,
        position: new Float64Array(dimension),
        inverseMass
      });
      const direction = Float64Array.from(
        { length: dimension },
        (_, axis) => (axis + 1) * (axis % 2 === 0 ? 0.2 : -0.3)
      );
      const result =
        evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
          problem: compile(
            [particle],
            [new VecN(new Float64Array(dimension))],
            0.1,
            []
          ),
          coordinates: new Float64Array(dimension),
          direction
        });

      expect(result.status).toBe('evaluated');
      if (result.status !== 'evaluated') continue;
      expectArrayClose(
        result.inertialProduct,
        direction.map((value) => mass * value),
        14
      );
      expectArrayClose(result.scaledPotentialProduct, new Float64Array(dimension));
      expectArrayClose(result.product, result.inertialProduct, 14);
    }
  });

  it('assembles overlapping analytic quadratic providers by identity', () => {
    const particles = [
      new XpbdParticleN({ id: 'a', position: [0, 0], inverseMass: 0.5 }),
      new XpbdParticleN({ id: 'b', position: [0, 0], inverseMass: 0.8 })
    ];
    const deltaTime = 0.2;
    const providers = [
      analyticQuadraticProvider('both', particles, 2),
      analyticQuadraticProvider('b-only', [particles[1]!], 3)
    ];
    const direction = new Float64Array([0.2, -0.4, 0.7, 0.1]);
    const result =
      evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
        problem: compile(
          particles,
          [new VecN([0, 0]), new VecN([0, 0])],
          deltaTime,
          providers
        ),
        coordinates: [0.3, 0.2, -0.1, 0.5],
        direction
      });

    expect(result.status).toBe('evaluated');
    if (result.status !== 'evaluated') return;
    const expected = new Float64Array([
      (2 + deltaTime ** 2 * 2) * direction[0]!,
      (2 + deltaTime ** 2 * 2) * direction[1]!,
      (1.25 + deltaTime ** 2 * 5) * direction[2]!,
      (1.25 + deltaTime ** 2 * 5) * direction[3]!
    ]);
    expectArrayClose(result.product, expected, 13);
    expect(result.providers.map((entry) => entry.provider.id))
      .toEqual(['both', 'b-only']);
  });

  it('retains fixed-particle reaction curvature outside packed coordinates', () => {
    const dynamic = new XpbdParticleN({
      id: 'dynamic',
      position: [0, 0],
      inverseMass: 1
    });
    const fixed = new XpbdParticleN({
      id: 'fixed',
      position: [1, -1],
      inverseMass: 0
    });
    const direction = new Float64Array([0.3, -0.7]);
    const result =
      evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
        problem: compile(
          [dynamic, fixed],
          [new VecN([0, 0]), new VecN([1, -1])],
          0.1,
          [analyticPairProvider(dynamic, fixed, 4)]
        ),
        coordinates: [0.2, 0.4],
        direction
      });

    expect(result.status).toBe('evaluated');
    if (result.status !== 'evaluated') return;
    expectArrayClose(
      result.potentialProducts[0]!.data,
      direction.map((value) => 4 * value),
      14
    );
    expectArrayClose(
      result.potentialProducts[1]!.data,
      direction.map((value) => -4 * value),
      14
    );
    expect(result.product).toHaveLength(2);
  });

  it('refuses every unsupported provider before requesting a partial product', () => {
    const particle = new XpbdParticleN({
      id: 'mixed',
      position: [0, 0],
      inverseMass: 1
    });
    let curvatureCalls = 0;
    const supported = analyticQuadraticProvider(
      'supported',
      [particle],
      1,
      () => curvatureCalls++
    );
    const result =
      evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
        problem: compile(
          [particle],
          [new VecN([0, 0])],
          0.1,
          [
            supported,
            ordinaryQuadraticProvider('missing-a', particle, 2),
            ordinaryQuadraticProvider('missing-b', particle, 3)
          ]
        ),
        coordinates: [0.2, -0.1],
        direction: [1, 0]
      });

    expect(result).toMatchObject({
      status: 'unsupported-provider',
      providerIds: ['missing-a', 'missing-b']
    });
    expect(curvatureCalls).toBe(0);
  });

  it('returns exact zero without requiring provider curvature capability', () => {
    const particle = new XpbdParticleN({
      id: 'zero',
      position: [0],
      inverseMass: 1
    });
    const result =
      evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
        problem: compile(
          [particle],
          [new VecN([0])],
          0.1,
          [ordinaryQuadraticProvider('ordinary', particle, 2)]
        ),
        coordinates: [0.3],
        direction: [0]
      });
    expect(result.status).toBe('zero-direction');
    expect(result.product).toEqual(new Float64Array([0]));
    expect(result.quadraticForm).toBe(0);
  });

  it('matches the point-plane analytic formula and P34 in R1/R2/R4/R7', () => {
    for (const dimension of [1, 2, 4, 7]) {
      const normal = new VecN(Float64Array.from(
        { length: dimension },
        (_, axis) => axis + 1
      )).normalize();
      const position = normal.clone().multiplyScalar(0.7);
      const direction = new VecN(Float64Array.from(
        { length: dimension },
        (_, axis) => (axis + 1) * (axis % 2 === 0 ? 0.15 : -0.11)
      ));
      const particle = new XpbdParticleN({
        id: `barrier-r${dimension}`,
        position,
        inverseMass: 0.6
      });
      const provider = new XpbdParticleHyperplaneBarrierN({
        id: `barrier-law-r${dimension}`,
        particle,
        plane: new HyperplaneColliderN(normal),
        minimumDistance: 0.1,
        activationDistance: 1.3,
        stiffness: 2.2
      });
      const problem = compile(
        [particle],
        [position.clone()],
        0.08,
        [provider]
      );
      const analytic =
        evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
          problem,
          coordinates: position.data,
          direction: direction.data
        });
      const oracle = estimateXpbdIncrementalPotentialHessianVectorN({
        problem,
        coordinates: position.data,
        direction: direction.data,
        stepSize: 1e-5
      });
      const local = provider.evaluatePotentialHessianVectorAt(
        () => position.clone(),
        () => direction.clone()
      );
      const expectedLocal = normal.clone().multiplyScalar(
        local.base.barrier.secondDerivative * normal.dot(direction)
      );

      expect(analytic.status).toBe('evaluated');
      expect(oracle.status).toBe('evaluated');
      if (analytic.status !== 'evaluated' ||
        oracle.status !== 'evaluated') continue;
      expectArrayClose(local.products[0].data, expectedLocal.data, 13);
      expectArrayClose(analytic.product, oracle.product, 7);
      expect(analytic.quadraticForm)
        .toBeCloseTo(oracle.quadraticForm, 7);
    }
  });

  it('is linear in direction and covariant under a common R4 rotation', () => {
    const normal = new VecN([1, -2, 0.5, 1.3]).normalize();
    const position = normal.clone().multiplyScalar(0.65);
    const direction = new VecN([0.2, -0.3, 0.7, 0.1]);
    const rotation = MatN.rotationInPlane(4, 0, 3, 0.57)
      .multiply(MatN.rotationInPlane(4, 1, 2, -0.38));
    const evaluate = (
      id: string,
      candidate: VecN,
      localNormal: VecN,
      localDirection: VecN
    ) => {
      const particle = new XpbdParticleN({
        id,
        position: candidate,
        inverseMass: 0.5
      });
      const provider = new XpbdParticleHyperplaneBarrierN({
        id: `${id}-law`,
        particle,
        plane: new HyperplaneColliderN(localNormal),
        minimumDistance: 0.1,
        activationDistance: 1.2,
        stiffness: 1.7
      });
      return evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
        problem: compile(
          [particle],
          [candidate.clone()],
          0.1,
          [provider]
        ),
        coordinates: candidate.data,
        direction: localDirection.data
      });
    };
    const base = evaluate('base', position, normal, direction);
    const scaled = evaluate(
      'scaled',
      position,
      normal,
      direction.clone().multiplyScalar(-2.5)
    );
    const rotated = evaluate(
      'rotated',
      rotation.applyTo(position),
      rotation.applyTo(normal),
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
      base.product.map((value) => -2.5 * value),
      12
    );
    expectArrayClose(
      rotated.product,
      rotation.applyTo(new VecN(base.product)).data,
      11
    );
  });

  it('rejects malformed analytic products and propagates ordinary failures', () => {
    const particle = new XpbdParticleN({
      id: 'malformed',
      position: [0, 0],
      inverseMass: 1
    });
    const malformed = (
      id: string,
      product: unknown
    ): XpbdConservativeHessianVectorProviderN => ({
      ...analyticQuadraticProvider(id, [particle], 1),
      evaluatePotentialHessianVectorAt: () => product as never
    });
    const run = (provider: XpbdConservativeForceProviderN) =>
      evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
        problem: compile(
          [particle],
          [new VecN([0, 0])],
          0.1,
          [provider]
        ),
        coordinates: [0.2, 0.3],
        direction: [1, 0]
      });

    expect(() => run(malformed('absent', null)))
      .toThrow(/returned no curvature evaluation/);
    expect(() => run(malformed('count', { products: [] })))
      .toThrow(/product count mismatch/);
    expect(() => run(malformed('dimension', { products: [new VecN([1])] })))
      .toThrow(/must be R2/);
    expect(() => run(malformed(
      'finite',
      { products: [new VecN([Number.NaN, 0])] }
    ))).toThrow(/must be finite/);
    expect(() => run({
      ...analyticQuadraticProvider('throws', [particle], 1),
      evaluatePotentialHessianVectorAt: () => {
        throw new Error('analytic provider bug');
      }
    })).toThrow(/analytic provider bug/);
  });

  it('keeps invalid bases fatal and validates direct barrier directions', () => {
    const particle = new XpbdParticleN({
      id: 'domain',
      position: [0.3, 0],
      inverseMass: 1
    });
    const provider = new XpbdParticleHyperplaneBarrierN({
      id: 'domain-law',
      particle,
      plane: new HyperplaneColliderN([1, 0]),
      minimumDistance: 0.1,
      activationDistance: 0.8,
      stiffness: 1
    });
    const problem = compile(
      [particle],
      [new VecN([0.3, 0])],
      0.1,
      [provider]
    );

    expect(() => evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
      problem,
      coordinates: [0.1, 0],
      direction: [1, 0]
    })).toThrow(XpbdPotentialDomainErrorN);
    expect(() => provider.evaluatePotentialHessianVectorAt(
      () => new VecN([0.3, 0]),
      () => new VecN([1])
    )).toThrow(/candidate direction must be R2/);
    expect(() => provider.evaluatePotentialHessianVectorAt(
      () => new VecN([0.3, 0]),
      () => new VecN([1, Number.NaN])
    )).toThrow(/candidate direction must be finite/);
  });

  it('defensively isolates queries and preserves callers and live particles', () => {
    const particle = new XpbdParticleN({
      id: 'isolation',
      position: [0.4, -0.2],
      velocity: [0.1, 0.3],
      inverseMass: 0.5
    });
    const provider: XpbdConservativeHessianVectorProviderN = {
      ...analyticQuadraticProvider('isolation-law', [particle], 1),
      evaluatePotentialHessianVectorAt: (positionOf, directionOf) => {
        const position = positionOf(particle);
        const direction = directionOf(particle);
        position.data.fill(99);
        direction.data.fill(88);
        return { products: [new VecN([1, 2])] };
      }
    };
    const coordinates = new Float64Array([0.2, 0.7]);
    const direction = new Float64Array([-0.3, 0.5]);
    const coordinatesBefore = coordinates.slice();
    const directionBefore = direction.slice();
    const liveBefore = {
      position: particle.position.toArray(),
      velocity: particle.velocity.toArray()
    };
    const result =
      evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
        problem: compile(
          [particle],
          [new VecN([0.4, -0.2])],
          0.1,
          [provider]
        ),
        coordinates,
        direction
      });

    expect(result.status).toBe('evaluated');
    expect(coordinates).toEqual(coordinatesBefore);
    expect(direction).toEqual(directionBefore);
    expect(particle.position.toArray()).toEqual(liveBefore.position);
    expect(particle.velocity.toArray()).toEqual(liveBefore.velocity);
    expect(() => evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
      problem: compile(
        [particle],
        [new VecN([0.4, -0.2])],
        0.1,
        [provider]
      ),
      coordinates: [0],
      direction
    })).toThrow(/coordinates must have length 2/);
  });
});
