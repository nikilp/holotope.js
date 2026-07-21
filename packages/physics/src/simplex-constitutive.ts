import { MatN, VecN } from '@holotope/core';
import type { SimplexMetricDeformationN } from './simplex-deformation.js';
import { evaluateSimplexSquaredMeasureN } from './xpbd-simplex-measure.js';

export type SimplexConstitutiveDomainReasonN =
  | 'collapsed'
  | 'inverted'
  | 'non-positive-measure';

/** Typed material-chart refusal, distinct from malformed input or arithmetic failure. */
export class SimplexConstitutiveDomainErrorN extends Error {
  readonly lawId: string;
  readonly reason: SimplexConstitutiveDomainReasonN;

  constructor(
    lawId: string,
    reason: SimplexConstitutiveDomainReasonN,
    message: string
  ) {
    super(message);
    this.name = 'SimplexConstitutiveDomainErrorN';
    this.lawId = lawId;
    this.reason = reason;
  }
}

/** Common energy, stress, and current-gradient evidence for one simplex law. */
export interface SimplexConstitutiveEvaluationN<TMaterial> {
  readonly deformation: SimplexMetricDeformationN;
  readonly material: TMaterial;
  /** Intrinsic k-measure of the rest simplex. */
  readonly restMeasure: number;
  /** Energy per unit rest k-measure. */
  readonly energyDensity: number;
  /** `restMeasure * energyDensity`. */
  readonly energy: number;
  /** Symmetric second Piola stress in the deterministic rest-material basis. */
  readonly secondPiolaStress: MatN;
  /** `d energy / d currentPositions[i]`; internal force is its negative. */
  readonly currentGradients: readonly VecN[];
  /** Norm of the summed gradients; translation invariance should make it zero. */
  readonly netGradientResidual: number;
}

interface CompleteSimplexConstitutiveEvaluationNOptions<TMaterial> {
  readonly caller: string;
  readonly restPositions: readonly VecN[];
  readonly currentPositions: readonly VecN[];
  readonly deformation: SimplexMetricDeformationN;
  readonly material: TMaterial;
  readonly energyDensity: number;
  readonly secondPiolaStress: MatN;
}

/** Internal common assembly from a constitutive stress to vertex gradients. */
export function completeSimplexConstitutiveEvaluationN<TMaterial>(
  options: CompleteSimplexConstitutiveEvaluationNOptions<TMaterial>
): SimplexConstitutiveEvaluationN<TMaterial> {
  const {
    caller,
    restPositions,
    currentPositions,
    deformation,
    material,
    energyDensity,
    secondPiolaStress
  } = options;
  const simplexDimension = deformation.simplexDimension;
  if (!Number.isFinite(energyDensity)) {
    throw new Error(`${caller}: energy density is outside the Float64 range`);
  }
  if (!(secondPiolaStress instanceof MatN) ||
    secondPiolaStress.n !== simplexDimension) {
    throw new Error(`${caller}: second Piola stress dimension mismatch`);
  }
  for (const value of secondPiolaStress.data) {
    if (!Number.isFinite(value)) {
      throw new Error(`${caller}: stress is outside the Float64 range`);
    }
  }

  const restMeasure = evaluateSimplexSquaredMeasureN(restPositions).measure;
  const energy = restMeasure * energyDensity;
  if (!Number.isFinite(energy)) {
    throw new Error(`${caller}: energy is outside the Float64 range`);
  }

  const inverseRestFactor = inverseLowerTriangular(
    choleskyPositive(deformation.restMetric, caller),
    caller
  );
  const materialGradient = inverseRestFactor
    .transpose()
    .multiply(secondPiolaStress)
    .multiply(inverseRestFactor);
  const gradients = Array.from(
    { length: simplexDimension + 1 },
    () => new VecN(deformation.ambientDimension)
  );
  const originGradient = gradients[0]!;
  const origin = currentPositions[0]!;
  for (let vertex = 0; vertex < simplexDimension; vertex++) {
    const gradient = gradients[vertex + 1]!;
    for (let axis = 0; axis < deformation.ambientDimension; axis++) {
      let value = 0;
      for (let edge = 0; edge < simplexDimension; edge++) {
        value += (
          currentPositions[edge + 1]!.data[axis]! - origin.data[axis]!
        ) * materialGradient.get(edge, vertex);
      }
      gradient.data[axis] = restMeasure * value;
      originGradient.data[axis] = originGradient.data[axis]! - gradient.data[axis]!;
    }
  }

  let netGradientResidual = 0;
  for (let axis = 0; axis < deformation.ambientDimension; axis++) {
    let sum = 0;
    for (const gradient of gradients) sum += gradient.data[axis]!;
    netGradientResidual = Math.hypot(netGradientResidual, sum);
  }
  for (const gradient of gradients) {
    for (const value of gradient.data) {
      if (!Number.isFinite(value)) {
        throw new Error(`${caller}: gradient is outside the Float64 range`);
      }
    }
  }

  return Object.freeze({
    deformation,
    material,
    restMeasure,
    energyDensity,
    energy,
    secondPiolaStress,
    currentGradients: Object.freeze(gradients),
    netGradientResidual
  });
}

function choleskyPositive(matrix: MatN, caller: string): MatN {
  const lower = new MatN(matrix.n);
  for (let row = 0; row < matrix.n; row++) {
    for (let column = 0; column <= row; column++) {
      let value = matrix.get(row, column);
      for (let k = 0; k < column; k++) {
        value -= lower.get(row, k) * lower.get(column, k);
      }
      if (row === column) {
        if (!(value > 0) || !Number.isFinite(value)) {
          throw new Error(`${caller}: rest metric must be positive definite`);
        }
        lower.set(row, column, Math.sqrt(value));
      } else {
        const entry = value / lower.get(column, column);
        if (!Number.isFinite(entry)) {
          throw new Error(`${caller}: rest factor is outside the Float64 range`);
        }
        lower.set(row, column, entry);
      }
    }
  }
  return lower;
}

function inverseLowerTriangular(lower: MatN, caller: string): MatN {
  const inverse = new MatN(lower.n);
  for (let column = 0; column < lower.n; column++) {
    for (let row = 0; row < lower.n; row++) {
      let value = row === column ? 1 : 0;
      for (let k = 0; k < row; k++) {
        value -= lower.get(row, k) * inverse.get(k, column);
      }
      value /= lower.get(row, row);
      if (!Number.isFinite(value)) {
        throw new Error(`${caller}: inverse rest factor is outside the Float64 range`);
      }
      inverse.set(row, column, value);
    }
  }
  return inverse;
}
