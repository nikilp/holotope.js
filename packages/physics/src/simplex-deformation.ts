import {
  MatN,
  VecN,
  symmetricEigenDecomposition
} from '@holotope/core';
import {
  evaluateOrientedSimplexMeasureN,
  evaluateSimplexSquaredMeasureN
} from './xpbd-simplex-measure.js';

export type SimplexOrientationChangeN =
  | { readonly kind: 'embedded' }
  | {
      readonly kind: 'full-dimensional';
      readonly signedMeasureRatio: number;
      readonly state: 'preserved' | 'inverted' | 'collapsed';
    };

/** Intrinsic affine deformation of one k-simplex embedded in RN. */
export interface SimplexMetricDeformationN {
  readonly ambientDimension: number;
  readonly simplexDimension: number;
  /** Rest edge Gram matrix `Dm^T Dm`. */
  readonly restMetric: MatN;
  /** Current edge Gram matrix `Ds^T Ds`. */
  readonly currentMetric: MatN;
  /** Current metric in the deterministic orthonormal rest-material basis. */
  readonly rightCauchyGreen: MatN;
  /** `(rightCauchyGreen - I) / 2`. */
  readonly greenLagrangeStrain: MatN;
  /** Square roots of the metric eigenvalues, in ascending order. */
  readonly principalStretches: Float64Array;
  /** Intrinsic current/rest k-measure ratio. */
  readonly measureRatio: number;
  /** Smallest/largest singular-value ratio of the rest edge matrix. */
  readonly restConditioning: number;
  readonly strainFrobeniusNorm: number;
  /** Maximum absolute eigenpair residual for `rightCauchyGreen`. */
  readonly spectralResidual: number;
  readonly orientationChange: SimplexOrientationChangeN;
}

/**
 * Evaluates intrinsic affine strain between matching rest/current simplices.
 *
 * The Cholesky material basis makes this valid for any `1 <= k <= N`, without
 * an ambient cross product or normal. Full-dimensional orientation is reported
 * separately through the signed determinant ratio.
 */
export function evaluateSimplexMetricDeformationN(
  restPositions: readonly VecN[],
  currentPositions: readonly VecN[]
): SimplexMetricDeformationN {
  const { ambientDimension, simplexDimension } = validatePositions(
    restPositions,
    currentPositions
  );
  const restMetric = edgeGram(restPositions, ambientDimension, simplexDimension);
  const currentMetric = edgeGram(
    currentPositions,
    ambientDimension,
    simplexDimension
  );

  const restSpectrum = symmetricEigenDecomposition(restMetric);
  const smallestRestEigenvalue = restSpectrum.values[0]!;
  const largestRestEigenvalue = restSpectrum.values[simplexDimension - 1]!;
  if (!(smallestRestEigenvalue > 0) || !Number.isFinite(largestRestEigenvalue)) {
    throw new Error(
      'evaluateSimplexMetricDeformationN: rest simplex must be non-degenerate'
    );
  }
  const restConditioning = Math.sqrt(
    smallestRestEigenvalue / largestRestEigenvalue
  );
  if (!(restConditioning > 0) || !Number.isFinite(restConditioning)) {
    throw new Error(
      'evaluateSimplexMetricDeformationN: rest conditioning is outside the Float64 range'
    );
  }

  const restFactor = choleskyPositive(restMetric);
  const inverseRestFactor = inverseLowerTriangular(restFactor);
  const rightCauchyGreen = inverseRestFactor
    .multiply(currentMetric)
    .multiply(inverseRestFactor.transpose());
  symmetrizeInPlace(rightCauchyGreen);

  const strain = new MatN(simplexDimension);
  let strainFrobeniusNorm = 0;
  for (let row = 0; row < simplexDimension; row++) {
    for (let column = 0; column < simplexDimension; column++) {
      const value = 0.5 * (
        rightCauchyGreen.get(row, column) - (row === column ? 1 : 0)
      );
      if (!Number.isFinite(value)) {
        throw new Error(
          'evaluateSimplexMetricDeformationN: strain is outside the Float64 range'
        );
      }
      strain.set(row, column, value);
      strainFrobeniusNorm = Math.hypot(strainFrobeniusNorm, value);
    }
  }

  const currentSpectrum = symmetricEigenDecomposition(rightCauchyGreen);
  const eigenvalueScale = Math.max(
    1,
    ...Array.from(currentSpectrum.values, Math.abs)
  );
  const negativeTolerance = 256 * Number.EPSILON * eigenvalueScale;
  const principalStretches = new Float64Array(simplexDimension);
  let stretchProduct = 1;
  for (let index = 0; index < simplexDimension; index++) {
    let eigenvalue = currentSpectrum.values[index]!;
    if (eigenvalue < -negativeTolerance) {
      throw new Error(
        'evaluateSimplexMetricDeformationN: current metric is numerically indefinite'
      );
    }
    if (eigenvalue < 0) eigenvalue = 0;
    const stretch = Math.sqrt(eigenvalue);
    principalStretches[index] = stretch;
    stretchProduct *= stretch;
  }
  if (!Number.isFinite(stretchProduct)) {
    throw new Error(
      'evaluateSimplexMetricDeformationN: principal stretches are outside the Float64 range'
    );
  }
  const restMeasure = evaluateSimplexSquaredMeasureN(restPositions).measure;
  const currentMeasure = evaluateSimplexSquaredMeasureN(currentPositions).measure;
  const measureRatio = currentMeasure / restMeasure;
  if (!Number.isFinite(measureRatio)) {
    throw new Error(
      'evaluateSimplexMetricDeformationN: measure ratio is outside the Float64 range'
    );
  }

  let orientationChange: SimplexOrientationChangeN;
  if (simplexDimension === ambientDimension) {
    const restOriented = evaluateOrientedSimplexMeasureN(restPositions);
    const currentOriented = evaluateOrientedSimplexMeasureN(currentPositions);
    const signedMeasureRatio = currentOriented.orientedMeasure /
      restOriented.orientedMeasure;
    if (!Number.isFinite(signedMeasureRatio)) {
      throw new Error(
        'evaluateSimplexMetricDeformationN: signed measure ratio is outside the Float64 range'
      );
    }
    orientationChange = Object.freeze({
      kind: 'full-dimensional',
      signedMeasureRatio,
      state: signedMeasureRatio > 0
        ? 'preserved'
        : signedMeasureRatio < 0
          ? 'inverted'
          : 'collapsed'
    });
  } else {
    orientationChange = Object.freeze({ kind: 'embedded' });
  }

  return Object.freeze({
    ambientDimension,
    simplexDimension,
    restMetric,
    currentMetric,
    rightCauchyGreen,
    greenLagrangeStrain: strain,
    principalStretches,
    measureRatio,
    restConditioning,
    strainFrobeniusNorm,
    spectralResidual: currentSpectrum.maxResidual,
    orientationChange
  });
}

function validatePositions(
  restPositions: readonly VecN[],
  currentPositions: readonly VecN[]
): { ambientDimension: number; simplexDimension: number } {
  if (restPositions.length < 2) {
    throw new Error(
      'evaluateSimplexMetricDeformationN: expected at least two rest points'
    );
  }
  if (currentPositions.length !== restPositions.length) {
    throw new Error(
      'evaluateSimplexMetricDeformationN: rest/current point counts must match'
    );
  }
  const first = restPositions[0];
  if (!(first instanceof VecN)) {
    throw new Error('evaluateSimplexMetricDeformationN: rest point 0 must be a VecN');
  }
  const ambientDimension = first.dim;
  const simplexDimension = restPositions.length - 1;
  if (simplexDimension > ambientDimension) {
    throw new Error(
      'evaluateSimplexMetricDeformationN: simplex dimension exceeds ambient dimension'
    );
  }
  for (let point = 0; point < restPositions.length; point++) {
    assertPosition(restPositions[point], ambientDimension, `rest point ${point}`);
    assertPosition(currentPositions[point], ambientDimension, `current point ${point}`);
  }
  return { ambientDimension, simplexDimension };
}

function assertPosition(
  position: VecN | undefined,
  dimension: number,
  label: string
): void {
  if (!(position instanceof VecN)) {
    throw new Error(`evaluateSimplexMetricDeformationN: ${label} must be a VecN`);
  }
  if (position.dim !== dimension) {
    throw new Error(`evaluateSimplexMetricDeformationN: ${label} dimension mismatch`);
  }
  for (const coordinate of position.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(
        `evaluateSimplexMetricDeformationN: ${label} must contain finite coordinates`
      );
    }
  }
}

function edgeGram(
  positions: readonly VecN[],
  ambientDimension: number,
  simplexDimension: number
): MatN {
  const metric = new MatN(simplexDimension);
  const origin = positions[0]!;
  for (let row = 0; row < simplexDimension; row++) {
    for (let column = row; column < simplexDimension; column++) {
      let dot = 0;
      const rowPoint = positions[row + 1]!;
      const columnPoint = positions[column + 1]!;
      for (let axis = 0; axis < ambientDimension; axis++) {
        dot += (rowPoint.data[axis]! - origin.data[axis]!) *
          (columnPoint.data[axis]! - origin.data[axis]!);
      }
      if (!Number.isFinite(dot)) {
        throw new Error(
          'evaluateSimplexMetricDeformationN: metric is outside the Float64 range'
        );
      }
      metric.set(row, column, dot).set(column, row, dot);
    }
  }
  return metric;
}

function choleskyPositive(matrix: MatN): MatN {
  const lower = new MatN(matrix.n);
  for (let row = 0; row < matrix.n; row++) {
    for (let column = 0; column <= row; column++) {
      let value = matrix.get(row, column);
      for (let k = 0; k < column; k++) {
        value -= lower.get(row, k) * lower.get(column, k);
      }
      if (row === column) {
        if (!(value > 0) || !Number.isFinite(value)) {
          throw new Error(
            'evaluateSimplexMetricDeformationN: rest simplex must be non-degenerate'
          );
        }
        lower.set(row, column, Math.sqrt(value));
      } else {
        const entry = value / lower.get(column, column);
        if (!Number.isFinite(entry)) {
          throw new Error(
            'evaluateSimplexMetricDeformationN: rest factor is outside the Float64 range'
          );
        }
        lower.set(row, column, entry);
      }
    }
  }
  return lower;
}

function inverseLowerTriangular(lower: MatN): MatN {
  const inverse = new MatN(lower.n);
  for (let column = 0; column < lower.n; column++) {
    for (let row = 0; row < lower.n; row++) {
      let value = row === column ? 1 : 0;
      for (let k = 0; k < row; k++) {
        value -= lower.get(row, k) * inverse.get(k, column);
      }
      value /= lower.get(row, row);
      if (!Number.isFinite(value)) {
        throw new Error(
          'evaluateSimplexMetricDeformationN: inverse rest factor is outside the Float64 range'
        );
      }
      inverse.set(row, column, value);
    }
  }
  return inverse;
}

function symmetrizeInPlace(matrix: MatN): void {
  for (let row = 0; row < matrix.n; row++) {
    for (let column = row + 1; column < matrix.n; column++) {
      const value = 0.5 * (
        matrix.get(row, column) + matrix.get(column, row)
      );
      matrix.set(row, column, value).set(column, row, value);
    }
  }
}
