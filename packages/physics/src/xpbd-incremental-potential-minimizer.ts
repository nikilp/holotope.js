import {
  XpbdIncrementalPotentialProblemN,
  searchXpbdIncrementalPotentialArmijoN,
  type XpbdArmijoAcceptedN,
  type XpbdArmijoExhaustedN,
  type XpbdArmijoNotDescentN,
  type XpbdPackedIncrementalPotentialEvaluationN
} from './xpbd-incremental-potential-problem.js';

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
}

/** Complete evidence for one Armijo-accepted steepest-descent attempt. */
export interface XpbdSteepestDescentIterationN {
  readonly index: number;
  readonly direction: Float64Array;
  readonly search: XpbdArmijoAcceptedN;
  readonly stepNorm: number;
  readonly objectiveDecrease: number;
}

interface XpbdIncrementalPotentialMinimizationBaseN {
  readonly initial: XpbdPackedIncrementalPotentialEvaluationN;
  readonly final: XpbdPackedIncrementalPotentialEvaluationN;
  readonly iterations: readonly XpbdSteepestDescentIterationN[];
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
  | XpbdIncrementalPotentialStalledN;

/**
 * Bounded Float64 steepest-descent reference for a compiled P25 problem.
 *
 * The routine selects `direction = -gradient`, delegates acceptance and typed
 * constitutive-domain backtracking to the P25 Armijo search, and records every
 * accepted iterate. It never writes the packed result into live particles.
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

  const initial = options.problem.evaluate(options.initialCoordinates);
  let current = initial;
  const iterations: XpbdSteepestDescentIterationN[] = [];
  if (current.gradientNorm <= gradientTolerance) {
    return resultBase({
      status: 'converged',
      convergencePoint: 'initial',
      initial,
      final: current,
      iterations,
      gradientTolerance,
      maximumIterations
    });
  }

  for (let index = 0; index < maximumIterations; index++) {
    const direction = Float64Array.from(
      current.gradient,
      (component) => -component
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
        initial,
        final: current,
        iterations,
        gradientTolerance,
        maximumIterations
      });
    }
    if (search.status === 'exhausted') {
      return resultBase({
        status: 'line-search-exhausted',
        search,
        initial,
        final: current,
        iterations,
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
        initial,
        final: current,
        iterations,
        gradientTolerance,
        maximumIterations
      });
    }

    current = search.accepted;
    if (current.gradientNorm <= gradientTolerance) {
      return resultBase({
        status: 'converged',
        convergencePoint: 'accepted-iterate',
        initial,
        final: current,
        iterations,
        gradientTolerance,
        maximumIterations
      });
    }
    if (!(objectiveDecrease > 0)) {
      return resultBase({
        status: 'stalled',
        reason: 'objective-resolution',
        search,
        initial,
        final: current,
        iterations,
        gradientTolerance,
        maximumIterations
      });
    }
  }

  return resultBase({
    status: 'iteration-limit',
    initial,
    final: current,
    iterations,
    gradientTolerance,
    maximumIterations
  });
}

function resultBase<T extends XpbdIncrementalPotentialMinimizationBaseN>(
  result: T
): T {
  return Object.freeze({
    ...result,
    iterations: Object.freeze(result.iterations.slice())
  });
}
