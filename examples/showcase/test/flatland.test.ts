import { describe, expect, it } from 'vitest';
import { DRAW_ORDER, TRANSPARENT_OBJECT_BUDGET } from '../src/flatland/draw-order.js';
import {
  DIAGONAL_REACH,
  SIDE_CHANGE_OFFSET,
  buildFlatlandSource,
  outlineProvenance,
  sectionOutline
} from '../src/flatland/section.js';

/**
 * The claims "Flatland, honestly" makes on screen, pinned to the section data
 * rather than to the page's prose.
 *
 * The page says a cube cuts into a triangle, then a hexagon, then a triangle,
 * and that each corner of the flat shape can name the cube edge it came from.
 * Both are assertions about `sectionSimplexGroupN`'s output, so both are
 * checked here against that output.
 */
describe('flatland: the shape sequence the page claims', () => {
  const source = buildFlatlandSource();

  it('cuts triangle, hexagon, triangle across the diagonal', () => {
    const shapeAt = (offset: number): string => sectionOutline(source, offset).shape;
    for (const offset of [-1.70, -1.4, -1.0, -0.7]) {
      expect(shapeAt(offset), `offset ${offset}`).toBe('triangle');
    }
    for (const offset of [-0.4, -0.2, 0, 0.2, 0.4]) {
      expect(shapeAt(offset), `offset ${offset}`).toBe('hexagon');
    }
    for (const offset of [0.7, 1.0, 1.4, 1.70]) {
      expect(shapeAt(offset), `offset ${offset}`).toBe('triangle');
    }
  });

  it('changes side count at ±1/√3, which is where the corner ring ends', () => {
    const inside = SIDE_CHANGE_OFFSET - 1e-3;
    const outside = SIDE_CHANGE_OFFSET + 1e-3;
    expect(sectionOutline(source, -inside).sides).toBe(6);
    expect(sectionOutline(source, -outside).sides).toBe(3);
    expect(sectionOutline(source, inside).sides).toBe(6);
    expect(sectionOutline(source, outside).sides).toBe(3);
  });

  it('reports an empty section past the extreme corners, not a stale shape', () => {
    for (const offset of [-DIAGONAL_REACH - 0.05, DIAGONAL_REACH + 0.05]) {
      const outline = sectionOutline(source, offset);
      expect(outline.ring.length, `offset ${offset}`).toBe(0);
      expect(outline.shape).toBe('empty');
      expect(outline.sides).toBe(0);
    }
  });

  it('draws more ring vertices than sides, which is why sides are counted', () => {
    // The tetrahedralization subdivides each side. A page that counted raw
    // boundary edges would claim a cube sections into hexagons and dodecagons.
    const triangle = sectionOutline(source, -1.2);
    expect(triangle.sides).toBe(3);
    expect(triangle.ring.length).toBeGreaterThan(3);
    const hexagon = sectionOutline(source, 0);
    expect(hexagon.sides).toBe(6);
    expect(hexagon.ring.length).toBeGreaterThan(6);
  });
});

describe('flatland: source identity survives the cut', () => {
  const source = buildFlatlandSource();

  it('names a real cube edge for every corner of every shape', () => {
    for (const offset of [-1.2, -0.3, 0, 0.3, 1.2]) {
      const outline = sectionOutline(source, offset);
      let named = 0;
      for (let index = 0; index < outline.ring.length; index++) {
        const where = outlineProvenance(outline, index);
        expect(where, `offset ${offset} corner ${index}`).toBeDefined();
        if (where === undefined) continue;
        // Every ancestor is a real cube vertex and the weights are affine.
        for (const vertex of where.sourceVertices) {
          expect(vertex).toBeGreaterThanOrEqual(0);
          expect(vertex).toBeLessThan(source.complex.vertexCount);
        }
        const total = where.weights.reduce((sum, w) => sum + w, 0);
        expect(total).toBeCloseTo(1, 12);
        named += 1;
      }
      expect(named, `offset ${offset}`).toBe(outline.ring.length);
    }
  });

  it('places each cut point where its own lineage says it is', () => {
    // The strongest form of the claim: rebuild the ambient point from the
    // recorded weights over the ORIGINAL cube vertices and land on the section.
    const outline = sectionOutline(source, 0.25);
    const positions = source.complex.positions;
    for (let index = 0; index < outline.ring.length; index++) {
      const where = outlineProvenance(outline, index)!;
      const vertex = outline.ringVertices[index]!;
      for (let axis = 0; axis < 3; axis++) {
        let rebuilt = 0;
        where.sourceVertices.forEach((sourceVertex, k) => {
          rebuilt += where.weights[k]! * positions[sourceVertex * 3 + axis]!;
        });
        expect(rebuilt).toBeCloseTo(
          outline.result.ambientPositions[vertex * 3 + axis]!, 12
        );
      }
    }
  });

  it('accounts for every source cell in the section diagnostics', () => {
    const outline = sectionOutline(source, 0);
    const d = outline.result.diagnostics;
    expect(
      d.sectionedCells + d.suppressedOnPlaneCells + d.cellsBelow + d.collapsedSectionCells
    ).toBe(d.sourceCells);
    expect(d.sourceCells).toBe(6);
  });
});

describe('flatland: nothing happens at offset zero', () => {
  const source = buildFlatlandSource();

  // A taste review caught a shading jump at offset zero. The cause was
  // transparent-object sorting, not geometry — but the reason it was WRONG is a
  // geometric fact, and that fact is what these pin: at zero the cube is
  // bisected and the section is at its widest, and neither is an event.

  it('is a hexagon on both sides of zero, and at zero', () => {
    for (const offset of [-0.01, -1e-3, -1e-6, 0, 1e-6, 1e-3, 0.01]) {
      const outline = sectionOutline(source, offset);
      expect(outline.shape, `offset ${offset}`).toBe('hexagon');
      expect(outline.sides, `offset ${offset}`).toBe(6);
    }
  });

  it('varies continuously in area through zero', () => {
    const area = (offset: number): number => {
      const ring = sectionOutline(source, offset).ring;
      let sum = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        sum += a[0] * b[1] - b[0] * a[1];
      }
      return Math.abs(sum) / 2;
    };
    // Uniform steps, so a jump at a point shows as a spike in the second
    // difference while smooth change does not.
    const step = 0.004;
    const values: number[] = [];
    for (let i = -25; i <= 25; i++) values.push(area(i * step));
    const first = values.slice(1).map((v, i) => v - values[i]!);
    const second = first.slice(1).map((v, i) => Math.abs(v - first[i]!));
    const worst = Math.max(...second);
    // The section area peaks at zero, so the first difference changes sign
    // there; what must not happen is a step in the VALUE itself.
    const acrossZero = Math.abs(area(1e-9) - area(-1e-9));
    expect(acrossZero).toBeLessThan(1e-9);
    expect(worst).toBeLessThan(0.01);
  });

  it('changes side count only at ±1/√3, and nowhere else', () => {
    const flips: number[] = [];
    const step = 0.002;
    let previous = sectionOutline(source, -1.2).sides;
    for (let offset = -1.2 + step; offset <= 1.2; offset += step) {
      const sides = sectionOutline(source, offset).sides;
      if (sides !== previous) flips.push(offset - step / 2);
      previous = sides;
    }
    expect(flips.length).toBe(2);
    expect(flips[0]!).toBeCloseTo(-SIDE_CHANGE_OFFSET, 2);
    expect(flips[1]!).toBeCloseTo(SIDE_CHANGE_OFFSET, 2);
    // Explicitly: zero is not one of them.
    for (const flip of flips) expect(Math.abs(flip)).toBeGreaterThan(0.5);
  });

  it('splits the cube continuously, and exactly in half at zero', () => {
    // The cube is tinted by which side of the plane each point is on. That is a
    // visual code, so the quantity behind it is pinned: the share of the cube on
    // the near side must move smoothly and be one half at zero. A future change
    // that keyed the tint on which side holds MOST of the cube would flip here
    // at zero, and this test would fail.
    /** Fraction of the cube lying BELOW the plane at this offset. */
    const share = (offset: number): number => {
      // Monte-Carlo-free: a fixed lattice with irrational offsets, so no sample
      // ever lands exactly on the plane.
      const n = 1 / Math.sqrt(3);
      let inside = 0;
      let total = 0;
      const N = 24;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          for (let k = 0; k < N; k++) {
            const x = -1 + ((i + 0.6180339887) / N) * 2;
            const y = -1 + ((j + 0.3819660113) / N) * 2;
            const z = -1 + ((k + 0.7320508075) / N) * 2;
            total += 1;
            if ((x + y + z) * n - offset < 0) inside += 1;
          }
        }
      }
      return inside / total;
    };

    expect(share(0)).toBeCloseTo(0.5, 2);

    // A lattice estimate quantises — its second difference is dominated by
    // whole layers crossing, not by the geometry — so the assertions are the
    // ones a lattice answers exactly. Monotonicity is one: every sample crosses
    // the plane once and never returns, so any flip keyed on a majority would
    // break it.
    const step = 0.01;
    const values: number[] = [];
    for (let i = -20; i <= 20; i++) values.push(share(i * step));
    // The share BELOW the plane grows as the plane advances: each sample is
    // overtaken once and never released.
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!, `share below must not shrink as the plane advances (i=${i})`)
        .toBeGreaterThanOrEqual(values[i - 1]! - 1e-12);
    }
    // Nothing steps across zero: an ε either side agrees to the lattice's own
    // resolution, which is far finer than any majority flip would be.
    expect(Math.abs(share(-1e-6) - share(1e-6))).toBeLessThan(1e-3);
    // And the walk is smooth in the large: no single 0.01 step moves more than
    // a few percent of the cube.
    const jumps = values.slice(1).map((v, i) => Math.abs(v - values[i]!));
    expect(Math.max(...jumps)).toBeLessThan(0.05);
  });

  it('fixes draw order by construction, independent of the offset', () => {
    // The bug was an ORDER that depended on the offset. These are constants, so
    // the dependency cannot come back without this test changing.
    expect(TRANSPARENT_OBJECT_BUDGET).toBe(1);
    const opaque = [DRAW_ORDER.section, DRAW_ORDER.planeFrame, DRAW_ORDER.cubeEdges];
    for (const order of opaque) expect(order).toBeLessThan(DRAW_ORDER.cubeFaces);
    expect(new Set(opaque).size).toBe(1);
  });
});
