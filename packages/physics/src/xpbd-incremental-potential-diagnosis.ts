import type {
  XpbdIncrementalPotentialStepProgressN,
  XpbdIncrementalPotentialStepResultN
} from './xpbd-incremental-potential-step.js';
import type {
  XpbdIncrementalPotentialInitialStateRefusedN
} from './xpbd-incremental-potential-minimizer.js';

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
  | 'repair-initial-state'
  | 'newton-direction-policy'
  | 'mass-diagonal-policy'
  | 'raise-iteration-budget'
  | 'lower-gradient-tolerance'
  | 'inspect-blocking-filter'
  | 'inspect-application-evidence';

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
    maximumIterations: minimization.maximumIterations
  };

  if (minimization.status === 'initial-state-refused') {
    return diagnosis(
      'initial-state-refused',
      ['warm-start-previous-positions', 'repair-initial-state'],
      'The minimizer base lies outside a potential law’s open domain. Start ' +
        'from the previous admissible positions or repair the authored state.',
      {
        ...commonFacts,
        ...initialStateRefusalFacts(minimization)
      }
    );
  }

  const facts = {
    ...commonFacts,
    gradientNormInitial: minimization.initial.gradientNorm,
    gradientNormFinal: minimization.final.gradientNorm,
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
    return diagnosis(
      'converged-without-iteration',
      ['lower-gradient-tolerance'],
      'The base already satisfies the authored gradient tolerance, so the ' +
        'minimizer accepted no iteration. This may be genuine rest; lower the ' +
        'tolerance only when the scene was expected to keep solving.',
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
