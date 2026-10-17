import { describe, expect, it } from 'vitest';
import { BivectorN, Rotor4, TransformN, VecN } from '@holotope/core';
import {
  HyperboxSupportShape4,
  gjkDistance,
  hyperboxContactPatch4,
  hyperboxSat4
} from '../src/index.js';

/**
 * Near-parallel candidate axes in `hyperboxSat4`.
 *
 * Two candidates 1e-7 rad apart are one direction to the duplicate filter, but
 * their overlaps differ by about 0.05·theta here: far above the selector's tie
 * band. Discarding the later one unevaluated lost the minimum translation, so
 * aligning A overshot into separation and the contact enumerator found nothing,
 * and it could discard the only separating axis. Every candidate is now
 * evaluated, and each direction keeps its most decisive member.
 *
 * Two references here do not call `hyperboxSat4`:
 * - every one of the 56 candidate axes, built and evaluated in this file with
 *   no deduplication;
 * - a Chebyshev LP over all of R4 for the posed pair: maximise `t` subject to
 *   `n·x + t <= o` for all sixteen unit face halfspaces. `t > 0` is a solid
 *   overlap, `t = 0` touching, `t < 0` apart.
 */

type Half = { readonly n: readonly number[]; readonly o: number };
const dot = (a: readonly number[], b: readonly number[]): number =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!;
const coords = (v: VecN): number[] => [v.data[0]!, v.data[1]!, v.data[2]!, v.data[3]!];

function halfspaces(box: HyperboxSupportShape4, shift: readonly number[] = [0, 0, 0, 0]): Half[] {
  const center = coords(box.center).map((x, k) => x + shift[k]!);
  return box.worldAxes().flatMap((axis, k) => {
    const u = coords(axis);
    const d = dot(u, center);
    const h = box.halfExtents[k]!;
    return [{ n: u, o: d + h }, { n: u.map((x) => -x), o: -d + h }];
  });
}

/** Exhaustive vertex enumeration of the Chebyshev LP: every 5-subset of active faces. */
function chebyshev(hs: readonly Half[]): number {
  let best = -Infinity;
  const solve = (rows: number[][]): number[] | undefined => {
    const a = rows.map((row) => [...row]);
    for (let col = 0; col < 5; col++) {
      let pivot = col;
      for (let r = col + 1; r < 5; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
      if (Math.abs(a[pivot]![col]!) < 1e-12) return undefined;
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      for (let r = col + 1; r < 5; r++) {
        const f = a[r]![col]! / a[col]![col]!;
        for (let k = col; k < 6; k++) a[r]![k]! -= f * a[col]![k]!;
      }
    }
    const x = new Array<number>(5).fill(0);
    for (let r = 4; r >= 0; r--) {
      let s = a[r]![5]!;
      for (let k = r + 1; k < 5; k++) s -= a[r]![k]! * x[k]!;
      x[r] = s / a[r]![r]!;
    }
    return x;
  };
  const n = hs.length;
  for (let i0 = 0; i0 < n; i0++) for (let i1 = i0 + 1; i1 < n; i1++) for (let i2 = i1 + 1; i2 < n; i2++)
    for (let i3 = i2 + 1; i3 < n; i3++) for (let i4 = i3 + 1; i4 < n; i4++) {
      const idx = [i0, i1, i2, i3, i4];
      const sol = solve(idx.map((i) => [...hs[i]!.n, 1, hs[i]!.o]));
      if (sol === undefined || sol[4]! <= best) continue;
      const x = sol.slice(0, 4);
      if (hs.every((h) => dot(h.n, x) + sol[4]! <= h.o + 1e-12 * Math.max(1, Math.abs(h.o)))) best = sol[4]!;
    }
  return best;
}

/** Hodge dual of u∧v∧w in R4, written out independently of the library. */
function wedgeDual(u: readonly number[], v: readonly number[], w: readonly number[]): number[] {
  const det3 = (r: readonly number[]): number => {
    const [a, b, c] = r.map((i) => [u[i]!, v[i]!, w[i]!]) as [number[], number[], number[]];
    return a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!)
      + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
  };
  return [det3([1, 2, 3]), -det3([0, 2, 3]), det3([0, 1, 3]), -det3([0, 1, 2])];
}

/** The decisive value over all 56 candidates, none discarded: max separation, else min overlap. */
function exhaustive(a: HyperboxSupportShape4, b: HyperboxSupportShape4) {
  const ax = a.worldAxes().map(coords);
  const bx = b.worldAxes().map(coords);
  const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] as const;
  const candidates = [
    ...ax, ...bx,
    ...[0, 1, 2, 3].flatMap((e) => pairs.map(([i, j]) => wedgeDual(ax[e]!, bx[i]!, bx[j]!))),
    ...pairs.flatMap(([i, j]) => [0, 1, 2, 3].map((e) => wedgeDual(ax[i]!, ax[j]!, bx[e]!)))
  ];
  const interval = (box: HyperboxSupportShape4, axes: number[][], d: number[]): [number, number] => {
    const c = dot(coords(box.center), d);
    const r = axes.reduce((sum, axis, k) => sum + box.halfExtents[k]! * Math.abs(dot(axis, d)), 0);
    return [c - r, c + r];
  };
  let separation = -Infinity;
  let overlap = Infinity;
  for (const v of candidates) {
    const length = Math.hypot(...v);
    if (!(length > 1e-12)) continue;
    const d = v.map((x) => x / length);
    const [a0, a1] = interval(a, ax, d);
    const [b0, b1] = interval(b, bx, d);
    separation = Math.max(separation, a0 - b1, b0 - a1);
    if (Math.max(a0 - b1, b0 - a1) <= 1e-12) overlap = Math.min(overlap, a1 - b0, b1 - a0);
  }
  return { separation, overlap };
}

const A_HALF = [0.4, 0.5, 0.6, 0.7];
const B_HALF = [0.45, 0.55, 0.65, 0.75];

/** A tilted by `theta` in each listed plane at `offset`; B axis-aligned at `offset + gap·x`. */
function pair(options: {
  planes: readonly (readonly [number, number])[];
  theta: number;
  gap: number;
  common?: Rotor4;
  offset?: readonly number[];
  scale?: number;
}): [HyperboxSupportShape4, HyperboxSupportShape4] {
  const scale = options.scale ?? 1;
  const offset = new VecN([...(options.offset ?? [0, 0, 0, 0])]);
  const common = options.common ?? Rotor4.identity();
  const tilt = options.planes.length === 0
    ? Rotor4.identity()
    : Rotor4.fromPlanes(options.planes.map(([i, j]) => ({ i, j, angle: options.theta })));
  const place = (rotation: Rotor4, local: VecN): TransformN =>
    new TransformN(4, common.multiply(rotation), common.applyToPoint(local).add(offset));
  return [
    new HyperboxSupportShape4(A_HALF.map((h) => h * scale), place(tilt, new VecN([0, 0, 0, 0]))),
    new HyperboxSupportShape4(B_HALF.map((h) => h * scale), place(Rotor4.identity(), new VecN([options.gap * scale, 0, 0, 0])))
  ];
}

/** Chebyshev value after translating A by the SAT result's own alignment. */
function alignedChebyshev(a: HyperboxSupportShape4, b: HyperboxSupportShape4): number {
  const sat = hyperboxSat4(a, b);
  const shift = coords(sat.axis).map((x) => x * (sat.intervalB[1] - sat.intervalA[0]));
  return chebyshev([...halfspaces(a, shift), ...halfspaces(b)]);
}

function quaternionLog(q: readonly number[]): [number, number, number] {
  const [x, y, z, w] = q as [number, number, number, number];
  const length = Math.hypot(x, y, z);
  if (length === 0) return [0, 0, 0];
  const scale = Math.atan2(length, w) / length;
  return [x * scale, y * scale, z * scale];
}
/** Public `fromBivector` with its generator map inverted, as in the parallel-enumeration test. */
function rotorFromQuaternions(left: readonly number[], right: readonly number[]): Rotor4 {
  const [u1, u2, u3] = quaternionLog(left);
  const [v1, v2, v3] = quaternionLog(right);
  const b = new BivectorN(4);
  b.coeffs[0] = u3 - v3; b.coeffs[1] = v2 - u2; b.coeffs[2] = -(u1 + v1);
  b.coeffs[3] = u1 - v1; b.coeffs[4] = -(u2 + v2); b.coeffs[5] = -(u3 + v3);
  return Rotor4.fromBivector(b);
}

/**
 * The state entering the substep that threw in the restitution-zero two-body
 * run (CONTACT-C2 Part B), recorded verbatim.
 */
function liveCapture(): [HyperboxSupportShape4, HyperboxSupportShape4] {
  return [
    new HyperboxSupportShape4(A_HALF, new TransformN(4,
      rotorFromQuaternions(
        [-1.2450595576492457e-8, -8.360441461957276e-9, -4.4095052217530543e-8, 0.9999999999999989],
        [-1.245059570944967e-8, 8.3604411058429e-9, 4.409505224937059e-8, 0.9999999999999989]),
      new VecN([-0.4443055708574762, 0, 0, 0]))),
    new HyperboxSupportShape4(B_HALF, new TransformN(4,
      rotorFromQuaternions(
        [5.2894687475142155e-9, 3.4779435456433046e-9, 1.7899971701342177e-8, 0.9999999999999998],
        [5.289468726905634e-9, -3.477943602561567e-9, -1.7899971696112722e-8, 0.9999999999999998]),
      new VecN([0.40152778542873513, 0, 0, 0])))
  ];
}

describe('the Chebyshev reference', () => {
  it('reads apart, touching and overlapping correctly', () => {
    const box = (x: number) => new HyperboxSupportShape4([1, 1, 1, 1], new TransformN(4, undefined, new VecN([x, 0, 0, 0])));
    expect(chebyshev([...halfspaces(box(0)), ...halfspaces(box(4))])).toBeCloseTo(-1, 12);
    expect(chebyshev([...halfspaces(box(0)), ...halfspaces(box(2))])).toBeCloseTo(0, 12);
    expect(chebyshev([...halfspaces(box(0)), ...halfspaces(box(1.5))])).toBeCloseTo(0.25, 12);
  });
});

describe('near-parallel candidate axes', () => {
  it('reports the minimum overlap, from the facet that actually achieves it', () => {
    const [a, b] = pair({ planes: [[0, 1]], theta: 1e-7, gap: 0.83 });
    const sat = hyperboxSat4(a, b);
    expect(sat.status).toBe('overlapping');
    // B's facet normal achieves the minimum; A's, 1e-7 rad away, overlaps 5e-9 more.
    expect(sat.source).toEqual({ featureClass: 'facet-b', axesA: [], axesB: [0] });
    expect(Math.abs(sat.penetrationDepth - exhaustive(a, b).overlap)).toBeLessThan(1e-15);
    // Grouping is unchanged: the same directions and counts as before the repair.
    expect(sat.diagnostics).toEqual({
      axesGenerated: 56,
      axesTested: 4,
      degenerateAxesSkipped: 16,
      duplicateAxesSkipped: 36
    });
  });

  it('aligns into a touching configuration, not a separated one', () => {
    for (const planes of [[[0, 1]], [[0, 1], [0, 2]], [[0, 1], [0, 2], [0, 3]]] as const) {
      for (const theta of [1e-7, 1e-8, 1e-9, 1e-11]) {
        const [a, b] = pair({ planes, theta, gap: 0.83 });
        const t = alignedChebyshev(a, b);
        expect(`${planes.length} plane(s) at ${theta}: ${Math.abs(t) < 1e-15}`).toBe(
          `${planes.length} plane(s) at ${theta}: true`
        );
        expect(Math.abs(hyperboxSat4(a, b).penetrationDepth - exhaustive(a, b).overlap)).toBeLessThan(1e-15);
      }
    }
  });

  it('returns the touching patch for the configuration that threw', () => {
    const [a, b] = pair({ planes: [[0, 1]], theta: 1e-7, gap: 0.83 });
    const result = hyperboxContactPatch4(a, b);
    expect(result.patch?.kind).toBe('polygon');
    expect(result.patch?.intrinsicDim).toBe(2);
    expect(result.patch?.vertices).toHaveLength(4);
    expect(result.patch?.referenceBox).toBe('b');
  });

  it('does not discard the only separating axis', () => {
    // B's facet normal separates the pair by 2e-9; A's, 1e-7 rad away, still
    // overlaps by 3e-9. Evaluated first and kept alone, A's reported a contact.
    const [a, b] = pair({ planes: [[0, 1]], theta: 1e-7, gap: 0.85 + 0.5e-7 + 2e-9 });
    expect(chebyshev([...halfspaces(a), ...halfspaces(b)])).toBeLessThan(-5e-10);
    expect(gjkDistance(a, b).intersects).toBe(false);
    const sat = hyperboxSat4(a, b);
    expect(sat.status).toBe('separated');
    expect(sat.source).toEqual({ featureClass: 'facet-b', axesA: [], axesB: [0] });
    expect(Math.abs(sat.separation - exhaustive(a, b).separation)).toBeLessThan(1e-15);
    expect(hyperboxContactPatch4(a, b).patch).toBeNull();
  });

  it('gives the same answer for either order of the pair', () => {
    const cases: [string, [HyperboxSupportShape4, HyperboxSupportShape4]][] = [
      ['overlap', pair({ planes: [[0, 1]], theta: 1e-7, gap: 0.83 })],
      ['two planes', pair({ planes: [[0, 1], [0, 2]], theta: 1e-8, gap: 0.83 })],
      ['separation', pair({ planes: [[0, 1]], theta: 1e-7, gap: 0.85 + 0.5e-7 + 2e-9 })],
      ['live capture', liveCapture()]
    ];
    for (const [name, [a, b]] of cases) {
      const forward = hyperboxSat4(a, b);
      const reverse = hyperboxSat4(b, a);
      expect(`${name}: ${reverse.status}`).toBe(`${name}: ${forward.status}`);
      expect(Math.abs(forward.signedAxisDistance - reverse.signedAxisDistance)).toBeLessThan(1e-15);
      expect(forward.axis.dot(reverse.axis)).toBeCloseTo(-1, 12);
    }
  });

  it('closes the captured live failure', () => {
    const [striker, target] = liveCapture();
    const sat = hyperboxSat4(striker, target);
    expect(sat.status).toBe('overlapping');
    expect(Math.abs(sat.penetrationDepth - exhaustive(striker, target).overlap)).toBeLessThan(1e-15);
    expect(Math.abs(alignedChebyshev(striker, target))).toBeLessThan(1e-15);
    const result = hyperboxContactPatch4(striker, target);
    expect(result.patch?.kind).toBe('point');
    expect(result.patch?.vertices).toHaveLength(1);
  });

  it('is unchanged by a common rigid motion and scales with the pair', () => {
    const base = pair({ planes: [[0, 1]], theta: 1e-7, gap: 0.83 });
    const common = Rotor4.fromPlanes([
      { i: 0, j: 2, angle: 0.7 },
      { i: 1, j: 3, angle: -0.45 },
      { i: 2, j: 3, angle: 0.2 }
    ]);
    const moved = pair({ planes: [[0, 1]], theta: 1e-7, gap: 0.83, common, offset: [12, -7, 3, 5] });
    const scaled = pair({ planes: [[0, 1]], theta: 1e-7, gap: 0.83, scale: 1000 });
    const depth = hyperboxSat4(...base).penetrationDepth;
    // A common motion is exact only up to rounding of the rotated poses.
    expect(Math.abs(hyperboxSat4(...moved).penetrationDepth - depth)).toBeLessThan(1e-13);
    expect(Math.abs(hyperboxSat4(...moved).penetrationDepth - exhaustive(...moved).overlap)).toBeLessThan(1e-13);
    expect(Math.abs(alignedChebyshev(...moved))).toBeLessThan(1e-13);
    expect(hyperboxSat4(...scaled).penetrationDepth / depth).toBeCloseTo(1000, 9);
    expect(Math.abs(alignedChebyshev(...scaled))).toBeLessThan(1e-12);
  });

  it('keeps the earlier candidate on an exact tie, so exactly parallel pairs are unchanged', () => {
    const [a, b] = pair({ planes: [], theta: 0, gap: 0.83 });
    const sat = hyperboxSat4(a, b);
    expect(sat.source).toEqual({ featureClass: 'facet-a', axesA: [0], axesB: [] });
    expect(sat.diagnostics).toEqual({
      axesGenerated: 56,
      axesTested: 4,
      degenerateAxesSkipped: 24,
      duplicateAxesSkipped: 28
    });
    expect(hyperboxContactPatch4(a, b).patch?.intrinsicDim).toBe(3);
  });
});
