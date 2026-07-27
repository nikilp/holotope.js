import {
  XpbdIncrementalPotentialProblemN
} from './xpbd-incremental-potential-problem.js';
import {
  type XpbdIncrementalPotentialDirectionContextN,
  type XpbdIncrementalPotentialDirectionEvidenceN,
  type XpbdIncrementalPotentialDirectionOutcomeN,
  type XpbdIncrementalPotentialDirectionPolicyN
} from './xpbd-incremental-potential-direction.js';
import {
  solveXpbdIncrementalPotentialNewtonDirectionN,
  type XpbdIncrementalPotentialNewtonDirectionResultN,
  type XpbdIncrementalPotentialNewtonPreconditionerN
} from './xpbd-incremental-potential-newton-direction.js';

const KIND = 'newton-cg' as const;

/**
 * P37 outcomes an authored first-order fallback may be attached to.
 *
 * Armijo's `'not-descent'` verdict is deliberately absent: the policy never
 * sees it, and a Newton direction that fails sufficient decrease surfaces as
 * the minimizer's existing `stalled/not-descent` terminal with this policy's
 * evidence attached, rather than as a second chance at choosing a direction.
 */
export type XpbdNewtonDirectionFallbackTriggerN =
  | 'unsupported-provider'
  | 'non-positive-curvature'
  | 'empty-iteration-limit';

/** An explicitly authored first-order policy and the outcomes it answers for. */
export interface XpbdNewtonDirectionFallbackN {
  /** Plain first-order policy; must return a direction value, never refuse. */
  readonly policy: XpbdIncrementalPotentialDirectionPolicyN;
  /** Non-empty, unique triggers this fallback is authored for. */
  readonly on: readonly XpbdNewtonDirectionFallbackTriggerN[];
}

/** Construction options for one globalized Newton direction policy. */
export interface XpbdNewtonDirectionPolicyNOptions {
  /** The same compiled problem later passed to the minimizer. */
  readonly problem: XpbdIncrementalPotentialProblemN;
  /** Forwarded to the P37 solve; default `mass-diagonal`. */
  readonly preconditioner?: XpbdIncrementalPotentialNewtonPreconditionerN;
  /** Residual tolerance relative to the initial gradient norm. */
  readonly relativeResidualTolerance?: number;
  /** Absolute packed residual tolerance. */
  readonly absoluteResidualTolerance?: number;
  /** Relative positive-curvature threshold against `||d|| ||H d||`. */
  readonly relativeCurvatureTolerance?: number;
  /** Krylov iteration budget. */
  readonly maximumIterations?: number;
  /**
   * Explicit opt-in to first-order continuation.
   *
   * Absent means the triggers above end the minimization with typed refusal
   * evidence. A fallback is never selected implicitly: continuing past a
   * refused curvature ray is a modelling decision the author makes, not a
   * convenience the policy grants itself.
   */
  readonly fallback?: XpbdNewtonDirectionFallbackN;
}

/** How one linearization point was resolved into a direction, or refused. */
export type XpbdNewtonDirectionOutcomeN =
  | 'newton'
  | 'truncated-newton'
  | 'fallback'
  | 'refused';

/** Complete auditable evidence for one Newton direction attempt. */
export interface XpbdNewtonDirectionPolicyEvidenceN
  extends XpbdIncrementalPotentialDirectionEvidenceN {
  /** Stable discriminator for evidence produced by this policy. */
  readonly kind: typeof KIND;
  /** Complete frozen P37 result for this linearization point. */
  readonly newton: XpbdIncrementalPotentialNewtonDirectionResultN;
  /** Which construction supplied the returned direction, if any. */
  readonly outcome: XpbdNewtonDirectionOutcomeN;
  /** Identity of the engaged fallback policy, or null when none was. */
  readonly fallbackPolicyId: string | null;
}

const TRIGGERS: readonly XpbdNewtonDirectionFallbackTriggerN[] = Object.freeze([
  'unsupported-provider',
  'non-positive-curvature',
  'empty-iteration-limit'
]);

/**
 * Composes P37's Newton-direction solve into the P33 direction-policy seam.
 *
 * This is a direction policy, not a minimizer. Step filters still certify the
 * requested segment, Armijo still owns acceptance and backtracking, and the
 * gradient norm still owns convergence. What the policy adds is the direction
 * and the evidence for it.
 *
 * The factory closes over the compiled problem because the policy context
 * deliberately carries defensive copies and no problem object — a
 * problem-aware policy cannot be written against the context alone, and
 * widening the context for one policy would hand every policy a mutable
 * handle on the objective.
 *
 * The linearization is fresh at every accepted iterate: the solve runs at the
 * coordinates it is given, never at a remembered point.
 *
 * @param options - Compiled problem, forwarded P37 tolerances, and the
 * optional authored fallback.
 * @returns An ordinary direction policy, usable anywhere `mass-diagonal` is.
 *
 * @example
 * Refusal is the default. Without an authored fallback, indefinite curvature
 * ends the minimization with the rejected ray retained rather than being
 * silently repaired:
 * ```ts
 * const policy = xpbdNewtonDirectionPolicyN({ problem });
 * const result = minimizeXpbdIncrementalPotentialN({
 *   problem,
 *   initialCoordinates,
 *   directionPolicy: policy
 * });
 *
 * result.status; // 'direction-refused' at an indefinite linearization
 * policy.id; // 'newton-cg'
 * ```
 *
 * @example
 * Continuing first-order past a refusal is authored, naming both the policy
 * and the exact outcomes it answers for:
 * ```ts
 * const policy = xpbdNewtonDirectionPolicyN({
 *   problem,
 *   fallback: {
 *     policy: xpbdMassPreconditionedDirectionN,
 *     on: ['non-positive-curvature']
 *   }
 * });
 *
 * policy.id; // 'newton-cg+fallback:mass-diagonal'
 * ```
 */
export function xpbdNewtonDirectionPolicyN(
  options: XpbdNewtonDirectionPolicyNOptions
): XpbdIncrementalPotentialDirectionPolicyN {
  const caller = 'xpbdNewtonDirectionPolicyN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  if (!(options.problem instanceof XpbdIncrementalPotentialProblemN)) {
    throw new Error(
      `${caller}: problem must be an XpbdIncrementalPotentialProblemN`
    );
  }
  const problem = options.problem;
  const fallback = validateFallback(options.fallback, caller);
  const id = fallback === undefined
    ? KIND
    : `${KIND}+fallback:${fallback.policy.id}`;

  const solveOptions = {
    ...(options.preconditioner === undefined
      ? {}
      : { preconditioner: options.preconditioner }),
    ...(options.relativeResidualTolerance === undefined
      ? {}
      : { relativeResidualTolerance: options.relativeResidualTolerance }),
    ...(options.absoluteResidualTolerance === undefined
      ? {}
      : { absoluteResidualTolerance: options.absoluteResidualTolerance }),
    ...(options.relativeCurvatureTolerance === undefined
      ? {}
      : { relativeCurvatureTolerance: options.relativeCurvatureTolerance }),
    ...(options.maximumIterations === undefined
      ? {}
      : { maximumIterations: options.maximumIterations })
  };

  return Object.freeze({
    id,
    evaluate(
      context: XpbdIncrementalPotentialDirectionContextN
    ): XpbdIncrementalPotentialDirectionOutcomeN {
      if (context.coordinates.length !== problem.variableCount) {
        // A context sized against another problem means the factory was closed
        // over one objective and handed to a minimizer running a different
        // one. That is host wiring, not a state the search can be in.
        throw new Error(
          `${caller}: policy "${id}" expects ${problem.variableCount} ` +
            `coordinates, received ${context.coordinates.length}`
        );
      }

      const newton = solveXpbdIncrementalPotentialNewtonDirectionN({
        problem,
        coordinates: context.coordinates,
        ...solveOptions
      });

      const trigger = triggerOf(newton);
      if (trigger === null) {
        // Every completed Krylov iteration passed the curvature test, so a
        // budget-truncated direction is as honest as a converged one; it is
        // simply a less complete solve. Armijo still owns acceptance.
        const outcome: XpbdNewtonDirectionOutcomeN =
          newton.status === 'iteration-limit' ? 'truncated-newton' : 'newton';
        return {
          status: 'direction',
          direction: newton.direction,
          evidence: evidenceOf(newton, outcome, null)
        };
      }

      if (fallback !== undefined && fallback.on.includes(trigger)) {
        const proposed = fallback.policy.evaluate(context);
        const direction = directionValueOf(proposed, fallback.policy.id, caller);
        return {
          status: 'direction',
          direction,
          evidence: evidenceOf(newton, 'fallback', fallback.policy.id)
        };
      }

      return {
        status: 'refused',
        reason: trigger,
        evidence: evidenceOf(newton, 'refused', null)
      };
    }
  });
}

/** The authored trigger this result represents, or null when it supplies one. */
function triggerOf(
  newton: XpbdIncrementalPotentialNewtonDirectionResultN
): XpbdNewtonDirectionFallbackTriggerN | null {
  if (newton.status === 'unsupported-provider') return 'unsupported-provider';
  if (newton.status === 'non-positive-curvature') return 'non-positive-curvature';
  if (newton.status === 'iteration-limit' && newton.iterations.length === 0) {
    // A budget that completed no iteration produced no Krylov information at
    // all; the accumulated direction is still zero, which is not a direction.
    return 'empty-iteration-limit';
  }
  // `zero-gradient` is unreachable from the minimizer, which converges before
  // consulting a policy. Were it to surface, its zero direction is correct.
  return null;
}

function evidenceOf(
  newton: XpbdIncrementalPotentialNewtonDirectionResultN,
  outcome: XpbdNewtonDirectionOutcomeN,
  fallbackPolicyId: string | null
): XpbdNewtonDirectionPolicyEvidenceN {
  return Object.freeze({
    kind: KIND,
    newton,
    outcome,
    fallbackPolicyId
  });
}

/**
 * A fallback exists to supply a direction, so refusing is a contradiction.
 *
 * Allowing it would leave the composite policy refusing with a reason from one
 * layer and evidence from another, which no caller could act on.
 */
function directionValueOf(
  proposed: XpbdIncrementalPotentialDirectionOutcomeN,
  policyId: string,
  caller: string
): ArrayLike<number> {
  if (typeof proposed !== 'object' || proposed === null) {
    throw new Error(`${caller}: fallback policy "${policyId}" returned no direction`);
  }
  const tagged = proposed as { readonly status?: unknown };
  if (typeof tagged.status !== 'string') return proposed as ArrayLike<number>;
  if (tagged.status === 'direction') {
    return (proposed as { readonly direction: ArrayLike<number> }).direction;
  }
  throw new Error(
    `${caller}: fallback policy "${policyId}" must return a direction, not "${String(tagged.status)}"`
  );
}

function validateFallback(
  fallback: XpbdNewtonDirectionFallbackN | undefined,
  caller: string
): XpbdNewtonDirectionFallbackN | undefined {
  if (fallback === undefined) return undefined;
  if (typeof fallback !== 'object' || fallback === null) {
    throw new Error(`${caller}: fallback must be an object`);
  }
  const policy = fallback.policy;
  if (typeof policy !== 'object' || policy === null) {
    throw new Error(`${caller}: fallback policy must be an object`);
  }
  if (typeof policy.id !== 'string' || policy.id.trim().length === 0) {
    throw new Error(`${caller}: fallback policy id must be non-empty`);
  }
  if (typeof policy.evaluate !== 'function') {
    throw new Error(`${caller}: fallback policy must define evaluate()`);
  }
  if (!Array.isArray(fallback.on) || fallback.on.length === 0) {
    throw new Error(`${caller}: fallback must name at least one trigger`);
  }
  const seen = new Set<string>();
  for (const trigger of fallback.on) {
    if (!TRIGGERS.includes(trigger)) {
      throw new Error(`${caller}: unknown fallback trigger "${String(trigger)}"`);
    }
    if (seen.has(trigger)) {
      throw new Error(`${caller}: duplicate fallback trigger "${trigger}"`);
    }
    seen.add(trigger);
  }
  return Object.freeze({
    policy,
    on: Object.freeze([...fallback.on])
  });
}
