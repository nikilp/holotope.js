import type { CellComplex, CellGroup } from '@holotope/core';

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
}

/** Axis held fixed by the section, and the three that are shown. */
export const SLICE_AXIS = 2;
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
  const perCell = group.verticesPerCell;
  const cells = group.indices.length / perCell;
  const capacity = cells * 6;
  const segments = into !== undefined && into.length >= capacity
    ? into
    : new Float32Array(capacity);
  const dim = complex.ambientDim;
  const at = (vertex: number, axis: number): number =>
    complex.positions[vertex * dim + axis]!;

  let written = 0;
  const crossing: number[] = [];
  for (let cell = 0; cell < cells; cell++) {
    crossing.length = 0;
    for (let corner = 0; corner < perCell; corner++) {
      const a = group.indices[cell * perCell + corner]!;
      const b = group.indices[cell * perCell + (corner + 1) % perCell]!;
      const da = at(a, SLICE_AXIS) - offset;
      const db = at(b, SLICE_AXIS) - offset;
      // Strictly opposite sides only: an edge lying in the plane would
      // otherwise be found twice, once from each of its two triangles.
      if ((da < 0) === (db < 0)) continue;
      const t = da / (da - db);
      for (const axis of SHOWN_AXES) {
        crossing.push(at(a, axis) + t * (at(b, axis) - at(a, axis)));
      }
    }
    // A triangle crosses a hyperplane in exactly two edges when it crosses at
    // all. Anything else is a degeneracy this section does not draw.
    if (crossing.length !== 6) continue;
    segments.set(crossing, written * 6);
    written++;
  }
  return { segments, count: written };
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
