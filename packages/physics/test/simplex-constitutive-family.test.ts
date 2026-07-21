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
  HyperplaneColliderN,
  XpbdExponentialVelocityDampingN,
  XpbdParticleN,
  XpbdWorldN,
  compileSimplexCompressibleNeoHookeanFamilyN,
  compileSimplexConstitutiveFamilyN,
  compileSimplexStVenantKirchhoffFamilyN,
  compileXpbdParticleBindingN,
  compileXpbdParticleHyperplaneFrictionFamilyN,
  compileXpbdParticleHyperplaneFamilyN,
  evaluateSimplexCompressibleNeoHookeanN,
  evaluateSimplexStVenantKirchhoffN,
  lumpSimplexMassesN,
  simplexStVenantKirchhoffLawN,
  type SimplexConstitutiveLawN
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

describe('SimplexConstitutiveFamilyN', () => {
  it('makes generic and compatibility StVK assembly identical', () => {
    const { source, group } = squareSource();
    const particles = particlesFrom(source, [
      [0.02, -0.03],
      [1.16, 0.08],
      [-0.09, 0.91],
      [1.05, 1.18]
    ]);
    const material = { firstLameParameter: 2.5, shearModulus: 1.8 };
    const generic = compileSimplexConstitutiveFamilyN({
      id: 'generic-sheet',
      source,
      simplexGroup: group,
      particles,
      law: simplexStVenantKirchhoffLawN,
      material
    });
    const compatibility = compileSimplexStVenantKirchhoffFamilyN({
      id: 'compatibility-sheet',
      source,
      simplexGroup: group,
      particles,
      material
    });
    const a = generic.evaluate();
    const b = compatibility.evaluate();

    expect(a.lawId).toBe('st-venant-kirchhoff');
    expect(compatibility.constitutiveFamily.law)
      .toBe(simplexStVenantKirchhoffLawN);
    expect(a.potentialEnergy).toBeCloseTo(b.potentialEnergy, 14);
    expect(a.maximumStrainFrobeniusNorm)
      .toBeCloseTo(b.maximumStrainFrobeniusNorm, 14);
    expect(a.minimumMeasureRatio).toBeCloseTo(b.minimumMeasureRatio, 14);
    expect(a.invertedElementCount).toBe(b.invertedElementCount);
    for (let vertex = 0; vertex < particles.length; vertex++) {
      expectArrayClose(a.forces[vertex]!.data, b.forces[vertex]!.data, 14);
    }
    expect(generic.elements.map((element) => element.sourceId))
      .toEqual(compatibility.elements.map((element) => element.sourceId));
  });

  it('assembles a source-indexed Neo-Hookean family as independent elements', () => {
    const { source, group } = squareSource();
    const particles = particlesFrom(source, [
      [0.01, -0.04],
      [1.12, 0.05],
      [-0.06, 0.94],
      [1.08, 1.11]
    ]);
    const contexts: number[] = [];
    const family = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'neo-sheet',
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
      const independent = evaluateSimplexCompressibleNeoHookeanN(
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
    expect(evaluated.lawId).toBe('compressible-neo-hookean');
    expect(evaluated.potentialEnergy).toBeCloseTo(expectedEnergy, 13);
    for (let vertex = 0; vertex < particles.length; vertex++) {
      expectArrayClose(
        evaluated.forces[vertex]!.data,
        expectedForces[vertex]!.data,
        13
      );
    }
    expect(evaluated.netForceResidual).toBeLessThan(1e-14);
    expect(evaluated.minimumMeasureRatio).toBeGreaterThan(0);
  });

  it('is the negative finite-difference gradient of assembled Neo-Hookean energy', () => {
    const { source, group } = squareSource();
    const particles = particlesFrom(source, [
      [0.01, -0.04],
      [1.12, 0.05],
      [-0.06, 0.94],
      [1.08, 1.11]
    ]);
    const family = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'finite-difference-neo-sheet',
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

  it('composes one R4 cuboid into 24 traceable Neo-Hookean elements', () => {
    const source = createHypercube({ dim: 4, size: 2, maxCellDimension: 4 });
    const cuboids = source.cellsOfDim(4)[0]!;
    cuboids.key = 'body-4-cells';
    const simplexization = simplexizeCuboidGroupN(cuboids, {
      outputKey: 'body-4-simplices'
    });
    source.addGroup(simplexization.simplexGroup);
    const particles = particlesFrom(source);
    const family = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'neo-tesseract-solid',
      source,
      simplexGroup: simplexization.simplexGroup,
      particles,
      material: { firstLameParameter: 4, shearModulus: 3 }
    });
    const evaluated = family.evaluate();

    expect(family.elements).toHaveLength(24);
    expect(evaluated.elements).toHaveLength(24);
    expect(evaluated.potentialEnergy).toBeCloseTo(0, 13);
    expect(evaluated.minimumMeasureRatio).toBeCloseTo(1, 13);
    expect(evaluated.invertedElementCount).toBe(0);
    expect(evaluated.collapsedElementCount).toBe(0);
    expect(family.elements.every(
      (element) => resolveSourceCellIdN(source, element.sourceId).kind === 'resolved'
    )).toBe(true);
  });

  it('drives the RN world and rolls back an invalid inverted proposal', () => {
    const group: CellGroup = {
      key: 'line-elements',
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    const source = new CellComplex(1, new Float64Array([0, 1]), [group]);
    const particles = particlesFrom(source, [[0], [2]]);
    const family = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'neo-line',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 4, shearModulus: 3 }
    });
    const initial = family.evaluate();
    const world = new XpbdWorldN({ dimension: 1 })
      .addParticle(particles[0]!)
      .addParticle(particles[1]!);
    family.addToWorld(world);
    const step = world.step(0.01);
    expect(step.constraintSolves[0]!.forceProviders[0]!.provider).toBe(family);
    for (let vertex = 0; vertex < 2; vertex++) {
      expectArrayClose(
        particles[vertex]!.velocity.data,
        [initial.forces[vertex]!.data[0]! * 0.01],
        13
      );
    }

    const rollbackParticles = [
      new XpbdParticleN({ id: 'fixed', position: [0], inverseMass: 0 }),
      new XpbdParticleN({ id: 'moving', position: [1], velocity: [-30] })
    ];
    const rollbackFamily = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'rollback-neo-line',
      source,
      simplexGroup: group,
      particles: rollbackParticles,
      material: { firstLameParameter: 4, shearModulus: 3 }
    });
    const rollbackWorld = new XpbdWorldN({ dimension: 1 })
      .addParticle(rollbackParticles[0]!)
      .addParticle(rollbackParticles[1]!);
    rollbackFamily.addToWorld(rollbackWorld);
    expect(() => rollbackWorld.step(0.1, 2)).toThrow(/preserve orientation/);
    expectArrayClose(rollbackParticles[1]!.position.data, [1]);
    expectArrayClose(rollbackParticles[1]!.velocity.data, [-30]);
  });

  it('keeps the integrated R4 material/contact composition inside the law domain', () => {
    const source = createHypercube({ dim: 4, size: 2, maxCellDimension: 4 });
    const scales = [1.18, 1.38, 0.94, 0.82];
    for (let vertex = 0; vertex < source.vertexCount; vertex++) {
      for (let axis = 0; axis < 4; axis++) {
        source.positions[vertex * 4 + axis]! *= scales[axis]!;
      }
    }
    const cuboids = source.cellsOfDim(4)[0]!;
    cuboids.key = 'material-4-cells';
    const simplexization = simplexizeCuboidGroupN(cuboids, {
      outputKey: 'material-4-simplices'
    });
    source.addGroup(simplexization.simplexGroup);
    const masses = lumpSimplexMassesN({
      source,
      simplexGroup: simplexization.simplexGroup,
      density: 1
    });
    const binding = compileXpbdParticleBindingN({
      id: 'integrated-r4-points',
      source,
      mass: ({ sourceVertexIndex }) => masses.vertexMasses[sourceVertexIndex]!,
      fixed: ({ sourcePosition: position }) => position.data[1]! > 0
    });
    const world = binding.addToWorld(new XpbdWorldN({
      dimension: 4,
      gravity: [0, -2.35, 0, 0],
      solverIterations: 16
    }));
    const family = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'integrated-r4-material',
      source,
      simplexGroup: simplexization.simplexGroup,
      particles: binding.particles,
      material: { firstLameParameter: 10, shearModulus: 10 }
    });
    family.addToWorld(world);
    const contacts = compileXpbdParticleHyperplaneFamilyN({
      id: 'integrated-r4-floor',
      source,
      particles: binding.particles,
      plane: new HyperplaneColliderN([0, 1, 0, 0], -1.7)
    });
    contacts.addToWorld(world);
    compileXpbdParticleHyperplaneFrictionFamilyN({
      id: 'integrated-r4-friction',
      contacts,
      friction: 0.55
    }).addToWorld(world);
    world.addVelocityResponse(new XpbdExponentialVelocityDampingN({
      id: 'integrated-r4-damping',
      particles: binding.particles,
      rate: 0.18
    }));

    const fixedStep = 1 / 120;
    for (let step = 0; step < 480; step++) {
      const elapsed = step * fixedStep;
      for (const particle of binding.particles) {
        if (particle.inverseMass === 0) continue;
        const phase = 2.15 * elapsed + 0.65 * particle.position.data[2]!;
        const handedness = particle.position.data[0]! >= 0 ? 1 : -1;
        particle.applyForce([
          0,
          0,
          0,
          2.2 * handedness * Math.sin(phase)
        ]);
      }
      world.step(fixedStep);
    }

    const evaluated = family.evaluate();
    expect(evaluated.potentialEnergy).toBeGreaterThan(0);
    expect(evaluated.minimumMeasureRatio).toBeGreaterThan(0.4);
    expect(evaluated.invertedElementCount).toBe(0);
    expect(evaluated.collapsedElementCount).toBe(0);
    expect(Math.max(...binding.particles.map(
      (particle) => Math.abs(particle.position.data[3]!)
    ))).toBeGreaterThan(0.01);
  });

  it('refuses invalid laws, cross-world attachment, and retired topology', () => {
    const { source, group } = squareSource();
    const particles = particlesFrom(source);
    const invalidLaw = {
      id: '',
      evaluate: () => ({})
    } as unknown as SimplexConstitutiveLawN<never, never>;
    expect(() => compileSimplexConstitutiveFamilyN({
      id: 'invalid-law',
      source,
      simplexGroup: group,
      particles,
      law: invalidLaw,
      material: {} as never
    })).toThrow(/law id/);
    const malformedLaw: typeof simplexStVenantKirchhoffLawN = {
      id: 'malformed-law',
      evaluate: (rest, current, material) => ({
        ...evaluateSimplexStVenantKirchhoffN(rest, current, material),
        energy: Number.NaN
      })
    };
    expect(() => compileSimplexConstitutiveFamilyN({
      id: 'malformed-evaluation',
      source,
      simplexGroup: group,
      particles,
      law: malformedLaw,
      material: { firstLameParameter: 2, shearModulus: 3 }
    })).toThrow(/energy must be finite/);

    const family = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'owned-neo-sheet',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 2, shearModulus: 3 }
    });
    const worldA = new XpbdWorldN({ dimension: 2 });
    const worldB = new XpbdWorldN({ dimension: 2 });
    for (const particle of particles) {
      worldA.addParticle(particle);
      worldB.addParticle(particle);
    }
    family.addToWorld(worldA);
    expect(() => family.addToWorld(worldB)).toThrow(/another world/);

    source.groups.splice(source.groups.indexOf(group), 1);
    expect(() => family.evaluate()).toThrow(/retired/);
  });
});
