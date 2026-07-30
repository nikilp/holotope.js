import { CellComplex, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  compileSimplexCompressibleNeoHookeanFamilyN,
  compileSimplexConstitutiveFamilyN,
  compileXpbdIncrementalPotentialProblemN,
  evaluateXpbdIncrementalPotentialAnalyticHessianVectorN,
  simplexMeasureBarrierLawN,
  solveXpbdIncrementalPotentialNewtonDirectionN,
  type XpbdConservativeForceProviderN,
  type XpbdConservativeHessianVectorProviderN,
  type XpbdIncrementalPotentialProblemN
} from '../src/index.js';

function packedQuadraticProvider(
  id: string,
  particles: readonly XpbdParticleN[],
  matrix: readonly (readonly number[])[],
  onCurvature?: () => void
): XpbdConservativeHessianVectorProviderN {
  const dimension = particles[0]!.dimension;
  const variableCount = particles.length * dimension;
  if (matrix.length !== variableCount ||
    matrix.some((row) => row.length !== variableCount)) {
    throw new Error('test matrix dimension mismatch');
  }
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (
    positionOf
  ) => {
    const coordinates = Float64Array.from(
      particles.flatMap((particle) => positionOf(particle).toArray())
    );
    const gradient = applyDense(matrix, coordinates);
    let potentialEnergy = 0.5 * dot(coordinates, gradient);
    return {
      potentialEnergy,
      forces: particles.map((_, particle) =>
        new VecN(gradient.subarray(
          particle * dimension,
          (particle + 1) * dimension
        )).multiplyScalar(-1)
      )
    };
  };
  return {
    id,
    dimension,
    particles,
    evaluate: () => evaluateAt((particle) => particle.position.clone()),
    evaluateAt,
    evaluatePotentialHessianVectorAt: (_positionOf, directionOf) => {
      onCurvature?.();
      const direction = Float64Array.from(
        particles.flatMap((particle) => directionOf(particle).toArray())
      );
      const product = applyDense(matrix, direction);
      return {
        products: particles.map((_, particle) =>
          new VecN(product.subarray(
            particle * dimension,
            (particle + 1) * dimension
          ))
        )
      };
    }
  };
}

function ordinaryQuadraticProvider(
  id: string,
  particle: XpbdParticleN
): XpbdConservativeForceProviderN {
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (
    positionOf
  ) => {
    const position = positionOf(particle);
    return {
      potentialEnergy: 0.5 * position.lengthSq(),
      forces: [position.multiplyScalar(-1)]
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

function inertialProblem(
  dimension: number,
  inverseMasses: readonly number[]
): {
  particles: XpbdParticleN[];
  problem: XpbdIncrementalPotentialProblemN;
} {
  const particles = inverseMasses.map((inverseMass, index) =>
    new XpbdParticleN({
      id: `inertial/${dimension}/${index}`,
      position: new VecN(dimension),
      inverseMass
    })
  );
  return {
    particles,
    problem: compileXpbdIncrementalPotentialProblemN({
      dimension,
      particles,
      predictedPositions: particles.map(() => new VecN(dimension)),
      deltaTime: 1,
      providers: []
    })
  };
}

function squareSource(): { source: CellComplex; group: CellGroup } {
  const group: CellGroup = {
    key: 'triangles',
    dim: 2,
    verticesPerCell: 3,
    kind: 'simplex',
    indices: new Uint32Array([0, 1, 2, 1, 3, 2])
  };
  return {
    source: new CellComplex(2, new Float64Array([
      0, 0,
      1, 0,
      0, 1,
      1, 1
    ]), [group]),
    group
  };
}

function applyDense(
  matrix: readonly (readonly number[])[],
  vector: ArrayLike<number>
): Float64Array {
  return Float64Array.from(matrix, (row) =>
    row.reduce(
      (sum, coefficient, column) =>
        sum + coefficient * vector[column]!,
      0
    )
  );
}

function dot(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let value = 0;
  for (let index = 0; index < left.length; index++) {
    value += left[index]! * right[index]!;
  }
  return value;
}

function norm(value: ArrayLike<number>): number {
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    result = Math.hypot(result, value[index]!);
  }
  return result;
}

function snapshot(particles: readonly XpbdParticleN[]): unknown {
  return particles.map((particle) => ({
    position: particle.position.toArray(),
    velocity: particle.velocity.toArray(),
    force: particle.force.toArray(),
    inverseMass: particle.inverseMass
  }));
}

describe('XPBD matrix-free Newton-direction reference', () => {
  it('solves non-uniform inertial blocks in one mass-preconditioned iteration', () => {
    for (const dimension of [1, 4, 7]) {
      const { problem } = inertialProblem(dimension, [0.25, 2]);
      const coordinates = Float64Array.from(
        { length: 2 * dimension },
        (_, index) => 0.07 * (index + 1) * (index % 2 === 0 ? 1 : -1)
      );
      const result = solveXpbdIncrementalPotentialNewtonDirectionN({
        problem,
        coordinates,
        relativeResidualTolerance: 0,
        absoluteResidualTolerance: 1e-13
      });

      expect(result.status).toBe('converged');
      if (result.status !== 'converged') continue;
      expect(result.preconditioner).toBe('mass-diagonal');
      expect(result.iterations).toHaveLength(1);
      expect(result.operatorEvaluations).toBe(1);
      for (let index = 0; index < coordinates.length; index++) {
        expect(result.direction[index]).toBeCloseTo(-coordinates[index]!, 14);
      }
      expect(result.residualNorm).toBeLessThan(1e-13);
    }
  });

  it('matches an independent dense solve for a coupled SPD objective', () => {
    const particles = [
      new XpbdParticleN({ id: 'a', position: [0], inverseMass: 1 }),
      new XpbdParticleN({ id: 'b', position: [0], inverseMass: 1 })
    ];
    const potential = [[3, 1], [1, 2]];
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles,
      predictedPositions: [new VecN([0]), new VecN([0])],
      deltaTime: 1,
      providers: [packedQuadraticProvider('coupled', particles, potential)]
    });
    const result = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: [1, -2],
      preconditioner: 'identity',
      maximumIterations: 2,
      relativeResidualTolerance: 0,
      absoluteResidualTolerance: 1e-13
    });

    expect(result.status).toBe('converged');
    if (result.status !== 'converged') return;
    expect(result.iterations.length).toBeLessThanOrEqual(2);
    expect(result.direction[0]).toBeCloseTo(-1, 13);
    expect(result.direction[1]).toBeCloseTo(2, 13);
    expect(result.residualNorm).toBeLessThan(1e-13);
  });

  it('reuses one projected curvature construction across CG iterations', () => {
    const particles = [
      new XpbdParticleN({ id: 'reuse/a', position: [0], inverseMass: 1 }),
      new XpbdParticleN({ id: 'reuse/b', position: [0], inverseMass: 1 })
    ];
    let providerLocalCalls = 0;
    const providerLocalProblem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles,
      predictedPositions: [new VecN([0]), new VecN([0])],
      deltaTime: 1,
      providers: [packedQuadraticProvider(
        'reuse-provider-local',
        particles,
        [[3, 1], [1, 2]],
        () => providerLocalCalls++
      )]
    });
    const providerLocal = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem: providerLocalProblem,
      coordinates: [1, -2],
      preconditioner: 'identity',
      curvaturePolicy: { kind: 'provider-local-psd' },
      maximumIterations: 2,
      relativeResidualTolerance: 0,
      absoluteResidualTolerance: 1e-13
    });

    expect(providerLocal.status).toBe('converged');
    if (providerLocal.status !== 'converged') return;
    expect(providerLocal.iterations).toHaveLength(2);
    expect(providerLocal.operatorEvaluations).toBe(2);
    expect(providerLocalCalls).toBe(2);
    expect(providerLocal.curvatureConstructionOperatorEvaluations).toBe(2);
    expect(providerLocal.curvatureApplicationOperatorEvaluations).toBe(0);
    expect(providerLocal.curvatureProviders).toHaveLength(1);
    expect(providerLocal.curvatureProviders[0]).toMatchObject({
      kind: 'provider-local-psd',
      decomposition: 'provider',
      constructionOperatorEvaluations: 2,
      applicationOperatorEvaluationsPerNonzeroProduct: 0
    });
    expect(providerLocal.direction[0]).toBeCloseTo(-1, 13);
    expect(providerLocal.direction[1]).toBeCloseTo(2, 13);

    let blockCalls = 0;
    const blockProblem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles,
      predictedPositions: [new VecN([0]), new VecN([0])],
      deltaTime: 1,
      providers: [packedQuadraticProvider(
        'reuse-implicit-block',
        particles,
        [[3, 1], [1, 2]],
        () => blockCalls++
      )]
    });
    const block = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem: blockProblem,
      coordinates: [1, -2],
      preconditioner: 'identity',
      curvaturePolicy: { kind: 'provider-block-psd' },
      maximumIterations: 2,
      relativeResidualTolerance: 0,
      absoluteResidualTolerance: 1e-13
    });

    expect(block.status).toBe('converged');
    if (block.status !== 'converged') return;
    expect(block.iterations).toHaveLength(2);
    expect(blockCalls).toBe(4);
    expect(block.curvatureConstructionOperatorEvaluations).toBe(2);
    expect(block.curvatureApplicationOperatorEvaluations).toBe(2);
    expect(block.curvatureProviders[0]).toMatchObject({
      kind: 'provider-block-psd',
      decomposition: 'implicit-provider',
      constructionOperatorEvaluations: 2,
      applicationOperatorEvaluationsPerNonzeroProduct: 1
    });
    expect(block.direction[0]).toBeCloseTo(-1, 13);
    expect(block.direction[1]).toBeCloseTo(2, 13);
  });

  it('refuses non-positive curvature rather than certifying a false solve', () => {
    const particle = new XpbdParticleN({
      id: 'indefinite',
      position: [0],
      inverseMass: 1
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 1,
      providers: [
        packedQuadraticProvider('negative-potential', [particle], [[-2]])
      ]
    });
    const result = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: [1]
    });

    expect(result).toMatchObject({
      status: 'non-positive-curvature',
      iterationIndex: 0,
      quadraticForm: -1,
      curvatureThreshold: 256 * Number.EPSILON,
      operatorEvaluations: 1
    });
    if (result.status === 'non-positive-curvature') {
      expect(Array.from(result.direction)).toEqual([0]);
      expect(Array.from(result.krylovDirection)).toEqual([1]);
      expect(Array.from(result.product)).toEqual([-1]);
    }
  });

  it('uses provider-local PSD only when explicitly authored', () => {
    const particle = new XpbdParticleN({
      id: 'modified-newton',
      position: [0],
      inverseMass: 1
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 1,
      providers: [
        packedQuadraticProvider('negative-potential', [particle], [[-2]])
      ]
    });
    const exact = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: [1]
    });
    const projected = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: [1],
      curvaturePolicy: { kind: 'provider-local-psd' }
    });
    const blockProjected = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: [1],
      curvaturePolicy: { kind: 'provider-block-psd' }
    });

    expect(exact.status).toBe('non-positive-curvature');
    expect(exact.curvaturePolicy).toBe('exact');
    expect(projected.status).toBe('converged');
    expect(projected.curvaturePolicy).toBe('provider-local-psd');
    expect(blockProjected.status).toBe('converged');
    expect(blockProjected.curvaturePolicy).toBe('provider-block-psd');
    if (projected.status !== 'converged') return;
    expect(Array.from(projected.direction)).toEqual([1]);
    expect(projected.iterations).toHaveLength(1);
    expect(projected.iterations[0]!.quadraticForm).toBe(1);
    expect(projected.iterations[0]!.providerCurvatures)
      .toHaveLength(1);
    const providerCurvature =
      projected.iterations[0]!.providerCurvatures[0]!;
    expect(providerCurvature.providerId).toBe('negative-potential');
    expect(providerCurvature.curvature.kind)
      .toBe('provider-local-psd');
    if (providerCurvature.curvature.kind === 'provider-local-psd') {
      expect(providerCurvature.curvature.clippedEigenvalueCount).toBe(1);
      expect(Array.from(providerCurvature.curvature.rawEigenvalues))
        .toEqual([-2]);
    }
    const blockCurvature =
      blockProjected.iterations[0]!.providerCurvatures[0]!.curvature;
    expect(blockCurvature.kind).toBe('provider-block-psd');
    if (blockCurvature.kind === 'provider-block-psd') {
      expect(blockCurvature.decomposition).toBe('implicit-provider');
      expect(blockCurvature.blockCount).toBe(1);
      expect(blockCurvature.blocks[0]!.clippedEigenvalueCount).toBe(1);
      expect(blockCurvature.rawAssemblyRelativeError).toBe(0);
    }
    expect(projected.base.gradient[0]! * projected.direction[0]!)
      .toBeLessThan(0);
  });

  it('preflights unsupported providers before requesting partial curvature', () => {
    const particle = new XpbdParticleN({
      id: 'mixed',
      position: [0],
      inverseMass: 1
    });
    let capableCalls = 0;
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 1,
      providers: [
        packedQuadraticProvider(
          'capable',
          [particle],
          [[1]],
          () => capableCalls++
        ),
        ordinaryQuadraticProvider('ordinary', particle)
      ]
    });
    const result = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: [1]
    });

    expect(result.status).toBe('unsupported-provider');
    if (result.status === 'unsupported-provider') {
      expect(result.providerIds).toEqual(['ordinary']);
      expect(result.operatorEvaluations).toBe(0);
    }
    expect(capableCalls).toBe(0);
  });

  it('solves a complete constitutive objective and independently verifies its residual', () => {
    const { source, group } = squareSource();
    const current = [
      new VecN([0.02, -0.03]),
      new VecN([0.91, 0.04]),
      new VecN([-0.05, 0.88]),
      new VecN([0.92, 0.9])
    ];
    const particles = current.map((position, vertex) =>
      new XpbdParticleN({
        id: `constitutive/${vertex}`,
        position,
        inverseMass: 0.8 + 0.1 * vertex
      })
    );
    const elastic = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'elastic',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 3, shearModulus: 2 }
    });
    const barrier = compileSimplexConstitutiveFamilyN({
      id: 'measure',
      source,
      simplexGroup: group,
      particles,
      law: simplexMeasureBarrierLawN,
      material: {
        minimumMeasureRatio: 0.2,
        activationMeasureRatio: 0.95,
        stiffness: 1.5
      }
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 2,
      particles,
      predictedPositions: current.map((position) => position.clone()),
      deltaTime: 0.08,
      providers: [elastic, barrier]
    });
    const coordinates = Float64Array.from(
      current.flatMap((position) => position.toArray())
    );
    const result = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates,
      maximumIterations: problem.variableCount,
      relativeResidualTolerance: 1e-10
    });

    expect(result.status).toBe('converged');
    if (result.status !== 'converged') return;
    const product =
      evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
        problem,
        coordinates,
        direction: result.direction
      });
    expect(product.status).toBe('evaluated');
    if (product.status !== 'evaluated') return;
    const residual = Float64Array.from(
      product.product,
      (component, index) => component + result.base.gradient[index]!
    );
    expect(norm(residual)).toBeCloseTo(result.residualNorm, 11);
    expect(norm(residual)).toBeLessThanOrEqual(result.residualTolerance);
    expect(result.iterations.length).toBeLessThanOrEqual(problem.variableCount);
  });

  it('retains exact zero and bounded zero-iteration outcomes', () => {
    const { problem } = inertialProblem(4, [1]);
    const zero = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: [0, 0, 0, 0]
    });
    expect(zero).toMatchObject({
      status: 'zero-gradient',
      initialResidualNorm: 0,
      residualNorm: 0,
      operatorEvaluations: 0,
      curvatureConstructionOperatorEvaluations: 0,
      curvatureApplicationOperatorEvaluations: 0,
      curvatureProviders: []
    });

    const limited = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: [1, 0, 0, 0],
      maximumIterations: 0
    });
    expect(limited).toMatchObject({
      status: 'iteration-limit',
      maximumIterations: 0,
      operatorEvaluations: 0,
      curvatureConstructionOperatorEvaluations: 0,
      curvatureApplicationOperatorEvaluations: 0,
      curvatureProviders: []
    });
    expect(Array.from(limited.direction)).toEqual([0, 0, 0, 0]);

    const initial = solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: [1, 0, 0, 0],
      relativeResidualTolerance: 1
    });
    expect(initial).toMatchObject({
      status: 'converged',
      convergencePoint: 'initial-residual',
      operatorEvaluations: 0,
      curvatureConstructionOperatorEvaluations: 0,
      curvatureApplicationOperatorEvaluations: 0,
      curvatureProviders: []
    });
  });

  it('is deterministic and preserves caller buffers and live particles', () => {
    const { particles, problem } = inertialProblem(2, [0.5, 2]);
    const coordinates = Float64Array.of(0.3, -0.2, 0.7, 0.1);
    const beforeCoordinates = coordinates.slice();
    const beforeParticles = snapshot(particles);
    const run = () => solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates,
      relativeResidualTolerance: 0,
      absoluteResidualTolerance: 1e-14
    });
    const a = run();
    const b = run();

    expect({
      status: a.status,
      direction: Array.from(a.direction),
      residualNorm: a.residualNorm,
      iterations: a.iterations
    }).toEqual({
      status: b.status,
      direction: Array.from(b.direction),
      residualNorm: b.residualNorm,
      iterations: b.iterations
    });
    expect(Array.from(coordinates)).toEqual(Array.from(beforeCoordinates));
    expect(snapshot(particles)).toEqual(beforeParticles);
  });

  it('rejects malformed solver policy and coordinate inputs', () => {
    const { problem } = inertialProblem(1, [1]);
    const solve = (
      overrides: Record<string, unknown>
    ) => solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: [1],
      ...overrides
    });

    expect(() => solve({
      preconditioner: 'dense'
    })).toThrow(/preconditioner/);
    expect(() => solve({
      relativeResidualTolerance: -1
    })).toThrow(/relativeResidualTolerance/);
    expect(() => solve({
      absoluteResidualTolerance: Number.NaN
    })).toThrow(/absoluteResidualTolerance/);
    expect(() => solve({
      relativeCurvatureTolerance: 1
    })).toThrow(/relativeCurvatureTolerance/);
    expect(() => solve({
      maximumIterations: 1.5
    })).toThrow(/maximumIterations/);
    expect(() => solve({
      curvaturePolicy: 'repair'
    })).toThrow(/curvaturePolicy/);
    expect(() => solve({
      curvaturePolicy: {
        kind: 'provider-local-psd',
        symmetryTolerance: 0
      }
    })).toThrow(/symmetryTolerance/);
    expect(() => solve({
      curvaturePolicy: {
        kind: 'provider-local-psd',
        eigensolverTolerance: Number.NaN
      }
    })).toThrow(/eigensolverTolerance/);
    expect(() => solve({
      curvaturePolicy: {
        kind: 'provider-local-psd',
        eigensolverMaximumSweeps: 1.5
      }
    })).toThrow(/eigensolverMaximumSweeps/);
    expect(() => solve({
      curvaturePolicy: {
        kind: 'provider-block-psd',
        decompositionTolerance: 0
      }
    })).toThrow(/decompositionTolerance/);
    expect(() => solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: []
    })).toThrow(/coordinates/);
    expect(() => solveXpbdIncrementalPotentialNewtonDirectionN({
      problem,
      coordinates: [Number.POSITIVE_INFINITY]
    })).toThrow(/coordinates/);
  });
});
