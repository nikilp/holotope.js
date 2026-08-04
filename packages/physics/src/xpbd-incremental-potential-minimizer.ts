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

export interface MinimizeXpbdIncrementalPotentialNOptions {
  readonly problem: XpbdIncrementalPotentialProblemN;
  readonly initialCoordinates: ArrayLike<number>;
  /** Absolute packed-gradient norm tolerance; default `1e-8`. */
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
  /** Absolute packed-gradient norm required for convergence. */
  readonly gradientTolerance: number;
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
  const gradientTolerance = options.gradientTolerance ?? 1e-8;
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
  if (!Number.isFinite(gradientTolerance) || gradientTolerance < 0) {
    throw new Error(
      `${caller}: gradientTolerance must be finite and non-negative`
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
      maximumIterations
    });
  }
  let current = initial;
  const iterations: XpbdIncrementalPotentialIterationN[] = [];
  if (current.gradientNorm <= gradientTolerance) {
    return resultBase({
      status: 'converged',
      convergencePoint: 'initial',
      problem: options.problem,
      initial,
      final: current,
      iterations,
      directionPolicyId,
      gradientTolerance,
      maximumIterations
    });
  }

  const freeParticleInverseMasses = Float64Array.from(
    options.problem.freeParticleIndices,
    (particleIndex) => options.problem.particles[particleIndex]!.inverseMass
  );
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
        maximumIterations
      });
    }

    current = search.accepted;
    if (current.gradientNorm <= gradientTolerance) {
      return resultBase({
        status: 'converged',
        convergencePoint: 'accepted-iterate',
        problem: options.problem,
        initial,
        final: current,
        iterations,
        directionPolicyId,
        gradientTolerance,
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
    maximumIterations
  });
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
