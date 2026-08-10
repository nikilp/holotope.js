import {
  VecN,
  inspectSourceSimplexReferenceN,
  type SourceSimplexReferenceN
} from '@holotope/core';
import {
  evaluateClampedLogBarrier,
  type ClampedLogBarrierEvaluation
} from './clamped-log-barrier.js';
import {
  evaluateSourceSimplexPairDistanceN,
  type SourceSimplexPairSeparatedUniqueN
} from './simplex-pair-distance.js';
import {
  type XpbdIncrementalPotentialStepFilterContextN,
  type XpbdIncrementalPotentialStepFilterN
} from './xpbd-incremental-potential-step-filter.js';
import { XpbdPotentialDomainErrorN } from './xpbd-potential-domain.js';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderEvaluationN,
  type XpbdConservativeForceProviderN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

/** Open-domain refusal vocabulary of the source-simplex pair barrier. */
export type XpbdSourceSimplexPairBarrierDomainReasonN =
  | 'zero-or-intersecting'
  | 'at-or-below-minimum-distance'
  | 'tied-witness-no-unique-gradient'
  | 'uncertified-distance';

/** Construction options for one conservative RN feature-pair barrier. */
export interface XpbdSourceSimplexPairBarrierNOptions {
  /** Stable provider identifier. */
  readonly id: string;
  /**
   * Live particles carrying side A's vertices, **one per vertex of
   * `featureA`, in that reference's own vertex order** — slot `i` is the
   * candidate position of `featureA.vertexIndices[i]`.
   */
  readonly particlesA: readonly XpbdParticleN[];
  /** Persistent identity of the deforming feature. */
  readonly featureA: SourceSimplexReferenceN;
  /**
   * Optional live particles for side B, same slot convention. Omitted, side B
   * is static and reads its reference's complex positions — the moving-
   * segment-against-static-segment composition this slice commissions first.
   */
  readonly particlesB?: readonly XpbdParticleN[];
  /** Persistent identity of the opposing feature. */
  readonly featureB: SourceSimplexReferenceN;
  /** Open unsigned distance boundary. Default zero. */
  readonly minimumDistance?: number;
  /** Distance at and above which the barrier is exactly zero. */
  readonly activationDistance: number;
  /** Positive energy scale. */
  readonly stiffness: number;
  /** Relative affine-rank tolerance forwarded to the pair query. Default `1e-10`. */
  readonly rankTolerance?: number;
}

/** Conservative forces and closest-pair evidence at one candidate placement. */
export interface XpbdSourceSimplexPairBarrierEvaluationN
  extends XpbdConservativeForceProviderEvaluationN {
  /** The certified unique pair result the forces were derived from. */
  readonly pair: SourceSimplexPairSeparatedUniqueN;
  /** Unsigned distance between the features. */
  readonly distance: number;
  /** Unit vector from side B's witness toward side A's. */
  readonly separationNormal: VecN;
  /** `distance - minimumDistance`. */
  readonly barrierCoordinate: number;
  /** `activationDistance - minimumDistance`. */
  readonly barrierActivation: number;
  /** Scalar barrier value and derivatives with respect to distance. */
  readonly barrier: ClampedLogBarrierEvaluation;
  /** One force per provider particle: side A slots first, then side B's. */
  readonly forces: readonly VecN[];
}

/**
 * Conservative RN distance barrier between two source-simplex features.
 *
 * This is the feature-pair generalization of
 * `XpbdParticleSourceSimplexBarrierN`: the same clamped-log law over the same
 * open coordinate `distance − minimumDistance`, with the distance now coming
 * from {@link evaluateSourceSimplexPairDistanceN} and the force distributed
 * through the returned **source-ordered barycentric weights** — the envelope
 * form. Each side-A particle `i` receives `−b′·λᵢ·n̂` and each side-B
 * particle `j` (when side B moves) receives `+b′·μⱼ·n̂`, so the pair's net
 * internal force is exactly zero in exact arithmetic and near roundoff in
 * Float64, and the RN antisymmetric first moment cancels because every force
 * acts along the common witness line.
 *
 * The energy is differentiable exactly where the closest pair is unique, and
 * the provider refuses everything else **by type instead of fabricating
 * physics**: a tied witness (`separated-multiple` — parallel segments are the
 * canonical case) has no unique gradient to distribute; zero distance has no
 * direction at all; an uncertified comparison is not a distance. Refusals are
 * `XpbdPotentialDomainErrorN` values naming the reason, and no particle or
 * source state is touched on any path — evaluation is read-only.
 *
 * Pair it with `XpbdSourceSimplexPairBarrierStepFilterN`: endpoint energy
 * alone cannot see a feature that sweeps through the other and ends clear.
 */
export class XpbdSourceSimplexPairBarrierN
implements XpbdConservativeForceProviderN {
  /** Stable force-provider identity. */
  readonly id: string;
  /** Ambient dimension shared by both features and every particle. */
  readonly dimension: number;
  /** Side-A particles, one per `featureA` vertex, in source order. */
  readonly particlesA: readonly XpbdParticleN[];
  /** Side-B particles when side B moves; `undefined` for a static side B. */
  readonly particlesB: readonly XpbdParticleN[] | undefined;
  /** Provider particle list: side A slots first, then side B's (if moving). */
  readonly particles: readonly XpbdParticleN[];
  /** Persistent deforming-feature identity. */
  readonly featureA: SourceSimplexReferenceN;
  /** Persistent opposing-feature identity. */
  readonly featureB: SourceSimplexReferenceN;
  /** Open hard unsigned-distance boundary. */
  readonly minimumDistance: number;
  /** Distance at and above which energy and force are zero. */
  readonly activationDistance: number;
  /** Positive scalar energy multiplier. */
  readonly stiffness: number;
  /** Affine-rank tolerance forwarded to the pair query. */
  readonly rankTolerance: number;

  /** Creates one source-retained feature-pair proximity barrier. */
  constructor(options: XpbdSourceSimplexPairBarrierNOptions) {
    const caller = 'XpbdSourceSimplexPairBarrierN';
    if (typeof options !== 'object' || options === null) {
      throw new Error(`${caller}: options must be an object`);
    }
    const unknown = Object.keys(options).filter((key) => ![
      'id', 'particlesA', 'featureA', 'particlesB', 'featureB',
      'minimumDistance', 'activationDistance', 'stiffness', 'rankTolerance'
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
    for (const [label, reference] of [
      ['featureA', options.featureA],
      ['featureB', options.featureB]
    ] as const) {
      if (typeof reference !== 'object' || reference === null ||
          reference.kind !== 'source-simplex-reference') {
        throw new Error(`${caller}: ${label} must be a SourceSimplexReferenceN`);
      }
      const status = inspectSourceSimplexReferenceN(reference);
      if (status.kind === 'retired') {
        throw new Error(`${caller}: ${label} is retired (${status.reason})`);
      }
    }
    const dimension = options.featureA.complex.ambientDim;
    if (options.featureB.complex.ambientDim !== dimension) {
      throw new Error(
        `${caller}: featureA is in R${dimension}, ` +
        `featureB is in R${options.featureB.complex.ambientDim}`
      );
    }
    const validateParticles = (
      label: string,
      particles: readonly XpbdParticleN[],
      expected: number
    ): void => {
      if (!Array.isArray(particles) || particles.length !== expected) {
        throw new Error(
          `${caller}: ${label} must list exactly ${expected} particles, one per ` +
          'feature vertex in source order'
        );
      }
      for (const particle of particles) {
        if (!(particle instanceof XpbdParticleN)) {
          throw new Error(`${caller}: ${label} entries must be XpbdParticleN`);
        }
        if (particle.dimension !== dimension) {
          throw new Error(
            `${caller}: ${label} particle is R${particle.dimension}, features are in R${dimension}`
          );
        }
      }
    };
    validateParticles('particlesA', options.particlesA, options.featureA.vertexIndices.length);
    if (options.particlesB !== undefined) {
      validateParticles('particlesB', options.particlesB, options.featureB.vertexIndices.length);
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
    const rankTolerance = options.rankTolerance ?? 1e-10;
    if (!Number.isFinite(rankTolerance) || rankTolerance <= 0) {
      throw new Error(`${caller}: rankTolerance must be finite and positive`);
    }

    this.id = options.id;
    this.dimension = dimension;
    this.particlesA = Object.freeze([...options.particlesA]);
    this.particlesB = options.particlesB === undefined
      ? undefined
      : Object.freeze([...options.particlesB]);
    this.particles = Object.freeze([
      ...this.particlesA,
      ...(this.particlesB ?? [])
    ]);
    this.featureA = options.featureA;
    this.featureB = options.featureB;
    this.minimumDistance = minimumDistance;
    this.activationDistance = options.activationDistance;
    this.stiffness = options.stiffness;
    this.rankTolerance = rankTolerance;
  }

  /** Evaluates from the particles' current live positions without mutation. */
  evaluate(): XpbdSourceSimplexPairBarrierEvaluationN {
    return this.evaluateAt((particle) => particle.position.clone());
  }

  /** Evaluates one caller-supplied candidate placement without live-state writes. */
  evaluateAt(
    positionOf: XpbdParticlePositionQueryN
  ): XpbdSourceSimplexPairBarrierEvaluationN {
    const caller = 'XpbdSourceSimplexPairBarrierN.evaluateAt';
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    const pair = this.evaluatePairAt(positionOf, caller);
    if (pair.status === 'zero-distance') {
      throw new XpbdPotentialDomainErrorN<XpbdSourceSimplexPairBarrierDomainReasonN>(
        this.id,
        'zero-or-intersecting',
        `${caller}: the features are at certified zero distance; no direction exists`
      );
    }
    if (pair.status === 'separated-multiple') {
      throw new XpbdPotentialDomainErrorN<XpbdSourceSimplexPairBarrierDomainReasonN>(
        this.id,
        'tied-witness-no-unique-gradient',
        `${caller}: ${pair.witnesses.length} tied closest-feature witnesses; ` +
        'no unique gradient is justified'
      );
    }
    if (pair.status === 'indeterminate') {
      throw new XpbdPotentialDomainErrorN<XpbdSourceSimplexPairBarrierDomainReasonN>(
        this.id,
        'uncertified-distance',
        `${caller}: the pair distance could not be certified ` +
        `(residual ${pair.certificateResidual} > tolerance ${pair.tolerance})`
      );
    }
    const distance = pair.distance;
    const barrierCoordinate = distance - this.minimumDistance;
    if (!(barrierCoordinate > 0)) {
      throw new XpbdPotentialDomainErrorN<XpbdSourceSimplexPairBarrierDomainReasonN>(
        this.id,
        'at-or-below-minimum-distance',
        `${caller}: distance must be greater than minimumDistance`
      );
    }
    const barrierActivation = this.activationDistance - this.minimumDistance;
    const barrier = evaluateClampedLogBarrier({
      coordinate: barrierCoordinate,
      activation: barrierActivation,
      stiffness: this.stiffness
    });
    const separationNormal = pair.direction.clone();
    const forces: VecN[] = [];
    const weightsA = pair.witness.coordinateA.weights;
    for (let slot = 0; slot < this.particlesA.length; slot++) {
      forces.push(separationNormal.clone()
        .multiplyScalar(-barrier.firstDerivative * weightsA[slot]!));
    }
    if (this.particlesB !== undefined) {
      const weightsB = pair.witness.coordinateB.weights;
      for (let slot = 0; slot < this.particlesB.length; slot++) {
        forces.push(separationNormal.clone()
          .multiplyScalar(barrier.firstDerivative * weightsB[slot]!));
      }
    }
    return Object.freeze({
      pair,
      distance,
      separationNormal,
      barrierCoordinate,
      barrierActivation,
      barrier,
      potentialEnergy: barrier.energy,
      forces: Object.freeze(forces)
    });
  }

  /** The raw pair query at a candidate placement; used by the paired filter. */
  evaluatePairAt(
    positionOf: XpbdParticlePositionQueryN,
    caller = 'XpbdSourceSimplexPairBarrierN.evaluatePairAt'
  ): ReturnType<typeof evaluateSourceSimplexPairDistanceN> {
    const positionsA = this.packSide(this.particlesA, positionOf, caller, 'particlesA');
    const positionsB = this.particlesB === undefined
      ? undefined
      : this.packSide(this.particlesB, positionOf, caller, 'particlesB');
    return evaluateSourceSimplexPairDistanceN(
      { reference: this.featureA, positions: positionsA },
      positionsB === undefined
        ? { reference: this.featureB }
        : { reference: this.featureB, positions: positionsB },
      { rankTolerance: this.rankTolerance }
    );
  }

  private packSide(
    particles: readonly XpbdParticleN[],
    positionOf: XpbdParticlePositionQueryN,
    caller: string,
    label: string
  ): Float64Array {
    const packed = new Float64Array(particles.length * this.dimension);
    particles.forEach((particle, slot) => {
      const position = positionOf(particle);
      if (!(position instanceof VecN) || position.dim !== this.dimension) {
        throw new Error(`${caller}: ${label}[${slot}] position must be R${this.dimension}`);
      }
      for (let axis = 0; axis < this.dimension; axis++) {
        const value = position.data[axis]!;
        if (!Number.isFinite(value)) {
          throw new Error(`${caller}: ${label}[${slot}] position must be finite`);
        }
        packed[slot * this.dimension + axis] = value;
      }
    });
    return packed;
  }
}

/** Construction options for the paired conservative step filter. */
export interface XpbdSourceSimplexPairBarrierStepFilterNOptions {
  /** Stable authored identity within one compiled problem. */
  readonly id: string;
  /** Barrier whose features and open boundary define admissibility. */
  readonly barrier: XpbdSourceSimplexPairBarrierN;
  /** Fraction of the certified Lipschitz prefix retained; default `0.9`. */
  readonly conservativeScale?: number;
}

/** Why the pair filter could not certify any segment prefix. */
export type XpbdSourceSimplexPairBarrierStepFilterRefusalReasonN =
  | 'initial-domain-violation'
  | 'initial-uncertified-distance';

/** Evidence behind one certified pair segment. */
export interface XpbdSourceSimplexPairBarrierStepFilterEvidenceN {
  /** Certified pair distance at the segment start. */
  readonly startDistance: number;
  /** Start distance above the barrier's open minimum. */
  readonly startMargin: number;
  /** Largest single-vertex displacement on side A over the full segment. */
  readonly maxDisplacementA: number;
  /** Largest single-vertex displacement on side B (zero when static). */
  readonly maxDisplacementB: number;
  /** `maxDisplacementA + maxDisplacementB` — the Lipschitz path bound. */
  readonly totalDisplacement: number;
  /** Certified fraction of the requested segment, in `[0, 1]`. */
  readonly certifiedFraction: number;
  /** Proof used; never an inferred or exact impact time. */
  readonly certification:
    | 'stationary'
    | 'global-lipschitz'
    | 'initial-domain-violation'
    | 'initial-uncertified-distance';
}

/** Result of one conservative pair segment query. */
export type XpbdSourceSimplexPairBarrierStepFilterEvaluationN =
  XpbdSourceSimplexPairBarrierStepFilterEvidenceN & (
    | { readonly status: 'safe'; readonly maximumStepLength: number }
    | { readonly status: 'limited'; readonly maximumStepLength: number }
    | {
        readonly status: 'indeterminate';
        readonly reason: XpbdSourceSimplexPairBarrierStepFilterRefusalReasonN;
      }
  );

/**
 * Conservative RN feature-pair collision-free step filter.
 *
 * The proof is the two-sided Hausdorff/Lipschitz bound: moving every vertex
 * of a simplex by at most `δ` moves the whole convex set by at most `δ` in
 * Hausdorff distance (a convex combination of per-vertex displacements), and
 * the pair distance is 1-Lipschitz in each argument under that metric, so
 * along the linear segment
 *
 * ```text
 * d(t) >= d(0) - t * (maxDisplacementA + maxDisplacementB).
 * ```
 *
 * A segment whose total displacement stays below the start margin is safe in
 * full; otherwise the bound certifies a strict prefix. The result reports a
 * `certifiedFraction`, **never a collision time** — this filter does not
 * solve the piecewise closest-feature crossing. A tied start (parallel
 * features) is fine: the bound needs only the certified distance, which ties
 * still carry; only zero distance and an uncertified start refuse, by type.
 */
export class XpbdSourceSimplexPairBarrierStepFilterN
implements XpbdIncrementalPotentialStepFilterN {
  /** Stable authored filter identity. */
  readonly id: string;
  /** Ambient dimension accepted by the filter. */
  readonly dimension: number;
  /** Paired feature barrier. */
  readonly barrier: XpbdSourceSimplexPairBarrierN;
  /** Exact particle identities read by this filter. */
  readonly particles: readonly XpbdParticleN[];
  /** Strict scale applied to the Lipschitz prefix. */
  readonly conservativeScale: number;

  /** Creates one conservative feature-pair step filter. */
  constructor(options: XpbdSourceSimplexPairBarrierStepFilterNOptions) {
    const caller = 'XpbdSourceSimplexPairBarrierStepFilterN';
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
    if (!(options.barrier instanceof XpbdSourceSimplexPairBarrierN)) {
      throw new Error(`${caller}: barrier must be an XpbdSourceSimplexPairBarrierN`);
    }
    const conservativeScale = options.conservativeScale ?? 0.9;
    if (!Number.isFinite(conservativeScale) ||
        conservativeScale <= 0 || conservativeScale >= 1) {
      throw new Error(`${caller}: conservativeScale must be in (0, 1)`);
    }
    this.id = options.id;
    this.dimension = options.barrier.dimension;
    this.barrier = options.barrier;
    this.particles = options.barrier.particles;
    this.conservativeScale = conservativeScale;
  }

  /** Certifies a complete segment or a conservative strict prefix. */
  evaluate(
    context: XpbdIncrementalPotentialStepFilterContextN
  ): XpbdSourceSimplexPairBarrierStepFilterEvaluationN {
    const caller = 'XpbdSourceSimplexPairBarrierStepFilterN.evaluate';
    if (typeof context !== 'object' || context === null) {
      throw new Error(`${caller}: context must be an object`);
    }
    if (context.dimension !== this.dimension) {
      throw new Error(
        `${caller}: context is R${context.dimension}, expected R${this.dimension}`
      );
    }
    if (!Number.isFinite(context.requestedStepLength) ||
        context.requestedStepLength <= 0) {
      throw new Error(`${caller}: requestedStepLength must be finite and positive`);
    }
    if (typeof context.positionBefore !== 'function' ||
        typeof context.positionAfter !== 'function') {
      throw new Error(`${caller}: position lookups must be functions`);
    }

    const start = this.barrier.evaluatePairAt(
      (particle) => context.positionBefore(particle), caller
    );
    const displacement = (particles: readonly XpbdParticleN[] | undefined): number => {
      if (particles === undefined) return 0;
      let largest = 0;
      for (const particle of particles) {
        const before = context.positionBefore(particle);
        const after = context.positionAfter(particle);
        largest = Math.max(largest, after.clone().sub(before).length());
      }
      return largest;
    };
    const maxDisplacementA = displacement(this.barrier.particlesA);
    const maxDisplacementB = displacement(this.barrier.particlesB);
    const totalDisplacement = maxDisplacementA + maxDisplacementB;

    if (start.status === 'indeterminate') {
      return Object.freeze({
        status: 'indeterminate',
        reason: 'initial-uncertified-distance',
        startDistance: Number.NaN,
        startMargin: Number.NaN,
        maxDisplacementA,
        maxDisplacementB,
        totalDisplacement,
        certifiedFraction: 0,
        certification: 'initial-uncertified-distance'
      });
    }
    const startDistance = start.status === 'zero-distance'
      ? Math.sqrt(start.squaredDistance)
      : start.distance;
    const startMargin = startDistance - this.barrier.minimumDistance;
    const common = {
      startDistance,
      startMargin,
      maxDisplacementA,
      maxDisplacementB,
      totalDisplacement
    } as const;
    if (start.status === 'zero-distance' || !(startMargin > 0)) {
      return Object.freeze({
        ...common,
        status: 'indeterminate',
        reason: 'initial-domain-violation',
        certifiedFraction: 0,
        certification: 'initial-domain-violation'
      });
    }
    if (totalDisplacement === 0) {
      return Object.freeze({
        ...common,
        status: 'safe',
        maximumStepLength: context.requestedStepLength,
        certifiedFraction: 1,
        certification: 'stationary'
      });
    }
    if (totalDisplacement < startMargin) {
      return Object.freeze({
        ...common,
        status: 'safe',
        maximumStepLength: context.requestedStepLength,
        certifiedFraction: 1,
        certification: 'global-lipschitz'
      });
    }
    const certifiedFraction =
      this.conservativeScale * startMargin / totalDisplacement;
    const maximumStepLength = context.requestedStepLength * certifiedFraction;
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
