/** Inputs to the C2-clamped logarithmic scalar barrier. */
export interface EvaluateClampedLogBarrierOptions {
  /** Positive scalar distance from the open domain boundary. */
  readonly coordinate: number;
  /** Positive coordinate at and above which the barrier is exactly zero. */
  readonly activation: number;
  /** Positive multiplicative energy scale. */
  readonly stiffness: number;
}

/** Value and first two coordinate derivatives of one scalar barrier sample. */
export interface ClampedLogBarrierEvaluation {
  /** Validated positive coordinate. */
  readonly coordinate: number;
  /** Validated positive activation coordinate. */
  readonly activation: number;
  /** Validated positive energy scale. */
  readonly stiffness: number;
  /** `coordinate / activation`. */
  readonly normalizedCoordinate: number;
  /** Whether `0 < coordinate < activation`. */
  readonly active: boolean;
  /** Barrier energy. */
  readonly energy: number;
  /** First derivative of `energy` with respect to `coordinate`. */
  readonly firstDerivative: number;
  /** Second derivative of `energy` with respect to `coordinate`. */
  readonly secondDerivative: number;
}

/**
 * Evaluates the compactly supported C2-clamped log barrier
 *
 * `-stiffness * (coordinate - activation)^2
 *   * log(coordinate / activation)`
 *
 * on its open positive domain. Value and derivatives are exactly zero at and
 * above activation. The caller owns the policy for an invalid candidate at or
 * below zero; this scalar kernel rejects it as an ordinary range error.
 *
 * This is the dimension-independent scalar law used by IPC-style distance
 * barriers, independently implemented from the published formula.
 *
 * @example
 * The clamping is what makes the law usable: the energy is *exactly* zero
 * at and above `activation`, so a configuration that is not near contact is
 * not perturbed at all. An unclamped log barrier would pull on every
 * separation, however large:
 * ```ts
 * const near = evaluateClampedLogBarrier({ coordinate: 0.01, activation: 0.1, stiffness: 1 });
 * near.energy; // 1.865e-2 — resists closing the gap
 *
 * const clear = evaluateClampedLogBarrier({ coordinate: 0.2, activation: 0.1, stiffness: 1 });
 * clear.energy; // 0 — outside the support, and exactly zero, not merely small
 * clear.firstDerivative; // 0 — so it contributes no force either
 * ```
 *
 * @example
 * The domain is open at zero: contact itself has no finite energy, so it is
 * a range error rather than a large number. A search that proposes such a
 * candidate has to be refused rather than scored, which is what the step
 * filters and the typed potential refusals exist to do:
 * ```ts
 * evaluateClampedLogBarrier({ coordinate: 0.001, activation: 0.1, stiffness: 1 }).energy;
 * // 4.514e-2 — steep, but finite
 *
 * evaluateClampedLogBarrier({ coordinate: 0, activation: 0.1, stiffness: 1 });
 * // RangeError: coordinate must be finite and positive
 * ```
 */
export function evaluateClampedLogBarrier(
  options: EvaluateClampedLogBarrierOptions
): ClampedLogBarrierEvaluation {
  const caller = 'evaluateClampedLogBarrier';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  const { coordinate, activation, stiffness } = options;
  if (!(coordinate > 0) || !Number.isFinite(coordinate)) {
    throw new RangeError(`${caller}: coordinate must be finite and positive`);
  }
  if (!(activation > 0) || !Number.isFinite(activation)) {
    throw new Error(`${caller}: activation must be finite and positive`);
  }
  if (!(stiffness > 0) || !Number.isFinite(stiffness)) {
    throw new Error(`${caller}: stiffness must be finite and positive`);
  }

  const normalizedCoordinate = coordinate / activation;
  if (!(normalizedCoordinate > 0) || !Number.isFinite(normalizedCoordinate)) {
    throw new Error(`${caller}: normalized coordinate is outside Float64`);
  }
  const active = coordinate < activation;
  if (!active) {
    return Object.freeze({
      coordinate,
      activation,
      stiffness,
      normalizedCoordinate,
      active,
      energy: 0,
      firstDerivative: 0,
      secondDerivative: 0
    });
  }

  const difference = coordinate - activation;
  const logRatio = Math.log(normalizedCoordinate);
  const activationByCoordinate = activation / coordinate;
  const energy = -stiffness * difference * difference * logRatio;
  const firstDerivative = stiffness * (activation - coordinate) * (
    2 * logRatio - activationByCoordinate + 1
  );
  const secondDerivative = stiffness * (
    (activationByCoordinate + 2) * activationByCoordinate -
    2 * logRatio -
    3
  );
  if (!(energy >= 0) ||
    !Number.isFinite(energy) ||
    !Number.isFinite(firstDerivative) ||
    !(secondDerivative >= 0) ||
    !Number.isFinite(secondDerivative)) {
    throw new Error(`${caller}: barrier differential is outside Float64`);
  }
  return Object.freeze({
    coordinate,
    activation,
    stiffness,
    normalizedCoordinate,
    active,
    energy,
    firstDerivative,
    secondDerivative
  });
}
