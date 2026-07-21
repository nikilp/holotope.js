import { VecN } from '@holotope/core';
import type {
  XpbdPointN,
  XpbdScalarConstraintEvaluationN,
  XpbdScalarConstraintN
} from './xpbd-constraint.js';

/** Float64 value and point gradients of one unsigned simplex coordinate. */
export interface SimplexSquaredMeasureEvaluationN {
  readonly ambientDimension: number;
  readonly simplexDimension: number;
  /** `det(E^T E)` before division by `(k!)^2`. */
  readonly gramDeterminant: number;
  /** Squared intrinsic k-measure of the simplex. */
  readonly squaredMeasure: number;
  /** Intrinsic k-measure of the simplex. */
  readonly measure: number;
  /** Gradients of `squaredMeasure` in point order. */
  readonly gradients: readonly VecN[];
}

export interface XpbdSimplexSquaredMeasureConstraintNOptions {
  readonly id: string;
  readonly points: readonly XpbdPointN[];
  readonly restSquaredMeasure: number;
  /** Inverse stiffness for the squared-measure coordinate. Default zero. */
  readonly compliance?: number;
}

export interface XpbdSimplexSquaredMeasureConstraintEvaluationN
  extends XpbdScalarConstraintEvaluationN,
    SimplexSquaredMeasureEvaluationN {
  readonly restSquaredMeasure: number;
  readonly restMeasure: number;
  readonly error: number;
}

/**
 * Evaluates `det(E^T E) / (k!)^2` and its ambient point gradients.
 *
 * The cofactor form remains finite for singular Gram matrices. At a fully
 * collapsed or rank-deficient simplex the first derivative may be zero; no
 * recovery direction is fabricated.
 */
export function evaluateSimplexSquaredMeasureN(
  positions: readonly VecN[]
): SimplexSquaredMeasureEvaluationN {
  if (positions.length < 2) {
    throw new Error('evaluateSimplexSquaredMeasureN: expected at least two points');
  }
  const ambientDimension = assertPosition(
    positions[0],
    undefined,
    'evaluateSimplexSquaredMeasureN: point 0'
  );
  const simplexDimension = positions.length - 1;
  if (simplexDimension > ambientDimension) {
    throw new Error(
      'evaluateSimplexSquaredMeasureN: simplex dimension exceeds ambient dimension'
    );
  }
  for (let point = 1; point < positions.length; point++) {
    assertPosition(
      positions[point],
      ambientDimension,
      `evaluateSimplexSquaredMeasureN: point ${point}`
    );
  }

  const edgeColumns = new Array<Float64Array>(simplexDimension);
  const origin = positions[0]!;
  for (let column = 0; column < simplexDimension; column++) {
    const edge = new Float64Array(ambientDimension);
    const endpoint = positions[column + 1]!;
    for (let coordinate = 0; coordinate < ambientDimension; coordinate++) {
      edge[coordinate] = endpoint.data[coordinate]! - origin.data[coordinate]!;
    }
    edgeColumns[column] = edge;
  }

  const gram = squareMatrix(simplexDimension);
  for (let row = 0; row < simplexDimension; row++) {
    for (let column = row; column < simplexDimension; column++) {
      let dot = 0;
      for (let coordinate = 0; coordinate < ambientDimension; coordinate++) {
        dot += edgeColumns[row]![coordinate]! * edgeColumns[column]![coordinate]!;
      }
      if (!Number.isFinite(dot)) {
        throw new Error(
          'evaluateSimplexSquaredMeasureN: Gram matrix contains a non-finite value'
        );
      }
      gram[row]![column] = dot;
      gram[column]![row] = dot;
    }
  }

  const cofactors = squareMatrix(simplexDimension);
  for (let row = 0; row < simplexDimension; row++) {
    for (let column = 0; column < simplexDimension; column++) {
      const sign = (row + column) % 2 === 0 ? 1 : -1;
      cofactors[row]![column] = sign * determinant(minor(gram, row, column));
      if (!Number.isFinite(cofactors[row]![column])) {
        throw new Error(
          'evaluateSimplexSquaredMeasureN: Gram cofactor is non-finite'
        );
      }
    }
  }
  let gramDeterminant = 0;
  for (let column = 0; column < simplexDimension; column++) {
    gramDeterminant += gram[0]![column]! * cofactors[0]![column]!;
  }
  if (!Number.isFinite(gramDeterminant)) {
    throw new Error('evaluateSimplexSquaredMeasureN: Gram determinant is non-finite');
  }

  const determinantScale = hadamardScale(gram);
  if (!Number.isFinite(determinantScale)) {
    throw new Error('evaluateSimplexSquaredMeasureN: Gram scale is non-finite');
  }
  const negativeTolerance = 128 * Number.EPSILON * Math.max(1, determinantScale);
  if (gramDeterminant < -negativeTolerance) {
    throw new Error(
      'evaluateSimplexSquaredMeasureN: Gram determinant is numerically negative'
    );
  }
  if (gramDeterminant < 0) gramDeterminant = 0;

  const simplexFactorial = factorial(simplexDimension);
  if (!Number.isFinite(simplexFactorial)) {
    throw new Error(
      'evaluateSimplexSquaredMeasureN: simplex dimension exceeds the Float64 factorial range'
    );
  }
  const normalization = 1 / (simplexFactorial * simplexFactorial);
  if (!(normalization > 0) || !Number.isFinite(normalization)) {
    throw new Error(
      'evaluateSimplexSquaredMeasureN: simplex normalization is outside the Float64 range'
    );
  }
  const gradients = new Array<VecN>(positions.length);
  const originGradient = new VecN(ambientDimension);
  for (let point = 1; point < positions.length; point++) {
    const edgeIndex = point - 1;
    const gradient = new VecN(ambientDimension);
    for (let coordinate = 0; coordinate < ambientDimension; coordinate++) {
      let derivative = 0;
      for (let column = 0; column < simplexDimension; column++) {
        derivative += edgeColumns[column]![coordinate]! * (
          cofactors[edgeIndex]![column]! + cofactors[column]![edgeIndex]!
        );
      }
      gradient.data[coordinate] = derivative * normalization;
      if (!Number.isFinite(gradient.data[coordinate]!)) {
        throw new Error(
          'evaluateSimplexSquaredMeasureN: gradient contains a non-finite value'
        );
      }
      originGradient.data[coordinate] = originGradient.data[coordinate]! -
        gradient.data[coordinate]!;
    }
    gradients[point] = gradient;
  }
  gradients[0] = originGradient;

  const squaredMeasure = gramDeterminant * normalization;
  if (!Number.isFinite(squaredMeasure)) {
    throw new Error('evaluateSimplexSquaredMeasureN: squared measure is non-finite');
  }
  return Object.freeze({
    ambientDimension,
    simplexDimension,
    gramDeterminant,
    squaredMeasure,
    measure: Math.sqrt(squaredMeasure),
    gradients: Object.freeze(gradients)
  });
}

/** Unsigned simplex squared-measure equality consumed by the XPBD kernel. */
export class XpbdSimplexSquaredMeasureConstraintN
implements XpbdScalarConstraintN {
  readonly id: string;
  readonly dimension: number;
  readonly simplexDimension: number;
  readonly points: readonly XpbdPointN[];
  readonly restSquaredMeasure: number;
  readonly compliance: number;

  constructor(options: XpbdSimplexSquaredMeasureConstraintNOptions) {
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(
        'XpbdSimplexSquaredMeasureConstraintN: id must be a non-empty string'
      );
    }
    if (options.points.length < 2) {
      throw new Error(
        'XpbdSimplexSquaredMeasureConstraintN: expected at least two points'
      );
    }
    if (new Set(options.points).size !== options.points.length) {
      throw new Error(
        'XpbdSimplexSquaredMeasureConstraintN: point identities must be distinct'
      );
    }
    for (let index = 0; index < options.points.length; index++) {
      assertXpbdPoint(options.points[index], `point ${index}`);
    }
    const evaluated = evaluateSimplexSquaredMeasureN(
      options.points.map((point) => point.position)
    );
    if (
      !Number.isFinite(options.restSquaredMeasure) ||
      options.restSquaredMeasure < 0
    ) {
      throw new Error(
        'XpbdSimplexSquaredMeasureConstraintN: restSquaredMeasure must be finite and non-negative'
      );
    }
    const compliance = options.compliance ?? 0;
    if (!Number.isFinite(compliance) || compliance < 0) {
      throw new Error(
        'XpbdSimplexSquaredMeasureConstraintN: compliance must be finite and non-negative'
      );
    }

    this.id = options.id;
    this.dimension = evaluated.ambientDimension;
    this.simplexDimension = evaluated.simplexDimension;
    this.points = Object.freeze([...options.points]);
    this.restSquaredMeasure = options.restSquaredMeasure;
    this.compliance = compliance;
  }

  evaluate(): XpbdSimplexSquaredMeasureConstraintEvaluationN {
    const evaluated = evaluateSimplexSquaredMeasureN(
      this.points.map((point) => point.position)
    );
    const error = evaluated.squaredMeasure - this.restSquaredMeasure;
    return Object.freeze({
      ...evaluated,
      restSquaredMeasure: this.restSquaredMeasure,
      restMeasure: Math.sqrt(this.restSquaredMeasure),
      error,
      value: error
    });
  }
}

function assertXpbdPoint(point: XpbdPointN | undefined, label: string): void {
  if (point === undefined || !(point.position instanceof VecN)) {
    throw new Error(`XpbdSimplexSquaredMeasureConstraintN: ${label} is invalid`);
  }
  if (!Number.isFinite(point.inverseMass) || point.inverseMass < 0) {
    throw new Error(
      `XpbdSimplexSquaredMeasureConstraintN: ${label} inverseMass must be finite and non-negative`
    );
  }
}

function assertPosition(
  position: VecN | undefined,
  expectedDimension: number | undefined,
  label: string
): number {
  if (!(position instanceof VecN)) {
    throw new Error(`${label} must be a VecN`);
  }
  if (expectedDimension !== undefined && position.dim !== expectedDimension) {
    throw new Error(`${label} dimension mismatch`);
  }
  for (const coordinate of position.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${label} must contain finite coordinates`);
    }
  }
  return position.dim;
}

function squareMatrix(size: number): number[][] {
  return Array.from({ length: size }, () => new Array<number>(size).fill(0));
}

function minor(
  matrix: readonly (readonly number[])[],
  omittedRow: number,
  omittedColumn: number
): number[][] {
  const result: number[][] = [];
  for (let row = 0; row < matrix.length; row++) {
    if (row === omittedRow) continue;
    const values: number[] = [];
    for (let column = 0; column < matrix.length; column++) {
      if (column !== omittedColumn) values.push(matrix[row]![column]!);
    }
    result.push(values);
  }
  return result;
}

function determinant(source: readonly (readonly number[])[]): number {
  const size = source.length;
  if (size === 0) return 1;
  const matrix = source.map((row) => Float64Array.from(row));
  let sign = 1;
  let value = 1;
  for (let column = 0; column < size; column++) {
    let pivot = column;
    let pivotMagnitude = Math.abs(matrix[pivot]![column]!);
    for (let row = column + 1; row < size; row++) {
      const magnitude = Math.abs(matrix[row]![column]!);
      if (magnitude > pivotMagnitude) {
        pivot = row;
        pivotMagnitude = magnitude;
      }
    }
    if (pivotMagnitude === 0) return 0;
    if (pivot !== column) {
      const swap = matrix[column]!;
      matrix[column] = matrix[pivot]!;
      matrix[pivot] = swap;
      sign = -sign;
    }
    const diagonal = matrix[column]![column]!;
    value *= diagonal;
    for (let row = column + 1; row < size; row++) {
      const factor = matrix[row]![column]! / diagonal;
      for (let trailing = column + 1; trailing < size; trailing++) {
        matrix[row]![trailing] = matrix[row]![trailing]! -
          factor * matrix[column]![trailing]!;
      }
    }
  }
  return value * sign;
}

function hadamardScale(matrix: readonly (readonly number[])[]): number {
  let scale = 1;
  for (const row of matrix) scale *= Math.hypot(...row);
  return scale;
}

function factorial(value: number): number {
  let result = 1;
  for (let factor = 2; factor <= value; factor++) result *= factor;
  return result;
}
