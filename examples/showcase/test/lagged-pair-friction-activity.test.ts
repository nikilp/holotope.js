import { describe, expect, it } from 'vitest';
import { runLaggedFrictionContract } from '../src/lagged-pair-friction-contract.js';

/**
 * The friction example exists to put a force-carrying contact beside an inert
 * one, so its active side has to press with a force a reader can believe.
 *
 * `contactActive` is exactly `frictionCoefficient * laggedNormalForce > 0`, so
 * it reads `true` for any positive product — including the ~1e-31 the clamped-log
 * barrier produces when the pair sits at exactly the activation distance. That
 * is a correct flag on a meaningless bound, and it would quietly undercut the
 * distinction the example is here to draw. This pins the demonstrated contact
 * well clear of that.
 */
describe('lagged pair friction example: the active side actually presses', () => {
  it('reports a physically meaningful Coulomb bound, not a boundary artifact', () => {
    const report = runLaggedFrictionContract();
    expect(report.slidingContactActive).toBe(true);
    // Orders of magnitude above the barrier's activation-boundary floor.
    expect(report.laggedNormalForce).toBeGreaterThan(1e-3);
    expect(report.forceLimit).toBeGreaterThan(1e-3);
    // And the bound is still exactly the coefficient times the lagged normal.
    expect(report.forceLimit).toBeCloseTo(0.5 * report.laggedNormalForce, 12);
  });
});
