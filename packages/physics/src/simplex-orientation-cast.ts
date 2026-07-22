import { MatN, VecN } from '@holotope/core';

export interface AnalyzeLinearSimplexOrientationNOptions {
  /** Non-degenerate full-dimensional N-simplex defining positive material orientation. */
  readonly restPositions: readonly VecN[];
  /** Particle positions at normalized trajectory time zero. */
  readonly startPositions: readonly VecN[];
  /** Particle positions at normalized trajectory time one. */
  readonly endPositions: readonly VecN[];
  /** Required signed current/rest measure ratio. Zero detects collapse/inversion. */
  readonly minimumSignedMeasureRatio: number;
  /** Smallest unresolved normalized-time interval. Default 2^-30. */
  readonly timeTolerance?: number;
  /** Hard de Casteljau subdivision depth. Default 48. */
  readonly maximumDepth?: number;
  /** Relative Bernstein-coefficient tolerance. Default 256 * Number.EPSILON. */
  readonly relativeCoefficientTolerance?: number;
}

export interface LinearSimplexOrientationAnalysisBaseN {
  readonly dimension: number;
  readonly degree: number;
  readonly minimumSignedMeasureRatio: number;
  readonly startSignedMeasureRatio: number;
  readonly endSignedMeasureRatio: number;
  /** Coefficients of `signedRatio(t) - minimumSignedMeasureRatio` in powers of t. */
  readonly monomialCoefficients: Float64Array;
  /** The same threshold polynomial in the Bernstein basis on [0,1]. */
  readonly bernsteinCoefficients: Float64Array;
  readonly timeTolerance: number;
  readonly maximumDepth: number;
  readonly relativeCoefficientTolerance: number;
  readonly absoluteCoefficientTolerance: number;
}

export interface LinearSimplexOrientationSafeN
  extends LinearSimplexOrientationAnalysisBaseN {
  readonly status: 'safe';
  /** Conservative positive lower bound assembled from accepted Bernstein leaves. */
  readonly minimumMarginLowerBound: number;
}

export interface LinearSimplexOrientationInitialViolationN
  extends LinearSimplexOrientationAnalysisBaseN {
  readonly status: 'initial-violation';
  readonly initialMargin: number;
}

export interface LinearSimplexOrientationPossibleViolationN
  extends LinearSimplexOrientationAnalysisBaseN {
  readonly status: 'possible-violation';
  /** Earliest conservative normalized-time enclosure that could meet the threshold. */
  readonly timeBracket: readonly [number, number];
  readonly candidateTime: number;
  readonly marginAtBracketStart: number;
  readonly marginAtBracketEnd: number;
  readonly bernsteinBounds: readonly [number, number];
  readonly reason: 'negative-enclosure' | 'resolution-limit';
}

export type LinearSimplexOrientationAnalysisN =
  | LinearSimplexOrientationSafeN
  | LinearSimplexOrientationInitialViolationN
  | LinearSimplexOrientationPossibleViolationN;

interface CandidateInterval {
  readonly lowerTime: number;
  readonly upperTime: number;
  readonly minimumCoefficient: number;
  readonly maximumCoefficient: number;
  readonly reason: LinearSimplexOrientationPossibleViolationN['reason'];
}

interface SearchState {
  minimumSafeLowerBound: number;
}

/**
 * Conservatively checks a linear full-dimensional simplex trajectory.
 *
 * `det(A + tB)` is assembled exactly with respect to the chosen Float64
 * determinant routine by multilinearity over column subsets. Bernstein convex
 * hull bounds and left-to-right de Casteljau subdivision then exclude the
 * complete interval or return its earliest unresolved threshold enclosure.
 *
 * The reference coefficient construction costs O(2^N N^3). It is intended as
 * an auditable small-N golden path, not a high-dimensional performance backend.
 */
export function analyzeLinearSimplexOrientationN(
  options: AnalyzeLinearSimplexOrientationNOptions
): LinearSimplexOrientationAnalysisN {
  const dimension = validateOptions(options);
  const timeTolerance = options.timeTolerance ?? 2 ** -30;
  const maximumDepth = options.maximumDepth ?? 48;
  const relativeCoefficientTolerance = options.relativeCoefficientTolerance ??
    256 * Number.EPSILON;

  const restColumns = edgeColumns(options.restPositions);
  const startColumns = edgeColumns(options.startPositions);
  const endColumns = edgeColumns(options.endPositions);
  const deltaColumns = endColumns.map((column, index) => {
    const delta = new Float64Array(dimension);
    for (let row = 0; row < dimension; row++) {
      delta[row] = column[row]! - startColumns[index]![row]!;
    }
    return delta;
  });

  const restDeterminant = determinantFromColumns(restColumns);
  if (restDeterminant === 0) {
    throw new Error(
      'analyzeLinearSimplexOrientationN: rest simplex must be non-degenerate'
    );
  }
  if (!Number.isFinite(restDeterminant)) {
    throw new Error(
      'analyzeLinearSimplexOrientationN: rest determinant is outside the Float64 range'
    );
  }

  const determinantCoefficients = determinantPolynomial(
    startColumns,
    deltaColumns
  );
  const monomialCoefficients = new Float64Array(dimension + 1);
  for (let degree = 0; degree <= dimension; degree++) {
    monomialCoefficients[degree] = determinantCoefficients[degree]! /
      restDeterminant;
    if (!Number.isFinite(monomialCoefficients[degree])) {
      throw new Error(
        'analyzeLinearSimplexOrientationN: normalized determinant polynomial is outside the Float64 range'
      );
    }
  }
  monomialCoefficients[0] = monomialCoefficients[0]! -
    options.minimumSignedMeasureRatio;

  const bernsteinCoefficients = monomialToBernstein(monomialCoefficients);
  let coefficientScale = 1;
  for (const coefficient of bernsteinCoefficients) {
    coefficientScale = Math.max(coefficientScale, Math.abs(coefficient));
  }
  const absoluteCoefficientTolerance = relativeCoefficientTolerance *
    coefficientScale;
  const startSignedMeasureRatio = monomialCoefficients[0]! +
    options.minimumSignedMeasureRatio;
  const endSignedMeasureRatio = evaluatePolynomial(monomialCoefficients, 1) +
    options.minimumSignedMeasureRatio;
  const base: LinearSimplexOrientationAnalysisBaseN = {
    dimension,
    degree: dimension,
    minimumSignedMeasureRatio: options.minimumSignedMeasureRatio,
    startSignedMeasureRatio,
    endSignedMeasureRatio,
    monomialCoefficients,
    bernsteinCoefficients,
    timeTolerance,
    maximumDepth,
    relativeCoefficientTolerance,
    absoluteCoefficientTolerance
  };
  const initialMargin = monomialCoefficients[0]!;
  if (initialMargin <= absoluteCoefficientTolerance) {
    return Object.freeze({
      ...base,
      status: 'initial-violation',
      initialMargin
    });
  }

  const searchState: SearchState = {
    minimumSafeLowerBound: Number.POSITIVE_INFINITY
  };
  const candidate = findFirstPossibleViolation(
    bernsteinCoefficients,
    0,
    1,
    0,
    timeTolerance,
    maximumDepth,
    absoluteCoefficientTolerance,
    searchState
  );
  if (candidate === null) {
    return Object.freeze({
      ...base,
      status: 'safe',
      minimumMarginLowerBound: searchState.minimumSafeLowerBound
    });
  }

  const marginAtBracketStart = evaluatePolynomial(
    monomialCoefficients,
    candidate.lowerTime
  );
  const marginAtBracketEnd = evaluatePolynomial(
    monomialCoefficients,
    candidate.upperTime
  );
  return Object.freeze({
    ...base,
    status: 'possible-violation',
    timeBracket: Object.freeze([
      candidate.lowerTime,
      candidate.upperTime
    ]) as readonly [number, number],
    candidateTime: 0.5 * (candidate.lowerTime + candidate.upperTime),
    marginAtBracketStart,
    marginAtBracketEnd,
    bernsteinBounds: Object.freeze([
      candidate.minimumCoefficient,
      candidate.maximumCoefficient
    ]) as readonly [number, number],
    reason: candidate.reason
  });
}

function validateOptions(options: AnalyzeLinearSimplexOrientationNOptions): number {
  const caller = 'analyzeLinearSimplexOrientationN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  if (!Number.isFinite(options.minimumSignedMeasureRatio) ||
    options.minimumSignedMeasureRatio < 0) {
    throw new Error(
      `${caller}: minimumSignedMeasureRatio must be finite and non-negative`
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
    throw new Error(`${caller}: restPositions must contain an N-simplex`);
  }
  const dimension = options.restPositions.length - 1;
  validatePositions(options.restPositions, dimension, `${caller}: restPositions`);
  validatePositions(options.startPositions, dimension, `${caller}: startPositions`);
  validatePositions(options.endPositions, dimension, `${caller}: endPositions`);
  return dimension;
}

function validatePositions(
  positions: readonly VecN[],
  dimension: number,
  label: string
): void {
  if (!Array.isArray(positions) || positions.length !== dimension + 1) {
    throw new Error(`${label} must contain exactly ${dimension + 1} points`);
  }
  for (let index = 0; index < positions.length; index++) {
    const point = positions[index];
    if (!(point instanceof VecN)) {
      throw new Error(`${label}[${index}] must be a VecN`);
    }
    if (point.dim !== dimension) {
      throw new Error(
        `${label}[${index}] is R${point.dim}, expected a full-dimensional R${dimension} simplex`
      );
    }
    for (const coordinate of point.data) {
      if (!Number.isFinite(coordinate)) {
        throw new Error(`${label}[${index}] must contain finite coordinates`);
      }
    }
  }
}

function edgeColumns(positions: readonly VecN[]): Float64Array[] {
  const dimension = positions.length - 1;
  const origin = positions[0]!;
  return Array.from({ length: dimension }, (_, column) => {
    const edge = new Float64Array(dimension);
    const endpoint = positions[column + 1]!;
    for (let row = 0; row < dimension; row++) {
      edge[row] = endpoint.data[row]! - origin.data[row]!;
    }
    return edge;
  });
}

function determinantPolynomial(
  startColumns: readonly Float64Array[],
  deltaColumns: readonly Float64Array[]
): Float64Array {
  const dimension = startColumns.length;
  const coefficients = new Float64Array(dimension + 1);
  const selected = new Array<Float64Array>(dimension);
  const enumerate = (column: number, movingColumns: number): void => {
    if (column === dimension) {
      coefficients[movingColumns] = coefficients[movingColumns]! +
        determinantFromColumns(selected);
      if (!Number.isFinite(coefficients[movingColumns])) {
        throw new Error(
          'analyzeLinearSimplexOrientationN: determinant coefficient is outside the Float64 range'
        );
      }
      return;
    }
    selected[column] = startColumns[column]!;
    enumerate(column + 1, movingColumns);
    selected[column] = deltaColumns[column]!;
    enumerate(column + 1, movingColumns + 1);
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

function monomialToBernstein(monomial: Float64Array): Float64Array {
  const degree = monomial.length - 1;
  const bernstein = new Float64Array(degree + 1);
  for (let index = 0; index <= degree; index++) {
    let coefficient = 0;
    for (let power = 0; power <= index; power++) {
      coefficient += monomial[power]! *
        binomial(index, power) / binomial(degree, power);
    }
    bernstein[index] = coefficient;
  }
  return bernstein;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const reduced = Math.min(k, n - k);
  let value = 1;
  for (let index = 1; index <= reduced; index++) {
    value = value * (n - reduced + index) / index;
  }
  return value;
}

function findFirstPossibleViolation(
  coefficients: Float64Array,
  lowerTime: number,
  upperTime: number,
  depth: number,
  timeTolerance: number,
  maximumDepth: number,
  coefficientTolerance: number,
  state: SearchState
): CandidateInterval | null {
  let minimumCoefficient = Number.POSITIVE_INFINITY;
  let maximumCoefficient = Number.NEGATIVE_INFINITY;
  for (const coefficient of coefficients) {
    minimumCoefficient = Math.min(minimumCoefficient, coefficient);
    maximumCoefficient = Math.max(maximumCoefficient, coefficient);
  }
  if (minimumCoefficient > coefficientTolerance) {
    state.minimumSafeLowerBound = Math.min(
      state.minimumSafeLowerBound,
      minimumCoefficient
    );
    return null;
  }
  if (maximumCoefficient < -coefficientTolerance) {
    return {
      lowerTime,
      upperTime,
      minimumCoefficient,
      maximumCoefficient,
      reason: 'negative-enclosure'
    };
  }
  if (upperTime - lowerTime <= timeTolerance || depth >= maximumDepth) {
    return {
      lowerTime,
      upperTime,
      minimumCoefficient,
      maximumCoefficient,
      reason: 'resolution-limit'
    };
  }
  const [left, right] = splitBernsteinHalf(coefficients);
  const middle = 0.5 * (lowerTime + upperTime);
  return findFirstPossibleViolation(
    left,
    lowerTime,
    middle,
    depth + 1,
    timeTolerance,
    maximumDepth,
    coefficientTolerance,
    state
  ) ?? findFirstPossibleViolation(
    right,
    middle,
    upperTime,
    depth + 1,
    timeTolerance,
    maximumDepth,
    coefficientTolerance,
    state
  );
}

function splitBernsteinHalf(
  coefficients: Float64Array
): readonly [Float64Array, Float64Array] {
  const degree = coefficients.length - 1;
  const levels: Float64Array[] = [coefficients.slice()];
  for (let level = 1; level <= degree; level++) {
    const previous = levels[level - 1]!;
    const next = new Float64Array(previous.length - 1);
    for (let index = 0; index < next.length; index++) {
      next[index] = 0.5 * (previous[index]! + previous[index + 1]!);
    }
    levels.push(next);
  }
  const left = new Float64Array(degree + 1);
  const right = new Float64Array(degree + 1);
  for (let index = 0; index <= degree; index++) {
    left[index] = levels[index]![0]!;
    right[degree - index] = levels[index]![levels[index]!.length - 1]!;
  }
  return [left, right];
}

function evaluatePolynomial(coefficients: Float64Array, time: number): number {
  let value = 0;
  for (let degree = coefficients.length - 1; degree >= 0; degree--) {
    value = value * time + coefficients[degree]!;
  }
  return value;
}
