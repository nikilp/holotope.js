import { VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneBarrierN,
  XpbdParticleHyperplaneBarrierStepFilterN,
  XpbdParticleN,
  evaluateClampedLogBarrier
} from '../src/index.js';

/**
 * Cross-dimension *agreement*, which is a different claim from per-dimension
 * correctness.
 *
 * The suite already checks each of R1, R2, R4, and R7 against analytic values,
 * which establishes that every dimension is right. It does not establish that
 * the dimensions compute the *same thing* — a law could be correct in each and
 * still carry an ambient-dimension term that happens to match its own
 * expectation everywhere.
 *
 * The barrier stack is a function of one signed distance. Ambient dimension is
 * where the distance is measured, never part of the answer, so the same
 * configuration expressed in more axes must produce identical doubles.
 */

const DIMENSIONS = [1, 2, 4, 7] as const;

/** The same point-and-plane configuration, described in `dimension` axes. */
function configuration(dimension: number, distance: number) {
  const normal = new Array<number>(dimension).fill(0);
  normal[0] = 1;
  const position = new Array<number>(dimension).fill(0);
  position[0] = distance;
  // Fill the unused axes so the case is not accidentally degenerate: they must
  // not reach the answer, and a plane of zeros could hide it if they did.
  for (let axis = 1; axis < dimension; axis++) position[axis] = 0.3 * axis;

  const particle = new XpbdParticleN({
    id: `p/${dimension}`,
    position: new VecN(position)
  });
  const plane = new HyperplaneColliderN(new VecN(normal), 0);
  const barrier = new XpbdParticleHyperplaneBarrierN({
    id: `barrier/${dimension}`,
    particle,
    plane,
    activationDistance: 0.1,
    stiffness: 3
  });
  return { particle, plane, barrier };
}

describe('the barrier stack agrees across ambient dimensions', () => {
  it('gives one energy for one signed distance', () => {
    for (const distance of [0.02, 0.05, 0.09, 0.1, 0.4]) {
      const energies = DIMENSIONS.map((dimension) =>
        configuration(dimension, distance).barrier.evaluate().potentialEnergy
      );
      // Identical doubles, not merely close: nothing here depends on dimension.
      expect(new Set(energies).size, `distance ${distance}`).toBe(1);

      // And the value is the scalar law's, so the vector wrapper adds nothing.
      const scalar = distance >= 0.1
        ? 0
        : evaluateClampedLogBarrier({
          coordinate: distance, activation: 0.1, stiffness: 3
        }).energy;
      expect(energies[0]).toBeCloseTo(scalar, 12);
    }
  });

  it('gives one force magnitude, directed along the normal in every dimension', () => {
    const magnitudes = DIMENSIONS.map((dimension) => {
      const { barrier } = configuration(dimension, 0.04);
      const force = barrier.evaluate().forces[0]!;
      // The force lies along the plane normal: every other component is zero,
      // so the extra axes really are inert rather than merely small.
      for (let axis = 1; axis < dimension; axis++) {
        expect(force.data[axis]!).toBe(0);
      }
      return force.data[0]!;
    });
    expect(new Set(magnitudes).size).toBe(1);
    // Pushing away from the plane.
    expect(magnitudes[0]!).toBeGreaterThan(0);
  });

  it('certifies the same fraction of a crossing segment in every dimension', () => {
    const certified = DIMENSIONS.map((dimension) => {
      const { particle, barrier } = configuration(dimension, 0.5);
      const filter = new XpbdParticleHyperplaneBarrierStepFilterN({
        id: `filter/${dimension}`,
        barrier
      });
      const before = particle.position.clone();
      const after = particle.position.clone();
      after.data[0] = -0.5; // straight through the plane, in any dimension

      const evaluation = filter.evaluate({
        dimension,
        requestedStepLength: 1,
        positionBefore: () => before.clone(),
        positionAfter: () => after.clone()
      });
      expect(evaluation.status).toBe('limited');
      return evaluation.impactFraction;
    });
    // The crossing is at the same parameter regardless of how many axes the
    // segment is embedded in.
    expect(new Set(certified).size).toBe(1);
    expect(certified[0]).toBeCloseTo(0.5, 12);
  });

  it('keeps compact support at the same distance in every dimension', () => {
    // Just outside the activation radius the barrier must contribute exactly
    // nothing, and "exactly" must not become "nearly" as axes are added.
    const outside = DIMENSIONS.map((dimension) =>
      configuration(dimension, 0.1).barrier.evaluate()
    );
    for (const evaluation of outside) {
      expect(evaluation.potentialEnergy).toBe(0);
      for (const component of evaluation.forces[0]!.data) {
        // Magnitude, because an inactive barrier produces signed zeros where a
        // zero derivative is scaled by a negative normal component. `-0` is
        // zero force; the distinction matters to the snapshot codec, which
        // must round-trip it, and not to the physics.
        expect(Math.abs(component)).toBe(0);
      }
    }
  });
});
