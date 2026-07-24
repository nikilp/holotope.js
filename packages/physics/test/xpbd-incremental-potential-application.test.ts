import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  applyXpbdIncrementalPotentialResultN,
  compileXpbdIncrementalPotentialProblemN,
  minimizeXpbdIncrementalPotentialN,
  type XpbdConservativeForceProviderN,
  type XpbdIncrementalPotentialApplicationResultN,
  type XpbdIncrementalPotentialMinimizationResultN
} from '../src/index.js';

function snapshot(particles: readonly XpbdParticleN[]): unknown {
  return particles.map((particle) => ({
    id: particle.id,
    dimension: particle.dimension,
    position: particle.position.toArray(),
    velocity: particle.velocity.toArray(),
    force: particle.force.toArray(),
    inverseMass: particle.inverseMass,
    gravityScale: particle.gravityScale
  }));
}

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 14
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]).toBeCloseTo(expected[index]!, digits);
  }
}

function inertialResult(
  dimension: number,
  options: {
    readonly position?: ArrayLike<number>;
    readonly prediction?: ArrayLike<number>;
    readonly velocity?: ArrayLike<number>;
  } = {}
): {
  readonly particle: XpbdParticleN;
  readonly result: XpbdIncrementalPotentialMinimizationResultN;
} {
  const position = options.position ?? new Float64Array(dimension);
  const prediction = options.prediction ?? Float64Array.from(
    { length: dimension },
    (_, axis) => 0.2 * (axis + 1)
  );
  const particle = new XpbdParticleN({
    id: `dynamic-r${dimension}`,
    position,
    velocity: options.velocity,
    inverseMass: 1,
    gravityScale: 0.7
  });
  particle.applyForce(Float64Array.from(
    { length: dimension },
    (_, axis) => 0.1 * (axis + 1)
  ));
  const problem = compileXpbdIncrementalPotentialProblemN({
    dimension,
    particles: [particle],
    predictedPositions: [new VecN(prediction)],
    deltaTime: 0.25,
    providers: []
  });
  const result = minimizeXpbdIncrementalPotentialN({
    problem,
    initialCoordinates: position,
    initialStep: 1,
    gradientTolerance: 1e-14
  });
  return { particle, result };
}

function applicationSummary(
  application: XpbdIncrementalPotentialApplicationResultN
): unknown {
  if (application.status !== 'applied') {
    return {
      status: application.status,
      reason: application.reason
    };
  }
  return {
    status: application.status,
    velocityUpdate: application.velocityUpdate,
    clearForces: application.clearForces,
    objective: application.verifiedFinal.objective,
    gradientNorm: application.verifiedFinal.gradientNorm,
    particles: application.particles.map((particle) => ({
      index: particle.particleIndex,
      id: particle.particleId,
      dynamic: particle.dynamic,
      positionBefore: particle.positionBefore.toArray(),
      positionAfter: particle.positionAfter.toArray(),
      velocityBefore: particle.velocityBefore.toArray(),
      velocityAfter: particle.velocityAfter.toArray(),
      forceBefore: particle.forceBefore.toArray(),
      forceAfter: particle.forceAfter.toArray()
    }))
  };
}

describe('atomic incremental-potential result application', () => {
  it('applies analytic R1-R4 predictions with world-compatible semantics', () => {
    for (const dimension of [1, 2, 3, 4]) {
      const dynamicPosition = Float64Array.from(
        { length: dimension },
        (_, axis) => -0.1 * (axis + 1)
      );
      const dynamicPrediction = Float64Array.from(
        { length: dimension },
        (_, axis) => 0.2 * (axis + 1)
      );
      const fixedPosition = Float64Array.from(
        { length: dimension },
        (_, axis) => 1 + axis
      );
      const fixedPrediction = Float64Array.from(
        fixedPosition,
        (value) => value + 0.05
      );
      const fixedVelocity = Float64Array.from(
        { length: dimension },
        (_, axis) => -0.3 * (axis + 1)
      );
      const particles = [
        new XpbdParticleN({
          id: `dynamic-${dimension}`,
          position: dynamicPosition,
          velocity: new Float64Array(dimension),
          inverseMass: 1
        }),
        new XpbdParticleN({
          id: `fixed-${dimension}`,
          position: fixedPosition,
          velocity: fixedVelocity,
          inverseMass: 0
        })
      ];
      particles[0]!.applyForce(new Float64Array(dimension).fill(2));
      particles[1]!.applyForce(new Float64Array(dimension).fill(-3));
      const problem = compileXpbdIncrementalPotentialProblemN({
        dimension,
        particles,
        predictedPositions: [
          new VecN(dynamicPrediction),
          new VecN(fixedPrediction)
        ],
        deltaTime: 0.25,
        providers: []
      });
      const result = minimizeXpbdIncrementalPotentialN({
        problem,
        initialCoordinates: dynamicPosition,
        initialStep: 1,
        gradientTolerance: 1e-14
      });
      const application = applyXpbdIncrementalPotentialResultN({ result });

      expect(application.status).toBe('applied');
      if (application.status !== 'applied') continue;
      expect(application.particles).toHaveLength(2);
      expectArrayClose(particles[0]!.position.data, dynamicPrediction);
      expect(particles[1]!.position.data).toEqual(fixedPrediction);
      expect(particles[1]!.velocity.data).toEqual(fixedVelocity);
      for (let axis = 0; axis < dimension; axis++) {
        expect(particles[0]!.velocity.data[axis]).toBeCloseTo(
          (
            dynamicPrediction[axis]! -
            dynamicPosition[axis]!
          ) / 0.25,
          14
        );
      }
      expect(particles[0]!.force.lengthSq()).toBe(0);
      expect(particles[1]!.force.lengthSq()).toBe(0);
      expect(application.verifiedFinal).not.toBe(result.final);
      expect(application.verifiedFinal.objective).toBe(result.final.objective);
    }
  });

  it('can preserve velocity and caller-owned force accumulators explicitly', () => {
    const { particle, result } = inertialResult(3, {
      velocity: [0.7, -0.2, 0.4]
    });
    const beforeVelocity = particle.velocity.toArray();
    const beforeForce = particle.force.toArray();
    const application = applyXpbdIncrementalPotentialResultN({
      result,
      velocityUpdate: 'preserve',
      clearForces: false
    });

    expect(application.status).toBe('applied');
    expectArrayClose(particle.position.data, [0.2, 0.4, 0.6]);
    expect(particle.velocity.toArray()).toEqual(beforeVelocity);
    expect(particle.force.toArray()).toEqual(beforeForce);
    expect(applyXpbdIncrementalPotentialResultN({
      result,
      velocityUpdate: 'preserve',
      clearForces: false
    })).toMatchObject({
      status: 'refused',
      reason: 'stale-particle-state',
      mismatch: { field: 'position' }
    });
  });

  it('refuses every non-converged terminal class without writes', () => {
    const particle = new XpbdParticleN({
      id: 'bounded',
      position: [1],
      inverseMass: 1
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 0.1,
      providers: []
    });
    const iterationLimit = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [1],
      maximumIterations: 0
    });
    const lineSearchExhausted = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [1],
      initialStep: 10,
      maximumLineSearchTrials: 1
    });
    const huge = new XpbdParticleN({
      id: 'huge',
      position: [1e16],
      inverseMass: 1
    });
    const linear: XpbdConservativeForceProviderN = {
      id: 'linear',
      dimension: 1,
      particles: [huge],
      evaluate: () => ({
        potentialEnergy: huge.position.data[0]!,
        forces: [new VecN([-1])]
      }),
      evaluateAt: (positionOf) => ({
        potentialEnergy: positionOf(huge).data[0]!,
        forces: [new VecN([-1])]
      })
    };
    const stalled = minimizeXpbdIncrementalPotentialN({
      problem: compileXpbdIncrementalPotentialProblemN({
        dimension: 1,
        particles: [huge],
        predictedPositions: [new VecN([1e16])],
        deltaTime: 1,
        providers: [linear]
      }),
      initialCoordinates: [1e16],
      gradientTolerance: 0
    });

    for (const result of [iterationLimit, lineSearchExhausted, stalled]) {
      const before = snapshot(result.problem.particles);
      const application = applyXpbdIncrementalPotentialResultN({ result });
      expect(application).toMatchObject({
        status: 'refused',
        reason: 'not-converged',
        minimizationStatus: result.status
      });
      expect(snapshot(result.problem.particles)).toEqual(before);
    }
  });

  it('reports each compiled particle-state drift without overwriting it', () => {
    const mutations: readonly [
      string,
      (particle: XpbdParticleN) => void,
      (particle: XpbdParticleN) => void
    ][] = [
      [
        'position',
        (particle) => { particle.position.data[0] = 7; },
        (particle) => { particle.position.data[0] = 0; }
      ],
      [
        'velocity',
        (particle) => { particle.velocity.data[0] = 7; },
        (particle) => { particle.velocity.data[0] = 0; }
      ],
      [
        'force',
        (particle) => { particle.force.data[0] = 7; },
        (particle) => { particle.force.data[0] = 0.1; }
      ],
      [
        'inverse-mass',
        (particle) => {
          (particle as unknown as { inverseMass: number }).inverseMass = 2;
        },
        (particle) => {
          (particle as unknown as { inverseMass: number }).inverseMass = 1;
        }
      ],
      [
        'gravity-scale',
        (particle) => { particle.gravityScale = 2; },
        (particle) => { particle.gravityScale = 0.7; }
      ]
    ];

    for (const [field, mutate, restore] of mutations) {
      const { particle, result } = inertialResult(1);
      mutate(particle);
      const stale = snapshot([particle]);
      expect(applyXpbdIncrementalPotentialResultN({ result })).toMatchObject({
        status: 'refused',
        reason: 'stale-particle-state',
        mismatch: { field }
      });
      expect(snapshot([particle])).toEqual(stale);
      restore(particle);
    }
  });

  it('defensively owns compilation snapshots and refuses changed result evidence', () => {
    const { particle, result } = inertialResult(2);
    const exposed = result.problem.particleStatesBeforeStep();
    exposed[0]!.position.data.fill(99);
    exposed[0]!.velocity.data.fill(99);
    exposed[0]!.force.data.fill(99);

    result.final.coordinates[0]! += 0.125;
    const before = snapshot([particle]);
    const application = applyXpbdIncrementalPotentialResultN({ result });
    expect(application).toMatchObject({
      status: 'refused',
      reason: 'stale-result-evidence',
      mismatch: { field: 'position', particleIndex: 0, axis: 0 }
    });
    expect(snapshot([particle])).toEqual(before);
  });

  it('refuses provider drift and rolls back a throwing mutating verifier', () => {
    const particle = new XpbdParticleN({
      id: 'provider-particle',
      position: [0],
      velocity: [0.25],
      inverseMass: 1
    }).applyForce([0.4]);
    let stiffness = 1;
    let verificationMode: 'pure' | 'mutate-return' | 'mutate-throw' = 'pure';
    const provider: XpbdConservativeForceProviderN = {
      id: 'mutable-quadratic',
      dimension: 1,
      particles: [particle],
      evaluate: () => ({
        potentialEnergy: 0.5 * stiffness * particle.position.lengthSq(),
        forces: [particle.position.clone().multiplyScalar(-stiffness)]
      }),
      evaluateAt: (positionOf) => {
        if (verificationMode !== 'pure') {
          particle.position.data[0] = 99;
          particle.velocity.data[0] = -99;
          particle.force.data[0] = 88;
          particle.gravityScale = -7;
        }
        if (verificationMode === 'mutate-throw') {
          throw new Error('verifier failure');
        }
        const position = positionOf(particle);
        return {
          potentialEnergy: 0.5 * stiffness * position.lengthSq(),
          forces: [position.multiplyScalar(-stiffness)]
        };
      }
    };
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([1])],
      deltaTime: 1,
      providers: [provider]
    });
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0],
      initialStep: 0.5,
      gradientTolerance: 1e-14
    });
    expect(result.status).toBe('converged');

    stiffness = 2;
    const beforeDrift = snapshot([particle]);
    expect(applyXpbdIncrementalPotentialResultN({ result })).toMatchObject({
      status: 'refused',
      reason: 'stale-result-evidence'
    });
    expect(snapshot([particle])).toEqual(beforeDrift);

    stiffness = 1;
    verificationMode = 'mutate-return';
    const beforeMutation = snapshot([particle]);
    expect(applyXpbdIncrementalPotentialResultN({ result })).toMatchObject({
      status: 'refused',
      reason: 'verification-mutated-particle-state',
      mismatch: { field: 'position' }
    });
    expect(snapshot([particle])).toEqual(beforeMutation);

    verificationMode = 'mutate-throw';
    const beforeThrow = snapshot([particle]);
    expect(() => applyXpbdIncrementalPotentialResultN({ result }))
      .toThrow(/verifier failure/);
    expect(snapshot([particle])).toEqual(beforeThrow);
  });

  it('preflights derived arithmetic and malformed policies before mutation', () => {
    const particle = new XpbdParticleN({
      id: 'overflow',
      position: [-1e308],
      inverseMass: 1
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([1e308])],
      deltaTime: 0.25,
      providers: []
    });
    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [1e308]
    });
    expect(result.status).toBe('converged');
    const before = snapshot([particle]);
    expect(() => applyXpbdIncrementalPotentialResultN({ result }))
      .toThrow(/reconstructed velocity is outside Float64/);
    expect(snapshot([particle])).toEqual(before);
    expect(() => applyXpbdIncrementalPotentialResultN({
      result,
      velocityUpdate: 'invented' as never
    })).toThrow(/velocityUpdate must be/);
    expect(() => applyXpbdIncrementalPotentialResultN({
      result,
      clearForces: 1 as never
    })).toThrow(/clearForces must be boolean/);
    expect(snapshot([particle])).toEqual(before);
  });

  it('produces deterministic application evidence for equivalent problems', () => {
    const first = inertialResult(4, {
      position: [-0.1, 0.2, -0.3, 0.4],
      prediction: [0.5, -0.4, 0.3, -0.2],
      velocity: [0.1, 0.2, 0.3, 0.4]
    });
    const second = inertialResult(4, {
      position: [-0.1, 0.2, -0.3, 0.4],
      prediction: [0.5, -0.4, 0.3, -0.2],
      velocity: [0.1, 0.2, 0.3, 0.4]
    });
    const firstApplication = applyXpbdIncrementalPotentialResultN({
      result: first.result
    });
    const secondApplication = applyXpbdIncrementalPotentialResultN({
      result: second.result
    });

    expect(applicationSummary(secondApplication))
      .toEqual(applicationSummary(firstApplication));
  });
});
