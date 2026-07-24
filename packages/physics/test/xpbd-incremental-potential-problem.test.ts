import { CellComplex, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  SimplexConstitutiveDomainErrorN,
  XpbdParticleN,
  compileSimplexConstitutiveFamilyN,
  compileXpbdIncrementalPotentialProblemN,
  evaluateXpbdIncrementalPotentialN,
  searchXpbdIncrementalPotentialArmijoN,
  simplexMeasureBarrierLawN,
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

function snapshot(particles: readonly XpbdParticleN[]): unknown {
  return particles.map((particle) => ({
    position: particle.position.toArray(),
    velocity: particle.velocity.toArray(),
    force: particle.force.toArray(),
    inverseMass: particle.inverseMass,
    gravityScale: particle.gravityScale
  }));
}

describe('packed XPBD incremental-potential problem', () => {
  it('round-trips authored free coordinates and restores fixed predictions', () => {
    for (const dimension of [1, 2, 3, 4]) {
      const particles = [
        new XpbdParticleN({
          id: `free-a-${dimension}`,
          position: new VecN(dimension),
          inverseMass: 1
        }),
        new XpbdParticleN({
          id: `fixed-${dimension}`,
          position: new VecN(dimension),
          inverseMass: 0
        }),
        new XpbdParticleN({
          id: `free-b-${dimension}`,
          position: new VecN(dimension),
          inverseMass: 0.5
        })
      ];
      const predictions = particles.map((_, particle) =>
        new VecN(Array.from(
          { length: dimension },
          (_, axis) => 0.1 * (particle + 1) * (axis + 1)
        ))
      );
      const problem = compileXpbdIncrementalPotentialProblemN({
        dimension,
        particles,
        predictedPositions: predictions,
        deltaTime: 0.1,
        providers: []
      });
      predictions[1]!.data.fill(99);
      const positions = [
        new VecN(Array.from({ length: dimension }, (_, axis) => axis + 1)),
        problem.predictedPositions[1]!.clone(),
        new VecN(Array.from({ length: dimension }, (_, axis) => -axis - 2))
      ];
      const packed = problem.packPositions(positions);
      const unpacked = problem.unpackPositions(packed);

      expect(problem.freeParticleIndices).toEqual([0, 2]);
      expect(problem.variableCount).toBe(2 * dimension);
      expect(Array.from(packed)).toEqual([
        ...positions[0]!.toArray(),
        ...positions[2]!.toArray()
      ]);
      expect(unpacked.map((position) => position.toArray())).toEqual(
        positions.map((position) => position.toArray())
      );
      expect(() => problem.packPositions([
        positions[0]!,
        new VecN(dimension),
        positions[2]!
      ])).toThrow(/fixed particle 1 position must equal its prediction/);
    }
  });

  it('matches direct particle-space evidence and packed differences', () => {
    const particles = [
      new XpbdParticleN({
        id: 'a',
        position: [0, 0, 0, 0],
        inverseMass: 0.5
      }),
      new XpbdParticleN({
        id: 'fixed',
        position: [0.2, -0.1, 0.3, 0],
        inverseMass: 0
      }),
      new XpbdParticleN({
        id: 'b',
        position: [0, 0, 0, 0],
        inverseMass: 0.8
      })
    ];
    const providers = [
      quadraticProvider('left', particles.slice(0, 2), 1.7),
      quadraticProvider('right', particles.slice(1), 0.6)
    ];
    const predictions = [
      new VecN([0.1, 0.2, -0.1, 0]),
      particles[1]!.position.clone(),
      new VecN([-0.2, 0.1, 0.05, 0.3])
    ];
    const positions = [
      new VecN([0.4, -0.3, 0.2, 0.1]),
      predictions[1]!.clone(),
      new VecN([-0.1, 0.25, -0.2, 0.15])
    ];
    const before = snapshot(particles);
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 4,
      particles,
      predictedPositions: predictions,
      deltaTime: 0.08,
      providers
    });
    const packed = problem.packPositions(positions);
    const evaluated = problem.evaluate(packed);
    const direct = evaluateXpbdIncrementalPotentialN({
      dimension: 4,
      particles,
      positions,
      predictedPositions: predictions,
      deltaTime: 0.08,
      providers
    });

    expect(evaluated.objective).toBeCloseTo(direct.objective, 14);
    expect(evaluated.gradientNorm).toBeCloseTo(direct.gradientNorm, 14);
    expect(Array.from(evaluated.gradient)).toEqual([
      ...direct.gradients[0]!.toArray(),
      ...direct.gradients[2]!.toArray()
    ]);

    const step = 1e-6;
    for (let coordinate = 0; coordinate < packed.length; coordinate++) {
      const plus = packed.slice();
      const minus = packed.slice();
      plus[coordinate]! += step;
      minus[coordinate]! -= step;
      expect(evaluated.gradient[coordinate]).toBeCloseTo(
        (
          problem.evaluate(plus).objective -
          problem.evaluate(minus).objective
        ) / (2 * step),
        7
      );
    }
    expect(snapshot(particles)).toEqual(before);
  });

  it('uses the authored particle order as the packed-coordinate order', () => {
    const particles = [
      new XpbdParticleN({ id: 'p0', position: [0, 0], inverseMass: 0.5 }),
      new XpbdParticleN({ id: 'p1', position: [0, 0], inverseMass: 1 }),
      new XpbdParticleN({ id: 'p2', position: [0, 0], inverseMass: 2 })
    ];
    const provider = quadraticProvider('all', particles, 0.7);
    const predictions = [
      new VecN([0, 0]),
      new VecN([0.1, 0.2]),
      new VecN([-0.2, 0.3])
    ];
    const positions = [
      new VecN([0.4, -0.1]),
      new VecN([0.2, 0.5]),
      new VecN([-0.3, 0.6])
    ];
    const canonical = compileXpbdIncrementalPotentialProblemN({
      dimension: 2,
      particles,
      predictedPositions: predictions,
      deltaTime: 0.12,
      providers: [provider]
    }).evaluate(Float64Array.from(positions.flatMap(
      (position) => position.toArray()
    )));
    const order = [2, 0, 1];
    const permutedProblem = compileXpbdIncrementalPotentialProblemN({
      dimension: 2,
      particles: order.map((index) => particles[index]!),
      predictedPositions: order.map((index) => predictions[index]!),
      deltaTime: 0.12,
      providers: [provider]
    });
    const permuted = permutedProblem.evaluate(
      permutedProblem.packPositions(order.map((index) => positions[index]!))
    );

    expect(permuted.objective).toBeCloseTo(canonical.objective, 14);
    for (let output = 0; output < order.length; output++) {
      const canonicalOffset = order[output]! * 2;
      const permutedOffset = output * 2;
      expect(permuted.gradient[permutedOffset])
        .toBeCloseTo(canonical.gradient[canonicalOffset]!, 14);
      expect(permuted.gradient[permutedOffset + 1])
        .toBeCloseTo(canonical.gradient[canonicalOffset + 1]!, 14);
    }
  });

  it('refuses a stale free-coordinate map after inverse mass changes', () => {
    const particle = new XpbdParticleN({
      id: 'p',
      position: [0],
      inverseMass: 1
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 0.1,
      providers: []
    });
    (particle as { inverseMass: number }).inverseMass = 0;
    expect(() => problem.evaluate([0]))
      .toThrow(/inverseMass changed after compilation/);
    expect(() => problem.packPositions([new VecN([0])]))
      .toThrow(/inverseMass changed after compilation/);
  });
});

describe('XPBD incremental-potential Armijo search', () => {
  it('backtracks an oversized quadratic step and satisfies Armijo', () => {
    const particle = new XpbdParticleN({
      id: 'p',
      position: [0],
      inverseMass: 1
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 0.1,
      providers: []
    });
    const result = searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [2],
      direction: [-2],
      initialStep: 2
    });

    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    expect(result.stepLength).toBe(1);
    expect(result.trials.map((trial) => trial.status)).toEqual([
      'insufficient-decrease',
      'accepted'
    ]);
    const acceptedTrial = result.trials[1]!;
    expect(result.accepted.objective).toBeLessThanOrEqual(
      acceptedTrial.armijoUpperBound
    );
    expect(Array.from(result.accepted.coordinates)).toEqual([0]);
  });

  it('backtracks only typed constitutive-domain refusals', () => {
    const source = new CellComplex(
      1,
      new Float64Array([0, 1])
    );
    const group: CellGroup = {
      key: 'line',
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    source.addGroup(group);
    const particles = [
      new XpbdParticleN({ id: 'fixed', position: [0], inverseMass: 0 }),
      new XpbdParticleN({ id: 'free', position: [1], inverseMass: 1 })
    ];
    const barrier = compileSimplexConstitutiveFamilyN({
      id: 'barrier',
      source,
      simplexGroup: group,
      particles,
      law: simplexMeasureBarrierLawN,
      material: {
        minimumMeasureRatio: 0.2,
        activationMeasureRatio: 0.9,
        stiffness: 1
      }
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles,
      predictedPositions: [new VecN([0]), new VecN([0])],
      deltaTime: 0.1,
      providers: [barrier]
    });
    const result = searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [1],
      direction: [-1]
    });

    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    expect(result.trials[0]).toMatchObject({
      stepLength: 1,
      status: 'domain-refused',
      refusal: { lawId: 'simplex-measure-barrier' }
    });
    expect(result.trials[0]!.refusal?.reason)
      .toMatch(/collapsed|non-positive-measure|below-minimum-measure/);
    expect(result.trials[1]!.status).toBe('accepted');
    expect(result.stepLength).toBe(0.5);

    expect(() => searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [0],
      direction: [1]
    })).toThrow(SimplexConstitutiveDomainErrorN);
  });

  it('returns typed non-descent and exhaustion evidence without mutation', () => {
    const particle = new XpbdParticleN({
      id: 'p',
      position: [0],
      inverseMass: 1
    });
    const before = snapshot([particle]);
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 0.1,
      providers: []
    });
    const notDescent = searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [1],
      direction: [1]
    });
    expect(notDescent).toMatchObject({
      status: 'not-descent',
      directionalDerivative: 1,
      trials: []
    });

    const exhausted = searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [1],
      direction: [-1],
      initialStep: 10,
      maximumTrials: 1
    });
    expect(exhausted.status).toBe('exhausted');
    expect(exhausted.trials).toHaveLength(1);
    expect(exhausted.trials[0]!.status).toBe('insufficient-decrease');
    expect(snapshot([particle])).toEqual(before);
  });

  it('rethrows provider bugs and refuses malformed search evidence', () => {
    const particle = new XpbdParticleN({
      id: 'p',
      position: [1],
      inverseMass: 1
    });
    const provider: XpbdConservativeForceProviderN = {
      id: 'buggy',
      dimension: 1,
      particles: [particle],
      evaluate: () => ({
        potentialEnergy: 0.5,
        forces: [new VecN([-1])]
      }),
      evaluateAt: (positionOf) => {
        const position = positionOf(particle);
        if (position.data[0]! < 0.5) throw new Error('provider bug');
        return {
          potentialEnergy: 0.5 * position.lengthSq(),
          forces: [position.multiplyScalar(-1)]
        };
      }
    };
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: [particle],
      predictedPositions: [new VecN([0])],
      deltaTime: 1,
      providers: [provider]
    });
    expect(() => searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [1],
      direction: [-2]
    })).toThrow(/provider bug/);
    expect(() => searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [1],
      direction: [Number.NaN]
    })).toThrow(/coordinates must be finite/);
    expect(() => searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [1],
      direction: [-1],
      contractionFactor: 1
    })).toThrow(/contractionFactor must be in/);
    expect(() => problem.evaluate([])).toThrow(/expected 1 coordinates/);
  });
});
