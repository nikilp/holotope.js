import type {
  XpbdIncrementalPotentialStepProgressN,
  XpbdIncrementalPotentialStepResultN
} from './xpbd-incremental-potential-step.js';
import type {
  XpbdIncrementalPotentialConvergenceContractN,
  XpbdIncrementalPotentialConvergenceEvidenceN,
  XpbdIncrementalPotentialConvergenceKindN,
  XpbdIncrementalPotentialInitialStateRefusedN
} from './xpbd-incremental-potential-minimizer.js';
import type {
  XpbdFeasibleBaseDomainRefusalN,
  XpbdFeasibleBaseTrialN
} from './xpbd-incremental-potential-feasible-base.js';

/** Decision-ready condition classified from retained incremental-step evidence. */
export type XpbdIncrementalPotentialDiagnosisConditionN =
  | 'progressed'
  | 'converged-without-iteration'
  | 'initial-state-refused'
  | 'iteration-limit'
  | 'line-search-exhausted'
  | 'line-search-refused'
  | 'direction-refused'
  | 'stalled'
  | 'application-refused';

/**
 * A legitimate caller-controlled response to one diagnosed condition.
 *
 * Levers are named, never applied. The classifier therefore cannot silently
 * change solver policy or turn a loud refusal into an apparent success.
 */
export type XpbdIncrementalPotentialDiagnosisLeverN =
  | 'warm-start-previous-positions'
  | 'warm-start-feasible-inertial-prediction'
  | 'repair-initial-state'
  | 'newton-direction-policy'
  | 'mass-diagonal-policy'
  | 'raise-iteration-budget'
  | 'lower-gradient-tolerance'
  /** Lower the authored threshold of a non-packed-gradient stop test. */
  | 'lower-convergence-tolerance'
  /**
   * Re-author the stop test in a unit that does not move with the timestep.
   *
   * Offered only under `'packed-gradient'`, where the threshold is on a
   * quantity carrying a `deltaTime²` factor and an immediate accept can mean
   * a real force fell below the solver's resolution rather than that the
   * scene is at rest.
   */
  | 'timestep-independent-convergence'
  | 'inspect-blocking-filter'
  | 'inspect-application-evidence';

/**
 * Which stop test was in force, on every terminal including the refused base.
 *
 * Takes the contract rather than the evidence because the initial-state
 * refusal has no residuals to report: nothing was evaluated, so neither
 * criterion has a measured value there.
 */
function convergenceContractFacts(
  convergence: XpbdIncrementalPotentialConvergenceContractN
): Record<string, number | string> {
  return {
    // Named alongside `gradientTolerance` so a reader can never mistake an
    // inert legacy echo for the test that actually decided this step.
    convergenceKind: convergence.kind,
    convergenceTolerance: convergence.tolerance
  };
}

/**
 * What the authored criterion measured, in the authored criterion's unit.
 *
 * Equal to `gradientNormInitial` / `gradientNormFinal` exactly when the
 * criterion is `'packed-gradient'`, and differing from them by `deltaTime²`
 * per unit mass otherwise.
 */
function convergenceResidualFacts(
  convergence: XpbdIncrementalPotentialConvergenceEvidenceN
): Record<string, number> {
  return {
    convergenceResidualInitial: convergence.initialResidual,
    convergenceResidualFinal: convergence.finalResidual
  };
}

/**
 * What an immediate accept means, and what to do about it, per criterion.
 *
 * The two criteria warrant genuinely different advice. Under
 * `'packed-gradient'` the threshold sits on a quantity carrying `deltaTime²`,
 * so refining the timestep shrinks the force the test can still see and an
 * immediate accept may be a real force falling under the floor. Under
 * `'maximum-acceleration-residual'` the bound is an acceleration and does not
 * move with the timestep, so the same terminal is much stronger evidence of
 * actual rest — and telling that author to "lower the gradient tolerance"
 * would name a threshold they never wrote.
 */
const CONVERGENCE_ADVICE: Record<
  XpbdIncrementalPotentialConvergenceKindN,
  {
    readonly name: string;
    readonly caution: string;
    readonly levers: readonly XpbdIncrementalPotentialDiagnosisLeverN[];
  }
> = {
  'packed-gradient': {
    name: 'packed-gradient tolerance',
    caution:
      'That threshold carries a deltaTime squared factor, so it resolves ' +
      'forces only down to tolerance / deltaTime squared and a smaller ' +
      'timestep sees less, not more.',
    levers: ['lower-gradient-tolerance', 'timestep-independent-convergence']
  },
  'maximum-acceleration-residual': {
    name: 'maximum acceleration residual',
    caution:
      'That threshold is an acceleration and does not move with the ' +
      'timestep, so this terminal is not the timestep-resolution artifact ' +
      'the packed-gradient criterion can produce.',
    levers: ['lower-convergence-tolerance']
  }
};

/** Pure diagnosis of one integrated incremental-potential step. */
export interface XpbdIncrementalPotentialDiagnosisN {
  /** Stable condition classified without thresholds or scene assumptions. */
  readonly condition: XpbdIncrementalPotentialDiagnosisConditionN;
  /** Caller-controlled policies that legitimately address this condition. */
  readonly levers: readonly XpbdIncrementalPotentialDiagnosisLeverN[];
  /** Concise explanation suitable for a diagnostic panel or log. */
  readonly summary: string;
  /** Scalar evidence used to choose the condition. */
  readonly facts: Readonly<Record<string, number | string | boolean>>;
}

/**
 * Classify one step using only evidence already retained in its result.
 *
 * The function is deterministic, pure, and deliberately does not judge
 * scene intent. In particular, convergence at the initial point can mean
 * either genuine rest or an over-loose tolerance; it is surfaced as
 * `converged-without-iteration` for the caller to interpret. Gradient
 * tolerance is offered only there, and only as a request to lower it.
 */
export function diagnoseXpbdIncrementalPotentialStepN(
  result: XpbdIncrementalPotentialStepResultN
): XpbdIncrementalPotentialDiagnosisN {
  const minimization = result.minimization;
  const progress: XpbdIncrementalPotentialStepProgressN = result.progress;
  const commonFacts: Record<string, number | string | boolean> = {
    stepStatus: result.status,
    minimizationStatus: minimization.status,
    acceptedIterations: progress.acceptedIterations,
    displacementNorm: progress.displacementNorm,
    objectiveDecrease: progress.objectiveDecrease,
    directionPolicyId: minimization.directionPolicyId,
    gradientTolerance: minimization.gradientTolerance,
    ...convergenceContractFacts(minimization.convergence),
    maximumIterations: minimization.maximumIterations,
    ...(result.feasibleBaseRecovery === undefined
      ? {}
      : {
          feasibleBaseRecoveryStatus: result.feasibleBaseRecovery.status,
          feasibleBaseRecoveryTrials: result.feasibleBaseRecovery.trials.length,
          ...feasibleBaseTrialFacts(result.feasibleBaseRecovery.trials),
          ...(result.feasibleBaseRecovery.status === 'anchor-refused'
            ? {}
            : { feasibleBaseRecoveryFraction: result.feasibleBaseRecovery.fraction })
        })
  };

  if (minimization.status === 'initial-state-refused') {
    const anchorRefused = result.feasibleBaseRecovery?.status === 'anchor-refused';
    return diagnosis(
      'initial-state-refused',
      anchorRefused
        ? ['repair-initial-state']
        : [
            'warm-start-previous-positions',
            'warm-start-feasible-inertial-prediction',
            'repair-initial-state'
          ],
      anchorRefused
        ? 'Both the requested prediction and authored anchor lie outside a ' +
          'potential law’s open domain. Repair the authored state.'
        : 'The minimizer base lies outside a potential law’s open domain. ' +
          'Start from the previous positions, recover a sampled feasible ' +
          'prediction chord, or repair the authored state.',
      {
        ...commonFacts,
        ...initialStateRefusalFacts(minimization)
      }
    );
  }

  const facts = {
    ...commonFacts,
    // Retained unconditionally, whichever criterion decided: the packed norm
    // is the quantity every existing reader already knows how to interpret.
    gradientNormInitial: minimization.initial.gradientNorm,
    gradientNormFinal: minimization.final.gradientNorm,
    ...convergenceResidualFacts(minimization.convergence),
    ...(minimization.status === 'converged'
      ? { convergencePoint: minimization.convergencePoint }
      : {})
  };

  if (
    result.status === 'applied' &&
    minimization.status === 'converged' &&
    minimization.convergencePoint === 'initial' &&
    result.progress.acceptedIterations === 0 &&
    result.progress.displacementNorm === 0
  ) {
    const advice = CONVERGENCE_ADVICE[minimization.convergence.kind];
    return diagnosis(
      'converged-without-iteration',
      advice.levers,
      `The base already satisfies the authored ${advice.name}, so the ` +
        'minimizer accepted no iteration. This may be genuine rest; lower the ' +
        `tolerance only when the scene was expected to keep solving. ${advice.caution}`,
      facts
    );
  }

  if (result.status === 'applied') {
    return diagnosis(
      'progressed',
      [],
      'The step reached the application boundary with a converged iterate.',
      facts
    );
  }

  if (result.stage === 'application') {
    return diagnosis(
      'application-refused',
      ['inspect-application-evidence'],
      'Minimization converged, but transactional application refused the result.',
      { ...facts, applicationReason: result.reason }
    );
  }

  switch (minimization.status) {
    case 'iteration-limit':
      return diagnosis(
        'iteration-limit',
        [
          'newton-direction-policy',
          'mass-diagonal-policy',
          'raise-iteration-budget'
        ],
        'The accepted-iteration budget was exhausted before convergence.',
        facts
      );
    case 'line-search-exhausted':
      return diagnosis(
        'line-search-exhausted',
        ['newton-direction-policy', 'mass-diagonal-policy'],
        'Armijo backtracking exhausted its trial budget without an accepted step.',
        facts
      );
    case 'line-search-refused':
      {
        const blocking = minimization.search.blockingFilter;
        const filterReason = blocking.evaluation.status === 'indeterminate'
          ? blocking.evaluation.reason
          : minimization.search.reason;
      return diagnosis(
        'line-search-refused',
        ['inspect-blocking-filter', 'repair-initial-state'],
        'An admissible-step filter could not certify a positive search segment.',
        {
          ...facts,
          blockingFilterId: blocking.filterId,
          filterReason,
          searchReason: minimization.search.reason
        }
      );
      }
    case 'direction-refused':
      return diagnosis(
        'direction-refused',
        ['newton-direction-policy', 'mass-diagonal-policy'],
        'The authored direction policy declined to propose a direction.',
        { ...facts, directionReason: minimization.reason }
      );
    case 'stalled':
      return diagnosis(
        'stalled',
        ['newton-direction-policy', 'mass-diagonal-policy'],
        'The search reached Float64 resolution or received a non-descent direction.',
        { ...facts, stallReason: minimization.reason }
      );
    case 'converged':
      // A converged result reaches this branch only when transactional
      // application was refused; that case returned above.
      throw new Error(
        'diagnoseXpbdIncrementalPotentialStepN: converged minimization has no matching step terminal'
      );
  }
}

function feasibleBaseTrialFacts(
  trials: readonly XpbdFeasibleBaseTrialN[]
): Record<string, number | string> {
  let feasibleTrials = 0;
  let domainRefusals = 0;
  let lastRefusal: XpbdFeasibleBaseDomainRefusalN | undefined;
  for (const trial of trials) {
    if (trial.status === 'feasible') {
      feasibleTrials++;
    } else {
      domainRefusals++;
      lastRefusal = trial.refusal;
    }
  }
  return {
    feasibleBaseFeasibleTrials: feasibleTrials,
    feasibleBaseDomainRefusals: domainRefusals,
    ...(lastRefusal === undefined
      ? {}
      : {
          feasibleBaseLastRefusalLawId: lastRefusal.lawId,
          feasibleBaseLastRefusalReason: lastRefusal.reason
        })
  };
}

function initialStateRefusalFacts(
  refusal: XpbdIncrementalPotentialInitialStateRefusedN
): Readonly<Record<string, number | string | boolean>> {
  return {
    lawId: refusal.lawId,
    refusalReason: refusal.reason,
    refusalMessage: refusal.message,
    initialCoordinateCount: refusal.initialCoordinates.length,
    variableCount: refusal.problem.variableCount
  };
}

function diagnosis(
  condition: XpbdIncrementalPotentialDiagnosisConditionN,
  levers: readonly XpbdIncrementalPotentialDiagnosisLeverN[],
  summary: string,
  facts: Readonly<Record<string, number | string | boolean>>
): XpbdIncrementalPotentialDiagnosisN {
  return Object.freeze({
    condition,
    levers: Object.freeze(levers.slice()),
    summary,
    facts: Object.freeze({ ...facts })
  });
}
