import { evaluateBarrierCore } from './clamped-log-barrier-core.js';

/** Highest derivative order requested. Required: there is no default. */
export type BarrierDerivativeOrder = 0 | 1 | 2;

/** The one way a requested component can be missing. */
export type BarrierComponentUnavailability = 'outside-float64';

/**
 * One scalar output, graded on its own account.
 *
 * An unavailable component carries NO `value` key: reading a number off it
 * is a type error, not a NaN. An available zero IS a number — see the
 * semantics of `active` below.
 */
export type BarrierComponentN =
  | { readonly available: true; readonly value: number }
  | { readonly available: false;
    readonly reason: BarrierComponentUnavailability };

/** Inputs to the C2-clamped logarithmic scalar barrier. */
export interface ClampedLogBarrierInputsN {
  /** Positive scalar distance from the open domain boundary. */
  readonly coordinate: number;
  /** Positive coordinate at and above which the barrier is exactly zero. */
  readonly activation: number;
  /** Positive multiplicative energy scale. */
  readonly stiffness: number;
}

/**
 * Order-0 result: the energy alone.
 *
 * `active && component.value === 0` means the exact value is nonzero and its
 * correctly rounded Float64 is zero — an underflow statement, published as
 * the number it is, never refused. `active: false` is the clamp: the barrier
 * is outside its support and zero is exact.
 */
export interface ClampedLogBarrierValueN {
  /** Compiler-owned frozen copy of the inputs. Never the caller's object. */
  readonly inputs: ClampedLogBarrierInputsN;
  /** `coordinate < activation`. False is the clamp, not a small number. */
  readonly active: boolean;
  /** Barrier energy, graded on its own account. */
  readonly energy: BarrierComponentN;
}
/** Order-1 result: energy and first derivative, each graded independently. */
export interface ClampedLogBarrierForceN extends ClampedLogBarrierValueN {
  /** First derivative of the energy with respect to `coordinate`. */
  readonly firstDerivative: BarrierComponentN;
}
/** Order-2 result: all three components, each graded independently. */
export interface ClampedLogBarrierCurvatureN extends ClampedLogBarrierForceN {
  /** Second derivative of the energy with respect to `coordinate`. */
  readonly secondDerivative: BarrierComponentN;
}

/** The exact result shape produced for each requested derivative order. */
export type ClampedLogBarrierEvaluationForN<O extends BarrierDerivativeOrder> =
  O extends 0 ? ClampedLogBarrierValueN
    : O extends 1 ? ClampedLogBarrierForceN : ClampedLogBarrierCurvatureN;

/**
 * Thrown for an authored input outside the declared domain. Permanent: this
 * is a configuration error, never a recoverable domain refusal, and no
 * candidate retry can fix it.
 */
export class ClampedLogBarrierInputErrorN extends RangeError {
  /**
   * Names the violated domain constraint.
   *
   * @param message Which input violated the domain, and how.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ClampedLogBarrierInputErrorN';
  }
}

/**
 * Validates the SNAPSHOT, never the caller's object.
 *
 * The distinction is the whole point: the values checked here are the ones
 * already captured, so nothing can change between the check and the use.
 */
function validate(inputs: ClampedLogBarrierInputsN): void {
  const { coordinate, activation, stiffness } = inputs;
  if (!(coordinate > 0) || !Number.isFinite(coordinate)) {
    throw new ClampedLogBarrierInputErrorN(
      'coordinate must be finite and positive');
  }
  if (!(activation > 0) || !Number.isFinite(activation)) {
    throw new ClampedLogBarrierInputErrorN(
      'activation must be finite and positive');
  }
  if (!(stiffness > 0) || !Number.isFinite(stiffness)) {
    throw new ClampedLogBarrierInputErrorN(
      'stiffness must be finite and positive');
  }
}

/**
 * The runtime order guard. The signature already rejects a wrong order at
 * the type level, but types erase: a JavaScript caller, or any caller
 * crossing a `JSON.parse`/config/adapter boundary, arrives here with
 * whatever it has. Before this guard, every value that was neither 0 nor 1
 * fell through to a full order-2 result — a runtime default of 2 on a
 * function whose contract says there is no default (P66E-PUB review, NC1).
 *
 * Strict equality only: no coercion, no truthiness, no clamp, no fallback.
 * `new Number(1)`, `true` and `"1"` are all rejected. The remedy is the
 * same as for a malformed scalar input — fix the authored call — so the
 * same permanent error class is thrown and the taxonomy does not grow.
 */
function validateOrder(order: BarrierDerivativeOrder): void {
  if (order === 0 || order === 1 || order === 2) return;
  throw new ClampedLogBarrierInputErrorN('order must be exactly 0, 1 or 2');
}

/**
 * Component arms are frozen: every evaluator-owned object in a result is
 * immutable, and an arm is the smallest one.
 */
const componentOf = (value: number | undefined): BarrierComponentN =>
  value === undefined || !Number.isFinite(value)
    ? Object.freeze(
      { available: false as const, reason: 'outside-float64' as const })
    : Object.freeze({ available: true as const, value });

/**
 * Evaluates the compactly supported C2-clamped log barrier
 *
 *     E(x)  = -stiffness * (coordinate - activation)^2
 *              * log(coordinate / activation)
 *
 * on its open positive domain, to exactly the requested derivative order,
 * grading every requested component independently.
 *
 * **`order` is required.** A caller must say whether it needs the energy,
 * the force, or the curvature; there is no default and no way to receive a
 * derivative that was not requested. The requirement holds at runtime, not
 * only in the types: any `order` that is not strictly `0`, `1` or `2` —
 * including an omitted argument after type erasure — throws
 * `ClampedLogBarrierInputErrorN`. Order 0 performs 2 core operations,
 * order 1 performs 4, order 2 performs 7, and the inactive clamp performs 0.
 *
 * **Availability is per component and non-monotone.** An energy can round to
 * zero while its curvature is a healthy number; a curvature can overflow
 * while the energy is representable. Neither direction implies the other,
 * and no component is withheld because another was unavailable. A component
 * outside Float64 reports `{ available: false, reason: 'outside-float64' }`
 * with no value key.
 *
 * **A correctly rounded zero is an answer.** When the barrier is active and
 * a component's exact value rounds to Float64 zero, the component is
 * `{ available: true, value: 0 }` — published, never refused. `active` is
 * what separates that underflow statement from the clamp's exact zero.
 *
 * @example
 * The clamping is what makes the law usable: the energy is *exactly* zero at
 * and above `activation`, so a configuration that is not near contact is not
 * perturbed at all:
 * ```ts
 * const near = evaluateClampedLogBarrierAtOrderN(
 *   { coordinate: 0.01, activation: 0.1, stiffness: 1 }, 0);
 * near.active;              // true
 * near.energy;              // { available: true, value: 1.865e-2 }
 *
 * const clear = evaluateClampedLogBarrierAtOrderN(
 *   { coordinate: 0.2, activation: 0.1, stiffness: 1 }, 1);
 * clear.active;             // false — outside the support
 * clear.energy;             // { available: true, value: 0 } — exactly zero
 * clear.firstDerivative;    // { available: true, value: 0 } — no force either
 * ```
 *
 * @example
 * The domain is open at zero: contact itself has no finite energy, so a
 * non-positive coordinate is a permanent typed error rather than a large
 * number. Deep in the support, components leave Float64 one at a time:
 * ```ts
 * evaluateClampedLogBarrierAtOrderN(
 *   { coordinate: 0, activation: 0.1, stiffness: 1 }, 0);
 * // ClampedLogBarrierInputErrorN: coordinate must be finite and positive
 *
 * const graded = evaluateClampedLogBarrierAtOrderN(
 *   { coordinate: 1e-320, activation: 1e-300, stiffness: 1e300 }, 2);
 * graded.energy.available;           // true
 * graded.firstDerivative.available;  // true
 * graded.secondDerivative.available; // false — outside Float64, on its own
 * ```
 */
export function evaluateClampedLogBarrierAtOrderN<
  O extends BarrierDerivativeOrder
>(
  inputs: ClampedLogBarrierInputsN,
  order: O
): ClampedLogBarrierEvaluationForN<O> {
  if (typeof inputs !== 'object' || inputs === null) {
    throw new ClampedLogBarrierInputErrorN('inputs must be an object');
  }
  /**
   * ONE authoritative snapshot. Each scalar is read from the caller's object
   * exactly once, and this record is then the only input that is validated,
   * computed from, and published.
   *
   * Reading the caller's object more than once let the three answers
   * disagree. With an accessor- or Proxy-backed input the released v0.0.18
   * evaluator validated one value, computed from a second and published a
   * third, so `result.inputs` could carry a coordinate its own validation
   * forbids (P66E-PUB-S Part B). A getter is ordinary JavaScript, not an
   * attack: it is how lazy configuration, units wrappers and observable
   * models are written.
   *
   * A getter that THROWS is caller code, not a malformed number: that
   * exception escapes from here unchanged, before any validation, any
   * arithmetic, or any result object exists.
   */
  const record: ClampedLogBarrierInputsN = Object.freeze({
    coordinate: inputs.coordinate,
    activation: inputs.activation,
    stiffness: inputs.stiffness
  });
  // Scalar inputs first (their precedence predates the order guard), then
  // the order — both settled on the snapshot before any arithmetic runs or
  // any result object exists.
  validate(record);
  validateOrder(order);
  const core = evaluateBarrierCore(record, order);
  const value: ClampedLogBarrierValueN = Object.freeze({
    inputs: record, active: core.active, energy: componentOf(core.energy)
  });
  if (order === 0) return value as ClampedLogBarrierEvaluationForN<O>;
  const force: ClampedLogBarrierForceN = Object.freeze({
    ...value, firstDerivative: componentOf(core.firstDerivative)
  });
  if (order === 1) return force as ClampedLogBarrierEvaluationForN<O>;
  return Object.freeze({
    ...force, secondDerivative: componentOf(core.secondDerivative)
  }) as ClampedLogBarrierEvaluationForN<O>;
}
