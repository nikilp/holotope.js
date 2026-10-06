import { describe, expect, it } from 'vitest';
import { ON_PLANE_EPSILON, RUNGS, createPlaneWorld, createSpaceWorld, tipRotation, type World } from '../../src/flatland/world.js';
import { area2, crossings, drop, hull2, hull3, sameSet } from './analytic.js';

/**
 * One More Direction's numbers, held to an independent account (`analytic.ts`):
 * what the slice cuts and what the light drops, for both rungs, in interior,
 * empty and boundary states. The library computes the page's cut; this file
 * computes it again from the definitions, and the two must agree.
 */

const plane = createPlaneWorld();
const space = createSpaceWorld();
const DEG = Math.PI / 180;

/** Every pose the page names, and two it does not, for each rung. */
const poses = (w: World): number[] => [w.rung.stops.facet, w.rung.stops.corner, w.rung.stops.edge, 23 * DEG, 71 * DEG];

/** Offsets at every layer of corners, between each pair, and beyond both ends. */
function offsets(w: World): number[] {
  const heights = w.layers().map((l) => l.height);
  const out = [...heights, heights[0]! - 0.37, heights[heights.length - 1]! + 0.37];
  for (let i = 0; i + 1 < heights.length; i++) out.push((heights[i]! + heights[i + 1]!) / 2, heights[i]! + 0.013, heights[i + 1]! - 0.013);
  return out;
}

const posed = (w: World): number[][] => w.corners().map((c) => [...c.posed]);

describe('the turn is rigid, and names its poses truly', () => {
  it('is a rotation: orthonormal, determinant one, at every angle', () => {
    for (const rung of [RUNGS.plane, RUNGS.space]) {
      for (const angle of [0, 0.3, rung.stops.corner, 1.2, Math.PI / 2]) {
        const m = tipRotation(rung, angle);
        const n = rung.dim;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            let s = 0;
            for (let k = 0; k < n; k++) s += m.get(k, i) * m.get(k, j);
            expect(s).toBeCloseTo(i === j ? 1 : 0, 12);
          }
        }
      }
    }
  });

  it('keeps every edge 2 long, in every pose', () => {
    for (const w of [plane, space]) {
      for (const angle of poses(w)) {
        w.setTip(angle);
        expect(new Set(w.edgeLengths())).toEqual(new Set([2]));
      }
    }
  });

  it('stands a corner straight along the missing direction at the corner pose, and nowhere else', () => {
    for (const w of [plane, space]) {
      const reach = Math.sqrt(w.rung.dim);
      w.setTip(w.rung.stops.corner);
      const [lo, hi] = w.extent();
      expect(lo).toBeCloseTo(-reach, 12);
      expect(hi).toBeCloseTo(reach, 12);
      const top = w.corners().find((c) => Math.abs(c.posed[w.rung.extraAxis]! - hi) < 1e-9)!;
      // Every other coordinate of that corner is zero: it lies on the missing axis.
      top.posed.forEach((x, k) => { if (k !== w.rung.extraAxis) expect(Math.abs(x)).toBeLessThan(1e-12); });
      expect(top.name).toBe(`(${new Array(w.rung.dim).fill('+').join(' ')})`);
      w.setTip(w.rung.stops.corner - 2 * DEG);
      expect(w.extent()[1]).toBeLessThan(reach - 1e-4);
    }
  });

  it('lays a facet flat at the facet pose and an edge lowest at the edge pose', () => {
    for (const w of [plane, space]) {
      w.setTip(w.rung.stops.facet);
      expect(w.layers().map((l) => l.corners.length)).toEqual([2 ** (w.rung.dim - 1), 2 ** (w.rung.dim - 1)]);
      w.setTip(w.rung.stops.edge);
      expect(w.layers()[0]!.corners.length).toBe(2);
    }
  });

  it('counts the layers of corners a corner-first pass meets: 1, 3, 3, 1 in the plane; 1, 4, 6, 4, 1 in space', () => {
    plane.setTip(plane.rung.stops.corner);
    expect(plane.layers().map((l) => l.corners.length)).toEqual([1, 3, 3, 1]);
    space.setTip(space.rung.stops.corner);
    expect(space.layers().map((l) => l.corners.length)).toEqual([1, 4, 6, 4, 1]);
    // The middle layer is put exactly on the grid's zero, not at a rounding of it.
    expect(Object.is(space.layers()[2]!.height, 0)).toBe(true);
  });
});

describe('the cut is what the slice meets, by the definition', () => {
  it('has, in the plane, the corners the analytic crossings make, and their area', () => {
    let interior = 0;
    for (const angle of poses(plane)) {
      plane.setTip(angle);
      for (const h of offsets(plane)) {
        plane.setSlice(h);
        const meeting = plane.meeting();
        const cut = plane.cut();
        if (meeting.kind !== 'crossing') continue;
        interior += 1;
        const expected = hull2(crossings(posed(plane), plane.edges, 2, h).map((p) => drop(p, 2)));
        expect(sameSet(cut.corners.map((c) => drop(c.at, 2)), expected)).toBe(true);
        // Its sides are the hull's sides, each between neighbours around it.
        // Rounded to a micrometre, with a negative zero made zero, so one point has one key.
        const key = (p: readonly number[]) => p.map((x) => (Math.round(x * 1e6) / 1e6 + 0).toFixed(6)).join(',');
        const side = (p: readonly number[], q: readonly number[]) => [key(p), key(q)].sort().join('|');
        expect(new Set(cut.edges.map((e) => side(drop(cut.corners[e.a]!.at, 2), drop(cut.corners[e.b]!.at, 2)))))
          .toEqual(new Set(expected.map((p, i) => side(p, expected[(i + 1) % expected.length]!))));
        // Every corner of the cut lies in the plane.
        for (const c of cut.corners) expect(Math.abs(c.at[2]! - h)).toBeLessThan(1e-12);
        // The library's triangles fill exactly the analytic polygon.
        const r = plane.drawn.result;
        let drawn = 0;
        for (let t = 0; t < r.cellCount; t++) {
          const P = (k: number) => { const v = r.cells[t * 3 + k]!; return [r.ambientPositions[v * 3]!, r.ambientPositions[v * 3 + 1]!]; };
          drawn += area2([P(0), P(1), P(2)]);
        }
        expect(drawn).toBeCloseTo(area2(expected), 9);
      }
    }
    expect(interior).toBeGreaterThan(25);
  });

  it('has, in space, the corners the analytic crossings make, their faces and their surface', () => {
    let interior = 0;
    for (const angle of poses(space)) {
      space.setTip(angle);
      for (const h of offsets(space)) {
        space.setSlice(h);
        if (space.meeting().kind !== 'crossing') continue;
        interior += 1;
        const cut = space.cut();
        const points = crossings(posed(space), space.edges, 3, h).map((p) => drop(p, 3));
        const expected = hull3(points);
        const vertices = points.filter((p) => expected.faces.some((f) => f.some((q) => q.every((x, k) => Math.abs(x - p[k]!) < 1e-9))));
        expect(sameSet(cut.corners.map((c) => c.at), vertices)).toBe(true);
        expect(cut.faces.length).toBe(expected.faces.length);
        // Its edges are the hull's: pairs of corners that share two of its faces, and no others.
        const onFace = (p: readonly number[], f: number[][]) => f.some((q) => q.every((x, k) => Math.abs(x - p[k]!) < 1e-9));
        const hullEdges = new Set<string>();
        cut.corners.forEach((a, i) => cut.corners.forEach((b, j) => {
          if (j > i && expected.faces.filter((f) => onFace(a.at, f) && onFace(b.at, f)).length >= 2) hullEdges.add(`${i}-${j}`);
        }));
        expect(new Set(cut.edges.map((e) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`))).toEqual(hullEdges);
        const s = space.chart.section;
        let drawn = 0;
        for (let t = 0; t < s.cellCount; t++) {
          const P = (k: number) => { const v = s.cells[t * 3 + k]!; return [s.chartPositions[v * 3]!, s.chartPositions[v * 3 + 1]!, s.chartPositions[v * 3 + 2]!]; };
          const [a, b, c] = [P(0), P(1), P(2)];
          const u = b.map((x, k) => x - a[k]!);
          const v = c.map((x, k) => x - a[k]!);
          drawn += Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
        }
        expect(drawn).toBeCloseTo(expected.area, 9);
      }
    }
    expect(interior).toBeGreaterThan(25);
  });

  it('names each cut corner by the source edge or corner it lies on, at the fraction it lies at', () => {
    for (const w of [plane, space]) {
      w.setTip(w.rung.stops.corner);
      w.setSlice(w.rung.dim === 3 ? 0.21 : -1.37);
      const corners = posed(w);
      for (const c of w.cut().corners) {
        expect(c.on.length).toBe(2);
        const [a, b] = [corners[c.on[0]!]!, corners[c.on[1]!]!];
        const at = a.map((x, k) => x + c.along * (b[k]! - x));
        at.forEach((x, k) => expect(x).toBeCloseTo(k === w.rung.extraAxis ? w.offset : c.at[k] ?? x, 9));
      }
    }
  });

  it('names the counted shapes the journey speaks of', () => {
    const shape = (w: World, angle: number, h: number): string => { w.setTip(angle); w.setSlice(h); return w.cut().shape; };
    expect(shape(plane, 0, 0)).toBe('a square');
    expect(shape(plane, plane.rung.stops.corner, -1.2)).toBe('an equilateral triangle');
    expect(shape(plane, plane.rung.stops.corner, 0)).toBe('a regular hexagon');
    expect(shape(plane, plane.rung.stops.corner, 0.3)).toBe('a hexagon');
    expect(shape(space, 0, 0.4)).toBe('a cube');
    expect(shape(space, space.rung.stops.corner, -1.5)).toBe('a regular tetrahedron');
    expect(shape(space, space.rung.stops.corner, -0.5)).toBe('a tetrahedron with its corners cut off');
    expect(shape(space, space.rung.stops.corner, 0)).toBe('a regular octahedron');
  });
});

describe('an empty cut is not an absent object', () => {
  it('says how far the nearest corner is, on the side it is on', () => {
    for (const w of [plane, space]) {
      for (const angle of poses(w)) {
        w.setTip(angle);
        const [lo, hi] = w.extent();
        w.setSlice(lo - 0.25);
        const below = w.meeting();
        expect(below).toMatchObject({ kind: 'apart', side: 'below' });
        expect(below.kind === 'apart' && below.gap).toBeCloseTo(0.25, 12);
        expect(w.cut().empty).toBe(true);
        w.setSlice(hi + 0.4);
        const above = w.meeting();
        expect(above).toMatchObject({ kind: 'apart', side: 'above' });
        expect(above.kind === 'apart' && above.gap).toBeCloseTo(0.4, 12);
        // The object is unchanged by being missed: same corners, same edges.
        expect(new Set(w.edgeLengths())).toEqual(new Set([2]));
      }
    }
  });
});

describe('the boundary: what the slice meets, what is drawn, and why not', () => {
  it('agrees with the sectioner on every layer of corners, in every pose', () => {
    let touches = 0;
    for (const w of [plane, space]) {
      const facet = 2 ** (w.rung.dim - 1);
      for (const angle of poses(w)) {
        w.setTip(angle);
        for (const layer of w.layers()) {
          w.setSlice(layer.height);
          const heights = w.corners().map((c) => c.height);
          const on = heights.filter((h) => Math.abs(h) <= ON_PLANE_EPSILON).length;
          const below = heights.filter((h) => h < -ON_PLANE_EPSILON).length;
          const above = heights.filter((h) => h > ON_PLANE_EPSILON).length;
          const m = w.meeting();
          const d = w.diagnostics();
          if (below > 0 && above > 0) { expect(m.kind).toBe('crossing'); continue; }
          touches += 1;
          expect(m.kind).toBe('touching');
          if (m.kind !== 'touching') continue;
          expect(m.onCorners.length).toBe(on);
          expect(m.drawn).toBe(d.sectionedCells > 0);
          if (above > 0) {
            // The object beyond the slice: no cell has a corner strictly below, so the tie-break suppresses all.
            expect(m.objectSide).toBe('above');
            expect(m.drawn).toBe(false);
            expect(m.undrawn).toBe('far-side');
            expect(d.collapsedSectionCells).toBe(0);
          } else {
            expect(m.objectSide).toBe('below');
            // From the near side, a whole facet in the slice is drawn; less than a facet collapses.
            expect(m.drawn).toBe(on === facet);
            expect(m.undrawn).toBe(on === facet ? null : 'collapsed');
            if (on < facet) expect(d.collapsedSectionCells).toBeGreaterThan(0);
          }
          expect(m.feature).toBe(on === 1 ? 'corner' : on === 2 ? 'edge' : w.rung.dim === 3 ? 'face' : 'cell');
        }
      }
    }
    // Two rungs, five poses, and in each exactly two layers only touch: the lowest and the highest.
    expect(touches).toBe(20);
  });

  it('mirrors the sectioner’s tolerance: a corner within it is in the slice, one beyond it is not', () => {
    for (const w of [plane, space]) {
      w.setTip(0);
      // The facet below the object at −1: within the tolerance, touching and undrawn; beyond it, a cut.
      w.setSlice(-1 + 0.5 * ON_PLANE_EPSILON);
      expect(w.meeting()).toMatchObject({ kind: 'touching', drawn: false, undrawn: 'far-side' });
      expect(w.diagnostics().sectionedCells).toBe(0);
      w.setSlice(-1 + 3 * ON_PLANE_EPSILON);
      expect(w.meeting().kind).toBe('crossing');
      expect(w.diagnostics().sectionedCells).toBeGreaterThan(0);
    }
  });
});

describe('the shadow is all of the object, dropped along the missing direction', () => {
  it('puts each corner where dropping its missing coordinate puts it, on the slice', () => {
    for (const w of [plane, space]) {
      const axis = w.rung.extraAxis;
      for (const angle of poses(w)) {
        w.setTip(angle);
        for (const h of [-1.1, 0, 0.8]) {
          w.setSlice(h);
          const corners = posed(w);
          const shadow = w.shadow();
          expect(shadow.points.reduce((s, p) => s + p.corners.length, 0)).toBe(corners.length);
          for (const p of shadow.points) {
            expect(p.at[axis]).toBeCloseTo(h, 12);
            for (const i of p.corners) drop(corners[i]!, axis).forEach((x, k) => expect(drop(p.at, axis)[k]).toBeCloseTo(x, 12));
          }
          // Every source edge is drawn, from its ends' shadows.
          expect(shadow.segments.length).toBe(w.edges.length);
        }
      }
    }
  });

  it('piles up exactly the corners that lie on one line along the light', () => {
    const piles = (w: World, angle: number): number[] => { w.setTip(angle); return w.shadow().points.map((p) => p.corners.length).filter((n) => n > 1); };
    expect(piles(plane, plane.rung.stops.corner)).toEqual([2]);
    expect(piles(plane, 0)).toEqual([2, 2, 2, 2]);
    expect(piles(plane, 23 * DEG)).toEqual([]);
    expect(piles(space, space.rung.stops.corner)).toEqual([2]);
    expect(piles(space, 0)).toEqual(new Array(8).fill(2));
    expect(piles(space, 23 * DEG)).toEqual([]);
    // Corner first, the pile at the centre is the two extreme corners.
    plane.setTip(plane.rung.stops.corner);
    const centre = plane.shadow().points.find((p) => p.corners.length === 2)!;
    expect(centre.corners.map((i) => plane.corners()[i]!.name).sort()).toEqual(['(+ + +)', '(− − −)']);
  });

  it('does not change when the slice moves, apart from lying on it', () => {
    for (const w of [plane, space]) {
      const axis = w.rung.extraAxis;
      w.setTip(37 * DEG);
      w.setSlice(-0.6);
      const before = w.shadow().points.map((p) => drop(p.at, axis));
      w.setSlice(1.4);
      const after = w.shadow().points.map((p) => drop(p.at, axis));
      expect(after).toEqual(before);
    }
  });
});

describe('the source is never touched', () => {
  it('keeps the authored corners bitwise through every pose and slide', () => {
    for (const w of [plane, space]) {
      const authored = Float64Array.from(w.source.positions);
      for (const angle of poses(w)) { w.setTip(angle); for (const h of offsets(w)) { w.setSlice(h); w.cut(); w.shadow(); } }
      expect(Array.from(w.source.positions)).toEqual(Array.from(authored));
    }
  });
});
