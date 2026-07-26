import { VecN } from '@holotope/core';
import {
  XpbdIncrementalPotentialProblemN,
  type XpbdPackedIncrementalPotentialEvaluationN
} from './xpbd-incremental-potential-problem.js';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderEvaluationN,
  type XpbdConservativeForceProviderN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

const METHOD = 'analytic-provider-composition' as const;

/** Candidate-direction lookup paired with a particle-identity query. */
export type XpbdParticleDirectionQueryN = (
  particle: XpbdParticleN
) => VecN;

/** Mathematical potential Hessian-vector products in provider particle order. */
export interface XpbdConservativeHessianVectorEvaluationN {
  /** `products[i] = Hessian(U) * direction` for `particles[i]`. */
  readonly products: readonly VecN[];
}

/** Optional exact curvature capability of a conservative RN provider. */
export interface XpbdConservativeHessianVectorProviderN
  extends XpbdConservativeForceProviderN {
  /** Stable identity shared by force and curvature evidence. */
  readonly id: string;
  /** Ambient Euclidean dimension of every provider vector. */
  readonly dimension: number;
  /** Authored particle order shared by forces and curvature products. */
  readonly particles: readonly XpbdParticleN[];
  /** Evaluates live-state energy and forces through the base provider seam. */
  evaluate(): XpbdConservativeForceProviderEvaluationN;
  /** Evaluates candidate-state energy and forces without live-state writes. */
  evaluateAt(
    positionOf: XpbdParticlePositionQueryN
  ): XpbdConservativeForceProviderEvaluationN;
  /**
   * Evaluates the mathematical potential Hessian along one candidate direction.
   *
   * The returned sign is `Hessian(U) * direction`, not the derivative of the
   * provider force `-gradient(U)`.
   */
  evaluatePotentialHessianVectorAt(
    positionOf: XpbdParticlePositionQueryN,
    directionOf: XpbdParticleDirectionQueryN
  ): XpbdConservativeHessianVectorEvaluationN;
}

/** One validated provider contribution to an analytic global product. */
export interface XpbdConservativeHessianVectorProviderResultN {
  /** Exact capable provider that produced the local products. */
  readonly provider: XpbdConservativeHessianVectorProviderN;
  /** Defensive finite copy of its returned product evidence. */
  readonly evaluation: XpbdConservativeHessianVectorEvaluationN;
}

/** Options for exact composition over a compiled incremental objective. */
export interface EvaluateXpbdIncrementalPotentialAnalyticHessianVectorNOptions {
  /** Compiled objective whose provider set defines analytic completeness. */
  readonly problem: XpbdIncrementalPotentialProblemN;
  /** Packed free-particle coordinates at the evaluation point. */
  readonly coordinates: ArrayLike<number>;
  /** Packed free-particle direction multiplied by the objective Hessian. */
  readonly direction: ArrayLike<number>;
}

interface XpbdIncrementalPotentialAnalyticHessianVectorBaseN {
  /** Exact construction attempted by this result. */
  readonly method: typeof METHOD;
  /** Valid complete objective evidence at the unperturbed coordinates. */
  readonly base: XpbdPackedIncrementalPotentialEvaluationN;
  /** Defensive copy of the packed direction. */
  readonly direction: Float64Array;
}

/** Complete exact analytic product for the compiled provider mixture. */
export interface XpbdIncrementalPotentialAnalyticHessianVectorEvaluatedN
  extends XpbdIncrementalPotentialAnalyticHessianVectorBaseN {
  /** Confirms that every conservative provider supplied analytic products. */
  readonly status: 'evaluated';
  /** Packed exact mass-block product before conservative curvature. */
  readonly inertialProduct: Float64Array;
  /**
   * Unscaled potential products in complete authored particle order.
   *
   * Fixed-particle entries retain reaction curvature even though they occupy
   * no packed free coordinate.
   */
  readonly potentialProducts: readonly VecN[];
  /** Packed free potential product after multiplication by `deltaTime²`. */
  readonly scaledPotentialProduct: Float64Array;
  /** Complete packed incremental-objective Hessian-vector product. */
  readonly product: Float64Array;
  /** Directional curvature `directionᵀ * product`. */
  readonly quadraticForm: number;
  /** Provider-local product evidence in authored provider order. */
  readonly providers: readonly XpbdConservativeHessianVectorProviderResultN[];
}

/** Exact zero product that requires no provider curvature capability. */
export interface XpbdIncrementalPotentialAnalyticHessianVectorZeroDirectionN
  extends XpbdIncrementalPotentialAnalyticHessianVectorBaseN {
  /** Confirms that the packed direction is exactly zero. */
  readonly status: 'zero-direction';
  /** Exact all-zero product with the compiled packed length. */
  readonly product: Float64Array;
  /** Exact zero directional curvature. */
  readonly quadraticForm: 0;
}

/** Explicit refusal when a nonzero query has incomplete analytic coverage. */
export interface XpbdIncrementalPotentialAnalyticHessianVectorUnsupportedN
  extends XpbdIncrementalPotentialAnalyticHessianVectorBaseN {
  /** Distinguishes absent provider capability from arithmetic failure. */
  readonly status: 'unsupported-provider';
  /** Every incapable provider id in authored provider order. */
  readonly providerIds: readonly string[];
}

/** Evidence from exact analytic curvature composition or explicit refusal. */
export type XpbdIncrementalPotentialAnalyticHessianVectorResultN =
  | XpbdIncrementalPotentialAnalyticHessianVectorEvaluatedN
  | XpbdIncrementalPotentialAnalyticHessianVectorZeroDirectionN
  | XpbdIncrementalPotentialAnalyticHessianVectorUnsupportedN;

/**
 * Composes an exact incremental-potential Hessian-vector product when complete.
 *
 * The inertial contribution is the exact diagonal mass block. Conservative
 * products are assembled by particle identity and scaled by `deltaTime²`.
 * A nonzero query is evaluated only when every provider implements
 * `XpbdConservativeHessianVectorProviderN`; otherwise all missing provider ids
 * are returned before any partial analytic product is requested.
 *
 * The routine neither modifies definiteness nor constructs a matrix. Invalid
 * base states, malformed provider evidence, ordinary provider failures, and
 * Float64 overflow remain errors.
 */
export function evaluateXpbdIncrementalPotentialAnalyticHessianVectorN(
  options: EvaluateXpbdIncrementalPotentialAnalyticHessianVectorNOptions
): XpbdIncrementalPotentialAnalyticHessianVectorResultN {
  const caller =
    'evaluateXpbdIncrementalPotentialAnalyticHessianVectorN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  if (!(options.problem instanceof XpbdIncrementalPotentialProblemN)) {
    throw new Error(
      `${caller}: problem must be an XpbdIncrementalPotentialProblemN`
    );
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
  const base = options.problem.evaluate(coordinates);
  if (isZero(direction)) {
    return Object.freeze({
      status: 'zero-direction',
      method: METHOD,
      base,
      direction,
      product: new Float64Array(options.problem.variableCount),
      quadraticForm: 0
    });
  }

  const unsupported = options.problem.providers
    .filter((provider) => !isHessianVectorProvider(provider))
    .map((provider) => provider.id);
  if (unsupported.length > 0) {
    return Object.freeze({
      status: 'unsupported-provider',
      method: METHOD,
      base,
      direction,
      providerIds: Object.freeze(unsupported)
    });
  }

  const particleIndices = new Map<XpbdParticleN, number>();
  for (let index = 0; index < options.problem.particles.length; index++) {
    particleIndices.set(options.problem.particles[index]!, index);
  }
  const particleDirections = options.problem.particles.map(
    () => new VecN(options.problem.dimension)
  );
  let packedOffset = 0;
  for (const particleIndex of options.problem.freeParticleIndices) {
    particleDirections[particleIndex]!.data.set(
      direction.subarray(
        packedOffset,
        packedOffset + options.problem.dimension
      )
    );
    packedOffset += options.problem.dimension;
  }
  const positionOf: XpbdParticlePositionQueryN = (particle) => {
    const index = particleIndices.get(particle);
    if (index === undefined) {
      throw new Error(`${caller}: provider requested a foreign particle`);
    }
    return base.positions[index]!.clone();
  };
  const directionOf: XpbdParticleDirectionQueryN = (particle) => {
    const index = particleIndices.get(particle);
    if (index === undefined) {
      throw new Error(`${caller}: provider requested a foreign particle`);
    }
    return particleDirections[index]!.clone();
  };

  const potentialProducts = options.problem.particles.map(
    () => new VecN(options.problem.dimension)
  );
  const providerResults: XpbdConservativeHessianVectorProviderResultN[] = [];
  for (const provider of options.problem.providers) {
    if (!isHessianVectorProvider(provider)) {
      throw new Error(`${caller}: provider capability changed during evaluation`);
    }
    const evaluation = validateProviderEvaluation(
      provider.evaluatePotentialHessianVectorAt(positionOf, directionOf),
      provider,
      options.problem.dimension,
      caller
    );
    for (let local = 0; local < provider.particles.length; local++) {
      const particleIndex = particleIndices.get(provider.particles[local]!)!;
      const assembled = potentialProducts[particleIndex]!;
      assembled.add(evaluation.products[local]!);
      assertFiniteVector(
        assembled,
        `${caller}: assembled potential product`
      );
    }
    providerResults.push(Object.freeze({ provider, evaluation }));
  }

  const inertialProduct = new Float64Array(options.problem.variableCount);
  const scaledPotentialProduct =
    new Float64Array(options.problem.variableCount);
  const product = new Float64Array(options.problem.variableCount);
  const deltaTimeSquared =
    options.problem.deltaTime * options.problem.deltaTime;
  if (!Number.isFinite(deltaTimeSquared)) {
    throw new Error(`${caller}: squared deltaTime is outside Float64`);
  }
  packedOffset = 0;
  let quadraticForm = 0;
  for (const particleIndex of options.problem.freeParticleIndices) {
    const mass = 1 / options.problem.particles[particleIndex]!.inverseMass;
    if (!Number.isFinite(mass)) {
      throw new Error(`${caller}: particle mass is outside Float64`);
    }
    for (let axis = 0; axis < options.problem.dimension; axis++) {
      const directionValue = direction[packedOffset]!;
      const inertialValue = mass * directionValue;
      const scaledPotentialValue =
        deltaTimeSquared *
        potentialProducts[particleIndex]!.data[axis]!;
      const value = inertialValue + scaledPotentialValue;
      if (!Number.isFinite(inertialValue) ||
        !Number.isFinite(scaledPotentialValue) ||
        !Number.isFinite(value)) {
        throw new Error(`${caller}: packed product is outside Float64`);
      }
      inertialProduct[packedOffset] = inertialValue;
      scaledPotentialProduct[packedOffset] = scaledPotentialValue;
      product[packedOffset] = value;
      quadraticForm += directionValue * value;
      if (!Number.isFinite(quadraticForm)) {
        throw new Error(`${caller}: quadratic form is outside Float64`);
      }
      packedOffset++;
    }
  }

  return Object.freeze({
    status: 'evaluated',
    method: METHOD,
    base,
    direction,
    inertialProduct,
    potentialProducts: Object.freeze(potentialProducts),
    scaledPotentialProduct,
    product,
    quadraticForm,
    providers: Object.freeze(providerResults)
  });
}

function isHessianVectorProvider(
  provider: XpbdConservativeForceProviderN
): provider is XpbdConservativeHessianVectorProviderN {
  return typeof (
    provider as Partial<XpbdConservativeHessianVectorProviderN>
  ).evaluatePotentialHessianVectorAt === 'function';
}

function validateProviderEvaluation(
  evaluation: XpbdConservativeHessianVectorEvaluationN,
  provider: XpbdConservativeHessianVectorProviderN,
  dimension: number,
  caller: string
): XpbdConservativeHessianVectorEvaluationN {
  if (typeof evaluation !== 'object' || evaluation === null) {
    throw new Error(
      `${caller}: provider "${provider.id}" returned no curvature evaluation`
    );
  }
  if (!Array.isArray(evaluation.products) ||
    evaluation.products.length !== provider.particles.length) {
    throw new Error(
      `${caller}: provider "${provider.id}" product count mismatch`
    );
  }
  const products = evaluation.products.map((product, index) => {
    if (!(product instanceof VecN) || product.dim !== dimension) {
      throw new Error(
        `${caller}: provider "${provider.id}" product ${index} must be R${dimension}`
      );
    }
    assertFiniteVector(
      product,
      `${caller}: provider "${provider.id}" product ${index}`
    );
    return product.clone();
  });
  return Object.freeze({
    ...evaluation,
    products: Object.freeze(products)
  });
}

function assertFiniteVector(vector: VecN, label: string): void {
  for (const coordinate of vector.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${label} must be finite`);
    }
  }
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

function isZero(value: ArrayLike<number>): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== 0) return false;
  }
  return true;
}
