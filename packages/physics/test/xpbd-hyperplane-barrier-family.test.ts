import { CellComplex, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneBarrierN,
  XpbdParticleN,
  XpbdWorldN,
  compileXpbdIncrementalPotentialProblemN,
  compileXpbdParticleBindingN,
  compileXpbdParticleHyperplaneBarrierFamilyN,
  compileXpbdParticleHyperplaneFamilyN,
  evaluateXpbdPotentialStateN,
  searchXpbdIncrementalPotentialArmijoN,
  stepXpbdIncrementalPotentialN
} from '../src/index.js';

function pointSource(
  dimension: number,
  distances = [0.5, 0.8, 1.1]
): CellComplex {
  const positions = new Float64Array(distances.length * dimension);
  const axis = dimension - 1;
  for (let vertex = 0; vertex < distances.length; vertex++) {
    positions[vertex * dimension + axis] = distances[vertex]!;
    if (dimension > 1) positions[vertex * dimension] = 0.2 * vertex;
  }
  return new CellComplex(dimension, positions);
}

function compileFamily(
  dimension: number,
  distances = [0.5, 0.8, 1.1]
) {
  const source = pointSource(dimension, distances);
  const binding = compileXpbdParticleBindingN({
    id: `binding-r${dimension}`,
    source
  });
  const normalFamily = compileXpbdParticleHyperplaneFamilyN({
    id: `normal-r${dimension}`,
    source,
    particles: binding.particles,
    plane: new HyperplaneColliderN(
      VecN.basis(dimension, dimension - 1),
      0
    ),
    clearance: (vertex) => 0.1 * vertex.sourceVertexIndex
  });
  const family = compileXpbdParticleHyperplaneBarrierFamilyN({
    id: `barrier-r${dimension}`,
    contacts: normalFamily,
    activationDistance: (vertex) => vertex.minimumDistance + 1,
    stiffness: (vertex) => vertex.sourceVertexIndex + 1,
    conservativeScale: (vertex) => 0.9 - 0.1 * vertex.sourceVertexIndex
  });
  return { source, binding, normalFamily, family };
}

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 13
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]).toBeCloseTo(expected[index]!, digits);
  }
}

describe('source-indexed particle-hyperplane barrier families', () => {
  it('retains exact source ordinals and particle identity from R1 through R7', () => {
    for (const dimension of [1, 2, 4, 7]) {
      const { binding, normalFamily, family } = compileFamily(dimension);

      expect(family.dimension).toBe(dimension);
      expect(family.normalFamily).toBe(normalFamily);
      expect(family.particles).toBe(normalFamily.particles);
      expect(family.vertices.map((vertex) => vertex.sourceVertexIndex))
        .toEqual([0, 1, 2]);
      expect(family.vertices.map((vertex) => vertex.minimumDistance))
        .toEqual([0, 0.1, 0.2]);
      expectArrayClose(
        family.vertices.map((vertex) => vertex.sourceMargin),
        [0.5, 0.7, 0.9]
      );
      expect(family.barriers.map((provider) => provider.id)).toEqual([
        `barrier-r${dimension}/vertex/0/barrier`,
        `barrier-r${dimension}/vertex/1/barrier`,
        `barrier-r${dimension}/vertex/2/barrier`
      ]);
      expect(family.stepFilters.map((filter) => filter.id)).toEqual([
        `barrier-r${dimension}/vertex/0/step-filter`,
        `barrier-r${dimension}/vertex/1/step-filter`,
        `barrier-r${dimension}/vertex/2/step-filter`
      ]);
      for (let vertex = 0; vertex < family.vertices.length; vertex++) {
        const entry = family.vertices[vertex]!;
        expect(entry.particle).toBe(binding.particles[vertex]);
        expect(entry.normalContact).toBe(normalFamily.contacts[vertex]);
        expect(entry.barrier.particle).toBe(binding.particles[vertex]);
        expect(entry.stepFilter.barrier).toBe(entry.barrier);
      }
      const terms = family.incrementalPotentialTerms();
      expect(terms.providers).toBe(family.barriers);
      expect(terms.stepFilters).toBe(family.stepFilters);
      expect(Object.isFrozen(terms)).toBe(true);

      const second = compileXpbdParticleHyperplaneBarrierFamilyN({
        id: `second-r${dimension}`,
        contacts: normalFamily,
        activationDistance: (vertex) => vertex.minimumDistance + 2,
        stiffness: 0.5
      });
      const composed = second.incrementalPotentialTerms(terms);
      expect(composed.providers).toEqual([
        ...family.barriers,
        ...second.barriers
      ]);
      expect(composed.stepFilters).toEqual([
        ...family.stepFilters,
        ...second.stepFilters
      ]);
      expect(terms.providers).toBe(family.barriers);
      expect(terms.stepFilters).toBe(family.stepFilters);
    }
  });

  it('isolates callback mutation from source and subsequent policies', () => {
    const source = pointSource(4);
    const sourceBefore = source.positions.slice();
    const binding = compileXpbdParticleBindingN({ id: 'isolated', source });
    const normalFamily = compileXpbdParticleHyperplaneFamilyN({
      id: 'isolated-normal',
      source,
      particles: binding.particles,
      plane: new HyperplaneColliderN([0, 0, 0, 1]),
      clearance: 0.1
    });
    const observedStiffnessPositions: number[][] = [];
    const family = compileXpbdParticleHyperplaneBarrierFamilyN({
      id: 'isolated-barrier',
      contacts: normalFamily,
      activationDistance: (vertex) => {
        vertex.sourcePosition.data.fill(99);
        return vertex.minimumDistance + 0.5;
      },
      stiffness: (vertex) => {
        observedStiffnessPositions.push(vertex.sourcePosition.toArray());
        vertex.sourcePosition.data.fill(-77);
        return vertex.sourceVertexIndex + 1;
      },
      conservativeScale: (vertex) => {
        expect(vertex.sourcePosition.toArray())
          .toEqual(normalFamily.contacts[vertex.sourceVertexIndex]!
            .sourcePosition.toArray());
        return 0.8;
      }
    });

    expect(source.positions).toEqual(sourceBefore);
    expect(observedStiffnessPositions).toEqual(
      normalFamily.contacts.map((contact) => contact.sourcePosition.toArray())
    );
    expect(family.vertices.map((vertex) => vertex.sourcePosition.toArray()))
      .toEqual(
        normalFamily.contacts.map((contact) => contact.sourcePosition.toArray())
      );
  });

  it('matches explicit candidate-state barrier assembly without mutation', () => {
    const { binding, family } = compileFamily(4);
    const candidates = binding.particles.map((particle, index) => {
      const candidate = particle.position.clone();
      candidate.data[3] = 0.35 + 0.15 * index;
      return candidate;
    });
    const liveBefore = binding.particles.map(
      (particle) => particle.position.toArray()
    );
    const candidateBefore = candidates.map((value) => value.toArray());
    const terms = family.incrementalPotentialTerms();
    const assembled = evaluateXpbdPotentialStateN({
      dimension: 4,
      particles: binding.particles,
      positions: candidates,
      providers: terms.providers
    });
    let expectedEnergy = 0;
    const expectedGradient = binding.particles.map(() => new VecN(4));
    for (let vertex = 0; vertex < family.barriers.length; vertex++) {
      const evaluated = family.barriers[vertex]!.evaluateAt(
        () => candidates[vertex]!
      );
      expectedEnergy += evaluated.potentialEnergy;
      expectedGradient[vertex]!.sub(evaluated.forces[0]);
    }

    expect(assembled.potentialEnergy).toBeCloseTo(expectedEnergy, 13);
    for (let vertex = 0; vertex < expectedGradient.length; vertex++) {
      expectArrayClose(
        assembled.gradients[vertex]!.data,
        expectedGradient[vertex]!.data
      );
    }
    expect(binding.particles.map((particle) => particle.position.toArray()))
      .toEqual(liveBefore);
    expect(candidates.map((value) => value.toArray()))
      .toEqual(candidateBefore);
  });

  it('lets the most restrictive source vertex cap the Armijo segment', () => {
    const source = pointSource(1, [0.5, 0.8]);
    const binding = compileXpbdParticleBindingN({ id: 'search', source });
    const normalFamily = compileXpbdParticleHyperplaneFamilyN({
      id: 'search-normal',
      source,
      particles: binding.particles,
      plane: new HyperplaneColliderN([1]),
      clearance: (vertex) => vertex.sourceVertexIndex === 0 ? 0.1 : 0.6
    });
    const family = compileXpbdParticleHyperplaneBarrierFamilyN({
      id: 'search-barriers',
      contacts: normalFamily,
      activationDistance: (vertex) => vertex.minimumDistance + 0.8,
      stiffness: 1e-3,
      conservativeScale: (vertex) =>
        vertex.sourceVertexIndex === 0 ? 0.9 : 0.5
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 1,
      particles: binding.particles,
      predictedPositions: [new VecN([0]), new VecN([0])],
      deltaTime: 0.1,
      ...family.incrementalPotentialTerms()
    });
    const search = searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [0.5, 0.8],
      direction: [-0.6, -0.6]
    });

    expect(search.status).toBe('accepted');
    if (search.status !== 'accepted') return;
    expect(search.stepFilters.map((entry) => entry.filterId)).toEqual([
      'search-barriers/vertex/0/step-filter',
      'search-barriers/vertex/1/step-filter'
    ]);
    expect(search.stepLength).toBeCloseTo(1 / 6, 14);
    expect(search.stepFilters[1]!.evaluation).toMatchObject({
      status: 'limited'
    });
  });

  it('spreads paired terms through the atomic step and retains rollback', () => {
    const source = pointSource(1, [0.5, 0.8]);
    const binding = compileXpbdParticleBindingN({ id: 'step', source });
    binding.particles[0]!.applyForce([-60]);
    binding.particles[1]!.applyForce([-80]);
    const normalFamily = compileXpbdParticleHyperplaneFamilyN({
      id: 'step-normal',
      source,
      particles: binding.particles,
      plane: new HyperplaneColliderN([1]),
      clearance: 0.1
    });
    const family = compileXpbdParticleHyperplaneBarrierFamilyN({
      id: 'step-barriers',
      contacts: normalFamily,
      activationDistance: 0.9,
      stiffness: 1e-3
    });
    const before = binding.particles.map((particle) => ({
      position: particle.position.toArray(),
      velocity: particle.velocity.toArray(),
      force: particle.force.toArray()
    }));
    const result = stepXpbdIncrementalPotentialN({
      dimension: 1,
      particles: binding.particles,
      ...family.incrementalPotentialTerms(),
      deltaTime: 0.1,
      initialPositions: [new VecN([0.5]), new VecN([0.8])],
      minimization: { maximumIterations: 1 }
    });

    expect(result).toMatchObject({
      status: 'refused',
      stage: 'minimization',
      reason: 'not-converged',
      minimization: { status: 'iteration-limit' }
    });
    expect(result.problem.providers).toEqual(family.barriers);
    expect(result.problem.stepFilters).toEqual(family.stepFilters);
    expect(result.minimization.iterations[0]!.search.stepFilters).toHaveLength(2);
    expect(binding.particles.map((particle) => ({
      position: particle.position.toArray(),
      velocity: particle.velocity.toArray(),
      force: particle.force.toArray()
    }))).toEqual(before);
  });

  it('attaches providers atomically and idempotently to one RN world', () => {
    const { binding, family } = compileFamily(4, [0.25, 0.4, 0.7]);
    const missing = new XpbdWorldN({ dimension: 4 });
    expect(() => family.addToWorld(missing)).toThrow(/not registered/);
    expect(missing.forceProviders).toHaveLength(0);
    expect(() => family.addToWorld(new XpbdWorldN({ dimension: 3 })))
      .toThrow(/world is R3/);

    const world = binding.addToWorld(new XpbdWorldN({ dimension: 4 }));
    const before = binding.particles.map(
      (particle) => particle.position.data[3]!
    );
    family.addToWorld(world);
    family.addToWorld(world);
    expect(world.forceProviders).toEqual(family.barriers);
    world.step(0.01);
    for (let vertex = 0; vertex < binding.particles.length; vertex++) {
      expect(binding.particles[vertex]!.position.data[3])
        .toBeGreaterThan(before[vertex]!);
    }
    const another = new XpbdWorldN({ dimension: 4 });
    for (const particle of binding.particles) another.addParticle(particle);
    expect(() => family.addToWorld(another)).toThrow(/another world/);
  });

  it('preflights foreign particles and provider-ID collisions', () => {
    const { binding, family } = compileFamily(2);
    const foreign = new XpbdWorldN({ dimension: 2 });
    for (const particle of binding.particles) {
      foreign.addParticle(new XpbdParticleN({
        id: particle.id,
        position: particle.position
      }));
    }
    expect(() => family.addToWorld(foreign)).toThrow(/owned by another object/);
    expect(foreign.forceProviders).toHaveLength(0);

    const collisionWorld = binding.addToWorld(
      new XpbdWorldN({ dimension: 2 })
    );
    collisionWorld.addForceProvider(new XpbdParticleHyperplaneBarrierN({
      id: family.barriers[1]!.id,
      particle: binding.particles[1]!,
      plane: family.normalFamily.plane,
      minimumDistance: 0.1,
      activationDistance: 1,
      stiffness: 1
    }));
    expect(() => family.addToWorld(collisionWorld)).toThrow(/already owned/);
    expect(collisionWorld.forceProviders).toHaveLength(1);
  });

  it('rejects malformed policies and changed source layouts', () => {
    const { source, normalFamily, family } = compileFamily(4);
    expect(() => compileXpbdParticleHyperplaneBarrierFamilyN({
      id: '',
      contacts: normalFamily,
      activationDistance: 1,
      stiffness: 1
    })).toThrow(/id/);
    expect(() => compileXpbdParticleHyperplaneBarrierFamilyN({
      id: 'not-contacts',
      contacts: {} as never,
      activationDistance: 1,
      stiffness: 1
    })).toThrow(/contacts/);
    expect(() => compileXpbdParticleHyperplaneBarrierFamilyN({
      id: 'activation',
      contacts: normalFamily,
      activationDistance: 0.1,
      stiffness: 1
    })).toThrow(/activationDistance/);
    expect(() => compileXpbdParticleHyperplaneBarrierFamilyN({
      id: 'stiffness',
      contacts: normalFamily,
      activationDistance: 1,
      stiffness: 0
    })).toThrow(/stiffness/);
    expect(() => compileXpbdParticleHyperplaneBarrierFamilyN({
      id: 'scale',
      contacts: normalFamily,
      activationDistance: 1,
      stiffness: 1,
      conservativeScale: 1
    })).toThrow(/conservativeScale/);
    expect(() => compileXpbdParticleHyperplaneBarrierFamilyN({
      id: 'nan',
      contacts: normalFamily,
      activationDistance: () => Number.NaN,
      stiffness: 1
    })).toThrow(/finite/);

    source.positions = new Float64Array(4);
    expect(() => family.incrementalPotentialTerms())
      .toThrow(/layout changed/);
    const world = new XpbdWorldN({ dimension: 4 });
    for (const particle of family.particles) world.addParticle(particle);
    expect(() => family.addToWorld(world)).toThrow(/layout changed/);
    expect(world.forceProviders).toHaveLength(0);

    const current = compileFamily(2).family;
    expect(() => current.incrementalPotentialTerms({} as never))
      .toThrow(/base terms/);
  });

  it('is deterministic across equivalent source bindings', () => {
    const summarize = () => {
      const { family } = compileFamily(4);
      return family.vertices.map((vertex) => ({
        sourceVertexIndex: vertex.sourceVertexIndex,
        sourcePosition: vertex.sourcePosition.toArray(),
        sourceSignedDistance: vertex.sourceSignedDistance,
        minimumDistance: vertex.minimumDistance,
        sourceMargin: vertex.sourceMargin,
        activationDistance: vertex.activationDistance,
        stiffness: vertex.stiffness,
        conservativeScale: vertex.conservativeScale,
        barrierId: vertex.barrier.id,
        stepFilterId: vertex.stepFilter.id
      }));
    };
    expect(summarize()).toEqual(summarize());
  });
});
