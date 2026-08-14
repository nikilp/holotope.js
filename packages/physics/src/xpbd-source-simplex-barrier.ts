import {
  VecN,
  inspectSourceSimplexReferenceN,
  projectPointToSourceSimplexN,
  type SourceSimplexCoordinateN,
  type SourceSimplexProjectionN,
  type SourceSimplexReferenceN
} from '@holotope/core';
import {
  evaluateClampedLogBarrier,
  type ClampedLogBarrierEvaluation
} from './clamped-log-barrier.js';
import {
  type XpbdIncrementalPotentialStepFilterContextN,
  type XpbdIncrementalPotentialStepFilterN
} from './xpbd-incremental-potential-step-filter.js';
import { XpbdPotentialDomainErrorN } from './xpbd-potential-domain.js';
import {
  evaluateExactPointSimplexResult,
  type PointSimplexProjectedResult,
  type PointSimplexPublicationReason,
  type PointSimplexResult
} from './exact-point-simplex-distance.js';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderEvaluationN,
  type XpbdConservativeForceProviderN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

/**
 * Reasons naming an exact point--simplex decision that could not be published.
 *
 * One vocabulary serves both released refusals — the barrier's typed domain
 * error and the step filter's `indeterminate` — because both describe the same
 * event: a decision the exact query declined to certify. A caller writes one
 * recovery table keyed by these four strings and reads it in both places.
 *
 * A publication reason states what could NOT be represented. It does not, on
 * its own, classify recoverability: see the per-reason measurements in the
 * contact guide, where each reason is shown to be repairable by a shorter step
 * from some start states and not from others.
 */
export type XpbdParticleSourceSimplexBarrierPublicationReasonN =
  | 'point-simplex-weight-underflow'
  | 'point-simplex-value-overflow'
  | 'point-simplex-value-underflow'
  | 'point-simplex-accuracy-bound-overflow';

export type XpbdParticleSourceSimplexBarrierDomainReasonN =
  | 'at-or-below-minimum-distance'
  | 'minimum-distance-not-certified'
  | XpbdParticleSourceSimplexBarrierPublicationReasonN
  | 'direction-error-exceeds-policy';

/**
 * One-to-one forwarding of every exact point--simplex publication reason.
 *
 * Each publication reason names a distinct representation failure, so they are
 * forwarded individually rather than flattened into one reason plus a message.
 *
 * The reason does NOT classify recoverability. Whether shortening the step
 * helps is a property of the current iterate: if the exact query publishes
 * there, the refusal came from somewhere along the step and a shorter one may
 * clear it; if it does not publish there, no step length helps, because every
 * contracted trial converges back onto the position that already fails. Both
 * outcomes are measured for every reason.
 */
const POINT_SIMPLEX_DOMAIN_REASON = {
  'weight-underflow': 'point-simplex-weight-underflow',
  'value-overflow': 'point-simplex-value-overflow',
  'value-underflow': 'point-simplex-value-underflow',
  'accuracy-bound-overflow': 'point-simplex-accuracy-bound-overflow'
} as const satisfies Record<
  PointSimplexPublicationReason,
  XpbdParticleSourceSimplexBarrierPublicationReasonN
>;

/**
 * The same mapping read backwards, so the correspondence is pinned in BOTH
 * directions at compile time: a new `PointSimplexPublicationReason` fails to
 * compile at the forward record, and a forwarded reason that is renamed,
 * dropped, or collapsed onto another fails to compile here. Neither table can
 * be widened silently.
 */
const POINT_SIMPLEX_PUBLICATION_REASON: Record<
  (typeof POINT_SIMPLEX_DOMAIN_REASON)[PointSimplexPublicationReason],
  PointSimplexPublicationReason
> = {
  'point-simplex-weight-underflow': 'weight-underflow',
  'point-simplex-value-overflow': 'value-overflow',
  'point-simplex-value-underflow': 'value-underflow',
  'point-simplex-accuracy-bound-overflow': 'accuracy-bound-overflow'
};

/**
 * Largest meaningful Euclidean separation between two unit vectors.
 *
 * Two unit vectors differ by at most 2 (exact opposites), so a policy at or
 * above 2 admits every direction including the reverse one. Such a value looks
 * like a policy while certifying nothing, and is rejected at construction.
 */
const MAXIMUM_MEANINGFUL_DIRECTION_ERROR = 2;

/** Construction options for one conservative RN point--source-simplex barrier. */
export interface XpbdParticleSourceSimplexBarrierNOptions {
  /** Stable provider identifier. */
  readonly id: string;
  /** Live particle whose candidate position is evaluated. */
  readonly particle: XpbdParticleN;
  /** Persistent finite source simplex supplying closest-point provenance. */
  readonly simplex: SourceSimplexReferenceN;
  /** Open unsigned distance boundary. Default zero. */
  readonly minimumDistance?: number;
  /** Distance at and above which the barrier is exactly zero. */
  readonly activationDistance: number;
  /** Positive energy scale. */
  readonly stiffness: number;
  /**
   * Caller policy: the largest published direction error the force law admits.
   *
   * A dimensionless Euclidean radius on the published unit direction, finite
   * and in the open interval `(0, 2)` — two unit vectors are at most 2 apart,
   * so a larger bound would admit every direction including the exact
   * opposite. **Required** on the exact `intrinsicDim` 1..3 arm, which
   * publishes a direction enclosure, and **rejected** on the 4..17 legacy
   * fallback, which publishes none: supplying it there would imply a
   * certification the fallback cannot make.
   *
   * This is an explicit caller policy about direction usability. It is not a
   * derived physical constant and it does not certify force accuracy.
   */
  readonly maximumDirectionError?: number;
}

/** Conservative force and closest-source evidence at one candidate point. */
export interface XpbdParticleSourceSimplexBarrierEvaluationN
  extends XpbdConservativeForceProviderEvaluationN {
  /** Closest point, barycentric coordinate, and source-simplex evidence. */
  readonly projection: SourceSimplexProjectionN;
  /** Exact decision and outward error evidence for source dimensions 1..3. */
  readonly pointSimplex?: PointSimplexProjectedResult;
  /** Unsigned Euclidean distance to the closed finite simplex. */
  readonly distance: number;
  /** Unit vector from the closest simplex point toward the particle. */
  readonly separationNormal: VecN;
  /** `distance - minimumDistance`. */
  readonly barrierCoordinate: number;
  /** `activationDistance - minimumDistance`. */
  readonly barrierActivation: number;
  /** Scalar barrier value and derivatives with respect to distance. */
  readonly barrier: ClampedLogBarrierEvaluation;
  /** One force paired with the provider's one particle. */
  readonly forces: readonly [VecN];
}

/**
 * Conservative RN distance barrier between one point and a finite source simplex.
 *
 * Unlike `XpbdParticleHyperplaneBarrierN`, this term uses unsigned distance to
 * a closed, finite simplex. In R4 a point and a source tetrahedron are the
 * complementary contact-feature pair. The closest point retains barycentric
 * coordinates and persistent source-cell identity, including transitions
 * from simplex interior to its edges and vertices.
 *
 * This is a two-sided proximity term, not an inside/outside test. It does not
 * generate mesh candidates, move the simplex, or imply complete self-contact.
 * Pair it with `XpbdParticleSourceSimplexBarrierStepFilterN`: endpoint energy
 * alone cannot detect a segment that passes through the simplex and ends clear
 * on the other side.
 */
export class XpbdParticleSourceSimplexBarrierN
implements XpbdConservativeForceProviderN {
  /** Stable force-provider identity. */
  readonly id: string;
  /** Ambient particle and source-simplex dimension. */
  readonly dimension: number;
  /** Live particle whose current and candidate positions are evaluated. */
  readonly particle: XpbdParticleN;
  /** One-element provider particle list paired with returned forces. */
  readonly particles: readonly [XpbdParticleN];
  /** Persistent finite source simplex retained by every projection result. */
  readonly simplex: SourceSimplexReferenceN;
  /** Open hard unsigned-distance boundary. */
  readonly minimumDistance: number;
  /** Distance at and above which energy and force are zero. */
  readonly activationDistance: number;
  /** Positive scalar energy multiplier. */
  readonly stiffness: number;
  /**
   * Caller-authored direction-usability policy, or `null` on the legacy
   * `intrinsicDim` 4..17 arm, which publishes no direction enclosure.
   */
  readonly maximumDirectionError: number | null;

  /**
   * Creates one source-retained finite-simplex proximity barrier.
   *
   * @param options Particle, source simplex, open distance, activation, and scale.
   */
  constructor(options: XpbdParticleSourceSimplexBarrierNOptions) {
    const caller = 'XpbdParticleSourceSimplexBarrierN';
    if (typeof options !== 'object' || options === null) {
      throw new Error(`${caller}: options must be an object`);
    }
    const unknown = Object.keys(options).filter((key) => ![
      'id', 'particle', 'simplex', 'minimumDistance', 'activationDistance',
      'stiffness', 'maximumDirectionError'
    ].includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `${caller}: unknown option${unknown.length === 1 ? '' : 's'} ` +
        unknown.sort().map((key) => `"${key}"`).join(', ')
      );
    }
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(`${caller}: id must be a non-empty string`);
    }
    if (!(options.particle instanceof XpbdParticleN)) {
      throw new Error(`${caller}: particle must be an XpbdParticleN`);
    }
    if (typeof options.simplex !== 'object' || options.simplex === null ||
      options.simplex.kind !== 'source-simplex-reference') {
      throw new Error(`${caller}: simplex must be a SourceSimplexReferenceN`);
    }
    const status = inspectSourceSimplexReferenceN(options.simplex);
    if (status.kind === 'retired') {
      throw new Error(`${caller}: source simplex is retired (${status.reason})`);
    }
    const dimension = options.simplex.complex.ambientDim;
    if (options.simplex.intrinsicDim < 1 || options.simplex.intrinsicDim > 17) {
      throw new Error(
        `${caller}: simplex dimension must be between 1 and 17`
      );
    }
    if (options.particle.dimension !== dimension) {
      throw new Error(
        `${caller}: particle is R${options.particle.dimension}, source simplex is in R${dimension}`
      );
    }
    const minimumDistance = options.minimumDistance ?? 0;
    if (!Number.isFinite(minimumDistance) || minimumDistance < 0) {
      throw new Error(`${caller}: minimumDistance must be finite and non-negative`);
    }
    if (!Number.isFinite(options.activationDistance) ||
      !(options.activationDistance > minimumDistance)) {
      throw new Error(
        `${caller}: activationDistance must be finite and greater than minimumDistance`
      );
    }
    if (!(options.stiffness > 0) || !Number.isFinite(options.stiffness)) {
      throw new Error(`${caller}: stiffness must be finite and positive`);
    }
    // Direction policy. The exact arm publishes a direction enclosure and
    // therefore REQUIRES a policy — there is no default, because no universal
    // value exists. The legacy arm publishes none, so accepting a policy there
    // would imply a certification it cannot make.
    const exactArm = options.simplex.intrinsicDim <= 3;
    if (exactArm) {
      if (options.maximumDirectionError === undefined) {
        throw new Error(
          `${caller}: maximumDirectionError is required for source dimension ` +
          `${options.simplex.intrinsicDim} (the exact point--simplex arm ` +
          'publishes a direction enclosure; author the policy explicitly)'
        );
      }
      if (!Number.isFinite(options.maximumDirectionError) ||
        !(options.maximumDirectionError > 0) ||
        !(options.maximumDirectionError < MAXIMUM_MEANINGFUL_DIRECTION_ERROR)) {
        throw new Error(
          `${caller}: maximumDirectionError must be finite and in the open ` +
          `interval (0, ${MAXIMUM_MEANINGFUL_DIRECTION_ERROR}); two unit ` +
          'vectors are at most 2 apart, so a larger bound certifies nothing'
        );
      }
    } else if (options.maximumDirectionError !== undefined) {
      throw new Error(
        `${caller}: maximumDirectionError is not supported for source ` +
        `dimension ${options.simplex.intrinsicDim}; the 4..17 fallback ` +
        'publishes no direction enclosure and cannot honour a direction policy'
      );
    }
    this.maximumDirectionError = exactArm
      ? options.maximumDirectionError as number : null;
    this.id = options.id;
    this.dimension = dimension;
    this.particle = options.particle;
    this.particles = Object.freeze([options.particle]);
    this.simplex = options.simplex;
    this.minimumDistance = minimumDistance;
    this.activationDistance = options.activationDistance;
    this.stiffness = options.stiffness;
  }

  /** Evaluates from the particle's current live position without mutation. */
  evaluate(): XpbdParticleSourceSimplexBarrierEvaluationN {
    return this.evaluateAt((particle) => particle.position.clone());
  }

  /** Evaluates one caller-supplied candidate position without live-state writes. */
  evaluateAt(
    positionOf: XpbdParticlePositionQueryN
  ): XpbdParticleSourceSimplexBarrierEvaluationN {
    const caller = 'XpbdParticleSourceSimplexBarrierN.evaluateAt';
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    const position = finitePosition(
      positionOf(this.particle), this.dimension, `${caller}: candidate position`
    );
    const queried = projectForBarrier(this, position);
    const { result: pointSimplex } = queried;
    // Typed BEFORE any arithmetic: the exact query published no witness, and
    // its own reason is forwarded one-to-one so the caller keeps the recovery
    // class rather than a prose message.
    if (pointSimplex !== null && pointSimplex.status === 'uncertified') {
      throw new XpbdPotentialDomainErrorN<
        XpbdParticleSourceSimplexBarrierDomainReasonN
      >(
        this.id,
        POINT_SIMPLEX_DOMAIN_REASON[pointSimplex.reason],
        `${caller}: the exact point--simplex decision could not be published ` +
        `(${pointSimplex.reason}: ${pointSimplex.detail})`
      );
    }
    const projection = queried.projection as SourceSimplexProjectionN;
    const distance = pointSimplex === null
      ? Math.sqrt(projection.squaredDistance)
      : pointSimplexDistance(pointSimplex);
    if (!Number.isFinite(distance)) {
      throw new Error(`${caller}: distance is outside Float64`);
    }
    const certifiedDistance = certifiedDistanceLowerBound(queried);
    if (!(distance > this.minimumDistance)) {
      throw new XpbdPotentialDomainErrorN<
        XpbdParticleSourceSimplexBarrierDomainReasonN
      >(
        this.id,
        'at-or-below-minimum-distance',
        `${caller}: distance must be greater than minimumDistance`
      );
    }
    if (!(certifiedDistance > this.minimumDistance)) {
      throw new XpbdPotentialDomainErrorN<
        XpbdParticleSourceSimplexBarrierDomainReasonN
      >(
        this.id,
        'minimum-distance-not-certified',
        `${caller}: the distance error bound reaches minimumDistance`
      );
    }
    const barrierCoordinate = distance - this.minimumDistance;
    const barrierActivation = this.activationDistance - this.minimumDistance;
    const barrier = evaluateClampedLogBarrier({
      coordinate: barrierCoordinate,
      activation: barrierActivation,
      stiffness: this.stiffness
    });
    if (pointSimplex !== null && pointSimplex.status !== 'projected') {
      // Genuinely unreachable: `zero` cannot survive the positive-distance
      // gates above, `uncertified` was classified before any arithmetic, and
      // `rank-deficient` threw as a configuration error inside the query
      // wrapper. This is an internal invariant, not a caller-reachable state.
      throw new Error(`${caller}: internal positive-distance classification was lost`);
    }
    if (pointSimplex !== null &&
      pointSimplex.error.directionErrorBound > this.maximumDirectionError!) {
      throw new XpbdPotentialDomainErrorN<
        XpbdParticleSourceSimplexBarrierDomainReasonN
      >(
        this.id,
        'direction-error-exceeds-policy',
        `${caller}: published direction error ` +
        `${pointSimplex.error.directionErrorBound} exceeds the authored ` +
        `maximumDirectionError ${this.maximumDirectionError}`
      );
    }
    const separationNormal = pointSimplex === null
      ? position.clone().sub(projection.point).multiplyScalar(1 / distance)
      : new VecN(pointSimplex.witness.direction);
    const force = separationNormal.clone().multiplyScalar(
      -barrier.firstDerivative
    );
    return Object.freeze({
      projection,
      ...(pointSimplex === null ? {} : { pointSimplex }),
      distance,
      separationNormal,
      barrierCoordinate,
      barrierActivation,
      barrier,
      potentialEnergy: barrier.energy,
      forces: Object.freeze([force]) as readonly [VecN]
    });
  }

}

/** Construction options for a conservative point--source-simplex step filter. */
export interface XpbdParticleSourceSimplexBarrierStepFilterNOptions {
  /** Stable authored identity within one compiled problem. */
  readonly id: string;
  /** Barrier whose particle, simplex, and open boundary define admissibility. */
  readonly barrier: XpbdParticleSourceSimplexBarrierN;
  /** Fraction of the certified Lipschitz prefix retained; default `0.9`. */
  readonly conservativeScale?: number;
}

/**
 * Why the finite-simplex filter could not certify any segment prefix.
 *
 * Exactly two things can go wrong, and they are different claims.
 * `initial-domain-violation` says the start is certifiably NOT admissible — its
 * certified distance does not clear the open minimum. The four publication
 * reasons say the start's exact decision could not be published at all, so
 * there is no certified start distance to compare. Unknown is not violated, and
 * conflating them would report a domain error the filter never established.
 */
export type XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN =
  | 'initial-domain-violation'
  | XpbdParticleSourceSimplexBarrierPublicationReasonN;

/** Evidence available for every finite-simplex segment result. */
export interface XpbdParticleSourceSimplexBarrierStepFilterEvidenceN {
  /** Euclidean length of the complete proposed point path. */
  readonly pathLength: number;
  /** Certified fraction of the requested segment, in `[0, 1]`. */
  readonly certifiedFraction: number;
}

/**
 * Evidence available whenever the segment START published a decision.
 *
 * These three quantities exist only when the start's exact point--simplex
 * decision was certified. When it was not, they are absent from the result
 * rather than filled with `NaN`, `0`, or a sentinel: a fabricated distance in
 * an evidence field is indistinguishable from a measured one at the call site.
 */
export interface XpbdParticleSourceSimplexBarrierStepFilterStartEvidenceN
  extends XpbdParticleSourceSimplexBarrierStepFilterEvidenceN {
  /** Unsigned point--simplex distance at the segment start. */
  readonly startDistance: number;
  /** Certified lower bound on start distance above the open minimum. */
  readonly startMargin: number;
  /** Initial distance derivative over the complete segment fraction. */
  readonly startDirectionalDerivative: number;
}

/**
 * Proof used to certify a prefix; never an inferred or exact impact time.
 *
 * Each name is a theorem about the START state and the displacement vector.
 * `stationary`: the path has zero length. `convex-nondecreasing`: distance to a
 * convex set is convex, so a non-negative start directional derivative makes it
 * non-decreasing over the whole segment. `global-lipschitz`: distance is
 * 1-Lipschitz, so the certified start margin bounds how far the point may move
 * before the margin could be spent.
 */
export type XpbdParticleSourceSimplexBarrierStepFilterCertificationN =
  | 'stationary'
  | 'convex-nondecreasing'
  | 'global-lipschitz';

/** Result of one conservative finite-simplex segment query. */
export type XpbdParticleSourceSimplexBarrierStepFilterEvaluationN =
  | (XpbdParticleSourceSimplexBarrierStepFilterStartEvidenceN & {
    readonly status: 'safe';
    readonly maximumStepLength: number;
    readonly certification:
      XpbdParticleSourceSimplexBarrierStepFilterCertificationN;
  })
  | (XpbdParticleSourceSimplexBarrierStepFilterStartEvidenceN & {
    /** A strict prefix is certified; only the Lipschitz bound produces one. */
    readonly status: 'limited';
    readonly maximumStepLength: number;
    readonly certification: 'global-lipschitz';
  })
  | (XpbdParticleSourceSimplexBarrierStepFilterStartEvidenceN & {
    readonly status: 'indeterminate';
    readonly reason: 'initial-domain-violation';
  })
  | (XpbdParticleSourceSimplexBarrierStepFilterEvidenceN & {
    readonly status: 'indeterminate';
    readonly reason: XpbdParticleSourceSimplexBarrierPublicationReasonN;
  });

/**
 * Conservative RN point--static-source-simplex collision-free step filter.
 *
 * Distance to a closed convex simplex is convex and 1-Lipschitz. A segment
 * whose initial directional derivative is non-negative is therefore safe in
 * full; otherwise the global Lipschitz bound certifies a strict prefix. The
 * result intentionally reports a `certifiedFraction`, not an impact time:
 * this filter does not solve the piecewise closest-feature crossing exactly.
 *
 * Only the segment's START is queried. Both proofs above are statements about
 * the start state and the displacement VECTOR — convexity propagates from a
 * start subgradient, and the Lipschitz constant is 1 globally, so neither
 * needs a sample at the far end. Querying the endpoint anyway would add a
 * failure mode without adding a proof: an endpoint whose exact decision cannot
 * be published would refuse a prefix that provably exists, and take the
 * enclosing line search down with it.
 */
export class XpbdParticleSourceSimplexBarrierStepFilterN
implements XpbdIncrementalPotentialStepFilterN {
  /** Stable authored filter identity. */
  readonly id: string;
  /** Ambient particle and source-simplex dimension. */
  readonly dimension: number;
  /** Paired finite-simplex barrier. */
  readonly barrier: XpbdParticleSourceSimplexBarrierN;
  /** Exact particle identity read by this filter. */
  readonly particles: readonly [XpbdParticleN];
  /** Strict scale applied to the Lipschitz prefix. */
  readonly conservativeScale: number;

  /** Creates one conservative finite-simplex step filter. */
  constructor(options: XpbdParticleSourceSimplexBarrierStepFilterNOptions) {
    const caller = 'XpbdParticleSourceSimplexBarrierStepFilterN';
    if (typeof options !== 'object' || options === null) {
      throw new Error(`${caller}: options must be an object`);
    }
    const unknown = Object.keys(options).filter(
      (key) => !['id', 'barrier', 'conservativeScale'].includes(key)
    );
    if (unknown.length > 0) {
      throw new Error(
        `${caller}: unknown option${unknown.length === 1 ? '' : 's'} ` +
        unknown.sort().map((key) => `"${key}"`).join(', ')
      );
    }
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(`${caller}: id must be a non-empty string`);
    }
    if (!(options.barrier instanceof XpbdParticleSourceSimplexBarrierN)) {
      throw new Error(
        `${caller}: barrier must be an XpbdParticleSourceSimplexBarrierN`
      );
    }
    const conservativeScale = options.conservativeScale ?? 0.9;
    if (!Number.isFinite(conservativeScale) ||
      conservativeScale <= 0 || conservativeScale >= 1) {
      throw new Error(`${caller}: conservativeScale must be in (0, 1)`);
    }
    this.id = options.id;
    this.dimension = options.barrier.dimension;
    this.barrier = options.barrier;
    this.particles = Object.freeze([options.barrier.particle]);
    this.conservativeScale = conservativeScale;
  }

  /** Certifies a complete segment or a conservative strict prefix. */
  evaluate(
    context: XpbdIncrementalPotentialStepFilterContextN
  ): XpbdParticleSourceSimplexBarrierStepFilterEvaluationN {
    const caller = 'XpbdParticleSourceSimplexBarrierStepFilterN.evaluate';
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
    const displacement = after.clone().sub(before);
    const pathLength = displacement.length();
    // Only the START is queried. Every certification below bounds the whole
    // segment from the start's certified distance and the displacement VECTOR:
    // distance to a convex set is convex and 1-Lipschitz, so the endpoint's own
    // distance appears in none of the three theorems. Querying it anyway would
    // add a second way to fail — an endpoint the exact query declines to
    // publish — and refuse a prefix that demonstrably exists.
    const startQuery = projectForBarrier(this.barrier, before);
    if (startQuery.result !== null &&
      startQuery.result.status === 'uncertified') {
      // No certified start distance exists, so no start evidence is reported.
      // The typed cause is forwarded intact; a caller reads it with the same
      // recovery table it uses for the barrier's domain refusals.
      return Object.freeze({
        pathLength,
        certifiedFraction: 0,
        status: 'indeterminate',
        reason: POINT_SIMPLEX_DOMAIN_REASON[startQuery.result.reason]
      });
    }
    const startProjection = startQuery.projection as SourceSimplexProjectionN;
    const startDistance = startQuery.result === null
      ? Math.sqrt(startProjection.squaredDistance)
      : pointSimplexDistance(startQuery.result);
    if (!Number.isFinite(startDistance)) {
      throw new Error(`${caller}: distance is outside Float64`);
    }
    const startCertifiedDistance = certifiedDistanceLowerBound(startQuery);
    const startMargin = startCertifiedDistance - this.barrier.minimumDistance;
    let startDirectionalDerivative = 0;
    let startDirection: VecN | null = null;
    if (startDistance > 0 && pathLength > 0) {
      startDirection = startQuery.result !== null &&
        startQuery.result.status === 'projected'
        ? new VecN(startQuery.result.witness.direction)
        : before.clone().sub(startProjection.point).multiplyScalar(1 / startDistance);
      startDirectionalDerivative = startDirection.dot(displacement);
    }
    const common = {
      startDistance,
      startMargin,
      pathLength,
      startDirectionalDerivative
    } as const;
    if (!(startMargin > 0)) {
      // The start published, and what it published does not clear the open
      // minimum. That is a domain violation, established rather than assumed,
      // and the measured start evidence is reported with it.
      return Object.freeze({
        ...common,
        status: 'indeterminate',
        reason: 'initial-domain-violation',
        certifiedFraction: 0
      });
    }
    if (pathLength === 0) {
      return Object.freeze({
        ...common,
        status: 'safe',
        maximumStepLength: context.requestedStepLength,
        certifiedFraction: 1,
        certification: 'stationary'
      });
    }
    const directionError = startQuery.result !== null &&
      startQuery.result.status === 'projected'
      ? startQuery.result.error.directionErrorBound
      : 0;
    const directionalDerivativeError = startDirection === null
      ? 0
      : addUpNonnegative(
        multiplyUpNonnegative(directionError, pathLength),
        dotRoundoffBound(startDirection, displacement)
      );
    if (startDirectionalDerivative >= directionalDerivativeError) {
      return Object.freeze({
        ...common,
        status: 'safe',
        maximumStepLength: context.requestedStepLength,
        certifiedFraction: 1,
        certification: 'convex-nondecreasing'
      });
    }
    if (pathLength < startMargin) {
      return Object.freeze({
        ...common,
        status: 'safe',
        maximumStepLength: context.requestedStepLength,
        certifiedFraction: 1,
        certification: 'global-lipschitz'
      });
    }
    const certifiedFraction =
      this.conservativeScale * startMargin / pathLength;
    const maximumStepLength =
      context.requestedStepLength * certifiedFraction;
    if (!Number.isFinite(certifiedFraction) ||
      certifiedFraction < 0 || certifiedFraction >= 1 ||
      !Number.isFinite(maximumStepLength) || maximumStepLength < 0 ||
      !(maximumStepLength < context.requestedStepLength)) {
      throw new Error(`${caller}: certified prefix is outside Float64`);
    }
    return Object.freeze({
      ...common,
      status: 'limited',
      maximumStepLength,
      certifiedFraction,
      certification: 'global-lipschitz'
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
    throw new Error(`${caller}: context is R${context.dimension}, expected R${dimension}`);
  }
  if (!Number.isFinite(context.requestedStepLength) ||
    context.requestedStepLength <= 0) {
    throw new Error(`${caller}: requestedStepLength must be finite and positive`);
  }
  if (typeof context.positionBefore !== 'function' ||
    typeof context.positionAfter !== 'function') {
    throw new Error(`${caller}: position lookups must be functions`);
  }
}

/**
 * Queries the simplex, keeping uncertified publication TYPED.
 *
 * `projection` is `null` exactly when `result.status === 'uncertified'`: no
 * witness was published, so there is no projection to build. Callers classify
 * that state themselves rather than receiving a bare error.
 */
function projectForBarrier(
  barrier: XpbdParticleSourceSimplexBarrierN,
  position: VecN
): {
  readonly projection: SourceSimplexProjectionN | null;
  readonly result: PointSimplexResult | null;
} {
  const { simplex } = barrier;
  // The 4..17 legacy fallback. It publishes no exact decision and no direction
  // enclosure, and it is slow enough that the cost belongs in the contract
  // rather than in a footnote: one `evaluateAt()` was measured at roughly
  // 7.8-12.2 seconds at k = 17. That is a batch-scale cost, suitable for
  // offline study of a fixed configuration and unsuitable for anything driven
  // by a clock.
  if (simplex.intrinsicDim > 3) {
    return Object.freeze({
      result: null,
      projection: projectPointToSourceSimplexN(simplex, position.data)
    });
  }
  const packed = new Float64Array(
    simplex.vertexIndices.length * barrier.dimension
  );
  for (let slot = 0; slot < simplex.vertexIndices.length; slot += 1) {
    const source = simplex.complex.getPosition(simplex.vertexIndices[slot]!);
    for (let axis = 0; axis < barrier.dimension; axis += 1) {
      packed[slot * barrier.dimension + axis] = source[axis]!;
    }
  }
  const result = evaluateExactPointSimplexResult(
    position.data, packed, barrier.dimension
  );
  if (result.status === 'rank-deficient') {
    throw new Error(
      `XpbdParticleSourceSimplexBarrierN: source simplex is exactly rank-deficient (rank ${result.exactRank})`
    );
  }
  if (result.status === 'uncertified') {
    // NOT an error here: the caller decides. `evaluateAt` raises the typed
    // potential-domain refusal; the step filter answers `indeterminate`. Both
    // keep the query's own reason, which a bare throw would have destroyed.
    return Object.freeze({ result, projection: null });
  }
  const coordinate: SourceSimplexCoordinateN = Object.freeze({
    kind: 'source-simplex-coordinate',
    reference: simplex,
    weights: result.witness.weights
  });
  return Object.freeze({
    result,
    projection: Object.freeze({
      coordinate,
      point: new VecN(result.witness.point),
      squaredDistance: result.status === 'zero'
        ? 0
        : result.witness.squaredDistance,
      affineRank: result.exactRank,
      unresolvedDegreesOfFreedom: 0,
      candidateFaces: (1 << simplex.vertexIndices.length) - 1
    })
  });
}

function pointSimplexDistance(result: PointSimplexResult): number {
  if (result.status === 'projected') return result.witness.distance;
  if (result.status === 'zero') return 0;
  if (result.status === 'rank-deficient') {
    throw new Error(
      `XpbdParticleSourceSimplexBarrierN: source simplex is exactly rank-deficient (rank ${result.exactRank})`
    );
  }
  // Unreachable: callers classify `uncertified` before asking for a distance.
  throw new Error(
    `XpbdParticleSourceSimplexBarrierN: point--simplex result is uncertified (${result.reason}: ${result.detail})`
  );
}

function certifiedDistanceLowerBound(query: {
  readonly projection: SourceSimplexProjectionN | null;
  readonly result: PointSimplexResult | null;
}): number {
  const { result } = query;
  if (result === null) return Math.sqrt(query.projection!.squaredDistance);
  if (result.status === 'zero') return 0;
  if (result.status === 'rank-deficient') {
    throw new Error(
      `XpbdParticleSourceSimplexBarrierN: source simplex is exactly rank-deficient (rank ${result.exactRank})`
    );
  }
  if (result.status === 'uncertified') {
    throw new Error(
      `XpbdParticleSourceSimplexBarrierN: point--simplex result is uncertified (${result.reason}: ${result.detail})`
    );
  }
  const lowerSquared = nextDownNonnegative(
    result.witness.squaredDistance - result.error.squaredDistanceErrorBound
  );
  if (!(lowerSquared > 0)) return 0;
  return nextDownNonnegative(Math.sqrt(lowerSquared));
}

/** Greatest non-negative Float64 strictly below a positive finite input. */
function nextDownNonnegative(value: number): number {
  if (!(value > 0)) return 0;
  if (!Number.isFinite(value)) return Number.MAX_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, bits - 1n);
  return view.getFloat64(0);
}

function nextUpNonnegative(value: number): number {
  if (value === 0) return 0;
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, bits + 1n);
  return view.getFloat64(0);
}

function addUpNonnegative(left: number, right: number): number {
  return nextUpNonnegative(left + right);
}

function multiplyUpNonnegative(left: number, right: number): number {
  const product = left * right;
  if (product === 0 && left > 0 && right > 0) return Number.MIN_VALUE;
  return nextUpNonnegative(product);
}

function dotRoundoffBound(left: VecN, right: VecN): number {
  let absoluteProducts = 0;
  for (let axis = 0; axis < left.dim; axis += 1) {
    absoluteProducts = addUpNonnegative(
      absoluteProducts,
      multiplyUpNonnegative(
        Math.abs(left.data[axis]!), Math.abs(right.data[axis]!)
      )
    );
  }
  const operations = 2 * left.dim;
  const gamma = operations * Number.EPSILON /
    (1 - operations * Number.EPSILON);
  return multiplyUpNonnegative(gamma, absoluteProducts);
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
