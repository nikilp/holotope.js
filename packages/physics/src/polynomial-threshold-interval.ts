export interface AnalyzePolynomialThresholdIntervalOptions {
  /** Smallest unresolved normalized-time interval. Default 2^-30. */
  readonly timeTolerance?: number;
  /** Hard de Casteljau subdivision depth. Default 48. */
  readonly maximumDepth?: number;
  /** Relative Bernstein-coefficient tolerance. Default 256 * Number.EPSILON. */
  readonly relativeCoefficientTolerance?: number;
}

export type PolynomialThresholdPossibleViolationReason =
  | 'negative-enclosure'
  | 'resolution-limit';

export interface PolynomialThresholdIntervalBase {
  readonly bernsteinCoefficients: Float64Array;
  readonly timeTolerance: number;
  readonly maximumDepth: number;
  readonly relativeCoefficientTolerance: number;
  readonly absoluteCoefficientTolerance: number;
}

export interface PolynomialThresholdIntervalSafe
  extends PolynomialThresholdIntervalBase {
  readonly status: 'safe';
  readonly minimumMarginLowerBound: number;
}

export interface PolynomialThresholdIntervalInitialViolation
  extends PolynomialThresholdIntervalBase {
  readonly status: 'initial-violation';
  readonly initialMargin: number;
}

export interface PolynomialThresholdIntervalPossibleViolation
  extends PolynomialThresholdIntervalBase {
  readonly status: 'possible-violation';
  readonly timeBracket: readonly [number, number];
  readonly candidateTime: number;
  readonly marginAtBracketStart: number;
  readonly marginAtBracketEnd: number;
  readonly bernsteinBounds: readonly [number, number];
  readonly reason: PolynomialThresholdPossibleViolationReason;
}

export type PolynomialThresholdIntervalAnalysis =
  | PolynomialThresholdIntervalSafe
  | PolynomialThresholdIntervalInitialViolation
  | PolynomialThresholdIntervalPossibleViolation;

interface CandidateInterval {
  readonly lowerTime: number;
  readonly upperTime: number;
  readonly minimumCoefficient: number;
  readonly maximumCoefficient: number;
  readonly reason: PolynomialThresholdPossibleViolationReason;
}

interface SearchState {
  minimumSafeLowerBound: number;
}

/** Internal Float64 Bernstein classifier for a threshold-shifted polynomial. */
export function analyzePolynomialThresholdInterval(
  monomialCoefficients: Float64Array,
  options: AnalyzePolynomialThresholdIntervalOptions = {}
): PolynomialThresholdIntervalAnalysis {
  validateInputs(monomialCoefficients, options);
  const timeTolerance = options.timeTolerance ?? 2 ** -30;
  const maximumDepth = options.maximumDepth ?? 48;
  const relativeCoefficientTolerance = options.relativeCoefficientTolerance ??
    256 * Number.EPSILON;
  const bernsteinCoefficients = monomialToBernstein(monomialCoefficients);
  let coefficientScale = 1;
  for (const coefficient of bernsteinCoefficients) {
    coefficientScale = Math.max(coefficientScale, Math.abs(coefficient));
  }
  const absoluteCoefficientTolerance = relativeCoefficientTolerance *
    coefficientScale;
  const base: PolynomialThresholdIntervalBase = {
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

  return Object.freeze({
    ...base,
    status: 'possible-violation',
    timeBracket: Object.freeze([
      candidate.lowerTime,
      candidate.upperTime
    ]) as readonly [number, number],
    candidateTime: 0.5 * (candidate.lowerTime + candidate.upperTime),
    marginAtBracketStart: evaluatePolynomial(
      monomialCoefficients,
      candidate.lowerTime
    ),
    marginAtBracketEnd: evaluatePolynomial(
      monomialCoefficients,
      candidate.upperTime
    ),
    bernsteinBounds: Object.freeze([
      candidate.minimumCoefficient,
      candidate.maximumCoefficient
    ]) as readonly [number, number],
    reason: candidate.reason
  });
}

function validateInputs(
  coefficients: Float64Array,
  options: AnalyzePolynomialThresholdIntervalOptions
): void {
  const caller = 'analyzePolynomialThresholdInterval';
  if (!(coefficients instanceof Float64Array) || coefficients.length === 0) {
    throw new Error(`${caller}: coefficients must be a non-empty Float64Array`);
  }
  for (const coefficient of coefficients) {
    if (!Number.isFinite(coefficient)) {
      throw new Error(`${caller}: coefficients must be finite`);
    }
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
