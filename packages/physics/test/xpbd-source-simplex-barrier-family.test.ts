import {
  CellComplex,
  VecN,
  projectPointToSourceSimplexN,
  type CellGroup
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleSourceSimplexBarrierN,
  XpbdWorldN,
  compileXpbdIncrementalPotentialProblemN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  searchXpbdIncrementalPotentialArmijoN,
  type XpbdParticleN
} from '../src/index.js';

function dynamicSource(
  dimension: number,
  positions: readonly (readonly number[])[]
) {
  const source = new CellComplex(
    dimension,
    Float64Array.from(positions.flat()),
    []
  );
  return {
    source,
    binding: compileXpbdParticleBindingN({ id: 'dynamic', source })
  };
}

function simplexObstacle(
  dimension: number,
  vertices: readonly (readonly number[])[]
): { readonly obstacle: CellComplex; readonly group: CellGroup } {
  const group: CellGroup = {
    key: 'obstacle-simplices',
    dim: vertices.length - 1,
    verticesPerCell: vertices.length,
    kind: 'simplex',
    indices: Uint32Array.from(vertices.map((_, index) => index))
  };
  return {
    obstacle: new CellComplex(
      dimension,
      Float64Array.from(vertices.flat()),
      [group]
    ),
    group
  };
}

function simplexStrip(
  dimension: number,
  simplexDimension: number,
  count: number,
  spacing: number
): { readonly obstacle: CellComplex; readonly group: CellGroup } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let cell = 0; cell < count; cell++) {
    for (let vertex = 0; vertex <= simplexDimension; vertex++) {
      const point = new Array<number>(dimension).fill(0);
      point[0] = cell * spacing;
      if (vertex > 0) point[vertex - 1]! += 0.7;
      positions.push(...point);
      indices.push(cell * (simplexDimension + 1) + vertex);
    }
  }
  const group: CellGroup = {
    key: 'strip',
    dim: simplexDimension,
    verticesPerCell: simplexDimension + 1,
    kind: 'simplex',
    indices: Uint32Array.from(indices)
  };
  return {
    obstacle: new CellComplex(dimension, Float64Array.from(positions), [group]),
    group
  };
}

function familyFixture(
  dynamicPositions: readonly (readonly number[])[],
  options: { minimumDistance?: number; activationDistance?: number } = {}
) {
  const dynamic = dynamicSource(4, dynamicPositions);
  const obstacle = simplexObstacle(4, [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0]
  ]);
  const family = compileXpbdParticleSourceSimplexBarrierFamilyN({
    maximumDirectionError: 2 ** -12,
    id: 'mesh-contact',
    binding: dynamic.binding,
    obstacle: obstacle.obstacle,
    simplexGroup: obstacle.group,
    minimumDistance: options.minimumDistance ?? 0.05,
    activationDistance: options.activationDistance ?? 0.8,
    stiffness: 1.7
  });
  return { ...dynamic, ...obstacle, family };
}

function stepContext(
  before: readonly VecN[],
  after: readonly VecN[],
  particles: readonly XpbdParticleN[],
  requestedStepLength = 1
) {
  const indices = new Map(particles.map((particle, index) => [particle, index]));
  return {
    dimension: before[0]!.dim,
    requestedStepLength,
    positionBefore: (particle: XpbdParticleN) =>
      before[indices.get(particle)!]!,
    positionAfter: (particle: XpbdParticleN) =>
      after[indices.get(particle)!]!
  };
}

function expectVector(actual: VecN, expected: VecN, digits = 11): void {
  for (let axis = 0; axis < actual.dim; axis++) {
    expect(actual.data[axis]!).toBeCloseTo(expected.data[axis]!, digits);
  }
}

describe('source-indexed point--simplex candidate family', () => {
  it('culls a bounded R4 scene while preserving stable source identities', () => {
    const dynamic = dynamicSource(4, Array.from({ length: 12 }, (_, index) => {
      const cell = (index * 5) % 32;
      return [cell * 3 + 0.15, 0.15, 0.15, 0.3];
    }));
    const obstacle = simplexStrip(4, 3, 32, 3);
    const family = compileXpbdParticleSourceSimplexBarrierFamilyN({
      maximumDirectionError: 2 ** -12,
      id: 'bounded',
      binding: dynamic.binding,
      obstacle: obstacle.obstacle,
      simplexGroup: obstacle.group,
      activationDistance: 0.35,
      stiffness: 1
    });

    const first = family.queryAt((particle) => particle.position);
    const second = family.queryAt((particle) => particle.position);
    expect(first.diagnostics).toMatchObject({
      provider: 'exhaustive-swept-aabb',
      sourceVertexCount: 12,
      obstacleSimplexCount: 32,
      possiblePairs: 384
    });
    expect(first.diagnostics.candidatePairs).toBe(12);
    expect(first.diagnostics.rejectedPairs).toBe(
      384 - first.diagnostics.candidatePairs
    );
    expect(second.candidates.map(({ id }) => id))
      .toEqual(first.candidates.map(({ id }) => id));
    for (const candidate of first.candidates) {
      expect(candidate.particle).toBe(
        dynamic.binding.particleForSourceVertex(candidate.sourceVertexIndex)
      );
      expect(candidate.simplex).toBe(family.simplices[candidate.obstacleCellIndex]);
    }
  });

  it('matches the sum of individually authored P44 barriers', () => {
    const fixture = familyFixture([
      [0.2, 0.2, 0.2, 0.3],
      [5, 5, 5, 5]
    ]);
    const evaluated = fixture.family.evaluate();
    const candidate = evaluated.activeCandidates[0]!;
    const direct = new XpbdParticleSourceSimplexBarrierN({
      maximumDirectionError: 2 ** -12,
      id: 'direct',
      particle: fixture.binding.particles[0]!,
      simplex: fixture.family.simplices[0]!,
      minimumDistance: 0.05,
      activationDistance: 0.8,
      stiffness: 1.7
    }).evaluate();

    expect(evaluated.candidateQuery.diagnostics.possiblePairs).toBe(2);
    expect(evaluated.candidateQuery.diagnostics.candidatePairs).toBe(1);
    expect(evaluated.activeCandidates).toHaveLength(1);
    expect(candidate.candidate.id).toBe(
      'mesh-contact/source-vertex/0/obstacle-cell/0'
    );
    expect(candidate.evaluation.projection.coordinate.reference)
      .toBe(fixture.family.simplices[0]);
    expect(evaluated.potentialEnergy).toBeCloseTo(direct.potentialEnergy, 13);
    expectVector(evaluated.forces[0]!, direct.forces[0], 12);
    expectVector(evaluated.forces[1]!, new VecN(4), 13);
  });

  it('never culls an exactly active point from R2 through R7', () => {
    let state = 0x8b51f17d;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let dimension = 2; dimension <= 7; dimension++) {
      const simplexDimension = Math.min(dimension, 3);
      const obstacle = simplexStrip(dimension, simplexDimension, 7, 3);
      const positions = Array.from({ length: 18 }, () =>
        Array.from({ length: dimension }, () => random() * 24 - 2)
      );
      const dynamic = dynamicSource(dimension, positions);
      const family = compileXpbdParticleSourceSimplexBarrierFamilyN({
        maximumDirectionError: 2 ** -12,
        id: `r${dimension}`,
        binding: dynamic.binding,
        obstacle: obstacle.obstacle,
        simplexGroup: obstacle.group,
        activationDistance: 0.6,
        stiffness: 1
      });
      const query = family.queryAt((particle) => particle.position);
      const candidateIds = new Set(query.candidates.map(({ id }) => id));
      for (let vertex = 0; vertex < dynamic.binding.particles.length; vertex++) {
        const point = dynamic.binding.particles[vertex]!.position;
        for (let cell = 0; cell < family.simplices.length; cell++) {
          const distance = Math.sqrt(projectPointToSourceSimplexN(
            family.simplices[cell]!, point.data
          ).squaredDistance);
          if (distance <= family.activationDistance) {
            expect(candidateIds.has(
              `r${dimension}/source-vertex/${vertex}/obstacle-cell/${cell}`
            )).toBe(true);
          }
        }
      }
    }
  });

  it('retains every segment pair that becomes active under dense sampling', () => {
    const dynamic = dynamicSource(4, [
      [0.2, 0.2, 0.2, 0.9],
      [12.2, 0.2, 0.2, 0.9],
      [30, 8, 4, 2]
    ]);
    const obstacle = simplexStrip(4, 3, 12, 3);
    const family = compileXpbdParticleSourceSimplexBarrierFamilyN({
      maximumDirectionError: 2 ** -12,
      id: 'swept',
      binding: dynamic.binding,
      obstacle: obstacle.obstacle,
      simplexGroup: obstacle.group,
      minimumDistance: 0.05,
      activationDistance: 0.3,
      stiffness: 1
    });
    const before = dynamic.binding.particles.map((particle) => particle.position.clone());
    const after = [
      new VecN([0.2, 0.2, 0.2, -0.9]),
      new VecN([12.2, 0.2, 0.2, -0.9]),
      new VecN([31, 8, 4, 2])
    ];
    const filtered = family.stepFilter.evaluate(stepContext(
      before,
      after,
      dynamic.binding.particles
    ));
    const candidates = new Set(
      filtered.candidateQuery.candidates.map(({ id }) => id)
    );
    for (let vertex = 0; vertex < before.length; vertex++) {
      for (let cell = 0; cell < family.simplices.length; cell++) {
        let active = false;
        for (let sample = 0; sample <= 128; sample++) {
          const point = before[vertex]!.clone().add(
            after[vertex]!.clone().sub(before[vertex]!).multiplyScalar(sample / 128)
          );
          const distance = Math.sqrt(projectPointToSourceSimplexN(
            family.simplices[cell]!, point.data
          ).squaredDistance);
          active ||= distance <= family.activationDistance;
        }
        if (active) {
          expect(candidates.has(
            `swept/source-vertex/${vertex}/obstacle-cell/${cell}`
          )).toBe(true);
        }
      }
    }
  });

  it('aggregates the most restrictive pair filter and names the blocker', () => {
    const fixture = familyFixture([
      [0.2, 0.2, 0.2, 0.5],
      [5, 5, 5, 5]
    ]);
    const before = fixture.binding.particles.map((particle) => particle.position.clone());
    const after = [new VecN([0.2, 0.2, 0.2, -0.5]), new VecN([5, 5, 5, 5])];
    const evaluated = fixture.family.stepFilter.evaluate(stepContext(
      before,
      after,
      fixture.binding.particles,
      2
    ));

    expect(evaluated).toMatchObject({
      status: 'limited',
      blockingCandidateId: 'mesh-contact/source-vertex/0/obstacle-cell/0',
      candidateQuery: { scope: 'segment' }
    });
    expect(evaluated.status === 'limited' && evaluated.maximumStepLength)
      .toBeCloseTo(0.81, 14);
    expect(evaluated.candidates).toHaveLength(1);
    expect(evaluated.candidates[0]!.evaluation).toMatchObject({
      status: 'limited',
      certification: 'global-lipschitz'
    });
  });

  it('keeps initial-domain failure an indeterminate candidate refusal', () => {
    const fixture = familyFixture([[0.2, 0.2, 0.2, 0.04]]);
    const before = [new VecN([0.2, 0.2, 0.2, 0.04])];
    const after = [new VecN([0.2, 0.2, 0.2, 0.4])];
    const evaluated = fixture.family.stepFilter.evaluate(stepContext(
      before,
      after,
      fixture.binding.particles
    ));

    expect(evaluated).toMatchObject({
      status: 'indeterminate',
      reason: 'candidate-initial-domain-violation',
      blockingCandidateId: 'mesh-contact/source-vertex/0/obstacle-cell/0'
    });
    expect(() => fixture.family.evaluate()).toThrow(/distance must be greater/);
  });

  it('composes one dynamic provider and filter into Armijo search', () => {
    const fixture = familyFixture([[0.2, 0.2, 0.2, 0.5]]);
    const terms = fixture.family.incrementalPotentialTerms();
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 4,
      particles: fixture.binding.particles,
      predictedPositions: [new VecN([0.2, 0.2, 0.2, -0.5])],
      deltaTime: 0.1,
      ...terms
    });
    const result = searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [0.2, 0.2, 0.2, 0.5],
      direction: [0, 0, 0, -1]
    });

    expect(result.status).toBe('accepted');
    expect(result.stepFilters[0]).toMatchObject({
      filterId: 'mesh-contact/step-filter',
      evaluation: {
        status: 'limited',
        blockingCandidateId: 'mesh-contact/source-vertex/0/obstacle-cell/0'
      }
    });
    if (result.status === 'accepted') expect(result.stepLength).toBeLessThan(0.5);
  });

  it('fails fast on scope, topology, dimensions, options, and retired cells', () => {
    const fixture = familyFixture([[0.2, 0.2, 0.2, 0.5]]);
    expect(() => compileXpbdParticleSourceSimplexBarrierFamilyN({
      maximumDirectionError: 2 ** -12,
      id: 'self',
      binding: fixture.binding,
      obstacle: fixture.source,
      simplexGroup: fixture.group,
      activationDistance: 1,
      stiffness: 1
    })).toThrow(/separate.*self-contact/);
    expect(() => compileXpbdParticleSourceSimplexBarrierFamilyN({
      maximumDirectionError: 2 ** -12,
      id: 'wrong-dimension',
      binding: dynamicSource(3, [[0, 0, 0]]).binding,
      obstacle: fixture.obstacle,
      simplexGroup: fixture.group,
      activationDistance: 1,
      stiffness: 1
    })).toThrow(/R3.*R4/);
    expect(() => compileXpbdParticleSourceSimplexBarrierFamilyN({
      id: 'typo',
      binding: fixture.binding,
      obstacle: fixture.obstacle,
      simplexGroup: fixture.group,
      activationDistance: 1,
      stiffness: 1,
      maximumDirectionError: 2 ** -12,
      typo: true
    } as never)).toThrow(/unknown option "typo"/);
    fixture.group.indices[0] = 1;
    expect(() => fixture.family.queryAt((particle) => particle.position))
      .toThrow(/retired/);
  });

  it('registers as one world provider without owning the particle lifecycle', () => {
    const fixture = familyFixture([[0.2, 0.2, 0.2, 0.3]]);
    const world = new XpbdWorldN({ dimension: 4 });
    expect(() => fixture.family.addToWorld(world)).toThrow(/not registered/);
    fixture.binding.addToWorld(world);
    fixture.family.addToWorld(world);
    expect(world.forceProviders).toContain(fixture.family);
    expect(world.forceProviders).toHaveLength(1);
  });
});
