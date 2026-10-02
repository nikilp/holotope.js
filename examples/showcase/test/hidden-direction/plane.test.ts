import { Rotor4, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import { createExperience } from '../../src/hidden-direction/experience.js';
import {
  PLANE_EXTENT, anaRegion, ballFootprint, chordOf, hull, lineOf, lineSegment, polytopeFootprint, type Footprint
} from '../../src/hidden-direction/plane.js';
import { BOX, type PresetId } from '../../src/spatial-4d-contact/simulation.js';

/**
 * The hidden-plane map is exact about membership.
 *
 * While the slice's normal n lies in the x–w plane, n·p reads only p's x and w,
 * so the slice meets a body exactly when the body's footprint (the body
 * flattened onto x–w along y and z) meets the line {q : n·q = offset}. This
 * file holds the map's pieces to literal cases, and then holds the whole map —
 * as the page reads it, through `dispatch` and `view()` — to the library's own
 * word on membership: a chord is drawn through a footprint exactly when the
 * accepted section modules say the body is not outside the slice.
 *
 * The library classifies with its sectioner tolerance (|signed distance| ≤
 * 10⁻⁹ is on the slice); the copy promises the same word ("touching … within
 * 10⁻⁹"). So the agreement asserted here is with that tolerance, not with
 * exact-sign arithmetic.
 *
 * What this file does not prove: the cut's shape (that needs y and z), the
 * map's drawing in `app.ts`, or how a pointer drag becomes a turn or a slide.
 */

type View = ReturnType<ReturnType<typeof createExperience>['view']>;
type Line = NonNullable<ReturnType<typeof lineOf>>;
type Point = readonly [number, number];

const rad = (deg: number): number => (deg * Math.PI) / 180;
const E = PLANE_EXTENT;

/* -------------------------------------------------------------------------- */
/* Independent planar helpers — written from the definitions, not from plane.ts */
/* -------------------------------------------------------------------------- */

const cross = (o: Point, a: Point, b: Point): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Shoelace area, positive for a counter-clockwise ring. */
function signedArea(ring: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    s += a[0] * b[1] - a[1] * b[0];
  }
  return s / 2;
}

function distanceToSegment(q: Point, a: Point, b: Point): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const len2 = ex * ex + ey * ey;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / len2));
  return Math.hypot(q[0] - (a[0] + t * ex), q[1] - (a[1] + t * ey));
}

/**
 * Where a line crosses a convex counter-clockwise polygon, by Cyrus–Beck
 * clipping of q(t) = offset·n + t·d against every edge's inner half-plane,
 * with d = (n_w, −n_x). A different algorithm from the edge-crossing scan
 * under test; null when the clipped interval is empty.
 */
function clipLine(line: Line, ring: readonly Point[]): [Point, Point] | null {
  const f: Point = [line.offset * line.n[0], line.offset * line.n[1]];
  const d: Point = [line.n[1], -line.n[0]];
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const e: Point = [b[0] - a[0], b[1] - a[1]];
    // Inside: e × (q − a) ≥ 0, i.e. g0 + t·g1 ≥ 0.
    const g0 = e[0] * (f[1] - a[1]) - e[1] * (f[0] - a[0]);
    const g1 = e[0] * d[1] - e[1] * d[0];
    if (Math.abs(g1) < 1e-15) {
      if (g0 < -1e-9) return null;
      continue;
    }
    const t = -g0 / g1;
    if (g1 > 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
  }
  if (lo > hi + 1e-9) return null;
  return [[f[0] + lo * d[0], f[1] + lo * d[1]], [f[0] + hi * d[0], f[1] + hi * d[1]]];
}

const heightOn = (line: Line, q: Point): number => line.n[0] * q[0] + line.n[1] * q[1] - line.offset;

/* -------------------------------------------------------------------------- */
/* The grids, driven exactly as the page drives them                           */
/* -------------------------------------------------------------------------- */

interface Sample {
  readonly at: string;
  readonly id: string;
  readonly status: 'present' | 'tangent' | 'outside';
  /** The offset this sample was dispatched at, to prove the dispatch took. */
  readonly offset: number;
  readonly line: Line | null;
  readonly footprint: Footprint;
  readonly chord: readonly Point[] | null;
}

function record(out: Sample[], at: string, offset: number, v: View): void {
  for (const f of v.plane.footprints) {
    const b = v.bodies.find((x) => x.id === f.id)!;
    out.push({ at, id: b.id, status: b.status, offset, line: v.plane.line, footprint: f.footprint, chord: f.chord });
  }
}

/** −90° … 90° in 7.5° steps: 25 turns, both slider ends included. */
const TURNS = Array.from({ length: 25 }, (_, k) => -90 + 7.5 * k);
/** −1.6 … 1.6 in 0.2 steps, as k/5 so each is the double nearest its decimal: 17 offsets. */
const OFFSETS = Array.from({ length: 17 }, (_, k) => (k - 8) / 5);
/** 0° … 360° in 15° steps: 25 orbit phases. */
const PHASES = Array.from({ length: 25 }, (_, k) => 15 * k);

let turnCache: Sample[] | null = null;
/** The turning world: 25 × 17 × 25 = 10 625 poses, two bodies each. */
function turnSamples(): Sample[] {
  if (turnCache) return turnCache;
  const x = createExperience('cuts');
  const out: Sample[] = [];
  for (const t of TURNS) {
    x.dispatch({ type: 'cut-turn', degrees: t });
    for (const o of OFFSETS) {
      x.dispatch({ type: 'cut-offset', value: o });
      for (const p of PHASES) {
        x.dispatch({ type: 'orbit-phase', degrees: p });
        record(out, `turn world, slice ${t}° at ${o}, orbit ${p}°`, o, x.view());
      }
    }
  }
  x.dispose();
  return (turnCache = out);
}

let contactCache: { samples: Sample[]; stops: string[] } | null = null;
/**
 * The contact world: both launches, each at launch, just before the blow, at
 * the blow, and 60 and 240 steps after it — 2 × 5 × 25 × 17 = 4 250 poses,
 * two bodies each. Time moves only by the page's own time actions.
 */
function contactSamples(): { samples: Sample[]; stops: string[] } {
  if (contactCache) return contactCache;
  const x = createExperience('collision');
  const samples: Sample[] = [];
  const stops: string[] = [];
  for (const preset of ['central', 'off-centre'] as const satisfies readonly PresetId[]) {
    x.dispatch({ type: 'preset', id: preset });
    // Read only to label where the samples sit; the samples are what is tested.
    const impact = x.worlds.contact.impactStep()!;
    const moves: [string, () => void, number][] = [
      ['launch', () => undefined, 0],
      ['just before the blow', () => x.dispatch({ type: 'jump-touch' }), impact - 1],
      ['the blow', () => x.dispatch({ type: 'jump-after' }), impact],
      ['60 steps on', () => { for (let s = 0; s < 60; s++) x.dispatch({ type: 'step' }); }, impact + 60],
      ['240 steps on', () => { for (let s = 0; s < 180; s++) x.dispatch({ type: 'step' }); }, impact + 240]
    ];
    for (const [name, go, steps] of moves) {
      go();
      expect(x.worlds.contact.sim.steps, `${preset}, ${name}`).toBe(steps);
      stops.push(`${preset}@${steps}`);
      for (const t of TURNS) {
        x.dispatch({ type: 'cut-turn', degrees: t });
        for (const o of OFFSETS) {
          x.dispatch({ type: 'cut-offset', value: o });
          record(samples, `contact world, launch ${preset}, ${name} (step ${steps}), slice ${t}° at ${o}`, o, x.view());
        }
      }
    }
  }
  x.dispose();
  return (contactCache = { samples, stops });
}

function disagreements(samples: readonly Sample[]): string[] {
  return samples
    .filter((s) => (s.chord !== null) !== (s.status !== 'outside'))
    .map((s) => `${s.at}: ${s.id} is ${s.status}, map ${s.chord === null ? 'draws no chord' : 'draws a chord'}`);
}

/* -------------------------------------------------------------------------- */

describe('the convex hull keeps exactly the corners, counter-clockwise', () => {
  it('drops interior and collinear points of a square, leaving its four corners from the lowest-left', () => {
    const points: Point[] = [[1, 1], [0, 0], [2, 1], [2, 0], [0.5, 1.5], [1, 0], [2, 2], [0, 1], [0, 2], [1, 2]];
    expect(hull(points)).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
  });

  it('returns a triangle’s three vertices, whatever the input order, without its interior points', () => {
    expect(hull([[1, 3], [1, 1], [4, 0], [2, 1], [0, 0]])).toEqual([[0, 0], [4, 0], [1, 3]]);
  });

  it('keeps one copy of each repeated corner', () => {
    expect(hull([[3, 0], [0, 0], [0, 3], [0, 0], [3, 0], [0, 3], [0, 3]])).toEqual([[0, 0], [3, 0], [0, 3]]);
  });

  it('reports a collinear set as its two ends', () => {
    expect(hull([[2, 2], [0, 0], [1, 1]])).toEqual([[0, 0], [2, 2]]);
  });
});

describe('footprints are the posed corners and centre read along x and w', () => {
  it('flattens an axis-aligned 4D box of half-extents (a, b, c, d) to the rectangle [−a, a] × [−d, d]', () => {
    const half = [3, 2, 1, 0.5];
    const corners: number[][] = [];
    for (let m = 0; m < 16; m++) corners.push(half.map((h, i) => ((m >> i) & 1 ? h : -h)));
    expect(polytopeFootprint(corners)).toEqual({ kind: 'polygon', points: [[-3, -0.5], [3, -0.5], [3, 0.5], [-3, 0.5]] });
  });

  it('keeps a ball’s centre x and w and its radius', () => {
    expect(ballFootprint([1, -2, 3, -4], 0.75)).toEqual({ kind: 'disc', centre: [1, -4], radius: 0.75 });
  });
});

describe('the slice is a line on the map only while its normal lies in the x–w plane', () => {
  it('refuses a normal with a y or a z component', () => {
    expect(lineOf([0, 1e-6, 0, 1], 0.4)).toBeNull();
    expect(lineOf([0, 0, 1e-6, 1], 0.4)).toBeNull();
  });

  it('otherwise reads n = (n_x, n_w) and keeps the offset', () => {
    expect(lineOf([-0.6, 0, 0, 0.8], 0.4)).toEqual({ n: [-0.6, 0.8], offset: 0.4 });
  });
});

describe('the line clipped to the map’s square', () => {
  it('runs along +d = (n_w, −n_x), from one side of the square to the other', () => {
    expect(lineSegment({ n: [0, 1], offset: 2 })).toEqual([[-E, 2], [E, 2]]);
    expect(lineSegment({ n: [1, 0], offset: -1 })).toEqual([[-1, E], [-1, -E]]);
  });

  it('ends on the line and on the square’s boundary, and is null exactly when the line misses the square (25 turns × 57 offsets)', () => {
    let drawn = 0;
    let missed = 0;
    for (const t of TURNS) {
      const n: [number, number] = [-Math.sin(rad(t)), Math.cos(rad(t))];
      // The square's support along n: the line meets it iff |offset| ≤ E(|n_x| + |n_w|).
      const reach = E * (Math.abs(n[0]) + Math.abs(n[1]));
      for (let k = -28; k <= 28; k++) {
        const offset = k / 4;
        if (Math.abs(Math.abs(offset) - reach) < 1e-9) continue;
        const segment = lineSegment({ n, offset });
        const where = `${t}° at ${offset}`;
        expect(segment !== null, where).toBe(Math.abs(offset) < reach);
        if (segment === null) { missed++; continue; }
        drawn++;
        for (const q of segment) {
          expect(Math.abs(heightOn({ n, offset }, q)), `${where}: end on the line`).toBeLessThan(1e-12);
          expect(Math.max(Math.abs(q[0]), Math.abs(q[1])), `${where}: end on the boundary`).toBeCloseTo(E, 12);
        }
      }
    }
    expect(drawn).toBeGreaterThan(0);
    expect(missed).toBeGreaterThan(0);
  });
});

describe('the ana side is the part of the square the normal points into', () => {
  it('is the upper half of the square for the untilted slice through the centre', () => {
    expect(anaRegion({ n: [0, 1], offset: 0 })).toEqual([[E, 0], [E, E], [-E, E], [-E, 0]]);
  });

  it('lies wholly on the normal’s side, is never empty inside the square, and with its kata twin tiles the square (25 turns × 41 offsets)', () => {
    for (const t of TURNS) {
      const n: [number, number] = [-Math.sin(rad(t)), Math.cos(rad(t))];
      for (let k = -20; k <= 20; k++) {
        const offset = (k / 20) * (E - 0.01);
        const line = { n, offset };
        const ana = anaRegion(line);
        const kata = anaRegion({ n: [-n[0], -n[1]], offset: -offset });
        const where = `${t}° at ${offset}`;
        for (const q of ana) expect(heightOn(line, q), `${where}: vertex on the ana side`).toBeGreaterThanOrEqual(-1e-12);
        expect(ana.length, `${where}: a region`).toBeGreaterThanOrEqual(3);
        expect(signedArea(ana), `${where}: of positive area`).toBeGreaterThan(0);
        expect(Math.abs(signedArea(ana)) + Math.abs(signedArea(kata)), `${where}: the two sides tile the square`)
          .toBeCloseTo((2 * E) ** 2, 9);
      }
    }
  });
});

describe('the map agrees with the library about membership', () => {
  it('turning world: 10 625 poses (25 turns × 17 offsets × 25 orbit phases), 21 250 readings — a chord exactly when the body is not outside', () => {
    const samples = turnSamples();
    expect(samples).toHaveLength(21_250);
    // The dispatch took: every sample's line sits at the offset it was sent.
    for (const s of samples) {
      expect(s.line, s.at).not.toBeNull();
      expect(s.line!.offset, s.at).toBe(s.offset);
    }
    // Not a one-sided grid: all three of the library's words occur.
    const words = new Set(samples.map((s) => `${s.id}:${s.status}`));
    for (const w of ['block:present', 'block:tangent', 'companion:present', 'companion:outside']) expect(words.has(w), w).toBe(true);
    expect(disagreements(samples)).toEqual([]);
  }, 30_000);

  it('contact world: both launches at 0, impact − 1, impact, impact + 60 and impact + 240 steps — 4 250 poses (2 × 5 × 25 × 17), 8 500 readings — a chord exactly when the body is not outside', () => {
    const { samples, stops } = contactSamples();
    expect(stops).toHaveLength(10);
    expect(samples).toHaveLength(8_500);
    for (const s of samples) {
      expect(s.line, s.at).not.toBeNull();
      expect(s.line!.offset, s.at).toBe(s.offset);
    }
    const words = new Set(samples.map((s) => `${s.id}:${s.status}`));
    for (const w of ['box:present', 'box:outside', 'box:tangent', 'ball:present', 'ball:outside']) expect(words.has(w), w).toBe(true);
    expect(disagreements(samples)).toEqual([]);
  }, 30_000);

  it('just before the blow, a slice on the box’s +w face meets the ball the library calls touching — and the map draws it a chord', () => {
    // Launch A drops the ball along w onto the box's +w face (w = h_w = 1.0).
    // At the step before the blow the ball's lowest point is within 10⁻¹⁴ of
    // that face, so the slice w = h_w touches it by the library's tolerance.
    const x = createExperience('collision');
    x.dispatch({ type: 'jump-touch' });
    x.dispatch({ type: 'cut-offset', value: BOX.halfExtents[3] });
    const v = x.view();
    const ball = v.bodies.find((b) => b.id === 'ball')!;
    expect(ball.status).toBe('tangent');
    expect(ball.caption).toBe('Ball — touching your slice at a single point; nothing drawn. The small marker is the point where it touches.');
    expect(v.plane.footprints.find((f) => f.id === 'ball')!.chord, 'the map shows the touch the caption names').not.toBeNull();
    x.dispose();
  });

  it('the review’s pinned band-edge case: the library says outside, the footprint arithmetic alone says touching — the map follows the library', () => {
    // N1.1: the map's |s| = n_x c_x + n_w c_w − d and the library's |d| − r round differently. Here the
    // library's |d| − r − 10⁻⁹ is +8.3·10⁻¹⁷ (outside) while the map's |s| is r + 10⁻⁹ exactly.
    const x = createExperience('arrival');
    x.dispatch({ type: 'orbit-phase', degrees: 342.95044778846204 });
    x.dispatch({ type: 'cut-turn', degrees: 31.149118370376527 });
    x.dispatch({ type: 'cut-offset', value: -0.3894070408150282 });
    const v = x.view();
    const ball = v.bodies.find((b) => b.id === 'companion')!;
    expect(ball.status).toBe('outside');
    const foot = v.plane.footprints.find((f) => f.id === 'companion')!;
    expect(foot.chord, 'no chord where the library says the slice misses').toBeNull();
    expect(chordOf(foot.footprint, v.plane.line!), 'the arithmetic alone would draw a touch here').not.toBeNull();
    x.dispose();
  });

  it('where the library says the slice meets a body and the arithmetic, a few ulps out, says not, the map still draws the nearest point', () => {
    const line = lineOf([0, 0, 0, 1], 0)!;
    const disc: Footprint = { kind: 'disc', centre: [1, 0.5 + 2e-9], radius: 0.5 };
    expect(chordOf(disc, line)).toBeNull();
    expect(chordOf(disc, line, true)).toEqual([[1, 0], [1, 0]]);
    expect(chordOf(disc, line, false)).toBeNull();
    const square: Footprint = { kind: 'polygon', points: [[0, 2e-9], [1, 2e-9], [1, 1], [0, 1]] };
    expect(chordOf(square, line)).toBeNull();
    const touch = chordOf(square, line, true)!;
    expect(touch[0]).toEqual(touch[1]);
    expect(Math.abs(touch[0][1])).toBeLessThan(1e-15);
  });

  it('every chord lies on the line, in order along it, and ends on its footprint’s boundary', () => {
    const samples = [...turnSamples(), ...contactSamples().samples].filter((s) => s.chord !== null);
    expect(samples.length).toBeGreaterThan(10_000);
    const wrong: string[] = [];
    for (const s of samples) {
      const line = s.line!;
      const [a, b] = s.chord as [Point, Point];
      const where = `${s.at}: ${s.id}`;
      for (const q of [a, b]) if (Math.abs(heightOn(line, q)) > 1e-9) wrong.push(`${where} — an end is off the line`);
      // Ordered along d = (n_w, −n_x).
      if ((b[0] - a[0]) * line.n[1] - (b[1] - a[1]) * line.n[0] < -1e-12) wrong.push(`${where} — ends out of order`);
      const fp = s.footprint;
      if (fp.kind === 'disc') {
        for (const q of [a, b]) {
          if (Math.abs(Math.hypot(q[0] - fp.centre[0], q[1] - fp.centre[1]) - fp.radius) > 1e-9) wrong.push(`${where} — an end is off the circle`);
        }
        continue;
      }
      const ring = fp.points;
      if (!(signedArea(ring) > 0)) wrong.push(`${where} — footprint is not counter-clockwise`);
      for (const q of [a, b]) {
        if (ring.some((p, i) => cross(p, ring[(i + 1) % ring.length]!, q) < -1e-9)) wrong.push(`${where} — an end is outside`);
        const toBoundary = Math.min(...ring.map((p, i) => distanceToSegment(q, p, ring[(i + 1) % ring.length]!)));
        if (toBoundary > 1e-9) wrong.push(`${where} — an end is off the boundary`);
      }
    }
    expect(wrong).toEqual([]);
  }, 30_000);

  it('every polygon chord spans the whole crossing: it holds every corner the slice passes through (within 10⁻⁹), and where the slice passes through no corner its ends are an independent clip’s', () => {
    const samples = [...turnSamples(), ...contactSamples().samples]
      .filter((s) => s.chord !== null && s.footprint.kind === 'polygon');
    let strict = 0;
    let onCorner = 0;
    const wrong: string[] = [];
    for (const s of samples) {
      const line = s.line!;
      const ring = (s.footprint as Extract<Footprint, { kind: 'polygon' }>).points;
      const [a, b] = s.chord as [Point, Point];
      const where = `${s.at}: ${s.id}`;
      const corners = ring.filter((q) => Math.abs(heightOn(line, q)) <= 1e-9);
      if (corners.length > 0) {
        onCorner++;
        for (const q of corners) {
          if (distanceToSegment(q, a, b) > 1e-9) wrong.push(`${where} — corner (${q[0]}, ${q[1]}) lies on the slice but off the chord`);
        }
        continue;
      }
      strict++;
      const clipped = clipLine(line, ring);
      if (clipped === null) { wrong.push(`${where} — the independent clip misses`); continue; }
      for (let e = 0; e < 2; e++) {
        if (Math.hypot(clipped[e]![0] - s.chord![e]![0], clipped[e]![1] - s.chord![e]![1]) > 1e-9) wrong.push(`${where} — end ${e} is not the clip’s`);
      }
    }
    expect(strict).toBeGreaterThan(5_000);
    expect(onCorner).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  }, 30_000);
});

describe('in chapter V the map shows the fixed slice and the turned study box', () => {
  const [hx, hy, , hw] = BOX.halfExtents;

  /** The rotor's sign convention in the x–w plane, measured once: e_x → (cos α, 0, 0, s·sin α). */
  function xwSign(): 1 | -1 {
    const a = 0.3;
    const rotor = Rotor4.fromPlane(0, 3, a);
    const ex = rotor.applyToPoint(new VecN([1, 0, 0, 0])).data;
    const ew = rotor.applyToPoint(new VecN([0, 0, 0, 1])).data;
    const s = ex[3]! > 0 ? 1 : -1;
    expect(ex[0]).toBeCloseTo(Math.cos(a), 12);
    expect(ex[3]).toBeCloseTo(s * Math.sin(a), 12);
    expect(ew[0]).toBeCloseTo(-s * Math.sin(a), 12);
    expect(ew[3]).toBeCloseTo(Math.cos(a), 12);
    return s;
  }

  function expectRing(actual: Footprint, expected: readonly Point[], where: string): void {
    expect(actual.kind, where).toBe('polygon');
    const points = (actual as Extract<Footprint, { kind: 'polygon' }>).points;
    expect(points, where).toHaveLength(expected.length);
    for (const e of expected) {
      expect(points.some((p) => Math.abs(p[0] - e[0]) < 1e-12 && Math.abs(p[1] - e[1]) < 1e-12), `${where}: corner (${e[0]}, ${e[1]})`)
        .toBe(true);
    }
    expect(signedArea(points), `${where}: counter-clockwise`).toBeGreaterThan(0);
  }

  it('through w: the line is w = 0 and not yours to move, and the footprint is the x–w rectangle turned by the study’s angle', () => {
    const s = xwSign();
    const x = createExperience('collision');
    // The collision's slice is moved first; the study's map must not follow it.
    x.dispatch({ type: 'cut-turn', degrees: 30 });
    x.dispatch({ type: 'cut-offset', value: 0.5 });
    x.dispatch({ type: 'chapter', id: 'turning' });
    expect(x.worlds.contact.study.mode).toBe('fourth');
    for (const d of [0, 10, 30, 45, 60, 90, 135, 180, 250, 360]) {
      x.dispatch({ type: 'study-angle', degrees: d });
      const v = x.view();
      const where = `${d}°`;
      expect(v.plane.line, where).toEqual({ n: [0, 1], offset: 0 });
      expect(v.plane.movable, where).toBe(false);
      expect(v.plane.footprints.map((f) => f.id), where).toEqual(['study-box']);
      const a = rad(d);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const corners: Point[] = [[hx, hw], [-hx, hw], [-hx, -hw], [hx, -hw]]
        .map(([px, pw]) => [px! * c - s * pw! * sn, s * px! * sn + pw! * c] as const);
      const fp = v.plane.footprints[0]!;
      expectRing(fp.footprint, corners, where);
      expect(signedArea((fp.footprint as Extract<Footprint, { kind: 'polygon' }>).points), `${where}: rigid`).toBeCloseTo(4 * hx * hw, 12);
      // The chord on w = 0: the section's x half-extent, min(h_x/|cos α|, h_w/|sin α|).
      const X = Math.min(Math.abs(c) === 0 ? Infinity : hx / Math.abs(c), Math.abs(sn) === 0 ? Infinity : hw / Math.abs(sn));
      expect(fp.chord, where).not.toBeNull();
      expect(fp.chord![0]![0], where).toBeCloseTo(-X, 12);
      expect(fp.chord![1]![0], where).toBeCloseTo(X, 12);
      expect(Math.abs(fp.chord![0]![1]), where).toBeLessThan(1e-12);
      expect(Math.abs(fp.chord![1]![1]), where).toBeLessThan(1e-12);
    }
    x.dispose();
  });

  it('the ordinary turn widens the footprint along x by h_y·|sin α| and leaves its w extent alone', () => {
    const x = createExperience('turning');
    x.dispatch({ type: 'study-mode', mode: 'ordinary' });
    for (const d of [0, 20, 45, 90, 200]) {
      x.dispatch({ type: 'study-angle', degrees: d });
      const a = rad(d);
      // An x–y turn moves x to x cos − y sin (either sign of sin): the x reach is h_x|cos| + h_y|sin|.
      const X = hx * Math.abs(Math.cos(a)) + hy * Math.abs(Math.sin(a));
      expectRing(x.view().plane.footprints[0]!.footprint, [[-X, -hw], [X, -hw], [X, hw], [-X, hw]], `${d}° ordinary`);
    }
    x.dispose();
  });
});
