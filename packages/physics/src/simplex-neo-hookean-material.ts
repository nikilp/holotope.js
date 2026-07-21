import { MatN, VecN } from '@holotope/core';
import {
  completeSimplexConstitutiveEvaluationN,
  type SimplexConstitutiveEvaluationN
} from './simplex-constitutive.js';
import { evaluateSimplexMetricDeformationN } from './simplex-deformation.js';

/** Compressible Neo-Hookean parameters in intrinsic material coordinates. */
export interface SimplexCompressibleNeoHookeanMaterialN {
  /** First Lame parameter. This reference requires `lambda >= 0`. */
  readonly firstLameParameter: number;
  /** Shear modulus `mu > 0`. */
  readonly shearModulus: number;
}

export interface SimplexCompressibleNeoHookeanEvaluationN
  extends SimplexConstitutiveEvaluationN<SimplexCompressibleNeoHookeanMaterialN> {
  /** `log(J)`, where `J` is the positive current/rest intrinsic measure ratio. */
  readonly volumetricLogStrain: number;
}

/**
 * Evaluates a compressible Neo-Hookean law on a k-simplex embedded in RN.
 *
 * Embedded elements use their positive intrinsic measure ratio. A
 * full-dimensional element must preserve signed orientation. Collapse or
 * inversion is outside this constitutive chart and is refused explicitly.
 */
export function evaluateSimplexCompressibleNeoHookeanN(
  restPositions: readonly VecN[],
  currentPositions: readonly VecN[],
  material: SimplexCompressibleNeoHookeanMaterialN
): SimplexCompressibleNeoHookeanEvaluationN {
  const caller = 'evaluateSimplexCompressibleNeoHookeanN';
  const deformation = evaluateSimplexMetricDeformationN(
    restPositions,
    currentPositions
  );
  const validatedMaterial = validateMaterial(material);
  const { firstLameParameter, shearModulus } = validatedMaterial;
  const simplexDimension = deformation.simplexDimension;

  let measureRatio = deformation.measureRatio;
  if (deformation.orientationChange.kind === 'full-dimensional') {
    if (deformation.orientationChange.state !== 'preserved') {
      throw new Error(
        `${caller}: full-dimensional current simplex must preserve orientation`
      );
    }
    measureRatio = deformation.orientationChange.signedMeasureRatio;
  }
  if (!(measureRatio > 0) || !Number.isFinite(measureRatio)) {
    throw new Error(
      `${caller}: current simplex must have positive finite measure ratio`
    );
  }
  const volumetricLogStrain = Math.log(measureRatio);
  if (!Number.isFinite(volumetricLogStrain)) {
    throw new Error(`${caller}: logarithmic measure strain is outside the Float64 range`);
  }

  const rightCauchyGreen = deformation.rightCauchyGreen;
  const inverseMetric = inversePositiveDefinite(rightCauchyGreen, caller);
  let trace = 0;
  for (let axis = 0; axis < simplexDimension; axis++) {
    trace += rightCauchyGreen.get(axis, axis);
  }
  let energyDensity = 0.5 * shearModulus * (trace - simplexDimension) -
    shearModulus * volumetricLogStrain +
    0.5 * firstLameParameter * volumetricLogStrain ** 2;
  const energyScale = Math.max(
    1,
    Math.abs(0.5 * shearModulus * (trace - simplexDimension)),
    Math.abs(shearModulus * volumetricLogStrain),
    Math.abs(0.5 * firstLameParameter * volumetricLogStrain ** 2)
  );
  const negativeTolerance = 512 * Number.EPSILON * energyScale;
  if (energyDensity < -negativeTolerance || !Number.isFinite(energyDensity)) {
    throw new Error(`${caller}: energy density is outside its finite non-negative domain`);
  }
  if (energyDensity < 0) energyDensity = 0;

  const volumetricStress = firstLameParameter * volumetricLogStrain;
  const secondPiolaStress = new MatN(simplexDimension);
  for (let row = 0; row < simplexDimension; row++) {
    for (let column = 0; column < simplexDimension; column++) {
      const inverse = inverseMetric.get(row, column);
      const identity = row === column ? 1 : 0;
      const value = shearModulus * (identity - inverse) +
        volumetricStress * inverse;
      if (!Number.isFinite(value)) {
        throw new Error(`${caller}: stress is outside the Float64 range`);
      }
      secondPiolaStress.set(row, column, value);
    }
  }

  return Object.freeze({
    ...completeSimplexConstitutiveEvaluationN({
      caller,
      restPositions,
      currentPositions,
      deformation,
      material: validatedMaterial,
      energyDensity,
      secondPiolaStress
    }),
    volumetricLogStrain
  });
}

function validateMaterial(
  material: SimplexCompressibleNeoHookeanMaterialN
): SimplexCompressibleNeoHookeanMaterialN {
  const caller = 'evaluateSimplexCompressibleNeoHookeanN';
  if (typeof material !== 'object' || material === null) {
    throw new Error(`${caller}: material must be an object`);
  }
  const { firstLameParameter, shearModulus } = material;
  if (!Number.isFinite(firstLameParameter) || firstLameParameter < 0) {
    throw new Error(
      `${caller}: firstLameParameter must be finite and non-negative`
    );
  }
  if (!(shearModulus > 0) || !Number.isFinite(shearModulus)) {
    throw new Error(`${caller}: shearModulus must be finite and positive`);
  }
  return Object.freeze({ firstLameParameter, shearModulus });
}

function inversePositiveDefinite(matrix: MatN, caller: string): MatN {
  const lower = new MatN(matrix.n);
  for (let row = 0; row < matrix.n; row++) {
    for (let column = 0; column <= row; column++) {
      let value = matrix.get(row, column);
      for (let k = 0; k < column; k++) {
        value -= lower.get(row, k) * lower.get(column, k);
      }
      if (row === column) {
        if (!(value > 0) || !Number.isFinite(value)) {
          throw new Error(`${caller}: current metric must be positive definite`);
        }
        lower.set(row, column, Math.sqrt(value));
      } else {
        const entry = value / lower.get(column, column);
        if (!Number.isFinite(entry)) {
          throw new Error(`${caller}: current metric factor is outside the Float64 range`);
        }
        lower.set(row, column, entry);
      }
    }
  }

  const inverseLower = new MatN(matrix.n);
  for (let column = 0; column < matrix.n; column++) {
    for (let row = 0; row < matrix.n; row++) {
      let value = row === column ? 1 : 0;
      for (let k = 0; k < row; k++) {
        value -= lower.get(row, k) * inverseLower.get(k, column);
      }
      value /= lower.get(row, row);
      if (!Number.isFinite(value)) {
        throw new Error(`${caller}: inverse current metric is outside the Float64 range`);
      }
      inverseLower.set(row, column, value);
    }
  }
  return inverseLower.transpose().multiply(inverseLower);
}
