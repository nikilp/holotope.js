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
 * Auditable RN search-direction policy for an incremental-potential minimizer.
 *
 * Policies choose only a packed direction. Armijo acceptance, admissible-step
 * filtering, convergence, and typed refusal remain owned by the minimizer.
 */
export interface XpbdIncrementalPotentialDirectionPolicyN {
  /** Stable authored identity retained in minimization evidence. */
  readonly id: string;
  /** Returns one finite component per packed free coordinate. */
  evaluate(
    context: XpbdIncrementalPotentialDirectionContextN
  ): ArrayLike<number>;
}

/**
 * Deterministic negative-gradient reference direction.
 *
 * This is the default policy and preserves the original bounded minimizer.
 */
export const xpbdSteepestDescentDirectionN:
  XpbdIncrementalPotentialDirectionPolicyN = Object.freeze({
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
  XpbdIncrementalPotentialDirectionPolicyN = Object.freeze({
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
