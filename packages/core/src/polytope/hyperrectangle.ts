import type { CellComplex } from '../geometry/cell-complex.js';
import { createHypercube } from './hypercube.js';

/**
 * Edge lengths and topology depth for a centered axis-aligned orthotope.
 *
 * There is no `size`: the whole point of this shape is that each axis has its
 * own extent, and there is no position or orientation either, because pose
 * stays an explicit transform applied afterwards.
 */
export interface HyperrectangleOptions {
  /** Ambient and intrinsic dimension. */
  readonly dim: number;
  /** One positive full edge length per ambient axis. */
  readonly edgeLengths: ArrayLike<number>;
  /** Highest authored cuboid-cell dimension. Default `min(dim, 3)`. */
  readonly maxCellDimension?: number;
}

/**
 * Builds the centered axis-aligned orthotope with the given edge lengths.
 *
 * The constructed set is
 *
 * $$H(\ell)=\\{x\\in\\mathbb R^n : -\\ell_i/2 \\le x_i \\le \\ell_i/2\\},$$
 *
 * so `edgeLengths[i]` is the **full** extent along source axis `i` and the body
 * is centred on the origin. "Orthotope" is the usual N-dimensional name for
 * this shape.
 *
 * Topology, cell ordering, local cuboid-vertex ordering, and group ordering are
 * identical to `createHypercube` at the same `dim` and `maxCellDimension`; only
 * positions differ. That is not an implementation detail to be relied on
 * loosely — it is the contract, and it is what lets every consumer of a
 * hypercube accept this shape without a second code path. Equal edge lengths
 * reproduce a hypercube's position buffer exactly.
 *
 * Unequal lengths matter because a cube's inertia is isotropic. An unequal-edge
 * orthotope can have non-isotropic R4 plane inertia; lengths such as
 * `[2, 3, 5, 7]` make all six plane inertias distinct and therefore exercise
 * anisotropic rigid-body motion without an authored inertia override.
 *
 * Orientation and translation stay outside the shape: pose it afterwards with a
 * rotor and a translation. Non-uniform scale is deliberately not part of
 * `TransformN`, because a non-uniformly scaled rotation composes into shear and
 * needs a different transform algebra. Baking one axis-aligned shape into the
 * source once avoids that entirely.
 *
 * @param options - Dimension, one positive edge length per axis, and the
 * highest cell dimension to author.
 * @returns A complex in `dim` dimensions, centered at the origin.
 * @throws If `dim` is out of range, `edgeLengths` does not have exactly `dim`
 * finite positive entries, or `maxCellDimension` is not an integer from 1
 * through `dim`. Every refusal happens before allocation.
 *
 * @example
 * A 4D body whose plane inertias are all different:
 * ```ts
 * // HyperrectangleOptions.
 * const options = {
 *   dim: 4,
 *   edgeLengths: [2, 3, 5, 7],
 *   maxCellDimension: 3
 * };
 * const body = createHyperrectangle(options);
 * log(body.vertexCount); // 16
 * log(Array.from(body.getPosition(0))); // [-1, -1.5, -2.5, -3.5]
 * ```
 *
 * @example
 * Equal lengths are a hypercube, byte for byte:
 * ```ts
 * // Both are a CellComplex.
 * const box = createHyperrectangle({ dim: 4, edgeLengths: [2, 2, 2, 2] });
 * const cube = createHypercube({ dim: 4, size: 2 });
 * log(box.positions.every((value, index) => value === cube.positions[index])); // true
 * ```
 */
export function createHyperrectangle(options: HyperrectangleOptions): CellComplex {
  const { dim, edgeLengths, maxCellDimension } = options;

  if (!Number.isSafeInteger(dim) || dim < 1 || dim > 30) {
    throw new Error(
      `createHyperrectangle: dim must be an integer from 1 through 30, received ${dim}`
    );
  }
  if (edgeLengths === null || edgeLengths === undefined) {
    throw new Error('createHyperrectangle: edgeLengths is required');
  }
  if (edgeLengths.length !== dim) {
    throw new Error(
      `createHyperrectangle: edgeLengths must have one entry per axis (${dim}), received ${edgeLengths.length}`
    );
  }
  if (
    maxCellDimension !== undefined &&
    (!Number.isSafeInteger(maxCellDimension) ||
      maxCellDimension < 1 ||
      maxCellDimension > dim)
  ) {
    throw new Error(
      `createHyperrectangle: maxCellDimension must be an integer from 1 through ${dim}, received ${maxCellDimension}`
    );
  }

  // Copied before use, so the returned complex retains no caller-owned state
  // and a later mutation of the argument cannot reshape the body.
  const lengths = new Float64Array(dim);
  for (let axis = 0; axis < dim; axis += 1) {
    const length = edgeLengths[axis]!;
    if (!Number.isFinite(length)) {
      throw new Error(
        `createHyperrectangle: edgeLengths[${axis}] must be finite, received ${length}`
      );
    }
    if (length <= 0) {
      throw new Error(
        `createHyperrectangle: edgeLengths[${axis}] must be positive, received ${length}`
      );
    }
    lengths[axis] = length;
  }

  // The unit cube supplies the established bit ordering and topology; scaling
  // its positions per axis is the whole construction. Writing a second
  // combinatorial loop here would be a second thing to keep in agreement.
  const complex = createHypercube(
    maxCellDimension === undefined ? { dim, size: 1 } : { dim, size: 1, maxCellDimension }
  );
  const { positions } = complex;
  for (let vertex = 0; vertex < complex.vertexCount; vertex += 1) {
    const base = vertex * dim;
    for (let axis = 0; axis < dim; axis += 1) {
      positions[base + axis] = positions[base + axis]! * lengths[axis]!;
    }
  }
  return complex;
}
