import { MatN, VecN } from '@holotope/core';
import { evaluateClampedLogBarrier } from './clamped-log-barrier.js';
import {
  SimplexConstitutiveDomainErrorN,
  completeSimplexConstitutiveEvaluationN,
  positiveSimplexConstitutiveMeasureRatioN,
  type SimplexConstitutiveEvaluationN
} from './simplex-constitutive.js';
import {
  completeSimplexConstitutiveHessianVectorN,
  prepareSimplexConstitutiveHessianVectorN,
  type SimplexConstitutiveHessianVectorEvaluationN
} from './simplex-constitutive-curvature.js';
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
  const scalarBarrier = evaluateClampedLogBarrier({
    coordinate: measureRatio - minimumMeasureRatio,
    activation: activationWidth,
    stiffness
  });
  const normalizedGap = scalarBarrier.normalizedCoordinate;
  const active = scalarBarrier.active;
  const energyDensity = scalarBarrier.energy;
  const energyDerivativeByMeasureRatio = scalarBarrier.firstDerivative;
  const energySecondDerivativeByMeasureRatio = scalarBarrier.secondDerivative;
  const secondPiolaStress = new MatN(deformation.simplexDimension);

  if (active) {
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

/**
 * Evaluates the exact matrix-free lower-measure-barrier Hessian direction.
 *
 * Outside the compact activation interval the potential, gradient, and
 * curvature products are all exactly zero.
 *
 * The compact support carries into the curvature for the same reason it
 * holds for the energy: an element comfortably above the activation ratio is
 * not merely cheap to evaluate, it contributes nothing at all, so an
 * inactive element cannot bias a direction it should have no opinion about.
 *
 * @example
 * Flattening a unit tetrahedron towards its base drives the measure ratio
 * `J` down. Above the activation ratio the barrier is silent in energy and
 * in curvature alike; below it, both rise steeply towards the hard chart
 * boundary at `minimumMeasureRatio`:
 * ```ts
 * const rest = [
 *   new VecN([0, 0, 0]), new VecN([1, 0, 0]),
 *   new VecN([0, 1, 0]), new VecN([0, 0, 1])
 * ];
 * const material = {
 *   minimumMeasureRatio: 0.1, activationMeasureRatio: 0.6, stiffness: 1
 * };
 * const directions = [
 *   new VecN([0, 0, 0]), new VecN([0, 0, 0]),
 *   new VecN([0, 0, 0]), new VecN([0, 0, -1])
 * ];
 * const flattenedTo = [0.8, 0.3].map((height) => [
 *   new VecN([0, 0, 0]), new VecN([1, 0, 0]),
 *   new VecN([0, 1, 0]), new VecN([0, 0, height])
 * ]);
 *
 * const curvatures = flattenedTo.map((current) =>
 *   evaluateSimplexMeasureBarrierHessianVectorN(rest, current, directions, material)
 * );
 *
 * // J = 0.8, above activation: exactly zero, not merely small.
 * // J = 0.3, inside the support: the element resists being flattened.
 * curvatures.map((c) => c.products.every((p) => p.lengthSq() === 0)); // [true, false]
 * curvatures.map((c) => c.netProductResidual); // [0, 0] — translation invariant either way
 * ```
 */
export function evaluateSimplexMeasureBarrierHessianVectorN(
  restPositions: readonly VecN[],
  currentPositions: readonly VecN[],
  directions: readonly VecN[],
  material: SimplexMeasureBarrierMaterialN
): SimplexConstitutiveHessianVectorEvaluationN<
  SimplexMeasureBarrierEvaluationN
> {
  const caller = 'evaluateSimplexMeasureBarrierHessianVectorN';
  const base = evaluateSimplexMeasureBarrierN(
    restPositions,
    currentPositions,
    material
  );
  const prepared = prepareSimplexConstitutiveHessianVectorN(
    caller,
    currentPositions,
    directions,
    base
  );
  const directionalStress = new MatN(
    base.deformation.simplexDimension
  );
  if (!base.active) {
    return completeSimplexConstitutiveHessianVectorN(
      prepared,
      directionalStress
    );
  }

  const inverseMetric = inversePositiveDefiniteN(
    base.deformation.rightCauchyGreen,
    caller
  );
  const inverseDirectionalInverse = inverseMetric
    .multiply(prepared.directionalRightCauchyGreen)
    .multiply(inverseMetric);
  const directionalMeasure =
    0.5 * base.measureRatio *
    matrixProductTrace(
      inverseMetric,
      prepared.directionalRightCauchyGreen
    );
  const stressScale =
    base.energyDerivativeByMeasureRatio * base.measureRatio;
  const directionalStressScale = (
    base.energySecondDerivativeByMeasureRatio * base.measureRatio +
    base.energyDerivativeByMeasureRatio
  ) * directionalMeasure;
  for (let row = 0; row < directionalStress.n; row++) {
    for (let column = 0; column < directionalStress.n; column++) {
      directionalStress.set(
        row,
        column,
        directionalStressScale * inverseMetric.get(row, column) -
          stressScale * inverseDirectionalInverse.get(row, column)
      );
    }
  }
  return completeSimplexConstitutiveHessianVectorN(
    prepared,
    directionalStress
  );
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

function matrixProductTrace(left: MatN, right: MatN): number {
  let trace = 0;
  for (let row = 0; row < left.n; row++) {
    for (let column = 0; column < left.n; column++) {
      trace += left.get(row, column) * right.get(column, row);
    }
  }
  return trace;
}
