import { MatN } from '../math/matn.js';
import { symmetricEigenDecomposition } from '../spectral/symmetric-eigen.js';

export type CoordinateConstraintConsistency = 'compatible' | 'conflicting';
export type CoordinateConstraintDetermination = 'unique' | 'rank-deficient';

/**
 * One auditable block of linear equations `A x = b`.
 *
 * Coefficients are packed row-major. `scale` names the block's units: the
 * solver minimizes `weight * ||(A x - b) / scale||^2`. Multiplying the
 * coefficients, targets, and scale by the same positive value therefore
 * leaves the problem unchanged.
 */
export interface LinearCoordinateConstraintBlockN {
  readonly coefficients: ArrayLike<number>;
  readonly targets: ArrayLike<number>;
  readonly rowCount: number;
  readonly weight?: number;
  readonly scale?: number;
  readonly label?: string;
}

export interface LinearCoordinateConstraintOptions {
  /** Null-space preference. Default is the zero coordinate. */
  readonly prior?: ArrayLike<number>;
  /** Weighted normalized residual tolerance. Default `1e-9`. */
  readonly tolerance?: number;
  /** Relative singular-value rank tolerance. Default `1e-10`. */
  readonly rankTolerance?: number;
}

export interface LinearCoordinateConstraintBlockDiagnosticN {
  readonly label?: string;
  readonly rowCount: number;
  readonly weight: number;
  readonly scale: number;
  readonly rank: number;
  readonly normalizedResidualRms: number;
  readonly maxNormalizedResidual: number;
}

export interface LinearCoordinateConstraintFitN {
  readonly solution: Float64Array;
  readonly consistency: CoordinateConstraintConsistency;
  readonly determination: CoordinateConstraintDetermination;
  readonly coordinateDim: number;
  readonly totalRows: number;
  readonly rank: number;
  readonly unresolvedDegreesOfFreedom: number;
  /** Smallest/largest resolved singular-value ratio; zero when rank is zero. */
  readonly rankConditioning: number;
  /** Singular values in ascending order. */
  readonly singularValues: Float64Array;
  readonly rankThreshold: number;
  /** Sum of `weight * squared normalized residual` over every row. */
  readonly objective: number;
  /** RMS using `sum(weight * rowCount)` as its denominator. */
  readonly normalizedResidualRms: number;
  readonly maxNormalizedResidual: number;
  /** Euclidean norm of the normalized normal-equation residual `A^T(Ax-b)`. */
  readonly normalResidual: number;
  readonly blocks: readonly LinearCoordinateConstraintBlockDiagnosticN[];
}

interface ValidatedBlock {
  readonly source: LinearCoordinateConstraintBlockN;
  readonly coefficients: Float64Array;
  readonly targets: Float64Array;
  readonly rowCount: number;
  readonly weight: number;
  readonly scale: number;
}

interface SpectralNormalReport {
  readonly values: Float64Array;
  readonly vectors: MatN;
  readonly singularValues: Float64Array;
  readonly threshold: number;
  readonly rank: number;
  readonly conditioning: number;
}

/**
 * Deterministic Float64 golden solver for dimension-independent linear
 * coordinate constraints.
 *
 * Resolved spectral components minimize the weighted normalized least-squares
 * objective. Rank-deficient components are copied from `prior`, so a prior can
 * select a point inside the unresolved affine family without perturbing any
 * component established by the observations.
 */
export function solveLinearCoordinateConstraintsN(
  coordinateDim: number,
  blocks: readonly LinearCoordinateConstraintBlockN[],
  options: LinearCoordinateConstraintOptions = {}
): LinearCoordinateConstraintFitN {
  if (!Number.isSafeInteger(coordinateDim) || coordinateDim < 1) {
    throw new Error(
      'solveLinearCoordinateConstraintsN: coordinateDim must be a positive safe integer'
    );
  }
  const tolerance = positiveFinite(
    options.tolerance ?? 1e-9,
    'solveLinearCoordinateConstraintsN: tolerance'
  );
  const rankTolerance = positiveFinite(
    options.rankTolerance ?? 1e-10,
    'solveLinearCoordinateConstraintsN: rankTolerance'
  );
  const prior = options.prior === undefined
    ? new Float64Array(coordinateDim)
    : finiteTuple(
        options.prior,
        coordinateDim,
        'solveLinearCoordinateConstraintsN: prior'
      );
  const validated = blocks.map((block, index) =>
    validateBlock(block, index, coordinateDim)
  );

  const normal = new MatN(coordinateDim);
  const rhs = new Float64Array(coordinateDim);
  for (const block of validated) {
    const normalization = Math.sqrt(block.weight) / block.scale;
    for (let row = 0; row < block.rowCount; row++) {
      const target = normalization * block.targets[row]!;
      const offset = row * coordinateDim;
      for (let left = 0; left < coordinateDim; left++) {
        const leftValue = normalization * block.coefficients[offset + left]!;
        rhs[left]! += leftValue * target;
        for (let right = 0; right < coordinateDim; right++) {
          normal.set(
            left,
            right,
            normal.get(left, right) +
              leftValue * normalization * block.coefficients[offset + right]!
          );
        }
      }
    }
  }

  const spectral = decomposeNormal(normal, rankTolerance);
  const solution = solveSpectral(spectral, rhs, prior);
  const blockDiagnostics: LinearCoordinateConstraintBlockDiagnosticN[] = [];
  let objective = 0;
  let weightedRows = 0;
  let maxNormalizedResidual = 0;
  const normalEquationResidual = new Float64Array(coordinateDim);

  for (const block of validated) {
    let blockSquaredResidual = 0;
    let blockMaximum = 0;
    const blockNormal = new MatN(coordinateDim);
    for (let row = 0; row < block.rowCount; row++) {
      const offset = row * coordinateDim;
      let applied = 0;
      for (let coordinate = 0; coordinate < coordinateDim; coordinate++) {
        applied += block.coefficients[offset + coordinate]! * solution[coordinate]!;
      }
      const residual = (applied - block.targets[row]!) / block.scale;
      const absoluteResidual = Math.abs(residual);
      blockSquaredResidual += residual ** 2;
      blockMaximum = Math.max(blockMaximum, absoluteResidual);
      objective += block.weight * residual ** 2;
      weightedRows += block.weight;
      maxNormalizedResidual = Math.max(maxNormalizedResidual, absoluteResidual);
      for (let left = 0; left < coordinateDim; left++) {
        const leftValue = block.coefficients[offset + left]! / block.scale;
        normalEquationResidual[left]! += block.weight * leftValue * residual;
        for (let right = 0; right < coordinateDim; right++) {
          blockNormal.set(
            left,
            right,
            blockNormal.get(left, right) +
              block.weight * leftValue *
                block.coefficients[offset + right]! / block.scale
          );
        }
      }
    }
    const blockRank = decomposeNormal(blockNormal, rankTolerance).rank;
    blockDiagnostics.push({
      ...(block.source.label === undefined ? {} : { label: block.source.label }),
      rowCount: block.rowCount,
      weight: block.weight,
      scale: block.scale,
      rank: blockRank,
      normalizedResidualRms: Math.sqrt(blockSquaredResidual / block.rowCount),
      maxNormalizedResidual: blockMaximum
    });
  }

  const normalizedResidualRms = weightedRows === 0
    ? 0
    : Math.sqrt(objective / weightedRows);
  return {
    solution,
    consistency: normalizedResidualRms <= tolerance
      ? 'compatible'
      : 'conflicting',
    determination: spectral.rank === coordinateDim
      ? 'unique'
      : 'rank-deficient',
    coordinateDim,
    totalRows: validated.reduce((total, block) => total + block.rowCount, 0),
    rank: spectral.rank,
    unresolvedDegreesOfFreedom: coordinateDim - spectral.rank,
    rankConditioning: spectral.conditioning,
    singularValues: spectral.singularValues,
    rankThreshold: spectral.threshold,
    objective,
    normalizedResidualRms,
    maxNormalizedResidual,
    normalResidual: euclideanNorm(normalEquationResidual),
    blocks: Object.freeze(blockDiagnostics)
  };
}

function validateBlock(
  block: LinearCoordinateConstraintBlockN,
  index: number,
  coordinateDim: number
): ValidatedBlock {
  const caller = `solveLinearCoordinateConstraintsN: block ${index}`;
  if (!Number.isSafeInteger(block.rowCount) || block.rowCount < 1) {
    throw new Error(`${caller} rowCount must be a positive safe integer`);
  }
  const coefficients = finiteTuple(
    block.coefficients,
    block.rowCount * coordinateDim,
    `${caller} coefficients`
  );
  const targets = finiteTuple(block.targets, block.rowCount, `${caller} targets`);
  return {
    source: block,
    coefficients,
    targets,
    rowCount: block.rowCount,
    weight: positiveFinite(block.weight ?? 1, `${caller} weight`),
    scale: positiveFinite(block.scale ?? 1, `${caller} scale`)
  };
}

function decomposeNormal(normal: MatN, rankTolerance: number): SpectralNormalReport {
  const eigensystem = symmetricEigenDecomposition(normal, {
    tolerance: Math.min(1e-12, rankTolerance * 0.1),
    symmetryTolerance: 1e-13
  });
  const maximum = Math.max(0, eigensystem.values[normal.n - 1]!);
  const threshold = Math.max(1, maximum) * rankTolerance ** 2;
  const singularValues = new Float64Array(normal.n);
  let rank = 0;
  let minimumResolved = Number.POSITIVE_INFINITY;
  for (let eigen = 0; eigen < normal.n; eigen++) {
    const value = Math.max(0, eigensystem.values[eigen]!);
    singularValues[eigen] = Math.sqrt(value);
    if (value > threshold) {
      rank++;
      minimumResolved = Math.min(minimumResolved, value);
    }
  }
  return {
    values: eigensystem.values,
    vectors: eigensystem.vectors,
    singularValues,
    threshold,
    rank,
    conditioning: rank === 0 || maximum === 0
      ? 0
      : Math.sqrt(minimumResolved / maximum)
  };
}

function solveSpectral(
  spectral: SpectralNormalReport,
  rhs: Float64Array,
  prior: Float64Array
): Float64Array {
  const solution = new Float64Array(rhs.length);
  for (let eigen = 0; eigen < rhs.length; eigen++) {
    let rhsComponent = 0;
    let priorComponent = 0;
    for (let coordinate = 0; coordinate < rhs.length; coordinate++) {
      const vector = spectral.vectors.get(coordinate, eigen);
      rhsComponent += vector * rhs[coordinate]!;
      priorComponent += vector * prior[coordinate]!;
    }
    const component = spectral.values[eigen]! > spectral.threshold
      ? rhsComponent / spectral.values[eigen]!
      : priorComponent;
    for (let coordinate = 0; coordinate < rhs.length; coordinate++) {
      solution[coordinate]! += spectral.vectors.get(coordinate, eigen) * component;
    }
  }
  return solution;
}

function finiteTuple(
  values: ArrayLike<number>,
  expectedLength: number,
  caller: string
): Float64Array {
  if (values.length !== expectedLength) {
    throw new Error(`${caller} must contain ${expectedLength} values`);
  }
  const copy = new Float64Array(expectedLength);
  for (let index = 0; index < expectedLength; index++) {
    const value = values[index]!;
    if (!Number.isFinite(value)) throw new Error(`${caller} must be finite`);
    copy[index] = value;
  }
  return copy;
}

function positiveFinite(value: number, caller: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${caller} must be finite and positive`);
  }
  return value;
}

function euclideanNorm(values: ArrayLike<number>): number {
  let norm = 0;
  for (let index = 0; index < values.length; index++) {
    norm = Math.hypot(norm, values[index]!);
  }
  return norm;
}
