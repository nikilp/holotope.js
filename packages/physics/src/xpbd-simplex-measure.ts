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

/** Float64 value and point gradients of one signed full-dimensional simplex. */
export interface OrientedSimplexMeasureEvaluationN {
  readonly ambientDimension: number;
  /** Always equal to `ambientDimension`. */
  readonly simplexDimension: number;
  /** `det([x1 - x0, ..., xN - x0])` before division by `N!`. */
  readonly determinant: number;
  /** Signed N-measure in the ambient basis. */
  readonly orientedMeasure: number;
  /** Absolute N-measure. */
  readonly measure: number;
  /** Literal sign of the computed Float64 determinant. */
  readonly orientation: -1 | 0 | 1;
  /** Gradients of `orientedMeasure` in point order. */
  readonly gradients: readonly VecN[];
}

export interface XpbdOrientedSimplexMeasureConstraintNOptions {
  readonly id: string;
  readonly points: readonly XpbdPointN[];
  readonly restOrientedMeasure: number;
  /** Inverse stiffness for the oriented-measure coordinate. Default zero. */
  readonly compliance?: number;
}

export interface XpbdOrientedSimplexMeasureConstraintEvaluationN
  extends XpbdScalarConstraintEvaluationN,
    OrientedSimplexMeasureEvaluationN {
  readonly restOrientedMeasure: number;
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

  // The Gram determinant is evaluated by Cauchy–Binet rather than by forming
  // `EᵀE` and expanding it.
  //
  // WHY. For a triangle the Gram route computes
  // `|e₁|²|e₂|² − (e₁·e₂)² = |e₁|²|e₂|² sin²θ`, a difference of two nearly
  // equal positive quantities as the simplex flattens. Its relative rounding
  // error is `ε/sin²θ`, and since a simplex's conditioning scales as `1/sinθ`,
  // that is `ε·κ²` — forming the normal matrix squares the condition number.
  // Measured against exact rational geometry, the Gram route loses all
  // significance (relative error 1.0) at `κ ≈ 2e8` on exactly representable
  // integer inputs, and its error slope against the exact condition number is
  // 2.103.
  //
  // Cauchy–Binet writes the same quantity as `det(EᵀE) = Σ_S det(E_S)²` over
  // the k-subsets `S` of ambient axes: a SUM OF SQUARES, with no cancellation
  // in the outer sum and no normal matrix formed. Its error is `ε·κ`, and on
  // the four sliver families that motivated this it is exact or within one
  // rounding step where the Gram route reaches 5.8e-3.
  //
  // The singular contract is preserved STRUCTURALLY rather than by clamping:
  // every minor of a rank-deficient edge matrix is identically zero, so the
  // sum and its derivative are exactly zero without a tolerance anywhere.
  //
  // COST. This visits `C(ambientDimension, simplexDimension)` minors, so it is
  // combinatorial in the ambient dimension where the Gram route was linear.
  // Over the range this library exercises it is small — at most 35 minors for
  // a 4-simplex in R7, and exactly one when the simplex is full-dimensional —
  // and for triangles and tetrahedra in R2–R4 it is cheaper than the route it
  // replaces. It is not free at large ambient dimension, and that is the
  // trade this comment exists to name.
  const axisSubsets = chooseAxisSubsets(ambientDimension, simplexDimension);
  const subsetMinors = new Array<number>(axisSubsets.length);
  const subsetMatrix = squareMatrix(simplexDimension);
  let gramDeterminantSum = 0;
  for (let subset = 0; subset < axisSubsets.length; subset++) {
    const axes = axisSubsets[subset]!;
    for (let row = 0; row < simplexDimension; row++) {
      for (let column = 0; column < simplexDimension; column++) {
        const value = edgeColumns[column]![axes[row]!]!;
        if (!Number.isFinite(value)) {
          throw new Error(
            'evaluateSimplexSquaredMeasureN: edge matrix contains a non-finite value'
          );
        }
        subsetMatrix[row]![column] = value;
      }
    }
    const value = determinant(subsetMatrix);
    if (!Number.isFinite(value)) {
      throw new Error(
        'evaluateSimplexSquaredMeasureN: Gram minor is non-finite'
      );
    }
    subsetMinors[subset] = value;
    gramDeterminantSum += value * value;
  }

  // A sum of squares is non-negative by construction, so the clamp and the
  // numerically-negative refusal the Gram route needed have no counterpart
  // here. The refusal is retained as an internal invariant rather than a
  // reachable error path: if it ever fires, the arithmetic is broken.
  let gramDeterminant = gramDeterminantSum;
  if (!Number.isFinite(gramDeterminant)) {
    throw new Error('evaluateSimplexSquaredMeasureN: Gram determinant is non-finite');
  }
  if (gramDeterminant < 0) {
    throw new Error(
      'evaluateSimplexSquaredMeasureN: Gram determinant is numerically negative'
    );
  }

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
  // Differentiating the same sum of squares, entrywise:
  //
  //   ∂ det(EᵀE) / ∂E[r][c] = Σ_{S ∋ r} 2 · det(E_S) · cof_{pos(r,S), c}(E_S)
  //
  // where `cof` is the signed cofactor of that entry inside the k×k minor and
  // the sum runs only over subsets containing the ambient axis `r`. Every term
  // carries a factor of `det(E_S)`, so at exact rank loss — where every minor
  // vanishes — the gradient is exactly zero componentwise, with no clamp. That
  // is the finite, possibly-zero squared-measure gradient the constraint path
  // depends on, preserved by construction.
  //
  // An ambient axis outside every subset that carries a non-zero minor
  // contributes nothing, so gradient components on padded axes of an embedded
  // simplex are exactly `+0`.
  const edgeGradient = Array.from(
    { length: simplexDimension },
    () => new Float64Array(ambientDimension)
  );
  for (let subset = 0; subset < axisSubsets.length; subset++) {
    const minorValue = subsetMinors[subset]!;
    if (minorValue === 0) continue;
    const axes = axisSubsets[subset]!;
    for (let row = 0; row < simplexDimension; row++) {
      for (let column = 0; column < simplexDimension; column++) {
        subsetMatrix[row]![column] = edgeColumns[column]![axes[row]!]!;
      }
    }
    const twiceMinor = 2 * minorValue;
    for (let row = 0; row < simplexDimension; row++) {
      for (let column = 0; column < simplexDimension; column++) {
        const sign = (row + column) % 2 === 0 ? 1 : -1;
        const cofactor = sign * determinant(minor(subsetMatrix, row, column));
        const target = edgeGradient[column]!;
        const axis = axes[row]!;
        target[axis] = target[axis]! + twiceMinor * cofactor;
      }
    }
  }

  const gradients = new Array<VecN>(positions.length);
  const originGradient = new VecN(ambientDimension);
  for (let point = 1; point < positions.length; point++) {
    const edgeIndex = point - 1;
    const gradient = new VecN(ambientDimension);
    for (let coordinate = 0; coordinate < ambientDimension; coordinate++) {
      gradient.data[coordinate] =
        edgeGradient[edgeIndex]![coordinate]! * normalization;
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

/**
 * Evaluates `det([x1 - x0, ..., xN - x0]) / N!` and its point gradients.
 *
 * The simplex must be full-dimensional in its ambient space. An embedded
 * lower-dimensional simplex has no ambient-rotation-invariant scalar
 * orientation without an additional authored normal-frame convention.
 */
export function evaluateOrientedSimplexMeasureN(
  positions: readonly VecN[]
): OrientedSimplexMeasureEvaluationN {
  if (positions.length === 0) {
    throw new Error('evaluateOrientedSimplexMeasureN: expected at least two points');
  }
  const ambientDimension = assertPosition(
    positions[0],
    undefined,
    'evaluateOrientedSimplexMeasureN: point 0'
  );
  if (ambientDimension < 1 || positions.length !== ambientDimension + 1) {
    throw new Error(
      'evaluateOrientedSimplexMeasureN: expected exactly ambient dimension + 1 points'
    );
  }
  for (let point = 1; point < positions.length; point++) {
    assertPosition(
      positions[point],
      ambientDimension,
      `evaluateOrientedSimplexMeasureN: point ${point}`
    );
  }

  const origin = positions[0]!;
  const edges = squareMatrix(ambientDimension);
  for (let column = 0; column < ambientDimension; column++) {
    const endpoint = positions[column + 1]!;
    for (let coordinate = 0; coordinate < ambientDimension; coordinate++) {
      edges[coordinate]![column] = endpoint.data[coordinate]! -
        origin.data[coordinate]!;
    }
  }

  const cofactors = squareMatrix(ambientDimension);
  for (let row = 0; row < ambientDimension; row++) {
    for (let column = 0; column < ambientDimension; column++) {
      const sign = (row + column) % 2 === 0 ? 1 : -1;
      const cofactor = sign * determinant(minor(edges, row, column));
      if (!Number.isFinite(cofactor)) {
        throw new Error(
          'evaluateOrientedSimplexMeasureN: cofactor is non-finite'
        );
      }
      cofactors[row]![column] = cofactor;
    }
  }

  const determinantValue = determinant(edges);
  if (!Number.isFinite(determinantValue)) {
    throw new Error('evaluateOrientedSimplexMeasureN: determinant is non-finite');
  }
  const simplexFactorial = factorial(ambientDimension);
  if (!Number.isFinite(simplexFactorial)) {
    throw new Error(
      'evaluateOrientedSimplexMeasureN: ambient dimension exceeds the Float64 factorial range'
    );
  }
  const normalization = 1 / simplexFactorial;
  if (!(normalization > 0) || !Number.isFinite(normalization)) {
    throw new Error(
      'evaluateOrientedSimplexMeasureN: normalization is outside the Float64 range'
    );
  }

  const gradients = new Array<VecN>(positions.length);
  const originGradient = new VecN(ambientDimension);
  for (let point = 1; point < positions.length; point++) {
    const column = point - 1;
    const gradient = new VecN(ambientDimension);
    for (let coordinate = 0; coordinate < ambientDimension; coordinate++) {
      const derivative = cofactors[coordinate]![column]! * normalization;
      if (!Number.isFinite(derivative)) {
        throw new Error(
          'evaluateOrientedSimplexMeasureN: gradient contains a non-finite value'
        );
      }
      gradient.data[coordinate] = derivative;
      originGradient.data[coordinate] = originGradient.data[coordinate]! - derivative;
    }
    gradients[point] = gradient;
  }
  gradients[0] = originGradient;

  const orientedMeasure = determinantValue * normalization;
  if (!Number.isFinite(orientedMeasure)) {
    throw new Error(
      'evaluateOrientedSimplexMeasureN: oriented measure is non-finite'
    );
  }
  const orientation = determinantValue > 0 ? 1 : determinantValue < 0 ? -1 : 0;
  return Object.freeze({
    ambientDimension,
    simplexDimension: ambientDimension,
    determinant: determinantValue,
    orientedMeasure,
    measure: Math.abs(orientedMeasure),
    orientation,
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

/** Signed full-dimensional simplex-measure equality consumed by XPBD. */
export class XpbdOrientedSimplexMeasureConstraintN
implements XpbdScalarConstraintN {
  readonly id: string;
  readonly dimension: number;
  readonly simplexDimension: number;
  readonly points: readonly XpbdPointN[];
  readonly restOrientedMeasure: number;
  readonly compliance: number;

  constructor(options: XpbdOrientedSimplexMeasureConstraintNOptions) {
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(
        'XpbdOrientedSimplexMeasureConstraintN: id must be a non-empty string'
      );
    }
    if (new Set(options.points).size !== options.points.length) {
      throw new Error(
        'XpbdOrientedSimplexMeasureConstraintN: point identities must be distinct'
      );
    }
    for (let index = 0; index < options.points.length; index++) {
      assertXpbdPoint(
        options.points[index],
        `point ${index}`,
        'XpbdOrientedSimplexMeasureConstraintN'
      );
    }
    const evaluated = evaluateOrientedSimplexMeasureN(
      options.points.map((point) => point.position)
    );
    if (!Number.isFinite(options.restOrientedMeasure)) {
      throw new Error(
        'XpbdOrientedSimplexMeasureConstraintN: restOrientedMeasure must be finite'
      );
    }
    const compliance = options.compliance ?? 0;
    if (!Number.isFinite(compliance) || compliance < 0) {
      throw new Error(
        'XpbdOrientedSimplexMeasureConstraintN: compliance must be finite and non-negative'
      );
    }

    this.id = options.id;
    this.dimension = evaluated.ambientDimension;
    this.simplexDimension = evaluated.simplexDimension;
    this.points = Object.freeze([...options.points]);
    this.restOrientedMeasure = options.restOrientedMeasure;
    this.compliance = compliance;
  }

  evaluate(): XpbdOrientedSimplexMeasureConstraintEvaluationN {
    const evaluated = evaluateOrientedSimplexMeasureN(
      this.points.map((point) => point.position)
    );
    const error = evaluated.orientedMeasure - this.restOrientedMeasure;
    return Object.freeze({
      ...evaluated,
      restOrientedMeasure: this.restOrientedMeasure,
      restMeasure: Math.abs(this.restOrientedMeasure),
      error,
      value: error
    });
  }
}

function assertXpbdPoint(
  point: XpbdPointN | undefined,
  label: string,
  owner = 'XpbdSimplexSquaredMeasureConstraintN'
): void {
  if (point === undefined || !(point.position instanceof VecN)) {
    throw new Error(`${owner}: ${label} is invalid`);
  }
  if (!Number.isFinite(point.inverseMass) || point.inverseMass < 0) {
    throw new Error(
      `${owner}: ${label} inverseMass must be finite and non-negative`
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

/**
 * Lexicographic k-subsets of the ambient axes, the index set Cauchy–Binet sums
 * over. Deterministic and order-independent of the caller: the enumeration is
 * a pure function of `(ambientDimension, simplexDimension)`, so a permutation
 * of the simplex's vertices cannot reorder it.
 */
function chooseAxisSubsets(ambientDimension: number, size: number): number[][] {
  const subsets: number[][] = [];
  const current = new Array<number>(size).fill(0);
  const walk = (position: number, start: number): void => {
    if (position === size) {
      subsets.push([...current]);
      return;
    }
    for (let axis = start; axis <= ambientDimension - (size - position); axis++) {
      current[position] = axis;
      walk(position + 1, axis + 1);
    }
  };
  if (size > 0 && size <= ambientDimension) walk(0, 0);
  return subsets;
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
