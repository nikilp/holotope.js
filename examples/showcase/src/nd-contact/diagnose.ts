import type { NdContactStepRecord } from './step.js';

/**
 * TEMPORARY SEAM — delete when P39 lands.
 *
 * Stage P39 (`kitchen/notes/2026-07-28-stage-p39-reachability-and-diagnosis-plan.md`)
 * specifies `diagnoseXpbdIncrementalPotentialStepN`, a pure classifier over
 * retained evidence that maps each terminal state to a typed condition plus the
 * levers that are *legitimate* for it. That is library surface, not demo
 * surface, and the demo must not ship a competing classifier that drifts from
 * it.
 *
 * This module exists so the panes can be built now against a stable shape. It
 * deliberately mirrors P39's condition and lever vocabulary so that replacing it
 * is an import change rather than a redesign. It invents no thresholds: every
 * branch below is decided by a field the solver already reports.
 *
 * The one rule worth preserving verbatim when it is replaced: **the tolerance
 * appears as a lever nowhere except `converged-without-iteration`**, where the
 * advice is to *lower* it in order to re-expose the refusals it was hiding.
 * Offering it anywhere else is what turns a loud failure into a silent one.
 */
export type NdContactCondition =
  /** The step advanced the scene. Nothing to do. */
  | 'progressed'
  /** Applied, but zero iterations and no displacement: physics is frozen. */
  | 'converged-without-iteration'
  /** The solver ran out of iteration budget; the step was refused. */
  | 'iteration-limit'
  /** Backtracking exhausted its trials without an acceptable step. */
  | 'line-search-exhausted'
  /** A step filter declined to certify any segment. */
  | 'line-search-refused'
  /** The direction policy declined to propose a direction. */
  | 'direction-refused'
  /** Refused for a reason this seam does not classify. */
  | 'unclassified';

/**
 * A lever a caller may legitimately pull for a given condition.
 *
 * Named, never pulled — the demo displays these, it does not apply them.
 */
export type NdContactLever =
  | 'newton-direction-policy'
  | 'mass-diagonal-policy'
  | 'raise-iteration-budget'
  | 'lower-gradient-tolerance'
  | 'inspect-blocking-filter'
  | 'repair-initial-state';

export interface NdContactDiagnosis {
  readonly condition: NdContactCondition;
  readonly levers: readonly NdContactLever[];
  /** Plain-language statement of what happened, for display. */
  readonly summary: string;
  /** The facts the condition was decided from, so a reader can check it. */
  readonly facts: Readonly<Record<string, number | string | boolean>>;
}

/** Classifies one step record. Pure: no mutation, no heuristics, no thresholds. */
export function diagnoseNdContactStep(record: NdContactStepRecord): NdContactDiagnosis {
  const facts = Object.freeze({
    terminal: record.terminal,
    applied: record.applied,
    acceptedIterations: record.acceptedIterations,
    displacement: record.displacement,
    gradientNormFinal: record.gradientNormFinal,
    gradientTolerance: record.gradientTolerance
  });

  if (record.applied && record.acceptedIterations === 0 && record.displacement === 0) {
    return Object.freeze({
      condition: 'converged-without-iteration' as const,
      // The only place the tolerance is ever named, and the advice is to lower it.
      levers: Object.freeze(['lower-gradient-tolerance' as const]),
      summary:
        'Reported success without moving: the gradient norm at the current state ' +
        'is already under the tolerance, so the solve converged at its initial ' +
        'point in zero iterations. Lower the tolerance to re-expose what this hides.',
      facts
    });
  }

  if (record.applied) {
    return Object.freeze({
      condition: 'progressed' as const,
      levers: Object.freeze([]),
      summary: 'The step advanced the scene.',
      facts
    });
  }

  switch (record.terminal) {
    case 'iteration-limit':
      return Object.freeze({
        condition: 'iteration-limit' as const,
        // Newton first: measured to be the remedy on this scene at defaults,
        // while mass-diagonal is a no-op here and the budget is not the binding
        // constraint. Ordering is the finding, not a preference.
        levers: Object.freeze([
          'newton-direction-policy' as const,
          'raise-iteration-budget' as const
        ]),
        summary:
          'The solve reached its iteration budget and the step was refused, so ' +
          'nothing was applied. A second-order direction is the documented remedy.',
        facts
      });
    case 'line-search-exhausted':
      return Object.freeze({
        condition: 'line-search-exhausted' as const,
        levers: Object.freeze(['newton-direction-policy' as const]),
        summary: 'Backtracking ran out of trials without an acceptable step.',
        facts
      });
    case 'line-search-refused':
      return Object.freeze({
        condition: 'line-search-refused' as const,
        levers: Object.freeze(['inspect-blocking-filter' as const]),
        summary: 'A step filter declined to certify the segment.',
        facts
      });
    case 'direction-refused':
      return Object.freeze({
        condition: 'direction-refused' as const,
        levers: Object.freeze([
          'newton-direction-policy' as const,
          'mass-diagonal-policy' as const
        ]),
        summary: 'The direction policy declined to propose a direction.',
        facts
      });
    default:
      return Object.freeze({
        condition: 'unclassified' as const,
        levers: Object.freeze([]),
        summary: `Refused with terminal '${record.terminal}'.`,
        facts
      });
  }
}
