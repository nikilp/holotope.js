import {
  XpbdIncrementalPotentialProblemN,
  type XpbdPackedIncrementalPotentialEvaluationN
} from './xpbd-incremental-potential-problem.js';
import {
  compileXpbdIncrementalPotentialAnalyticHessianOperatorFromBaseN,
  normalizeXpbdIncrementalPotentialCurvaturePolicyN,
  type CompileXpbdIncrementalPotentialAnalyticHessianOperatorNOptions,
  type XpbdConservativeCurvatureOperatorProviderN,
  type XpbdIncrementalPotentialAnalyticHessianOperatorCompilationN,
  type XpbdIncrementalPotentialAnalyticHessianOperatorN,
  type XpbdIncrementalPotentialAnalyticHessianOperatorUnsupportedN
} from './xpbd-incremental-potential-analytic-curvature.js';
import type {
  XpbdConservativeCurvatureApplicationN,
  XpbdIncrementalPotentialCurvaturePolicyKindN,
  XpbdIncrementalPotentialCurvaturePolicyN
} from './xpbd-incremental-potential-curvature-policy.js';

const METHOD = 'preconditioned-conjugate-gradient' as const;

/** Available positive preconditioners for the packed Newton equation. */
export type XpbdIncrementalPotentialNewtonPreconditionerN =
  | 'identity'
  | 'mass-diagonal';

/** Options for one bounded, non-mutating matrix-free Newton-direction solve. */
export interface SolveXpbdIncrementalPotentialNewtonDirectionNOptions {
  /** Compiled objective supplying packing, mass, and analytic provider curvature. */
  readonly problem: XpbdIncrementalPotentialProblemN;
  /** Packed free-particle coordinates at the linearization point. */
  readonly coordinates: ArrayLike<number>;
  /** Positive preconditioner policy; default `mass-diagonal`. */
  readonly preconditioner?: XpbdIncrementalPotentialNewtonPreconditionerN;
  /**
   * Exact provider Hessians by default, or explicit dense PSD block policy.
   */
  readonly curvaturePolicy?: XpbdIncrementalPotentialCurvaturePolicyN;
  /** Residual tolerance relative to the initial gradient norm; default `1e-8`. */
  readonly relativeResidualTolerance?: number;
  /** Absolute packed residual tolerance; default zero. */
  readonly absoluteResidualTolerance?: number;
  /**
   * Relative positive-curvature threshold against `||d|| ||H d||`.
   *
   * Defaults to `256 * Number.EPSILON`.
   */
  readonly relativeCurvatureTolerance?: number;
  /** Krylov iteration budget; default `min(variableCount, 128)`. */
  readonly maximumIterations?: number;
}

/** Auditable evidence for one completed conjugate-gradient iteration. */
export interface XpbdIncrementalPotentialNewtonIterationN {
  /** Zero-based Krylov iteration index. */
  readonly index: number;
  /** Residual norm before the Hessian-vector product. */
  readonly residualNormBefore: number;
  /** Residual norm after the accepted linear update. */
  readonly residualNormAfter: number;
  /** Positive search curvature `d^T H d`. */
  readonly quadraticForm: number;
  /** Scale-relative lower threshold applied to the search curvature. */
  readonly curvatureThreshold: number;
  /** Conjugate-gradient step coefficient `alpha`. */
  readonly stepLength: number;
  /** Next-direction coefficient `beta`, or `null` on terminal convergence. */
  readonly conjugacyCoefficient: number | null;
  /**
   * Provider construction behind this iteration's operator product.
   *
   * Projected spectra may be the same immutable compilation reused by several
   * iterations; the direction-specific block audit remains fresh.
   */
  readonly providerCurvatures: readonly {
    /** Stable conservative-provider identity. */
    readonly providerId: string;
    /** Exact or projected construction used for this product. */
    readonly curvature: XpbdConservativeCurvatureApplicationN;
  }[];
}

/** Evidence common to every matrix-free Newton-direction outcome. */
export interface XpbdIncrementalPotentialNewtonDirectionBaseN {
  /** Bounded linear-solver construction used by the result. */
  readonly method: typeof METHOD;
  /** Complete incremental objective at the unperturbed coordinates. */
  readonly base: XpbdPackedIncrementalPotentialEvaluationN;
  /** Defensive packed coordinate copy at the linearization point. */
  readonly coordinates: Float64Array;
  /** Linear right-hand side `-gradient(Phi)`. */
  readonly rightHandSide: Float64Array;
  /** Accumulated candidate Newton direction. */
  readonly direction: Float64Array;
  /** Initial Euclidean residual norm, equal to the gradient norm. */
  readonly initialResidualNorm: number;
  /** Euclidean residual norm at termination. */
  readonly residualNorm: number;
  /** Effective absolute-or-relative residual threshold. */
  readonly residualTolerance: number;
  /** Positive packed preconditioner used by the iteration. */
  readonly preconditioner:
    XpbdIncrementalPotentialNewtonPreconditionerN;
  /** Exact or explicitly modified curvature used by every operator query. */
  readonly curvaturePolicy: XpbdIncrementalPotentialCurvaturePolicyKindN;
  /** Authored or default Krylov iteration budget. */
  readonly maximumIterations: number;
  /** Completed positive-curvature iterations in execution order. */
  readonly iterations: readonly XpbdIncrementalPotentialNewtonIterationN[];
  /** Number of complete analytic objective Hessian-vector evaluations. */
  readonly operatorEvaluations: number;
  /** Provider basis HVPs paid once to compile projected curvature. */
  readonly curvatureConstructionOperatorEvaluations: number;
  /** Aggregate provider HVPs paid across nonzero operator applications. */
  readonly curvatureApplicationOperatorEvaluations: number;
  /** Fixed provider constructions reused by every Krylov iteration. */
  readonly curvatureProviders:
    readonly XpbdConservativeCurvatureOperatorProviderN[];
  /** Authored relative residual tolerance. */
  readonly relativeResidualTolerance: number;
  /** Authored absolute residual tolerance. */
  readonly absoluteResidualTolerance: number;
  /** Authored relative positive-curvature threshold. */
  readonly relativeCurvatureTolerance: number;
}

/** Exact stationary result requiring no curvature-provider capability. */
export interface XpbdIncrementalPotentialNewtonDirectionZeroGradientN
  extends XpbdIncrementalPotentialNewtonDirectionBaseN {
  /** Confirms that the packed objective gradient is exactly zero. */
  readonly status: 'zero-gradient';
}

/** Direction whose linear residual met the authored tolerance. */
export interface XpbdIncrementalPotentialNewtonDirectionConvergedN
  extends XpbdIncrementalPotentialNewtonDirectionBaseN {
  /** Confirms convergence of the linearized Newton equation only. */
  readonly status: 'converged';
  /** Whether tolerance held initially or after a Krylov update. */
  readonly convergencePoint: 'initial-residual' | 'iteration';
}

/** Bounded result that exhausted its Krylov iteration budget. */
export interface XpbdIncrementalPotentialNewtonDirectionIterationLimitN
  extends XpbdIncrementalPotentialNewtonDirectionBaseN {
  /** Distinguishes a finite incomplete solve from convergence or refusal. */
  readonly status: 'iteration-limit';
}

/** Explicit refusal when the complete objective lacks analytic curvature. */
export interface XpbdIncrementalPotentialNewtonDirectionUnsupportedN
  extends XpbdIncrementalPotentialNewtonDirectionBaseN {
  /** Identifies an incomplete analytic provider mixture. */
  readonly status: 'unsupported-provider';
  /** Every incapable conservative provider id in authored order. */
  readonly providerIds: readonly string[];
}

/** Explicit refusal at an indefinite or numerically unresolved Krylov ray. */
export interface XpbdIncrementalPotentialNewtonDirectionNonPositiveCurvatureN
  extends XpbdIncrementalPotentialNewtonDirectionBaseN {
  /** Distinguishes curvature refusal from an iteration-budget limit. */
  readonly status: 'non-positive-curvature';
  /** Zero-based rejected Krylov iteration. */
  readonly iterationIndex: number;
  /** Defensive search direction whose curvature was rejected. */
  readonly krylovDirection: Float64Array;
  /** Complete objective Hessian product along the rejected direction. */
  readonly product: Float64Array;
  /** Rejected directional curvature `d^T H d`. */
  readonly quadraticForm: number;
  /** Required scale-relative positive-curvature threshold. */
  readonly curvatureThreshold: number;
}

/** Bounded evidence from one matrix-free Newton-direction attempt. */
export type XpbdIncrementalPotentialNewtonDirectionResultN =
  | XpbdIncrementalPotentialNewtonDirectionZeroGradientN
  | XpbdIncrementalPotentialNewtonDirectionConvergedN
  | XpbdIncrementalPotentialNewtonDirectionIterationLimitN
  | XpbdIncrementalPotentialNewtonDirectionUnsupportedN
  | XpbdIncrementalPotentialNewtonDirectionNonPositiveCurvatureN;

/**
 * Solves the packed linearized Newton equation with bounded preconditioned CG.
 *
 * The operator is P35/P36's complete exact analytic objective
 * Hessian-vector composition. The routine neither assembles a matrix nor
 * mutates particles. It refuses incomplete provider mixtures and
 * non-positive curvature instead of returning a falsely certified Newton
 * direction.
 *
 * At the fixed linearization coordinate, explicit PSD provider/block matrices
 * are reconstructed and diagonalized once, then reused by every Krylov
 * iteration. Exact providers remain matrix-free. Provider-block PSD retains
 * one aggregate decomposition audit per applied direction.
 *
 * This result is only a direction diagnostic. It does not choose an admissible
 * nonlinear step, modify definiteness, invoke Armijo, or apply state.
 *
 * @example
 * On a problem whose only curvature is the mass block, the linearized Newton
 * equation is diagonal and converges immediately:
 * ```ts
 * const particle = new XpbdParticleN({ id: 'p', position: new VecN([0, 0.3, 0]) });
 * const problem = compileXpbdIncrementalPotentialProblemN({
 *   dimension: 3,
 *   particles: [particle],
 *   predictedPositions: [new VecN([0, 0.9, 0])],
 *   deltaTime: 1 / 60,
 *   providers: []
 * });
 *
 * const solved = solveXpbdIncrementalPotentialNewtonDirectionN({
 *   problem,
 *   coordinates: [0, 0.3, 0]
 * });
 *
 * solved.status; // 'converged'
 * solved.preconditioner; // 'mass-diagonal', the default
 * ```
 *
 * @example
 * A refusal is not a failure to compute — it is the solve declining to
 * certify a direction it cannot stand behind. An incomplete provider mixture
 * names every incapable provider before any partial product is requested:
 * ```ts
 * const particle = new XpbdParticleN({ id: 'p', position: new VecN([0, 0.3, 0]) });
 * const problem = compileXpbdIncrementalPotentialProblemN({
 *   dimension: 3,
 *   particles: [particle],
 *   predictedPositions: [new VecN([0, 0.9, 0])],
 *   deltaTime: 1 / 60,
 *   providers: []
 * });
 *
 * const solved = solveXpbdIncrementalPotentialNewtonDirectionN({
 *   problem,
 *   coordinates: [0, 0.3, 0],
 *   maximumIterations: 0
 * });
 *
 * solved.status; // 'iteration-limit' — a bounded solve, not a broken one
 * solved.iterations.length; // 0
 * ```
 */
export function solveXpbdIncrementalPotentialNewtonDirectionN(
  options: SolveXpbdIncrementalPotentialNewtonDirectionNOptions
): XpbdIncrementalPotentialNewtonDirectionResultN {
  const caller = 'solveXpbdIncrementalPotentialNewtonDirectionN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  if (!(options.problem instanceof XpbdIncrementalPotentialProblemN)) {
    throw new Error(
      `${caller}: problem must be an XpbdIncrementalPotentialProblemN`
    );
  }
  const preconditioner = options.preconditioner ?? 'mass-diagonal';
  if (preconditioner !== 'identity' && preconditioner !== 'mass-diagonal') {
    throw new Error(
      `${caller}: preconditioner must be "identity" or "mass-diagonal"`
    );
  }
  const normalizedCurvaturePolicy =
    normalizeXpbdIncrementalPotentialCurvaturePolicyN(
      options.curvaturePolicy,
      caller
    );
  const relativeResidualTolerance =
    options.relativeResidualTolerance ?? 1e-8;
  const absoluteResidualTolerance =
    options.absoluteResidualTolerance ?? 0;
  const relativeCurvatureTolerance =
    options.relativeCurvatureTolerance ?? 256 * Number.EPSILON;
  const maximumIterations = options.maximumIterations ??
    Math.min(options.problem.variableCount, 128);
  validateTolerance(
    relativeResidualTolerance,
    false,
    `${caller}: relativeResidualTolerance`
  );
  validateTolerance(
    absoluteResidualTolerance,
    false,
    `${caller}: absoluteResidualTolerance`
  );
  validateTolerance(
    relativeCurvatureTolerance,
    true,
    `${caller}: relativeCurvatureTolerance`
  );
  if (!Number.isSafeInteger(maximumIterations) || maximumIterations < 0) {
    throw new Error(
      `${caller}: maximumIterations must be a non-negative integer`
    );
  }

  const base = options.problem.evaluate(options.coordinates);
  const coordinates = Float64Array.from(base.coordinates);
  const rightHandSide = Float64Array.from(
    base.gradient,
    (component) => -component
  );
  const initialResidualNorm = vectorNorm(rightHandSide, caller);
  const residualTolerance = Math.max(
    absoluteResidualTolerance,
    relativeResidualTolerance * initialResidualNorm
  );
  if (!Number.isFinite(residualTolerance)) {
    throw new Error(`${caller}: residual tolerance is outside Float64`);
  }
  const direction = new Float64Array(options.problem.variableCount);
  const iterations: XpbdIncrementalPotentialNewtonIterationN[] = [];
  const common = {
    method: METHOD,
    base,
    coordinates,
    rightHandSide,
    initialResidualNorm,
    residualTolerance,
    preconditioner,
    curvaturePolicy: normalizedCurvaturePolicy.kind,
    maximumIterations,
    relativeResidualTolerance,
    absoluteResidualTolerance,
    relativeCurvatureTolerance
  } as const;
  if (initialResidualNorm === 0) {
    return Object.freeze({
      ...common,
      status: 'zero-gradient',
      direction,
      residualNorm: 0,
      iterations: Object.freeze(iterations),
      operatorEvaluations: 0,
      curvatureConstructionOperatorEvaluations: 0,
      curvatureApplicationOperatorEvaluations: 0,
      curvatureProviders: Object.freeze([])
    });
  }
  if (initialResidualNorm <= residualTolerance) {
    return Object.freeze({
      ...common,
      status: 'converged',
      convergencePoint: 'initial-residual',
      direction,
      residualNorm: initialResidualNorm,
      iterations: Object.freeze(iterations),
      operatorEvaluations: 0,
      curvatureConstructionOperatorEvaluations: 0,
      curvatureApplicationOperatorEvaluations: 0,
      curvatureProviders: Object.freeze([])
    });
  }
  if (maximumIterations === 0) {
    return Object.freeze({
      ...common,
      status: 'iteration-limit',
      direction,
      residualNorm: initialResidualNorm,
      iterations: Object.freeze(iterations),
      operatorEvaluations: 0,
      curvatureConstructionOperatorEvaluations: 0,
      curvatureApplicationOperatorEvaluations: 0,
      curvatureProviders: Object.freeze([])
    });
  }

  const analyticOperatorOptions:
    CompileXpbdIncrementalPotentialAnalyticHessianOperatorNOptions = {
      problem: options.problem,
      coordinates,
      ...(options.curvaturePolicy === undefined
        ? {}
        : { curvaturePolicy: options.curvaturePolicy })
    };
  const analyticOperator:
    XpbdIncrementalPotentialAnalyticHessianOperatorCompilationN =
    compileXpbdIncrementalPotentialAnalyticHessianOperatorFromBaseN({
      problem: analyticOperatorOptions.problem,
      coordinates,
      ...(analyticOperatorOptions.curvaturePolicy === undefined
        ? {}
        : { curvaturePolicy: analyticOperatorOptions.curvaturePolicy }),
      base,
      caller
    });
  if (analyticOperator.status === 'unsupported-provider') {
    const unsupportedOperator:
      XpbdIncrementalPotentialAnalyticHessianOperatorUnsupportedN =
        analyticOperator;
    return Object.freeze({
      ...common,
      status: 'unsupported-provider',
      providerIds: unsupportedOperator.providerIds,
      direction,
      residualNorm: initialResidualNorm,
      iterations: Object.freeze(iterations),
      operatorEvaluations: 0,
      curvatureConstructionOperatorEvaluations: 0,
      curvatureApplicationOperatorEvaluations: 0,
      curvatureProviders: Object.freeze([])
    });
  }
  const compiledOperator:
    XpbdIncrementalPotentialAnalyticHessianOperatorN = analyticOperator;
  const curvatureProviders = compiledOperator.providers;
  const curvatureConstructionOperatorEvaluations =
    compiledOperator.constructionOperatorEvaluations;

  let residual = rightHandSide.slice();
  let preconditionedResidual = applyPreconditioner(
    residual,
    options.problem,
    preconditioner,
    caller
  );
  let residualInnerProduct = dot(residual, preconditionedResidual, caller);
  if (!(residualInnerProduct > 0)) {
    throw new Error(`${caller}: preconditioned residual must be positive`);
  }
  let krylovDirection = preconditionedResidual.slice();
  let residualNorm = initialResidualNorm;
  let operatorEvaluations = 0;
  let curvatureApplicationOperatorEvaluations = 0;

  for (let index = 0; index < maximumIterations; index++) {
    const analytic = compiledOperator.apply(krylovDirection);
    if (analytic.status === 'zero-direction') {
      throw new Error(`${caller}: nonzero Krylov direction became zero`);
    }
    operatorEvaluations++;
    curvatureApplicationOperatorEvaluations +=
      compiledOperator.applicationOperatorEvaluationsPerNonzeroProduct;
    const product = analytic.product;
    const providerCurvatures = Object.freeze(
      analytic.providers.map(({ provider, curvature }) =>
        Object.freeze({
          providerId: provider.id,
          curvature
        })
      )
    );
    const quadraticForm = dot(krylovDirection, product, caller);
    const curvatureThreshold =
      relativeCurvatureTolerance *
      vectorNorm(krylovDirection, caller) *
      vectorNorm(product, caller);
    if (!Number.isFinite(curvatureThreshold)) {
      throw new Error(`${caller}: curvature threshold is outside Float64`);
    }
    if (!(quadraticForm > curvatureThreshold)) {
      return Object.freeze({
        ...common,
        status: 'non-positive-curvature',
        iterationIndex: index,
        krylovDirection: krylovDirection.slice(),
        product: product.slice(),
        quadraticForm,
        curvatureThreshold,
        direction: direction.slice(),
        residualNorm,
        iterations: Object.freeze(iterations),
        operatorEvaluations,
        curvatureConstructionOperatorEvaluations,
        curvatureApplicationOperatorEvaluations,
        curvatureProviders
      });
    }

    const stepLength = residualInnerProduct / quadraticForm;
    if (!Number.isFinite(stepLength)) {
      throw new Error(`${caller}: Krylov step length is outside Float64`);
    }
    for (let coordinate = 0; coordinate < direction.length; coordinate++) {
      direction[coordinate]! +=
        stepLength * krylovDirection[coordinate]!;
      residual[coordinate]! -= stepLength * product[coordinate]!;
      if (!Number.isFinite(direction[coordinate]) ||
        !Number.isFinite(residual[coordinate])) {
        throw new Error(`${caller}: Krylov state is outside Float64`);
      }
    }
    const nextResidualNorm = vectorNorm(residual, caller);
    if (nextResidualNorm <= residualTolerance) {
      iterations.push(Object.freeze({
        index,
        residualNormBefore: residualNorm,
        residualNormAfter: nextResidualNorm,
        quadraticForm,
        curvatureThreshold,
        stepLength,
        conjugacyCoefficient: null,
        providerCurvatures
      }));
      return Object.freeze({
        ...common,
        status: 'converged',
        convergencePoint: 'iteration',
        direction: direction.slice(),
        residualNorm: nextResidualNorm,
        iterations: Object.freeze(iterations),
        operatorEvaluations,
        curvatureConstructionOperatorEvaluations,
        curvatureApplicationOperatorEvaluations,
        curvatureProviders
      });
    }

    preconditionedResidual = applyPreconditioner(
      residual,
      options.problem,
      preconditioner,
      caller
    );
    const nextResidualInnerProduct = dot(
      residual,
      preconditionedResidual,
      caller
    );
    if (!(nextResidualInnerProduct > 0)) {
      throw new Error(`${caller}: preconditioned residual lost positivity`);
    }
    const conjugacyCoefficient =
      nextResidualInnerProduct / residualInnerProduct;
    if (!Number.isFinite(conjugacyCoefficient)) {
      throw new Error(`${caller}: conjugacy coefficient is outside Float64`);
    }
    iterations.push(Object.freeze({
      index,
      residualNormBefore: residualNorm,
      residualNormAfter: nextResidualNorm,
      quadraticForm,
      curvatureThreshold,
      stepLength,
      conjugacyCoefficient,
      providerCurvatures
    }));
    for (
      let coordinate = 0;
      coordinate < krylovDirection.length;
      coordinate++
    ) {
      krylovDirection[coordinate] =
        preconditionedResidual[coordinate]! +
        conjugacyCoefficient * krylovDirection[coordinate]!;
      if (!Number.isFinite(krylovDirection[coordinate])) {
        throw new Error(`${caller}: Krylov direction is outside Float64`);
      }
    }
    residualInnerProduct = nextResidualInnerProduct;
    residualNorm = nextResidualNorm;
  }

  return Object.freeze({
    ...common,
    status: 'iteration-limit',
    direction: direction.slice(),
    residualNorm,
    iterations: Object.freeze(iterations),
    operatorEvaluations,
    curvatureConstructionOperatorEvaluations,
    curvatureApplicationOperatorEvaluations,
    curvatureProviders
  });
}

function applyPreconditioner(
  residual: Float64Array,
  problem: XpbdIncrementalPotentialProblemN,
  preconditioner: XpbdIncrementalPotentialNewtonPreconditionerN,
  caller: string
): Float64Array {
  if (preconditioner === 'identity') return residual.slice();
  const result = new Float64Array(residual.length);
  let packedOffset = 0;
  for (const particleIndex of problem.freeParticleIndices) {
    const inverseMass = problem.particles[particleIndex]!.inverseMass;
    if (!(inverseMass > 0) || !Number.isFinite(inverseMass)) {
      throw new Error(`${caller}: free particle inverse mass must be positive`);
    }
    for (let axis = 0; axis < problem.dimension; axis++) {
      result[packedOffset] = inverseMass * residual[packedOffset]!;
      if (!Number.isFinite(result[packedOffset])) {
        throw new Error(`${caller}: preconditioned residual is outside Float64`);
      }
      packedOffset++;
    }
  }
  return result;
}

function dot(
  left: ArrayLike<number>,
  right: ArrayLike<number>,
  caller: string
): number {
  if (left.length !== right.length) {
    throw new Error(`${caller}: packed vector length mismatch`);
  }
  let value = 0;
  for (let index = 0; index < left.length; index++) {
    value += left[index]! * right[index]!;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`${caller}: packed inner product is outside Float64`);
  }
  return value;
}

function vectorNorm(value: ArrayLike<number>, caller: string): number {
  let norm = 0;
  for (let index = 0; index < value.length; index++) {
    norm = Math.hypot(norm, value[index]!);
  }
  if (!Number.isFinite(norm)) {
    throw new Error(`${caller}: packed norm is outside Float64`);
  }
  return norm;
}

function validateTolerance(
  value: number,
  strictlyBelowOne: boolean,
  label: string
): void {
  if (!Number.isFinite(value) || value < 0 ||
    (strictlyBelowOne && value >= 1)) {
    throw new Error(
      strictlyBelowOne
        ? `${label} must be finite and in [0, 1)`
        : `${label} must be finite and non-negative`
    );
  }
}
