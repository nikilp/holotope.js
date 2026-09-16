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

/**
 * Which coordinate does a shipped preset's window actually classify?
 *
 * NOT by a fill RATIO. `perpendicular[i]` is identically
 * `perpendicularExact[i] / d`, so the ratio between the two fills is `d` for any
 * window, any points, correct or not — it cannot discriminate, and an earlier
 * version of this file asserted exactly that vacuity.
 *
 * Instead each preset's accepted set is compared against the two competing
 * readings of its OWN authored bounds, both recomputed here from
 * `perpendicularExact` with ring arithmetic rather than by calling
 * `ConvexWindow.classify`:
 *
 *   numerator semantics   accept iff  n · numerator <= b
 *   true-coordinate sem.  accept iff  n · (numerator / d) <= b,
 *                         equivalently  n · numerator <= d · b
 *
 * The second admits strictly more points when `d > 1`, so the two disagree on a
 * named, non-empty set — and every disagreeing point is a witness the library
 * must reject. That is what makes these assertions discriminating.
 *
 * FINITE-SAMPLE LIMIT. Each check enumerates one explicit coefficient box. It
 * establishes the contract for the points in that box and nothing beyond it: a
 * window could in principle behave differently outside, and no box proves a
 * property of the infinite lattice. The boxes are chosen small enough to
 * enumerate exactly and large enough that points reach their authored bound.
 */
interface PresetUnderTest {
  readonly name: string;
  readonly denominator: bigint;
  readonly rank: number;
  readonly half: number;
  readonly lattice: LatticeN;
  readonly flat: FlatN;
  /** The window a given coefficient tuple is classified against. */
  windowFor(coefficients: readonly bigint[]): ConvexWindow | null;
  readonly accepted: ReadonlySet<string>;
}

/** `normal . point` in the ring, without going through the window. */
function dot(
  ring: FlatN['ring'],
  normal: readonly ExactValue[],
  point: readonly ExactValue[]
): ExactValue {
  let value = ring.zero;
  for (let i = 0; i < normal.length; i++) {
    value = ring.add(value, ring.mul(normal[i]!, point[i]!));
  }
  return value;
}

/**
 * Enumerate the box and split it by the two competing readings.
 *
 * `boundScale` of 1 is numerator semantics; `d` is true-coordinate semantics.
 */
function acceptedUnder(preset: PresetUnderTest, boundScale: bigint): Set<string> {
  const ring = preset.flat.ring;
  const scale: ExactValue = { a: boundScale, b: 0n };
  const out = new Set<string>();
  const coefficients = new Array<bigint>(preset.rank).fill(0n);
  const visit = (axis: number): void => {
    if (axis === preset.rank) {
      const window = preset.windowFor(coefficients);
      if (!window) return;
      const numerator = preset.flat.projectPerpendicular(preset.lattice.point(coefficients));
      for (const halfspace of window.halfspaces) {
        const value = dot(ring, halfspace.normal, numerator);
        if (ring.compare(value, ring.mul(scale, halfspace.bound)) > 0) return;
      }
      out.add(coefficients.join(','));
      return;
    }
    for (let v = -preset.half; v <= preset.half; v++) {
      coefficients[axis] = BigInt(v);
      visit(axis + 1);
    }
  };
  visit(0);
  return out;
}

/**
 * The largest fraction of any authored bound that the accepted points reach.
 *
 * These two numbers are FLOAT SUMMARIES of facts the set comparisons above
 * already establish exactly. They are reported separately — never as a ratio —
 * and compared with a small tolerance, because summing `normal · perpendicular`
 * in Float64 lands a unit in the last place either side of an exact bound:
 * elser-sloane's true-coordinate fill is exactly 1/6 and evaluates to
 * 0.16666666666666669.
 */
function extents(preset: PresetUnderTest, points: readonly {
  coefficients: readonly bigint[];
  perpendicularExact: readonly ExactValue[];
  perpendicular: Float64Array;
}[]): { numerator: number; trueCoordinate: number } {
  const ring = preset.flat.ring;
  let numerator = -Infinity;
  let trueCoordinate = -Infinity;
  for (const point of points) {
    const window = preset.windowFor(point.coefficients);
    if (!window) continue;
    for (const halfspace of window.halfspaces) {
      const bound = ring.toNumber(halfspace.bound);
      if (Math.abs(bound) < 1e-12) continue;
      numerator = Math.max(
        numerator, ring.toNumber(dot(ring, halfspace.normal, point.perpendicularExact)) / bound
      );
      let divided = 0;
      for (let i = 0; i < halfspace.normal.length; i++) {
        divided += ring.toNumber(halfspace.normal[i]!) * point.perpendicular[i]!;
      }
      trueCoordinate = Math.max(trueCoordinate, divided / bound);
    }
  }
  return { numerator, trueCoordinate };
}

/** One ulp of headroom for the float summaries; the exact work is done above. */
const FILL_EPS = 1e-12;

function check(preset: PresetUnderTest): void {
  const d = preset.denominator;
  const underNumerator = acceptedUnder(preset, 1n);
  const underTrueCoordinate = acceptedUnder(preset, d);

  // The two readings must actually disagree, or nothing below discriminates.
  const onlyUnderTrue = [...underTrueCoordinate].filter((k) => !underNumerator.has(k));
  expect(onlyUnderTrue.length, `${preset.name}: the two semantics agree on this box, so it cannot discriminate`)
    .toBeGreaterThan(0);

  // Every point the library accepted satisfies the NUMERATOR reading of the
  // preset's own bounds. Under the other reading a point may exceed a bound by
  // up to a factor of d, so this fails there.
  for (const key of preset.accepted) {
    expect(underNumerator.has(key), `${preset.name}: accepted ${key} violates n . numerator <= b`).toBe(true);
  }

  // Concrete witnesses: every point the true-coordinate reading would admit and
  // the numerator reading would not is rejected by the library.
  for (const key of onlyUnderTrue) {
    expect(preset.accepted.has(key), `${preset.name}: ${key} is admitted only by true-coordinate semantics, but was accepted`).toBe(false);
  }
}

describe('each preset classifies the numerator, not the divided coordinate', () => {
  it('ammann-beenker, denominator 4', () => {
    // 'exclude' rather than the default 'error': under the competing semantics
    // this preset meets a singular cut and throws, and a throw would let the
    // check pass for a reason that has nothing to do with the contract. With a
    // tie-break that does not throw, what fails is the witness assertion.
    const model = createAmmannBeenkerModelSet('exclude');
    expect(model.flat.perpendicularDenominator).toBe(4n);
    const half = 4;
    const patch = model.sample({
      coefficientRanges: Array.from({ length: 4 }, () => ({ min: -half, max: half }))
    });
    const preset: PresetUnderTest = {
      name: 'ammann-beenker', denominator: 4n, rank: 4, half,
      lattice: model.lattice, flat: model.flat,
      windowFor: () => model.window,
      accepted: new Set(patch.points.map((p) => p.coefficients.join(',')))
    };
    check(preset);
    const { numerator, trueCoordinate } = extents(preset, patch.points);
    // Reported separately, never as a ratio. The numerator reaches its authored
    // bound; the divided coordinate cannot exceed a quarter of it.
    expect(numerator).toBeLessThanOrEqual(1 + FILL_EPS);
    expect(numerator).toBeGreaterThan(0.9);
    expect(trueCoordinate).toBeLessThanOrEqual(1 / 4 + FILL_EPS);
  });

  it('penrose, denominator 7, per window class', () => {
    const model = createPenroseModelSet();
    expect(model.flat.perpendicularDenominator).toBe(7n);
    const half = 5;
    const patch = model.sample({
      coefficientRanges: Array.from({ length: 4 }, () => ({ min: -half, max: half }))
    });
    // The class rule is sum(coefficients) mod 5, with residue 0 carrying no
    // window; recomputed here rather than read off the produced points.
    const classOf = (coefficients: readonly bigint[]): ConvexWindow | null => {
      const residue = Number(((coefficients.reduce((s, v) => s + v, 0n) % 5n) + 5n) % 5n);
      return residue === 0 ? null : model.windows.get(residue as 1 | 2 | 3 | 4) ?? null;
    };
    const preset: PresetUnderTest = {
      name: 'penrose', denominator: 7n, rank: 4, half,
      lattice: model.lattice, flat: model.flat, windowFor: classOf,
      accepted: new Set(patch.points.map((p) => p.coefficients.join(',')))
    };
    check(preset);
    const { numerator, trueCoordinate } = extents(preset, patch.points);
    expect(numerator).toBeLessThanOrEqual(1 + FILL_EPS);
    expect(numerator).toBeGreaterThan(0.9);
    expect(trueCoordinate).toBeLessThanOrEqual(1 / 7 + FILL_EPS);
  });

  it('elser-sloane, denominator 6', () => {
    const model = createElserSloaneModelSet();
    expect(model.flat.perpendicularDenominator).toBe(6n);
    const half = 1;
    const patch = model.sample({
      coefficientRanges: Array.from({ length: 8 }, () => ({ min: -half, max: half }))
    });
    const preset: PresetUnderTest = {
      name: 'elser-sloane', denominator: 6n, rank: 8, half,
      lattice: model.lattice, flat: model.flat,
      windowFor: () => model.window,
      accepted: new Set(patch.points.map((p) => p.coefficients.join(',')))
    };
    check(preset);
    const { numerator, trueCoordinate } = extents(preset, patch.points);
    expect(numerator).toBeLessThanOrEqual(1 + FILL_EPS);
    expect(numerator).toBeGreaterThan(0.9);
    expect(trueCoordinate).toBeLessThanOrEqual(1 / 6 + FILL_EPS);
  });

  it('akn, denominator 7 under a phason offset', () => {
    const model = createAKNModelSet({ phasonOffsetSevenths: [Z(1, 0), Z(1, 0), Z(2, 0)] });
    expect(model.flat.perpendicularDenominator).toBe(7n);
    const half = 2;
    const patch = model.sample({
      coefficientRanges: Array.from({ length: 6 }, () => ({ min: -half, max: half }))
    });
    const preset: PresetUnderTest = {
      name: 'akn', denominator: 7n, rank: 6, half,
      lattice: model.lattice, flat: model.flat,
      windowFor: () => model.window,
      accepted: new Set(patch.points.map((p) => p.coefficients.join(',')))
    };
    check(preset);
    const { numerator, trueCoordinate } = extents(preset, patch.points);
    expect(numerator).toBeLessThanOrEqual(1 + FILL_EPS);
    expect(numerator).toBeGreaterThan(0.9);
    expect(trueCoordinate).toBeLessThanOrEqual(1 / 7 + FILL_EPS);
  });
});
