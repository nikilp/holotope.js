import {
  XpbdIncrementalPotentialProblemN,
  type XpbdPackedIncrementalPotentialEvaluationN
} from './xpbd-incremental-potential-problem.js';
import { XpbdPotentialDomainErrorN } from './xpbd-potential-domain.js';

/** Options for a bounded chord search from an authored anchor to a target. */
export interface RecoverXpbdIncrementalPotentialFeasibleBaseNOptions {
  /** Compiled objective whose complete open domain is queried. */
  readonly problem: XpbdIncrementalPotentialProblemN;
  /** Known or suspected admissible packed coordinate; chord fraction zero. */
  readonly anchorCoordinates: ArrayLike<number>;
  /**
   * Packed coordinate this invocation searches toward; evaluated first.
   *
   * Every fraction this search reports — on the result and on each trial — is
   * measured along the chord from `anchorCoordinates` to THIS coordinate.
   * It is whatever the caller supplied, which is not necessarily an inertial
   * prediction: the integrated step's filtered warm start supplies the
   * filter-certified endpoint of the movement, which coincides with the
   * prediction only when every registered filter certifies the whole
   * movement. Reconstructing a coordinate from a reported fraction is only
   * correct against the target actually passed here.
   */
  readonly targetCoordinates: ArrayLike<number>;
  /** Geometric contraction in `(0, 1)`; default `0.5`. */
  readonly contractionFactor?: number;
  /** Positive interior-sample budget; default 32. */
  readonly maximumTrials?: number;
}

/** Bounded sampling policy for the integrated feasible-prediction warm start. */
export interface XpbdIncrementalPotentialFeasibleWarmStartNOptions {
  /** Geometric contraction in `(0, 1)`; default `0.5`. */
  readonly contractionFactor?: number;
  /** Positive interior-sample budget; default 32. */
  readonly maximumTrials?: number;
}

/** Stable typed refusal retained from one complete objective evaluation. */
export interface XpbdFeasibleBaseDomainRefusalN {
  /** Potential-law identity that refused the coordinate. */
  readonly lawId: string;
  /** Stable law-specific refusal reason. */
  readonly reason: string;
  /** Human-facing message from the refusing law. */
  readonly message: string;
}

/** One admissible or typed-domain-refused chord evaluation. */
export type XpbdFeasibleBaseTrialN =
  | ({
      /** Zero-based evaluation order: target, anchor, then interior samples. */
      readonly index: number;
      /**
       * Chord fraction: zero is `anchorCoordinates`, one is the
       * `targetCoordinates` supplied to this invocation.
       */
      readonly fraction: number;
      /** Defensive packed coordinate evaluated by this trial. */
      readonly coordinates: Float64Array;
      /** The complete objective accepted this coordinate. */
      readonly status: 'feasible';
      /** Complete objective evidence at the accepted coordinate. */
      readonly evaluation: XpbdPackedIncrementalPotentialEvaluationN;
    })
  | ({
      /** Zero-based evaluation order: target, anchor, then interior samples. */
      readonly index: number;
      /**
       * Chord fraction: zero is `anchorCoordinates`, one is the
       * `targetCoordinates` supplied to this invocation.
       */
      readonly fraction: number;
      /** Defensive packed coordinate evaluated by this trial. */
      readonly coordinates: Float64Array;
      /** One potential law excluded this coordinate from its open domain. */
      readonly status: 'domain-refused';
      /** Stable evidence copied from the typed domain error. */
      readonly refusal: XpbdFeasibleBaseDomainRefusalN;
    });

/** Bounded feasible-base evidence without a physical projection claim. */
export type XpbdIncrementalPotentialFeasibleBaseResultN =
  | {
      /** The requested target already belongs to the complete objective domain. */
      readonly status: 'target-feasible';
      /**
       * The whole chord: the accepted coordinate is the `targetCoordinates`
       * supplied to this invocation — NOT necessarily an inertial prediction.
       */
      readonly fraction: 1;
      readonly evaluation: XpbdPackedIncrementalPotentialEvaluationN;
      readonly trials: readonly XpbdFeasibleBaseTrialN[];
    }
  | {
      /** The first sampled positive chord fraction was feasible. */
      readonly status: 'recovered';
      /**
       * Interior fraction of the `anchorCoordinates`-to-`targetCoordinates`
       * chord of this invocation, in `(0, 1)`.
       */
      readonly fraction: number;
      readonly evaluation: XpbdPackedIncrementalPotentialEvaluationN;
      readonly trials: readonly XpbdFeasibleBaseTrialN[];
    }
  | {
      /** Only the authored anchor was established feasible within the budget. */
      readonly status: 'anchor-only';
      /** The chord origin: the accepted coordinate is `anchorCoordinates`. */
      readonly fraction: 0;
      readonly evaluation: XpbdPackedIncrementalPotentialEvaluationN;
      readonly trials: readonly XpbdFeasibleBaseTrialN[];
    }
  | {
      /** Neither target nor anchor provides a valid base from which to search. */
      readonly status: 'anchor-refused';
      readonly targetRefusal: XpbdFeasibleBaseDomainRefusalN;
      readonly anchorRefusal: XpbdFeasibleBaseDomainRefusalN;
      readonly trials: readonly XpbdFeasibleBaseTrialN[];
    };

/**
 * Finds the first tested feasible point along a target-to-anchor chord.
 *
 * This is a minimizer-initialization query, not depenetration or collision
 * response. It makes no nearest-point, global-feasibility, or segment-safety
 * claim: feasibility of a COORDINATE says the complete objective is defined
 * there, never that the movement to it is admissible. The integrated step
 * certifies every automatically selected warm-start movement with the
 * registered step filters before installing a base and passes this search a
 * target already inside the certified movement; a direct caller of this
 * function receives no such certification and must consult the filters
 * itself if the chord's admissibility matters. In a non-convex domain,
 * feasible fractions may exist between the geometric samples this bounded
 * search does not visit.
 *
 * Evaluation order is fixed: target once, anchor once after a typed target
 * refusal, then `contractionFactor^k` for `k = 1..maximumTrials`. Ordinary
 * provider errors remain errors and are rethrown unchanged.
 *
 * Every reported fraction — on the result and on each trial — is in this
 * invocation's own `anchorCoordinates`-to-`targetCoordinates` frame, and in
 * no other. That frame is generic: it is always the chord this call was
 * given. When the integrated filtered warm start supplies a filter-certified
 * endpoint as the target, fraction one is that endpoint — which equals the
 * inertial prediction only under a fully certifying `safe` verdict — so any
 * NONZERO fraction reconstructed against prediction coordinates otherwise
 * names the wrong point. Zero is the exception in every frame: it is the
 * anchor. Reconstruction is unnecessary regardless — the accepted coordinate
 * is carried directly on `evaluation.coordinates`, which the `anchor-refused`
 * result, having accepted none, does not have.
 */
export function recoverXpbdIncrementalPotentialFeasibleBaseN(
  options: RecoverXpbdIncrementalPotentialFeasibleBaseNOptions
): XpbdIncrementalPotentialFeasibleBaseResultN {
  const caller = 'recoverXpbdIncrementalPotentialFeasibleBaseN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  const unknown = Object.keys(options).filter(
    (key) =>
      key !== 'problem' &&
      key !== 'anchorCoordinates' &&
      key !== 'targetCoordinates' &&
      key !== 'contractionFactor' &&
      key !== 'maximumTrials'
  );
  if (unknown.length > 0) {
    throw new Error(
      `${caller}: options have unknown option${unknown.length === 1 ? '' : 's'} ` +
        unknown.map((key) => `"${key}"`).join(', ')
    );
  }
  if (!(options.problem instanceof XpbdIncrementalPotentialProblemN)) {
    throw new Error(`${caller}: problem must be an XpbdIncrementalPotentialProblemN`);
  }
  const contractionFactor = options.contractionFactor ?? 0.5;
  const maximumTrials = options.maximumTrials ?? 32;
  if (!Number.isFinite(contractionFactor) ||
    contractionFactor <= 0 || contractionFactor >= 1) {
    throw new Error(`${caller}: contractionFactor must be finite and in (0, 1)`);
  }
  if (!Number.isSafeInteger(maximumTrials) || maximumTrials < 1) {
    throw new Error(`${caller}: maximumTrials must be a positive integer`);
  }
  const anchor = finiteCoordinates(
    options.anchorCoordinates,
    options.problem.variableCount,
    `${caller}: anchorCoordinates`
  );
  const target = finiteCoordinates(
    options.targetCoordinates,
    options.problem.variableCount,
    `${caller}: targetCoordinates`
  );
  const trials: XpbdFeasibleBaseTrialN[] = [];

  const targetAttempt = evaluateTrial(options.problem, target, 1, 0);
  trials.push(targetAttempt);
  if (targetAttempt.status === 'feasible') {
    return Object.freeze({
      status: 'target-feasible',
      fraction: 1,
      evaluation: targetAttempt.evaluation,
      trials: Object.freeze(trials)
    });
  }

  const anchorAttempt = evaluateTrial(options.problem, anchor, 0, 1);
  trials.push(anchorAttempt);
  if (anchorAttempt.status === 'domain-refused') {
    return Object.freeze({
      status: 'anchor-refused',
      targetRefusal: targetAttempt.refusal,
      anchorRefusal: anchorAttempt.refusal,
      trials: Object.freeze(trials)
    });
  }

  for (let sample = 1; sample <= maximumTrials; sample++) {
    const fraction = contractionFactor ** sample;
    if (fraction === 0) break;
    const coordinates = new Float64Array(options.problem.variableCount);
    for (let index = 0; index < coordinates.length; index++) {
      const coordinate = anchor[index]! + fraction * (target[index]! - anchor[index]!);
      if (!Number.isFinite(coordinate)) {
        throw new Error(`${caller}: sampled coordinate is outside Float64`);
      }
      coordinates[index] = coordinate;
    }
    const attempt = evaluateTrial(
      options.problem,
      coordinates,
      fraction,
      trials.length
    );
    trials.push(attempt);
    if (attempt.status === 'feasible') {
      return Object.freeze({
        status: 'recovered',
        fraction,
        evaluation: attempt.evaluation,
        trials: Object.freeze(trials)
      });
    }
  }

  return Object.freeze({
    status: 'anchor-only',
    fraction: 0,
    evaluation: anchorAttempt.evaluation,
    trials: Object.freeze(trials)
  });
}

function evaluateTrial(
  problem: XpbdIncrementalPotentialProblemN,
  coordinates: Float64Array,
  fraction: number,
  index: number
): XpbdFeasibleBaseTrialN {
  try {
    const evaluation = problem.evaluate(coordinates);
    return Object.freeze({
      index,
      fraction,
      coordinates: evaluation.coordinates.slice(),
      status: 'feasible',
      evaluation
    });
  } catch (error) {
    if (!(error instanceof XpbdPotentialDomainErrorN)) throw error;
    return Object.freeze({
      index,
      fraction,
      coordinates: coordinates.slice(),
      status: 'domain-refused',
      refusal: domainRefusal(error)
    });
  }
}

function domainRefusal(error: XpbdPotentialDomainErrorN): XpbdFeasibleBaseDomainRefusalN {
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
  if ((typeof value !== 'object' && typeof value !== 'function') ||
    value === null || typeof value.length !== 'number' ||
    value.length !== expectedLength) {
    throw new Error(`${label} must have length ${expectedLength}`);
  }
  const coordinates = Float64Array.from(value);
  for (const coordinate of coordinates) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${label} must be finite`);
    }
  }
  return coordinates;
}
