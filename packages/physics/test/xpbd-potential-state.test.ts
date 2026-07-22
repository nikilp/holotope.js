import { CellComplex, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  compileSimplexCompressibleNeoHookeanFamilyN,
  compileSimplexConstitutiveFamilyN,
  compileSimplexStVenantKirchhoffFamilyN,
  evaluateXpbdPotentialStateN,
  simplexMeasureBarrierLawN,
  type XpbdConservativeForceProviderN
} from '../src/index.js';

function simplexSource(
  simplexDimension: number,
  ambientDimension: number
): { source: CellComplex; group: CellGroup } {
  const positions = new Float64Array(
    (simplexDimension + 1) * ambientDimension
  );
  for (let vertex = 1; vertex <= simplexDimension; vertex++) {
    positions[vertex * ambientDimension + vertex - 1] = 1;
  }
  const group: CellGroup = {
    key: `simplex-${simplexDimension}-in-${ambientDimension}`,
    dim: simplexDimension,
    verticesPerCell: simplexDimension + 1,
    kind: 'simplex',
    indices: new Uint32Array(
      Array.from({ length: simplexDimension + 1 }, (_, index) => index)
    )
  };
  return {
    source: new CellComplex(ambientDimension, positions, [group]),
    group
  };
}

function particlesFrom(source: CellComplex): XpbdParticleN[] {
  return Array.from({ length: source.vertexCount }, (_, vertex) =>
    new XpbdParticleN({
      id: `p/${vertex}`,
      position: source.positions.subarray(
        vertex * source.ambientDim,
        (vertex + 1) * source.ambientDim
      ),
      velocity: Array.from(
        { length: source.ambientDim },
        (_, axis) => 0.01 * (vertex + 1) * (axis + 1)
      )
    }).applyForce(Array.from(
      { length: source.ambientDim },
      (_, axis) => -0.02 * (vertex + axis + 1)
    ))
  );
}

function liveSnapshot(particles: readonly XpbdParticleN[]): unknown {
  return particles.map((particle) => ({
    position: particle.position.toArray(),
    velocity: particle.velocity.toArray(),
    force: particle.force.toArray(),
    inverseMass: particle.inverseMass,
    gravityScale: particle.gravityScale
  }));
}

function expectVectorClose(
  actual: VecN,
  expected: VecN,
  digits = 10
): void {
  expect(actual.dim).toBe(expected.dim);
  for (let axis = 0; axis < actual.dim; axis++) {
    expect(actual.data[axis]).toBeCloseTo(expected.data[axis]!, digits);
  }
}

describe('candidate-state conservative potentials', () => {
  it('evaluates displaced candidates without mutating live particle state', () => {
    const { source, group } = simplexSource(2, 4);
    const particles = particlesFrom(source);
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'embedded-sheet',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 2.5, shearModulus: 1.75 }
    });
    const live = family.evaluate();
    const candidates = [
      new VecN([0.03, -0.02, 0.01, 0.04]),
      new VecN([1.14, 0.08, -0.03, 0.02]),
      new VecN([-0.06, 0.91, 0.07, -0.05])
    ];
    const indices = new Map(particles.map((particle, index) => [particle, index]));
    const before = liveSnapshot(particles);
    const evaluated = family.evaluateAt(
      (particle) => candidates[indices.get(particle)!]!
    );

    expect(live.potentialEnergy).toBeCloseTo(0, 14);
    expect(evaluated.potentialEnergy).toBeGreaterThan(0);
    expect(evaluated.forces).toHaveLength(particles.length);
    expect(liveSnapshot(particles)).toEqual(before);

    const throughCandidate = family.evaluateAt((particle) => particle.position);
    expect(throughCandidate.potentialEnergy).toBeCloseTo(live.potentialEnergy, 14);
    for (let index = 0; index < particles.length; index++) {
      expectVectorClose(throughCandidate.forces[index]!, live.forces[index]!, 14);
    }
    expect(() => family.evaluateAt(() => new VecN(3))).toThrow(/must be R4/);
    expect(() => family.evaluateAt(() => new VecN([0, 0, 0, Number.NaN])))
      .toThrow(/must be finite/);
  });

  it('adds elastic and barrier candidates and matches the assembled gradient', () => {
    const { source, group } = simplexSource(2, 4);
    const particles = particlesFrom(source);
    const elastic = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'neo-hookean',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 2.2, shearModulus: 1.6 }
    });
    const barrier = compileSimplexConstitutiveFamilyN({
      id: 'measure-barrier',
      source,
      simplexGroup: group,
      particles,
      law: simplexMeasureBarrierLawN,
      material: {
        minimumMeasureRatio: 0.35,
        activationMeasureRatio: 0.9,
        stiffness: 0.8
      }
    });
    const positions = [
      new VecN([0.01, -0.02, 0, 0.01]),
      new VecN([0.76, 0.03, 0.04, -0.02]),
      new VecN([-0.02, 0.72, -0.03, 0.05])
    ];
    const providers = [elastic, barrier] as const;
    const before = liveSnapshot(particles);
    const evaluated = evaluateXpbdPotentialStateN({
      dimension: 4,
      particles,
      positions,
      providers
    });
    const indices = new Map(particles.map((particle, index) => [particle, index]));
    const elasticOnly = elastic.evaluateAt(
      (particle) => positions[indices.get(particle)!]!
    );
    const barrierOnly = barrier.evaluateAt(
      (particle) => positions[indices.get(particle)!]!
    );

    expect(evaluated.potentialEnergy).toBeCloseTo(
      elasticOnly.potentialEnergy + barrierOnly.potentialEnergy,
      13
    );
    expect(evaluated.providers.map((entry) => entry.provider.id))
      .toEqual(['neo-hookean', 'measure-barrier']);
    expect(evaluated.providers[1]!.evaluation.potentialEnergy).toBeGreaterThan(0);
    expect(evaluated.gradientNorm).toBeGreaterThan(0);
    expect(evaluated.maximumParticleGradientNorm).toBeGreaterThan(0);
    expect(liveSnapshot(particles)).toEqual(before);

    const step = 1e-6;
    for (let vertex = 0; vertex < positions.length; vertex++) {
      for (let axis = 0; axis < 4; axis++) {
        const plus = positions.map((position) => position.clone());
        const minus = positions.map((position) => position.clone());
        plus[vertex]!.data[axis]! += step;
        minus[vertex]!.data[axis]! -= step;
        const plusEnergy = evaluateXpbdPotentialStateN({
          dimension: 4,
          particles,
          positions: plus,
          providers
        }).potentialEnergy;
        const minusEnergy = evaluateXpbdPotentialStateN({
          dimension: 4,
          particles,
          positions: minus,
          providers
        }).potentialEnergy;
        expect(evaluated.gradients[vertex]!.data[axis]).toBeCloseTo(
          (plusEnergy - minusEnergy) / (2 * step),
          6
        );
      }
    }
  });

  it('assembles by identity under particle-order permutation', () => {
    const { source, group } = simplexSource(3, 4);
    const particles = particlesFrom(source);
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'tetrahedron',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 1.8, shearModulus: 2.4 }
    });
    const positions = particles.map((particle, index) => {
      const position = particle.position.clone().multiplyScalar(0.9 + index * 0.03);
      position.data[3] = 0.02 * index;
      return position;
    });
    const canonical = evaluateXpbdPotentialStateN({
      dimension: 4,
      particles,
      positions,
      providers: [family]
    });
    const order = [2, 0, 3, 1];
    const permutedParticles = order.map((index) => particles[index]!);
    const permutedPositions = order.map((index) => positions[index]!);
    const permuted = evaluateXpbdPotentialStateN({
      dimension: 4,
      particles: permutedParticles,
      positions: permutedPositions,
      providers: [family]
    });

    expect(permuted.potentialEnergy).toBeCloseTo(canonical.potentialEnergy, 14);
    for (let output = 0; output < order.length; output++) {
      expectVectorClose(
        permuted.gradients[output]!,
        canonical.gradients[order[output]!]!,
        13
      );
    }
  });

  it('keeps the same candidate contract from R1 through embedded and full R4', () => {
    for (const [simplexDimension, ambientDimension] of [
      [1, 1],
      [2, 4],
      [3, 4],
      [4, 4]
    ] as const) {
      const { source, group } = simplexSource(
        simplexDimension,
        ambientDimension
      );
      const particles = particlesFrom(source);
      const family = compileSimplexStVenantKirchhoffFamilyN({
        id: `law-${simplexDimension}-${ambientDimension}`,
        source,
        simplexGroup: group,
        particles,
        material: { firstLameParameter: 2, shearModulus: 3 }
      });
      const positions = particles.map((particle, index) => {
        const position = particle.position.clone().multiplyScalar(1.05);
        if (ambientDimension > simplexDimension) {
          position.data[ambientDimension - 1] = index * 0.01;
        }
        return position;
      });
      const evaluated = evaluateXpbdPotentialStateN({
        dimension: ambientDimension,
        particles,
        positions,
        providers: [family]
      });
      expect(evaluated.potentialEnergy).toBeGreaterThan(0);
      expect(evaluated.gradients).toHaveLength(simplexDimension + 1);
      expect(evaluated.gradients.every(
        (gradient) => gradient.dim === ambientDimension
      )).toBe(true);
    }
  });

  it('refuses malformed states and conservative-provider evidence', () => {
    const particle = new XpbdParticleN({ id: 'p', position: [0, 0] });
    const foreign = new XpbdParticleN({ id: 'foreign', position: [0, 0] });
    const provider = (
      id: string,
      providerParticles: readonly XpbdParticleN[],
      evaluateAt: XpbdConservativeForceProviderN['evaluateAt'],
      dimension = 2
    ): XpbdConservativeForceProviderN => ({
      id,
      dimension,
      particles: providerParticles,
      evaluate: () => evaluateAt((entry) => entry.position),
      evaluateAt
    });
    const valid = provider('valid', [particle], (positionOf) => {
      const position = positionOf(particle);
      return {
        potentialEnergy: position.lengthSq(),
        forces: [position.multiplyScalar(-2)]
      };
    });
    const options = {
      dimension: 2,
      particles: [particle],
      positions: [new VecN([1, 2])],
      providers: [valid]
    } as const;
    expect(evaluateXpbdPotentialStateN(options).potentialEnergy).toBe(5);
    expect(() => evaluateXpbdPotentialStateN({
      ...options,
      particles: [particle, particle],
      positions: [new VecN(2), new VecN(2)]
    })).toThrow(/identities must be unique/);
    expect(() => evaluateXpbdPotentialStateN({
      ...options,
      positions: [new VecN([1, Number.NaN])]
    })).toThrow(/must be finite/);
    expect(() => evaluateXpbdPotentialStateN({
      ...options,
      providers: [provider('foreign', [foreign], () => ({
        potentialEnergy: 0,
        forces: [new VecN(2)]
      }))]
    })).toThrow(/foreign particle/);
    expect(() => evaluateXpbdPotentialStateN({
      ...options,
      providers: [valid, provider('valid', [particle], valid.evaluateAt)]
    })).toThrow(/duplicate provider id/);
    expect(() => evaluateXpbdPotentialStateN({
      ...options,
      providers: [provider('missing-energy', [particle], () => ({
        forces: [new VecN(2)]
      }) as never)]
    })).toThrow(/potentialEnergy must be finite/);
    expect(() => evaluateXpbdPotentialStateN({
      ...options,
      providers: [provider('bad-force', [particle], () => ({
        potentialEnergy: 0,
        forces: [new VecN([0, Number.POSITIVE_INFINITY])]
      }))]
    })).toThrow(/force 0 must be finite/);
    expect(() => evaluateXpbdPotentialStateN({
      ...options,
      providers: [provider('foreign-query', [particle], (positionOf) => {
        positionOf(foreign);
        return { potentialEnergy: 0, forces: [new VecN(2)] };
      })]
    })).toThrow(/requested a foreign particle/);
  });

  it('retains source-lineage retirement refusal for trial states', () => {
    const { source, group } = simplexSource(1, 1);
    const particles = particlesFrom(source);
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'retired-line',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 2, shearModulus: 1 }
    });
    source.groups.splice(source.groups.indexOf(group), 1);
    expect(() => family.evaluateAt((particle) => particle.position))
      .toThrow(/retired/);
  });
});
