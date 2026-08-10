import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  projectPointToSourceSimplexN
} from '@holotope/core';
import {
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexPairBarrierFamilyN,
  evaluateSourceSimplexPairDistanceN,
  stepXpbdIncrementalPotentialWorldN
} from '../src/index.js';

/**
 * The compiled deformable-feature/static-feature family, held to the Part D
 * probe's conclusions: complete candidates by construction, deterministic
 * order, the discretization-defined density stated (never averaged), and the
 * world-step composition with its own filters.
 */

const DIM = 4;

function scene(sheetW: number, spikeXY: [number, number]) {
  const sheet = new CellComplex(DIM, Float64Array.from([
    0, 0, 0, sheetW,
    1, 0, 0, sheetW,
    0, 1, 0, sheetW,
    1, 1, 0, sheetW
  ]), [{
    dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
  }]);
  const obstacle = new CellComplex(DIM, Float64Array.from([
    spikeXY[0], spikeXY[1], 0, -0.5,
    spikeXY[0], spikeXY[1], 0, 0.9,
    spikeXY[0] + 0.25, spikeXY[1] - 0.2, 0.08, -0.5,
    spikeXY[0] - 0.2, spikeXY[1] + 0.25, -0.08, -0.5
  ]), [{
    dim: 3, verticesPerCell: 4, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 3])
  }]);
  const binding = compileXpbdParticleBindingN({ id: 'sheet', source: sheet });
  const family = compileXpbdSourceSimplexPairBarrierFamilyN({
    id: 'contact',
    binding,
    simplexGroup: sheet.groups[0]!,
    obstacle: createSourceSimplexReferenceN(
      createSourceCellReferenceN(obstacle, obstacle.groups[0]!, 0)
    ),
    activationDistance: 0.25,
    stiffness: 3
  });
  return { sheet, obstacle, binding, family };
}

describe('the compiled pair family', () => {
  it('compiles one pair per source cell and closes the P53d gap', () => {
    const { sheet, binding, family } = scene(0.2, [0.3, 0.3]);
    expect(family.barriers.length).toBe(2);
    expect(family.stepFilters.length).toBe(2);
    expect(family.providers).toBe(family.barriers);
    // Every sheet vertex legally separated...
    for (let vertexIndex = 0; vertexIndex < 4; vertexIndex++) {
      const point = Array.from(
        sheet.positions.subarray(vertexIndex * DIM, (vertexIndex + 1) * DIM)
      );
      const projection = projectPointToSourceSimplexN(family.obstacle, point);
      expect(Math.sqrt(projection.squaredDistance)).toBeGreaterThan(0.3);
    }
    // ...while the family's first feature is at certified zero distance.
    const pair = evaluateSourceSimplexPairDistanceN(
      { reference: family.features[0]! }, { reference: family.obstacle }
    );
    expect(pair.status).toBe('zero-distance');
    void binding;
  });

  it('states the discretization-defined density instead of averaging it', () => {
    // The spike under the shared edge: both cells' terms are active with the
    // same witness geometry, and the family's energy is exactly their sum.
    const { family } = scene(1.05, [0.5, 0.5]);
    const one = family.barriers[0]!.evaluate();
    const two = family.barriers[1]!.evaluate();
    expect(one.barrier.active).toBe(true);
    expect(two.barrier.active).toBe(true);
    expect(one.potentialEnergy + two.potentialEnergy)
      .toBeCloseTo(2 * one.potentialEnergy, 12);
    // Registration order changes nothing.
    const reversed = [...family.barriers].reverse()
      .map((barrier) => barrier.evaluate().potentialEnergy)
      .reduce((x, y) => x + y, 0);
    expect(reversed).toBe(one.potentialEnergy + two.potentialEnergy);
  });

  it('composes through the world step with its own filters, breach-free', () => {
    const { binding, family } = scene(1.2, [0.3, 0.3]);
    const world = new XpbdWorldN({ dimension: DIM, gravity: [0, 0, 0, -9.81] });
    binding.addToWorld(world);
    family.addToWorld(world);
    let applied = 0;
    for (let step = 0; step < 12; step++) {
      const advance = stepXpbdIncrementalPotentialWorldN({
        world,
        deltaTime: 0.01,
        stepFilters: family.stepFilters,
        warmStart: 'feasible-inertial-prediction',
        minimization: { directionPolicy: 'steepest-descent' }
      });
      if (advance.step.status === 'applied') applied++;
    }
    expect(applied).toBeGreaterThan(6);
    // After the fall, at least one pair is inside its activation band and no
    // pair reached zero distance — the barrier held the sheet off the spike.
    let active = 0;
    for (const barrier of family.barriers) {
      const evaluation = barrier.evaluate(); // throws if zero-distance
      if (evaluation.barrier.active) active++;
    }
    expect(active).toBeGreaterThan(0);
  });

  it('refuses bad compilation by name', () => {
    const { sheet, binding, family } = scene(1.2, [0.3, 0.3]);
    expect(() => compileXpbdSourceSimplexPairBarrierFamilyN({
      id: '', binding, simplexGroup: sheet.groups[0]!, obstacle: family.obstacle,
      activationDistance: 0.25, stiffness: 3
    })).toThrow(/id must be a non-empty string/);
    expect(() => compileXpbdSourceSimplexPairBarrierFamilyN({
      id: 'x', binding, simplexGroup: sheet.groups[0]!, obstacle: family.obstacle,
      activationDistance: 0.25, stiffness: 3, magic: 1
    } as never)).toThrow(/unknown option "magic"/);
    const other = new CellComplex(DIM, Float64Array.from([0, 0, 0, 0, 1, 0, 0, 0]), [{
      dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from([0, 1])
    }]);
    expect(() => compileXpbdSourceSimplexPairBarrierFamilyN({
      id: 'x', binding, simplexGroup: other.groups[0]!, obstacle: family.obstacle,
      activationDistance: 0.25, stiffness: 3
    })).toThrow(/simplexGroup does not belong to the binding's source/);
  });
});
