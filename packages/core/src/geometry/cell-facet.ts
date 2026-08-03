import type { CellComplex, CellGroup } from './cell-complex.js';

/** Which boundary facet a cell lies on, and which way that facet faces. */
export interface CellFacetN {
  /** Ambient axis held constant across the cell. */
  readonly axis: number;
  /** `+1` at the complex's maximum along `axis`, `-1` at its minimum. */
  readonly sign: 1 | -1;
  /** The constant coordinate itself, in source units. */
  readonly coordinate: number;
}

/**
 * Names the boundary facet a cuboid cell lies on, recovered from positions.
 *
 * A facet-dimensional cuboid cell spans every ambient axis but one, so the
 * remaining axis is constant across its corners and identifies the facet. This
 * reads that axis off the geometry, because the cell carries no such metadata:
 * `CellGroup` is positions plus indices, and a construction like
 * `createHypercube` emits no per-cell record of which side it came from.
 *
 * Callers reconstruct this constantly and get it wrong in the same two ways.
 * Comparing coordinates against a literal `±1` assumes a particular `size`, and
 * taking `Math.sign` of the coordinate assumes the complex is centred on the
 * origin. Both are silent: they return a confident wrong facet for a rescaled
 * or translated complex rather than failing. Orientation here is resolved
 * against the complex's own extent along the axis, so it survives both.
 *
 * @param complex - Complex owning the positions.
 * @param group - Cuboid group of dimension `complex.ambientDim - 1`.
 * @param cell - Cell ordinal within `group`.
 * @param tolerance - Absolute slack for treating coordinates as equal.
 * @returns The facet, or `null` if the cell lies on none — a group of the wrong
 * dimension, a cell whose corners share no axis, or one whose constant axis
 * sits strictly inside the body.
 *
 * @example
 * Name every facet of a tesseract without assuming its size or centre:
 * ```ts
 * const tesseract = createHypercube({ dim: 4, size: 2, maxCellDimension: 3 });
 * const cubes = tesseract.cellsOfDim(3).find((group) => group.kind === 'cuboid');
 * if (!cubes) throw new Error('no cuboid 3-cells; raise maxCellDimension');
 *
 * // A group carries no cell count; derive it from the index buffer.
 * const cellCount = cubes.indices.length / cubes.verticesPerCell;
 *
 * const facets = [];
 * for (let cell = 0; cell < cellCount; cell += 1) {
 *   // CellFacetN, or null for a cell that is not on the boundary.
 *   const facet = cuboidCellFacetN(tesseract, cubes, cell);
 *   facets.push(facet === null ? 'none' : `${facet.axis}:${facet.sign > 0 ? '+' : '-'}`);
 * }
 * log(facets.join(' ')); // 3:- 3:+ 2:- 2:+ 1:- 1:+ 0:- 0:+
 * ```
 */
export function cuboidCellFacetN(
  complex: CellComplex,
  group: CellGroup,
  cell: number,
  tolerance = 1e-12
): CellFacetN | null {
  const stride = group.verticesPerCell;
  const cellCount = group.indices.length / stride;
  if (group.dim !== complex.ambientDim - 1) return null;
  if (!Number.isInteger(cell) || cell < 0 || cell >= cellCount) return null;

  for (let axis = 0; axis < complex.ambientDim; axis += 1) {
    let low = Infinity;
    let high = -Infinity;
    for (let corner = 0; corner < stride; corner += 1) {
      const value = complex.getPosition(group.indices[cell * stride + corner]!)[axis]!;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    if (high - low > tolerance) continue;

    // Constant across the cell. It names a facet only if it is also extreme
    // for the whole complex; an axis-aligned interior cell is not a boundary.
    const coordinate = (low + high) / 2;
    const extent = extentAlong(complex, axis);
    if (Math.abs(coordinate - extent.max) <= tolerance) {
      return { axis, sign: 1, coordinate };
    }
    if (Math.abs(coordinate - extent.min) <= tolerance) {
      return { axis, sign: -1, coordinate };
    }
    return null;
  }
  return null;
}

function extentAlong(
  complex: CellComplex,
  axis: number
): { min: number; max: number } {
  const { ambientDim, vertexCount, positions } = complex;
  let min = Infinity;
  let max = -Infinity;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const value = positions[vertex * ambientDim + axis]!;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}
