import type {
  BarrierComponentN
} from './clamped-log-barrier.js';
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
  /**
   * The resolved regularization length this lag was frozen with, in world
   * length units.
   *
   * Frozen here rather than read per evaluation because a length that moved
   * during the solve would stop the term being a potential: the Armijo search
   * would be minimizing a function whose own shape changed under it. Under an
   * authored length this is that length; under an authored slip velocity it is
   * `velocity * deltaTime`, resolved once at {@link XpbdSourceSimplexPairFrictionN.prepare}.
   */
  readonly regularizationLength: number;
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
   * The scale below which the Coulomb law is regularized.
   *
   * A bare number is a **world length**, exactly as it has always been: not a
   * velocity threshold and not scaled by the timestep. That spelling is
   * unchanged and is never reinterpreted.
   *
   * A fixed length does not survive timestep refinement. Per-step slip is
   * `‖tangential velocity‖ · deltaTime`, so once the slip falls inside the
   * regularized branch the force is `forceLimit · slip / length ∝ deltaTime`,
   * one step's impulse is `∝ deltaTime²`, and a fixed horizon of `T/deltaTime`
   * steps totals `∝ T · deltaTime`. Friction therefore **vanishes** as the
   * timestep shrinks. Measured over an eight-fold refinement, the tangential
   * impulse falls to 0.133 of its coarse value, with the last halving at a
   * ratio of 1.98 against the 2.00 that scaling predicts.
   *
   * `{ kind: 'slip-velocity', velocity }` resolves the length as
   * `velocity · deltaTime` once per {@link XpbdSourceSimplexPairFrictionN.prepare},
   * which cancels the timestep out of `slip / length` exactly. Under the same
   * refinement the impulse holds to 1.06 of its coarse value, last halving
   * 0.99. Author it as the slip speed below which contact should be treated as
   * stuck.
   */
  readonly slipRegularization: XpbdSourceSimplexPairSlipRegularizationN;
}

/**
 * How the regularized-Coulomb scale is authored.
 *
 * The bare number is the legacy spelling and means a world length. The two
 * discriminated forms are additive: the numeric form is never reinterpreted as
 * a velocity, because the two carry different units and a scene authored
 * against one would be silently rescaled by the other.
 */
export type XpbdSourceSimplexPairSlipRegularizationN =
  | number
  | {
    readonly kind: 'slip-length';
    /** World length below which the law is regularized. */
    readonly length: number;
  }
  | {
    readonly kind: 'slip-velocity';
    /**
     * Slip speed below which contact is treated as stuck, in length/time.
     *
     * Resolved to a length as `velocity * deltaTime` at `prepare`, so the
     * regularized branch covers the same *speed* range at every timestep
     * rather than the same distance.
     */
    readonly velocity: number;
  };

/** Conservative-for-one-lag friction evidence at one candidate placement. */
export interface XpbdSourceSimplexPairFrictionEvaluationN
  extends XpbdConservativeForceProviderEvaluationN {
  /** The frozen snapshot this evaluation was taken against. */
  readonly lag: XpbdSourceSimplexPairFrictionLagN;
  /** Tangential slip relative to the lag base. */
  readonly slip: VecN;
  /** `‖slip‖`. */
  readonly slipMagnitude: number;
  /**
   * Which side of the regularization the slip falls on.
   *
   * This is a statement about **slip only**, and says nothing about whether
   * the term can exert any force at all. A term whose lag carries no normal
   * force still reports a regime, because it still has a slip. Read
   * {@link contactActive} for that, and never infer one axis from the other:
   * in the sheet probe 144 of 192 evaluations read `'sliding'` while exerting
   * exactly zero force.
   */
  readonly regime: XpbdSourceSimplexPairFrictionRegimeN;
  /**
   * Whether the frozen lag can exert any tangential force.
   *
   * Exactly `forceLimit > 0`, and orthogonal to {@link regime}: activity is
   * decided by `frictionCoefficient * laggedNormalForce`, regime by the slip. A
   * term that is not active contributes exactly zero force and zero potential
   * energy whatever its slip says, so a population statistic that does not
   * separate the two is reporting mostly about terms that are not touching
   * anything.
   *
   * It describes **this term**, not the contact. At `frictionCoefficient: 0` the
   * paired barrier can be pressing hard and the lag can carry a large
   * `laggedNormalForce` while this reads `false`, because the product is zero.
   * So it is neither a non-penetration nor a retention certificate; read the
   * barrier's own distance for the contact itself.
   */
  readonly contactActive: boolean;
  /** `frictionCoefficient * laggedNormalForce`; the force may not exceed it. */
  readonly forceLimit: number;
  /** The common tangential force; side A receives `-g`, side B `+g`. */
  readonly tangentForce: VecN;
  /** One force per provider particle: side A slots first, then side B's. */
  readonly forces: readonly VecN[];
}

/** The authored regularization scale after the numeric form is normalized. */
export type XpbdSourceSimplexPairResolvedSlipRegularizationN =
  | { readonly kind: 'slip-length'; readonly length: number }
  | { readonly kind: 'slip-velocity'; readonly velocity: number };

/** Options for {@link XpbdSourceSimplexPairFrictionN.prepare}. */
export interface XpbdSourceSimplexPairFrictionPrepareNOptions {
  /**
   * The timestep this lag will be minimized against.
   *
   * Required when the term authors `slipRegularization` as a slip velocity,
   * and refused otherwise: supplying it under an authored length would suggest
   * the length responds to the timestep, which is exactly the belief this
   * distinction exists to prevent.
   */
  readonly deltaTime: number;
}

/**
 * Turns either authored spelling into the discriminated form.
 *
 * The numeric spelling keeps its exact value and becomes a length, so nothing
 * an existing scene authored changes by a single bit.
 */
export function normalizeXpbdSourceSimplexPairSlipRegularizationN(
  authored: XpbdSourceSimplexPairSlipRegularizationN,
  caller: string
): XpbdSourceSimplexPairResolvedSlipRegularizationN {
  if (typeof authored === 'number') {
    if (!Number.isFinite(authored) || authored <= 0) {
      throw new Error(`${caller}: slipRegularization must be finite and positive`);
    }
    return { kind: 'slip-length', length: authored };
  }
  if (typeof authored !== 'object' || authored === null) {
    throw new Error(
      `${caller}: slipRegularization must be a positive number or a ` +
      "{ kind: 'slip-length' | 'slip-velocity' } object"
    );
  }
  const kind: unknown = authored.kind;
  if (kind === 'slip-length') {
    const length = (authored as { readonly length: number }).length;
    if (!Number.isFinite(length) || length <= 0) {
      throw new Error(
        `${caller}: slipRegularization.length must be finite and positive`
      );
    }
    return { kind: 'slip-length', length };
  }
  if (kind === 'slip-velocity') {
    const velocity = (authored as { readonly velocity: number }).velocity;
    if (!Number.isFinite(velocity) || velocity <= 0) {
      throw new Error(
        `${caller}: slipRegularization.velocity must be finite and positive`
      );
    }
    return { kind: 'slip-velocity', velocity };
  }
  throw new Error(
    `${caller}: slipRegularization.kind must be 'slip-length' or ` +
    `'slip-velocity', received ${JSON.stringify(kind)}`
  );
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
  /**
   * The authored regularization scale, normalized to its discriminated form.
   *
   * A numeric option is normalized to `{ kind: 'slip-length' }`; the number
   * itself is preserved exactly, so a legacy scene resolves to the identical
   * length it always did.
   */
  readonly slipRegularization: XpbdSourceSimplexPairResolvedSlipRegularizationN;

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
    this.slipRegularization = normalizeXpbdSourceSimplexPairSlipRegularizationN(
      options.slipRegularization,
      CALLER
    );
    this.id = options.id;
    this.dimension = options.barrier.dimension;
    this.barrier = options.barrier;
    this.frictionCoefficient = options.frictionCoefficient;
  }

  /**
   * Resolves the authored scale to the length this lag will be frozen with.
   *
   * The timestep is required under a slip velocity and refused under a slip
   * length. Refusing it in the second case is deliberate: accepting and
   * ignoring it would leave an author believing their length tracked the
   * timestep, which is the belief that makes friction silently vanish under
   * refinement.
   */
  private resolveRegularizationLength(
    options: XpbdSourceSimplexPairFrictionPrepareNOptions | undefined,
    caller: string
  ): number {
    if (options !== undefined &&
      (typeof options !== 'object' || options === null)) {
      throw new Error(`${caller}: options must be an object`);
    }
    if (this.slipRegularization.kind === 'slip-length') {
      if (options?.deltaTime !== undefined) {
        throw new Error(
          `${caller}: deltaTime is meaningless for an authored slip length, ` +
          'which does not scale with the timestep; author ' +
          "slipRegularization as { kind: 'slip-velocity', velocity } to " +
          'resolve the length from the timestep'
        );
      }
      return this.slipRegularization.length;
    }
    const deltaTime = options?.deltaTime;
    if (deltaTime === undefined) {
      throw new Error(
        `${caller}: deltaTime is required when slipRegularization is ` +
        "authored as { kind: 'slip-velocity' }, because the regularization " +
        'length is velocity * deltaTime and must be frozen with the lag'
      );
    }
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      throw new Error(`${caller}: deltaTime must be finite and positive`);
    }
    return this.slipRegularization.velocity * deltaTime;
  }

  /**
   * Freezes one lag at the current (accepted) state and returns the immutable
   * provider that may be minimized against exactly once.
   *
   * @param options carries the timestep this lag will be minimized against,
   * required exactly when `slipRegularization` is authored as a slip velocity
   * and refused when it is authored as a length.
   * @throws {XpbdPotentialDomainErrorN} when the contact cannot justify a
   * friction term: tied witnesses, certified zero distance, an uncertified
   * comparison, a sub-minimum distance, or a retired source.
   */
  prepare(
    options?: XpbdSourceSimplexPairFrictionPrepareNOptions
  ): XpbdPreparedSourceSimplexPairFrictionN {
    return this.prepareAt((particle) => particle.position.clone(), options);
  }

  /** Freezes one lag at an explicit accepted base placement. */
  prepareAt(
    positionOf: XpbdParticlePositionQueryN,
    options?: XpbdSourceSimplexPairFrictionPrepareNOptions
  ): XpbdPreparedSourceSimplexPairFrictionN {
    const caller = `${CALLER}.prepareAt`;
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    const regularizationLength = this.resolveRegularizationLength(
      options,
      caller
    );
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
    // E' alone. A published pair-barrier evaluation carries an available
    // first derivative by that provider's contract; a miss here is a lost
    // internal invariant, not a caller-reachable state.
    const firstDerivative: BarrierComponentN =
      barrierEvaluation.barrier.firstDerivative;
    if (!firstDerivative.available) {
      throw new Error(`${caller}: internal invariant lost — a published ` +
        'pair-barrier evaluation carries an available first derivative');
    }
    const laggedNormalForce = Math.abs(firstDerivative.value);

    const lag: XpbdSourceSimplexPairFrictionLagN = Object.freeze({
      dimension: this.dimension,
      coordinateA: pair.witness.coordinateA,
      coordinateB: pair.witness.coordinateB,
      normal: pair.direction.clone(),
      basePointA: pair.witness.pointA.clone(),
      basePointB: pair.witness.pointB.clone(),
      baseDistance: pair.distance,
      laggedNormalForce,
      regularizationLength,
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
    // Read from the LAG, not from the source: the length was resolved once at
    // prepare and must not move while this lag is being minimized against.
    const eps = lag.regularizationLength;
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
      contactActive: forceLimit > 0,
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
