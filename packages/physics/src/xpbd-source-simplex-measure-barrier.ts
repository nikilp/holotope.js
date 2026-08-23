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
  /** Coefficient count, carried so nothing has to measure the array. */
  readonly slots: number;
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
  const nodes = new Array<QuadratureNodeN>(slots);
  for (let ownSlot = 0; ownSlot < slots; ownSlot++) {
    const coefficients = new Array<number>(slots);
    for (let slot = 0; slot < slots; slot++) {
      coefficients[slot] = slot === ownSlot ? own : beta;
    }
    nodes[ownSlot] = Object.freeze({
      ownSlot, coefficients: Object.freeze(coefficients), slots, weight
    });
  }
  return Object.freeze(nodes);
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
    const forces = new Array<VecN>(this.particleCount);
    for (let particle = 0; particle < this.particleCount; particle++) {
      const force = new VecN(this.dimension);
      const base = particle * this.dimension;
      for (let axis = 0; axis < this.dimension; axis++) {
        force.data[axis] = -referenceMeasure * this.gradient[base + axis]!;
      }
      forces[particle] = force;
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

/** The two ways the paired filter declines to certify a segment at all. */
type FilterRefusalReasonN =
  | 'initial-domain-violation'
  | 'initial-uncertified-distance';

/**
 * Assembles one compiled term, holding every non-authorable value in this
 * function's scope and nowhere else.
 *
 * ## Why a closure rather than a class
 *
 * TypeScript `private` is a compile-time annotation. It erases, and in the
 * packed JavaScript a consumer actually runs, an erased private field is an
 * ordinary writable enumerable property. That is not a hypothetical: against
 * the built artifacts of the first implementation, `provider.rule = ...`
 * changed the energy by 16.4%, mutating the obtained `provider.staticObstacle`
 * changed it by 88.2%, and `filter.conservativeScale = 1.2` moved the
 * certificate from `0.405` to `0.54` — covering a placement the law itself
 * refuses. The last one is a safety failure, not an encapsulation preference.
 *
 * A closure variable is not a property. It has no descriptor, no key, no
 * symbol, and no getter; `Object.keys`, `Reflect.ownKeys`, spread, and
 * serialization cannot see it, and nothing can assign to it from outside. The
 * exposed objects below carry exactly the members the released provider and
 * filter interfaces require, and both are frozen, so even those cannot be
 * reassigned.
 *
 * The rule stays non-authorable in the same move: there is no rule option to
 * pass and no rule property to overwrite.
 *
 * ## Closure is not the whole boundary
 *
 * A value with no key is still delivered to a caller-replaceable function the
 * moment it is used as the RECEIVER of an inherited operation. A typed array's
 * `length` is an accessor on `%TypedArray%.prototype`; an array's `forEach`
 * and `Symbol.iterator` live on `Array.prototype`. Any consumer may replace
 * them — including before this module is initialized, which is why caching
 * them at load time would not be a fix and none are cached.
 *
 * The first closure version still handed the persistent static-obstacle buffer
 * to the released query, whose `simplex.length` read is inherited, and took
 * `subarray` of it while compiling. A consumer could receive the buffer,
 * restore the intrinsic, mutate the retained reference afterwards, and move a
 * later clean evaluation from `0.5211907392559832` to `1.7968655070577886`.
 * Ownership of the snapshot is a public contract, so that was a safety defect,
 * not a matter of taste.
 *
 * The rules this module follows as a result:
 *
 * - persistent private state is read by INDEX only, never by a method call;
 * - counts are carried as plain numbers, because an Array's `length` is an own
 *   property while a typed array's is inherited;
 * - anything handed to released code — the node point, the cell pack, the
 *   obstacle geometry — is built fresh for that one call, so retaining it
 *   confers nothing;
 * - the static snapshot is a FROZEN dense number list, so even a future route
 *   that reached it could not write to it.
 *
 * ## What is and is not claimed
 *
 * Not concealment. Same-realm JavaScript metaprogramming CAN observe
 * otherwise-private state, and two routes are known and measured: numeric
 * accessors installed on `Array.prototype` before compilation retain the
 * static-obstacle snapshot, the fixed rule and a private particle partition,
 * because dense containers are built by indexed assignment into a fresh
 * `Array(n)`; and a replaced inherited operation receives whatever is used as
 * its receiver, which is how the ephemeral per-call geometry is seen. The
 * tests exercise both deliberately.
 *
 * What IS claimed is a consequence boundary:
 *
 * - none of that state is exposed as a public property, option or API;
 * - the otherwise-private arrays a consumer can retain this way are **frozen**,
 *   so once the intrinsic is restored they cannot be modified to change a
 *   later evaluation;
 * - the per-call geometry is freshly allocated, so retaining or mutating it
 *   cannot affect a later evaluation either.
 *
 * The provider's published `particles` are **excluded from that boundary by
 * design**. They are the caller's own live inputs, deliberately public, and
 * moving them changes later evaluations — which is precisely what a contact
 * term reading live state is for. Any shorthand of the form "nothing a
 * consumer captures can change a later evaluation" is false without that
 * exclusion, and is not used.
 *
 * ## The law
 *
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
 *
 * ## The paired filter
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
function assembleTerms(assembled: {
  readonly id: string;
  readonly dimension: number;
  readonly cellParticles: readonly XpbdParticleN[];
  readonly obstacleParticles: readonly XpbdParticleN[] | undefined;
  /** Frozen dense snapshot, read only by index; never a receiver. */
  readonly staticObstacle: readonly number[] | undefined;
  /** Retained separately: a typed array's `length` is an INHERITED accessor. */
  readonly obstacleVertexCount: number;
  readonly rule: readonly QuadratureNodeN[];
  readonly referenceMeasure: number;
  readonly minimumDistance: number;
  readonly activationDistance: number;
  readonly stiffness: number;
  readonly maximumDirectionError: number;
  readonly conservativeScale: number;
}): XpbdSourceSimplexMeasureBarrierTermsN {
  // Destructured into this scope ONCE. Nothing below reads `assembled` again,
  // and no exposed object holds a reference to it.
  const {
    id, dimension, cellParticles, obstacleParticles, staticObstacle, rule,
    obstacleVertexCount, referenceMeasure, minimumDistance, activationDistance,
    stiffness, maximumDirectionError, conservativeScale
  } = assembled;

  /**
   * Counts retained as plain numbers.
   *
   * An Array's `length` is an OWN data property, so reading it never consults
   * `Array.prototype`. A typed array's `length` is an ACCESSOR on
   * `%TypedArray%.prototype`, so reading it hands the array to whatever
   * function currently sits there. Persistent private state is therefore
   * measured from these numbers, never from `.length`.
   */
  const cellCount = cellParticles.length;
  const obstacleCount = obstacleParticles === undefined
    ? 0 : obstacleParticles.length;
  const nodeCount = rule.length;

  // Built by index rather than by spread: spreading a private partition array
  // invokes its INHERITED iterator, which hands the private array to a
  // caller-replaceable function as `this`.
  const collected = new Array<XpbdParticleN>(cellCount + obstacleCount);
  for (let slot = 0; slot < cellCount; slot++) {
    collected[slot] = cellParticles[slot]!;
  }
  for (let slot = 0; slot < obstacleCount; slot++) {
    collected[cellCount + slot] = obstacleParticles![slot]!;
  }
  const particles: readonly XpbdParticleN[] = Object.freeze(collected);

  const refuse = (
    reason: XpbdSourceSimplexMeasureBarrierDomainReasonN, message: string
  ): XpbdPotentialDomainErrorN<XpbdSourceSimplexMeasureBarrierDomainReasonN> =>
    new XpbdPotentialDomainErrorN<
      XpbdSourceSimplexMeasureBarrierDomainReasonN
    >(id, reason, message);

  const requireProjection = (
    result: PointSimplexResult, node: number, caller: string
  ): Extract<PointSimplexResult, { status: 'projected' }> => {
    if (result.status === 'rank-deficient') {
      // Reachable only with a bound obstacle: a static one is packed once and
      // its rank settled at construction, as a configuration error.
      throw refuse('obstacle-rank-deficient',
        `${caller}: the obstacle simplex is exactly rank-deficient ` +
        `(rank ${result.exactRank}) at this candidate`);
    }
    if (result.status === 'uncertified') {
      throw refuse(PUBLICATION_REASON[result.reason],
        `${caller}: node ${node}'s exact point--simplex decision could not be ` +
        `published (${result.reason}: ${result.detail})`);
    }
    if (result.status === 'zero') {
      throw refuse('zero-or-intersecting',
        `${caller}: node ${node} is at certified zero distance from the ` +
        'obstacle; no direction exists');
    }
    return result;
  };

  /** `q_own + beta * sum_{v != own} (q_v - q_own)`, an affine combination. */
  const nodePosition = (
    cell: Float64Array, node: QuadratureNodeN
  ): Float64Array => {
    const point = new Float64Array(dimension);
    const anchor = node.ownSlot * dimension;
    for (let axis = 0; axis < dimension; axis++) {
      let value = cell[anchor + axis]!;
      for (let slot = 0; slot < node.slots; slot++) {
        if (slot === node.ownSlot) continue;
        value += node.coefficients[slot]! *
          (cell[slot * dimension + axis]! - cell[anchor + axis]!);
      }
      point[axis] = value;
    }
    return point;
  };

  const packSide = (
    side: readonly XpbdParticleN[],
    count: number,
    positionOf: XpbdParticlePositionQueryN,
    caller: string,
    label: string
  ): Float64Array => {
    const packed = new Float64Array(count * dimension);
    for (let slot = 0; slot < count; slot++) {
      const position = positionOf(side[slot]!);
      if (!(position instanceof VecN) || position.dim !== dimension) {
        throw new Error(
          `${caller}: ${label}[${slot}] position must be R${dimension}`
        );
      }
      for (let axis = 0; axis < dimension; axis++) {
        const value = position.data[axis]!;
        if (!Number.isFinite(value)) {
          throw new Error(`${caller}: ${label}[${slot}] position must be finite`);
        }
        packed[slot * dimension + axis] = value;
      }
    }
    return packed;
  };

  /**
   * The obstacle geometry for ONE call, freshly allocated every time.
   *
   * The released exact query reads its `simplex` argument's `length`, and a
   * typed array's `length` is inherited — so whatever is passed here is
   * handed to a caller-replaceable accessor as `this`. Passing the persistent
   * snapshot made that accessor a permanent handle on the law: a consumer
   * could receive the buffer, restore the accessor, and mutate the retained
   * reference afterwards, moving a later clean evaluation from
   * `0.5211907392559832` to `1.7968655070577886`.
   *
   * A fresh copy per call cannot carry that authority. Retaining one is
   * harmless because nothing reads it again.
   */
  const packObstacle = (
    positionOf: XpbdParticlePositionQueryN, caller: string
  ): Float64Array => {
    if (staticObstacle !== undefined) {
      const total = obstacleVertexCount * dimension;
      const packed = new Float64Array(total);
      for (let entry = 0; entry < total; entry++) {
        packed[entry] = staticObstacle[entry]!;
      }
      return packed;
    }
    return packSide(
      obstacleParticles!, obstacleCount, positionOf, caller, 'obstacle'
    );
  };

  const evaluateAt = (
    positionOf: XpbdParticlePositionQueryN
  ): XpbdConservativeForceProviderEvaluationN => {
    const caller = 'XpbdSourceSimplexMeasureBarrierN.evaluateAt';
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    const cell = packSide(cellParticles, cellCount, positionOf, caller, 'cell');
    const obstacle = packObstacle(positionOf, caller);
    const ledger = new ContributionLedgerN(
      rule.length, particles.length, dimension
    );
    const barrierActivation = activationDistance - minimumDistance;
    for (let node = 0; node < rule.length; node++) {
      const quadrature = rule[node]!;
      const point = nodePosition(cell, quadrature);
      const result = evaluateExactPointSimplexResult(
        point, obstacle, dimension
      );
      const projected = requireProjection(result, node, caller);
      const distance = projected.witness.distance;
      if (!Number.isFinite(distance)) {
        throw new Error(`${caller}: node ${node} distance is outside Float64`);
      }
      if (!(distance > minimumDistance)) {
        throw refuse('at-or-below-minimum-distance',
          `${caller}: node ${node} distance must be greater than minimumDistance`);
      }
      if (!(certifiedDistanceLowerBound(
        projected.witness.squaredDistance,
        projected.error.squaredDistanceErrorBound
      ) > minimumDistance)) {
        throw refuse('minimum-distance-not-certified',
          `${caller}: node ${node}'s distance error bound reaches minimumDistance`);
      }
      if (projected.error.directionErrorBound > maximumDirectionError) {
        throw refuse('direction-error-exceeds-policy',
          `${caller}: node ${node} published direction error ` +
          `${projected.error.directionErrorBound} exceeds the authored ` +
          `maximumDirectionError ${maximumDirectionError}`);
      }
      // Order 1 and only order 1: this term publishes an energy and forces,
      // never a curvature it would not use.
      const barrier = evaluateClampedLogBarrierAtOrderN({
        coordinate: distance - minimumDistance,
        activation: barrierActivation,
        stiffness
      }, 1);
      if (!barrier.energy.available || !barrier.firstDerivative.available) {
        throw refuse('barrier-component-outside-float64',
          `${caller}: a required barrier component is outside Float64 at ` +
          `node ${node}`);
      }
      const direction = projected.witness.direction;
      const share = quadrature.weight * barrier.firstDerivative.value;
      ledger.recordEnergy(node, quadrature.weight * barrier.energy.value);
      for (let slot = 0; slot < cellParticles.length; slot++) {
        ledger.accumulate(
          slot, share * quadrature.coefficients[slot]!, direction
        );
      }
      if (obstacleParticles !== undefined) {
        const offset = cellParticles.length;
        for (let slot = 0; slot < obstacleParticles.length; slot++) {
          ledger.accumulate(
            offset + slot, -share * projected.witness.weights[slot]!, direction
          );
        }
      }
    }
    const reduced = ledger.reduce(referenceMeasure);
    let finite = Number.isFinite(reduced.potentialEnergy);
    for (let slot = 0; finite && slot < particles.length; slot++) {
      const data = reduced.forces[slot]!.data;
      for (let axis = 0; axis < dimension; axis++) {
        if (!Number.isFinite(data[axis]!)) { finite = false; break; }
      }
    }
    if (!finite) {
      throw refuse('accumulated-value-outside-float64',
        `${caller}: the measure-weighted sum left Float64 at this candidate`);
    }
    return Object.freeze({
      potentialEnergy: reduced.potentialEnergy,
      forces: Object.freeze(reduced.forces)
    });
  };

  /**
   * The smallest CERTIFIED node margin over the open boundary at a placement,
   * or the reason no such number exists. Shared with the paired filter, so the
   * filter certifies against the same geometry the energy refuses on — and it
   * is shared as a closure, not as a reachable property of either object.
   */
  const startMarginAt = (
    positionOf: XpbdParticlePositionQueryN,
    caller: string
  ): { readonly margin: number } | { readonly reason: FilterRefusalReasonN } => {
    const cell = packSide(cellParticles, cellCount, positionOf, caller, 'cell');
    const obstacle = packObstacle(positionOf, caller);
    let smallest = Number.POSITIVE_INFINITY;
    for (let node = 0; node < nodeCount; node++) {
      const result = evaluateExactPointSimplexResult(
        nodePosition(cell, rule[node]!), obstacle, dimension
      );
      if (result.status === 'uncertified' || result.status === 'rank-deficient') {
        return { reason: 'initial-uncertified-distance' };
      }
      if (result.status === 'zero') return { reason: 'initial-domain-violation' };
      smallest = Math.min(smallest, certifiedDistanceLowerBound(
        result.witness.squaredDistance, result.error.squaredDistanceErrorBound
      ));
    }
    const margin = smallest - minimumDistance;
    if (!(margin > 0)) return { reason: 'initial-domain-violation' };
    return { margin };
  };

  const filterEvaluate = (
    context: XpbdIncrementalPotentialStepFilterContextN
  ): XpbdIncrementalPotentialStepFilterEvaluationN => {
    const caller = 'XpbdSourceSimplexMeasureBarrierStepFilterN.evaluate';
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
      throw new Error(`${caller}: requestedStepLength must be finite and positive`);
    }
    if (typeof context.positionBefore !== 'function' ||
      typeof context.positionAfter !== 'function') {
      throw new Error(`${caller}: position lookups must be functions`);
    }

    const start = startMarginAt(
      (particle) => context.positionBefore(particle), caller
    );
    if ('reason' in start) {
      return Object.freeze({ status: 'indeterminate', reason: start.reason });
    }
    const displacement = (
      side: readonly XpbdParticleN[] | undefined, count: number
    ): number => {
      if (side === undefined) return 0;
      let largest = 0;
      for (let slot = 0; slot < count; slot++) {
        const particle = side[slot]!;
        largest = Math.max(largest, context.positionAfter(particle)
          .clone().sub(context.positionBefore(particle)).length());
      }
      return largest;
    };
    const total = displacement(cellParticles, cellCount) +
      displacement(obstacleParticles, obstacleCount);
    if (total === 0 || total < start.margin) {
      return Object.freeze({
        status: 'safe', maximumStepLength: context.requestedStepLength
      });
    }
    const maximumStepLength = context.requestedStepLength *
      (conservativeScale * start.margin / total);
    if (!Number.isFinite(maximumStepLength) || maximumStepLength < 0 ||
      !(maximumStepLength < context.requestedStepLength)) {
      throw new Error(`${caller}: certified prefix is outside Float64`);
    }
    return Object.freeze({ status: 'limited', maximumStepLength });
  };

  // Frozen, so even the released members cannot be reassigned, and no key can
  // be added. Every other value the law depends on is a `const` above: not a
  // property, so it has no descriptor, no key and no getter to reach it by.
  const provider: XpbdConservativeForceProviderN = Object.freeze({
    id,
    dimension,
    particles,
    /** Evaluates from the particles' live positions without mutation. */
    evaluate: (): XpbdConservativeForceProviderEvaluationN =>
      evaluateAt((particle) => particle.position.clone()),
    evaluateAt
  });
  const stepFilter: XpbdIncrementalPotentialStepFilterN = Object.freeze({
    id: `${id}-filter`,
    dimension,
    particles,
    evaluate: filterEvaluate
  });
  return Object.freeze({ provider, stepFilter });
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
 * It is a **measure-consistent fixed quadrature**: what it buys over a
 * per-vertex barrier is that the contact resists by the SIZE of the touching
 * feature rather than by the number of vertices describing it, so splitting a
 * cell in two does not answer twice.
 *
 * ## What that does and does not mean under subdivision
 *
 * Removing direct cell-count multiplication is not the same as being invariant
 * under subdivision, and the two must not be conflated:
 *
 * - **Constant integrand** — when the barrier is constant over the cell, as it
 *   is for a cell parallel to a flat obstacle, subdivision is exactly additive
 *   up to Float64 reduction.
 * - **General nonconstant integrand** — subdivision moves the sample
 *   locations, so a fixed finite rule normally returns a different estimate.
 *   Measured on two legal refinements of the same source region: a tilted cell
 *   split in half changes by about 27%, and an uneven split of a curved
 *   arrangement by about 44%.
 * - **Convergence** — the refinement sequence approaches the continuum
 *   integral. Measured against an independent composite Gauss--Legendre
 *   reference built from the released query and barrier, the error falls at
 *   second order in the cell size on that fixture, with the single-cell
 *   estimate about 28% below the continuum value. That is a measurement on a
 *   named fixture; **no truncation bound is proved and none is claimed**.
 *
 * Supported source dimensions are `k = 1, 2, 3`, the range over which the
 * exact point--simplex query publishes a direction enclosure.
 *
 * The quadrature is fixed and not authorable. A caller-supplied rule would
 * make the energy a function of the rule, and every stated property here —
 * that the forces are its exact gradient, that the filter's Lipschitz bound
 * covers every node, that the term refuses as a whole — is a property of THIS
 * rule. Offering a knob would offer those guarantees on rules that have not
 * been measured. It is **not authorable through the public API** either: no
 * rule option is accepted and no rule property exists to overwrite.
 *
 * That is a statement about the public surface, not about observability. See
 * the note on the assembled term below: same-realm metaprogramming can observe
 * otherwise-private arrays, including the rule itself. They are frozen, so the
 * guarantee is a consequence boundary rather than concealment.
 *
 * A successful evaluation carries exactly `potentialEnergy` and `forces`.
 * There is no inspection surface, and the companion `stepFilter` is required
 * rather than optional — without it, nothing prevents a step from leaping
 * through the obstacle, because the law measures unsigned distance and has no
 * notion of side.
 *
 * @example
 * A strip above a floor triangle at CONSTANT distance, and the same strip
 * subdivided. Here — and only because the sampled barrier is constant along
 * the cell — subdivision is exactly additive. Tilt the strip and the two
 * answers differ, because a fixed finite rule samples different places.
 * ```ts
 * const floor = new CellComplex(3, Float64Array.from([
 *   -40, 0, -40, 60, 0, -40, -40, 0, 60
 * ]), [{ dim: 2, verticesPerCell: 3, kind: 'simplex',
 *        indices: Uint32Array.from([0, 1, 2]) }]);
 * const floorGroup = floor.groups[0];
 * if (floorGroup === undefined) throw new Error('expected the floor group');
 * const obstacle = createSourceSimplexReferenceN(
 *   createSourceCellReferenceN(floor, floorGroup, 0)
 * );
 *
 * const energies = [[0, 1], [0, 0.5], [0.5, 1]].map(([from, to]) => {
 *   const strip = new CellComplex(3, Float64Array.from([
 *     from, 0.5, 0, to, 0.5, 0
 *   ]), [{ dim: 1, verticesPerCell: 2, kind: 'simplex',
 *          indices: Uint32Array.from([0, 1]) }]);
 *   const stripGroup = strip.groups[0];
 *   if (stripGroup === undefined) throw new Error('expected the strip group');
 *   const terms = compileXpbdSourceSimplexMeasureBarrierN({
 *     id: `contact-${from}`,
 *     binding: compileXpbdParticleBindingN({
 *       id: `strip-${from}`, source: strip
 *     }),
 *     cell: createSourceSimplexReferenceN(
 *       createSourceCellReferenceN(strip, stripGroup, 0)
 *     ),
 *     obstacle,
 *     minimumDistance: 0.05,
 *     activationDistance: 1,
 *     stiffness: 2,
 *     maximumDirectionError: 1e-6
 *   });
 *   return terms.provider.evaluate().potentialEnergy;
 * });
 * const [whole, left, right] = energies;
 * if (whole === undefined || left === undefined || right === undefined) {
 *   throw new Error('expected three energies');
 * }
 *
 * log('one cell ', whole);
 * log('two cells', left + right);  // the same number, for a CONSTANT barrier
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

  // Assembled by index rather than by `map` and `for...of`. Both of those
  // dispatch through `Array.prototype`, and these two arrays become permanent
  // private state: the array a replaced `map` returns is one a caller can
  // keep, and iterating a private array hands it over as `this`.
  const cellVertexCount = options.cell.vertexIndices.length;
  const cellSlots = new Array<XpbdParticleN>(cellVertexCount);
  for (let slot = 0; slot < cellVertexCount; slot++) {
    const particle = options.binding.particleForSourceVertex(
      options.cell.vertexIndices[slot]!
    );
    if (particle.dimension !== dimension) {
      throw new Error(
        `${caller}: a cell particle is R${particle.dimension}, the cell is in ` +
        `R${dimension}`
      );
    }
    cellSlots[slot] = particle;
  }
  const cellParticles: readonly XpbdParticleN[] = Object.freeze(cellSlots);

  // The reference measure is read from the binding's validated snapshot of the
  // source, never from live particle state: it is the constant that makes the
  // published gradient the complete gradient, so it must not depend on where
  // the solver happens to be standing when the term is compiled.
  //
  // `restPositions` is handed to a released evaluator, so it is built fresh
  // and discarded here; nothing retains it and no later evaluation reads it.
  const restPositions = new Array<VecN>(cellVertexCount);
  for (let slot = 0; slot < cellVertexCount; slot++) {
    restPositions[slot] = options.binding
      .vertices[options.cell.vertexIndices[slot]!]!.sourcePosition.clone();
  }
  const referenceMeasure = evaluateSimplexSquaredMeasureN(restPositions).measure;
  if (!Number.isFinite(referenceMeasure) || !(referenceMeasure > 0)) {
    throw new Error(
      `${caller}: the cell's reference measure is ${referenceMeasure}; a ` +
      'rest-degenerate cell has no measure to weight its contact by'
    );
  }

  let obstacleParticles: readonly XpbdParticleN[] | undefined;
  let staticObstacle: readonly number[] | undefined;
  const obstacleVertexCount = options.obstacle.vertexIndices.length;
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
    const obstacleSlots = new Array<XpbdParticleN>(obstacleVertexCount);
    for (let slot = 0; slot < obstacleVertexCount; slot++) {
      obstacleSlots[slot] = options.obstacleBinding.particleForSourceVertex(
        options.obstacle.vertexIndices[slot]!
      );
    }
    obstacleParticles = Object.freeze(obstacleSlots);
    // A bound obstacle must be kinematic. The energy weights the CELL's
    // reference measure alone, so the law is deliberately one-sided; letting
    // the obstacle respond to it would integrate a force derived from a
    // measure that is not the obstacle's, which is not a contact law anyone
    // authored. Reporting the reaction is honest, applying it would not be.
    for (let slot = 0; slot < obstacleVertexCount; slot++) {
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
    }
  } else {
    // The snapshot is a frozen dense number list, never a typed array. A
    // typed array's `length` is an inherited accessor, so any code that
    // measures one hands it to whatever function currently sits on
    // `%TypedArray%.prototype`; a frozen plain array has an OWN `length` and
    // cannot be written even if some future route did reach it. Nothing below
    // ever calls a method on it — it is read by index and nothing else.
    const snapshot = new Array<number>(obstacleVertexCount * dimension);
    for (let slot = 0; slot < obstacleVertexCount; slot++) {
      const vertexIndex = options.obstacle.vertexIndices[slot]!;
      for (let axis = 0; axis < dimension; axis++) {
        const value =
          options.obstacle.complex.positions[vertexIndex * dimension + axis]!;
        if (!Number.isFinite(value)) {
          throw new Error(
            `${caller}: obstacle vertex ${slot} has a non-finite coordinate`
          );
        }
        snapshot[slot * dimension + axis] = value;
      }
    }
    staticObstacle = Object.freeze(snapshot);
    // Settle the static obstacle's rank ONCE, here, as a configuration error.
    // The query decides rank before it publishes anything, so any probe point
    // exposes it; the obstacle's own first vertex is the cheapest and is
    // deterministic. Every other status proves the rank is full.
    //
    // Both arguments are built fresh for this one call. The predecessor
    // passed the persistent buffer and additionally took `subarray` of it,
    // which handed it to two replaceable inherited operations at compile time.
    const probePoint = new Float64Array(dimension);
    for (let axis = 0; axis < dimension; axis++) {
      probePoint[axis] = staticObstacle[axis]!;
    }
    const probeSimplex = new Float64Array(obstacleVertexCount * dimension);
    for (let entry = 0; entry < obstacleVertexCount * dimension; entry++) {
      probeSimplex[entry] = staticObstacle[entry]!;
    }
    const probe = evaluateExactPointSimplexResult(
      probePoint, probeSimplex, dimension
    );
    if (probe.status === 'rank-deficient') {
      throw new Error(
        `${caller}: the static obstacle simplex is exactly rank-deficient ` +
        `(rank ${probe.exactRank})`
      );
    }
  }

  return assembleTerms({
    id: options.id,
    dimension,
    cellParticles,
    obstacleParticles,
    staticObstacle,
    obstacleVertexCount,
    rule: fixedRule(options.cell.intrinsicDim),
    referenceMeasure,
    minimumDistance,
    activationDistance: options.activationDistance,
    stiffness: options.stiffness,
    maximumDirectionError: options.maximumDirectionError,
    conservativeScale
  });
}
