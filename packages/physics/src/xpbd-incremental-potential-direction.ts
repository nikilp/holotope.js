/** Immutable packed state supplied to one incremental-potential direction policy. */
export interface XpbdIncrementalPotentialDirectionContextN {
  /** Ambient Euclidean dimension. */
  readonly dimension: number;
  /** Positive outer-step duration in seconds. */
  readonly deltaTime: number;
  /** Zero-based minimizer iteration index. */
  readonly iterationIndex: number;
  /** Defensive copy of the current packed free coordinates. */
  readonly coordinates: Float64Array;
  /** Defensive copy of the current packed objective gradient. */
  readonly gradient: Float64Array;
  /** Euclidean norm of the packed gradient. */
  readonly gradientNorm: number;
  /** Dynamic particle indices in authored particle order. */
  readonly freeParticleIndices: readonly number[];
  /** Inverse mass for each dynamic particle in matching order. */
  readonly freeParticleInverseMasses: Float64Array;
}

/**
 * Policy-defined evidence retained beside a proposed or refused direction.
 *
 * The discriminator is the policy's own, not this module's: a policy that
 * computes something worth auditing describes it in its own vocabulary, and
 * the minimizer carries the record without interpreting it.
 */
export interface XpbdIncrementalPotentialDirectionEvidenceN {
  /** Stable policy-defined evidence discriminator. */
  readonly kind: string;
}

/** A direction a policy is prepared to stand behind, with optional evidence. */
export interface XpbdIncrementalPotentialDirectionProposalN {
  /** Distinguishes a proposal from a refusal. */
  readonly status: 'direction';
  /** One finite component per packed free coordinate. */
  readonly direction: ArrayLike<number>;
  /** Optional policy-defined record of how the direction was obtained. */
  readonly evidence?: XpbdIncrementalPotentialDirectionEvidenceN;
}

/**
 * A policy declining to propose a direction at all.
 *
 * This is a refusal, not a failure: a policy that cannot certify a direction
 * says so rather than returning one it does not believe in. The minimizer
 * terminates on it, retaining whatever evidence the policy supplied.
 */
export interface XpbdIncrementalPotentialDirectionRefusalN {
  /** Distinguishes a refusal from a proposal. */
  readonly status: 'refused';
  /** Stable policy-defined reason within that policy's vocabulary. */
  readonly reason: string;
  /** Optional policy-defined record of what was refused and why. */
  readonly evidence?: XpbdIncrementalPotentialDirectionEvidenceN;
}

/**
 * What one direction-policy evaluation may return.
 *
 * A bare `ArrayLike` remains valid and unchanged in meaning, so a policy
 * written against the original seam keeps working. The minimizer discriminates
 * on a string `status` property: anything without one is a packed direction.
 */
export type XpbdIncrementalPotentialDirectionOutcomeN =
  | ArrayLike<number>
  | XpbdIncrementalPotentialDirectionProposalN
  | XpbdIncrementalPotentialDirectionRefusalN;

/**
 * Auditable RN search-direction policy for an incremental-potential minimizer.
 *
 * Policies choose only a packed direction, or decline to. Armijo acceptance,
 * admissible-step filtering, convergence, and typed refusal remain owned by
 * the minimizer.
 */
export interface XpbdIncrementalPotentialDirectionPolicyN {
  /** Stable authored identity retained in minimization evidence. */
  readonly id: string;
  /**
   * Returns one finite component per packed free coordinate, a proposal
   * carrying the same with evidence, or an explicit refusal.
   */
  evaluate(
    context: XpbdIncrementalPotentialDirectionContextN
  ): XpbdIncrementalPotentialDirectionOutcomeN;
}

/**
 * A policy that always proposes a packed direction and never refuses.
 *
 * The built-in first-order policies are of this kind, and so is anything
 * usable as a Newton fallback: a fallback exists to supply a direction, so one
 * that could refuse would leave the composite with a reason from one layer and
 * evidence from another.
 */
export interface XpbdIncrementalPotentialDirectionValuePolicyN
  extends XpbdIncrementalPotentialDirectionPolicyN {
  /** Returns one finite component per packed free coordinate. */
  evaluate(
    context: XpbdIncrementalPotentialDirectionContextN
  ): Float64Array;
}

/**
 * Deterministic negative-gradient reference direction.
 *
 * This is the default policy and preserves the original bounded minimizer.
 */
export const xpbdSteepestDescentDirectionN:
  XpbdIncrementalPotentialDirectionValuePolicyN = Object.freeze({
  id: 'steepest-descent',
  evaluate(context: XpbdIncrementalPotentialDirectionContextN) {
    return Float64Array.from(
      context.gradient,
      (component) => -component
    );
  }
});

/**
 * Negative gradient scaled by the exact inverse diagonal inertial mass block.
 *
 * Every free particle contributes `dimension` contiguous coordinates and its
 * inverse mass scales the complete block. This is a first-order
 * preconditioner; it is not a material Hessian or Newton direction.
 *
 * It is worth choosing only when the free particles differ in mass. Scaling
 * every block by the same inverse mass rescales the direction without
 * turning it, and the line search owns the step length — so on a uniform
 * body this policy proposes the same search direction as the default. What
 * it changes is the *relative* weighting between blocks: a heavy particle is
 * asked to move less than a light one under the same gradient, which is what
 * the inertial term would have done anyway.
 *
 * @example
 * Two free particles under an identical gradient. With equal masses the two
 * policies point the same way, so there is nothing to gain:
 * ```ts
 * const context = {
 *   dimension: 3,
 *   deltaTime: 1 / 60,
 *   iterationIndex: 0,
 *   coordinates: Float64Array.from([0, 1, 0, 0, 2, 0]),
 *   gradient: Float64Array.from([0, 3, 0, 0, 3, 0]),
 *   gradientNorm: Math.hypot(3, 3),
 *   freeParticleIndices: [0, 1],
 *   freeParticleInverseMasses: Float64Array.from([1, 1])
 * };
 *
 * Array.from(xpbdSteepestDescentDirectionN.evaluate(context)); // [0, -3, 0, 0, -3, 0]
 * Array.from(xpbdMassPreconditionedDirectionN.evaluate(context)); // identical
 * ```
 *
 * @example
 * Give the second particle ten times the mass and the directions part: the
 * heavy block is scaled down, so the light particle leads. This is the case
 * the policy exists for:
 * ```ts
 * const context = {
 *   dimension: 3,
 *   deltaTime: 1 / 60,
 *   iterationIndex: 0,
 *   coordinates: Float64Array.from([0, 1, 0, 0, 2, 0]),
 *   gradient: Float64Array.from([0, 3, 0, 0, 3, 0]),
 *   gradientNorm: Math.hypot(3, 3),
 *   freeParticleIndices: [0, 1],
 *   freeParticleInverseMasses: Float64Array.from([1, 0.1])
 * };
 *
 * Array.from(xpbdMassPreconditionedDirectionN.evaluate(context));
 * // [0, -3, 0, 0, -0.3, 0] — against [0, -3, 0, 0, -3, 0] for the default
 * ```
 */
export const xpbdMassPreconditionedDirectionN:
  XpbdIncrementalPotentialDirectionValuePolicyN = Object.freeze({
  id: 'mass-diagonal',
  evaluate(context: XpbdIncrementalPotentialDirectionContextN) {
    const direction = new Float64Array(context.gradient.length);
    for (
      let particle = 0;
      particle < context.freeParticleInverseMasses.length;
      particle++
    ) {
      const scale = -context.freeParticleInverseMasses[particle]!;
      const offset = particle * context.dimension;
      for (let axis = 0; axis < context.dimension; axis++) {
        direction[offset + axis] = scale * context.gradient[offset + axis]!;
      }
    }
    return direction;
  }
});
