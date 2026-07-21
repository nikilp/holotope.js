import {
  MatN,
  VecN,
  createHypercube,
  resolveSourceCellIdN,
  type CellComplex,
  type CellGroup
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdDistanceConstraintN,
  XpbdParticleN,
  XpbdWorldN,
  compileXpbdDistanceNetworkN,
  compileXpbdOrientedCuboidFamilyN
} from '../src/index.js';

function fullCube(dimension: number): { source: CellComplex; group: CellGroup } {
  const source = createHypercube({
    dim: dimension,
    size: 1,
    maxCellDimension: dimension
  });
  const group = source.cellsOfDim(dimension)[0]!;
  group.key = `r${dimension}-volume-cells`;
  return { source, group };
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

function permutationSign(permutation: readonly number[]): number {
  let inversions = 0;
  for (let left = 0; left < permutation.length; left++) {
    for (let right = left + 1; right < permutation.length; right++) {
      if (permutation[left]! > permutation[right]!) inversions++;
    }
  }
  return inversions % 2 === 0 ? 1 : -1;
}

describe('CellComplex XPBD oriented cuboid families', () => {
  it('compiles one tesseract cell into 24 fully traced shared-particle constraints', () => {
    const { source, group } = fullCube(4);
    const particles = particlesFor(source);
    const family = compileXpbdOrientedCuboidFamilyN({
      id: 'tesseract-volume',
      source,
      cuboidGroup: group,
      particles
    });

    expect(family.dimension).toBe(4);
    expect(family.simplexization.sourceCellCount).toBe(1);
    expect(family.simplexization.simplicesPerCell).toBe(24);
    expect(family.cells).toHaveLength(24);
    expect(family.constraints).toHaveLength(24);
    expect(new Set(family.constraints.map((constraint) => constraint.id)).size).toBe(24);
    for (let simplexIndex = 0; simplexIndex < family.cells.length; simplexIndex++) {
      const cell = family.cells[simplexIndex]!;
      expect(cell.simplexIndex).toBe(simplexIndex);
      expect(cell.sourceCellIndex).toBe(0);
      expect(cell.permutationIndex).toBe(simplexIndex);
      expect(cell.permutation).toEqual(family.simplexization.permutations[simplexIndex]);
      expect(cell.sourceCuboidVertexIndices).toHaveLength(16);
      expect(cell.sourceSimplexVertexIndices).toHaveLength(5);
      expect(cell.sourceId.groupKey).toBe('r4-volume-cells');
      expect(resolveSourceCellIdN(source, cell.sourceId).kind).toBe('resolved');
      expect(cell.constraint.points).toEqual(
        cell.sourceSimplexVertexIndices.map((vertex) => particles[vertex]!)
      );
    }
  });

  it('specializes to N! signed simplices whose absolute measures sum to one', () => {
    for (const dimension of [3, 4]) {
      const { source, group } = fullCube(dimension);
      const family = compileXpbdOrientedCuboidFamilyN({
        id: `cube-r${dimension}`,
        source,
        cuboidGroup: group,
        particles: particlesFor(source, `r${dimension}`)
      });
      const factorial = dimension === 3 ? 6 : 24;
      expect(family.cells).toHaveLength(factorial);
      let absoluteMeasure = 0;
      for (const cell of family.cells) {
        const expectedSign = permutationSign(cell.permutation);
        expect(cell.sourceOrientedMeasure).toBeCloseTo(expectedSign / factorial, 14);
        expect(cell.restOrientedMeasure).toBeCloseTo(cell.sourceOrientedMeasure, 14);
        expect(cell.constraint.evaluate().orientedMeasure).toBeCloseTo(
          cell.sourceOrientedMeasure,
          14
        );
        absoluteMeasure += Math.abs(cell.sourceOrientedMeasure);
      }
      expect(absoluteMeasure).toBeCloseTo(1, 14);
    }
  });

  it('separates source rest geometry from live particles and freezes material context', () => {
    const { source, group } = fullCube(3);
    const particles = particlesFor(source);
    particles[7]!.position.data[2] += 0.35;
    const seen: number[] = [];
    const family = compileXpbdOrientedCuboidFamilyN({
      id: 'material-cube',
      source,
      cuboidGroup: group,
      particles,
      restOrientedMeasure: (cell) => {
        expect(Object.isFrozen(cell)).toBe(true);
        expect(Object.isFrozen(cell.sourceId)).toBe(true);
        expect(Object.isFrozen(cell.permutation)).toBe(true);
        expect(Object.isFrozen(cell.sourceCuboidVertexIndices)).toBe(true);
        expect(Object.isFrozen(cell.sourceSimplexVertexIndices)).toBe(true);
        seen.push(cell.simplexIndex);
        return 0.8 * cell.sourceOrientedMeasure;
      },
      compliance: (cell) => (cell.permutationIndex + 1) * 1e-6
    });

    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
    for (const cell of family.cells) {
      expect(cell.restOrientedMeasure).toBeCloseTo(
        0.8 * cell.sourceOrientedMeasure,
        14
      );
      expect(cell.constraint.compliance).toBe((cell.permutationIndex + 1) * 1e-6);
    }
    expect(family.constraints.some((constraint, index) =>
      Math.abs(constraint.evaluate().orientedMeasure - family.cells[index]!.sourceOrientedMeasure) >
      1e-10
    )).toBe(true);
  });

  it('preserves every coordinate under SE(N) and reverses all signs under reflection', () => {
    const { source, group } = fullCube(4);
    const particles = particlesFor(source);
    const family = compileXpbdOrientedCuboidFamilyN({
      id: 'covariant-volume', source, cuboidGroup: group, particles
    });
    const base = family.constraints.map((constraint) => constraint.evaluate().orientedMeasure);
    const rotation = MatN.rotationInPlane(4, 0, 3, 0.53)
      .multiply(MatN.rotationInPlane(4, 1, 2, -0.27));
    const translation = new VecN([1.2, -0.4, 0.7, 2.1]);
    for (const particle of particles) {
      particle.position.copy(rotation.applyTo(particle.position).add(translation));
    }
    for (let index = 0; index < family.constraints.length; index++) {
      expect(family.constraints[index]!.evaluate().orientedMeasure).toBeCloseTo(
        base[index]!,
        12
      );
    }
    for (const particle of particles) particle.position.data[0] *= -1;
    for (let index = 0; index < family.constraints.length; index++) {
      expect(family.constraints[index]!.evaluate().orientedMeasure).toBeCloseTo(
        -base[index]!,
        12
      );
    }
  });

  it('shares an R4 distance network and reduces a perturbed volume residual', () => {
    const { source, group } = fullCube(4);
    const edgeGroup = source.cellsOfDim(1)[0]!;
    edgeGroup.key = 'r4-edges';
    const network = compileXpbdDistanceNetworkN({
      id: 'tesseract-network',
      source,
      edgeGroup,
      inverseMass: (vertex) => vertex.sourceVertexIndex === 0 ? 0 : 1,
      compliance: 1e-6
    });
    const family = compileXpbdOrientedCuboidFamilyN({
      id: 'tesseract-volume',
      source,
      cuboidGroup: group,
      particles: network.particles,
      compliance: 1e-7
    });
    const world = network.addToWorld(new XpbdWorldN({
      dimension: 4,
      solverIterations: 20
    }));
    family.addToWorld(world);
    family.addToWorld(world);

    network.particles[15]!.position.data[3] += 0.08;
    const before = Math.max(...family.constraints.map(
      (constraint) => Math.abs(constraint.evaluate().value)
    ));
    const fixed = network.particles[0]!.position.toArray();
    const result = world.step(1 / 60);
    const after = Math.max(...family.constraints.map(
      (constraint) => Math.abs(constraint.evaluate().value)
    ));

    expect(world.particles).toEqual(network.particles);
    expect(world.constraints).toHaveLength(
      network.constraints.length + family.constraints.length
    );
    expect(after).toBeLessThan(before);
    expect(network.particles[0]!.position.toArray()).toEqual(fixed);
    expect(result.constraintSolves[0]!.solve.constraints.some(
      (constraint) => constraint.id === family.constraints[23]!.id
    )).toBe(true);
  });

  it('survives position and group-order changes but refuses retired parent cells', () => {
    const current = fullCube(3);
    const currentParticles = particlesFor(current.source);
    const currentFamily = compileXpbdOrientedCuboidFamilyN({
      id: 'current',
      source: current.source,
      cuboidGroup: current.group,
      particles: currentParticles
    });
    current.source.positions[0] += 0.2;
    current.source.groups.splice(current.source.groups.indexOf(current.group), 1);
    current.source.groups.unshift(current.group);
    const currentWorld = new XpbdWorldN({ dimension: 3 });
    for (const particle of currentParticles) currentWorld.addParticle(particle);
    currentFamily.addToWorld(currentWorld);
    expect(currentWorld.constraints).toHaveLength(6);

    const mutations: Array<(source: CellComplex, group: CellGroup) => void> = [
      (source, candidate) => source.groups.splice(source.groups.indexOf(candidate), 1),
      (_source, candidate) => {
        const indices = candidate.indices.slice();
        [indices[0], indices[1]] = [indices[1]!, indices[0]!];
        candidate.indices = indices;
      },
      (_source, candidate) => { candidate.kind = 'simplex'; },
      (_source, candidate) => { candidate.key = 'replacement'; },
      (source, candidate) => source.groups.push({
        key: candidate.key,
        dim: candidate.dim,
        verticesPerCell: candidate.verticesPerCell,
        kind: candidate.kind,
        indices: candidate.indices.slice()
      })
    ];
    for (const mutate of mutations) {
      const { source, group } = fullCube(3);
      const particles = particlesFor(source);
      const family = compileXpbdOrientedCuboidFamilyN({
        id: 'retired', source, cuboidGroup: group, particles
      });
      const world = new XpbdWorldN({ dimension: 3 });
      for (const particle of particles) world.addParticle(particle);
      mutate(source, group);
      expect(() => family.addToWorld(world)).toThrow(/source cell/);
      expect(world.constraints).toHaveLength(0);
    }
  });

  it('preflights particle ownership and constraint ids atomically', () => {
    const { source, group } = fullCube(3);
    const particles = particlesFor(source, 'owned');
    const family = compileXpbdOrientedCuboidFamilyN({
      id: 'attach', source, cuboidGroup: group, particles
    });
    const empty = new XpbdWorldN({ dimension: 3 });
    expect(() => family.addToWorld(empty)).toThrow(/not registered/);
    expect(empty.constraints).toHaveLength(0);

    const foreign = new XpbdWorldN({ dimension: 3 });
    for (const particle of particles) {
      foreign.addParticle(new XpbdParticleN({
        id: particle.id,
        position: particle.position
      }));
    }
    expect(() => family.addToWorld(foreign)).toThrow(/owned by another object/);
    expect(foreign.constraints).toHaveLength(0);

    const collision = new XpbdWorldN({ dimension: 3 });
    for (const particle of particles) collision.addParticle(particle);
    collision.addConstraint(new XpbdDistanceConstraintN({
      id: family.constraints[5]!.id,
      pointA: particles[0]!,
      pointB: particles[1]!,
      restLength: 1
    }));
    expect(() => family.addToWorld(collision)).toThrow(/already owned/);
    expect(collision.constraints).toHaveLength(1);
  });

  it('rejects malformed topology, bindings, budgets, and material policies', () => {
    const clean = fullCube(4);
    const cleanParticles = particlesFor(clean.source);
    const compile = (
      source = clean.source,
      group = clean.group,
      particles = cleanParticles
    ): unknown => compileXpbdOrientedCuboidFamilyN({
      id: 'invalid', source, cuboidGroup: group, particles
    });

    expect(() => compile(clean.source, fullCube(4).group)).toThrow(/belong/);
    expect(() => compile(clean.source, clean.source.cellsOfDim(3)[0]!)).toThrow(
      /full-dimensional/
    );

    const wrongKind = fullCube(3);
    wrongKind.group.kind = 'simplex';
    expect(() => compile(
      wrongKind.source,
      wrongKind.group,
      particlesFor(wrongKind.source)
    )).toThrow(/cuboids/);

    const repeated = fullCube(3);
    repeated.group.indices[1] = repeated.group.indices[0]!;
    expect(() => compile(
      repeated.source,
      repeated.group,
      particlesFor(repeated.source)
    )).toThrow(/repeats/);

    const outOfRange = fullCube(3);
    outOfRange.group.indices[7] = 99;
    expect(() => compile(
      outOfRange.source,
      outOfRange.group,
      particlesFor(outOfRange.source)
    )).toThrow(/out of range/);

    const degenerate = fullCube(4);
    for (let vertex = 0; vertex < degenerate.source.vertexCount; vertex++) {
      degenerate.source.positions[vertex * 4 + 3] = 0;
    }
    expect(() => compile(
      degenerate.source,
      degenerate.group,
      particlesFor(degenerate.source)
    )).toThrow(/degenerate/);

    expect(() => compile(clean.source, clean.group, cleanParticles.slice(1))).toThrow(
      /vertex count/
    );
    expect(() => compile(clean.source, clean.group, [
      cleanParticles[0]!,
      cleanParticles[0]!,
      ...cleanParticles.slice(2)
    ])).toThrow(/identities/);
    const duplicateIds = particlesFor(clean.source, 'duplicate');
    duplicateIds[1] = new XpbdParticleN({
      id: duplicateIds[0]!.id,
      position: duplicateIds[1]!.position
    });
    expect(() => compile(clean.source, clean.group, duplicateIds)).toThrow(
      /duplicate particle id/
    );

    expect(() => compileXpbdOrientedCuboidFamilyN({
      id: 'budget',
      source: clean.source,
      cuboidGroup: clean.group,
      particles: cleanParticles,
      maxOutputCells: 23
    })).toThrow(/budget/);
    expect(() => compileXpbdOrientedCuboidFamilyN({
      id: 'rest',
      source: clean.source,
      cuboidGroup: clean.group,
      particles: cleanParticles,
      restOrientedMeasure: Number.NaN
    })).toThrow(/restOrientedMeasure/);
    expect(() => compileXpbdOrientedCuboidFamilyN({
      id: 'compliance',
      source: clean.source,
      cuboidGroup: clean.group,
      particles: cleanParticles,
      compliance: -1
    })).toThrow(/compliance/);
  });
});
