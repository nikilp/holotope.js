import { VecN } from '@holotope/core';
import { XpbdParticleHyperplaneBarrierN } from './xpbd-hyperplane-barrier.js';
import { XpbdParticleN } from './xpbd-world.js';

/**
 * Particle-space segment supplied to one incremental-potential step filter.
 *
 * Two consumers build this context, and a filter must serve both. The Armijo
 * search certifies its initial line-search segment, with `requestedStepLength`
 * equal to the search's initial step (default one, multiplying an unnormalized
 * packed direction). The warm-start certification certifies the automatic
 * movement from the authored anchor to the inertial prediction, with
 * `requestedStepLength` equal to that displacement's packed Euclidean norm.
 * The parameter's SCALE is therefore the caller's, never a constant: a filter
 * must derive its answer from the positions the context supplies and express
 * it in the context's own `requestedStepLength` units — a `safe` evaluation
 * echoes `requestedStepLength` exactly, and a hardcoded constant that happened
 * to match one caller's scale is a contract violation the step surfaces
 * loudly.
 */
export interface XpbdIncrementalPotentialStepFilterContextN {
  /** Ambient Euclidean dimension. */
  readonly dimension: number;
  /** Positive parameter naming the complete segment in the caller's scale. */
  readonly requestedStepLength: number;
  /** Returns a defensive copy of a particle's position at step zero. */
  readonly positionBefore: (particle: XpbdParticleN) => VecN;
  /** Returns a defensive copy of a particle's position at the requested step. */
  readonly positionAfter: (particle: XpbdParticleN) => VecN;
}

/** Certification that the complete requested segment is admissible. */
export interface XpbdIncrementalPotentialStepFilterSafeN {
  /** Complete-segment certification. */
  readonly status: 'safe';
  /** Equal to the context's requested step length. */
  readonly maximumStepLength: number;
}

/** Certification of only a strict prefix of the requested segment. */
export interface XpbdIncrementalPotentialStepFilterLimitedN {
  /** Strict-prefix certification. */
  readonly status: 'limited';
  /** Finite certified step in `[0, requestedStepLength)`. */
  readonly maximumStepLength: number;
}

/** Explicit refusal to certify the requested segment. */
export interface XpbdIncrementalPotentialStepFilterIndeterminateN {
  /** Refusal rather than a collision miss. */
  readonly status: 'indeterminate';
  /** Stable, non-empty explanation suitable for diagnostics. */
  readonly reason: string;
}

/** Result of certifying one proposed particle-space search segment. */
export type XpbdIncrementalPotentialStepFilterEvaluationN =
  | XpbdIncrementalPotentialStepFilterSafeN
  | XpbdIncrementalPotentialStepFilterLimitedN
  | XpbdIncrementalPotentialStepFilterIndeterminateN;

/**
 * Auditable admissible-step policy for an incremental-potential search.
 *
 * A filter must certify the entire supplied particle-space segment, limit it
 * to a safe prefix, or explicitly refuse. An `indeterminate` result is never a
 * collision miss.
 *
 * How often each outcome occurs is a property of the filter, not of the
 * interface. A filter solving its geometry in closed form — as the shipped
 * point–plane one does — can always decide a segment whose start is
 * admissible, so it never needs `indeterminate` during ordinary stepping. The
 * third outcome exists for filters that cannot decide: a conservative
 * advancement bound that runs out of iterations, or a query whose geometry is
 * outside what the filter certifies. Callers instrumenting the three outcomes
 * should not expect to see all three from an exact filter.
 */
export interface XpbdIncrementalPotentialStepFilterN {
  /** Stable authored identity within one compiled problem. */
  readonly id: string;
  /** Ambient Euclidean dimension accepted by the filter. */
  readonly dimension: number;
  /** Exact particle identities read by the filter. */
  readonly particles: readonly XpbdParticleN[];
  /** Certifies or refuses one requested particle-space segment. */
  evaluate(
    context: XpbdIncrementalPotentialStepFilterContextN
  ): XpbdIncrementalPotentialStepFilterEvaluationN;
}

/** Authored filter paired with its immutable search-time evidence. */
export interface XpbdIncrementalPotentialStepFilterResultN {
  /** Stable authored filter identity. */
  readonly filterId: string;
  /** Safe, limited, or indeterminate certification. */
  readonly evaluation: XpbdIncrementalPotentialStepFilterEvaluationN;
}

/** Exact point–plane step-filter construction options. */
export interface XpbdParticleHyperplaneBarrierStepFilterNOptions {
  /** Stable authored identity within one compiled problem. */
  readonly id: string;
  /** Barrier whose particle, plane, and open boundary define admissibility. */
  readonly barrier: XpbdParticleHyperplaneBarrierN;
  /** Fraction of the exact impact step retained; default `0.9`. */
  readonly conservativeScale?: number;
}

/**
 * Why an exact point–plane filter could not certify a segment.
 *
 * One reason, and it is about the *start* of the segment rather than the
 * segment itself: the affine crossing is solved in closed form, so a segment
 * beginning inside the admissible domain is always decidable. Reaching this
 * therefore means the caller asked about a state that was already inadmissible,
 * which no step length can repair.
 */
export type XpbdParticleHyperplaneBarrierStepFilterRefusalReasonN =
  'initial-domain-violation';

/** Shared signed-gap evidence from an exact point–plane segment query. */
export interface XpbdParticleHyperplaneBarrierStepFilterEvidenceN {
  /** Signed plane distance at the segment start. */
  readonly startSignedDistance: number;
  /** Signed plane distance at the requested segment endpoint. */
  readonly endSignedDistance: number;
  /** Start distance above the barrier's open minimum. */
  readonly startMargin: number;
  /** Endpoint distance above the barrier's open minimum. */
  readonly endMargin: number;
  /** Exact boundary fraction in `[0, 1]`, or `null` when no crossing exists. */
  readonly impactFraction: number | null;
  /** Exact boundary step, or `null` when no crossing exists. */
  readonly impactStepLength: number | null;
}

/** Complete exact point–plane certification for one proposed segment. */
export type XpbdParticleHyperplaneBarrierStepFilterEvaluationN =
  XpbdParticleHyperplaneBarrierStepFilterEvidenceN & (
    | XpbdIncrementalPotentialStepFilterSafeN
    | XpbdIncrementalPotentialStepFilterLimitedN
    | {
      /** Refusal because the initial point is outside the open domain. */
      readonly status: 'indeterminate';
      /** Stable exact point–plane refusal reason. */
      readonly reason:
        XpbdParticleHyperplaneBarrierStepFilterRefusalReasonN;
    }
  );

/**
 * Exact RN point–static-hyperplane collision-free step filter.
 *
 * The affine signed gap is solved in closed form. A crossing is shortened to
 * `conservativeScale` times the exact impact step, keeping the accepted point
 * strictly inside the barrier's open domain.
 *
 * A barrier alone does not keep a step admissible: it scores the endpoints a
 * search proposes, and a long enough trial can pass straight through the
 * plane between two finite evaluations. Certifying the *segment* is this
 * filter's job, which is why the two are authored as a pair.
 *
 * @example
 * A particle a unit above the floor `y = 0`, and the segment that carries it
 * halfway down. Nothing crosses, so the whole requested step is certified:
 * ```ts
 * const particle = new XpbdParticleN({ id: 'p', position: new VecN([0, 1, 0]) });
 * const plane = new HyperplaneColliderN(new VecN([0, 1, 0]), 0);
 * const barrier = new XpbdParticleHyperplaneBarrierN({
 *   id: 'floor', particle, plane, activationDistance: 0.1, stiffness: 1
 * });
 * const filter = new XpbdParticleHyperplaneBarrierStepFilterN({ id: 'floor-ccd', barrier });
 *
 * const clear = filter.evaluate({
 *   dimension: 3,
 *   requestedStepLength: 1,
 *   positionBefore: () => new VecN([0, 1, 0]),
 *   positionAfter: () => new VecN([0, 0.5, 0])
 * });
 * clear.status; // 'safe'
 * clear.impactFraction; // null — nothing to solve for
 * ```
 *
 * @example
 * A segment that would end below the floor is cut back to a strict prefix.
 * The crossing is solved exactly, then scaled by `conservativeScale` so the
 * accepted point stays strictly inside the open domain rather than on it:
 * ```ts
 * const particle = new XpbdParticleN({ id: 'p', position: new VecN([0, 1, 0]) });
 * const plane = new HyperplaneColliderN(new VecN([0, 1, 0]), 0);
 * const barrier = new XpbdParticleHyperplaneBarrierN({
 *   id: 'floor', particle, plane, activationDistance: 0.1, stiffness: 1
 * });
 * const filter = new XpbdParticleHyperplaneBarrierStepFilterN({ id: 'floor-ccd', barrier });
 *
 * const crossing = filter.evaluate({
 *   dimension: 3,
 *   requestedStepLength: 1,
 *   positionBefore: () => new VecN([0, 1, 0]),
 *   positionAfter: () => new VecN([0, -0.5, 0])
 * });
 * crossing.impactFraction; // 2/3 — where the segment meets the plane
 * if (crossing.status === 'limited') {
 *   crossing.maximumStepLength; // 0.6, the default 0.9 of the impact step
 * }
 * ```
 *
 * @example
 * An `indeterminate` result is a refusal, not a missed collision. A segment
 * beginning outside the open domain is refused even though it moves back
 * towards safety, because there is no admissible prefix to certify:
 * ```ts
 * const particle = new XpbdParticleN({ id: 'p', position: new VecN([0, 1, 0]) });
 * const plane = new HyperplaneColliderN(new VecN([0, 1, 0]), 0);
 * const barrier = new XpbdParticleHyperplaneBarrierN({
 *   id: 'floor', particle, plane, activationDistance: 0.1, stiffness: 1
 * });
 * const filter = new XpbdParticleHyperplaneBarrierStepFilterN({ id: 'floor-ccd', barrier });
 *
 * const refused = filter.evaluate({
 *   dimension: 3,
 *   requestedStepLength: 1,
 *   positionBefore: () => new VecN([0, -0.1, 0]),
 *   positionAfter: () => new VecN([0, 0.5, 0])
 * });
 * if (refused.status === 'indeterminate') {
 *   refused.reason; // 'initial-domain-violation'
 * }
 * ```
 */
export class XpbdParticleHyperplaneBarrierStepFilterN
implements XpbdIncrementalPotentialStepFilterN {
  /** Stable authored filter identity. */
  readonly id: string;
  /** Ambient particle and plane dimension. */
  readonly dimension: number;
  /** Barrier whose open distance domain is certified. */
  readonly barrier: XpbdParticleHyperplaneBarrierN;
  /** One-element exact particle identity list. */
  readonly particles: readonly [XpbdParticleN];
  /** Fraction of the exact impact step retained. */
  readonly conservativeScale: number;

  /**
   * Creates one exact point–plane step filter.
   *
   * @param options Barrier identity and conservative impact rescaling.
   */
  constructor(options: XpbdParticleHyperplaneBarrierStepFilterNOptions) {
    const caller = 'XpbdParticleHyperplaneBarrierStepFilterN';
    if (typeof options !== 'object' || options === null) {
      throw new Error(`${caller}: options must be an object`);
    }
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(`${caller}: id must be a non-empty string`);
    }
    if (!(options.barrier instanceof XpbdParticleHyperplaneBarrierN)) {
      throw new Error(
        `${caller}: barrier must be an XpbdParticleHyperplaneBarrierN`
      );
    }
    const conservativeScale = options.conservativeScale ?? 0.9;
    if (!Number.isFinite(conservativeScale) ||
      conservativeScale <= 0 ||
      conservativeScale >= 1) {
      throw new Error(`${caller}: conservativeScale must be in (0, 1)`);
    }
    this.id = options.id;
    this.dimension = options.barrier.dimension;
    this.barrier = options.barrier;
    this.particles = Object.freeze([options.barrier.particle]);
    this.conservativeScale = conservativeScale;
  }

  /** Solves the affine signed-gap crossing without mutating caller state. */
  evaluate(
    context: XpbdIncrementalPotentialStepFilterContextN
  ): XpbdParticleHyperplaneBarrierStepFilterEvaluationN {
    const caller = 'XpbdParticleHyperplaneBarrierStepFilterN.evaluate';
    validateContext(context, this.dimension, caller);
    const before = finitePosition(
      context.positionBefore(this.barrier.particle),
      this.dimension,
      `${caller}: positionBefore`
    );
    const after = finitePosition(
      context.positionAfter(this.barrier.particle),
      this.dimension,
      `${caller}: positionAfter`
    );
    const startSignedDistance =
      this.barrier.plane.normal.dot(before) - this.barrier.plane.offset;
    const endSignedDistance =
      this.barrier.plane.normal.dot(after) - this.barrier.plane.offset;
    if (!Number.isFinite(startSignedDistance) ||
      !Number.isFinite(endSignedDistance)) {
      throw new Error(`${caller}: signed distance is outside Float64`);
    }
    const startMargin =
      startSignedDistance - this.barrier.minimumDistance;
    const endMargin =
      endSignedDistance - this.barrier.minimumDistance;
    const common = {
      startSignedDistance,
      endSignedDistance,
      startMargin,
      endMargin
    } as const;

    if (!(startMargin > 0)) {
      return Object.freeze({
        ...common,
        status: 'indeterminate',
        reason: 'initial-domain-violation',
        impactFraction: null,
        impactStepLength: null
      });
    }
    if (endMargin > 0 || endMargin >= startMargin) {
      return Object.freeze({
        ...common,
        status: 'safe',
        maximumStepLength: context.requestedStepLength,
        impactFraction: null,
        impactStepLength: null
      });
    }

    const impactFraction = startMargin / (startMargin - endMargin);
    const impactStepLength =
      context.requestedStepLength * impactFraction;
    const maximumStepLength =
      impactStepLength * this.conservativeScale;
    if (!Number.isFinite(impactFraction) ||
      impactFraction < 0 ||
      impactFraction > 1 ||
      !Number.isFinite(impactStepLength) ||
      !Number.isFinite(maximumStepLength) ||
      maximumStepLength < 0 ||
      !(maximumStepLength < context.requestedStepLength)) {
      throw new Error(`${caller}: impact step is outside Float64`);
    }
    return Object.freeze({
      ...common,
      status: 'limited',
      maximumStepLength,
      impactFraction,
      impactStepLength
    });
  }
}

function validateContext(
  context: XpbdIncrementalPotentialStepFilterContextN,
  dimension: number,
  caller: string
): void {
  if (typeof context !== 'object' || context === null) {
    throw new Error(`${caller}: context must be an object`);
  }
  if (context.dimension !== dimension) {
    throw new Error(
      `${caller}: context is R${context.dimension}, expected R${dimension}`
    );
  }
  if (!Number.isFinite(context.requestedStepLength) ||
    context.requestedStepLength <= 0) {
    throw new Error(
      `${caller}: requestedStepLength must be finite and positive`
    );
  }
  if (typeof context.positionBefore !== 'function' ||
    typeof context.positionAfter !== 'function') {
    throw new Error(`${caller}: position lookups must be functions`);
  }
}

function finitePosition(value: VecN, dimension: number, label: string): VecN {
  if (!(value instanceof VecN) || value.dim !== dimension) {
    throw new Error(`${label} must return R${dimension}`);
  }
  for (const coordinate of value.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${label} must return finite coordinates`);
    }
  }
  return value.clone();
}
