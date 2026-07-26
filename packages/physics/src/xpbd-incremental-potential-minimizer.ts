import {
  XpbdIncrementalPotentialProblemN,
  searchXpbdIncrementalPotentialArmijoN,
  type XpbdArmijoAcceptedN,
  type XpbdArmijoExhaustedN,
  type XpbdArmijoNotDescentN,
  type XpbdArmijoStepFilterRefusedN,
  type XpbdPackedIncrementalPotentialEvaluationN
} from './xpbd-incremental-potential-problem.js';
import {
  xpbdSteepestDescentDirectionN,
  type XpbdIncrementalPotentialDirectionContextN,
  type XpbdIncrementalPotentialDirectionPolicyN
} from './xpbd-incremental-potential-direction.js';

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
  /** Packed search-direction policy; defaults to steepest descent. */
  readonly directionPolicy?: XpbdIncrementalPotentialDirectionPolicyN;
}

/** Complete evidence for one Armijo-accepted search-direction attempt. */
export interface XpbdIncrementalPotentialIterationN {
  readonly index: number;
  /** Stable identity of the policy that produced `direction`. */
  readonly directionPolicyId: string;
  readonly direction: Float64Array;
  readonly search: XpbdArmijoAcceptedN;
  readonly stepNorm: number;
  readonly objectiveDecrease: number;
}

/**
 * Backward-compatible name for one accepted minimizer iteration.
 *
 * @deprecated Use `XpbdIncrementalPotentialIterationN`.
 */
export type XpbdSteepestDescentIterationN =
  XpbdIncrementalPotentialIterationN;

interface XpbdIncrementalPotentialMinimizationBaseN {
  readonly problem: XpbdIncrementalPotentialProblemN;
  readonly initial: XpbdPackedIncrementalPotentialEvaluationN;
  readonly final: XpbdPackedIncrementalPotentialEvaluationN;
  readonly iterations: readonly XpbdIncrementalPotentialIterationN[];
  /** Stable identity of the direction policy used for every attempt. */
  readonly directionPolicyId: string;
  readonly gradientTolerance: number;
  readonly maximumIterations: number;
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

export type XpbdIncrementalPotentialMinimizationResultN =
  | XpbdIncrementalPotentialConvergedN
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
  const directionPolicy = options.directionPolicy === undefined
    ? xpbdSteepestDescentDirectionN
    : options.directionPolicy;
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

  const initial = options.problem.evaluate(options.initialCoordinates);
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
    const direction = evaluateDirectionPolicy(
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
    const search = searchXpbdIncrementalPotentialArmijoN({
      problem: options.problem,
      coordinates: current.coordinates,
      direction,
      initialStep,
      contractionFactor,
      sufficientDecrease,
      maximumTrials: maximumLineSearchTrials
    });
    if (search.status === 'not-descent') {
      return resultBase({
        status: 'stalled',
        reason: 'not-descent',
        search,
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
      objectiveDecrease
    });
    iterations.push(iteration);

    if (!coordinatesChanged) {
      return resultBase({
        status: 'stalled',
        reason: 'coordinate-resolution',
        search,
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

function evaluateDirectionPolicy(
  policy: XpbdIncrementalPotentialDirectionPolicyN,
  context: XpbdIncrementalPotentialDirectionContextN,
  variableCount: number,
  caller: string
): Float64Array {
  const output = policy.evaluate(Object.freeze(context));
  if (typeof output !== 'object' || output === null ||
    output.length !== variableCount) {
    throw new Error(
      `${caller}: directionPolicy "${policy.id}" must return ${variableCount} components`
    );
  }
  const direction = new Float64Array(variableCount);
  for (let index = 0; index < variableCount; index++) {
    const component = output[index]!;
    if (!Number.isFinite(component)) {
      throw new Error(
        `${caller}: directionPolicy "${policy.id}" component ${index} must be finite`
      );
    }
    direction[index] = component;
  }
  return direction;
}

function resultBase<T extends XpbdIncrementalPotentialMinimizationBaseN>(
  result: T
): T {
  return Object.freeze({
    ...result,
    iterations: Object.freeze(result.iterations.slice())
  });
}
