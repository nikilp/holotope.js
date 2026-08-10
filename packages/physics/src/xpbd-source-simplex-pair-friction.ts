import { VecN, inspectSourceSimplexReferenceN } from '@holotope/core';
import type { SourceSimplexCoordinateN } from '@holotope/core';
import { XpbdPotentialDomainErrorN } from './xpbd-potential-domain.js';
import {
  XpbdSourceSimplexPairBarrierN
} from './xpbd-source-simplex-pair-barrier.js';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderEvaluationN,
  type XpbdConservativeForceProviderN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

/** Why a friction lag could not be prepared from a contact base state. */
export type XpbdSourceSimplexPairFrictionPrepareRefusalN =
  | 'tied-witness-no-unique-gradient'
  | 'zero-or-intersecting'
  | 'uncertified-distance'
  | 'at-or-below-minimum-distance'
  | 'retired-source';

/** Where one prepared lag is in its single-use lifecycle. */
export type XpbdSourceSimplexPairFrictionLagStateN = 'prepared' | 'consumed';

/** Which side of the regularized Coulomb law a candidate slip falls on. */
export type XpbdSourceSimplexPairFrictionRegimeN =
  | 'sticking'
  | 'transition'
  | 'sliding';

/**
 * The immutable evidence frozen at one accepted base state.
 *
 * Everything a friction force needs — the contact frame, the weights, and the
 * normal magnitude — is captured here **once**, which is exactly what makes
 * the potential conservative while this snapshot is held. Nothing in it is
 * recomputed per candidate, and nothing in it can be mutated: an Armijo trial
 * cannot move the lag underneath the objective it is minimizing.
 */
export interface XpbdSourceSimplexPairFrictionLagN {
  /** Ambient dimension. */
  readonly dimension: number;
  /** Source-ordered closest-pair weights on the deforming side. */
  readonly coordinateA: SourceSimplexCoordinateN;
  /** Source-ordered closest-pair weights on the opposing side. */
  readonly coordinateB: SourceSimplexCoordinateN;
  /** Certified unit normal from the pair query, pointing B toward A. */
  readonly normal: VecN;
  /** Accepted-base witness point on side A. */
  readonly basePointA: VecN;
  /** Accepted-base witness point on side B. */
  readonly basePointB: VecN;
  /** Certified pair distance at the accepted base. */
  readonly baseDistance: number;
  /** Non-negative lagged normal-force magnitude, `-b'(baseDistance)`. */
  readonly laggedNormalForce: number;
  /** The measured P56 uniqueness margin that justified this snapshot. */
  readonly uniquenessGap: number;
  /** Single-use state; a consumed lag must be refreshed, never reused. */
  readonly state: XpbdSourceSimplexPairFrictionLagStateN;
}

/** Options for {@link XpbdSourceSimplexPairFrictionN}. */
export interface XpbdSourceSimplexPairFrictionNOptions {
  /** Stable provider identity, distinct from every authored world provider. */
  readonly id: string;
  /** The paired barrier supplying the contact, its features, and its particles. */
  readonly barrier: XpbdSourceSimplexPairBarrierN;
  /** Isotropic Coulomb coefficient; `0` disables the term exactly. */
  readonly frictionCoefficient: number;
  /**
   * Slip length below which the Coulomb law is regularized, in **world length
   * units** — not a velocity threshold and not scaled by the timestep.
   */
  readonly slipRegularization: number;
}

/** Conservative-for-one-lag friction evidence at one candidate placement. */
export interface XpbdSourceSimplexPairFrictionEvaluationN
  extends XpbdConservativeForceProviderEvaluationN {
  /** The frozen snapshot this evaluation was taken against. */
  readonly lag: XpbdSourceSimplexPairFrictionLagN;
  /** Tangential slip relative to the lag base. */
  readonly slip: VecN;
  /** `‖slip‖`. */
  readonly slipMagnitude: number;
  /** Which side of the regularization the slip falls on. */
  readonly regime: XpbdSourceSimplexPairFrictionRegimeN;
  /** `frictionCoefficient * laggedNormalForce`; the force may not exceed it. */
  readonly forceLimit: number;
  /** The common tangential force; side A receives `-g`, side B `+g`. */
  readonly tangentForce: VecN;
  /** One force per provider particle: side A slots first, then side B's. */
  readonly forces: readonly VecN[];
}

const CALLER = 'XpbdSourceSimplexPairFrictionN';

/**
 * Lagged tangential friction as a term **inside** the incremental objective.
 *
 * This is not the post-projection Coulomb velocity response
 * (`XpbdParticleHyperplaneFrictionN`) and cannot be substituted for it: that
 * one corrects velocities after a position solve, while this one contributes
 * an energy and a force to the objective the minimizer is descending. The
 * world-scoped optimizer refuses velocity responses on purpose, and this term
 * does not route around that refusal — it satisfies the conservative-provider
 * contract honestly, **for one frozen lag**.
 *
 * ## Conservative with one frozen lag, dissipative across accepted states
 *
 * The contact frame, the source-ordered weights, and the normal-force
 * magnitude are captured once at an accepted base state by {@link prepare}.
 * While that snapshot is held, the potential
 *
 * ```text
 * D(x) = mu * lambdaLag * s(‖u(x)‖),   u(x) = (I - n nᵀ)(r(x) - r0)
 * ```
 *
 * is an ordinary function of position with an exact gradient, so every
 * line-search trial sees one consistent objective. Dissipation appears
 * **between** accepted states, when the lag is refreshed. Calling this a
 * globally conservative physical force would be wrong, and the vocabulary
 * here says so.
 *
 * `s` is the regularized norm: exact above `slipRegularization`, quadratic
 * below it. The potential is C¹ and the force is C⁰ everywhere — including
 * through zero slip, where the force is linear in the slip and `u/‖u‖` is
 * never evaluated. It is deliberately **not** C², which matters only to a
 * curvature policy. The force magnitude satisfies `‖f‖ ≤ mu·lambdaLag` by
 * construction rather than by clamping, with equality exactly when sliding.
 *
 * ## What may create a lag
 *
 * Only a P56 `separated-unique` pair with a positive open distance: that is
 * the one branch carrying a certified normal, a unique witness, and a
 * measured margin justifying a derivative. Tied witnesses, certified zero
 * distance, uncertified comparisons and sub-minimum distances are refused by
 * type. A refusal never yields a zero-magnitude term, because "no contact to
 * rub" and "a term that happens to be zero" are different claims.
 *
 * Prior art: Li et al., *Incremental Potential Contact* (SIGGRAPH 2020) for
 * evaluating friction as a lagged, smoothed potential inside the incremental
 * objective. The implementation is original to this repository.
 *
 * @example
 * Prepare a lag at an accepted state, minimize against it, then refresh:
 * ```ts
 * const complex = new CellComplex(3, Float64Array.from([
 *   -1, 0.1, -1,
 *   1, 0.1, 1,
 *   -1, 0, 0,
 *   1, 0, 0
 * ]), [
 *   { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from([0, 1]) },
 *   { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from([2, 3]) }
 * ]);
 * const moverGroup = complex.groups[0];
 * const staticGroup = complex.groups[1];
 * if (moverGroup === undefined || staticGroup === undefined) {
 *   throw new Error('expected both authored groups');
 * }
 * const particles = [0, 1].map((vertex) => new XpbdParticleN({
 *   id: `a-${vertex}`,
 *   position: new VecN(Array.from(
 *     complex.positions.subarray(vertex * 3, (vertex + 1) * 3)
 *   )),
 *   inverseMass: 1
 * }));
 * const barrier = new XpbdSourceSimplexPairBarrierN({
 *   id: 'contact',
 *   particlesA: particles,
 *   featureA: createSourceSimplexReferenceN(
 *     createSourceCellReferenceN(complex, moverGroup, 0)
 *   ),
 *   featureB: createSourceSimplexReferenceN(
 *     createSourceCellReferenceN(complex, staticGroup, 0)
 *   ),
 *   activationDistance: 0.5,
 *   stiffness: 4
 * });
 *
 * const friction = new XpbdSourceSimplexPairFrictionN({
 *   id: 'slide', barrier, frictionCoefficient: 0.4, slipRegularization: 1e-3
 * });
 * const prepared = friction.prepare();          // freezes one lag
 * log('regime at rest', prepared.evaluate().regime); // 'sticking'
 * log('limit', prepared.evaluate().forceLimit);      // mu * lagged normal force
 *
 * // …one world step later, from the newly accepted state:
 * const refreshed = friction.prepare();
 * log('refreshed', refreshed.lag.state); // 'prepared'
 * ```
 */
export class XpbdSourceSimplexPairFrictionN {
  /** Stable provider identity. */
  readonly id: string;
  /** Ambient dimension, inherited from the paired barrier. */
  readonly dimension: number;
  /** The paired barrier supplying contact, features, and particle identity. */
  readonly barrier: XpbdSourceSimplexPairBarrierN;
  /** Isotropic Coulomb coefficient. */
  readonly frictionCoefficient: number;
  /** Regularization length, in world length units. */
  readonly slipRegularization: number;

  /** Creates a friction term paired with one contact barrier. */
  constructor(options: XpbdSourceSimplexPairFrictionNOptions) {
    if (typeof options !== 'object' || options === null) {
      throw new Error(`${CALLER}: options must be an object`);
    }
    const unknown = Object.keys(options).filter((key) => ![
      'id', 'barrier', 'frictionCoefficient', 'slipRegularization'
    ].includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `${CALLER}: unknown option${unknown.length === 1 ? '' : 's'} ` +
        unknown.sort().map((key) => `"${key}"`).join(', ')
      );
    }
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(`${CALLER}: id must be a non-empty string`);
    }
    if (!(options.barrier instanceof XpbdSourceSimplexPairBarrierN)) {
      throw new Error(`${CALLER}: barrier must be an XpbdSourceSimplexPairBarrierN`);
    }
    if (!Number.isFinite(options.frictionCoefficient) || options.frictionCoefficient < 0) {
      throw new Error(`${CALLER}: frictionCoefficient must be finite and non-negative`);
    }
    if (!Number.isFinite(options.slipRegularization) || options.slipRegularization <= 0) {
      throw new Error(`${CALLER}: slipRegularization must be finite and positive`);
    }
    this.id = options.id;
    this.dimension = options.barrier.dimension;
    this.barrier = options.barrier;
    this.frictionCoefficient = options.frictionCoefficient;
    this.slipRegularization = options.slipRegularization;
  }

  /**
   * Freezes one lag at the current (accepted) state and returns the immutable
   * provider that may be minimized against exactly once.
   *
   * @throws {XpbdPotentialDomainErrorN} when the contact cannot justify a
   * friction term: tied witnesses, certified zero distance, an uncertified
   * comparison, a sub-minimum distance, or a retired source.
   */
  prepare(): XpbdPreparedSourceSimplexPairFrictionN {
    return this.prepareAt((particle) => particle.position.clone());
  }

  /** Freezes one lag at an explicit accepted base placement. */
  prepareAt(positionOf: XpbdParticlePositionQueryN): XpbdPreparedSourceSimplexPairFrictionN {
    const caller = `${CALLER}.prepareAt`;
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    for (const [label, reference] of [
      ['featureA', this.barrier.featureA], ['featureB', this.barrier.featureB]
    ] as const) {
      if (inspectSourceSimplexReferenceN(reference).kind === 'retired') {
        throw new XpbdPotentialDomainErrorN<XpbdSourceSimplexPairFrictionPrepareRefusalN>(
          this.id, 'retired-source', `${caller}: ${label} is retired`
        );
      }
    }
    const pair = this.barrier.evaluatePairAt(positionOf, caller);
    if (pair.status === 'separated-multiple') {
      throw new XpbdPotentialDomainErrorN<XpbdSourceSimplexPairFrictionPrepareRefusalN>(
        this.id, 'tied-witness-no-unique-gradient',
        `${caller}: ${pair.witnesses.length} tied closest-feature witnesses; ` +
        'a friction frame cannot be chosen from among them'
      );
    }
    if (pair.status === 'zero-distance') {
      throw new XpbdPotentialDomainErrorN<XpbdSourceSimplexPairFrictionPrepareRefusalN>(
        this.id, 'zero-or-intersecting',
        `${caller}: certified zero distance leaves no tangent plane`
      );
    }
    if (pair.status === 'indeterminate') {
      throw new XpbdPotentialDomainErrorN<XpbdSourceSimplexPairFrictionPrepareRefusalN>(
        this.id, 'uncertified-distance',
        `${caller}: the pair distance could not be certified ` +
        `(residual ${pair.certificateResidual} > tolerance ${pair.tolerance})`
      );
    }
    if (!(pair.distance > this.barrier.minimumDistance)) {
      throw new XpbdPotentialDomainErrorN<XpbdSourceSimplexPairFrictionPrepareRefusalN>(
        this.id, 'at-or-below-minimum-distance',
        `${caller}: distance must be greater than the barrier's minimumDistance`
      );
    }
    // The lagged normal magnitude is the paired barrier's own force at this
    // base — not a separately authored value, and not recomputed with another
    // tolerance. A Coulomb bound built from anything else is not Coulomb's law.
    const barrierEvaluation = this.barrier.evaluateAt(positionOf);
    const laggedNormalForce = Math.abs(barrierEvaluation.barrier.firstDerivative);

    const lag: XpbdSourceSimplexPairFrictionLagN = Object.freeze({
      dimension: this.dimension,
      coordinateA: pair.witness.coordinateA,
      coordinateB: pair.witness.coordinateB,
      normal: pair.direction.clone(),
      basePointA: pair.witness.pointA.clone(),
      basePointB: pair.witness.pointB.clone(),
      baseDistance: pair.distance,
      laggedNormalForce,
      uniquenessGap: pair.uniquenessGap,
      state: 'prepared'
    });
    return new XpbdPreparedSourceSimplexPairFrictionN(this, lag);
  }
}

/**
 * One immutable prepared friction term, valid for **exactly one** minimization.
 *
 * It satisfies `XpbdConservativeForceProviderN` for its frozen lag, so the
 * world-scoped optimizer can evaluate it many times during a line search and
 * always see one consistent objective. Reusing a consumed lag is a named
 * failure rather than an implicit refresh, because a silently refreshed lag
 * would make the objective move between Armijo trials.
 */
export class XpbdPreparedSourceSimplexPairFrictionN
implements XpbdConservativeForceProviderN {
  /** Stable provider identity, inherited from the preparing term. */
  readonly id: string;
  /** Ambient dimension. */
  readonly dimension: number;
  /** Side-A particles then side-B particles, matching `forces`. */
  readonly particles: readonly XpbdParticleN[];
  /** The friction term that prepared this lag. */
  readonly source: XpbdSourceSimplexPairFrictionN;

  private lagState: XpbdSourceSimplexPairFrictionLagN;

  /** @internal Prepared through {@link XpbdSourceSimplexPairFrictionN.prepare}. */
  constructor(
    source: XpbdSourceSimplexPairFrictionN,
    lag: XpbdSourceSimplexPairFrictionLagN
  ) {
    this.source = source;
    this.id = source.id;
    this.dimension = source.dimension;
    this.particles = source.barrier.particles;
    this.lagState = lag;
  }

  /** The frozen snapshot, including its single-use lifecycle state. */
  get lag(): XpbdSourceSimplexPairFrictionLagN {
    return this.lagState;
  }

  /** Evaluates from live particle positions without mutating anything. */
  evaluate(): XpbdSourceSimplexPairFrictionEvaluationN {
    return this.evaluateAt((particle) => particle.position.clone());
  }

  /** Evaluates one candidate placement against the frozen lag. */
  evaluateAt(
    positionOf: XpbdParticlePositionQueryN
  ): XpbdSourceSimplexPairFrictionEvaluationN {
    const caller = 'XpbdPreparedSourceSimplexPairFrictionN.evaluateAt';
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    // A consumed lag is single-use by contract, so evaluating one is the misuse
    // the state exists to make visible — not a silently stale force.
    this.assertUsable();
    const dim = this.dimension;
    const lag = this.lagState;
    const barrier = this.source.barrier;
    const countA = barrier.particlesA.length;

    const weightedPoint = (
      particles: readonly XpbdParticleN[], weights: readonly number[]
    ): VecN => {
      const point = new VecN(dim);
      particles.forEach((particle, slot) => {
        const position = positionOf(particle);
        if (!(position instanceof VecN) || position.dim !== dim) {
          throw new Error(`${caller}: position must be R${dim}`);
        }
        for (let axis = 0; axis < dim; axis++) {
          const value = position.data[axis]!;
          if (!Number.isFinite(value)) {
            throw new Error(`${caller}: position must be finite`);
          }
          point.data[axis]! += weights[slot]! * value;
        }
      });
      return point;
    };

    const currentA = weightedPoint(barrier.particlesA, lag.coordinateA.weights);
    const currentB = barrier.particlesB === undefined
      ? lag.basePointB.clone()
      : weightedPoint(barrier.particlesB, lag.coordinateB.weights);

    // Raw relative displacement of the frozen witness pair, then the tangent
    // projection `I - n nᵀ` applied directly — no basis is ever constructed,
    // which is what keeps this dimension-generic.
    const raw = new VecN(dim);
    for (let axis = 0; axis < dim; axis++) {
      raw.data[axis] = (currentA.data[axis]! - currentB.data[axis]!) -
        (lag.basePointA.data[axis]! - lag.basePointB.data[axis]!);
    }
    let along = 0;
    for (let axis = 0; axis < dim; axis++) along += raw.data[axis]! * lag.normal.data[axis]!;
    const slip = new VecN(dim);
    for (let axis = 0; axis < dim; axis++) {
      slip.data[axis] = raw.data[axis]! - along * lag.normal.data[axis]!;
    }
    const slipMagnitude = slip.length();
    const eps = this.source.slipRegularization;
    const forceLimit = this.source.frictionCoefficient * lag.laggedNormalForce;

    // s(y): exact above eps, quadratic below. Below eps the force scale is
    // exactly 1/eps, so the gradient stays linear through zero slip.
    const value = slipMagnitude >= eps
      ? slipMagnitude
      : (slipMagnitude * slipMagnitude) / (2 * eps) + eps / 2;
    const scale = slipMagnitude >= eps
      ? (slipMagnitude > 0 ? forceLimit / slipMagnitude : 0)
      : forceLimit / eps;
    const tangentForce = slip.clone().multiplyScalar(scale);

    const forces: VecN[] = [];
    for (let slot = 0; slot < countA; slot++) {
      forces.push(tangentForce.clone().multiplyScalar(-lag.coordinateA.weights[slot]!));
    }
    if (barrier.particlesB !== undefined) {
      for (let slot = 0; slot < barrier.particlesB.length; slot++) {
        forces.push(tangentForce.clone().multiplyScalar(lag.coordinateB.weights[slot]!));
      }
    }

    const regime: XpbdSourceSimplexPairFrictionRegimeN = slipMagnitude >= eps
      ? 'sliding'
      : slipMagnitude > 0.5 * eps ? 'transition' : 'sticking';

    return Object.freeze({
      lag,
      slip,
      slipMagnitude,
      regime,
      forceLimit,
      tangentForce,
      potentialEnergy: forceLimit * value,
      forces: Object.freeze(forces)
    });
  }

  /**
   * Marks this lag consumed after an accepted, applied step.
   *
   * Called by the world transaction; a caller doing its own orchestration
   * calls it once the step it minimized has actually been applied.
   *
   * @throws If the lag was already consumed — never an implicit refresh.
   */
  markConsumed(): void {
    if (this.lagState.state === 'consumed') {
      throw new Error(
        `XpbdPreparedSourceSimplexPairFrictionN: lag "${this.id}" is already ` +
        'consumed; prepare a new one from the next accepted state'
      );
    }
    this.lagState = Object.freeze({ ...this.lagState, state: 'consumed' });
  }

  /** Restores the prepared state after a refused or failed transaction. */
  rollback(): void {
    this.lagState = Object.freeze({ ...this.lagState, state: 'prepared' });
  }

  /** Refuses to evaluate a consumed lag, by name. */
  assertUsable(): void {
    if (this.lagState.state === 'consumed') {
      throw new Error(
        `XpbdPreparedSourceSimplexPairFrictionN: lag "${this.id}" is consumed; ` +
        'refresh it from the next accepted state before reuse'
      );
    }
  }
}
