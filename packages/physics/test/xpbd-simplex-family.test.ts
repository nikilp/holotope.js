import {
  CellComplex,
  VecN,
  resolveSourceCellIdN,
  type CellGroup
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdDistanceConstraintN,
  XpbdParticleN,
  XpbdWorldN,
  compileXpbdDistanceNetworkN,
  compileXpbdSimplexMeasureFamilyN
} from '../src/index.js';

function tetraComplex(ambientDimension = 3): CellComplex {
  const coordinates = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];
  const positions = new Float64Array(4 * ambientDimension);
  for (let vertex = 0; vertex < 4; vertex++) {
    for (let axis = 0; axis < Math.min(3, ambientDimension); axis++) {
      positions[vertex * ambientDimension + axis] = coordinates[vertex]![axis]!;
    }
  }
  return new CellComplex(ambientDimension, positions, [
    {
      key: 'tetra-edges',
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([
        0, 1, 0, 2, 0, 3, 1, 2, 1, 3, 2, 3
      ])
    },
    {
      key: 'tetra-volume',
      dim: 3,
      verticesPerCell: 4,
      kind: 'simplex',
      indices: new Uint32Array([0, 1, 2, 3])
    }
  ]);
}

function triangleComplex(dimension: number): CellComplex {
  const positions = new Float64Array(3 * dimension);
  positions[dimension] = 2;
  positions[2 * dimension + 1] = 1;
  return new CellComplex(dimension, positions, [{
    key: 'triangle-area',
    dim: 2,
    verticesPerCell: 3,
    kind: 'simplex',
    indices: new Uint32Array([0, 1, 2])
  }]);
}

function particlesFor(source: CellComplex, prefix = 'particle'): XpbdParticleN[] {
  return Array.from({ length: source.vertexCount }, (_, vertex) =>
    new XpbdParticleN({
      id: `${prefix}/${vertex}`,
      position: source.positions.subarray(
        vertex * source.ambientDim,
        (vertex + 1) * source.ambientDim
      )
    }));
}

describe('CellComplex XPBD simplex-measure families', () => {
  it('compiles a named tetrahedron with source identity and shared point order', () => {
    const source = tetraComplex();
    const particles = particlesFor(source);
    const family = compileXpbdSimplexMeasureFamilyN({
      id: 'solid',
      source,
      simplexGroup: source.cellsOfDim(3)[0]!,
      particles
    });

    expect(family.dimension).toBe(3);
    expect(family.cells).toHaveLength(1);
    expect(family.constraints).toHaveLength(1);
    expect(family.cells[0]!.sourceVertexIndices).toEqual([0, 1, 2, 3]);
    expect(family.cells[0]!.sourceId.groupKey).toBe('tetra-volume');
    expect(family.cells[0]!.sourceId.groupKeyKind).toBe('explicit');
    expect(family.cells[0]!.sourceSquaredMeasure).toBeCloseTo(1 / 36, 14);
    expect(family.cells[0]!.restSquaredMeasure).toBeCloseTo(1 / 36, 14);
    expect(family.constraints[0]!.points).toEqual(particles);
    expect(resolveSourceCellIdN(source, family.cells[0]!.sourceId).kind).toBe(
      'resolved'
    );
  });

  it('specializes identically for a triangle embedded in R2, R3, R4, and R7', () => {
    const records = [2, 3, 4, 7].map((dimension) => {
      const source = triangleComplex(dimension);
      const seen: number[] = [];
      const family = compileXpbdSimplexMeasureFamilyN({
        id: `triangle-r${dimension}`,
        source,
        simplexGroup: source.groups[0]!,
        particles: particlesFor(source, `r${dimension}`),
        restSquaredMeasure: (cell) => {
          expect(Object.isFrozen(cell)).toBe(true);
          expect(Object.isFrozen(cell.sourceId)).toBe(true);
          expect(Object.isFrozen(cell.sourceVertexIndices)).toBe(true);
          seen.push(cell.sourceCellIndex);
          return cell.sourceSquaredMeasure * 0.64;
        },
        compliance: (cell) => cell.simplexDimension * 5e-5
      });
      const evaluated = family.constraints[0]!.evaluate();
      return { family, evaluated, seen };
    });

    for (const record of records) {
      expect(record.seen).toEqual([0]);
      expect(record.family.cells[0]!.sourceSquaredMeasure).toBeCloseTo(1, 14);
      expect(record.family.cells[0]!.restSquaredMeasure).toBeCloseTo(0.64, 14);
      expect(record.family.constraints[0]!.compliance).toBe(1e-4);
      expect(record.evaluated.squaredMeasure).toBeCloseTo(1, 14);
      for (const gradient of record.evaluated.gradients) {
        expect(gradient.data.subarray(2).every((value) => value === 0)).toBe(true);
      }
    }
  });

  it('adds measure constraints onto the exact particles owned by a distance network', () => {
    const source = tetraComplex(4);
    const network = compileXpbdDistanceNetworkN({
      id: 'tetra-network',
      source,
      edgeGroup: source.cellsOfDim(1)[0]!,
      compliance: 1e-5
    });
    const family = compileXpbdSimplexMeasureFamilyN({
      id: 'tetra-measure',
      source,
      simplexGroup: source.cellsOfDim(3)[0]!,
      particles: network.particles,
      compliance: 2e-5
    });
    const world = network.addToWorld(new XpbdWorldN({
      dimension: 4,
      solverIterations: 12
    }));
    family.addToWorld(world);
    family.addToWorld(world);

    expect(world.particles).toEqual(network.particles);
    expect(world.constraints).toHaveLength(network.constraints.length + 1);
    expect(family.constraints[0]!.points[2]).toBe(network.particles[2]);
    network.particles[3]!.applyForce([0.4, -0.2, 0.3, 0.5]);
    const before = network.particles[3]!.position.clone();
    const result = world.step(1 / 60);
    expect(network.particles[3]!.position.equalsApprox(before, 1e-15)).toBe(false);
    expect(result.constraintSolves[0]!.solve.constraints.some(
      (constraint) => constraint.id === family.constraints[0]!.id
    )).toBe(true);
  });

  it('keeps source rest geometry separate from already deformed live particles', () => {
    const source = tetraComplex();
    const particles = particlesFor(source);
    particles[3]!.position.data[2] = 2;
    const sourceRest = compileXpbdSimplexMeasureFamilyN({
      id: 'source-rest',
      source,
      simplexGroup: source.cellsOfDim(3)[0]!,
      particles
    });
    const liveRest = compileXpbdSimplexMeasureFamilyN({
      id: 'live-rest',
      source,
      simplexGroup: source.cellsOfDim(3)[0]!,
      particles,
      restSquaredMeasure: () => sourceRest.constraints[0]!.evaluate().squaredMeasure
    });

    expect(sourceRest.cells[0]!.restSquaredMeasure).toBeCloseTo(1 / 36, 14);
    expect(sourceRest.constraints[0]!.evaluate().squaredMeasure).toBeCloseTo(1 / 9, 14);
    expect(liveRest.cells[0]!.restSquaredMeasure).toBeCloseTo(1 / 9, 14);
  });

  it('survives position and group-order changes but refuses retired source cells', () => {
    const currentSource = tetraComplex();
    const currentParticles = particlesFor(currentSource);
    const currentGroup = currentSource.cellsOfDim(3)[0]!;
    const current = compileXpbdSimplexMeasureFamilyN({
      id: 'current',
      source: currentSource,
      simplexGroup: currentGroup,
      particles: currentParticles
    });
    currentSource.positions[0] = 8;
    currentSource.groups.splice(currentSource.groups.indexOf(currentGroup), 1);
    currentSource.groups.unshift(currentGroup);
    const currentWorld = new XpbdWorldN({ dimension: 3 });
    for (const particle of currentParticles) currentWorld.addParticle(particle);
    current.addToWorld(currentWorld);
    expect(currentWorld.constraints).toHaveLength(1);

    const mutations: Array<(source: CellComplex, group: CellGroup) => void> = [
      (source, group) => source.groups.splice(source.groups.indexOf(group), 1),
      (_source, group) => { group.indices = new Uint32Array([0, 2, 1, 3]); },
      (_source, group) => { group.kind = 'cuboid'; },
      (_source, group) => { group.key = 'replacement'; },
      (source, group) => source.groups.push({
        key: group.key,
        dim: 3,
        verticesPerCell: 4,
        kind: 'simplex',
        indices: new Uint32Array([0, 1, 2, 3])
      })
    ];
    for (const mutate of mutations) {
      const source = tetraComplex();
      const particles = particlesFor(source);
      const group = source.cellsOfDim(3)[0]!;
      const family = compileXpbdSimplexMeasureFamilyN({
        id: 'retired', source, simplexGroup: group, particles
      });
      const world = new XpbdWorldN({ dimension: 3 });
      for (const particle of particles) world.addParticle(particle);
      mutate(source, group);
      expect(() => family.addToWorld(world)).toThrow(/source cell/);
      expect(world.constraints).toHaveLength(0);
    }
  });

  it('preflights particle ownership and constraint ids atomically', () => {
    const source = tetraComplex();
    const particles = particlesFor(source, 'owned');
    const family = compileXpbdSimplexMeasureFamilyN({
      id: 'attach',
      source,
      simplexGroup: source.cellsOfDim(3)[0]!,
      particles
    });
    const empty = new XpbdWorldN({ dimension: 3 });
    expect(() => family.addToWorld(empty)).toThrow(/not registered/);
    expect(empty.constraints).toHaveLength(0);

    const wrongDimension = new XpbdWorldN({ dimension: 4 });
    expect(() => family.addToWorld(wrongDimension)).toThrow(/world is R4/);

    const foreign = new XpbdWorldN({ dimension: 3 });
    for (let index = 0; index < particles.length; index++) {
      foreign.addParticle(new XpbdParticleN({
        id: particles[index]!.id,
        position: particles[index]!.position
      }));
    }
    expect(() => family.addToWorld(foreign)).toThrow(/owned by another object/);
    expect(foreign.constraints).toHaveLength(0);

    const collision = new XpbdWorldN({ dimension: 3 });
    for (const particle of particles) collision.addParticle(particle);
    collision.addConstraint(new XpbdDistanceConstraintN({
      id: family.constraints[0]!.id,
      pointA: particles[0]!,
      pointB: particles[1]!,
      restLength: 1
    }));
    expect(() => family.addToWorld(collision)).toThrow(/already owned/);
    expect(collision.constraints).toHaveLength(1);

    const valid = new XpbdWorldN({ dimension: 3 });
    for (const particle of particles) valid.addParticle(particle);
    family.addToWorld(valid);
    expect(() => family.addToWorld(new XpbdWorldN({ dimension: 3 }))).toThrow(
      /another world/
    );
  });

  it('rejects malformed cells, particle bindings, and material policies', () => {
    const source = tetraComplex();
    const group = source.cellsOfDim(3)[0]!;
    const particles = particlesFor(source);
    const compile = (
      candidateSource = source,
      candidateGroup = group,
      candidateParticles = particles
    ): unknown => compileXpbdSimplexMeasureFamilyN({
      id: 'invalid',
      source: candidateSource,
      simplexGroup: candidateGroup,
      particles: candidateParticles
    });

    expect(() => compile(source, triangleComplex(3).groups[0]!)).toThrow(/belong/);
    group.kind = 'cuboid';
    expect(() => compile()).toThrow(/simplices/);
    group.kind = 'simplex';
    group.verticesPerCell = 3;
    expect(() => compile()).toThrow(/dim \+ 1/);
    group.verticesPerCell = 4;
    group.indices = new Uint32Array([0, 1, 1, 3]);
    expect(() => compile()).toThrow(/repeats/);
    group.indices = new Uint32Array([0, 1, 2, 9]);
    expect(() => compile()).toThrow(/out of range/);

    const degenerate = tetraComplex();
    degenerate.positions.set(degenerate.positions.subarray(0, 3), 9);
    expect(() => compile(
      degenerate,
      degenerate.cellsOfDim(3)[0]!,
      particlesFor(degenerate)
    )).toThrow(/degenerate/);

    const clean = tetraComplex();
    const cleanParticles = particlesFor(clean);
    expect(() => compileXpbdSimplexMeasureFamilyN({
      id: 'short',
      source: clean,
      simplexGroup: clean.cellsOfDim(3)[0]!,
      particles: cleanParticles.slice(1)
    })).toThrow(/vertex count/);
    expect(() => compileXpbdSimplexMeasureFamilyN({
      id: 'duplicate',
      source: clean,
      simplexGroup: clean.cellsOfDim(3)[0]!,
      particles: [
        cleanParticles[0]!,
        cleanParticles[0]!,
        cleanParticles[2]!,
        cleanParticles[3]!
      ]
    })).toThrow(/identities/);
    expect(() => compileXpbdSimplexMeasureFamilyN({
      id: 'rest',
      source: clean,
      simplexGroup: clean.cellsOfDim(3)[0]!,
      particles: cleanParticles,
      restSquaredMeasure: -1
    })).toThrow(/restSquaredMeasure/);
    expect(() => compileXpbdSimplexMeasureFamilyN({
      id: 'compliance',
      source: clean,
      simplexGroup: clean.cellsOfDim(3)[0]!,
      particles: cleanParticles,
      compliance: Number.NaN
    })).toThrow(/compliance/);
  });
});
