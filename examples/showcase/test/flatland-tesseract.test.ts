import { describe, expect, it } from 'vitest';
import {
  W_REACH, buildTesseractSource, projectedPoints, rotateHiddenPlanes,
  sectionAtW, sectionSpan, sourceEdges
} from '../src/flatland/tesseract.js';

/**
 * Scene 6's claims. Each is about the tesseract's own section or projection,
 * measured, never about how either looks.
 */
describe('flatland: one rung up', () => {
  it('sections the tesseract into a cube at the hidden origin', () => {
    const source = buildTesseractSource();
    const span = sectionSpan(sectionAtW(source, 0));
    // Three equal spans of the source's full width: that is the cube the page
    // claims, read off the section rather than asserted about it.
    for (const axis of span) expect(axis).toBeCloseTo(2 * W_REACH, 9);
    expect(sectionAtW(source, 0).cellCount).toBeGreaterThan(0);
  });

  it('shrinks the section as the plane leaves, and empties past the source', () => {
    const source = buildTesseractSource();
    const widths = [0, 0.3, 0.6, 0.9].map((w) => sectionSpan(sectionAtW(source, w))[0]!);
    for (let i = 1; i < widths.length; i++) {
      // A cube's w-sections are all the same width until the plane exits; what
      // must hold is that none grows.
      expect(widths[i]!).toBeLessThanOrEqual(widths[i - 1]! + 1e-9);
    }
    for (const beyond of [W_REACH + 0.05, -(W_REACH + 0.05), 3]) {
      expect(sectionAtW(source, beyond).cellCount, `w=${beyond}`).toBe(0);
    }
  });

  it('accounts for every source cell in the section diagnostics', () => {
    const source = buildTesseractSource();
    const d = sectionAtW(source, 0.2).result.diagnostics;
    expect(
      d.sectionedCells + d.suppressedOnPlaneCells + d.cellsBelow + d.collapsedSectionCells
    ).toBe(d.sourceCells);
    // 4! simplices from the one 4-cell.
    expect(d.sourceCells).toBe(24);
  });

  it('gives every section vertex an ancestry in the authored tesseract', () => {
    const source = buildTesseractSource();
    const section = sectionAtW(source, 0.35);
    const { offsets, sourceVertices, weights } = section.result.lineage;
    const used = new Set<number>(Array.from(section.result.cells));
    expect(used.size).toBeGreaterThan(0);
    for (const vertex of used) {
      const from = offsets[vertex]!;
      const to = offsets[vertex + 1]!;
      expect(to).toBeGreaterThan(from);
      let total = 0;
      for (let k = from; k < to; k++) {
        expect(sourceVertices[k]!).toBeLessThan(16);
        total += weights[k]!;
      }
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it('rotates through a plane the camera cannot reach, and it changes the cut', () => {
    const source = buildTesseractSource();
    const before = sectionSpan(sectionAtW(source, 0.5));
    rotateHiddenPlanes(source, Math.PI / 5, 0);
    const after = sectionSpan(sectionAtW(source, 0.5));
    // The hidden rotation is real: the same w now cuts a different solid shape.
    const moved = before.some((v, i) => Math.abs(v - after[i]!) > 1e-3);
    expect(moved).toBe(true);
  });

  it('returns to the authored source when the rotation is undone', () => {
    const source = buildTesseractSource();
    rotateHiddenPlanes(source, 0.7, -0.4);
    rotateHiddenPlanes(source, 0, 0);
    for (let i = 0; i < source.complex.positions.length; i++) {
      // Rotation is applied to the authored positions every time, so returning
      // to zero returns exactly rather than approximately.
      expect(source.complex.positions[i]).toBeCloseTo(source.restPositions[i]!, 12);
    }
  });

  it('projects sixteen vertices and keeps the tesseract edge count', () => {
    const source = buildTesseractSource();
    expect(source.complex.vertexCount).toBe(16);
    expect(projectedPoints(source).length).toBe(16);
    // 4 · 2³ = 32 edges.
    expect(sourceEdges(source).length).toBe(32);
  });

  it('projects many source points into one place, which is the overlap', () => {
    // The projection view's honesty claim, one dimension up from scene 4: a
    // perspective 4D→3D projection is many-to-one, and the near and far cells
    // land inside one another rather than beside them.
    const source = buildTesseractSource();
    const radii = projectedPoints(source)
      .map((p) => Math.hypot(...p))
      .sort((a, b) => a - b);
    // Measured, not chosen: the sixteen corners land on exactly two shells,
    // eight per shell. The far cell sits INSIDE the near one — the small cube
    // within a cube — which is the overlap this scene is about, one dimension
    // up from scene 4's shared shadow.
    const distinct = [...new Set(radii.map((r) => r.toFixed(6)))];
    expect(distinct.length).toBe(2);
    expect(radii.filter((r) => r.toFixed(6) === distinct[0]).length).toBe(8);
    expect(radii.filter((r) => r.toFixed(6) === distinct[1]).length).toBe(8);
    expect(Number(distinct[0])).toBeLessThan(Number(distinct[1]));
    // Both shells are non-degenerate: nothing collapses to a point.
    expect(Number(distinct[0])).toBeGreaterThan(0.5);
  });
});
