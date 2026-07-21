import { MatN, VecN } from '@holotope/core';
import {
  evaluateSimplexMetricDeformationN,
  type SimplexMetricDeformationN
} from './simplex-deformation.js';
import { evaluateSimplexSquaredMeasureN } from './xpbd-simplex-measure.js';

/** Isotropic St. Venant–Kirchhoff parameters in intrinsic material coordinates. */
export interface SimplexStVenantKirchhoffMaterialN {
  readonly firstLameParameter: number;
  readonly shearModulus: number;
}

/** Energy, stress, and current-position gradient for one simplex element. */
export interface SimplexStVenantKirchhoffEvaluationN {
  readonly deformation: SimplexMetricDeformationN;
  readonly material: SimplexStVenantKirchhoffMaterialN;
  /** Intrinsic k-measure of the rest simplex. */
  readonly restMeasure: number;
  /** Energy per unit rest k-measure. */
  readonly energyDensity: number;
  /** `restMeasure * energyDensity`. */
  readonly energy: number;
  /** `lambda tr(E) I + 2 mu E` in P11's rest-material basis. */
  readonly secondPiolaStress: MatN;
  /** `d energy / d currentPositions[i]`; internal force is its negative. */
  readonly currentGradients: readonly VecN[];
  /** Norm of the summed gradients; translation invariance should make it zero. */
  readonly netGradientResidual: number;
}

/**
 * Evaluates an isotropic St. Venant–Kirchhoff material on a k-simplex in RN.
 *
 * This is a constitutive CPU reference, not a solver or inversion barrier.
 * Full-dimensional orientation evidence remains available on `deformation`.
 */
export function evaluateSimplexStVenantKirchhoffN(
  restPositions: readonly VecN[],
  currentPositions: readonly VecN[],
  material: SimplexStVenantKirchhoffMaterialN
): SimplexStVenantKirchhoffEvaluationN {
  const deformation = evaluateSimplexMetricDeformationN(
    restPositions,
    currentPositions
  );
  const simplexDimension = deformation.simplexDimension;
  const { firstLameParameter, shearModulus } = validateMaterial(
    material,
    simplexDimension
  );
  const volumetricModulus = firstLameParameter +
    2 * shearModulus / simplexDimension;

  const strain = deformation.greenLagrangeStrain;
  let trace = 0;
  let squaredNorm = 0;
  for (let row = 0; row < simplexDimension; row++) {
    trace += strain.get(row, row);
    for (let column = 0; column < simplexDimension; column++) {
      squaredNorm += strain.get(row, column) ** 2;
    }
  }
  let deviatoricSquaredNorm = squaredNorm - trace * trace / simplexDimension;
  const deviatoricTolerance = 256 * Number.EPSILON * Math.max(
    1,
    squaredNorm,
    trace * trace
  );
  if (deviatoricSquaredNorm < -deviatoricTolerance) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: deviatoric strain norm is numerically negative'
    );
  }
  if (deviatoricSquaredNorm < 0) deviatoricSquaredNorm = 0;

  const energyDensity = shearModulus * deviatoricSquaredNorm +
    0.5 * volumetricModulus * trace * trace;
  if (!Number.isFinite(energyDensity)) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: energy density is outside the Float64 range'
    );
  }

  const secondPiolaStress = new MatN(simplexDimension);
  for (let row = 0; row < simplexDimension; row++) {
    for (let column = 0; column < simplexDimension; column++) {
      const value = 2 * shearModulus * strain.get(row, column) +
        (row === column ? firstLameParameter * trace : 0);
      if (!Number.isFinite(value)) {
        throw new Error(
          'evaluateSimplexStVenantKirchhoffN: stress is outside the Float64 range'
        );
      }
      secondPiolaStress.set(row, column, value);
    }
  }

  const restMeasure = evaluateSimplexSquaredMeasureN(restPositions).measure;
  const energy = restMeasure * energyDensity;
  if (!Number.isFinite(energy)) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: energy is outside the Float64 range'
    );
  }

  const inverseRestFactor = inverseLowerTriangular(
    choleskyPositive(deformation.restMetric)
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
        throw new Error(
          'evaluateSimplexStVenantKirchhoffN: gradient is outside the Float64 range'
        );
      }
    }
  }

  return Object.freeze({
    deformation,
    material: Object.freeze({ firstLameParameter, shearModulus }),
    restMeasure,
    energyDensity,
    energy,
    secondPiolaStress,
    currentGradients: Object.freeze(gradients),
    netGradientResidual
  });
}

function validateMaterial(
  material: SimplexStVenantKirchhoffMaterialN,
  simplexDimension: number
): SimplexStVenantKirchhoffMaterialN {
  if (typeof material !== 'object' || material === null) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: material must be an object'
    );
  }
  const { firstLameParameter, shearModulus } = material;
  if (!Number.isFinite(firstLameParameter)) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: firstLameParameter must be finite'
    );
  }
  if (!(shearModulus > 0) || !Number.isFinite(shearModulus)) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: shearModulus must be finite and positive'
    );
  }
  const volumetricModulus = firstLameParameter +
    2 * shearModulus / simplexDimension;
  if (!(volumetricModulus > 0) || !Number.isFinite(volumetricModulus)) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: material must satisfy lambda + 2 mu / k > 0'
    );
  }
  return { firstLameParameter, shearModulus };
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
            'evaluateSimplexStVenantKirchhoffN: rest metric must be positive definite'
          );
        }
        lower.set(row, column, Math.sqrt(value));
      } else {
        lower.set(row, column, value / lower.get(column, column));
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
          'evaluateSimplexStVenantKirchhoffN: inverse rest factor is outside the Float64 range'
        );
      }
      inverse.set(row, column, value);
    }
  }
  return inverse;
}
