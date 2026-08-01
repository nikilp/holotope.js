import { TransformN } from '../math/transform.js';
import { VecN } from '../math/vecn.js';
import type { CellComplex } from './cell-complex.js';

/** Signed source-space or transformed-space limits along one unit direction. */
export interface CellComplexDirectionalBoundsN {
  /** Smallest signed vertex projection onto the normalized direction. */
  readonly min: number;
  /** Largest signed vertex projection onto the normalized direction. */
  readonly max: number;
}

/**
 * Projects every vertex of a cell complex onto a direction and returns the
 * closed interval containing those projections.
 *
 * The direction is normalized internally, so `min` and `max` are signed
 * distances in the same units as the source positions. For a normalized
 * `HyperplaneSlice4.normal`, this is exactly the offset interval over which
 * the convex hull can have a non-empty section. An optional transform makes
 * the interval describe the current world-space body rather than its authored
 * source pose.
 *
 * This is a vertex-hull bound. A disconnected or non-convex complex can have
 * empty sections inside the interval; the function never claims otherwise.
 */
export function cellComplexBoundsAlongDirectionN(
  complex: CellComplex,
  direction: VecN | ArrayLike<number>,
  transform?: TransformN
): CellComplexDirectionalBoundsN {
  if (complex.vertexCount === 0) {
    throw new Error('cellComplexBoundsAlongDirectionN: complex has no vertices');
  }
  const unit = direction instanceof VecN ? direction.clone() : new VecN(direction);
  if (unit.dim !== complex.ambientDim) {
    throw new Error(
      `cellComplexBoundsAlongDirectionN: direction is R${unit.dim}, complex is in R${complex.ambientDim}`
    );
  }
  if (Array.from(unit.data).some((value) => !Number.isFinite(value))) {
    throw new Error('cellComplexBoundsAlongDirectionN: direction must contain finite coordinates');
  }
  if (unit.lengthSq() === 0) {
    throw new Error('cellComplexBoundsAlongDirectionN: direction must be non-zero');
  }
  unit.normalize();

  if (transform !== undefined && transform.dim !== complex.ambientDim) {
    throw new Error(
      `cellComplexBoundsAlongDirectionN: transform is R${transform.dim}, complex is in R${complex.ambientDim}`
    );
  }
  const positions = transform === undefined
    ? complex.positions
    : transformedPositions(complex, transform);

  let min = Infinity;
  let max = -Infinity;
  const n = complex.ambientDim;
  for (let vertex = 0; vertex < complex.vertexCount; vertex += 1) {
    let projection = 0;
    for (let axis = 0; axis < n; axis += 1) {
      projection += positions[vertex * n + axis]! * unit.data[axis]!;
    }
    if (projection < min) min = projection;
    if (projection > max) max = projection;
  }
  return Object.freeze({ min, max });
}

/** Axis-aligned specialization of `cellComplexBoundsAlongDirectionN`. */
export function cellComplexBoundsAlongAxisN(
  complex: CellComplex,
  axis: number,
  transform?: TransformN
): CellComplexDirectionalBoundsN {
  if (!Number.isSafeInteger(axis) || axis < 0 || axis >= complex.ambientDim) {
    throw new Error(
      `cellComplexBoundsAlongAxisN: axis ${axis} out of range for R${complex.ambientDim}`
    );
  }
  return cellComplexBoundsAlongDirectionN(
    complex,
    VecN.basis(complex.ambientDim, axis),
    transform
  );
}

function transformedPositions(complex: CellComplex, transform: TransformN): Float64Array {
  const result = new Float64Array(complex.positions.length);
  transform.applyToPositions(complex.positions, result, complex.vertexCount);
  return result;
}
