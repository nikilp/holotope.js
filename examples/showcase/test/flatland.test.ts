import { describe, expect, it } from 'vitest';
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
