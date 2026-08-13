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
  type PointSimplexResult
} from './exact-point-simplex-distance.js';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderEvaluationN,
  type XpbdConservativeForceProviderN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

/** Open-domain refusal vocabulary of a point--source-simplex barrier. */
export type XpbdParticleSourceSimplexBarrierDomainReasonN =
  | 'at-or-below-minimum-distance'
  | 'minimum-distance-not-certified';

/** Maximum certified Euclidean direction error admitted by the force law. */
const MAX_POINT_SIMPLEX_DIRECTION_ERROR = 2 ** -12;

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
      'stiffness'
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
    const { projection, result: pointSimplex } = queried;
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
      throw new Error(`${caller}: internal positive-distance classification was lost`);
    }
    if (pointSimplex !== null &&
      pointSimplex.error.directionErrorBound >
      MAX_POINT_SIMPLEX_DIRECTION_ERROR) {
      throw new Error(
        `${caller}: certified direction error ${pointSimplex.error.directionErrorBound} ` +
        `exceeds ${MAX_POINT_SIMPLEX_DIRECTION_ERROR}`
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

/** Why the finite-simplex filter could not certify any segment prefix. */
export type XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN =
  'initial-domain-violation';

/** Evidence behind one finite-simplex segment certification. */
export interface XpbdParticleSourceSimplexBarrierStepFilterEvidenceN {
  /** Unsigned point--simplex distance at the segment start. */
  readonly startDistance: number;
  /** Unsigned point--simplex distance at the requested endpoint. */
  readonly endDistance: number;
  /** Certified lower bound on start distance above the open minimum. */
  readonly startMargin: number;
  /** Certified lower bound on endpoint distance above the open minimum. */
  readonly endMargin: number;
  /** Euclidean length of the complete proposed point path. */
  readonly pathLength: number;
  /** Initial distance derivative over the complete segment fraction. */
  readonly startDirectionalDerivative: number;
  /** Certified fraction of the requested segment, in `[0, 1]`. */
  readonly certifiedFraction: number;
  /** Proof used; never an inferred or exact impact time. */
  readonly certification:
    | 'stationary'
    | 'convex-nondecreasing'
    | 'global-lipschitz'
    | 'initial-domain-violation';
}

/** Result of one conservative finite-simplex segment query. */
export type XpbdParticleSourceSimplexBarrierStepFilterEvaluationN =
  XpbdParticleSourceSimplexBarrierStepFilterEvidenceN & (
    | {
      readonly status: 'safe';
      readonly maximumStepLength: number;
    }
    | {
      readonly status: 'limited';
      readonly maximumStepLength: number;
    }
    | {
      readonly status: 'indeterminate';
      readonly reason:
        XpbdParticleSourceSimplexBarrierStepFilterRefusalReasonN;
    }
  );

/**
 * Conservative RN point--static-source-simplex collision-free step filter.
 *
 * Distance to a closed convex simplex is convex and 1-Lipschitz. A segment
 * whose initial directional derivative is non-negative is therefore safe in
 * full; otherwise the global Lipschitz bound certifies a strict prefix. The
 * result intentionally reports a `certifiedFraction`, not an impact time:
 * this filter does not solve the piecewise closest-feature crossing exactly.
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
    const startQuery = projectForBarrier(this.barrier, before);
    const endQuery = projectForBarrier(this.barrier, after);
    const startProjection = startQuery.projection;
    const startDistance = startQuery.result === null
      ? Math.sqrt(startProjection.squaredDistance)
      : pointSimplexDistance(startQuery.result);
    const endDistance = endQuery.result === null
      ? Math.sqrt(endQuery.projection.squaredDistance)
      : pointSimplexDistance(endQuery.result);
    if (!Number.isFinite(startDistance) || !Number.isFinite(endDistance)) {
      throw new Error(`${caller}: distance is outside Float64`);
    }
    const startCertifiedDistance = certifiedDistanceLowerBound(startQuery);
    const endCertifiedDistance = certifiedDistanceLowerBound(endQuery);
    const startMargin = startCertifiedDistance - this.barrier.minimumDistance;
    const endMargin = endCertifiedDistance - this.barrier.minimumDistance;
    const displacement = after.clone().sub(before);
    const pathLength = displacement.length();
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
      endDistance,
      startMargin,
      endMargin,
      pathLength,
      startDirectionalDerivative
    } as const;
    if (!(startMargin > 0)) {
      return Object.freeze({
        ...common,
        status: 'indeterminate',
        reason: 'initial-domain-violation',
        certifiedFraction: 0,
        certification: 'initial-domain-violation'
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

function projectForBarrier(
  barrier: XpbdParticleSourceSimplexBarrierN,
  position: VecN
): {
  readonly projection: SourceSimplexProjectionN;
  readonly result: PointSimplexResult | null;
} {
  const { simplex } = barrier;
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
    throw new Error(
      `XpbdParticleSourceSimplexBarrierN: point--simplex result is uncertified (${result.reason}: ${result.detail})`
    );
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
  throw new Error(
    `XpbdParticleSourceSimplexBarrierN: point--simplex result is uncertified (${result.reason}: ${result.detail})`
  );
}

function certifiedDistanceLowerBound(query: {
  readonly projection: SourceSimplexProjectionN;
  readonly result: PointSimplexResult | null;
}): number {
  const { result } = query;
  if (result === null) return Math.sqrt(query.projection.squaredDistance);
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
