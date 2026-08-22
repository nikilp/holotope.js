import {
  VecN,
  inspectSourceSimplexReferenceN,
  type SourceSimplexReferenceN
} from '@holotope/core';
import { evaluateClampedLogBarrierAtOrderN } from './clamped-log-barrier.js';
import {
  evaluateExactPointSimplexResult,
  type PointSimplexPublicationReason,
  type PointSimplexResult
} from './exact-point-simplex-distance.js';
import {
  type XpbdIncrementalPotentialStepFilterContextN,
  type XpbdIncrementalPotentialStepFilterEvaluationN,
  type XpbdIncrementalPotentialStepFilterN
} from './xpbd-incremental-potential-step-filter.js';
import { XpbdParticleBindingN } from './xpbd-particle-binding.js';
import { XpbdPotentialDomainErrorN } from './xpbd-potential-domain.js';
import { evaluateSimplexSquaredMeasureN } from './xpbd-simplex-measure.js';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderEvaluationN,
  type XpbdConservativeForceProviderN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

/**
 * Publication failures of the exact point--simplex query, forwarded one to one.
 *
 * Flattening them would lose the distinction the query already draws: a weight
 * that underflowed, a value that overflowed, a value that underflowed, and an
 * accuracy bound that overflowed are four different representation failures
 * with four different repairs. None of them classifies recoverability — see
 * the note on the union below.
 */
export type XpbdSourceSimplexMeasureBarrierPublicationReasonN =
  | 'point-simplex-weight-underflow'
  | 'point-simplex-value-overflow'
  | 'point-simplex-value-underflow'
  | 'point-simplex-accuracy-bound-overflow';

/**
 * Open-domain refusal vocabulary of the measure-weighted normal-contact law.
 *
 * Every reason here is a statement about ONE quadrature node at ONE candidate
 * placement, except `accumulated-value-outside-float64`, which is a statement
 * about the reduction of all of them. The law refuses as a whole: a single
 * node that cannot be evaluated leaves the sum undefined, so there is no
 * partial energy to publish and none is published.
 *
 * A reason does NOT classify recoverability. Whether a shorter step clears the
 * refusal is a property of the iterate the search is standing on, not of the
 * name: if the offending node's query publishes at the start of the segment,
 * the failure arrived somewhere along it and contraction can retreat out of
 * it; if it does not publish there, every contracted trial converges back onto
 * the placement that already fails.
 */
export type XpbdSourceSimplexMeasureBarrierDomainReasonN =
  | 'at-or-below-minimum-distance'
  | 'minimum-distance-not-certified'
  | 'zero-or-intersecting'
  | 'obstacle-rank-deficient'
  | XpbdSourceSimplexMeasureBarrierPublicationReasonN
  | 'direction-error-exceeds-policy'
  | 'barrier-component-outside-float64'
  | 'accumulated-value-outside-float64';

const PUBLICATION_REASON: Readonly<Record<
  PointSimplexPublicationReason,
  XpbdSourceSimplexMeasureBarrierPublicationReasonN
>> = Object.freeze({
  'weight-underflow': 'point-simplex-weight-underflow',
  'value-overflow': 'point-simplex-value-overflow',
  'value-underflow': 'point-simplex-value-underflow',
  'accuracy-bound-overflow': 'point-simplex-accuracy-bound-overflow'
});

/**
 * Authored inputs for one measure-weighted normal-contact term.
 *
 * There is no `dimension`: the ambient dimension is read off the source
 * complexes and the binding, which already agree or the construction fails.
 * There is no quadrature control either — see `compileXpbdSourceSimplexMeasure\
 * BarrierN` for why the rule is fixed.
 */
export interface CompileXpbdSourceSimplexMeasureBarrierNOptions {
  /** Stable term identity; also the `lawId` of every domain refusal it raises. */
  readonly id: string;
  /** Authoritative source-vertex to particle mapping for the deforming cell. */
  readonly binding: XpbdParticleBindingN;
  /** The deforming source simplex, whose measure weights the energy. */
  readonly cell: SourceSimplexReferenceN;
  /** The opposing source simplex; refused by name when retired. */
  readonly obstacle: SourceSimplexReferenceN;
  /**
   * Binding for a MOVING obstacle. Every particle it contributes must be
   * kinematic (`inverseMass === 0`); omit it for a static obstacle read from
   * the source complex.
   */
  readonly obstacleBinding?: XpbdParticleBindingN;
  /** Distance at and above which every node's energy is exactly zero. */
  readonly activationDistance: number;
  /** Positive energy scale, per unit of reference measure. */
  readonly stiffness: number;
  /**
   * Largest published direction-enclosure radius this term will act on. There
   * is no default: the exact query publishes an enclosure, and no universal
   * value exists, so the policy is authored or the construction fails.
   */
  readonly maximumDirectionError: number;
  /** Open unsigned distance boundary shared by every node. Default zero. */
  readonly minimumDistance?: number;
  /** Fraction of the certified prefix the filter retains. Default `0.9`. */
  readonly conservativeScale?: number;
}

/** The compiled term: one conservative provider and one paired step filter. */
export interface XpbdSourceSimplexMeasureBarrierTermsN {
  /** Register with `world.addForceProvider` or a compiled potential problem. */
  readonly provider: XpbdConservativeForceProviderN;
  /** Register alongside it; the two are only sound together. */
  readonly stepFilter: XpbdIncrementalPotentialStepFilterN;
}

/** Two unit vectors are at most 2 apart, so a larger bound certifies nothing. */
const MAXIMUM_MEANINGFUL_DIRECTION_ERROR = 2;

/** Cell dimensions the exact point--simplex query supports on both sides. */
const SUPPORTED_CELL_DIMENSIONS: readonly number[] = Object.freeze([1, 2, 3]);

/** One node of the fixed rule, as the coefficients the forces also use. */
interface QuadratureNodeN {
  /** Vertex slot this node leans toward; the anchor of its affine form. */
  readonly ownSlot: number;
  /** `d p / d q_v`, in vertex-slot order. Shared by position and gradient. */
  readonly coefficients: readonly number[];
  /** Rule weight; equal across nodes. */
  readonly weight: number;
}

/**
 * The fixed rule: the barycentric orbit of `(alpha, beta, ..., beta)`.
 *
 * With `beta = (1 - 2/(k+2)) / k` and the own coefficient `1 - k*beta`, the
 * `k + 1` nodes are distinct, strictly interior, equally weighted, and their
 * average is the centroid — so the rule integrates affine functions over the
 * cell exactly. That is the only exactness claimed. The integrand here is a
 * barrier composed with a piecewise-smooth distance, which is neither affine
 * nor globally smooth, so THIS IS A REFERENCE MEASURE, not a quadrature with a
 * truncation bound. Refining it is not offered because a refined rule would
 * change the law, not approximate it better: the energy IS the weighted node
 * sum, and every force published is the exact gradient of that sum.
 *
 * Each node is evaluated as `q_own + beta * sum_{v != own} (q_v - q_own)`. The
 * anchored form is used rather than a raw weighted sum because it is an affine
 * combination by construction — the coefficients sum to one exactly, whatever
 * the base-2 representation of `beta` does, and `1/5` is not a Float64. Every
 * node uses the same formula relative to its own vertex, so the node set is
 * symmetric under relabelling the cell's vertices.
 */
function fixedRule(cellDimension: number): readonly QuadratureNodeN[] {
  const slots = cellDimension + 1;
  const beta = (1 - 2 / (cellDimension + 2)) / cellDimension;
  const own = 1 - cellDimension * beta;
  if (!(beta > 0) || !(own > 0)) {
    // Unreachable for the supported dimensions; an invariant, not a guard on
    // caller input, because no caller supplies a rule.
    throw new Error(
      'compileXpbdSourceSimplexMeasureBarrierN: the fixed rule left the open ' +
      `simplex at dimension ${cellDimension}`
    );
  }
  const weight = 1 / slots;
  return Object.freeze(Array.from({ length: slots }, (_, ownSlot) =>
    Object.freeze({
      ownSlot,
      coefficients: Object.freeze(Array.from(
        { length: slots }, (__, slot) => slot === ownSlot ? own : beta
      )),
      weight
    })
  ));
}

/**
 * The one place a candidate's contributions are written.
 *
 * Node contributions are accumulated here and reduced exactly once, in node
 * order and then slot order, so the published numbers do not depend on the
 * order the nodes happened to be visited in or on any intermediate object's
 * key order. Nothing outside this module can observe it: the ledger is the
 * mechanism, and the published evaluation is the whole result.
 */
class ContributionLedgerN {
  /** Per-node barrier energy, before the reference-measure scale. */
  private readonly energies: Float64Array;
  /** `dE/dq` divided by the reference measure, packed particle-major. */
  private readonly gradient: Float64Array;

  constructor(
    private readonly nodeCount: number,
    private readonly particleCount: number,
    private readonly dimension: number
  ) {
    this.energies = new Float64Array(nodeCount);
    this.gradient = new Float64Array(particleCount * dimension);
  }

  recordEnergy(node: number, weightedEnergy: number): void {
    this.energies[node] = weightedEnergy;
  }

  /** Adds `scale * direction` to one particle's gradient share. */
  accumulate(particle: number, scale: number, direction: readonly number[]): void {
    const base = particle * this.dimension;
    for (let axis = 0; axis < this.dimension; axis++) {
      this.gradient[base + axis]! += scale * direction[axis]!;
    }
  }

  /** The single ordered reduction. `forces = -measure * gradient`. */
  reduce(referenceMeasure: number): {
    readonly potentialEnergy: number;
    readonly forces: readonly VecN[];
  } {
    let summed = 0;
    for (let node = 0; node < this.nodeCount; node++) {
      summed += this.energies[node]!;
    }
    const potentialEnergy = referenceMeasure * summed;
    const forces: VecN[] = [];
    for (let particle = 0; particle < this.particleCount; particle++) {
      const force = new VecN(this.dimension);
      const base = particle * this.dimension;
      for (let axis = 0; axis < this.dimension; axis++) {
        force.data[axis] = -referenceMeasure * this.gradient[base + axis]!;
      }
      forces.push(force);
    }
    return { potentialEnergy, forces };
  }
}

/** Greatest non-negative Float64 strictly below a positive finite input. */
function nextDownNonnegative(value: number): number {
  if (!(value > 0)) return 0;
  if (!Number.isFinite(value)) return Number.MAX_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) - 1n);
  return view.getFloat64(0);
}

/** Certified lower bound on a published positive point--simplex distance. */
function certifiedDistanceLowerBound(
  witnessSquaredDistance: number,
  squaredDistanceErrorBound: number
): number {
  const lowerSquared = nextDownNonnegative(
    witnessSquaredDistance - squaredDistanceErrorBound
  );
  if (!(lowerSquared > 0)) return 0;
  return nextDownNonnegative(Math.sqrt(lowerSquared));
}

/**
 * `E(q) = mu0 * sum_j w_j * psi(d_j(q) - dmin)`.
 *
 * `mu0` is the cell's reference k-measure, frozen at construction; `w_j` and
 * the node coefficients are the fixed rule; `d_j` is the exact distance from
 * node `j` to the obstacle simplex; `psi` is the clamped logarithmic barrier
 * at order 1. Every force published is the exact gradient of that expression:
 *
 * ```text
 * F_v = -mu0 * sum_j w_j * psi'(d_j - dmin) * c_j[v] * dir_j
 * ```
 *
 * with `c_j` the same coefficients that place the node and `dir_j` the query's
 * published unit direction. The obstacle's vertices carry the reaction with
 * `-a_j[u]` in place of `c_j[v]`, `a_j` being the witness weights on the
 * obstacle; they are kinematic by construction, so the reaction is reported
 * rather than integrated, and the term stays a closed statement about the
 * energy instead of a one-sided force.
 *
 * Weighting by the cell's REFERENCE measure rather than its current one is
 * what makes the term conservative. A current-measure weight would make the
 * energy depend on the cell's own deformation through a second path, and its
 * gradient would then carry a measure-gradient term this law does not publish;
 * the reference weight is a constant, so the chain rule above is complete.
 *
 * A degenerate cell is therefore not this term's problem at candidate time: a
 * node is a fixed affine combination of the cell's vertices whether or not
 * they span anything, and the query it feeds is point-versus-obstacle. Only
 * the REST cell must be non-degenerate, and that is settled once, at
 * construction, as a configuration error.
 */
class SourceSimplexMeasureBarrierProviderN
implements XpbdConservativeForceProviderN {
  readonly particles: readonly XpbdParticleN[];

  constructor(
    readonly id: string,
    readonly dimension: number,
    readonly cellParticles: readonly XpbdParticleN[],
    readonly obstacleParticles: readonly XpbdParticleN[] | undefined,
    private readonly staticObstacle: Float64Array | undefined,
    private readonly rule: readonly QuadratureNodeN[],
    private readonly referenceMeasure: number,
    readonly minimumDistance: number,
    private readonly activationDistance: number,
    private readonly stiffness: number,
    private readonly maximumDirectionError: number
  ) {
    this.particles = Object.freeze([
      ...cellParticles, ...(obstacleParticles ?? [])
    ]);
  }

  /** Evaluates from the particles' current live positions without mutation. */
  evaluate(): XpbdConservativeForceProviderEvaluationN {
    return this.evaluateAt((particle) => particle.position.clone());
  }

  evaluateAt(
    positionOf: XpbdParticlePositionQueryN
  ): XpbdConservativeForceProviderEvaluationN {
    const caller = 'XpbdSourceSimplexMeasureBarrierN.evaluateAt';
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    const cell = this.packSide(this.cellParticles, positionOf, caller, 'cell');
    const obstacle = this.packObstacle(positionOf, caller);
    const ledger = new ContributionLedgerN(
      this.rule.length, this.particles.length, this.dimension
    );
    const barrierActivation = this.activationDistance - this.minimumDistance;
    for (let node = 0; node < this.rule.length; node++) {
      const rule = this.rule[node]!;
      const point = this.nodePosition(cell, rule);
      const result = evaluateExactPointSimplexResult(
        point, obstacle, this.dimension
      );
      const projected = this.requireProjection(result, node, caller);
      const distance = projected.witness.distance;
      if (!Number.isFinite(distance)) {
        throw new Error(`${caller}: node ${node} distance is outside Float64`);
      }
      if (!(distance > this.minimumDistance)) {
        throw this.refuse('at-or-below-minimum-distance',
          `${caller}: node ${node} distance must be greater than minimumDistance`);
      }
      if (!(certifiedDistanceLowerBound(
        projected.witness.squaredDistance,
        projected.error.squaredDistanceErrorBound
      ) > this.minimumDistance)) {
        throw this.refuse('minimum-distance-not-certified',
          `${caller}: node ${node}'s distance error bound reaches minimumDistance`);
      }
      if (projected.error.directionErrorBound > this.maximumDirectionError) {
        throw this.refuse('direction-error-exceeds-policy',
          `${caller}: node ${node} published direction error ` +
          `${projected.error.directionErrorBound} exceeds the authored ` +
          `maximumDirectionError ${this.maximumDirectionError}`);
      }
      // Order 1 and only order 1: this term publishes an energy and forces,
      // never a curvature it would not use.
      const barrier = evaluateClampedLogBarrierAtOrderN({
        coordinate: distance - this.minimumDistance,
        activation: barrierActivation,
        stiffness: this.stiffness
      }, 1);
      if (!barrier.energy.available || !barrier.firstDerivative.available) {
        throw this.refuse('barrier-component-outside-float64',
          `${caller}: a required barrier component is outside Float64 at ` +
          `node ${node}`);
      }
      const direction = projected.witness.direction;
      const share = rule.weight * barrier.firstDerivative.value;
      ledger.recordEnergy(node, rule.weight * barrier.energy.value);
      for (let slot = 0; slot < this.cellParticles.length; slot++) {
        ledger.accumulate(slot, share * rule.coefficients[slot]!, direction);
      }
      if (this.obstacleParticles !== undefined) {
        const offset = this.cellParticles.length;
        for (let slot = 0; slot < this.obstacleParticles.length; slot++) {
          ledger.accumulate(
            offset + slot, -share * projected.witness.weights[slot]!, direction
          );
        }
      }
    }
    const reduced = ledger.reduce(this.referenceMeasure);
    if (!Number.isFinite(reduced.potentialEnergy) ||
      reduced.forces.some((force) =>
        force.data.some((value) => !Number.isFinite(value)))) {
      throw this.refuse('accumulated-value-outside-float64',
        `${caller}: the measure-weighted sum left Float64 at this candidate`);
    }
    return Object.freeze({
      potentialEnergy: reduced.potentialEnergy,
      forces: Object.freeze(reduced.forces)
    });
  }

  /**
   * The smallest CERTIFIED node margin over the open boundary at a placement,
   * or the reason no such number exists. Shared with the paired filter, so the
   * filter certifies against the same geometry the energy refuses on.
   */
  startMarginAt(
    positionOf: XpbdParticlePositionQueryN,
    caller: string
  ): { readonly margin: number } | { readonly reason: FilterRefusalReasonN } {
    const cell = this.packSide(this.cellParticles, positionOf, caller, 'cell');
    const obstacle = this.packObstacle(positionOf, caller);
    let smallest = Number.POSITIVE_INFINITY;
    for (const rule of this.rule) {
      const result = evaluateExactPointSimplexResult(
        this.nodePosition(cell, rule), obstacle, this.dimension
      );
      if (result.status === 'uncertified' || result.status === 'rank-deficient') {
        return { reason: 'initial-uncertified-distance' };
      }
      if (result.status === 'zero') return { reason: 'initial-domain-violation' };
      smallest = Math.min(smallest, certifiedDistanceLowerBound(
        result.witness.squaredDistance, result.error.squaredDistanceErrorBound
      ));
    }
    const margin = smallest - this.minimumDistance;
    if (!(margin > 0)) return { reason: 'initial-domain-violation' };
    return { margin };
  }

  private requireProjection(
    result: PointSimplexResult, node: number, caller: string
  ): Extract<PointSimplexResult, { status: 'projected' }> {
    if (result.status === 'rank-deficient') {
      // Reachable only with a bound obstacle: a static one is packed once and
      // its rank settled at construction, as a configuration error.
      throw this.refuse('obstacle-rank-deficient',
        `${caller}: the obstacle simplex is exactly rank-deficient ` +
        `(rank ${result.exactRank}) at this candidate`);
    }
    if (result.status === 'uncertified') {
      throw this.refuse(PUBLICATION_REASON[result.reason],
        `${caller}: node ${node}'s exact point--simplex decision could not be ` +
        `published (${result.reason}: ${result.detail})`);
    }
    if (result.status === 'zero') {
      throw this.refuse('zero-or-intersecting',
        `${caller}: node ${node} is at certified zero distance from the ` +
        'obstacle; no direction exists');
    }
    return result;
  }

  private refuse(
    reason: XpbdSourceSimplexMeasureBarrierDomainReasonN, message: string
  ): XpbdPotentialDomainErrorN<XpbdSourceSimplexMeasureBarrierDomainReasonN> {
    return new XpbdPotentialDomainErrorN<
      XpbdSourceSimplexMeasureBarrierDomainReasonN
    >(this.id, reason, message);
  }

  /** `q_own + beta * sum_{v != own} (q_v - q_own)`, an affine combination. */
  private nodePosition(
    cell: Float64Array, rule: QuadratureNodeN
  ): Float64Array {
    const point = new Float64Array(this.dimension);
    const anchor = rule.ownSlot * this.dimension;
    for (let axis = 0; axis < this.dimension; axis++) {
      let value = cell[anchor + axis]!;
      for (let slot = 0; slot < rule.coefficients.length; slot++) {
        if (slot === rule.ownSlot) continue;
        value += rule.coefficients[slot]! *
          (cell[slot * this.dimension + axis]! - cell[anchor + axis]!);
      }
      point[axis] = value;
    }
    return point;
  }

  private packObstacle(
    positionOf: XpbdParticlePositionQueryN, caller: string
  ): Float64Array {
    if (this.staticObstacle !== undefined) return this.staticObstacle;
    return this.packSide(
      this.obstacleParticles!, positionOf, caller, 'obstacle'
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
        throw new Error(
          `${caller}: ${label}[${slot}] position must be R${this.dimension}`
        );
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

/** The two ways the paired filter declines to certify a segment at all. */
type FilterRefusalReasonN =
  | 'initial-domain-violation'
  | 'initial-uncertified-distance';

/**
 * Start-only conservative step filter for one measure-weighted contact term.
 *
 * The proof is a two-sided Lipschitz bound taken entirely from the SEGMENT
 * START. Each quadrature node is a convex combination of the cell's vertices,
 * so moving every cell vertex by at most `dc` moves every node by at most
 * `dc`; the obstacle simplex moves by at most `do` in Hausdorff distance; and
 * the point--simplex distance is 1-Lipschitz in each argument. Along the
 * linear segment, for every node,
 *
 * ```text
 * d_j(t) >= d_j(0) - t * (dc + do).
 * ```
 *
 * The filter therefore reads the endpoints only to measure `dc` and `do`, and
 * reads GEOMETRY only at `t = 0`. That is deliberate and it is the whole
 * safety argument: a filter that also queried the endpoint could certify a
 * segment whose two ends are clear and whose interior is not, because the
 * closest feature changes in between and the distance along the segment is not
 * monotone. The bound above has no such gap — it is a lower envelope over the
 * entire segment, from one placement.
 *
 * `startMargin` is the SMALLEST certified node margin, not an average: the
 * energy refuses if any single node reaches the open boundary, so the segment
 * a filter may certify is governed by the worst node.
 *
 * The certified prefix is a fraction, never a collision time. This filter does
 * not solve the piecewise closest-feature crossing and does not claim to.
 */
class SourceSimplexMeasureBarrierStepFilterN
implements XpbdIncrementalPotentialStepFilterN {
  readonly id: string;
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];

  constructor(
    id: string,
    private readonly provider: SourceSimplexMeasureBarrierProviderN,
    private readonly conservativeScale: number
  ) {
    this.id = id;
    this.dimension = provider.dimension;
    this.particles = provider.particles;
  }

  evaluate(
    context: XpbdIncrementalPotentialStepFilterContextN
  ): XpbdIncrementalPotentialStepFilterEvaluationN {
    const caller = 'XpbdSourceSimplexMeasureBarrierStepFilterN.evaluate';
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

    const start = this.provider.startMarginAt(
      (particle) => context.positionBefore(particle), caller
    );
    if ('reason' in start) {
      return Object.freeze({ status: 'indeterminate', reason: start.reason });
    }
    const displacement = (
      particles: readonly XpbdParticleN[] | undefined
    ): number => {
      if (particles === undefined) return 0;
      let largest = 0;
      for (const particle of particles) {
        largest = Math.max(largest, context.positionAfter(particle)
          .clone().sub(context.positionBefore(particle)).length());
      }
      return largest;
    };
    const total = displacement(this.provider.cellParticles) +
      displacement(this.provider.obstacleParticles);
    if (total === 0 || total < start.margin) {
      return Object.freeze({
        status: 'safe', maximumStepLength: context.requestedStepLength
      });
    }
    const maximumStepLength = context.requestedStepLength *
      (this.conservativeScale * start.margin / total);
    if (!Number.isFinite(maximumStepLength) || maximumStepLength < 0 ||
      !(maximumStepLength < context.requestedStepLength)) {
      throw new Error(`${caller}: certified prefix is outside Float64`);
    }
    return Object.freeze({ status: 'limited', maximumStepLength });
  }
}

const OPTION_KEYS: readonly string[] = Object.freeze([
  'id', 'binding', 'cell', 'obstacle', 'obstacleBinding', 'activationDistance',
  'stiffness', 'maximumDirectionError', 'minimumDistance', 'conservativeScale'
]);

/**
 * Compiles one measure-weighted normal-contact term for the released world.
 *
 * The energy is the cell's reference k-measure times the fixed-rule average of
 * a clamped logarithmic barrier on each node's exact distance to the obstacle.
 * What that buys over a per-vertex barrier is that the contact resists by AREA
 * rather than by vertex count: refining a mesh multiplies the vertices but not
 * the measure, so the same contact does not silently stiffen as the mesh gets
 * finer.
 *
 * The quadrature is fixed and not authorable. A caller-supplied rule would
 * make the energy a function of the rule, and every stated property here —
 * that the forces are its exact gradient, that the filter's Lipschitz bound
 * covers every node, that the term refuses as a whole — is a property of THIS
 * rule. Offering a knob would offer those guarantees on rules that have not
 * been measured.
 *
 * @example
 * ```ts
 * const binding = compileXpbdParticleBindingN({ id: 'sheet', source: sheet });
 * const { provider, stepFilter } = compileXpbdSourceSimplexMeasureBarrierN({
 *   id: 'contact',
 *   binding,
 *   cell: sourceSimplexReferenceN(sheet, triangles, 0),
 *   obstacle: sourceSimplexReferenceN(floor, floorTriangles, 0),
 *   activationDistance: 0.05,
 *   stiffness: 1,
 *   maximumDirectionError: 1e-6
 * });
 * world.addForceProvider(provider);
 * ```
 *
 * @param options Term identity, geometry, and barrier policy.
 * @returns The provider and the step filter that are only sound together.
 * @throws Error For any authored input outside the declared domain — including
 *   a rest-degenerate cell, a rank-deficient static obstacle, and an obstacle
 *   binding contributing a particle that is not kinematic. These are
 *   configuration errors and no candidate retry can fix them.
 */
export function compileXpbdSourceSimplexMeasureBarrierN(
  options: CompileXpbdSourceSimplexMeasureBarrierNOptions
): XpbdSourceSimplexMeasureBarrierTermsN {
  const caller = 'compileXpbdSourceSimplexMeasureBarrierN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  const unknown = Object.keys(options)
    .filter((key) => !OPTION_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `${caller}: unknown option${unknown.length === 1 ? '' : 's'} ` +
      unknown.sort().map((key) => `"${key}"`).join(', ')
    );
  }
  if (typeof options.id !== 'string' || options.id.trim().length === 0) {
    throw new Error(`${caller}: id must be a non-empty string`);
  }
  if (!(options.binding instanceof XpbdParticleBindingN)) {
    throw new Error(`${caller}: binding must be an XpbdParticleBindingN`);
  }
  for (const [label, reference] of [
    ['cell', options.cell], ['obstacle', options.obstacle]
  ] as const) {
    if (typeof reference !== 'object' || reference === null ||
      reference.kind !== 'source-simplex-reference') {
      throw new Error(`${caller}: ${label} must be a SourceSimplexReferenceN`);
    }
    const status = inspectSourceSimplexReferenceN(reference);
    if (status.kind === 'retired') {
      throw new Error(`${caller}: ${label} is retired (${status.reason})`);
    }
    if (!SUPPORTED_CELL_DIMENSIONS.includes(reference.intrinsicDim)) {
      throw new Error(
        `${caller}: ${label} has intrinsic dimension ` +
        `${reference.intrinsicDim}; the exact point--simplex query supports ` +
        `${SUPPORTED_CELL_DIMENSIONS.join(', ')}`
      );
    }
  }
  if (options.cell.complex !== options.binding.source) {
    throw new Error(`${caller}: cell must belong to the binding's source complex`);
  }
  const dimension = options.cell.complex.ambientDim;
  if (options.obstacle.complex.ambientDim !== dimension) {
    throw new Error(
      `${caller}: cell is in R${dimension}, obstacle is in ` +
      `R${options.obstacle.complex.ambientDim}`
    );
  }
  if (options.obstacle.intrinsicDim > dimension) {
    throw new Error(
      `${caller}: obstacle is a ${options.obstacle.intrinsicDim}-simplex in ` +
      `R${dimension}`
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
  // The direction policy has no default: the exact query publishes an
  // enclosure and no universal radius is right for every scene, so a default
  // would be this module deciding a tolerance on the author's behalf.
  if (options.maximumDirectionError === undefined) {
    throw new Error(
      `${caller}: maximumDirectionError is required (the exact ` +
      'point--simplex query publishes a direction enclosure; author the ' +
      'policy explicitly)'
    );
  }
  if (!Number.isFinite(options.maximumDirectionError) ||
    !(options.maximumDirectionError > 0) ||
    !(options.maximumDirectionError < MAXIMUM_MEANINGFUL_DIRECTION_ERROR)) {
    throw new Error(
      `${caller}: maximumDirectionError must be finite and in the open ` +
      `interval (0, ${MAXIMUM_MEANINGFUL_DIRECTION_ERROR}); two unit vectors ` +
      'are at most 2 apart, so a larger bound certifies nothing'
    );
  }
  const conservativeScale = options.conservativeScale ?? 0.9;
  if (!Number.isFinite(conservativeScale) || !(conservativeScale > 0) ||
    !(conservativeScale <= 1)) {
    throw new Error(
      `${caller}: conservativeScale must be finite and in the half-open ` +
      'interval (0, 1]'
    );
  }

  const cellParticles = Object.freeze(options.cell.vertexIndices.map(
    (vertexIndex) => options.binding.particleForSourceVertex(vertexIndex)
  ));
  for (const particle of cellParticles) {
    if (particle.dimension !== dimension) {
      throw new Error(
        `${caller}: a cell particle is R${particle.dimension}, the cell is in ` +
        `R${dimension}`
      );
    }
  }

  // The reference measure is read from the binding's validated snapshot of the
  // source, never from live particle state: it is the constant that makes the
  // published gradient the complete gradient, so it must not depend on where
  // the solver happens to be standing when the term is compiled.
  const restPositions = options.cell.vertexIndices.map((vertexIndex) =>
    options.binding.vertices[vertexIndex]!.sourcePosition.clone());
  const referenceMeasure = evaluateSimplexSquaredMeasureN(restPositions).measure;
  if (!Number.isFinite(referenceMeasure) || !(referenceMeasure > 0)) {
    throw new Error(
      `${caller}: the cell's reference measure is ${referenceMeasure}; a ` +
      'rest-degenerate cell has no measure to weight its contact by'
    );
  }

  let obstacleParticles: readonly XpbdParticleN[] | undefined;
  let staticObstacle: Float64Array | undefined;
  if (options.obstacleBinding !== undefined) {
    if (!(options.obstacleBinding instanceof XpbdParticleBindingN)) {
      throw new Error(
        `${caller}: obstacleBinding must be an XpbdParticleBindingN`
      );
    }
    if (options.obstacle.complex !== options.obstacleBinding.source) {
      throw new Error(
        `${caller}: obstacle must belong to obstacleBinding's source complex`
      );
    }
    obstacleParticles = Object.freeze(options.obstacle.vertexIndices.map(
      (vertexIndex) =>
        options.obstacleBinding!.particleForSourceVertex(vertexIndex)
    ));
    // A bound obstacle must be kinematic. The energy weights the CELL's
    // reference measure alone, so the law is deliberately one-sided; letting
    // the obstacle respond to it would integrate a force derived from a
    // measure that is not the obstacle's, which is not a contact law anyone
    // authored. Reporting the reaction is honest, applying it would not be.
    options.obstacle.vertexIndices.forEach((_, slot) => {
      const particle = obstacleParticles![slot]!;
      if (particle.inverseMass !== 0) {
        throw new Error(
          `${caller}: obstacle particle ${slot} has inverseMass ` +
          `${particle.inverseMass}; a bound obstacle must be kinematic ` +
          '(inverseMass 0) because this law weights only the cell'
        );
      }
      if (particle.dimension !== dimension) {
        throw new Error(
          `${caller}: obstacle particle ${slot} is R${particle.dimension}, ` +
          `the obstacle is in R${dimension}`
        );
      }
    });
  } else {
    staticObstacle = new Float64Array(
      options.obstacle.vertexIndices.length * dimension
    );
    options.obstacle.vertexIndices.forEach((vertexIndex, slot) => {
      for (let axis = 0; axis < dimension; axis++) {
        const value =
          options.obstacle.complex.positions[vertexIndex * dimension + axis]!;
        if (!Number.isFinite(value)) {
          throw new Error(
            `${caller}: obstacle vertex ${slot} has a non-finite coordinate`
          );
        }
        staticObstacle![slot * dimension + axis] = value;
      }
    });
    // Settle the static obstacle's rank ONCE, here, as a configuration error.
    // The query decides rank before it publishes anything, so any probe point
    // exposes it; the obstacle's own first vertex is the cheapest and is
    // deterministic. Every other status proves the rank is full.
    const probe = evaluateExactPointSimplexResult(
      staticObstacle.subarray(0, dimension), staticObstacle, dimension
    );
    if (probe.status === 'rank-deficient') {
      throw new Error(
        `${caller}: the static obstacle simplex is exactly rank-deficient ` +
        `(rank ${probe.exactRank})`
      );
    }
  }

  const provider = new SourceSimplexMeasureBarrierProviderN(
    options.id, dimension, cellParticles, obstacleParticles,
    staticObstacle, fixedRule(options.cell.intrinsicDim), referenceMeasure,
    minimumDistance, options.activationDistance, options.stiffness,
    options.maximumDirectionError
  );
  return Object.freeze({
    provider,
    stepFilter: new SourceSimplexMeasureBarrierStepFilterN(
      `${options.id}-filter`, provider, conservativeScale
    )
  });
}
