import { MatN, VecN } from '@holotope/core';
import { analyzePolynomialThresholdInterval } from './polynomial-threshold-interval.js';

export interface AnalyzeLinearSimplexMeasureNOptions {
  /** Non-degenerate k-simplex rest state, with `1 <= k <= ambientDimension`. */
  readonly restPositions: readonly VecN[];
  /** Particle positions at normalized trajectory time zero. */
  readonly startPositions: readonly VecN[];
  /** Particle positions at normalized trajectory time one. */
  readonly endPositions: readonly VecN[];
  /** Required intrinsic current/rest k-measure ratio. */
  readonly minimumMeasureRatio: number;
  /** Smallest unresolved normalized-time interval. Default 2^-30. */
  readonly timeTolerance?: number;
  /** Hard de Casteljau subdivision depth. Default 48. */
  readonly maximumDepth?: number;
  /** Relative Bernstein-coefficient tolerance. Default 256 * Number.EPSILON. */
  readonly relativeCoefficientTolerance?: number;
}

export interface LinearSimplexMeasureAnalysisBaseN {
  readonly ambientDimension: number;
  readonly simplexDimension: number;
  readonly degree: number;
  readonly minimumMeasureRatio: number;
  readonly minimumSquaredMeasureRatio: number;
  readonly startSquaredMeasureRatio: number;
  readonly endSquaredMeasureRatio: number;
  /** Coefficients of `squaredMeasureRatio(t) - minimumMeasureRatio^2`. */
  readonly monomialCoefficients: Float64Array;
  /** The same squared-ratio threshold polynomial in Bernstein form on [0,1]. */
  readonly bernsteinCoefficients: Float64Array;
  readonly timeTolerance: number;
  readonly maximumDepth: number;
  readonly relativeCoefficientTolerance: number;
  readonly absoluteCoefficientTolerance: number;
}

export interface LinearSimplexMeasureSafeN
  extends LinearSimplexMeasureAnalysisBaseN {
  readonly status: 'safe';
  /** Conservative lower bound on the squared-ratio margin. */
  readonly minimumMarginLowerBound: number;
}

export interface LinearSimplexMeasureInitialViolationN
  extends LinearSimplexMeasureAnalysisBaseN {
  readonly status: 'initial-violation';
  /** Initial squared-ratio margin. */
  readonly initialMargin: number;
}

export interface LinearSimplexMeasurePossibleViolationN
  extends LinearSimplexMeasureAnalysisBaseN {
  readonly status: 'possible-violation';
  /** Earliest conservative normalized-time enclosure that could meet the threshold. */
  readonly timeBracket: readonly [number, number];
  readonly candidateTime: number;
  readonly marginAtBracketStart: number;
  readonly marginAtBracketEnd: number;
  readonly bernsteinBounds: readonly [number, number];
  readonly reason: 'negative-enclosure' | 'resolution-limit';
}

export type LinearSimplexMeasureAnalysisN =
  | LinearSimplexMeasureSafeN
  | LinearSimplexMeasureInitialViolationN
  | LinearSimplexMeasurePossibleViolationN;

/**
 * Conservatively checks intrinsic k-measure along a linear simplex trajectory.
 *
 * For edge matrix `E(t) = A + tB`, the normalized Gram determinant
 * `det(E(t)^T E(t)) / det(Erest^T Erest)` is the squared current/rest
 * k-measure ratio. Its degree is at most 2k. The Float64 reference constructs
 * the three Gram coefficient matrices, expands their determinant by column
 * multilinearity, and classifies the threshold polynomial with Bernstein
 * convex-hull bounds and de Casteljau subdivision.
 *
 * Coefficient construction costs O(3^k k^3 + N k^2). It is an auditable
 * small-k golden path, not a high-dimensional performance backend.
 */
export function analyzeLinearSimplexMeasureN(
  options: AnalyzeLinearSimplexMeasureNOptions
): LinearSimplexMeasureAnalysisN {
  const { ambientDimension, simplexDimension } = validateOptions(options);
  const restColumns = edgeColumns(
    options.restPositions,
    ambientDimension,
    simplexDimension
  );
  const startColumns = edgeColumns(
    options.startPositions,
    ambientDimension,
    simplexDimension
  );
  const endColumns = edgeColumns(
    options.endPositions,
    ambientDimension,
    simplexDimension
  );
  const deltaColumns = endColumns.map((column, index) => {
    const delta = new Float64Array(ambientDimension);
    for (let axis = 0; axis < ambientDimension; axis++) {
      delta[axis] = column[axis]! - startColumns[index]![axis]!;
    }
    return delta;
  });

  const restGramDeterminant = determinantFromColumns(
    gramColumns(restColumns, ambientDimension, simplexDimension)
  );
  if (!(restGramDeterminant > 0)) {
    throw new Error(
      'analyzeLinearSimplexMeasureN: rest simplex must be non-degenerate'
    );
  }
  if (!Number.isFinite(restGramDeterminant)) {
    throw new Error(
      'analyzeLinearSimplexMeasureN: rest Gram determinant is outside the Float64 range'
    );
  }

  const gramCoefficientColumns = gramPolynomialColumns(
    startColumns,
    deltaColumns,
    ambientDimension,
    simplexDimension
  );
  const determinantCoefficients = quadraticMatrixDeterminantPolynomial(
    gramCoefficientColumns,
    simplexDimension
  );
  const degree = 2 * simplexDimension;
  const monomialCoefficients = new Float64Array(degree + 1);
  for (let power = 0; power <= degree; power++) {
    monomialCoefficients[power] = determinantCoefficients[power]! /
      restGramDeterminant;
    if (!Number.isFinite(monomialCoefficients[power])) {
      throw new Error(
        'analyzeLinearSimplexMeasureN: normalized Gram polynomial is outside the Float64 range'
      );
    }
  }
  const minimumSquaredMeasureRatio = options.minimumMeasureRatio ** 2;
  if (!Number.isFinite(minimumSquaredMeasureRatio)) {
    throw new Error(
      'analyzeLinearSimplexMeasureN: minimumMeasureRatio squared is outside the Float64 range'
    );
  }
  monomialCoefficients[0] = monomialCoefficients[0]! -
    minimumSquaredMeasureRatio;

  const interval = analyzePolynomialThresholdInterval(monomialCoefficients, {
    ...(options.timeTolerance === undefined
      ? {} : { timeTolerance: options.timeTolerance }),
    ...(options.maximumDepth === undefined
      ? {} : { maximumDepth: options.maximumDepth }),
    ...(options.relativeCoefficientTolerance === undefined
      ? {} : {
          relativeCoefficientTolerance: options.relativeCoefficientTolerance
        })
  });
  const base: LinearSimplexMeasureAnalysisBaseN = {
    ambientDimension,
    simplexDimension,
    degree,
    minimumMeasureRatio: options.minimumMeasureRatio,
    minimumSquaredMeasureRatio,
    startSquaredMeasureRatio: monomialCoefficients[0]! +
      minimumSquaredMeasureRatio,
    endSquaredMeasureRatio: interval.bernsteinCoefficients[degree]! +
      minimumSquaredMeasureRatio,
    monomialCoefficients,
    bernsteinCoefficients: interval.bernsteinCoefficients,
    timeTolerance: interval.timeTolerance,
    maximumDepth: interval.maximumDepth,
    relativeCoefficientTolerance: interval.relativeCoefficientTolerance,
    absoluteCoefficientTolerance: interval.absoluteCoefficientTolerance
  };
  if (interval.status === 'initial-violation') {
    return Object.freeze({
      ...base,
      status: 'initial-violation',
      initialMargin: interval.initialMargin
    });
  }
  if (interval.status === 'safe') {
    return Object.freeze({
      ...base,
      status: 'safe',
      minimumMarginLowerBound: interval.minimumMarginLowerBound
    });
  }
  return Object.freeze({
    ...base,
    status: 'possible-violation',
    timeBracket: interval.timeBracket,
    candidateTime: interval.candidateTime,
    marginAtBracketStart: interval.marginAtBracketStart,
    marginAtBracketEnd: interval.marginAtBracketEnd,
    bernsteinBounds: interval.bernsteinBounds,
    reason: interval.reason
  });
}

function validateOptions(
  options: AnalyzeLinearSimplexMeasureNOptions
): { ambientDimension: number; simplexDimension: number } {
  const caller = 'analyzeLinearSimplexMeasureN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  if (!Number.isFinite(options.minimumMeasureRatio) ||
    options.minimumMeasureRatio < 0) {
    throw new Error(
      `${caller}: minimumMeasureRatio must be finite and non-negative`
    );
  }
  const timeTolerance = options.timeTolerance ?? 2 ** -30;
  if (!Number.isFinite(timeTolerance) || timeTolerance <= 0 || timeTolerance > 1) {
    throw new Error(`${caller}: timeTolerance must be finite in (0, 1]`);
  }
  const maximumDepth = options.maximumDepth ?? 48;
  if (!Number.isSafeInteger(maximumDepth) || maximumDepth < 1 || maximumDepth > 64) {
    throw new Error(`${caller}: maximumDepth must be an integer in [1, 64]`);
  }
  const relativeTolerance = options.relativeCoefficientTolerance ??
    256 * Number.EPSILON;
  if (!Number.isFinite(relativeTolerance) || relativeTolerance < 0) {
    throw new Error(
      `${caller}: relativeCoefficientTolerance must be finite and non-negative`
    );
  }
  if (!Array.isArray(options.restPositions) || options.restPositions.length < 2) {
    throw new Error(`${caller}: restPositions must contain a k-simplex`);
  }
  const first = options.restPositions[0];
  if (!(first instanceof VecN)) {
    throw new Error(`${caller}: restPositions[0] must be a VecN`);
  }
  const ambientDimension = first.dim;
  const simplexDimension = options.restPositions.length - 1;
  if (simplexDimension > ambientDimension) {
    throw new Error(`${caller}: simplex dimension exceeds ambient dimension`);
  }
  validatePositions(
    options.restPositions,
    ambientDimension,
    simplexDimension,
    `${caller}: restPositions`
  );
  validatePositions(
    options.startPositions,
    ambientDimension,
    simplexDimension,
    `${caller}: startPositions`
  );
  validatePositions(
    options.endPositions,
    ambientDimension,
    simplexDimension,
    `${caller}: endPositions`
  );
  return { ambientDimension, simplexDimension };
}

function validatePositions(
  positions: readonly VecN[],
  ambientDimension: number,
  simplexDimension: number,
  label: string
): void {
  if (!Array.isArray(positions) || positions.length !== simplexDimension + 1) {
    throw new Error(
      `${label} must contain exactly ${simplexDimension + 1} points`
    );
  }
  for (let index = 0; index < positions.length; index++) {
    const point = positions[index];
    if (!(point instanceof VecN)) {
      throw new Error(`${label}[${index}] must be a VecN`);
    }
    if (point.dim !== ambientDimension) {
      throw new Error(
        `${label}[${index}] is R${point.dim}, expected R${ambientDimension}`
      );
    }
    for (const coordinate of point.data) {
      if (!Number.isFinite(coordinate)) {
        throw new Error(`${label}[${index}] must contain finite coordinates`);
      }
    }
  }
}

function edgeColumns(
  positions: readonly VecN[],
  ambientDimension: number,
  simplexDimension: number
): Float64Array[] {
  const origin = positions[0]!;
  return Array.from({ length: simplexDimension }, (_, column) => {
    const edge = new Float64Array(ambientDimension);
    const endpoint = positions[column + 1]!;
    for (let axis = 0; axis < ambientDimension; axis++) {
      edge[axis] = endpoint.data[axis]! - origin.data[axis]!;
    }
    return edge;
  });
}

function gramColumns(
  edges: readonly Float64Array[],
  ambientDimension: number,
  simplexDimension: number
): Float64Array[] {
  return Array.from({ length: simplexDimension }, (_, column) => {
    const values = new Float64Array(simplexDimension);
    for (let row = 0; row < simplexDimension; row++) {
      values[row] = dot(edges[row]!, edges[column]!, ambientDimension);
    }
    return values;
  });
}

function gramPolynomialColumns(
  startEdges: readonly Float64Array[],
  deltaEdges: readonly Float64Array[],
  ambientDimension: number,
  simplexDimension: number
): readonly [Float64Array[], Float64Array[], Float64Array[]] {
  const byDegree = [0, 1, 2].map(() =>
    Array.from(
      { length: simplexDimension },
      () => new Float64Array(simplexDimension)
    )
  ) as [Float64Array[], Float64Array[], Float64Array[]];
  for (let column = 0; column < simplexDimension; column++) {
    for (let row = 0; row < simplexDimension; row++) {
      byDegree[0][column]![row] = dot(
        startEdges[row]!,
        startEdges[column]!,
        ambientDimension
      );
      byDegree[1][column]![row] = dot(
        deltaEdges[row]!,
        startEdges[column]!,
        ambientDimension
      ) + dot(
        startEdges[row]!,
        deltaEdges[column]!,
        ambientDimension
      );
      byDegree[2][column]![row] = dot(
        deltaEdges[row]!,
        deltaEdges[column]!,
        ambientDimension
      );
    }
  }
  return byDegree;
}

function quadraticMatrixDeterminantPolynomial(
  columnsByDegree: readonly [
    readonly Float64Array[],
    readonly Float64Array[],
    readonly Float64Array[]
  ],
  dimension: number
): Float64Array {
  const coefficients = new Float64Array(2 * dimension + 1);
  const selected = new Array<Float64Array>(dimension);
  const enumerate = (column: number, power: number): void => {
    if (column === dimension) {
      coefficients[power] = coefficients[power]! +
        determinantFromColumns(selected);
      if (!Number.isFinite(coefficients[power])) {
        throw new Error(
          'analyzeLinearSimplexMeasureN: Gram determinant coefficient is outside the Float64 range'
        );
      }
      return;
    }
    for (let degree = 0; degree <= 2; degree++) {
      selected[column] = columnsByDegree[degree]![column]!;
      enumerate(column + 1, power + degree);
    }
  };
  enumerate(0, 0);
  return coefficients;
}

function determinantFromColumns(columns: readonly Float64Array[]): number {
  const dimension = columns.length;
  const matrix = new MatN(dimension);
  for (let column = 0; column < dimension; column++) {
    for (let row = 0; row < dimension; row++) {
      matrix.set(row, column, columns[column]![row]!);
    }
  }
  return matrix.determinant();
}

function dot(a: Float64Array, b: Float64Array, dimension: number): number {
  let value = 0;
  for (let axis = 0; axis < dimension; axis++) {
    value += a[axis]! * b[axis]!;
  }
  if (!Number.isFinite(value)) {
    throw new Error(
      'analyzeLinearSimplexMeasureN: Gram coefficient is outside the Float64 range'
    );
  }
  return value;
}
