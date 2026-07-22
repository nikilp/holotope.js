import { CellComplex, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  SimplexConstitutiveFamilyN,
  XpbdParticleN,
  XpbdStateGuardRejectionErrorN,
  XpbdWorldN,
  compileSimplexConstitutiveFamilyTrajectoryGuardN,
  compileSimplexStVenantKirchhoffFamilyN
} from '../src/index.js';

function simplexSource(
  ambientDimension: number,
  simplexDimension: number,
  positions: readonly number[]
): { source: CellComplex; group: CellGroup } {
  const group: CellGroup = {
    key: `trajectory-simplex-${simplexDimension}-in-${ambientDimension}`,
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

describe('SimplexConstitutiveFamilyTrajectoryGuardN', () => {
  it('rejects a coarse chord and lets adaptive subdivision accept atomically', () => {
    const { source, group } = simplexSource(1, 1, [0, 1]);
    const anchor = new XpbdParticleN({
      id: 'trajectory/anchor', position: [0], inverseMass: 0
    });
    const moving = new XpbdParticleN({
      id: 'trajectory/moving', position: [1]
    }).applyForce([-1.2]);
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'trajectory/family',
      source,
      simplexGroup: group,
      particles: [anchor, moving],
      material: { firstLameParameter: 2, shearModulus: 3 }
    });
    const guard = compileSimplexConstitutiveFamilyTrajectoryGuardN({
      id: 'trajectory/guard',
      family: family.constitutiveFamily,
      minimumSignedMeasureRatio: 0.05,
      timeTolerance: 2 ** -24
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
    const evaluation = (rejection as XpbdStateGuardRejectionErrorN).evaluation;
    expect(evaluation).toMatchObject({
      accepted: false,
      status: 'possible-violation',
      inspectedElementCount: 1
    });
    expect((evaluation as ReturnType<typeof guard.evaluate>).candidate)
      .toMatchObject({
        elementIndex: 0,
        element: { sourceCellIndex: 0, sourceVertexIndices: [0, 1] },
        analysis: { status: 'possible-violation' }
      });
    expect(moving.position.data[0]).toBe(1);
    expect(moving.force.data[0]).toBe(-1.2);

    const adaptive = world.stepAdaptive(1, { maximumSubsteps: 8 });
    expect(adaptive.attempts.map((attempt) =>
      [attempt.substeps, attempt.status]
    )).toEqual([[1, 'rejected'], [2, 'accepted']]);
    expect(moving.position.data[0]).toBeCloseTo(0.1, 14);
    expect(adaptive.result.constraintSolves.map((substep) =>
      substep.stateGuards[0]!.evaluation.status
    )).toEqual(['accepted', 'accepted']);
  });

  it('retains compiled rest state defensively', () => {
    const { source, group } = simplexSource(1, 1, [0, 2]);
    const particles = [
      new XpbdParticleN({ id: 'rest/0', position: [0] }),
      new XpbdParticleN({ id: 'rest/1', position: [2] })
    ];
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'rest/family', source, simplexGroup: group, particles,
      material: { firstLameParameter: 2, shearModulus: 3 }
    }).constitutiveFamily;
    const first = family.restPositionsOfElement(0);
    first[1]!.data[0] = 99;
    expect(family.restPositionsOfElement(0)[1]!.data[0]).toBe(2);
    expect(() => family.restPositionsOfElement(-1)).toThrow(/out of range/);
    expect(() => family.restPositionsOfElement(1)).toThrow(/out of range/);
  });

  it('requires a full-dimensional family and validates explicit policy bounds', () => {
    const { source, group } = simplexSource(2, 1, [0, 0, 1, 0]);
    const particles = [
      new XpbdParticleN({ id: 'embedded/0', position: [0, 0] }),
      new XpbdParticleN({ id: 'embedded/1', position: [1, 0] })
    ];
    const embedded = compileSimplexStVenantKirchhoffFamilyN({
      id: 'embedded/family', source, simplexGroup: group, particles,
      material: { firstLameParameter: 2, shearModulus: 3 }
    }).constitutiveFamily;
    expect(() => compileSimplexConstitutiveFamilyTrajectoryGuardN({
      id: 'embedded/guard', family: embedded, minimumSignedMeasureRatio: 0
    })).toThrow(/full-dimensional/);
    expect(() => compileSimplexConstitutiveFamilyTrajectoryGuardN({
      id: '', family: embedded, minimumSignedMeasureRatio: 0
    })).toThrow(/non-empty/);
    expect(() => compileSimplexConstitutiveFamilyTrajectoryGuardN({
      id: 'bad-family',
      family: {} as SimplexConstitutiveFamilyN<unknown, never>,
      minimumSignedMeasureRatio: 0
    })).toThrow(/SimplexConstitutiveFamilyN/);
    const fullSource = simplexSource(1, 1, [0, 1]);
    const fullParticles = [
      new XpbdParticleN({ id: 'full/0', position: [0] }),
      new XpbdParticleN({ id: 'full/1', position: [1] })
    ];
    const full = compileSimplexStVenantKirchhoffFamilyN({
      id: 'full/family',
      source: fullSource.source,
      simplexGroup: fullSource.group,
      particles: fullParticles,
      material: { firstLameParameter: 2, shearModulus: 3 }
    }).constitutiveFamily;
    expect(() => compileSimplexConstitutiveFamilyTrajectoryGuardN({
      id: 'bad-threshold', family: full, minimumSignedMeasureRatio: -1
    })).toThrow(/non-negative/);
  });
});
