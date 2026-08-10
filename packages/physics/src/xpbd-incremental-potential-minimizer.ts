import {
  XpbdIncrementalPotentialProblemN,
  searchXpbdIncrementalPotentialArmijoFromBaseN,
  type XpbdArmijoAcceptedN,
  type XpbdArmijoExhaustedN,
  type XpbdArmijoNotDescentN,
  type XpbdArmijoStepFilterRefusedN,
  type XpbdPackedIncrementalPotentialEvaluationN
} from './xpbd-incremental-potential-problem.js';
import {
  xpbdSteepestDescentDirectionN,
  type XpbdIncrementalPotentialDirectionContextN,
  xpbdMassPreconditionedDirectionN,
  type XpbdIncrementalPotentialDirectionEvidenceN,
  type XpbdIncrementalPotentialDirectionPolicyNameN,
  type XpbdIncrementalPotentialDirectionPolicyN,
  type XpbdIncrementalPotentialDirectionProposalN,
  type XpbdIncrementalPotentialDirectionRefusalN
} from './xpbd-incremental-potential-direction.js';
import {
  xpbdNewtonDirectionPolicyN
} from './xpbd-incremental-potential-newton-policy.js';
import { XpbdPotentialDomainErrorN } from './xpbd-potential-domain.js';

/**
 * The packed-gradient tolerance used when the author states no stop test.
 *
 * Declared once and referenced everywhere the default is needed, so the value
 * a caller observes and the value the code applies cannot drift apart.
 */
const DEFAULT_PACKED_GRADIENT_TOLERANCE = 1e-8;

/**
 * Which physical quantity a stop test bounds.
 *
 * The packed objective is `½‖x − x̃‖²_M + deltaTime² U(x)`, so a packed
 * gradient entry carries mass·length and the two criteria below differ by
 * exactly `deltaTime²`. That factor is not a detail: no single criterion
 * bounds both the per-step position error and the residual acceleration, so
 * the choice belongs to the author of the scene rather than to this library.
 *
 * Measured over an eight-fold timestep refinement at a fixed authored
 * tolerance, the delivered error spreads by:
 *
 * | criterion                       | acceleration | position |
 * | ------------------------------- | ------------ | -------- |
 * | `'packed-gradient'`             | 45.4×        | 1.5×     |
 * | `'maximum-acceleration-residual'`| 1.02×       | 62.8×    |
 *
 * Pick `'packed-gradient'` to hold a per-step position residual, and
 * `'maximum-acceleration-residual'` to hold a force resolution.
 */
export type XpbdIncrementalPotentialConvergenceKindN =
  | 'packed-gradient'
  | 'maximum-acceleration-residual';

/**
 * An authored stop test: which quantity is bounded, and by how much.
 *
 * Discriminated rather than a bare number because the two tolerances are not
 * interconvertible without a timestep and a mass, and are not even in the same
 * units.
 */
export type XpbdIncrementalPotentialConvergenceN =
  | {
    readonly kind: 'packed-gradient';
    /**
     * Absolute packed-gradient norm, in mass·length (= force·time²).
     *
     * Because `deltaTime²` is folded into the potential, this bounds forces
     * only down to `tolerance / deltaTime²`: halving the timestep quarters
     * the force this test can still see. It is exactly the shipped default's
     * semantics.
     */
    readonly tolerance: number;
  }
  | {
    readonly kind: 'maximum-acceleration-residual';
    /**
     * Largest residual acceleration left on any free particle, in
     * length/time².
     *
     * Computed as `max_i ‖gradient_i‖ / (mass_i · deltaTime²)`. Fixed
     * particles are excluded: they hold no packed coordinate and their
     * gradient is identically zero, so they can neither raise nor lower it.
     *
     * Independent of the timestep, of the particle count, and of the choice
     * of mass unit — a scene whose particles differ in mass by a thousandfold
     * is bounded by the worst-accelerated one, not by an aggregate that a
     * heavy particle can hide inside.
     */
    readonly tolerance: number;
  };

/** The authored stop test, echoed on every terminal. */
export interface XpbdIncrementalPotentialConvergenceContractN {
  /** Which quantity decided this result. */
  readonly kind: XpbdIncrementalPotentialConvergenceKindN;
  /** Authored threshold, in that criterion's own unit. */
  readonly tolerance: number;
}

/** The authored stop test together with what it actually measured. */
export interface XpbdIncrementalPotentialConvergenceEvidenceN
  extends XpbdIncrementalPotentialConvergenceContractN {
  /** Criterion residual at the authored initial coordinates. */
  readonly initialResidual: number;
  /**
   * Criterion residual at the last accepted iterate.
   *
   * `converged` is exactly `finalResidual <= tolerance`; every other terminal
   * reports how far short it stopped, in the unit the author chose.
   */
  readonly finalResidual: number;
}

export interface MinimizeXpbdIncrementalPotentialNOptions {
  readonly problem: XpbdIncrementalPotentialProblemN;
  readonly initialCoordinates: ArrayLike<number>;
  /**
   * Stop test to apply; defaults to `'packed-gradient'` at `1e-8`.
   *
   * Mutually exclusive with {@link gradientTolerance}, which is the legacy
   * spelling of the same packed-gradient criterion. Authoring both is refused
   * before anything is evaluated rather than silently resolved.
   */
  readonly convergence?: XpbdIncrementalPotentialConvergenceN;
  /**
   * Absolute packed-gradient norm tolerance; default `1e-8`.
   *
   * The packed objective folds `deltaTime²` into the potential, so this
   * threshold resolves forces only down to `gradientTolerance / deltaTime²` and
   * is not invariant under timestep refinement. See
   * {@link XpbdIncrementalPotentialMinimizationPolicyN.gradientTolerance}.
   */
  readonly gradientTolerance?: number;
  /** Accepted-step budget; default 128. Zero performs evaluation only. */
  readonly maximumIterations?: number;
  /** Initial Armijo step; default one. */
  readonly initialStep?: number;
  /** Armijo contraction in `(0, 1)`; default `0.5`. */
  readonly contractionFactor?: number;
  /** Armijo sufficient-decrease coefficient in `(0, 1)`; default `1e-4`. */
  readonly sufficientDecrease?: number;
  /** Trial budget for each Armijo search; default 32. */
  readonly maximumLineSearchTrials?: number;
  /**
   * Packed search-direction policy; defaults to steepest descent.
   *
   * A name selects a shipped policy and is resolved against this problem, so
   * `'newton-cg'` is reachable here rather than only through a factory the
   * caller has to know exists.
   */
  readonly directionPolicy?:
    | XpbdIncrementalPotentialDirectionPolicyN
    | XpbdIncrementalPotentialDirectionPolicyNameN;
}

/** Complete evidence for one Armijo-accepted search-direction attempt. */
export interface XpbdIncrementalPotentialIterationN {
  /** Zero-based accepted-iteration index. */
  readonly index: number;
  /** Stable identity of the policy that produced `direction`. */
  readonly directionPolicyId: string;
  /** Defensive packed direction passed to the Armijo search. */
  readonly direction: Float64Array;
  /** Complete accepted search and admissible-step evidence. */
  readonly search: XpbdArmijoAcceptedN;
  /** Euclidean norm of the accepted packed coordinate displacement. */
  readonly stepNorm: number;
  /** Positive objective reduction produced by the accepted displacement. */
  readonly objectiveDecrease: number;
  /** Policy-defined record of how this iteration's direction was obtained. */
  readonly directionEvidence?: XpbdIncrementalPotentialDirectionEvidenceN;
}

/**
 * Backward-compatible name for one accepted minimizer iteration.
 *
 * @deprecated Use `XpbdIncrementalPotentialIterationN`.
 */
export type XpbdSteepestDescentIterationN =
  XpbdIncrementalPotentialIterationN;

/** Evidence every minimization terminal carries, however it ended. */
interface XpbdIncrementalPotentialMinimizationBaseN {
  /** Exact compiled objective and identity context the search ran against. */
  readonly problem: XpbdIncrementalPotentialProblemN;
  /** Objective evidence at the authored initial coordinates. */
  readonly initial: XpbdPackedIncrementalPotentialEvaluationN;
  /** Objective evidence at the last accepted iterate. */
  readonly final: XpbdPackedIncrementalPotentialEvaluationN;
  /** Accepted iterations in execution order, empty when none were. */
  readonly iterations: readonly XpbdIncrementalPotentialIterationN[];
  /** Stable identity of the direction policy used for every attempt. */
  readonly directionPolicyId: string;
  /**
   * Packed-gradient norm threshold, in mass·length.
   *
   * Retained on every terminal, and still the stop test whenever
   * `convergence.kind` is `'packed-gradient'`. Under any other criterion this
   * is the inert default and did **not** decide the result — read
   * {@link convergence}, which names the criterion that did.
   */
  readonly gradientTolerance: number;
  /** The stop test that decided this result, and what it measured. */
  readonly convergence: XpbdIncrementalPotentialConvergenceEvidenceN;
  /** Authored accepted-step budget. */
  readonly maximumIterations: number;
  /**
   * Evidence of the final direction attempt.
   *
   * Present on a terminal reached because that attempt failed, so the record
   * of why survives the terminal rather than being discarded with it.
   */
  readonly directionEvidence?: XpbdIncrementalPotentialDirectionEvidenceN;
}

export interface XpbdIncrementalPotentialConvergedN
  extends XpbdIncrementalPotentialMinimizationBaseN {
  readonly status: 'converged';
  readonly convergencePoint: 'initial' | 'accepted-iterate';
}

export interface XpbdIncrementalPotentialIterationLimitN
  extends XpbdIncrementalPotentialMinimizationBaseN {
  readonly status: 'iteration-limit';
}

export interface XpbdIncrementalPotentialLineSearchExhaustedN
  extends XpbdIncrementalPotentialMinimizationBaseN {
  readonly status: 'line-search-exhausted';
  readonly search: XpbdArmijoExhaustedN;
}

/** Minimization refusal before any uncertified Armijo trial is evaluated. */
export interface XpbdIncrementalPotentialLineSearchRefusedN
  extends XpbdIncrementalPotentialMinimizationBaseN {
  /** Exact compiled objective and identity context. */
  readonly problem: XpbdIncrementalPotentialProblemN;
  /** Objective evidence at the authored initial coordinates. */
  readonly initial: XpbdPackedIncrementalPotentialEvaluationN;
  /** Last accepted objective evidence before refusal. */
  readonly final: XpbdPackedIncrementalPotentialEvaluationN;
  /** Accepted iterations preceding the refused search. */
  readonly iterations: readonly XpbdSteepestDescentIterationN[];
  /** Absolute gradient norm required for convergence. */
  readonly gradientTolerance: number;
  /** Authored accepted-step budget. */
  readonly maximumIterations: number;
  /** Distinct admissible-step refusal rather than numerical exhaustion. */
  readonly status: 'line-search-refused';
  /** Complete filter evidence from the refused Armijo search. */
  readonly search: XpbdArmijoStepFilterRefusedN;
}

export type XpbdIncrementalPotentialStallReasonN =
  | 'coordinate-resolution'
  | 'objective-resolution'
  | 'not-descent';

export interface XpbdIncrementalPotentialStalledN
  extends XpbdIncrementalPotentialMinimizationBaseN {
  readonly status: 'stalled';
  readonly reason: XpbdIncrementalPotentialStallReasonN;
  readonly search: XpbdArmijoAcceptedN | XpbdArmijoNotDescentN;
}

/**
 * Termination because the direction policy declined to propose a direction.
 *
 * Distinct from a stall: the minimizer did not run out of progress, it was
 * never given a direction to try. No Armijo trial was evaluated and no
 * coordinate moved.
 */
export interface XpbdIncrementalPotentialDirectionRefusedN
  extends XpbdIncrementalPotentialMinimizationBaseN {
  /** Distinguishes a policy refusal from a search or resolution terminal. */
  readonly status: 'direction-refused';
  /** Stable policy-stated reason, such as `'non-positive-curvature'`. */
  readonly reason: string;
}

/**
 * The authored base point lies outside one potential law's open domain.
 *
 * No objective evaluation was accepted and no coordinate moved. This is an
 * expected mathematical refusal for contact barriers, distinct from malformed
 * input or an ordinary provider failure, which still throws.
 */
export interface XpbdIncrementalPotentialInitialStateRefusedN {
  /** Distinguishes an inadmissible base from a refused trial step. */
  readonly status: 'initial-state-refused';
  /** Exact compiled objective and identity context. */
  readonly problem: XpbdIncrementalPotentialProblemN;
  /** Defensive copy of the packed coordinates that could not be evaluated. */
  readonly initialCoordinates: Float64Array;
  /** Stable identifier of the law whose open domain excluded the base. */
  readonly lawId: string;
  /** Machine-facing reason supplied by that law. */
  readonly reason: string;
  /** Human-facing explanation supplied by that law. */
  readonly message: string;
  /** Empty because no accepted iterate exists before the base evaluation. */
  readonly iterations: readonly [];
  /** Stable identity of the direction policy that would have been used. */
  readonly directionPolicyId: string;
  /** Authored gradient tolerance, retained for diagnosis. */
  readonly gradientTolerance: number;
  /**
   * The stop test that would have applied, retained for diagnosis.
   *
   * Carries no residuals: the base could not be evaluated, so neither
   * criterion has a measured value here.
   */
  readonly convergence: XpbdIncrementalPotentialConvergenceContractN;
  /** Authored iteration budget, retained for diagnosis. */
  readonly maximumIterations: number;
}

export type XpbdIncrementalPotentialMinimizationResultN =
  | XpbdIncrementalPotentialConvergedN
  | XpbdIncrementalPotentialInitialStateRefusedN
  | XpbdIncrementalPotentialDirectionRefusedN
  | XpbdIncrementalPotentialIterationLimitN
  | XpbdIncrementalPotentialLineSearchExhaustedN
  | XpbdIncrementalPotentialLineSearchRefusedN
  | XpbdIncrementalPotentialStalledN;

/**
 * Bounded Float64 first-order reference for a compiled packed problem.
 *
 * The default policy selects `direction = -gradient`. An authored policy may
 * choose another packed direction, while acceptance and typed
 * constitutive-domain backtracking remain delegated to Armijo. The routine
 * records every accepted iterate and never writes into live particles.
 */
export function minimizeXpbdIncrementalPotentialN(
  options: MinimizeXpbdIncrementalPotentialNOptions
): XpbdIncrementalPotentialMinimizationResultN {
  const caller = 'minimizeXpbdIncrementalPotentialN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  if (!(options.problem instanceof XpbdIncrementalPotentialProblemN)) {
    throw new Error(
      `${caller}: problem must be an XpbdIncrementalPotentialProblemN`
    );
  }
  // Refused before any evaluation, and before the problem is touched: the two
  // spellings carry different units, so there is no defensible way to reconcile
  // them and picking one silently would decide physics on the author's behalf.
  if (options.convergence !== undefined &&
    options.gradientTolerance !== undefined) {
    throw new Error(
      `${caller}: author either gradientTolerance or convergence, not both; ` +
      "gradientTolerance is the legacy spelling of " +
      "convergence: { kind: 'packed-gradient', tolerance }"
    );
  }
  const convergence = resolveConvergence(
    options.convergence,
    options.gradientTolerance,
    caller
  );
  // Legacy echo. Under a non-packed-gradient criterion nothing was authored
  // here (that combination is refused above), so this reports the untouched
  // default and `convergence` states what actually decided.
  const gradientTolerance = convergence.kind === 'packed-gradient'
    ? convergence.tolerance
    : DEFAULT_PACKED_GRADIENT_TOLERANCE;
  const maximumIterations = options.maximumIterations ?? 128;
  const initialStep = options.initialStep ?? 1;
  const contractionFactor = options.contractionFactor ?? 0.5;
  const sufficientDecrease = options.sufficientDecrease ?? 1e-4;
  const maximumLineSearchTrials = options.maximumLineSearchTrials ?? 32;
  const directionPolicy = resolveDirectionPolicy(
    options.directionPolicy,
    options.problem,
    caller
  );
  if (!Number.isFinite(convergence.tolerance) || convergence.tolerance < 0) {
    throw new Error(
      options.convergence === undefined
        ? `${caller}: gradientTolerance must be finite and non-negative`
        : `${caller}: convergence.tolerance must be finite and non-negative`
    );
  }
  if (!Number.isSafeInteger(maximumIterations) || maximumIterations < 0) {
    throw new Error(
      `${caller}: maximumIterations must be a non-negative integer`
    );
  }
  if (!Number.isFinite(initialStep) || initialStep <= 0) {
    throw new Error(`${caller}: initialStep must be finite and positive`);
  }
  if (!Number.isFinite(contractionFactor) ||
    contractionFactor <= 0 ||
    contractionFactor >= 1) {
    throw new Error(`${caller}: contractionFactor must be in (0, 1)`);
  }
  if (!Number.isFinite(sufficientDecrease) ||
    sufficientDecrease <= 0 ||
    sufficientDecrease >= 1) {
    throw new Error(`${caller}: sufficientDecrease must be in (0, 1)`);
  }
  if (!Number.isSafeInteger(maximumLineSearchTrials) ||
    maximumLineSearchTrials < 1) {
    throw new Error(
      `${caller}: maximumLineSearchTrials must be a positive integer`
    );
  }
  validateDirectionPolicy(directionPolicy, caller);
  const directionPolicyId = directionPolicy.id;

  let initial: XpbdPackedIncrementalPotentialEvaluationN;
  try {
    initial = options.problem.evaluate(options.initialCoordinates);
  } catch (error) {
    if (!(error instanceof XpbdPotentialDomainErrorN)) throw error;
    return Object.freeze({
      status: 'initial-state-refused',
      problem: options.problem,
      initialCoordinates: Float64Array.from(options.initialCoordinates),
      lawId: error.lawId,
      reason: error.reason,
      message: error.message,
      iterations: Object.freeze([]) as readonly [],
      directionPolicyId,
      gradientTolerance,
      convergence: Object.freeze({ ...convergence }),
      maximumIterations
    });
  }
  const freeParticleInverseMasses = Float64Array.from(
    options.problem.freeParticleIndices,
    (particleIndex) => options.problem.particles[particleIndex]!.inverseMass
  );
  const residualOf = (
    evaluation: XpbdPackedIncrementalPotentialEvaluationN
  ): number => convergenceResidual(
    convergence.kind,
    evaluation,
    options.problem.dimension,
    freeParticleInverseMasses,
    options.problem.deltaTime
  );
  const initialResidual = residualOf(initial);
  const evidence = (
    final: XpbdPackedIncrementalPotentialEvaluationN
  ): XpbdIncrementalPotentialConvergenceEvidenceN => Object.freeze({
    kind: convergence.kind,
    tolerance: convergence.tolerance,
    initialResidual,
    finalResidual: residualOf(final)
  });

  let current = initial;
  const iterations: XpbdIncrementalPotentialIterationN[] = [];
  if (initialResidual <= convergence.tolerance) {
    return resultBase({
      status: 'converged',
      convergencePoint: 'initial',
      problem: options.problem,
      initial,
      final: current,
      iterations,
      directionPolicyId,
      gradientTolerance,
      convergence: evidence(current),
      maximumIterations
    });
  }

  for (let index = 0; index < maximumIterations; index++) {
    const proposal = evaluateDirectionPolicy(
      directionPolicy,
      {
        dimension: options.problem.dimension,
        deltaTime: options.problem.deltaTime,
        iterationIndex: index,
        coordinates: current.coordinates.slice(),
        gradient: current.gradient.slice(),
        gradientNorm: current.gradientNorm,
        freeParticleIndices: Object.freeze(
          options.problem.freeParticleIndices.slice()
        ),
        freeParticleInverseMasses: freeParticleInverseMasses.slice()
      },
      options.problem.variableCount,
      caller
    );
    if (proposal.status === 'refused') {
      // No trial was evaluated and nothing moved, so the last accepted
      // iterate is still the final state.
      return resultBase({
        status: 'direction-refused',
        reason: proposal.reason,
        ...(proposal.evidence === undefined
          ? {}
          : { directionEvidence: proposal.evidence }),
        problem: options.problem,
        initial,
        final: current,
        iterations,
        directionPolicyId,
        gradientTolerance,
        convergence: evidence(current),
        maximumIterations
      });
    }
    const { direction, evidence: directionEvidence } = proposal;
    // `current` is by construction the evaluation of `current.coordinates` —
    // it is either the initial evaluation or a previously accepted trial — so
    // the search does not need to re-derive it.
    const search = searchXpbdIncrementalPotentialArmijoFromBaseN({
      problem: options.problem,
      coordinates: current.coordinates,
      direction,
      initialStep,
      contractionFactor,
      sufficientDecrease,
      maximumTrials: maximumLineSearchTrials
    }, current);
    if (search.status === 'not-descent') {
      return resultBase({
        status: 'stalled',
        reason: 'not-descent',
        search,
        ...(directionEvidence === undefined ? {} : { directionEvidence }),
        problem: options.problem,
        initial,
        final: current,
        iterations,
        directionPolicyId,
        gradientTolerance,
        convergence: evidence(current),
        maximumIterations
      });
    }
    if (search.status === 'exhausted') {
      return resultBase({
        status: 'line-search-exhausted',
        search,
        ...(directionEvidence === undefined ? {} : { directionEvidence }),
        problem: options.problem,
        initial,
        final: current,
        iterations,
        directionPolicyId,
        gradientTolerance,
        convergence: evidence(current),
        maximumIterations
      });
    }
    if (search.status === 'step-filter-refused') {
      return resultBase({
        status: 'line-search-refused',
        search,
        ...(directionEvidence === undefined ? {} : { directionEvidence }),
        problem: options.problem,
        initial,
        final: current,
        iterations,
        directionPolicyId,
        gradientTolerance,
        convergence: evidence(current),
        maximumIterations
      });
    }

    let stepNorm = 0;
    let coordinatesChanged = false;
    for (let coordinate = 0; coordinate < direction.length; coordinate++) {
      stepNorm = Math.hypot(
        stepNorm,
        search.stepLength * direction[coordinate]!
      );
      coordinatesChanged ||= search.accepted.coordinates[coordinate] !==
        current.coordinates[coordinate];
    }
    if (!Number.isFinite(stepNorm)) {
      throw new Error(`${caller}: accepted step norm is outside Float64`);
    }
    const objectiveDecrease =
      current.objective - search.accepted.objective;
    if (!Number.isFinite(objectiveDecrease)) {
      throw new Error(`${caller}: objective decrease is outside Float64`);
    }
    const iteration = Object.freeze({
      index,
      directionPolicyId,
      direction,
      search,
      stepNorm,
      objectiveDecrease,
      ...(directionEvidence === undefined ? {} : { directionEvidence })
    });
    iterations.push(iteration);

    if (!coordinatesChanged) {
      return resultBase({
        status: 'stalled',
        reason: 'coordinate-resolution',
        search,
        ...(directionEvidence === undefined ? {} : { directionEvidence }),
        problem: options.problem,
        initial,
        final: current,
        iterations,
        directionPolicyId,
        gradientTolerance,
        convergence: evidence(current),
        maximumIterations
      });
    }

    current = search.accepted;
    if (residualOf(current) <= convergence.tolerance) {
      return resultBase({
        status: 'converged',
        convergencePoint: 'accepted-iterate',
        problem: options.problem,
        initial,
        final: current,
        iterations,
        directionPolicyId,
        gradientTolerance,
        convergence: evidence(current),
        maximumIterations
      });
    }
    if (!(objectiveDecrease > 0)) {
      return resultBase({
        status: 'stalled',
        reason: 'objective-resolution',
        search,
        ...(directionEvidence === undefined ? {} : { directionEvidence }),
        problem: options.problem,
        initial,
        final: current,
        iterations,
        directionPolicyId,
        gradientTolerance,
        convergence: evidence(current),
        maximumIterations
      });
    }
  }

  return resultBase({
    status: 'iteration-limit',
    problem: options.problem,
    initial,
    final: current,
    iterations,
    directionPolicyId,
    gradientTolerance,
    convergence: evidence(current),
    maximumIterations
  });
}

/**
 * Turns the two authored spellings into one criterion.
 *
 * Only one of them can be present; the caller refuses both before reaching
 * here, so this never has to reconcile a disagreement.
 */
function resolveConvergence(
  authored: XpbdIncrementalPotentialConvergenceN | undefined,
  legacyGradientTolerance: number | undefined,
  caller: string
): XpbdIncrementalPotentialConvergenceContractN {
  if (authored === undefined) {
    return {
      kind: 'packed-gradient',
      tolerance: legacyGradientTolerance ?? DEFAULT_PACKED_GRADIENT_TOLERANCE
    };
  }
  if (typeof authored !== 'object' || authored === null) {
    throw new Error(`${caller}: convergence must be an object`);
  }
  // Read before narrowing: inside the refusal branch `authored` is `never`,
  // and the message has to be able to name what was actually passed.
  const kind: unknown = authored.kind;
  if (kind !== 'packed-gradient' &&
    kind !== 'maximum-acceleration-residual') {
    throw new Error(
      `${caller}: convergence.kind must be 'packed-gradient' or ` +
      `'maximum-acceleration-residual', received ${JSON.stringify(kind)}`
    );
  }
  return { kind, tolerance: authored.tolerance };
}

/**
 * The residual a criterion compares against its tolerance.
 *
 * `'packed-gradient'` reads the evaluation's own `gradientNorm` rather than
 * recomputing it. That is deliberate: the shipped norm is a `Math.hypot` fold
 * and is not bitwise equal to `sqrt(Σ g²)` — the two disagree by an ULP on
 * some problems, which is enough to move a boundary case between converging at
 * the initial point and converging one iterate later. Recomputing here would
 * silently change existing results.
 */
function convergenceResidual(
  kind: XpbdIncrementalPotentialConvergenceKindN,
  evaluation: XpbdPackedIncrementalPotentialEvaluationN,
  dimension: number,
  freeParticleInverseMasses: Float64Array,
  deltaTime: number
): number {
  if (kind === 'packed-gradient') return evaluation.gradientNorm;
  const deltaTimeSquared = deltaTime * deltaTime;
  let maximum = 0;
  for (let slot = 0; slot < freeParticleInverseMasses.length; slot++) {
    const base = slot * dimension;
    let sumOfSquares = 0;
    for (let axis = 0; axis < dimension; axis++) {
      const component = evaluation.gradient[base + axis]!;
      sumOfSquares += component * component;
    }
    // inverseMass is 1/mass on a free particle, so multiplying by it is the
    // division by mass the criterion is defined with. Free particles are the
    // only ones packed, so this loop is already the "excluding fixed" set.
    const residual =
      Math.sqrt(sumOfSquares) * freeParticleInverseMasses[slot]! /
      deltaTimeSquared;
    if (residual > maximum) maximum = residual;
  }
  return maximum;
}

/**
 * Turns an authored policy or policy name into a policy.
 *
 * Named policies are built here rather than by the caller because the Newton
 * policy closes over the compiled problem, which only this side holds.
 */
function resolveDirectionPolicy(
  authored:
    | XpbdIncrementalPotentialDirectionPolicyN
    | XpbdIncrementalPotentialDirectionPolicyNameN
    | undefined,
  problem: XpbdIncrementalPotentialProblemN,
  caller: string
): XpbdIncrementalPotentialDirectionPolicyN {
  if (authored === undefined) return xpbdSteepestDescentDirectionN;
  if (typeof authored !== 'string') return authored;
  switch (authored) {
    case 'steepest-descent':
      return xpbdSteepestDescentDirectionN;
    case 'mass-diagonal':
      return xpbdMassPreconditionedDirectionN;
    case 'newton-cg':
      return xpbdNewtonDirectionPolicyN({ problem });
    default:
      throw new Error(
        `${caller}: unknown direction policy ${JSON.stringify(authored)}`
      );
  }
}

function validateDirectionPolicy(
  policy: XpbdIncrementalPotentialDirectionPolicyN,
  caller: string
): void {
  if (typeof policy !== 'object' || policy === null) {
    throw new Error(`${caller}: directionPolicy must be an object`);
  }
  if (typeof policy.id !== 'string' || policy.id.trim().length === 0) {
    throw new Error(`${caller}: directionPolicy id must be non-empty`);
  }
  if (typeof policy.evaluate !== 'function') {
    throw new Error(`${caller}: directionPolicy must define evaluate()`);
  }
}

/** One validated direction, or the policy's refusal to propose one. */
type EvaluatedDirectionN =
  | {
    readonly status: 'direction';
    readonly direction: Float64Array;
    readonly evidence?: XpbdIncrementalPotentialDirectionEvidenceN;
  }
  | {
    readonly status: 'refused';
    readonly reason: string;
    readonly evidence?: XpbdIncrementalPotentialDirectionEvidenceN;
  };

function evaluateDirectionPolicy(
  policy: XpbdIncrementalPotentialDirectionPolicyN,
  context: XpbdIncrementalPotentialDirectionContextN,
  variableCount: number,
  caller: string
): EvaluatedDirectionN {
  const output = policy.evaluate(Object.freeze(context));
  if (typeof output !== 'object' || output === null) {
    throw new Error(
      `${caller}: directionPolicy "${policy.id}" must return ${variableCount} components`
    );
  }

  // A packed direction is indexed, not tagged. Only an outcome object carries
  // a string `status`, so the original contract is read exactly as before and
  // a policy predating this seam cannot be misread as refusing.
  const tagged = output as { readonly status?: unknown };
  if (typeof tagged.status === 'string') {
    if (tagged.status === 'refused') {
      const refusal = output as XpbdIncrementalPotentialDirectionRefusalN;
      if (typeof refusal.reason !== 'string' || refusal.reason.trim().length === 0) {
        throw new Error(
          `${caller}: directionPolicy "${policy.id}" refusal must state a reason`
        );
      }
      return {
        status: 'refused',
        reason: refusal.reason,
        ...(refusal.evidence === undefined ? {} : { evidence: refusal.evidence })
      };
    }
    if (tagged.status !== 'direction') {
      throw new Error(
        `${caller}: directionPolicy "${policy.id}" returned unknown status "${String(tagged.status)}"`
      );
    }
    const proposal = output as XpbdIncrementalPotentialDirectionProposalN;
    return {
      status: 'direction',
      direction: packedDirection(proposal.direction, policy.id, variableCount, caller),
      ...(proposal.evidence === undefined ? {} : { evidence: proposal.evidence })
    };
  }

  return {
    status: 'direction',
    direction: packedDirection(
      output as ArrayLike<number>,
      policy.id,
      variableCount,
      caller
    )
  };
}

/** Length and finiteness hold identically for a bare value and a proposal. */
function packedDirection(
  output: ArrayLike<number>,
  policyId: string,
  variableCount: number,
  caller: string
): Float64Array {
  if (typeof output !== 'object' || output === null ||
    output.length !== variableCount) {
    throw new Error(
      `${caller}: directionPolicy "${policyId}" must return ${variableCount} components`
    );
  }
  const direction = new Float64Array(variableCount);
  for (let index = 0; index < variableCount; index++) {
    const component = output[index]!;
    if (!Number.isFinite(component)) {
      throw new Error(
        `${caller}: directionPolicy "${policyId}" component ${index} must be finite`
      );
    }
    direction[index] = component;
  }
  return direction;
}

function resultBase<const T extends XpbdIncrementalPotentialMinimizationBaseN>(
  result: T
): T {
  return Object.freeze({
    ...result,
    iterations: Object.freeze(result.iterations.slice())
  });
}
