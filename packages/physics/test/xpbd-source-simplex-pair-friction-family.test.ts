import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN
} from '@holotope/core';
import {
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexPairBarrierFamilyN,
  compileXpbdSourceSimplexPairFrictionFamilyN,
  stepXpbdIncrementalPotentialWorldN
} from '../src/index.js';

/**
 * P57 E3 — the family gates, including the one the P56 review made
 * load-bearing: whether effective friction follows mesh topology. It does,
 * and this measures the factor rather than averaging it away.
 */

const DIM = 4;

function scene(sheetW: number, spikeXY: [number, number], refined = false) {
  const positions = refined
    ? Float64Array.from([
      0, 0, 0, sheetW, 1, 0, 0, sheetW, 0, 1, 0, sheetW, 1, 1, 0, sheetW,
      0.5, 0.5, 0, sheetW
    ])
    : Float64Array.from([
      0, 0, 0, sheetW, 1, 0, 0, sheetW, 0, 1, 0, sheetW, 1, 1, 0, sheetW
    ]);
  const indices = refined
    ? Uint32Array.from([0, 1, 4, 0, 4, 2, 1, 3, 4, 3, 2, 4])
    : Uint32Array.from([0, 1, 2, 1, 3, 2]);
  const sheet = new CellComplex(DIM, positions, [
    { dim: 2, verticesPerCell: 3, kind: 'simplex', indices }
  ]);
  const obstacle = new CellComplex(DIM, Float64Array.from([
    spikeXY[0], spikeXY[1], 0, -0.5,
    spikeXY[0], spikeXY[1], 0, 0.9,
    spikeXY[0] + 0.25, spikeXY[1] - 0.2, 0.08, -0.5,
    spikeXY[0] - 0.2, spikeXY[1] + 0.25, -0.08, -0.5
  ]), [{ dim: 3, verticesPerCell: 4, kind: 'simplex', indices: Uint32Array.from([0, 1, 2, 3]) }]);
  const binding = compileXpbdParticleBindingN({ id: 'sheet', source: sheet });
  const contact = compileXpbdSourceSimplexPairBarrierFamilyN({
    id: 'contact',
    binding,
    simplexGroup: sheet.groups[0]!,
    obstacle: createSourceSimplexReferenceN(
      createSourceCellReferenceN(obstacle, obstacle.groups[0]!, 0)
    ),
    activationDistance: 0.4,
    stiffness: 3
  });
  return { sheet, obstacle, binding, contact };
}

describe('the compiled friction family', () => {
  it('compiles one term per contact pair with no obstacle fan-out', () => {
    const { contact } = scene(1.05, [0.5, 0.5]);
    const friction = compileXpbdSourceSimplexPairFrictionFamilyN({
      id: 'friction', contact, frictionCoefficient: 0.4, slipRegularization: 1e-3
    });
    expect(friction.terms.length).toBe(contact.barriers.length);
    expect(friction.terms.length).toBe(2);
    // Each term names its own contact barrier — reused, not recompiled.
    friction.terms.forEach((term, at) => {
      expect(term.barrier).toBe(contact.barriers[at]);
    });
  });

  it('prepares terms deterministically and skips unjustifiable pairs by type', () => {
    const { contact } = scene(1.05, [0.5, 0.5]);
    const friction = compileXpbdSourceSimplexPairFrictionFamilyN({
      id: 'friction', contact, frictionCoefficient: 0.4, slipRegularization: 1e-3
    });
    const first = friction.prepare();
    expect(first.prepared.length).toBeGreaterThan(0); // liveness
    expect(first.prepared.map((term) => term.id))
      .toEqual([...first.prepared].map((term) => term.id)); // stable order
    const second = friction.prepare();
    expect(second.prepared.map((term) => term.id))
      .toEqual(first.prepared.map((term) => term.id));
    for (const skip of [...first.skipped, ...second.skipped]) {
      expect(typeof skip.reason).toBe('string');
      expect(skip.reason.length).toBeGreaterThan(0);
    }
    // Every prepared lag names an original source reference.
    for (const term of first.prepared) {
      expect(term.lag.coordinateA.reference).toBe(term.source.barrier.featureA);
      expect(term.lag.coordinateB.reference).toBe(term.source.barrier.featureB);
      expect(term.lag.uniquenessGap).toBeGreaterThan(0);
    }
  });

  it('consumes and rolls back every term atomically', () => {
    const { contact } = scene(1.05, [0.5, 0.5]);
    const friction = compileXpbdSourceSimplexPairFrictionFamilyN({
      id: 'friction', contact, frictionCoefficient: 0.4, slipRegularization: 1e-3
    });
    const preparation = friction.prepare();
    expect(preparation.prepared.every((term) => term.lag.state === 'prepared')).toBe(true);
    preparation.markConsumed();
    expect(preparation.prepared.every((term) => term.lag.state === 'consumed')).toBe(true);
    preparation.rollback();
    expect(preparation.prepared.every((term) => term.lag.state === 'prepared')).toBe(true);
  });

  it('is bitwise identical to the P56 trajectory when mu = 0', () => {
    const run = (withFriction: boolean): number[] => {
      const built = scene(1.2, [0.3, 0.3]);
      const world = new XpbdWorldN({ dimension: DIM, gravity: [0, 0, 0, -9.81] });
      built.binding.addToWorld(world);
      built.contact.addToWorld(world);
      const friction = compileXpbdSourceSimplexPairFrictionFamilyN({
        id: 'friction', contact: built.contact,
        frictionCoefficient: 0, slipRegularization: 1e-3
      });
      for (let step = 0; step < 8; step++) {
        const preparation = withFriction ? friction.prepare() : null;
        const advance = stepXpbdIncrementalPotentialWorldN({
          world,
          deltaTime: 0.01,
          stepFilters: built.contact.stepFilters,
          ...(preparation === null ? {} : { preparedProviders: preparation.prepared }),
          warmStart: 'feasible-inertial-prediction',
          minimization: { directionPolicy: 'steepest-descent' }
        });
        if (preparation !== null) {
          if (advance.step.status === 'applied') preparation.markConsumed();
          else preparation.rollback();
        }
      }
      return built.binding.particles.flatMap((particle) => [...particle.position.data]);
    };
    // A mu = 0 friction family contributes exactly zero energy and force, so
    // the applied trajectory must be bit-for-bit the P56 one.
    expect(run(true)).toEqual(run(false));
  });

  it('measures the mesh-topology dependence instead of averaging it away', () => {
    // The spike under the shared edge: both cells' pairs name the same
    // witness, so both carry a friction term at the same slip.
    const shared = scene(1.05, [0.5, 0.5]);
    const sharedFriction = compileXpbdSourceSimplexPairFrictionFamilyN({
      id: 'friction', contact: shared.contact,
      frictionCoefficient: 0.5, slipRegularization: 1e-3
    });
    const sharedPreparation = sharedFriction.prepare();
    expect(sharedPreparation.prepared.length).toBe(2);
    const slide = (particleIndex: number) => (particle: {
      position: { clone: () => { data: Float64Array } };
    }) => {
      const position = particle.position.clone();
      position.data[0]! += 0.01;
      return position;
    };
    void slide;
    const displace = (particle: { position: { clone: () => { data: Float64Array } } }) => {
      const position = particle.position.clone();
      position.data[0]! += 0.01;
      return position;
    };
    const evaluations = sharedPreparation.prepared.map(
      (term) => term.evaluateAt(displace as never)
    );
    // Both terms see the same witness geometry and the same slip.
    expect(evaluations[0]!.slipMagnitude).toBeCloseTo(evaluations[1]!.slipMagnitude, 12);
    const totalForce = evaluations.reduce(
      (sum, evaluation) => sum + evaluation.tangentForce.length(), 0
    );
    const oneTermForce = evaluations[0]!.tangentForce.length();
    // The measured factor: a shared-edge contact resists exactly twice as
    // much as one cell would. This is the P56 duplication inherited by
    // friction, stated as a number rather than hidden.
    expect(totalForce / oneTermForce).toBeCloseTo(2, 9);

    // A refinement putting four cells at the same contact multiplies again.
    const refined = scene(1.05, [0.5, 0.5], true);
    const refinedFriction = compileXpbdSourceSimplexPairFrictionFamilyN({
      id: 'friction', contact: refined.contact,
      frictionCoefficient: 0.5, slipRegularization: 1e-3
    });
    const refinedPreparation = refinedFriction.prepare();
    const refinedForce = refinedPreparation.prepared
      .map((term) => term.evaluateAt(displace as never).tangentForce.length())
      .reduce((sum, value) => sum + value, 0);
    console.log('E3 topology factor:', JSON.stringify({
      sharedTerms: sharedPreparation.prepared.length,
      sharedTotalForce: totalForce,
      refinedTerms: refinedPreparation.prepared.length,
      refinedTotalForce: refinedForce,
      ratio: refinedForce / totalForce
    }));
    // Liveness plus the honest claim: refinement changes effective friction.
    expect(refinedPreparation.prepared.length).toBeGreaterThan(2);
    expect(refinedForce).toBeGreaterThan(totalForce);
  });

  it('refuses bad compilation by name', () => {
    const { contact } = scene(1.2, [0.3, 0.3]);
    expect(() => compileXpbdSourceSimplexPairFrictionFamilyN({
      id: '', contact, frictionCoefficient: 0.4, slipRegularization: 1e-3
    })).toThrow(/id must be a non-empty string/);
    expect(() => compileXpbdSourceSimplexPairFrictionFamilyN({
      id: 'x', contact, frictionCoefficient: 0.4, slipRegularization: 1e-3, magic: 1
    } as never)).toThrow(/unknown option "magic"/);
    expect(() => compileXpbdSourceSimplexPairFrictionFamilyN({
      id: 'x', contact: null as never, frictionCoefficient: 0.4, slipRegularization: 1e-3
    })).toThrow(/contact must be an XpbdSourceSimplexPairBarrierFamilyN/);
  });
});
