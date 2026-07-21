import {
  CellComplex,
  VecN,
  createHypercube,
  resolveSourceCellIdN,
  simplexizeCuboidGroupN,
  type CellGroup
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdWorldN,
  compileSimplexStVenantKirchhoffFamilyN,
  evaluateSimplexStVenantKirchhoffN
} from '../src/index.js';

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

function sourcePosition(source: CellComplex, vertex: number): VecN {
  return new VecN(source.positions.subarray(
    vertex * source.ambientDim,
    (vertex + 1) * source.ambientDim
  ));
}

function particlesFrom(
  source: CellComplex,
  positions?: readonly (readonly number[])[]
): XpbdParticleN[] {
  return Array.from({ length: source.vertexCount }, (_, vertex) =>
    new XpbdParticleN({
      id: `p/${vertex}`,
      position: positions?.[vertex] ?? sourcePosition(source, vertex)
    })
  );
}

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 11
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, digits);
  }
}

describe('SimplexStVenantKirchhoffFamilyN', () => {
  it('assembles shared-vertex energy and force as the independent element sum', () => {
    const { source, group } = squareSource();
    const particles = particlesFrom(source, [
      [0.02, -0.03],
      [1.16, 0.08],
      [-0.09, 0.91],
      [1.05, 1.18]
    ]);
    const contexts: number[] = [];
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'sheet',
      source,
      simplexGroup: group,
      particles,
      material: (element) => {
        contexts.push(element.sourceCellIndex);
        return {
          firstLameParameter: 2 + element.sourceCellIndex,
          shearModulus: 3
        };
      }
    });
    expect(contexts).toEqual([0, 1]);
    expect(family.elements).toHaveLength(2);

    const evaluated = family.evaluate();
    const expectedForces = particles.map(() => new VecN(2));
    let expectedEnergy = 0;
    for (const element of family.elements) {
      const rest = element.sourceVertexIndices.map(
        (vertex) => sourcePosition(source, vertex)
      );
      const current = element.sourceVertexIndices.map(
        (vertex) => particles[vertex]!.position
      );
      const independent = evaluateSimplexStVenantKirchhoffN(
        rest,
        current,
        element.material
      );
      expectedEnergy += independent.energy;
      for (let local = 0; local < element.sourceVertexIndices.length; local++) {
        expectedForces[element.sourceVertexIndices[local]!]!
          .sub(independent.currentGradients[local]!);
      }
    }
    expect(evaluated.potentialEnergy).toBeCloseTo(expectedEnergy, 13);
    for (let vertex = 0; vertex < particles.length; vertex++) {
      expectArrayClose(
        evaluated.forces[vertex]!.data,
        expectedForces[vertex]!.data,
        13
      );
    }
    expect(evaluated.netForceResidual).toBeLessThan(1e-14);
    expect(evaluated.maximumStrainFrobeniusNorm).toBeGreaterThan(0);
    for (const element of family.elements) {
      expect(resolveSourceCellIdN(source, element.sourceId).kind).toBe('resolved');
    }
  });

  it('is the negative finite-difference gradient of assembled potential energy', () => {
    const { source, group } = squareSource();
    const particles = particlesFrom(source, [
      [0.01, -0.04],
      [1.12, 0.05],
      [-0.06, 0.94],
      [1.08, 1.11]
    ]);
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'finite-difference-sheet',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 2.5, shearModulus: 1.8 }
    });
    const evaluated = family.evaluate();
    const step = 1e-6;
    for (let vertex = 0; vertex < particles.length; vertex++) {
      for (let axis = 0; axis < 2; axis++) {
        particles[vertex]!.position.data[axis]! += step;
        const plus = family.evaluate().potentialEnergy;
        particles[vertex]!.position.data[axis]! -= 2 * step;
        const minus = family.evaluate().potentialEnergy;
        particles[vertex]!.position.data[axis]! += step;
        const numericForce = -(plus - minus) / (2 * step);
        expect(evaluated.forces[vertex]!.data[axis]).toBeCloseTo(
          numericForce,
          7
        );
      }
    }
  });

  it('composes a named 4-cuboid simplexization into 24 traceable R4 elements', () => {
    const source = createHypercube({ dim: 4, size: 2, maxCellDimension: 4 });
    const cuboids = source.cellsOfDim(4)[0]!;
    cuboids.key = 'body-4-cells';
    const simplexization = simplexizeCuboidGroupN(cuboids, {
      outputKey: 'body-4-simplices'
    });
    source.addGroup(simplexization.simplexGroup);
    const particles = particlesFrom(source);
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'tesseract-solid',
      source,
      simplexGroup: simplexization.simplexGroup,
      particles,
      material: { firstLameParameter: 4, shearModulus: 3 }
    });
    const evaluated = family.evaluate();

    expect(simplexization.simplicesPerCell).toBe(24);
    expect(family.elements).toHaveLength(24);
    expect(evaluated.elements).toHaveLength(24);
    expect(evaluated.potentialEnergy).toBeCloseTo(0, 13);
    expect(evaluated.invertedElementCount).toBe(0);
    expect(evaluated.collapsedElementCount).toBe(0);
    expect(evaluated.netForceResidual).toBeCloseTo(0, 15);
    expect(new Set(family.elements.map((element) => element.sourceId.cellIndex)).size)
      .toBe(24);
    expect(family.elements.every(
      (element) => resolveSourceCellIdN(source, element.sourceId).kind === 'resolved'
    )).toBe(true);
  });

  it('drives the RN world while preserving rest state and refusing retired topology', () => {
    const group: CellGroup = {
      key: 'line-elements',
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    const source = new CellComplex(1, new Float64Array([0, 1]), [group]);
    const particles = particlesFrom(source, [[0], [2]]);
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'line-material',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 4, shearModulus: 3 }
    });
    const beforeSourceWrite = family.evaluate();
    source.positions.set([10, 20]);
    expect(family.evaluate().potentialEnergy).toBeCloseTo(
      beforeSourceWrite.potentialEnergy,
      14
    );

    const world = new XpbdWorldN({ dimension: 1 })
      .addParticle(particles[0]!)
      .addParticle(particles[1]!);
    family.addToWorld(world);
    const step = world.step(0.01);
    expect(step.constraintSolves[0]!.forceProviders[0]!.provider).toBe(family);
    expect(step.constraintSolves[0]!.forceProviders[0]!.evaluation.potentialEnergy)
      .toBeCloseTo(11.25, 13);
    expectArrayClose(particles[0]!.velocity.data, [0.3], 13);
    expectArrayClose(particles[1]!.velocity.data, [-0.3], 13);
    expectArrayClose(particles[0]!.position.data, [0.003], 13);
    expectArrayClose(particles[1]!.position.data, [1.997], 13);

    source.groups.splice(source.groups.indexOf(group), 1);
    expect(() => family.evaluate()).toThrow(/retired/);
  });

  it('refuses foreign groups, malformed cells, and unstable element materials', () => {
    const { source, group } = squareSource();
    const particles = particlesFrom(source);
    const foreign: CellGroup = {
      key: 'foreign',
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    expect(() => compileSimplexStVenantKirchhoffFamilyN({
      id: 'foreign', source, simplexGroup: foreign, particles,
      material: { firstLameParameter: 1, shearModulus: 1 }
    })).toThrow(/belong to source/);

    group.indices = new Uint32Array([0, 1, 1]);
    expect(() => compileSimplexStVenantKirchhoffFamilyN({
      id: 'repeated', source, simplexGroup: group, particles,
      material: { firstLameParameter: 1, shearModulus: 1 }
    })).toThrow(/repeats a vertex/);

    group.indices = new Uint32Array([0, 1, 2]);
    expect(() => compileSimplexStVenantKirchhoffFamilyN({
      id: 'unstable', source, simplexGroup: group, particles,
      material: { firstLameParameter: -1.0001, shearModulus: 1 }
    })).toThrow(/lambda \+ 2 mu \/ k/);
  });
});
