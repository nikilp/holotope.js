import {
  HyperplaneSliceN,
  sectionSimplexGroupN,
  type CellComplex,
  type CellGroup,
  type HyperplaneSliceNOptions,
  type SectionSimplexGroupNDiagnosticsN,
  type SectionSimplexGroupNOptions,
  type SectionSimplexGroupNResultN,
  type SourceAffineLineageN
} from '@holotope/core';

/**
 * A genuine cross-section of the sheet, as opposed to a picture of it.
 *
 * Both of this page's views are projections, and every projection R4 → R3 is
 * many-to-one. Two objects that never meet in R4 can therefore overlap on
 * screen, separated precisely along whatever the map collapsed — which is
 * exactly what happens here, and why the sheet appears to sit inside the
 * obstacle when it is measurably clear of it.
 *
 * A hyperplane slice is the honest alternative. Fixing one coordinate and
 * showing the rest is **injective**: two points with the same image are the
 * same point, so an overlap you see in a section is an overlap that exists.
 * The price is dimension. The sheet is a 2-manifold in R4, so a hyperplane
 * meets it in curves rather than a surface — a section shows strictly less
 * than a projection, and lies about none of it.
 *
 * This slices along **Z**, the coordinate the X/W/Y view discards, so the
 * section spans X, Y and W. The obstacle occupies a Z range, so it has a real
 * cross-section there; the sheet's is the curve where it crosses that Z.
 */

/** One section: line segments in the slice's own three coordinates. */
export interface SheetSection {
  /** Flat `[x0,y0,w0, x1,y1,w1, ...]` endpoint pairs, ready for a buffer. */
  readonly segments: Float32Array;
  /** How many segments were produced. */
  readonly count: number;
  /**
   * Why the section is the size it is.
   *
   * A section that draws nothing is ambiguous on its own: the hyperplane may
   * have missed the surface, or it may have grazed cells the contract suppresses
   * rather than emit as degenerate segments. These are the library's own
   * populations, passed through rather than recounted.
   */
  readonly diagnostics: SectionSimplexGroupNDiagnosticsN;
  /**
   * How many distinct source triangles the cut passes through.
   *
   * For a 2-cell group this is **identically** the segment count, and not by
   * coincidence: a triangle splits 1–2 or 2–1, so its crossing grid is 1×2 or
   * 2×1 and admits exactly one staircase path — one segment per cut triangle,
   * never two. The number is kept because it is what reads `parentCells`, which
   * is the field that makes this a source-linked section rather than an
   * anonymous curve, and because it stops agreeing the moment this page cuts
   * cells of dimension three or more, where one cell can contribute several.
   * It is a label on the sheet, not an independent measurement of it.
   */
  readonly sourceCellCount: number;
  /**
   * Which source vertices each emitted endpoint is an affine combination of.
   *
   * Kept because a section endpoint's ancestry is the thing a projection cannot
   * give: a pixel names a triangle at best, while this names the exact blend of
   * source vertices the point *is*.
   */
  readonly lineage: SourceAffineLineageN;
}

/** Axis held fixed by the section, and the three that are shown. */
export const SLICE_AXIS = 2;
/**
 * The chart of `x[SLICE_AXIS] = offset` is the remaining axes in ascending
 * order, which is exactly X, Y, W — the section shows what the coordinate view
 * shows, plus the coordinate that view drops.
 */
const SHOWN_AXES = [0, 1, 3] as const;

/**
 * Cuts a triangulated surface with the hyperplane `x[SLICE_AXIS] = offset`.
 *
 * A triangle meets the hyperplane in a segment whenever its vertices fall on
 * both sides. Vertices exactly on the plane are treated as being on the
 * positive side, so a triangle lying entirely within it contributes nothing
 * rather than contributing a degenerate double edge.
 *
 * @param complex - Source complex carrying the surface.
 * @param group - The 2-cell group to cut.
 * @param offset - Where along the sliced axis to cut.
 * @param into - Optional buffer to fill, sized `3 * 2 * cellCount` or larger.
 * @returns The section, in the three shown coordinates.
 *
 * @example
 * ```ts
 * const section = sliceSurface(scene.sheet, scene.sheetGroup, 0.2);
 * // section.count segments, each two points of (x, y, w)
 * ```
 */
export function sliceSurface(
  complex: CellComplex,
  group: CellGroup,
  offset: number,
  into?: Float32Array
): SheetSection {
  const cells = group.indices.length / group.verticesPerCell;
  const capacity = cells * 6;
  const segments = into !== undefined && into.length >= capacity
    ? into
    : new Float32Array(capacity);

  // The library's own dimension-generic section, rather than a hand-written
  // marching pass for this one case. Its chart for `x[SLICE_AXIS] = offset` is
  // the remaining axes in ascending order, which is the X/Y/W triple this page
  // wants, so no reordering is needed here.
  const chart: HyperplaneSliceNOptions = {
    normal: axisNormal(complex.ambientDim, SLICE_AXIS),
    offset
  };
  const request: SectionSimplexGroupNOptions = {
    complex, group, slice: new HyperplaneSliceN(chart)
  };
  const section: SectionSimplexGroupNResultN = sectionSimplexGroupN(request);

  // Each cut triangle contributes exactly one segment, and its two endpoints
  // are already the shown coordinates.
  let written = 0;
  for (let cell = 0; cell < section.cellCount; cell++) {
    if (section.verticesPerCell !== 2) break;
    for (let endpoint = 0; endpoint < 2; endpoint++) {
      const vertex = section.cells[cell * 2 + endpoint]!;
      for (let axis = 0; axis < SHOWN_AXES.length; axis++) {
        segments[written * 6 + endpoint * 3 + axis] =
          section.chartPositions[vertex * section.chartDim + axis]!;
      }
    }
    written++;
  }
  // The parent source cell of every emitted segment, which is what makes this a
  // source-linked section rather than an anonymous curve.
  const sourceCells = new Set<number>();
  for (let cell = 0; cell < written; cell++) sourceCells.add(section.parentCells[cell]!);

  return {
    segments,
    count: written,
    sourceCellCount: sourceCells.size,
    diagnostics: section.diagnostics,
    lineage: section.lineage
  };
}

/** The unit normal of an axis-aligned hyperplane, as a packed array. */
function axisNormal(ambientDim: number, axis: number): Float64Array {
  const normal = new Float64Array(ambientDim);
  normal[axis] = 1;
  return normal;
}

/**
 * The range of the sliced axis the source currently spans.
 *
 * The section is only meaningful inside it, so the control that drives the
 * offset should follow the geometry rather than a fixed guess.
 *
 * @param complexes - Sources to include in the range.
 * @returns Inclusive low and high bounds along the sliced axis.
 */
export function sliceRange(
  complexes: readonly CellComplex[]
): readonly [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const complex of complexes) {
    for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
      const value = complex.positions[vertex * complex.ambientDim + SLICE_AXIS]!;
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  return Number.isFinite(low) ? [low, high] : [0, 0];
}
