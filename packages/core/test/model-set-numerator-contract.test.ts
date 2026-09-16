import { describe, expect, it } from 'vitest';
import {
  ConvexWindow,
  FlatN,
  LatticeN,
  ModelSet,
  createAKNModelSet,
  createAmmannBeenkerModelSet,
  createElserSloaneModelSet,
  createPenroseModelSet,
  integerRing,
  phiRing,
  type ExactValue
} from '@holotope/core';

/**
 * The numerator-coordinate contract.
 *
 * `FlatN` stores projections and offsets as NUMERATORS; the denominator is
 * applied only when rendering Float64. `ConvexWindow` classifies that undivided
 * numerator. So a window used with `perpendicularDenominator: d` must have its
 * bounds scaled by `d`, and so must any offset.
 *
 * These tests exist because the previous suite could not see a change to that
 * contract: the one test using a non-unit denominator asserted only that the
 * box and window-pruned samplers agreed with EACH OTHER, and they share the
 * classifier. Every assertion below pins the accepted SET against a value
 * derived without the classifier.
 */

const E = (a: number | bigint): ExactValue => ({ a: BigInt(a), b: 0n });
const Z = (a: number | bigint, b: number | bigint): ExactValue =>
  ({ a: BigInt(a), b: BigInt(b) });

/* ------------------------------------------------------------------ *
 * An oracle over the integers, independent of the library
 * ------------------------------------------------------------------ */

const D = 3n;
const RANGE = 6;

/** Accepted iff -1 <= (2*x0 - x1 + t)/3 <= 1, lower included, upper excluded. */
function oracleAccept(trueOffsetNumerator: bigint): string[] {
  const out: string[] = [];
  for (let x0 = -RANGE; x0 <= RANGE; x0++) {
    for (let x1 = -RANGE; x1 <= RANGE; x1++) {
      const numerator = 2n * BigInt(x0) - BigInt(x1) + trueOffsetNumerator;
      // -1 <= n/3  <=>  -3 <= n ; n/3 <= 1  <=>  n <= 3, excluded at equality
      if (numerator < -D) continue;
      if (numerator >= D) continue;
      out.push(`${x0},${x1}`);
    }
  }
  return out;
}

function build(boundNumerator: number, offsetNumerator: number): ModelSet {
  return new ModelSet(
    LatticeN.integer(integerRing, 2),
    new FlatN({
      ring: integerRing,
      parallelProjection: [[integerRing.one, integerRing.one]],
      perpendicularProjection: [[E(2), E(-1)]],
      perpendicularOffset: [E(offsetNumerator)],
      perpendicularDenominator: D
    }),
    new ConvexWindow(integerRing, 1, [
      { normal: [E(-1)], bound: E(boundNumerator), boundary: 'include' },
      { normal: [E(1)], bound: E(boundNumerator), boundary: 'exclude' }
    ]),
    'exclude'
  );
}

const ranges = [{ min: -RANGE, max: RANGE }, { min: -RANGE, max: RANGE }];
const keysOf = (model: ModelSet, strategy?: 'window-pruned'): string[] =>
  model
    .sample(strategy ? { coefficientRanges: ranges, strategy } : { coefficientRanges: ranges })
    .points.map((p) => p.coefficients.join(','));

describe('the window classifies the undivided perpendicular numerator', () => {
  it('a bound scaled by the denominator accepts the oracle set exactly', () => {
    const accepted = keysOf(build(3, 0), 'window-pruned');
    expect(accepted).toEqual(oracleAccept(0n));
    expect(accepted.length).toBe(39);
  });

  it('the same bound left unscaled accepts a region D times narrower', () => {
    // This is the discriminating case. If classification ever started dividing
    // the coordinate, THIS would become the correct authoring and the test
    // above would break — which is the point of asserting both.
    const unscaled = keysOf(build(1, 0), 'window-pruned');
    expect(unscaled).not.toEqual(oracleAccept(0n));
    expect(unscaled.length).toBeLessThan(39);
    // It is exactly the window |y| <= 1/3.
    const narrower = oracleAccept(0n).filter((k) => {
      const [x0, x1] = k.split(',').map(Number) as [number, number];
      const n = 2n * BigInt(x0) - BigInt(x1);
      return n >= -1n && n < 1n;
    });
    expect(unscaled).toEqual(narrower);
  });

  it('box and window-pruned each match the oracle, not merely each other', () => {
    // Both samplers share ConvexWindow.classify, so agreement between them
    // cannot detect a wrong classifier. Each is compared to the oracle.
    const model = build(3, 0);
    expect(keysOf(model)).toEqual(oracleAccept(0n));
    expect(keysOf(model, 'window-pruned')).toEqual(oracleAccept(0n));
  });

  it('every accepted key is distinct, so a set comparison hides nothing', () => {
    const accepted = keysOf(build(3, 0), 'window-pruned');
    expect(new Set(accepted).size).toBe(accepted.length);
  });
});

describe('the perpendicular offset is in numerator units too', () => {
  it('a stored offset of D*t produces a true shift of t', () => {
    expect(keysOf(build(3, 6), 'window-pruned')).toEqual(oracleAccept(2n * D));
  });

  it('a stored offset of t produces a true shift of t/D, not t', () => {
    // The trap: writing the offset you mean gives you it divided by D.
    const asWritten = keysOf(build(3, 2), 'window-pruned');
    expect(asWritten).not.toEqual(oracleAccept(2n * D));
    expect(asWritten).toEqual(oracleAccept(2n));
  });

  it('a zero offset reproduces the unshifted set', () => {
    expect(keysOf(build(3, 0), 'window-pruned')).toEqual(oracleAccept(0n));
  });
});

describe('scaling a bound by the denominator is exact at the facets', () => {
  it('moves no point across a facet and changes no boundary decision', () => {
    // n . numerator = D * b holds exactly when n . (numerator / D) = b, so a
    // point ON a facet stays on it.
    const model = build(3, 0);
    const patch = model.sample({ coefficientRanges: ranges, strategy: 'window-pruned' });
    const onFacet = patch.points.filter((p) => p.windowLocation === 'boundary');
    expect(onFacet.length).toBeGreaterThan(0);
    for (const point of onFacet) {
      const n = point.perpendicularExact[0]!;
      // Every boundary point sits exactly on the scaled bound, in the ring.
      expect(Math.abs(Number(n.a))).toBe(3);
      expect(n.b).toBe(0n);
    }
    // The included facet is accepted and the excluded one is not.
    const keys = patch.points.map((p) => p.coefficients.join(','));
    expect(keys).toEqual(oracleAccept(0n));
  });
});

describe('every shipped preset authors its window in numerator units', () => {
  /**
   * Measured rather than asserted: for each accepted point, how much of each
   * halfspace bound the numerator uses against how much the divided Float64
   * coordinate uses. The ratio is the denominator when the window is authored
   * in numerator units.
   */
  function fillRatio(
    flat: { ring: typeof phiRing; perpendicularDenominator: bigint },
    windows: readonly ConvexWindow[],
    points: readonly { perpendicularExact: readonly ExactValue[]; perpendicular: Float64Array }[]
  ): number {
    let worstNumerator = -Infinity;
    let worstFloat = -Infinity;
    for (const point of points) {
      for (const window of windows) {
        for (const halfspace of window.halfspaces) {
          let numerator = 0;
          let divided = 0;
          for (let i = 0; i < halfspace.normal.length; i++) {
            const n = flat.ring.toNumber(halfspace.normal[i]!);
            numerator += n * flat.ring.toNumber(point.perpendicularExact[i]!);
            divided += n * point.perpendicular[i]!;
          }
          const bound = flat.ring.toNumber(halfspace.bound);
          if (Math.abs(bound) < 1e-12) continue;
          worstNumerator = Math.max(worstNumerator, numerator / bound);
          worstFloat = Math.max(worstFloat, divided / bound);
        }
      }
    }
    return worstNumerator / worstFloat;
  }

  it('ammann-beenker, at denominator 4', () => {
    const model = createAmmannBeenkerModelSet();
    const patch = model.sample({
      coefficientRanges: Array.from({ length: 4 }, () => ({ min: -4, max: 4 }))
    });
    expect(Number(model.flat.perpendicularDenominator)).toBe(4);
    expect(fillRatio(model.flat, [model.window], patch.points)).toBeCloseTo(4, 6);
  });

  it('penrose, at denominator 7, each point against its own window class', () => {
    const model = createPenroseModelSet();
    const patch = model.sample({
      coefficientRanges: Array.from({ length: 4 }, () => ({ min: -5, max: 5 }))
    });
    expect(Number(model.flat.perpendicularDenominator)).toBe(7);
    let worstNumerator = -Infinity;
    let worstFloat = -Infinity;
    for (const point of patch.points) {
      const window = model.windows.get(point.windowClass)!;
      for (const halfspace of window.halfspaces) {
        let numerator = 0;
        let divided = 0;
        for (let i = 0; i < halfspace.normal.length; i++) {
          const n = phiRing.toNumber(halfspace.normal[i]!);
          numerator += n * phiRing.toNumber(point.perpendicularExact[i]!);
          divided += n * point.perpendicular[i]!;
        }
        const bound = phiRing.toNumber(halfspace.bound);
        if (Math.abs(bound) < 1e-12) continue;
        worstNumerator = Math.max(worstNumerator, numerator / bound);
        worstFloat = Math.max(worstFloat, divided / bound);
      }
    }
    expect(worstNumerator / worstFloat).toBeCloseTo(7, 6);
  });

  it('elser-sloane, at denominator 6', () => {
    const model = createElserSloaneModelSet();
    const patch = model.sample({
      coefficientRanges: Array.from({ length: 8 }, () => ({ min: -1, max: 1 }))
    });
    expect(Number(model.flat.perpendicularDenominator)).toBe(6);
    expect(fillRatio(model.flat, [model.window], patch.points)).toBeCloseTo(6, 6);
  });

  it('akn, at denominator 7 under a phason offset', () => {
    const model = createAKNModelSet({
      phasonOffsetSevenths: [Z(1, 0), Z(1, 0), Z(2, 0)]
    });
    const patch = model.sample({
      coefficientRanges: Array.from({ length: 6 }, () => ({ min: -2, max: 2 }))
    });
    expect(Number(model.flat.perpendicularDenominator)).toBe(7);
    expect(fillRatio(model.flat, [model.window], patch.points)).toBeCloseTo(7, 6);
  });
});
