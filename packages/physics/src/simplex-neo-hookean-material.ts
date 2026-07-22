import { MatN, VecN } from '@holotope/core';
import {
  completeSimplexConstitutiveEvaluationN,
  positiveSimplexConstitutiveMeasureRatioN,
  type SimplexConstitutiveEvaluationN
} from './simplex-constitutive.js';
import { inversePositiveDefiniteN } from './simplex-constitutive-matrix.js';
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

export const SIMPLEX_COMPRESSIBLE_NEO_HOOKEAN_LAW_ID =
  'compressible-neo-hookean';

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

  const measureRatio = positiveSimplexConstitutiveMeasureRatioN(
    deformation,
    SIMPLEX_COMPRESSIBLE_NEO_HOOKEAN_LAW_ID,
    caller
  );
  const volumetricLogStrain = Math.log(measureRatio);
  if (!Number.isFinite(volumetricLogStrain)) {
    throw new Error(`${caller}: logarithmic measure strain is outside the Float64 range`);
  }

  const rightCauchyGreen = deformation.rightCauchyGreen;
  const inverseMetric = inversePositiveDefiniteN(rightCauchyGreen, caller);
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
