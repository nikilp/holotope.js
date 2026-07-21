import type { CellComplex, CellGroup } from './cell-complex.js';

export interface CuboidSimplexizationOptionsN {
  /** Optional explicit key for the generated simplex group. */
  readonly outputKey?: string;
  /** Maximum generated simplex cells. Default 1,000,000. */
  readonly maxOutputCells?: number;
}

/** One auditable Kuhn decomposition of a homogeneous cuboid cell group. */
export interface CuboidSimplexizationN {
  readonly dimension: number;
  readonly sourceCellCount: number;
  readonly simplicesPerCell: number;
  readonly permutations: readonly (readonly number[])[];
  readonly simplexGroup: CellGroup;
  /** Parent source-cell ordinal for every generated simplex. */
  readonly sourceCellIndices: Uint32Array;
  /** Local lexicographic axis-permutation ordinal for every simplex. */
  readonly permutationIndices: Uint32Array;
}

/**
 * Decomposes every k-cuboid into k! simplices along its local main diagonal.
 *
 * Local cuboid vertices must use binary order: bit j selects local axis j.
 * Lexicographic axis permutations reproduce the established six-tetrahedron
 * cube decomposition exactly and generalize it to arbitrary practical k.
 */
export function simplexizeCuboidGroupN(
  group: CellGroup,
  options: CuboidSimplexizationOptionsN = {}
): CuboidSimplexizationN {
  if (group === null || typeof group !== 'object') {
    throw new Error('simplexizeCuboidGroupN: expected a CellGroup');
  }
  if (!Number.isSafeInteger(group.dim) || group.dim < 1 || group.dim > 30) {
    throw new Error(
      'simplexizeCuboidGroupN: group dimension must be an integer from 1 through 30'
    );
  }
  const expectedArity = 2 ** group.dim;
  if (group.kind !== 'cuboid' || group.verticesPerCell !== expectedArity) {
    throw new Error(
      `simplexizeCuboidGroupN: expected ${expectedArity}-vertex ${group.dim}-cuboids`
    );
  }
  if (group.indices.length === 0 || group.indices.length % expectedArity !== 0) {
    throw new Error('simplexizeCuboidGroupN: indices must contain complete cuboid cells');
  }
  if (
    options.outputKey !== undefined &&
    (typeof options.outputKey !== 'string' || options.outputKey.trim().length === 0)
  ) {
    throw new Error('simplexizeCuboidGroupN: outputKey must be a non-empty string');
  }
  const maxOutputCells = options.maxOutputCells ?? 1_000_000;
  if (!Number.isSafeInteger(maxOutputCells) || maxOutputCells < 1) {
    throw new Error(
      'simplexizeCuboidGroupN: maxOutputCells must be a positive integer'
    );
  }

  const sourceCellCount = group.indices.length / expectedArity;
  const simplicesPerCell = boundedFactorial(
    group.dim,
    Math.floor(maxOutputCells / sourceCellCount)
  );
  const outputCellCount = sourceCellCount * simplicesPerCell;
  if (outputCellCount > maxOutputCells) {
    throw new Error(
      `simplexizeCuboidGroupN: ${outputCellCount} output cells exceed budget ${maxOutputCells}`
    );
  }
  const outputIndexCount = outputCellCount * (group.dim + 1);
  if (!Number.isSafeInteger(outputIndexCount) || outputIndexCount > 0xffff_ffff) {
    throw new Error('simplexizeCuboidGroupN: output exceeds typed-array capacity');
  }

  const permutations = axisPermutations(group.dim);
  const indices = new Uint32Array(outputIndexCount);
  const sourceCellIndices = new Uint32Array(outputCellCount);
  const permutationIndices = new Uint32Array(outputCellCount);
  let outputIndex = 0;
  let outputCell = 0;
  for (let sourceCell = 0; sourceCell < sourceCellCount; sourceCell++) {
    const sourceOffset = sourceCell * expectedArity;
    for (let permutationIndex = 0; permutationIndex < permutations.length; permutationIndex++) {
      const permutation = permutations[permutationIndex]!;
      let localVertex = 0;
      indices[outputIndex++] = group.indices[sourceOffset]!;
      for (const axis of permutation) {
        localVertex += 2 ** axis;
        indices[outputIndex++] = group.indices[sourceOffset + localVertex]!;
      }
      sourceCellIndices[outputCell] = sourceCell;
      permutationIndices[outputCell] = permutationIndex;
      outputCell++;
    }
  }

  const simplexGroup: CellGroup = {
    ...(options.outputKey === undefined ? {} : { key: options.outputKey }),
    dim: group.dim,
    verticesPerCell: group.dim + 1,
    kind: 'simplex',
    indices
  };
  return Object.freeze({
    dimension: group.dim,
    sourceCellCount,
    simplicesPerCell,
    permutations,
    simplexGroup,
    sourceCellIndices,
    permutationIndices
  });
}

/**
 * Compatibility wrapper for tetrahedral slicing consumers.
 *
 * Converts every binary-ordered cuboid 3-cell group into tetrahedra and
 * appends the generated simplex groups to the same complex. Existing cuboid
 * groups remain in place.
 */
export function tetrahedralizeCuboidCells(complex: CellComplex): CellComplex {
  const cuboidGroups = complex.groups.filter(
    (group) => group.dim === 3 && group.kind === 'cuboid' && group.verticesPerCell === 8
  );
  if (cuboidGroups.length === 0) {
    throw new Error('tetrahedralizeCuboidCells: complex has no cuboid 3-cells');
  }
  for (const group of cuboidGroups) {
    complex.addGroup(simplexizeCuboidGroupN(group).simplexGroup);
  }
  return complex;
}

function boundedFactorial(value: number, maximum: number): number {
  let result = 1;
  for (let factor = 2; factor <= value; factor++) {
    if (result > Math.floor(maximum / factor)) {
      throw new Error(
        `simplexizeCuboidGroupN: factorial/output count exceeds budget`
      );
    }
    result *= factor;
  }
  return result;
}

function axisPermutations(dimension: number): readonly (readonly number[])[] {
  const result: Array<readonly number[]> = [];
  const current: number[] = [];
  const used = new Uint8Array(dimension);
  const visit = (): void => {
    if (current.length === dimension) {
      result.push(Object.freeze([...current]));
      return;
    }
    for (let axis = 0; axis < dimension; axis++) {
      if (used[axis] !== 0) continue;
      used[axis] = 1;
      current.push(axis);
      visit();
      current.pop();
      used[axis] = 0;
    }
  };
  visit();
  return Object.freeze(result);
}
