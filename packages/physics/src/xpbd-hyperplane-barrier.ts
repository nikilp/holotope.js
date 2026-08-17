import { VecN } from '@holotope/core';
import {
  evaluateClampedLogBarrierAtOrderN,
  type ClampedLogBarrierCurvatureN,
  type ClampedLogBarrierForceN
} from './clamped-log-barrier.js';
import { HyperplaneColliderN } from './hyperplane-collider.js';
import { XpbdPotentialDomainErrorN } from './xpbd-potential-domain.js';
import {
  type XpbdConservativeHessianVectorEvaluationN,
  type XpbdConservativeHessianVectorProviderN,
  type XpbdParticleDirectionQueryN
} from './xpbd-incremental-potential-analytic-curvature.js';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderEvaluationN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

/**
 * Open-domain refusal vocabulary of a particle–hyperplane barrier.
 *
 * `barrier-component-outside-float64` refuses a candidate at which a scalar
 * component this provider's published result requires arrived unavailable;
 * `assembled-product-outside-float64` refuses a candidate/direction pair
 * whose Hessian-vector product left Float64 while every scalar component was
 * representable — the assembled composition is this caller's own, outside
 * the scalar guarantee. Both are candidate-dependent, so both are
 * recoverable domain refusals rather than authored failures.
 */
export type XpbdParticleHyperplaneBarrierDomainReasonN =
  | 'at-or-below-minimum-distance'
  | 'barrier-component-outside-float64'
  | 'assembled-product-outside-float64';

/** Construction options for one conservative RN particle–plane barrier. */
export interface XpbdParticleHyperplaneBarrierNOptions {
  /** Stable provider identifier. */
  readonly id: string;
  /** Live particle whose candidate position supplies the signed distance. */
  readonly particle: XpbdParticleN;
  /** Oriented plane whose positive half-space is admissible. */
  readonly plane: HyperplaneColliderN;
  /** Open hard distance boundary. Default zero. */
  readonly minimumDistance?: number;
  /** Distance at and above which the barrier is exactly zero. */
  readonly activationDistance: number;
  /** Positive energy scale. */
  readonly stiffness: number;
}

/** Conservative force and complete scalar evidence at one candidate point. */
export interface XpbdParticleHyperplaneBarrierEvaluationN
  extends XpbdConservativeForceProviderEvaluationN {
  /** `normal dot position - offset`. */
  readonly signedDistance: number;
  /** `signedDistance - minimumDistance`. */
  readonly barrierCoordinate: number;
  /** `activationDistance - minimumDistance`. */
  readonly barrierActivation: number;
  /**
   * The graded order-1 scalar evaluation this force was built from. Both
   * required components were available (the provider refused otherwise), so
   * a consumer may narrow them without re-checking.
   */
  readonly barrier: ClampedLogBarrierForceN;
  /** One force paired with the provider's one particle. */
  readonly forces: readonly [VecN];
}

/** The order-2 variant the Hessian-vector path republishes as its base. */
export interface XpbdParticleHyperplaneBarrierCurvatureEvaluationN
  extends XpbdParticleHyperplaneBarrierEvaluationN {
  /** The graded order-2 scalar evaluation, all three components available. */
  readonly barrier: ClampedLogBarrierCurvatureN;
}

/** Exact potential Hessian-vector evidence for one point–plane barrier. */
export interface XpbdParticleHyperplaneBarrierHessianVectorEvaluationN
  extends XpbdConservativeHessianVectorEvaluationN {
  /** Scalar barrier and signed-distance evidence at the candidate point. */
  readonly base: XpbdParticleHyperplaneBarrierCurvatureEvaluationN;
  /** `plane.normal dot direction`. */
  readonly normalDirection: number;
  /** One mathematical potential Hessian-vector product. */
  readonly products: readonly [VecN];
}

/**
 * Conservative C2-clamped log barrier between one RN point and hyperplane.
 *
 * The provider can serve both ordinary `XpbdWorldN` force evaluation and the
 * trial-state objective used by the incremental-potential solver. Candidate
 * states at or below `minimumDistance` produce a typed domain refusal so a
 * line search can backtrack without treating malformed provider code as
 * recoverable.
 */
export class XpbdParticleHyperplaneBarrierN
implements XpbdConservativeHessianVectorProviderN {
  /** Stable force-provider identity. */
  readonly id: string;
  /** Ambient particle and plane dimension. */
  readonly dimension: number;
  /** Live particle whose current and candidate positions are evaluated. */
  readonly particle: XpbdParticleN;
  /** One-element provider particle list paired with returned forces. */
  readonly particles: readonly [XpbdParticleN];
  /** Defensively copied oriented plane with a unit normal. */
  readonly plane: HyperplaneColliderN;
  /** Open hard signed-distance boundary. */
  readonly minimumDistance: number;
  /** Signed distance at and above which energy and force are zero. */
  readonly activationDistance: number;
  /** Positive scalar energy multiplier. */
  readonly stiffness: number;

  /**
   * Creates one conservative point–plane distance barrier.
   *
   * @param options Particle, plane, open boundary, activation, and energy scale.
   */
  constructor(options: XpbdParticleHyperplaneBarrierNOptions) {
    const caller = 'XpbdParticleHyperplaneBarrierN';
    if (typeof options !== 'object' || options === null) {
      throw new Error(`${caller}: options must be an object`);
    }
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(`${caller}: id must be a non-empty string`);
    }
    if (!(options.particle instanceof XpbdParticleN)) {
      throw new Error(`${caller}: particle must be an XpbdParticleN`);
    }
    if (!(options.plane instanceof HyperplaneColliderN)) {
      throw new Error(`${caller}: plane must be a HyperplaneColliderN`);
    }
    if (options.plane.dim !== options.particle.dimension) {
      throw new Error(
        `${caller}: plane is R${options.plane.dim}, particle is R${options.particle.dimension}`
      );
    }
    const minimumDistance = options.minimumDistance ?? 0;
    if (!Number.isFinite(minimumDistance) || minimumDistance < 0) {
      throw new Error(
        `${caller}: minimumDistance must be finite and non-negative`
      );
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

    this.id = options.id;
    this.dimension = options.particle.dimension;
    this.particle = options.particle;
    this.particles = Object.freeze([options.particle]);
    this.plane = new HyperplaneColliderN(
      options.plane.normal,
      options.plane.offset
    );
    this.minimumDistance = minimumDistance;
    this.activationDistance = options.activationDistance;
    this.stiffness = options.stiffness;
  }

  /** Evaluates from the particle's current live position without mutation. */
  evaluate(): XpbdParticleHyperplaneBarrierEvaluationN {
    return this.evaluateAt((particle) => particle.position.clone());
  }

  /** Shared candidate geometry: validation, distances, and the open bound. */
  private resolveGeometry(
    positionOf: XpbdParticlePositionQueryN, caller: string
  ): {
      signedDistance: number;
      barrierCoordinate: number;
      barrierActivation: number;
    } {
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    const position = positionOf(this.particle);
    if (!(position instanceof VecN) || position.dim !== this.dimension) {
      throw new Error(
        `${caller}: candidate position must be R${this.dimension}`
      );
    }
    for (const coordinate of position.data) {
      if (!Number.isFinite(coordinate)) {
        throw new Error(`${caller}: candidate position must be finite`);
      }
    }

    const signedDistance = this.plane.normal.dot(position) - this.plane.offset;
    if (!Number.isFinite(signedDistance)) {
      throw new Error(`${caller}: signed distance is outside Float64`);
    }
    const barrierCoordinate = signedDistance - this.minimumDistance;
    if (!(barrierCoordinate > 0)) {
      throw new XpbdPotentialDomainErrorN<
        XpbdParticleHyperplaneBarrierDomainReasonN
      >(
        this.id,
        'at-or-below-minimum-distance',
        `${caller}: signed distance must be greater than minimumDistance`
      );
    }
    return {
      signedDistance,
      barrierCoordinate,
      barrierActivation: this.activationDistance - this.minimumDistance
    };
  }

  /**
   * Evaluates from a caller-supplied candidate-position lookup without
   * mutating that vector or the live particle.
   */
  evaluateAt(
    positionOf: XpbdParticlePositionQueryN
  ): XpbdParticleHyperplaneBarrierEvaluationN {
    const caller = 'XpbdParticleHyperplaneBarrierN.evaluateAt';
    const geometry = this.resolveGeometry(positionOf, caller);
    // This provider publishes a potential energy and one force, so it
    // requests order 1 — never a curvature it would not use.
    const barrier = evaluateClampedLogBarrierAtOrderN({
      coordinate: geometry.barrierCoordinate,
      activation: geometry.barrierActivation,
      stiffness: this.stiffness
    }, 1);
    if (!barrier.energy.available || !barrier.firstDerivative.available) {
      const missing = !barrier.energy.available
        ? 'energy' : 'first derivative';
      throw new XpbdPotentialDomainErrorN<
        XpbdParticleHyperplaneBarrierDomainReasonN
      >(
        this.id,
        'barrier-component-outside-float64',
        `${caller}: the barrier ${missing} is outside Float64 at this candidate`
      );
    }
    const force = this.plane.normal.clone().multiplyScalar(
      -barrier.firstDerivative.value
    );
    return Object.freeze({
      signedDistance: geometry.signedDistance,
      barrierCoordinate: geometry.barrierCoordinate,
      barrierActivation: geometry.barrierActivation,
      barrier,
      potentialEnergy: barrier.energy.value,
      forces: Object.freeze([force]) as readonly [VecN]
    });
  }

  /**
   * Evaluates `Hessian(U) * direction` from candidate-position queries.
   *
   * For the affine signed distance this is exactly
   * `barrier.secondDerivative * normal * dot(normal, direction)`.
   */
  evaluatePotentialHessianVectorAt(
    positionOf: XpbdParticlePositionQueryN,
    directionOf: XpbdParticleDirectionQueryN
  ): XpbdParticleHyperplaneBarrierHessianVectorEvaluationN {
    const caller =
      'XpbdParticleHyperplaneBarrierN.evaluatePotentialHessianVectorAt';
    if (typeof directionOf !== 'function') {
      throw new Error(`${caller}: directionOf must be a function`);
    }
    // This method republishes its whole base evaluation AND consumes the
    // curvature, so it is the one caller that requests order 2.
    const geometry = this.resolveGeometry(positionOf, caller);
    const barrier = evaluateClampedLogBarrierAtOrderN({
      coordinate: geometry.barrierCoordinate,
      activation: geometry.barrierActivation,
      stiffness: this.stiffness
    }, 2);
    if (!barrier.energy.available || !barrier.firstDerivative.available
      || !barrier.secondDerivative.available) {
      throw new XpbdPotentialDomainErrorN<
        XpbdParticleHyperplaneBarrierDomainReasonN
      >(
        this.id,
        'barrier-component-outside-float64',
        `${caller}: a required barrier component is outside Float64 at this`
        + ' candidate'
      );
    }
    const baseForce = this.plane.normal.clone().multiplyScalar(
      -barrier.firstDerivative.value
    );
    const base: XpbdParticleHyperplaneBarrierCurvatureEvaluationN =
      Object.freeze({
        signedDistance: geometry.signedDistance,
        barrierCoordinate: geometry.barrierCoordinate,
        barrierActivation: geometry.barrierActivation,
        barrier,
        potentialEnergy: barrier.energy.value,
        forces: Object.freeze([baseForce]) as readonly [VecN]
      });
    const direction = directionOf(this.particle);
    if (!(direction instanceof VecN) || direction.dim !== this.dimension) {
      throw new Error(`${caller}: candidate direction must be R${this.dimension}`);
    }
    for (const coordinate of direction.data) {
      if (!Number.isFinite(coordinate)) {
        throw new Error(`${caller}: candidate direction must be finite`);
      }
    }
    const normalDirection = this.plane.normal.dot(direction);
    // The product of an available curvature with the caller's direction is
    // THIS provider's composition; the scalar guarantee does not cover it.
    const scale = barrier.secondDerivative.value * normalDirection;
    if (!Number.isFinite(normalDirection) || !Number.isFinite(scale)) {
      throw new XpbdPotentialDomainErrorN<
        XpbdParticleHyperplaneBarrierDomainReasonN
      >(
        this.id,
        'assembled-product-outside-float64',
        `${caller}: the Hessian-vector product is outside Float64 at this`
        + ' candidate/direction pair'
      );
    }
    const product = this.plane.normal.clone().multiplyScalar(scale);
    for (const coordinate of product.data) {
      if (!Number.isFinite(coordinate)) {
        throw new XpbdPotentialDomainErrorN<
          XpbdParticleHyperplaneBarrierDomainReasonN
        >(
          this.id,
          'assembled-product-outside-float64',
          `${caller}: the Hessian-vector product is outside Float64 at this`
          + ' candidate/direction pair'
        );
      }
    }
    return Object.freeze({
      base,
      normalDirection,
      products: Object.freeze([product]) as readonly [VecN]
    });
  }
}
