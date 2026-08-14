/**
 * The point--simplex barrier's typed uncertainty boundary, protected here in
 * the RELEASED package rather than in private measurements.
 *
 * Everything in this file is load-bearing behaviour a consumer can observe:
 * which error type is thrown, which typed reason it carries, whether the
 * direction policy admits equality, whether the step filter consults the
 * segment endpoint, and whether a refusal fabricates evidence it never had.
 * Each was previously guarded only by Kitchen measurements that do not ship —
 * so a regression reached `packages/physics` without any released test noticing.
 */

import {
  CellComplex,
  type CellGroup,
  VecN,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  type SourceSimplexReferenceN
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdParticleSourceSimplexBarrierN,
  XpbdParticleSourceSimplexBarrierStepFilterN,
  XpbdPotentialDomainErrorN,
  compileXpbdIncrementalPotentialProblemN,
  evaluateExactPointSimplexResult,
  searchXpbdIncrementalPotentialArmijoN,
  type XpbdParticleSourceSimplexBarrierDomainReasonN
} from '../src/index.js';

function simplexOf(
  ambientDim: number,
  vertices: readonly (readonly number[])[],
  key = 'uncertainty'
): { complex: CellComplex, reference: SourceSimplexReferenceN } {
  const group: CellGroup = {
    dim: vertices.length - 1,
    verticesPerCell: vertices.length,
    kind: 'simplex',
    indices: Uint32Array.from(vertices.map((_, index) => index))
  };
  const complex = new CellComplex(
    ambientDim, Float64Array.from(vertices.flat()), [{ ...group, key }]
  );
  return {
    complex,
    reference: createSourceSimplexReferenceN(
      createSourceCellReferenceN(complex, complex.groups[0]!, 0)
    )
  };
}

function rig(options: {
  readonly position: readonly number[];
  readonly rows: readonly (readonly number[])[];
  readonly ambientDim?: number;
  readonly maximumDirectionError?: number;
  readonly activationDistance?: number;
  readonly minimumDistance?: number;
}) {
  const { reference } = simplexOf(
    options.ambientDim ?? 2, options.rows, 'uncertainty-rig');
  const particle = new XpbdParticleN({
    id: 'point', position: new VecN([...options.position]), inverseMass: 1 });
  const barrier = new XpbdParticleSourceSimplexBarrierN({
    id: 'barrier', particle, simplex: reference,
    activationDistance: options.activationDistance ?? 50,
    minimumDistance: options.minimumDistance ?? 0,
    stiffness: 1,
    maximumDirectionError: options.maximumDirectionError ?? 2 ** -12
  });
  const filter = new XpbdParticleSourceSimplexBarrierStepFilterN({
    id: 'filter', barrier });
  return { particle, barrier, filter };
}

function context(before: readonly number[], after: readonly number[]) {
  return {
    dimension: before.length,
    requestedStepLength: 1,
    positionBefore: () => new VecN([...before]),
    positionAfter: () => new VecN([...after])
  };
}

/**
 * One fixture per exact publication reason, each verified against the query
 * itself so a fixture that stops producing its reason fails loudly instead of
 * quietly testing nothing.
 */
const PUBLICATION_FIXTURES = [
  {
    reason: 'accuracy-bound-overflow',
    forwarded: 'point-simplex-accuracy-bound-overflow',
    position: [7, Number.MIN_VALUE], rows: [[0, 0], [25, 0]]
  },
  {
    reason: 'value-overflow',
    forwarded: 'point-simplex-value-overflow',
    position: [7 * 2 ** 600, 2 ** (600 - 1074 + 53)],
    rows: [[0, 0], [25 * 2 ** 600, 0]]
  },
  {
    reason: 'value-underflow',
    forwarded: 'point-simplex-value-underflow',
    position: [2 ** -1070, 2 ** -1070], rows: [[0, 0], [2 ** -1070, 0]]
  },
  {
    reason: 'weight-underflow',
    forwarded: 'point-simplex-weight-underflow',
    position: [5e-324, 2 ** -1074], rows: [[0, 0], [2 ** 500, 0]]
  }
] as const;

describe('point--simplex barrier: the typed uncertainty boundary', () => {
  it('publishes each fixture\'s reason from the exact query itself', () => {
    for (const fixture of PUBLICATION_FIXTURES) {
      const query = evaluateExactPointSimplexResult(
        Float64Array.from(fixture.position),
        Float64Array.from(fixture.rows.flat()), fixture.position.length);
      expect(query.status, fixture.reason).toBe('uncertified');
      expect(query.status === 'uncertified' && query.reason)
        .toBe(fixture.reason);
    }
  });

  it('refuses with a typed domain error, never a bare Error', () => {
    for (const fixture of PUBLICATION_FIXTURES) {
      const { barrier } = rig(fixture);
      let thrown: unknown;
      try {
        barrier.evaluate();
      } catch (error) {
        thrown = error;
      }
      // A bare `Error` here would destroy the classification the exact query
      // paid for, leaving callers to parse a message.
      expect(thrown, fixture.reason).toBeInstanceOf(XpbdPotentialDomainErrorN);
      expect((thrown as XpbdPotentialDomainErrorN<string>).reason)
        .toBe(fixture.forwarded);
    }
  });

  it('forwards all four reasons one-to-one, never collapsed', () => {
    const forwarded = new Set<string>();
    for (const fixture of PUBLICATION_FIXTURES) {
      const { barrier } = rig(fixture);
      try {
        barrier.evaluate();
      } catch (error) {
        forwarded.add((error as XpbdPotentialDomainErrorN<string>).reason);
      }
    }
    // Four distinct causes with four distinct recoveries stay four reasons.
    expect(forwarded.size).toBe(4);
    expect([...forwarded].sort()).toEqual(
      PUBLICATION_FIXTURES.map((fixture) => fixture.forwarded).slice().sort());
  });

  it('classifies identically through evaluate and evaluateAt', () => {
    for (const fixture of PUBLICATION_FIXTURES) {
      const { particle, barrier } = rig(fixture);
      const reasons = new Set<string>();
      for (const call of [
        () => barrier.evaluate(),
        () => barrier.evaluateAt(
          (query) => query === particle
            ? new VecN([...fixture.position]) : null)
      ]) {
        try {
          call();
        } catch (error) {
          reasons.add((error as XpbdPotentialDomainErrorN<string>).reason);
        }
      }
      expect(reasons, fixture.reason).toEqual(new Set([fixture.forwarded]));
    }
  });
});

describe('point--simplex barrier: the direction-error policy', () => {
  /** An exact arm whose published direction bound is strictly positive. */
  function policyProbe(maximumDirectionError: number) {
    return rig({
      position: [7, 2 ** -30], rows: [[0, 0], [25, 0]],
      maximumDirectionError
    });
  }

  it('admits a bound exactly equal to the policy', () => {
    const bound = policyProbe(2 ** -12).barrier.evaluate()
      .pointSimplex.error.directionErrorBound;
    expect(bound).toBeGreaterThan(0);

    // Equality is ADMITTED: the policy is the largest bound a caller accepts,
    // so `bound === policy` satisfies it. Only `bound > policy` refuses.
    const evaluated = policyProbe(bound).barrier.evaluate();
    expect(evaluated.pointSimplex.error.directionErrorBound).toBe(bound);
  });

  it('refuses a bound strictly above the policy, with a typed reason', () => {
    const bound = policyProbe(2 ** -12).barrier.evaluate()
      .pointSimplex.error.directionErrorBound;
    // The largest Float64 strictly below the measured bound: the tightest
    // possible refusing policy, so the test pins the boundary rather than a
    // comfortable margin far from it.
    const justBelow = Math.nextafter === undefined
      ? bound * (1 - 2 ** -52)
      : Math.nextafter(bound, 0);
    let thrown: unknown;
    try {
      policyProbe(justBelow).barrier.evaluate();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(XpbdPotentialDomainErrorN);
    expect((thrown as XpbdPotentialDomainErrorN<
      XpbdParticleSourceSimplexBarrierDomainReasonN>).reason)
      .toBe('direction-error-exceeds-policy');
  });

  it('applies the policy at evaluateAt as well as evaluate', () => {
    const bound = policyProbe(2 ** -12).barrier.evaluate()
      .pointSimplex.error.directionErrorBound;
    const justBelow = Math.nextafter === undefined
      ? bound * (1 - 2 ** -52)
      : Math.nextafter(bound, 0);
    const { particle, barrier } = policyProbe(justBelow);
    // A one-sided policy — honoured by `evaluate` but not `evaluateAt` — would
    // let a search step past the accuracy a caller demanded.
    expect(() => barrier.evaluateAt(
      (query) => query === particle ? new VecN([7, 2 ** -30]) : null))
      .toThrow(XpbdPotentialDomainErrorN);
  });
});

describe('point--simplex step filter: start-state certification', () => {
  /**
   * Start `4u`, endpoint `u` with `u = 2^-475` against a `2^600`-scale segment.
   * The difference is exactly representable, so the endpoint really is the
   * requested one; the start publishes, the endpoint does not, and a half step
   * publishes — so a positive certified prefix demonstrably exists.
   */
  const UNIT = 2 ** -475;
  const HUGE = [[0, 0], [2 ** 600, 0]] as const;

  function unpublishableEndpoint() {
    return rig({ position: [4 * UNIT, 1], rows: HUGE, activationDistance: 4 });
  }

  it('the fixture is honest: start publishes, endpoint does not', () => {
    const packed = Float64Array.from(HUGE.flat());
    const at = (x: number) => evaluateExactPointSimplexResult(
      Float64Array.of(x, 1), packed, 2).status;
    expect(at(4 * UNIT)).toBe('projected');
    expect(at(UNIT)).not.toBe('projected');
    expect(4 * UNIT + 1 * (UNIT - 4 * UNIT)).toBe(UNIT);
  });

  it('certifies a segment whose endpoint cannot be published', () => {
    const { barrier, filter } = unpublishableEndpoint();
    expect(barrier.evaluate().distance).toBe(1);

    const evaluated = filter.evaluate(context([4 * UNIT, 1], [UNIT, 1]));
    // Distance to a convex set is convex and 1-Lipschitz, so the certificate
    // is a statement about the start state and the displacement vector. An
    // endpoint the exact query declines to publish cannot invalidate it.
    expect(evaluated.status).toBe('safe');
    expect(evaluated.certifiedFraction).toBe(1);
    expect(evaluated.startDistance).toBe(1);
  });

  it('reports no endpoint evidence in any result', () => {
    const { filter } = unpublishableEndpoint();
    const evaluated = filter.evaluate(context([4 * UNIT, 1], [UNIT, 1]));
    // Deleted, not zeroed and not NaN: there is no endpoint query to report.
    expect('endDistance' in evaluated).toBe(false);
    expect('endMargin' in evaluated).toBe(false);
  });

  it('lets Armijo backtrack instead of refusing the whole search', () => {
    const { particle, barrier, filter } = unpublishableEndpoint();
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 2, particles: [particle],
      predictedPositions: [new VecN([UNIT, 1])],
      deltaTime: 1 / 60, providers: [barrier], stepFilters: [filter] });
    const search = searchXpbdIncrementalPotentialArmijoN({
      problem, coordinates: Float64Array.of(4 * UNIT, 1),
      direction: Float64Array.of(UNIT - 4 * UNIT, 0),
      initialStep: 1, contractionFactor: 0.5 });

    // A filter that refuses on the endpoint gives the search zero trials, so
    // no typed provider reason can ever reach a backtrack.
    expect(search.status).not.toBe('step-filter-refused');
    expect(search.trials.length).toBeGreaterThan(0);
  });

  it('refuses an UNPUBLISHABLE start with the forwarded typed reason', () => {
    for (const fixture of PUBLICATION_FIXTURES) {
      const { filter } = rig(fixture);
      const evaluated = filter.evaluate(context(
        fixture.position, fixture.position.map((x) => x * 0.5)));

      expect(evaluated.status, fixture.reason).toBe('indeterminate');
      expect(evaluated.status === 'indeterminate' && evaluated.reason)
        .toBe(fixture.forwarded);
      expect(evaluated.certifiedFraction).toBe(0);
    }
  });

  it('fabricates no evidence when the start could not be published', () => {
    for (const fixture of PUBLICATION_FIXTURES) {
      const evaluated = rig(fixture).filter.evaluate(context(
        fixture.position, fixture.position.map((x) => x * 0.5)));

      // No certified start distance exists, so none is reported. `NaN`, `0`,
      // and a sentinel are all indistinguishable from a measurement at the
      // call site; absence is not.
      expect('startDistance' in evaluated, fixture.reason).toBe(false);
      expect('startMargin' in evaluated).toBe(false);
      expect('startDirectionalDerivative' in evaluated).toBe(false);
      expect('maximumStepLength' in evaluated).toBe(false);
      expect('certification' in evaluated).toBe(false);
      for (const value of Object.values(evaluated)) {
        expect(Number.isNaN(value)).toBe(false);
      }
    }
  });

  it('separates an unpublishable start from a violated one', () => {
    // Same refusal status, different claims: one says the start is provably
    // inside the floor, the other says it could not be decided at all.
    const violated = rig({
      position: [7, 0.01], rows: [[0, 0], [25, 0]], minimumDistance: 0.05
    }).filter.evaluate(context([7, 0.01], [7, 0.02]));
    expect(violated.status).toBe('indeterminate');
    expect(violated.status === 'indeterminate' && violated.reason)
      .toBe('initial-domain-violation');
    // A violation is ESTABLISHED from published evidence, so it reports it.
    expect(violated.startDistance).toBeCloseTo(0.01, 15);
    expect(violated.startMargin).toBeLessThanOrEqual(0);
  });
});
