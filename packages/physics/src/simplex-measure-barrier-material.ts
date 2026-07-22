import { MatN, VecN } from '@holotope/core';
import {
  SimplexConstitutiveDomainErrorN,
  completeSimplexConstitutiveEvaluationN,
  positiveSimplexConstitutiveMeasureRatioN,
  type SimplexConstitutiveEvaluationN
} from './simplex-constitutive.js';
import { inversePositiveDefiniteN } from './simplex-constitutive-matrix.js';
import { evaluateSimplexMetricDeformationN } from './simplex-deformation.js';

/** Compactly supported lower-measure barrier in intrinsic simplex coordinates. */
export interface SimplexMeasureBarrierMaterialN {
  /** Hard lower chart boundary `m`; evaluation requires `J > m`. */
  readonly minimumMeasureRatio: number;
  /** Barrier activation ratio `a`, with `m < a <= 1`. */
  readonly activationMeasureRatio: number;
  /** Positive energy-density scale `kappa`. */
  readonly stiffness: number;
}

export interface SimplexMeasureBarrierEvaluationN
  extends SimplexConstitutiveEvaluationN<SimplexMeasureBarrierMaterialN> {
  /** Whether `minimumMeasureRatio < J < activationMeasureRatio`. */
  readonly active: boolean;
  /** Positive intrinsic or orientation-preserving signed current/rest ratio. */
  readonly measureRatio: number;
  /** `(J - minimum) / (activation - minimum)`; may exceed one when inactive. */
  readonly normalizedGap: number;
  /** `d energyDensity / dJ`. */
  readonly energyDerivativeByMeasureRatio: number;
  /** `d^2 energyDensity / dJ^2`. */
  readonly energySecondDerivativeByMeasureRatio: number;
}

export const SIMPLEX_MEASURE_BARRIER_LAW_ID = 'simplex-measure-barrier';

/**
 * Evaluates a C2-clamped logarithmic lower-measure barrier on a k-simplex.
 *
 * The energy is a proactive force, not an inversion guarantee. Pair it with
 * accepted-state and continuous-chord guards when the lower boundary is a
 * simulation invariant.
 */
export function evaluateSimplexMeasureBarrierN(
  restPositions: readonly VecN[],
  currentPositions: readonly VecN[],
  material: SimplexMeasureBarrierMaterialN
): SimplexMeasureBarrierEvaluationN {
  const caller = 'evaluateSimplexMeasureBarrierN';
  const deformation = evaluateSimplexMetricDeformationN(
    restPositions,
    currentPositions
  );
  const validatedMaterial = validateMaterial(material);
  const measureRatio = positiveSimplexConstitutiveMeasureRatioN(
    deformation,
    SIMPLEX_MEASURE_BARRIER_LAW_ID,
    caller
  );
  const {
    minimumMeasureRatio,
    activationMeasureRatio,
    stiffness
  } = validatedMaterial;
  if (!(measureRatio > minimumMeasureRatio)) {
    throw new SimplexConstitutiveDomainErrorN(
      SIMPLEX_MEASURE_BARRIER_LAW_ID,
      'below-minimum-measure',
      `${caller}: measure ratio must be greater than minimumMeasureRatio`
    );
  }

  const activationWidth = activationMeasureRatio - minimumMeasureRatio;
  const normalizedGap = (measureRatio - minimumMeasureRatio) / activationWidth;
  if (!(normalizedGap > 0) || !Number.isFinite(normalizedGap)) {
    throw new Error(`${caller}: normalized measure gap is outside the Float64 range`);
  }

  const active = measureRatio < activationMeasureRatio;
  let energyDensity = 0;
  let energyDerivativeByMeasureRatio = 0;
  let energySecondDerivativeByMeasureRatio = 0;
  const secondPiolaStress = new MatN(deformation.simplexDimension);

  if (active) {
    const remaining = 1 - normalizedGap;
    const logGap = Math.log(normalizedGap);
    energyDensity = -stiffness * activationWidth ** 2 *
      remaining ** 2 * logGap;
    energyDerivativeByMeasureRatio = stiffness * activationWidth * (
      2 * remaining * logGap - remaining ** 2 / normalizedGap
    );
    energySecondDerivativeByMeasureRatio = stiffness * (
      -2 * logGap + 4 * remaining / normalizedGap +
      remaining ** 2 / normalizedGap ** 2
    );
    if (!(energyDensity >= 0) ||
      !Number.isFinite(energyDensity) ||
      !Number.isFinite(energyDerivativeByMeasureRatio) ||
      !(energySecondDerivativeByMeasureRatio >= 0) ||
      !Number.isFinite(energySecondDerivativeByMeasureRatio)) {
      throw new Error(`${caller}: barrier differential is outside the Float64 range`);
    }

    const inverseMetric = inversePositiveDefiniteN(
      deformation.rightCauchyGreen,
      caller
    );
    const stressScale = energyDerivativeByMeasureRatio * measureRatio;
    for (let row = 0; row < deformation.simplexDimension; row++) {
      for (let column = 0; column < deformation.simplexDimension; column++) {
        const value = stressScale * inverseMetric.get(row, column);
        if (!Number.isFinite(value)) {
          throw new Error(`${caller}: stress is outside the Float64 range`);
        }
        secondPiolaStress.set(row, column, value);
      }
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
    active,
    measureRatio,
    normalizedGap,
    energyDerivativeByMeasureRatio,
    energySecondDerivativeByMeasureRatio
  });
}

function validateMaterial(
  material: SimplexMeasureBarrierMaterialN
): SimplexMeasureBarrierMaterialN {
  const caller = 'evaluateSimplexMeasureBarrierN';
  if (typeof material !== 'object' || material === null) {
    throw new Error(`${caller}: material must be an object`);
  }
  const {
    minimumMeasureRatio,
    activationMeasureRatio,
    stiffness
  } = material;
  if (!Number.isFinite(minimumMeasureRatio) || minimumMeasureRatio < 0) {
    throw new Error(
      `${caller}: minimumMeasureRatio must be finite and non-negative`
    );
  }
  if (!Number.isFinite(activationMeasureRatio) ||
    !(activationMeasureRatio > minimumMeasureRatio) ||
    activationMeasureRatio > 1) {
    throw new Error(
      `${caller}: activationMeasureRatio must be finite, greater than minimumMeasureRatio, and at most one`
    );
  }
  if (!(stiffness > 0) || !Number.isFinite(stiffness)) {
    throw new Error(`${caller}: stiffness must be finite and positive`);
  }
  return Object.freeze({
    minimumMeasureRatio,
    activationMeasureRatio,
    stiffness
  });
}
