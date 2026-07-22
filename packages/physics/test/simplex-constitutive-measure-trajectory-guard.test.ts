import { CellComplex, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  SimplexConstitutiveFamilyN,
  XpbdParticleN,
  XpbdStateGuardRejectionErrorN,
  XpbdWorldN,
  compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN,
  compileSimplexStVenantKirchhoffFamilyN
} from '../src/index.js';

function simplexSource(
  ambientDimension: number,
  simplexDimension: number,
  positions: readonly number[]
): { source: CellComplex; group: CellGroup } {
  const group: CellGroup = {
    key: `measure-trajectory-${simplexDimension}-in-${ambientDimension}`,
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

describe('SimplexConstitutiveFamilyMeasureTrajectoryGuardN', () => {
  it('rejects an embedded coarse collapse and lets subdivision recover atomically', () => {
    const { source, group } = simplexSource(2, 1, [0, 0, 1, 0]);
    const anchor = new XpbdParticleN({
      id: 'embedded-trajectory/anchor', position: [0, 0], inverseMass: 0
    });
    const moving = new XpbdParticleN({
      id: 'embedded-trajectory/moving', position: [1, 0]
    }).applyForce([-1.2, 0]);
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'embedded-trajectory/family',
      source,
      simplexGroup: group,
      particles: [anchor, moving],
      material: { firstLameParameter: 2, shearModulus: 3 }
    });
    const guard = compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN({
      id: 'embedded-trajectory/guard',
      family: family.constitutiveFamily,
      minimumMeasureRatio: 0.05,
      timeTolerance: 2 ** -24
    });
    const world = new XpbdWorldN({ dimension: 2 })
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
        analysis: {
          ambientDimension: 2,
          simplexDimension: 1,
          status: 'possible-violation'
        }
      });
    expect(moving.position.data).toEqual(new Float64Array([1, 0]));
    expect(moving.force.data).toEqual(new Float64Array([-1.2, 0]));

    const adaptive = world.stepAdaptive(1, { maximumSubsteps: 8 });
    expect(adaptive.attempts.map((attempt) =>
      [attempt.substeps, attempt.status]
    )).toEqual([[1, 'rejected'], [2, 'accepted']]);
    expect(moving.position.data[0]).toBeCloseTo(0.1, 14);
    expect(adaptive.result.constraintSolves.map((substep) =>
      substep.stateGuards[0]!.evaluation.status
    )).toEqual(['accepted', 'accepted']);
  });

  it('allows a full-dimensional rank policy without claiming orientation', () => {
    const { source, group } = simplexSource(1, 1, [0, 1]);
    const particles = [
      new XpbdParticleN({ id: 'full-measure/0', position: [0] }),
      new XpbdParticleN({ id: 'full-measure/1', position: [1] })
    ];
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'full-measure/family', source, simplexGroup: group, particles,
      material: { firstLameParameter: 2, shearModulus: 3 }
    }).constitutiveFamily;
    const guard = compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN({
      id: 'full-measure/guard', family, minimumMeasureRatio: 0
    });
    expect(guard.minimumMeasureRatio).toBe(0);
    expect(guard.family).toBe(family);
  });

  it('validates family identity and policy bounds', () => {
    const { source, group } = simplexSource(2, 1, [0, 0, 1, 0]);
    const particles = [
      new XpbdParticleN({ id: 'validation/0', position: [0, 0] }),
      new XpbdParticleN({ id: 'validation/1', position: [1, 0] })
    ];
    const family = compileSimplexStVenantKirchhoffFamilyN({
      id: 'validation/family', source, simplexGroup: group, particles,
      material: { firstLameParameter: 2, shearModulus: 3 }
    }).constitutiveFamily;
    expect(() => compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN({
      id: '', family, minimumMeasureRatio: 0
    })).toThrow(/non-empty/);
    expect(() => compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN({
      id: 'bad-family',
      family: {} as SimplexConstitutiveFamilyN<unknown, never>,
      minimumMeasureRatio: 0
    })).toThrow(/SimplexConstitutiveFamilyN/);
    expect(() => compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN({
      id: 'bad-threshold', family, minimumMeasureRatio: -1
    })).toThrow(/non-negative/);
    expect(() => compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN({
      id: 'bad-depth', family, minimumMeasureRatio: 0, maximumDepth: 0
    })).toThrow(/maximumDepth/);
  });
});
