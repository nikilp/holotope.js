import {
  MatN,
  VecN,
  symmetricEigenDecomposition
} from '@holotope/core';
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
import type {
  XpbdConservativeCurvatureApplicationN,
  XpbdConservativeExactCurvatureApplicationN,
  XpbdConservativePsdBlockApplicationN,
  XpbdConservativeProviderBlockPsdApplicationN,
  XpbdConservativeProviderLocalPsdApplicationN,
  XpbdIncrementalPotentialCurvaturePolicyKindN,
  XpbdIncrementalPotentialCurvaturePolicyN,
  XpbdProviderBlockPsdCurvaturePolicyN,
  XpbdProviderLocalPsdCurvaturePolicyN
} from './xpbd-incremental-potential-curvature-policy.js';

const METHOD = 'analytic-provider-composition' as const;
const DEFAULT_SYMMETRY_TOLERANCE = 1e-12;
const DEFAULT_DECOMPOSITION_TOLERANCE = 1e-10;
const DEFAULT_EIGENSOLVER_TOLERANCE = 1e-12;
const DEFAULT_EIGENSOLVER_MAXIMUM_SWEEPS = 64;

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

/** One exact additive block of a conservative provider Hessian. */
export interface XpbdConservativeHessianBlockN {
  /** Stable identity unique within the owning provider. */
  readonly id: string;
  /** Non-empty provider-particle subset in block product order. */
  readonly particles: readonly XpbdParticleN[];
}

/**
 * Optional exact additive decomposition of one analytic provider Hessian.
 *
 * The aggregate HVP remains authoritative. Block products must sum to it by
 * particle identity; blocks may overlap in particles.
 */
export interface XpbdConservativeHessianBlockProviderN
  extends XpbdConservativeHessianVectorProviderN {
  /** Deterministic authored block order. */
  readonly potentialHessianBlocks:
    readonly XpbdConservativeHessianBlockN[];
  /** Evaluates one exact block contribution at a candidate state. */
  evaluatePotentialHessianBlockVectorAt(
    block: XpbdConservativeHessianBlockN,
    positionOf: XpbdParticlePositionQueryN,
    directionOf: XpbdParticleDirectionQueryN
  ): XpbdConservativeHessianVectorEvaluationN;
}

/** One validated provider contribution to an analytic global product. */
export interface XpbdConservativeHessianVectorProviderResultN {
  /** Analytic-capable provider that produced the local products. */
  readonly provider: XpbdConservativeHessianVectorProviderN;
  /** Defensive finite copy of the selected local product. */
  readonly evaluation: XpbdConservativeHessianVectorEvaluationN;
  /** Whether exact or explicitly projected curvature supplied the product. */
  readonly curvature: XpbdConservativeCurvatureApplicationN;
}

/** Options for analytic composition over a compiled incremental objective. */
export interface EvaluateXpbdIncrementalPotentialAnalyticHessianVectorNOptions {
  /** Compiled objective whose provider set defines analytic completeness. */
  readonly problem: XpbdIncrementalPotentialProblemN;
  /** Packed free-particle coordinates at the evaluation point. */
  readonly coordinates: ArrayLike<number>;
  /** Packed free-particle direction multiplied by the objective Hessian. */
  readonly direction: ArrayLike<number>;
  /**
   * Exact Hessians by default, or an explicit dense PSD projection boundary.
   *
   * Provider-local PSD uses one complete provider block. Provider-block PSD
   * uses exact declared blocks where available and an evidenced implicit
   * provider block otherwise. Both are auditable CPU references with cubic
   * block-local cost.
   */
  readonly curvaturePolicy?: XpbdIncrementalPotentialCurvaturePolicyN;
}

interface XpbdIncrementalPotentialAnalyticHessianVectorBaseN {
  /** Exact construction attempted by this result. */
  readonly method: typeof METHOD;
  /** Valid complete objective evidence at the unperturbed coordinates. */
  readonly base: XpbdPackedIncrementalPotentialEvaluationN;
  /** Defensive copy of the packed direction. */
  readonly direction: Float64Array;
  /** Normalized exact or explicitly projected policy used by this query. */
  readonly curvaturePolicy: XpbdIncrementalPotentialCurvaturePolicyKindN;
}

/** Complete analytic product for the compiled provider mixture. */
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
  /** Provider product and curvature-policy evidence in authored order. */
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
 * Composes an analytic incremental-potential Hessian-vector product.
 *
 * The inertial contribution is the exact diagonal mass block. Conservative
 * products are assembled by particle identity and scaled by `deltaTime²`.
 * A nonzero query is evaluated only when every provider implements
 * `XpbdConservativeHessianVectorProviderN`; otherwise all missing provider ids
 * are returned before any partial analytic product is requested.
 *
 * Exact curvature is the default and neither modifies definiteness nor
 * constructs a matrix. Explicit PSD policies reconstruct either one complete
 * provider matrix or provider-declared additive blocks, audit them, and clamp
 * negative eigenvalues to zero. These are auditable CPU modified-Newton
 * references, not sparse production paths.
 *
 * Invalid base states, malformed provider evidence, ordinary provider
 * failures, asymmetric claimed Hessians, and Float64 overflow remain errors.
 *
 * `estimateXpbdIncrementalPotentialHessianVectorN` computes the same product
 * by differencing the gradient, and is the oracle this path is checked
 * against: it needs no provider capability and so is always available, while
 * this one is exact but only when every provider can answer.
 *
 * @example
 * The same product, both ways. The analytic composition and the centered
 * difference agree to differencing accuracy, which is what makes either
 * usable as a check on the other:
 * ```ts
 * const particle = new XpbdParticleN({ id: 'p', position: new VecN([0, 0.3, 0]) });
 * const barrier = new XpbdParticleHyperplaneBarrierN({
 *   id: 'floor',
 *   particle,
 *   plane: new HyperplaneColliderN(new VecN([0, 1, 0]), 0),
 *   activationDistance: 0.5,
 *   stiffness: 1
 * });
 * const problem = compileXpbdIncrementalPotentialProblemN({
 *   dimension: 3,
 *   particles: [particle],
 *   predictedPositions: [new VecN([0, 0.3, 0])],
 *   deltaTime: 1 / 60,
 *   providers: [barrier]
 * });
 * const coordinates = [0, 0.3, 0];
 * const direction = [0, 1, 0];
 *
 * const exact = evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
 *   problem, coordinates, direction
 * });
 * const oracle = estimateXpbdIncrementalPotentialHessianVectorN({
 *   problem, coordinates, direction
 * });
 *
 * exact.method; // 'analytic-provider-composition'
 * oracle.method; // 'centered-gradient-difference'
 * // vᵀHv: 1.0011479895440676 against 1.0011479895405937 — 3.5e-12 apart
 * ```
 *
 * @example
 * The evidence separates where the curvature came from. At a sixtieth of a
 * second the mass block dominates, and the barrier enters scaled by
 * `deltaTime²` — which is why the total sits just above one rather than
 * being of the barrier's own magnitude:
 * ```ts
 * const particle = new XpbdParticleN({ id: 'p', position: new VecN([0, 0.3, 0]) });
 * const barrier = new XpbdParticleHyperplaneBarrierN({
 *   id: 'floor',
 *   particle,
 *   plane: new HyperplaneColliderN(new VecN([0, 1, 0]), 0),
 *   activationDistance: 0.5,
 *   stiffness: 1
 * });
 * const problem = compileXpbdIncrementalPotentialProblemN({
 *   dimension: 3,
 *   particles: [particle],
 *   predictedPositions: [new VecN([0, 0.3, 0])],
 *   deltaTime: 1 / 60,
 *   providers: [barrier]
 * });
 *
 * const result = evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
 *   problem, coordinates: [0, 0.3, 0], direction: [0, 1, 0]
 * });
 *
 * if (result.status === 'evaluated') {
 *   Array.from(result.inertialProduct); // [0, 1, 0] — the exact mass block
 *   Array.from(result.scaledPotentialProduct); // [0, 1.14799e-3, 0]
 *   Array.from(result.product); // their sum, to the last bit
 * }
 * ```
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
  const curvature = normalizeXpbdIncrementalPotentialCurvaturePolicyN(
    options.curvaturePolicy,
    caller
  );
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
      curvaturePolicy: curvature.kind,
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
      curvaturePolicy: curvature.kind,
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
    const selected = evaluateProviderCurvature(
      provider,
      positionOf,
      directionOf,
      options.problem.dimension,
      curvature,
      caller
    );
    const evaluation = selected.evaluation;
    for (let local = 0; local < provider.particles.length; local++) {
      const particleIndex = particleIndices.get(provider.particles[local]!)!;
      const assembled = potentialProducts[particleIndex]!;
      assembled.add(evaluation.products[local]!);
      assertFiniteVector(
        assembled,
        `${caller}: assembled potential product`
      );
    }
    providerResults.push(Object.freeze({
      provider,
      evaluation,
      curvature: selected.curvature
    }));
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
    curvaturePolicy: curvature.kind,
    inertialProduct,
    potentialProducts: Object.freeze(potentialProducts),
    scaledPotentialProduct,
    product,
    quadraticForm,
    providers: Object.freeze(providerResults)
  });
}

interface NormalizedExactCurvaturePolicyN {
  readonly kind: 'exact';
}

type NormalizedProviderLocalPsdCurvaturePolicyN =
  Required<XpbdProviderLocalPsdCurvaturePolicyN>;

type NormalizedProviderBlockPsdCurvaturePolicyN =
  Required<XpbdProviderBlockPsdCurvaturePolicyN>;

type NormalizedXpbdIncrementalPotentialCurvaturePolicyN =
  | NormalizedExactCurvaturePolicyN
  | NormalizedProviderLocalPsdCurvaturePolicyN
  | NormalizedProviderBlockPsdCurvaturePolicyN;

interface SelectedExactProviderCurvatureN {
  readonly evaluation: XpbdConservativeHessianVectorEvaluationN;
  readonly curvature: XpbdConservativeExactCurvatureApplicationN;
}

interface SelectedProviderLocalPsdCurvatureN {
  readonly evaluation: XpbdConservativeHessianVectorEvaluationN;
  readonly curvature: XpbdConservativeProviderLocalPsdApplicationN;
}

interface SelectedProviderBlockPsdCurvatureN {
  readonly evaluation: XpbdConservativeHessianVectorEvaluationN;
  readonly curvature: XpbdConservativeProviderBlockPsdApplicationN;
}

type SelectedProviderCurvatureN =
  | SelectedExactProviderCurvatureN
  | SelectedProviderLocalPsdCurvatureN
  | SelectedProviderBlockPsdCurvatureN;

export function normalizeXpbdIncrementalPotentialCurvaturePolicyN(
  policy: XpbdIncrementalPotentialCurvaturePolicyN | undefined,
  caller: string
): NormalizedXpbdIncrementalPotentialCurvaturePolicyN {
  if (policy === undefined || policy === 'exact') {
    return Object.freeze({ kind: 'exact' });
  }
  if (typeof policy !== 'object' || policy === null ||
    (policy.kind !== 'provider-local-psd' &&
      policy.kind !== 'provider-block-psd')) {
    throw new Error(
      `${caller}: curvaturePolicy must be "exact", ` +
        `{ kind: "provider-local-psd" }, or ` +
        `{ kind: "provider-block-psd" }`
    );
  }
  const symmetryTolerance =
    policy.symmetryTolerance ?? DEFAULT_SYMMETRY_TOLERANCE;
  const eigensolverTolerance =
    policy.eigensolverTolerance ?? DEFAULT_EIGENSOLVER_TOLERANCE;
  const eigensolverMaximumSweeps =
    policy.eigensolverMaximumSweeps ??
    DEFAULT_EIGENSOLVER_MAXIMUM_SWEEPS;
  validatePositiveFinite(
    symmetryTolerance,
    `${caller}: curvaturePolicy.symmetryTolerance`
  );
  validatePositiveFinite(
    eigensolverTolerance,
    `${caller}: curvaturePolicy.eigensolverTolerance`
  );
  if (!Number.isSafeInteger(eigensolverMaximumSweeps) ||
    eigensolverMaximumSweeps < 1) {
    throw new Error(
      `${caller}: curvaturePolicy.eigensolverMaximumSweeps must be a ` +
        `positive integer`
    );
  }
  if (policy.kind === 'provider-block-psd') {
    const decompositionTolerance =
      policy.decompositionTolerance ?? DEFAULT_DECOMPOSITION_TOLERANCE;
    validatePositiveFinite(
      decompositionTolerance,
      `${caller}: curvaturePolicy.decompositionTolerance`
    );
    return Object.freeze({
      kind: 'provider-block-psd',
      symmetryTolerance,
      decompositionTolerance,
      eigensolverTolerance,
      eigensolverMaximumSweeps
    });
  }
  return Object.freeze({
    kind: 'provider-local-psd',
    symmetryTolerance,
    eigensolverTolerance,
    eigensolverMaximumSweeps
  });
}

function evaluateProviderCurvature(
  provider: XpbdConservativeHessianVectorProviderN,
  positionOf: XpbdParticlePositionQueryN,
  directionOf: XpbdParticleDirectionQueryN,
  dimension: number,
  policy: NormalizedXpbdIncrementalPotentialCurvaturePolicyN,
  caller: string
): SelectedProviderCurvatureN {
  if (policy.kind === 'exact') {
    return Object.freeze({
      evaluation: validateProviderEvaluation(
        provider.evaluatePotentialHessianVectorAt(positionOf, directionOf),
        provider,
        dimension,
        caller
      ),
      curvature: Object.freeze({
        kind: 'exact',
        operatorEvaluations: 1
      })
    });
  }

  if (policy.kind === 'provider-block-psd') {
    return evaluateProviderBlockPsdCurvature(
      provider,
      positionOf,
      directionOf,
      dimension,
      policy,
      caller
    );
  }

  const projected = projectHessianBlock({
    block: Object.freeze({
      id: provider.id,
      particles: provider.particles
    }),
    dimension,
    directionOf,
    evaluate: (basisDirectionOf) =>
      validateProviderEvaluation(
        provider.evaluatePotentialHessianVectorAt(
          positionOf,
          basisDirectionOf
        ),
        provider,
        dimension,
        caller
      ),
    symmetryTolerance: policy.symmetryTolerance,
    eigensolverTolerance: policy.eigensolverTolerance,
    eigensolverMaximumSweeps: policy.eigensolverMaximumSweeps,
    caller: `${caller}: provider "${provider.id}"`
  });
  return Object.freeze({
    evaluation: Object.freeze({
      products: projected.projectedProducts
    }),
    curvature: Object.freeze({
      kind: 'provider-local-psd',
      localVariableCount: projected.evidence.localVariableCount,
      operatorEvaluations: projected.evidence.operatorEvaluations,
      rawEigenvalues: projected.evidence.rawEigenvalues,
      projectedEigenvalues: projected.evidence.projectedEigenvalues,
      clippedEigenvalueCount: projected.evidence.clippedEigenvalueCount,
      relativeSymmetryError: projected.evidence.relativeSymmetryError,
      eigensystemMaxResidual:
        projected.evidence.eigensystemMaxResidual,
      eigensystemOrthogonalityError:
        projected.evidence.eigensystemOrthogonalityError
    })
  });
}

interface ProjectHessianBlockOptionsN {
  readonly block: XpbdConservativeHessianBlockN;
  readonly dimension: number;
  readonly directionOf: XpbdParticleDirectionQueryN;
  readonly evaluate: (
    directionOf: XpbdParticleDirectionQueryN
  ) => XpbdConservativeHessianVectorEvaluationN;
  readonly symmetryTolerance: number;
  readonly eigensolverTolerance: number;
  readonly eigensolverMaximumSweeps: number;
  readonly caller: string;
}

interface ProjectedHessianBlockN {
  readonly rawProducts: readonly VecN[];
  readonly projectedProducts: readonly VecN[];
  readonly evidence: XpbdConservativePsdBlockApplicationN;
}

function projectHessianBlock(
  options: ProjectHessianBlockOptionsN
): ProjectedHessianBlockN {
  const { block, dimension, caller } = options;
  const localVariableCount = block.particles.length * dimension;
  const hessian = new MatN(localVariableCount);
  const localParticleIndices = new Map<XpbdParticleN, number>();
  for (let local = 0; local < block.particles.length; local++) {
    localParticleIndices.set(block.particles[local]!, local);
  }
  for (let column = 0; column < localVariableCount; column++) {
    const basisParticle = Math.floor(column / dimension);
    const basisAxis = column % dimension;
    const evaluation = validateCurvatureEvaluation(
      options.evaluate((particle) => {
        const local = localParticleIndices.get(particle);
        if (local === undefined) {
          throw new Error(`${caller}: requested a foreign direction particle`);
        }
        const basis = new VecN(dimension);
        if (local === basisParticle) basis.data[basisAxis] = 1;
        return basis;
      }),
      block.particles,
      dimension,
      caller
    );
    for (let local = 0; local < block.particles.length; local++) {
      const product = evaluation.products[local]!;
      for (let axis = 0; axis < dimension; axis++) {
        hessian.set(
          local * dimension + axis,
          column,
          product.data[axis]!
        );
      }
    }
  }

  const localDirection = new Float64Array(localVariableCount);
  for (let local = 0; local < block.particles.length; local++) {
    const direction = options.directionOf(block.particles[local]!);
    if (!(direction instanceof VecN) || direction.dim !== dimension) {
      throw new Error(
        `${caller}: direction ${local} must be R${dimension}`
      );
    }
    assertFiniteVector(direction, `${caller}: direction ${local}`);
    localDirection.set(direction.data, local * dimension);
  }
  const rawProduct = applyDenseMatrix(
    hessian,
    localDirection,
    `${caller}: raw product`
  );

  let matrixScale = 1;
  let maximumSkew = 0;
  for (let row = 0; row < localVariableCount; row++) {
    for (let column = 0; column < localVariableCount; column++) {
      matrixScale = Math.max(matrixScale, Math.abs(hessian.get(row, column)));
    }
    for (let column = row + 1; column < localVariableCount; column++) {
      maximumSkew = Math.max(
        maximumSkew,
        Math.abs(
          hessian.get(row, column) - hessian.get(column, row)
        )
      );
    }
  }
  const relativeSymmetryError = maximumSkew / matrixScale;
  if (relativeSymmetryError > options.symmetryTolerance) {
    throw new Error(
      `${caller}: Hessian is not symmetric (relative error ` +
        `${relativeSymmetryError}, tolerance ${options.symmetryTolerance})`
    );
  }
  for (let row = 0; row < localVariableCount; row++) {
    for (let column = row + 1; column < localVariableCount; column++) {
      const average =
        0.5 * hessian.get(row, column) +
        0.5 * hessian.get(column, row);
      hessian.set(row, column, average);
      hessian.set(column, row, average);
    }
  }

  const eigensystem = symmetricEigenDecomposition(hessian, {
    tolerance: options.eigensolverTolerance,
    symmetryTolerance: options.symmetryTolerance,
    maxSweeps: options.eigensolverMaximumSweeps
  });
  const projectedEigenvalues = Float64Array.from(
    eigensystem.values,
    (value) => Math.max(value, 0)
  );
  let clippedEigenvalueCount = 0;
  for (const value of eigensystem.values) {
    if (value < 0) clippedEigenvalueCount++;
  }

  const projectedProduct = new Float64Array(localVariableCount);
  for (let eigen = 0; eigen < localVariableCount; eigen++) {
    const eigenvalue = projectedEigenvalues[eigen]!;
    if (eigenvalue === 0) continue;
    let coordinate = 0;
    for (let row = 0; row < localVariableCount; row++) {
      coordinate +=
        eigensystem.vectors.get(row, eigen) * localDirection[row]!;
    }
    const scale = eigenvalue * coordinate;
    for (let row = 0; row < localVariableCount; row++) {
      projectedProduct[row]! +=
        scale * eigensystem.vectors.get(row, eigen);
      if (!Number.isFinite(projectedProduct[row])) {
        throw new Error(`${caller}: projected product is outside Float64`);
      }
    }
  }
  const rawProducts = packedProducts(
    rawProduct,
    block.particles.length,
    dimension
  );
  const projectedProducts = packedProducts(
    projectedProduct,
    block.particles.length,
    dimension
  );
  return Object.freeze({
    rawProducts,
    projectedProducts,
    evidence: Object.freeze({
      blockId: block.id,
      particleIds: Object.freeze(
        block.particles.map((particle) => particle.id)
      ),
      localVariableCount,
      operatorEvaluations: localVariableCount,
      rawEigenvalues: eigensystem.values.slice(),
      projectedEigenvalues,
      clippedEigenvalueCount,
      relativeSymmetryError,
      eigensystemMaxResidual: eigensystem.maxResidual,
      eigensystemOrthogonalityError: eigensystem.orthogonalityError
    })
  });
}

function evaluateProviderBlockPsdCurvature(
  provider: XpbdConservativeHessianVectorProviderN,
  positionOf: XpbdParticlePositionQueryN,
  directionOf: XpbdParticleDirectionQueryN,
  dimension: number,
  policy: NormalizedProviderBlockPsdCurvaturePolicyN,
  caller: string
): SelectedProviderBlockPsdCurvatureN {
  const capable = hasHessianBlockCapability(provider, caller);
  const blocks = capable
    ? validateHessianBlocks(provider, caller)
    : Object.freeze([Object.freeze({
      id: 'implicit-provider',
      particles: provider.particles
    })]);
  const providerIndices = new Map<XpbdParticleN, number>();
  for (let local = 0; local < provider.particles.length; local++) {
    providerIndices.set(provider.particles[local]!, local);
  }
  const rawProducts = provider.particles.map(() => new VecN(dimension));
  const projectedProducts = provider.particles.map(() => new VecN(dimension));
  const blockEvidence: XpbdConservativePsdBlockApplicationN[] = [];
  let operatorEvaluations = 1;
  for (const block of blocks) {
    const label = `${caller}: provider "${provider.id}" block "${block.id}"`;
    const projected = projectHessianBlock({
      block,
      dimension,
      directionOf,
      evaluate: (basisDirectionOf) => capable
        ? provider.evaluatePotentialHessianBlockVectorAt(
          block,
          positionOf,
          basisDirectionOf
        )
        : provider.evaluatePotentialHessianVectorAt(
          positionOf,
          basisDirectionOf
        ),
      symmetryTolerance: policy.symmetryTolerance,
      eigensolverTolerance: policy.eigensolverTolerance,
      eigensolverMaximumSweeps: policy.eigensolverMaximumSweeps,
      caller: label
    });
    for (let local = 0; local < block.particles.length; local++) {
      const providerIndex = providerIndices.get(block.particles[local]!)!;
      rawProducts[providerIndex]!.add(projected.rawProducts[local]!);
      projectedProducts[providerIndex]!
        .add(projected.projectedProducts[local]!);
      assertFiniteVector(
        rawProducts[providerIndex]!,
        `${label}: assembled raw product`
      );
      assertFiniteVector(
        projectedProducts[providerIndex]!,
        `${label}: assembled projected product`
      );
    }
    operatorEvaluations += projected.evidence.operatorEvaluations;
    blockEvidence.push(projected.evidence);
  }

  const exact = validateProviderEvaluation(
    provider.evaluatePotentialHessianVectorAt(positionOf, directionOf),
    provider,
    dimension,
    caller
  );
  let exactNorm = 0;
  let differenceNorm = 0;
  for (let local = 0; local < provider.particles.length; local++) {
    for (let axis = 0; axis < dimension; axis++) {
      const expected = exact.products[local]!.data[axis]!;
      const actual = rawProducts[local]!.data[axis]!;
      exactNorm = Math.hypot(exactNorm, expected);
      differenceNorm = Math.hypot(differenceNorm, actual - expected);
    }
  }
  const rawAssemblyRelativeError =
    differenceNorm / Math.max(1, exactNorm);
  if (!Number.isFinite(rawAssemblyRelativeError)) {
    throw new Error(
      `${caller}: provider "${provider.id}" block assembly is outside Float64`
    );
  }
  if (rawAssemblyRelativeError > policy.decompositionTolerance) {
    throw new Error(
      `${caller}: provider "${provider.id}" block assembly does not match ` +
        `its aggregate Hessian-vector product (relative error ` +
        `${rawAssemblyRelativeError}, tolerance ` +
        `${policy.decompositionTolerance})`
    );
  }
  return Object.freeze({
    evaluation: Object.freeze({
      products: Object.freeze(projectedProducts)
    }),
    curvature: Object.freeze({
      kind: 'provider-block-psd',
      decomposition: capable ? 'declared' : 'implicit-provider',
      blockCount: blocks.length,
      operatorEvaluations,
      rawAssemblyRelativeError,
      blocks: Object.freeze(blockEvidence)
    })
  });
}

function hasHessianBlockCapability(
  provider: XpbdConservativeHessianVectorProviderN,
  caller: string
): provider is XpbdConservativeHessianBlockProviderN {
  const candidate =
    provider as Partial<XpbdConservativeHessianBlockProviderN>;
  const hasBlocks = candidate.potentialHessianBlocks !== undefined;
  const hasEvaluator =
    candidate.evaluatePotentialHessianBlockVectorAt !== undefined;
  if (hasBlocks !== hasEvaluator) {
    throw new Error(
      `${caller}: provider "${provider.id}" must expose ` +
        `potentialHessianBlocks and ` +
        `evaluatePotentialHessianBlockVectorAt together`
    );
  }
  if (!hasBlocks) return false;
  if (!Array.isArray(candidate.potentialHessianBlocks)) {
    throw new Error(
      `${caller}: provider "${provider.id}" potentialHessianBlocks must be ` +
        `an array`
    );
  }
  if (typeof candidate.evaluatePotentialHessianBlockVectorAt !== 'function') {
    throw new Error(
      `${caller}: provider "${provider.id}" ` +
        `evaluatePotentialHessianBlockVectorAt must be a function`
    );
  }
  return true;
}

function validateHessianBlocks(
  provider: XpbdConservativeHessianBlockProviderN,
  caller: string
): readonly XpbdConservativeHessianBlockN[] {
  const blocks = provider.potentialHessianBlocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error(
      `${caller}: provider "${provider.id}" must declare at least one ` +
        `Hessian block`
    );
  }
  const providerParticles = new Set(provider.particles);
  const ids = new Set<string>();
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (typeof block !== 'object' || block === null) {
      throw new Error(
        `${caller}: provider "${provider.id}" block ${index} must be an object`
      );
    }
    if (typeof block.id !== 'string' || block.id.trim().length === 0) {
      throw new Error(
        `${caller}: provider "${provider.id}" block ${index} id must be ` +
          `non-empty`
      );
    }
    if (ids.has(block.id)) {
      throw new Error(
        `${caller}: provider "${provider.id}" repeats Hessian block id ` +
          `"${block.id}"`
      );
    }
    ids.add(block.id);
    if (!Array.isArray(block.particles) || block.particles.length === 0) {
      throw new Error(
        `${caller}: provider "${provider.id}" block "${block.id}" has no ` +
          `particles`
      );
    }
    const local = new Set<XpbdParticleN>();
    for (const particle of block.particles) {
      if (!(particle instanceof XpbdParticleN) ||
        !providerParticles.has(particle)) {
        throw new Error(
          `${caller}: provider "${provider.id}" block "${block.id}" ` +
            `contains a foreign particle`
        );
      }
      if (local.has(particle)) {
        throw new Error(
          `${caller}: provider "${provider.id}" block "${block.id}" ` +
            `repeats a particle`
        );
      }
      local.add(particle);
    }
  }
  return blocks;
}

function isHessianVectorProvider(
  provider: XpbdConservativeForceProviderN
): provider is XpbdConservativeHessianVectorProviderN {
  return typeof (
    provider as Partial<XpbdConservativeHessianVectorProviderN>
  ).evaluatePotentialHessianVectorAt === 'function';
}

function validatePositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be finite and positive`);
  }
}

function applyDenseMatrix(
  matrix: MatN,
  vector: ArrayLike<number>,
  label: string
): Float64Array {
  const product = new Float64Array(matrix.n);
  for (let row = 0; row < matrix.n; row++) {
    let value = 0;
    for (let column = 0; column < matrix.n; column++) {
      value += matrix.get(row, column) * vector[column]!;
    }
    if (!Number.isFinite(value)) {
      throw new Error(`${label} is outside Float64`);
    }
    product[row] = value;
  }
  return product;
}

function packedProducts(
  packed: Float64Array,
  particleCount: number,
  dimension: number
): readonly VecN[] {
  return Object.freeze(Array.from(
    { length: particleCount },
    (_, local) => new VecN(packed.subarray(
      local * dimension,
      (local + 1) * dimension
    ))
  ));
}

function validateProviderEvaluation(
  evaluation: XpbdConservativeHessianVectorEvaluationN,
  provider: XpbdConservativeHessianVectorProviderN,
  dimension: number,
  caller: string
): XpbdConservativeHessianVectorEvaluationN {
  return validateCurvatureEvaluation(
    evaluation,
    provider.particles,
    dimension,
    `${caller}: provider "${provider.id}"`
  );
}

function validateCurvatureEvaluation(
  evaluation: XpbdConservativeHessianVectorEvaluationN,
  particles: readonly XpbdParticleN[],
  dimension: number,
  label: string
): XpbdConservativeHessianVectorEvaluationN {
  if (typeof evaluation !== 'object' || evaluation === null) {
    throw new Error(`${label} returned no curvature evaluation`);
  }
  if (!Array.isArray(evaluation.products) ||
    evaluation.products.length !== particles.length) {
    throw new Error(`${label} product count mismatch`);
  }
  const products = evaluation.products.map((product, index) => {
    if (!(product instanceof VecN) || product.dim !== dimension) {
      throw new Error(
        `${label} product ${index} must be R${dimension}`
      );
    }
    assertFiniteVector(product, `${label} product ${index}`);
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
