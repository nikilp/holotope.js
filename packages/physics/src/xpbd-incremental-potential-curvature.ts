import {
  XpbdIncrementalPotentialProblemN,
  type XpbdPackedIncrementalPotentialEvaluationN
} from './xpbd-incremental-potential-problem.js';
import {
  XpbdPotentialDomainErrorN
} from './xpbd-potential-domain.js';

const METHOD = 'centered-gradient-difference' as const;

/** Options for one matrix-free incremental-potential curvature estimate. */
export interface EstimateXpbdIncrementalPotentialHessianVectorNOptions {
  /** Compiled particle-identity objective to differentiate. */
  readonly problem: XpbdIncrementalPotentialProblemN;
  /** Packed free-particle coordinates at the differentiation point. */
  readonly coordinates: ArrayLike<number>;
  /** Packed direction multiplied by the objective Hessian. */
  readonly direction: ArrayLike<number>;
  /**
   * Positive parameter-space probe step.
   *
   * The physical coordinate perturbation is `stepSize * direction`. When
   * omitted, a deterministic scale-relative `cbrt(Number.EPSILON)` step is
   * chosen.
   */
  readonly stepSize?: number;
}

/** Typed mathematical-domain refusal encountered by one signed probe. */
export interface XpbdIncrementalPotentialHessianVectorDomainRefusalN {
  /** Stable identifier of the potential law or provider. */
  readonly lawId: string;
  /** Machine-readable reason within that law's domain vocabulary. */
  readonly reason: string;
  /** Human-readable explanation of the refused candidate. */
  readonly message: string;
}

interface XpbdIncrementalPotentialHessianVectorBaseN {
  /** Differential construction used for this result. */
  readonly method: typeof METHOD;
  /** Valid objective and gradient at the unperturbed coordinates. */
  readonly base: XpbdPackedIncrementalPotentialEvaluationN;
  /** Defensive copy of the packed input direction. */
  readonly direction: Float64Array;
}

/** Successful centered matrix-free Hessian-vector estimate. */
export interface XpbdIncrementalPotentialHessianVectorEvaluatedN
  extends XpbdIncrementalPotentialHessianVectorBaseN {
  /** Confirms that both signed probes produced finite objective gradients. */
  readonly status: 'evaluated';
  /** Positive parameter-space step used for both signed probes. */
  readonly stepSize: number;
  /** Objective evidence at `coordinates + stepSize * direction`. */
  readonly plus: XpbdPackedIncrementalPotentialEvaluationN;
  /** Objective evidence at `coordinates - stepSize * direction`. */
  readonly minus: XpbdPackedIncrementalPotentialEvaluationN;
  /** Centered estimate of `H(coordinates) * direction`. */
  readonly product: Float64Array;
  /** Directional curvature `directionᵀ * product`. */
  readonly quadraticForm: number;
}

/** Exact zero curvature product for a zero packed direction. */
export interface XpbdIncrementalPotentialHessianVectorZeroDirectionN
  extends XpbdIncrementalPotentialHessianVectorBaseN {
  /** Confirms that no offset probes were needed for the zero direction. */
  readonly status: 'zero-direction';
  /** Exact all-zero product with the compiled problem's packed length. */
  readonly product: Float64Array;
  /** Exact zero directional curvature. */
  readonly quadraticForm: 0;
}

/** Recoverable typed refusal from one signed curvature probe. */
export interface XpbdIncrementalPotentialHessianVectorProbeRefusedN
  extends XpbdIncrementalPotentialHessianVectorBaseN {
  /** Reports a typed open-domain refusal rather than a numeric product. */
  readonly status: 'probe-refused';
  /** Positive parameter-space step requested for the centered estimate. */
  readonly stepSize: number;
  /** Signed probe that left a potential's open mathematical domain. */
  readonly side: 'plus' | 'minus';
  /** Typed refusal supplied by the potential law. */
  readonly refusal: XpbdIncrementalPotentialHessianVectorDomainRefusalN;
  /** Valid plus evidence retained when only the minus probe was refused. */
  readonly plus?: XpbdPackedIncrementalPotentialEvaluationN;
}

/** Float64 refusal when a requested nonzero displacement is unrepresentable. */
export interface XpbdIncrementalPotentialHessianVectorIndeterminateN
  extends XpbdIncrementalPotentialHessianVectorBaseN {
  /** Reports that Float64 could not realize the requested centered probes. */
  readonly status: 'indeterminate';
  /** Stable refusal vocabulary for a rounded-away coordinate displacement. */
  readonly reason: 'coordinate-resolution';
  /** Positive parameter-space step requested for the centered estimate. */
  readonly stepSize: number;
  /** First packed component whose signed displacement rounded away. */
  readonly coordinateIndex: number;
}

/** Evidence returned by the matrix-free curvature reference. */
export type XpbdIncrementalPotentialHessianVectorResultN =
  | XpbdIncrementalPotentialHessianVectorEvaluatedN
  | XpbdIncrementalPotentialHessianVectorZeroDirectionN
  | XpbdIncrementalPotentialHessianVectorProbeRefusedN
  | XpbdIncrementalPotentialHessianVectorIndeterminateN;

/**
 * Estimates one incremental-potential Hessian-vector product without assembly.
 *
 * The reference evaluates
 * `[gradient(x + h v) - gradient(x - h v)] / (2 h)`. It is intended as a
 * deterministic Float64 oracle for analytic, assembled, GPU, and solver paths;
 * it is not a promise that the estimate is positive semidefinite.
 *
 * A typed potential-domain error from an offset probe is returned as
 * `probe-refused`. A typed refusal at the base point, an ordinary provider
 * error, or a non-finite result remains fatal.
 */
export function estimateXpbdIncrementalPotentialHessianVectorN(
  options: EstimateXpbdIncrementalPotentialHessianVectorNOptions
): XpbdIncrementalPotentialHessianVectorResultN {
  const caller = 'estimateXpbdIncrementalPotentialHessianVectorN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  if (!(options.problem instanceof XpbdIncrementalPotentialProblemN)) {
    throw new Error(
      `${caller}: problem must be an XpbdIncrementalPotentialProblemN`
    );
  }
  if (options.stepSize !== undefined &&
    (!(options.stepSize > 0) || !Number.isFinite(options.stepSize))) {
    throw new Error(`${caller}: stepSize must be finite and positive`);
  }

  const coordinates = finiteCoordinates(
    options.coordinates,
    options.problem.variableCount,
    `${caller}: coordinates`
  );
  const direction = finiteCoordinates(
    options.direction,
    options.problem.variableCount,
    `${caller}: direction`
  );

  // An invalid base point is not a recoverable differentiation probe.
  const base = options.problem.evaluate(coordinates);
  const directionNorm = euclideanNorm(direction);
  if (directionNorm === 0) {
    return Object.freeze({
      status: 'zero-direction',
      method: METHOD,
      base,
      direction,
      product: new Float64Array(options.problem.variableCount),
      quadraticForm: 0
    });
  }

  const coordinateNorm = euclideanNorm(coordinates);
  const stepSize = options.stepSize ??
    Math.cbrt(Number.EPSILON) *
      (Math.max(1, coordinateNorm) / directionNorm);
  if (!(stepSize > 0) || !Number.isFinite(stepSize)) {
    throw new Error(
      `${caller}: default stepSize is outside Float64; provide stepSize`
    );
  }

  const plusCoordinates = new Float64Array(coordinates.length);
  const minusCoordinates = new Float64Array(coordinates.length);
  for (let index = 0; index < coordinates.length; index++) {
    const coordinate = coordinates[index]!;
    const displacement = stepSize * direction[index]!;
    const plus = coordinate + displacement;
    const minus = coordinate - displacement;
    if (!Number.isFinite(displacement) ||
      !Number.isFinite(plus) ||
      !Number.isFinite(minus)) {
      throw new Error(`${caller}: probe coordinate is outside Float64`);
    }
    plusCoordinates[index] = plus;
    minusCoordinates[index] = minus;
    if (direction[index] !== 0 &&
      (plus === coordinate || minus === coordinate || plus === minus)) {
      return Object.freeze({
        status: 'indeterminate',
        reason: 'coordinate-resolution',
        method: METHOD,
        base,
        direction,
        stepSize,
        coordinateIndex: index
      });
    }
  }

  let plus: XpbdPackedIncrementalPotentialEvaluationN;
  try {
    plus = options.problem.evaluate(plusCoordinates);
  } catch (error) {
    if (!(error instanceof XpbdPotentialDomainErrorN)) throw error;
    return Object.freeze({
      status: 'probe-refused',
      method: METHOD,
      base,
      direction,
      stepSize,
      side: 'plus',
      refusal: domainRefusal(error)
    });
  }

  let minus: XpbdPackedIncrementalPotentialEvaluationN;
  try {
    minus = options.problem.evaluate(minusCoordinates);
  } catch (error) {
    if (!(error instanceof XpbdPotentialDomainErrorN)) throw error;
    return Object.freeze({
      status: 'probe-refused',
      method: METHOD,
      base,
      direction,
      stepSize,
      side: 'minus',
      refusal: domainRefusal(error),
      plus
    });
  }

  const product = new Float64Array(options.problem.variableCount);
  const denominator = 2 * stepSize;
  let quadraticForm = 0;
  for (let index = 0; index < product.length; index++) {
    const value =
      (plus.gradient[index]! - minus.gradient[index]!) / denominator;
    if (!Number.isFinite(value)) {
      throw new Error(`${caller}: Hessian-vector product is outside Float64`);
    }
    product[index] = value;
    quadraticForm += direction[index]! * value;
    if (!Number.isFinite(quadraticForm)) {
      throw new Error(`${caller}: quadratic form is outside Float64`);
    }
  }

  return Object.freeze({
    status: 'evaluated',
    method: METHOD,
    base,
    direction,
    stepSize,
    plus,
    minus,
    product,
    quadraticForm
  });
}

function domainRefusal(
  error: XpbdPotentialDomainErrorN
): XpbdIncrementalPotentialHessianVectorDomainRefusalN {
  return Object.freeze({
    lawId: error.lawId,
    reason: error.reason,
    message: error.message
  });
}

function finiteCoordinates(
  value: ArrayLike<number>,
  expectedLength: number,
  label: string
): Float64Array {
  if (value === null || value === undefined ||
    typeof value.length !== 'number' ||
    value.length !== expectedLength) {
    throw new Error(`${label} must have length ${expectedLength}`);
  }
  const result = new Float64Array(expectedLength);
  for (let index = 0; index < expectedLength; index++) {
    const coordinate = value[index];
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${label}[${index}] must be finite`);
    }
    result[index] = coordinate!;
  }
  return result;
}

function euclideanNorm(value: ArrayLike<number>): number {
  let norm = 0;
  for (let index = 0; index < value.length; index++) {
    norm = Math.hypot(norm, value[index]!);
  }
  return norm;
}
