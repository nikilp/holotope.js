import { CellComplex, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  SimplexConstitutiveDomainErrorN,
  XpbdParticleN,
  XpbdStateGuardRejectionErrorN,
  XpbdWorldN,
  compileSimplexCompressibleNeoHookeanFamilyN,
  compileSimplexConstitutiveFamilyStateGuardN,
  compileSimplexStVenantKirchhoffFamilyN,
  evaluateSimplexCompressibleNeoHookeanN
} from '../src/index.js';

function sourceWithSimplex(
  ambientDimension: number,
  simplexDimension: number,
  positions: readonly number[]
): { source: CellComplex; group: CellGroup } {
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
    source: new CellComplex(ambientDimension, new Float64Array(positions), [group]),
    group
  };
}

function particlesFrom(source: CellComplex): XpbdParticleN[] {
  return Array.from({ length: source.vertexCount }, (_, vertex) =>
    new XpbdParticleN({
      id: `particle/${vertex}`,
      position: source.positions.subarray(
        vertex * source.ambientDim,
        (vertex + 1) * source.ambientDim
      )
    })
  );
}

describe('SimplexConstitutiveFamilyStateGuardN', () => {
  it('turns only typed Neo-Hookean domain refusal into adaptive rejection', () => {
    const { source, group } = sourceWithSimplex(1, 1, [0, 1]);
    const anchor = new XpbdParticleN({
      id: 'particle/0', position: [0], inverseMass: 0
    });
    const moving = new XpbdParticleN({ id: 'particle/1', position: [1] });
    const particles = [anchor, moving];
    moving.applyForce([-1.2]);
    const family = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'neo-line',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 2, shearModulus: 3 }
    });
    const guard = compileSimplexConstitutiveFamilyStateGuardN({
      id: 'neo-domain',
      family: family.constitutiveFamily,
      minimumMeasureRatio: 0.05
    });
    const world = new XpbdWorldN({ dimension: 1 })
      .addParticle(anchor)
      .addParticle(moving);
    guard.addToWorld(world);

    let rejection: unknown;
    try {
      world.step(1);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(XpbdStateGuardRejectionErrorN);
    const typed = rejection as XpbdStateGuardRejectionErrorN;
    expect(typed.evaluation).toMatchObject({
      accepted: false,
      status: 'law-domain',
      lawId: 'compressible-neo-hookean',
      domainReason: 'inverted'
    });
    expect(moving.position.data[0]).toBe(1);
    expect(moving.force.data[0]).toBe(-1.2);

    const adaptive = world.stepAdaptive(1, { maximumSubsteps: 8 });
    expect(adaptive.attempts.map((attempt) => attempt.substeps)).toEqual([1, 2]);
    expect(moving.position.data[0]).toBeCloseTo(0.1, 14);
    expect(moving.force.data[0]).toBe(0);
    const finalGuard = adaptive.result.constraintSolves[1]!
      .stateGuards[0]!.evaluation;
    expect(finalGuard).toMatchObject({
      accepted: true,
      status: 'accepted',
      lawId: 'compressible-neo-hookean'
    });
    expect(finalGuard.margin).toBeCloseTo(0.05, 13);
  });

  it('uses a typed error for domain state but not malformed material', () => {
    const rest = [new VecN([0]), new VecN([1])];
    let domainError: unknown;
    try {
      evaluateSimplexCompressibleNeoHookeanN(
        rest,
        [new VecN([0]), new VecN([-0.2])],
        { firstLameParameter: 2, shearModulus: 3 }
      );
    } catch (error) {
      domainError = error;
    }
    expect(domainError).toBeInstanceOf(SimplexConstitutiveDomainErrorN);
    expect(domainError).toMatchObject({
      lawId: 'compressible-neo-hookean',
      reason: 'inverted'
    });

    let materialError: unknown;
    try {
      evaluateSimplexCompressibleNeoHookeanN(
        rest,
        rest,
        { firstLameParameter: 2, shearModulus: 0 }
      );
    } catch (error) {
      materialError = error;
    }
    expect(materialError).toBeInstanceOf(Error);
    expect(materialError).not.toBeInstanceOf(SimplexConstitutiveDomainErrorN);
  });

  it('rejects full-dimensional orientation change even for a law that evaluates it', () => {
    const { source, group } = sourceWithSimplex(1, 1, [0, 1]);
    const anchor = new XpbdParticleN({
      id: 'stvk/anchor', position: [0], inverseMass: 0
    });
    const moving = new XpbdParticleN({
      id: 'stvk/moving', position: [1], velocity: [-2]
    });
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'stvk-line',
      source,
      simplexGroup: group,
      particles: [anchor, moving],
      material: { firstLameParameter: 2, shearModulus: 3 }
    });
    const guard = compileSimplexConstitutiveFamilyStateGuardN({
      id: 'stvk-orientation',
      family: family.constitutiveFamily,
      minimumMeasureRatio: 0.05
    });
    const world = new XpbdWorldN({ dimension: 1 })
      .addParticle(anchor)
      .addParticle(moving);
    guard.addToWorld(world);

    let rejection: unknown;
    try {
      world.step(1);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(XpbdStateGuardRejectionErrorN);
    expect((rejection as XpbdStateGuardRejectionErrorN).evaluation)
      .toMatchObject({
        accepted: false,
        status: 'orientation-change',
        invertedElementCount: 1
      });
    expect(moving.position.data[0]).toBe(1);
  });

  it('accepts embedded and full R4 simplices through the same policy', () => {
    const cases = [
      sourceWithSimplex(4, 2, [
        0, 0, 0, 0,
        1, 0, 0, 0,
        0, 1, 0, 0
      ]),
      sourceWithSimplex(4, 4, [
        0, 0, 0, 0,
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ])
    ];

    for (const [index, { source, group }] of cases.entries()) {
      const particles = particlesFrom(source);
      const family = compileSimplexCompressibleNeoHookeanFamilyN({
        id: `neo-r4/${index}`,
        source,
        simplexGroup: group,
        particles,
        material: { firstLameParameter: 2, shearModulus: 3 }
      });
      const guard = compileSimplexConstitutiveFamilyStateGuardN({
        id: `guard-r4/${index}`,
        family: family.constitutiveFamily,
        minimumMeasureRatio: 0.2
      });
      const world = new XpbdWorldN({ dimension: 4 });
      for (const particle of particles) world.addParticle(particle);
      guard.addToWorld(world);
      const evaluated = world.step(0.1).constraintSolves[0]!
        .stateGuards[0]!.evaluation;
      expect(evaluated).toMatchObject({
        accepted: true,
        status: 'accepted',
        minimumMeasureRatio: 1
      });
      expect(evaluated.margin).toBeCloseTo(0.8, 14);
    }
  });

  it('validates the explicit threshold, family, and world ownership', () => {
    const { source, group } = sourceWithSimplex(1, 1, [0, 1]);
    const particles = particlesFrom(source);
    const family = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'ownership-family',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 2, shearModulus: 3 }
    });
    expect(() => compileSimplexConstitutiveFamilyStateGuardN({
      id: 'bad-threshold',
      family: family.constitutiveFamily,
      minimumMeasureRatio: 0
    })).toThrow(/positive/);
    expect(() => compileSimplexConstitutiveFamilyStateGuardN({
      id: 'bad-family',
      family: {} as typeof family.constitutiveFamily,
      minimumMeasureRatio: 0.1
    })).toThrow(/SimplexConstitutiveFamilyN/);

    const guard = compileSimplexConstitutiveFamilyStateGuardN({
      id: 'owned-guard',
      family: family.constitutiveFamily,
      minimumMeasureRatio: 0.1
    });
    const a = new XpbdWorldN({ dimension: 1 });
    const b = new XpbdWorldN({ dimension: 1 });
    for (const particle of particles) a.addParticle(particle);
    for (const particle of particles) b.addParticle(particle);
    guard.addToWorld(a);
    guard.addToWorld(a);
    expect(() => guard.addToWorld(b)).toThrow(/another world/);
  });
});
