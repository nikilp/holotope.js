import {
  CellComplex,
  VecN,
  type CellGroup
} from '@holotope/core';
import {
  evaluateClampedLogBarrierAtOrderN,
  type ClampedLogBarrierForceN
} from './clamped-log-barrier.js';
import { gjkDistance, type GjkResult } from './gjk.js';
import { ConvexHullSupportShapeN } from './support-shape.js';
import {
  type XpbdIncrementalPotentialStepFilterContextN,
  type XpbdIncrementalPotentialStepFilterN
} from './xpbd-incremental-potential-step-filter.js';
import { XpbdParticleBindingN } from './xpbd-particle-binding.js';
import { XpbdPotentialDomainErrorN } from './xpbd-potential-domain.js';
import {
  XpbdParticleN,
  XpbdWorldN,
  type XpbdConservativeForceProviderEvaluationN,
  type XpbdConservativeForceProviderN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

/**
 * Why a convex-hull barrier could not evaluate a candidate position.
 *
 * `'at-or-below-minimum-distance'` is the ordinary open-domain refusal shared
 * with every other barrier: the candidate is at or inside the boundary, which
 * has no finite energy and must be refused rather than scored.
 *
 * `'closest-point-indeterminate'` is different in kind. The distance query ran
 * out of iteration budget without certifying either separation or intersection,
 * so the geometry is *unknown* rather than bad. It is reported separately
 * precisely so it cannot be quietly read as "separated" or as a zero force.
 */
export type XpbdParticleSourceConvexHullBarrierDomainReasonN =
  | 'at-or-below-minimum-distance'
  | 'closest-point-indeterminate'
  | 'barrier-component-outside-float64';

/** Construction options for one dynamic point--static-convex-hull family. */
export interface CompileXpbdParticleSourceConvexHullBarrierFamilyNOptions {
  /** Stable provider identity and record-ID prefix. */
  readonly id: string;
  /** One live particle per authoritative dynamic source vertex. */
  readonly binding: XpbdParticleBindingN;
  /** Separate static obstacle complex supplying the hull's source vertices. */
  readonly obstacle: CellComplex;
  /**
   * Group whose cells select which obstacle vertices the hull spans.
   *
   * The cells select *vertices*. They do not mean that the union of those cells
   * is represented: the represented set is the convex hull of the selected
   * vertices, which fills every concavity between them.
   */
  readonly sourceGroup: CellGroup;
  /** Open unsigned-distance boundary. Default zero. */
  readonly minimumDistance?: number;
  /** Distance at and above which the barrier energy is exactly zero. */
  readonly activationDistance: number;
  /** Positive energy scale. */
  readonly stiffness: number;
  /** Fraction of each certified Lipschitz prefix retained. Default `0.9`. */
  readonly conservativeScale?: number;
  /** Bound on distance-query iterations per particle. Default `32`. */
  readonly maximumQueryIterations?: number;
}

/** Source evidence behind one closest-point answer. */
export interface XpbdSourceConvexHullWitnessN {
  /**
   * Authoritative obstacle vertices the returned support simplex rests on.
   *
   * These are indices into the **obstacle complex**, translated back from the
   * packed hull's own slot numbering. A caller must never receive the packing
   * slots: selection and source permutation both make them differ.
   */
  readonly sourceVertices: readonly number[];
  /** Closest point on the hull. */
  readonly closestPoint: VecN;
  /** Unit vector from the hull toward the particle. */
  readonly separationNormal: VecN;
  /** Complete distance-query evidence, for auditing a surprising answer. */
  readonly query: GjkResult;
}

/** One particle's active barrier against the hull. */
export interface XpbdParticleSourceConvexHullActiveBarrierN {
  /** Family-scoped stable identity for this particle's record. */
  readonly id: string;
  /** Dynamic source vertex whose bound particle supplied the point. */
  readonly sourceVertexIndex: number;
  /** Unsigned Euclidean distance to the closed convex hull. */
  readonly distance: number;
  /** `distance - minimumDistance`. */
  readonly barrierCoordinate: number;
  /**
   * The graded order-1 scalar evaluation this force was built from. Both
   * required components were available (the provider refused otherwise).
   */
  readonly barrier: ClampedLogBarrierForceN;
  /** Closest point, normal, and source vertices behind this answer. */
  readonly witness: XpbdSourceConvexHullWitnessN;
}

/** What one complete family evaluation cost and found. */
export interface XpbdParticleSourceConvexHullQueryDiagnosticsN {
  /** Dynamic source vertices considered. */
  readonly sourceVertexCount: number;
  /** Vertices spanning the hull. */
  readonly hullVertexCount: number;
  /**
   * Distance queries performed: exactly one per dynamic vertex.
   *
   * There is no per-cell fan-out here. That is the whole point of the family:
   * one convex set produces one closest point, not one per decomposition cell.
   */
  readonly setQueries: number;
  /** Total distance-query iterations, summed over particles. */
  readonly queryIterations: number;
  /** Particles whose exact distance is inside the activation distance. */
  readonly activeParticles: number;
}

/** Aggregate evaluation over only the particles inside the activation band. */
export interface XpbdParticleSourceConvexHullBarrierFamilyEvaluationN
  extends XpbdConservativeForceProviderEvaluationN {
  /** One active record per active particle, in source order. */
  readonly activeBarriers: readonly XpbdParticleSourceConvexHullActiveBarrierN[];
  /** One accumulated force per bound source vertex. */
  readonly forces: readonly VecN[];
  /** Auditable per-evaluation counts. */
  readonly diagnostics: XpbdParticleSourceConvexHullQueryDiagnosticsN;
}

/** Why the aggregate segment filter could not certify any prefix. */
export type XpbdParticleSourceConvexHullBarrierFamilyStepFilterRefusalReasonN =
  | 'initial-domain-violation'
  | 'closest-point-indeterminate';

/** One particle's segment certification against the hull. */
export interface XpbdParticleSourceConvexHullSegmentCertificationN {
  /** Dynamic source vertex this certification describes. */
  readonly sourceVertexIndex: number;
  /** Unsigned distance at the segment start. */
  readonly startDistance: number;
  /** Start distance above the open minimum. */
  readonly startMargin: number;
  /** Euclidean length of the complete proposed path. */
  readonly pathLength: number;
  /** Initial distance derivative along the complete segment. */
  readonly startDirectionalDerivative: number;
  /** Certified fraction of the requested segment, in `[0, 1]`. */
  readonly certifiedFraction: number;
  /** Proof used; never an inferred or exact impact time. */
  readonly certification:
    | 'stationary'
    | 'convex-nondecreasing'
    | 'global-lipschitz'
    | 'initial-domain-violation'
    | 'closest-point-indeterminate';
}

/** Aggregate certification evidence for one proposed segment. */
export type XpbdParticleSourceConvexHullBarrierFamilyStepFilterEvaluationN = {
  /** Per-particle certifications in stable source order. */
  readonly certifications:
    readonly XpbdParticleSourceConvexHullSegmentCertificationN[];
  /** Source vertex imposing the aggregate limit or refusal, otherwise `null`. */
  readonly blockingSourceVertexIndex: number | null;
} & (
  | { readonly status: 'safe'; readonly maximumStepLength: number }
  | { readonly status: 'limited'; readonly maximumStepLength: number }
  | {
    readonly status: 'indeterminate';
    readonly reason:
      XpbdParticleSourceConvexHullBarrierFamilyStepFilterRefusalReasonN;
  }
);

/** Provider/filter pair accepted by an incremental-potential problem. */
export interface XpbdParticleSourceConvexHullBarrierFamilyTermsN {
  /** Existing providers followed by this convex-hull family provider. */
  readonly providers: readonly XpbdConservativeForceProviderN[];
  /** Existing filters followed by this family's paired segment certificate. */
  readonly stepFilters: readonly XpbdIncrementalPotentialStepFilterN[];
}

/**
 * Source-retained RN barriers from dynamic points to one **static convex hull**.
 *
 * The represented set is the convex hull of the obstacle vertices selected by
 * `sourceGroup`. That is a deliberate, narrow contract, and the difference
 * from the point--simplex family is the reason this exists:
 *
 * - `XpbdParticleSourceSimplexBarrierFamilyN` applies one barrier per obstacle
 *   *cell* and sums them. That is exactly right for cells that are meaningful
 *   contact features in their own right, and exactly wrong for cells that are
 *   only a decomposition of one solid — each cell pushes away from itself, so
 *   the sum is not normal to the solid's boundary;
 * - this family performs one closest-point query against one set, so a point
 *   over a flat support is pushed along the support normal regardless of how
 *   that support happened to be cut up.
 *
 * The set is the **hull**, not the union. Any concavity between the selected
 * vertices is filled. A caller who needs a non-convex obstacle must decompose
 * it into convex components they manage explicitly.
 *
 * The hull is **static** for the lifetime of a solve. Its coordinates are
 * snapshotted at compile time and every public entry point refuses if the
 * selected source has since moved or been relaid out, rather than silently
 * following it.
 *
 * The set may be lower-dimensional in its ambient space — a flat slab in R4 is
 * the motivating case. Proximity is unsigned and two-sided: this is a distance
 * barrier, not an inside/outside test, and a lower-dimensional set has no
 * inside to be on.
 *
 * ## What the barrier constrains, and what it does not
 *
 * One barrier per bound *particle*, so the domain certificate it maintains is
 * per-vertex: every constrained particle stays strictly outside the hull's
 * `minimumDistance` shell.
 *
 * That is **not** a certificate that a surface interpolated between those
 * particles is disjoint from the hull. A triangle can cross a convex set while
 * all three of its vertices remain legally outside it, so a mesh whose vertices
 * are all constrained here can still have interior geometry intersecting the
 * support.
 *
 * **Refinement does not remove this.** It is tempting to read the gap as a
 * spacing artefact that a finer mesh closes, and measurement does not support
 * that: over one authored scene driven to its terminal at two resolutions, the
 * finer mesh breached earlier in its own run than the coarser one, each
 * following that scene's own departure from the support rather than its vertex
 * spacing. Spacing bounds how far *inside* the set the surface can reach; it
 * does not decide whether the surface reaches inside at all.
 *
 * Constraining the surface itself needs edge- and face-level candidates. This
 * family does not provide them and does not claim to.
 */
export class XpbdParticleSourceConvexHullBarrierFamilyN
implements XpbdConservativeForceProviderN {
  /** Stable conservative-provider identity. */
  readonly id: string;
  /** Ambient dynamic-source and obstacle dimension. */
  readonly dimension: number;
  /** Authoritative dynamic source-to-particle mapping. */
  readonly binding: XpbdParticleBindingN;
  /** Bound particles in source-vertex order. */
  readonly particles: readonly XpbdParticleN[];
  /** Separate static obstacle source. */
  readonly obstacle: CellComplex;
  /** Group whose cells selected the hull's source vertices. */
  readonly sourceGroup: CellGroup;
  /** Sorted unique authoritative obstacle vertices spanning the hull. */
  readonly hullSourceVertices: readonly number[];
  /** Open unsigned-distance boundary. */
  readonly minimumDistance: number;
  /** Distance at and above which energy and force are exactly zero. */
  readonly activationDistance: number;
  /** Positive energy scale. */
  readonly stiffness: number;
  /** Strict prefix scale used by the paired filter. */
  readonly conservativeScale: number;
  /** Per-particle distance-query iteration bound. */
  readonly maximumQueryIterations: number;
  /** Segment filter paired with this provider. */
  readonly stepFilter: XpbdParticleSourceConvexHullBarrierFamilyStepFilterN;

  /** Support shape over the snapshotted hull coordinates. */
  private readonly hull: ConvexHullSupportShapeN;
  /** Coordinates as they stood at compile time, for the staleness check. */
  private readonly snapshot: Float64Array;
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    options: CompileXpbdParticleSourceConvexHullBarrierFamilyNOptions,
    hullSourceVertices: readonly number[],
    snapshot: Float64Array,
    minimumDistance: number,
    conservativeScale: number,
    maximumQueryIterations: number
  ) {
    this.id = options.id;
    this.dimension = options.binding.dimension;
    this.binding = options.binding;
    this.particles = options.binding.particles;
    this.obstacle = options.obstacle;
    this.sourceGroup = options.sourceGroup;
    this.hullSourceVertices = Object.freeze(hullSourceVertices.slice());
    this.minimumDistance = minimumDistance;
    this.activationDistance = options.activationDistance;
    this.stiffness = options.stiffness;
    this.conservativeScale = conservativeScale;
    this.maximumQueryIterations = maximumQueryIterations;
    this.snapshot = snapshot;
    this.hull = new ConvexHullSupportShapeN(this.dimension, snapshot);
    this.stepFilter =
      new XpbdParticleSourceConvexHullBarrierFamilyStepFilterN(this);
  }

  /** Compiles the hull snapshot, source mapping, and paired filter. */
  static compile(
    options: CompileXpbdParticleSourceConvexHullBarrierFamilyNOptions
  ): XpbdParticleSourceConvexHullBarrierFamilyN {
    const validated = validateCompilerInput(options);
    return new XpbdParticleSourceConvexHullBarrierFamilyN(
      options,
      validated.hullSourceVertices,
      validated.snapshot,
      validated.minimumDistance,
      validated.conservativeScale,
      validated.maximumQueryIterations
    );
  }

  /**
   * Distance, closest point, and source witness for one candidate position.
   *
   * Throws {@link XpbdPotentialDomainErrorN} with
   * `'closest-point-indeterminate'` when the query cannot certify an answer.
   */
  queryPoint(position: VecN): XpbdSourceConvexHullWitnessN & {
    readonly distance: number;
  } {
    assertCurrentFamily(this, 'XpbdParticleSourceConvexHullBarrierFamilyN.queryPoint');
    return this.queryUnchecked(
      finitePosition(
        position,
        this.dimension,
        'XpbdParticleSourceConvexHullBarrierFamilyN.queryPoint: position'
      )
    );
  }

  /** Evaluates from the particles' current positions. */
  evaluate(): XpbdParticleSourceConvexHullBarrierFamilyEvaluationN {
    return this.evaluateAt((particle) => particle.position.clone());
  }

  /** Evaluates active barriers at a candidate state without mutating live state. */
  evaluateAt(
    positionOf: XpbdParticlePositionQueryN
  ): XpbdParticleSourceConvexHullBarrierFamilyEvaluationN {
    const caller = 'XpbdParticleSourceConvexHullBarrierFamilyN.evaluateAt';
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    assertCurrentFamily(this, caller);

    const forces = this.particles.map(() => new VecN(this.dimension));
    const activeBarriers: XpbdParticleSourceConvexHullActiveBarrierN[] = [];
    const barrierActivation = this.activationDistance - this.minimumDistance;
    let potentialEnergy = 0;
    let queryIterations = 0;

    for (let index = 0; index < this.particles.length; index++) {
      const position = finitePosition(
        positionOf(this.particles[index]!),
        this.dimension,
        `${caller}: position ${index}`
      );
      const witness = this.queryUnchecked(position);
      queryIterations += witness.query.iterations;
      const barrierCoordinate = witness.distance - this.minimumDistance;
      if (!(barrierCoordinate > 0)) {
        throw new XpbdPotentialDomainErrorN<
          XpbdParticleSourceConvexHullBarrierDomainReasonN
        >(
          this.id,
          'at-or-below-minimum-distance',
          `${caller}: source vertex ${index} is at or inside the open boundary`
        );
      }
      // Exactly one barrier contribution per particle, and only inside the band.
      if (barrierCoordinate >= barrierActivation) continue;
      // Each contribution publishes an energy share and one force, so the
      // family requests order 1 — never a curvature it would not use.
      const barrier = evaluateClampedLogBarrierAtOrderN({
        coordinate: barrierCoordinate,
        activation: barrierActivation,
        stiffness: this.stiffness
      }, 1);
      if (!barrier.energy.available || !barrier.firstDerivative.available) {
        throw new XpbdPotentialDomainErrorN<
          XpbdParticleSourceConvexHullBarrierDomainReasonN
        >(
          this.id,
          'barrier-component-outside-float64',
          `${caller}: a required barrier component is outside Float64 at` +
          ` source vertex ${index}`
        );
      }
      potentialEnergy += barrier.energy.value;
      forces[index]!.add(
        witness.separationNormal.clone()
          .multiplyScalar(-barrier.firstDerivative.value)
      );
      activeBarriers.push(Object.freeze({
        id: `${this.id}/source-vertex/${index}`,
        sourceVertexIndex: index,
        distance: witness.distance,
        barrierCoordinate,
        barrier,
        witness
      }));
    }

    if (!Number.isFinite(potentialEnergy)) {
      throw new Error(`${caller}: potential energy is outside Float64`);
    }
    return Object.freeze({
      potentialEnergy,
      activeBarriers: Object.freeze(activeBarriers),
      forces: Object.freeze(forces),
      diagnostics: Object.freeze({
        sourceVertexCount: this.particles.length,
        hullVertexCount: this.hullSourceVertices.length,
        setQueries: this.particles.length,
        queryIterations,
        activeParticles: activeBarriers.length
      })
    });
  }

  /** Returns this provider and its paired filter, optionally after base terms. */
  incrementalPotentialTerms(
    base?: XpbdParticleSourceConvexHullBarrierFamilyTermsN
  ): XpbdParticleSourceConvexHullBarrierFamilyTermsN {
    const caller =
      'XpbdParticleSourceConvexHullBarrierFamilyN.incrementalPotentialTerms';
    assertCurrentFamily(this, caller);
    if (base === undefined) {
      return Object.freeze({
        providers: Object.freeze([this]),
        stepFilters: Object.freeze([this.stepFilter])
      });
    }
    if (typeof base !== 'object' || base === null ||
      !Array.isArray(base.providers) || !Array.isArray(base.stepFilters)) {
      throw new Error(`${caller}: base terms must contain provider/filter arrays`);
    }
    return Object.freeze({
      providers: Object.freeze([...base.providers, this]),
      stepFilters: Object.freeze([...base.stepFilters, this.stepFilter])
    });
  }

  /** Registers this one dynamic provider; particles must already be present. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    const caller = 'XpbdParticleSourceConvexHullBarrierFamilyN.addToWorld';
    if (!(world instanceof XpbdWorldN)) {
      throw new Error(`${caller}: expected an XpbdWorldN`);
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `${caller}: family is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(`${caller}: family is already attached to another world`);
    }
    assertCurrentFamily(this, caller);
    for (const particle of this.particles) {
      const existing = world.particles.find((value) => value.id === particle.id);
      if (existing === undefined) {
        throw new Error(`${caller}: particle "${particle.id}" is not registered`);
      }
      if (existing !== particle) {
        throw new Error(
          `${caller}: particle id "${particle.id}" is owned by another object`
        );
      }
    }
    const existing = world.forceProviders.find((value) => value.id === this.id);
    if (existing !== undefined && existing !== this) {
      throw new Error(`${caller}: force provider id "${this.id}" is already owned`);
    }
    world.addForceProvider(this);
    this.attachedWorld = world;
    return world;
  }

  /** Compares the live selected coordinates against the compile-time snapshot. */
  assertSourceCurrent(caller: string): void {
    const dim = this.dimension;
    if (!this.obstacle.groups.includes(this.sourceGroup)) {
      throw new Error(`${caller}: obstacle source group was removed`);
    }
    if (this.obstacle.ambientDim !== dim) {
      throw new Error(`${caller}: obstacle ambient dimension changed`);
    }
    // O(selected coordinates): the hull is small, and following it silently
    // would turn a static contract into an undeclared moving-obstacle one.
    for (let slot = 0; slot < this.hullSourceVertices.length; slot++) {
      const vertex = this.hullSourceVertices[slot]!;
      if (vertex >= this.obstacle.vertexCount) {
        throw new Error(`${caller}: obstacle vertex layout changed`);
      }
      for (let axis = 0; axis < dim; axis++) {
        if (this.obstacle.positions[vertex * dim + axis] !==
          this.snapshot[slot * dim + axis]) {
          throw new Error(
            `${caller}: hull source coordinates changed after compilation; ` +
            'this family represents a static convex set'
          );
        }
      }
    }
  }

  /** The distance query itself, without the staleness check callers repeat. */
  private queryUnchecked(position: VecN): XpbdSourceConvexHullWitnessN & {
    readonly distance: number;
  } {
    const point = new ConvexHullSupportShapeN(this.dimension, position.data);
    const query = gjkDistance(point, this.hull, {
      maxIterations: this.maximumQueryIterations
    });
    if (query.status === 'iteration-limit') {
      throw new XpbdPotentialDomainErrorN<
        XpbdParticleSourceConvexHullBarrierDomainReasonN
      >(
        this.id,
        'closest-point-indeterminate',
        'XpbdParticleSourceConvexHullBarrierFamilyN: the distance query could ' +
        `not certify separation or intersection within ${this.maximumQueryIterations} iterations`
      );
    }
    const closestPoint = query.closestPointB.clone();
    const distance = query.distance;
    if (!Number.isFinite(distance)) {
      throw new Error(
        'XpbdParticleSourceConvexHullBarrierFamilyN: distance is outside Float64'
      );
    }
    // At zero distance there is no separation direction. The caller turns this
    // into the open-domain refusal; a fabricated normal would be worse.
    const separationNormal = distance > 0
      ? position.clone().sub(closestPoint).multiplyScalar(1 / distance)
      : new VecN(this.dimension);
    return {
      distance,
      closestPoint,
      separationNormal,
      query,
      sourceVertices: this.translateWitness(query)
    };
  }

  /** Maps packed hull slots back to authoritative obstacle vertex indices. */
  private translateWitness(query: GjkResult): readonly number[] {
    const vertices = new Set<number>();
    for (const vertex of query.simplex) {
      const slot = vertex.featureB;
      if (typeof slot !== 'number') continue;
      const source = this.hullSourceVertices[slot];
      if (source !== undefined) vertices.add(source);
    }
    return Object.freeze(Array.from(vertices).sort((a, b) => a - b));
  }
}

/**
 * Conservative segment filter paired with one convex-hull barrier family.
 *
 * Distance to a closed convex set is convex and 1-Lipschitz, which is the same
 * argument the point--simplex filter uses and it transfers unchanged: a segment
 * whose initial distance is non-decreasing is safe in full, and otherwise the
 * global Lipschitz bound certifies a strict prefix.
 *
 * `maximumStepLength` is a **certified prefix**, never an exact impact time.
 * This filter does not solve the closest-feature crossing.
 */
export class XpbdParticleSourceConvexHullBarrierFamilyStepFilterN
implements XpbdIncrementalPotentialStepFilterN {
  /** Stable authored filter identity. */
  readonly id: string;
  /** Ambient particle and hull dimension. */
  readonly dimension: number;
  /** Exact particles whose proposed segments are inspected. */
  readonly particles: readonly XpbdParticleN[];
  /** Paired barrier family. */
  readonly family: XpbdParticleSourceConvexHullBarrierFamilyN;

  /** Creates the one filter owned by a compiled family. */
  constructor(family: XpbdParticleSourceConvexHullBarrierFamilyN) {
    if (!(family instanceof XpbdParticleSourceConvexHullBarrierFamilyN)) {
      throw new Error(
        'XpbdParticleSourceConvexHullBarrierFamilyStepFilterN: family must be compiled'
      );
    }
    this.id = `${family.id}/step-filter`;
    this.dimension = family.dimension;
    this.particles = family.particles;
    this.family = family;
  }

  /** Certifies the complete segment or a conservative strict prefix. */
  evaluate(
    context: XpbdIncrementalPotentialStepFilterContextN
  ): XpbdParticleSourceConvexHullBarrierFamilyStepFilterEvaluationN {
    const caller = 'XpbdParticleSourceConvexHullBarrierFamilyStepFilterN.evaluate';
    validateStepContext(context, this.dimension, caller);
    assertCurrentFamily(this.family, caller);

    const certifications: XpbdParticleSourceConvexHullSegmentCertificationN[] = [];
    let maximumStepLength = context.requestedStepLength;
    let blockingSourceVertexIndex: number | null = null;
    let refusal: {
      index: number;
      reason: XpbdParticleSourceConvexHullBarrierFamilyStepFilterRefusalReasonN;
    } | null = null;

    for (let index = 0; index < this.particles.length; index++) {
      const particle = this.particles[index]!;
      const before = finitePosition(
        context.positionBefore(particle), this.dimension, `${caller}: positionBefore ${index}`
      );
      const after = finitePosition(
        context.positionAfter(particle), this.dimension, `${caller}: positionAfter ${index}`
      );

      let start: ReturnType<typeof this.family.queryPoint>;
      try {
        start = this.family.queryPoint(before);
      } catch (error) {
        if (error instanceof XpbdPotentialDomainErrorN &&
          error.reason === 'closest-point-indeterminate') {
          certifications.push(Object.freeze({
            sourceVertexIndex: index,
            startDistance: Number.NaN,
            startMargin: Number.NaN,
            pathLength: Number.NaN,
            startDirectionalDerivative: Number.NaN,
            certifiedFraction: 0,
            certification: 'closest-point-indeterminate'
          }));
          refusal ??= { index, reason: 'closest-point-indeterminate' };
          continue;
        }
        throw error;
      }

      const startMargin = start.distance - this.family.minimumDistance;
      const displacement = after.clone().sub(before);
      const pathLength = displacement.length();
      let startDirectionalDerivative = 0;
      if (start.distance > 0 && pathLength > 0) {
        startDirectionalDerivative =
          start.separationNormal.dot(displacement);
      }
      const common = {
        sourceVertexIndex: index,
        startDistance: start.distance,
        startMargin,
        pathLength,
        startDirectionalDerivative
      } as const;

      if (!(startMargin > 0)) {
        certifications.push(Object.freeze({
          ...common, certifiedFraction: 0,
          certification: 'initial-domain-violation'
        }));
        refusal ??= { index, reason: 'initial-domain-violation' };
        continue;
      }
      if (pathLength === 0) {
        certifications.push(Object.freeze({
          ...common, certifiedFraction: 1, certification: 'stationary'
        }));
        continue;
      }
      if (startDirectionalDerivative >= 0) {
        certifications.push(Object.freeze({
          ...common, certifiedFraction: 1, certification: 'convex-nondecreasing'
        }));
        continue;
      }
      if (pathLength < startMargin) {
        certifications.push(Object.freeze({
          ...common, certifiedFraction: 1, certification: 'global-lipschitz'
        }));
        continue;
      }
      const certifiedFraction =
        this.family.conservativeScale * startMargin / pathLength;
      const limited = context.requestedStepLength * certifiedFraction;
      if (!Number.isFinite(certifiedFraction) ||
        certifiedFraction < 0 || certifiedFraction >= 1 ||
        !Number.isFinite(limited) || limited < 0) {
        throw new Error(`${caller}: certified prefix is outside Float64`);
      }
      certifications.push(Object.freeze({
        ...common, certifiedFraction, certification: 'global-lipschitz'
      }));
      if (limited < maximumStepLength) {
        maximumStepLength = limited;
        blockingSourceVertexIndex = index;
      }
    }

    if (refusal !== null) {
      return Object.freeze({
        status: 'indeterminate',
        reason: refusal.reason,
        certifications: Object.freeze(certifications),
        blockingSourceVertexIndex: refusal.index
      });
    }
    const evidence = {
      certifications: Object.freeze(certifications),
      blockingSourceVertexIndex
    } as const;
    if (maximumStepLength < context.requestedStepLength) {
      return Object.freeze({ ...evidence, status: 'limited', maximumStepLength });
    }
    return Object.freeze({
      ...evidence, status: 'safe',
      maximumStepLength: context.requestedStepLength
    });
  }
}

/**
 * Compiles a dynamic point--static-convex-hull barrier family and its filter.
 *
 * The represented set is the convex hull of the obstacle vertices selected by
 * `sourceGroup` — **not** the union of that group's cells. Concavities between
 * the selected vertices are filled.
 *
 * Before the first construction, the contract in one breath: the geometry is
 * the **convex hull** of the selected vertices — not an arbitrary non-convex
 * mesh, and not the union of the group's cells, whose only role is selecting
 * vertices; the hull is **static** for the lifetime of the compiled family;
 * contact is **point-to-set** for the bound particles, not complete surface
 * contact; proximity to a lower-dimensional hull is **unsigned and two-sided**,
 * because such a set has no ambient inside; each particle gets **one closest
 * set point**, whose witness may rest on several source vertices; an undecided
 * distance query stays a typed `'closest-point-indeterminate'` refusal rather
 * than an answer; and the paired filter's prefix is a certificate, never an
 * impact time.
 *
 * @param options Provider identity, binding, obstacle, selection, and barrier scales.
 * @returns The compiled family, whose `stepFilter` must travel with it.
 *
 * @example
 * One probe particle above a flat two-cell support in R3. The barrier pushes
 * along the support normal, and the witness names the source vertices behind
 * the closest point:
 * ```ts
 * const obstacle = new CellComplex(3, Float64Array.from([
 *   0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0
 * ]), [{
 *   key: 'support', dim: 2, verticesPerCell: 3, kind: 'simplex',
 *   indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
 * }]);
 * const body = new CellComplex(3, Float64Array.from([0.4, 0.6, 0.5]), [{
 *   key: 'probe', dim: 0, verticesPerCell: 1, kind: 'simplex',
 *   indices: Uint32Array.from([0])
 * }]);
 * const binding = compileXpbdParticleBindingN({
 *   source: body, id: 'probe', mass: 1
 * });
 * const [supportGroup] = obstacle.groups;
 * if (supportGroup === undefined) throw new Error('no support group');
 * const family = compileXpbdParticleSourceConvexHullBarrierFamilyN({
 *   id: 'hull-contact',
 *   binding,
 *   obstacle,
 *   sourceGroup: supportGroup,
 *   minimumDistance: 0.05,
 *   activationDistance: 0.8,
 *   stiffness: 2
 * });
 *
 * const evaluation = family.evaluate();
 * evaluation.diagnostics.setQueries;    // 1 — one query per particle
 * evaluation.activeBarriers.length;     // 1
 * for (const record of evaluation.activeBarriers) {
 *   record.distance;                    // 0.5 — the probe's height
 *   record.witness.sourceVertices;      // vertices behind the answer
 * }
 * for (const force of evaluation.forces) {
 *   (force.data[2] ?? 0) > 0;                    // true — pushed along +z
 *   Math.abs(force.data[0] ?? 0) < 1e-12;        // true — no lateral push
 * }
 * ```
 */
export function compileXpbdParticleSourceConvexHullBarrierFamilyN(
  options: CompileXpbdParticleSourceConvexHullBarrierFamilyNOptions
): XpbdParticleSourceConvexHullBarrierFamilyN {
  return XpbdParticleSourceConvexHullBarrierFamilyN.compile(options);
}

function validateCompilerInput(
  options: CompileXpbdParticleSourceConvexHullBarrierFamilyNOptions
): {
  readonly hullSourceVertices: readonly number[];
  readonly snapshot: Float64Array;
  readonly minimumDistance: number;
  readonly conservativeScale: number;
  readonly maximumQueryIterations: number;
} {
  const caller = 'compileXpbdParticleSourceConvexHullBarrierFamilyN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  const allowed = [
    'id', 'binding', 'obstacle', 'sourceGroup', 'minimumDistance',
    'activationDistance', 'stiffness', 'conservativeScale',
    'maximumQueryIterations'
  ];
  const unknown = Object.keys(options).filter((key) => !allowed.includes(key));
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
  if (!(options.obstacle instanceof CellComplex)) {
    throw new Error(`${caller}: obstacle must be a CellComplex`);
  }
  if (options.obstacle === options.binding.source) {
    throw new Error(
      `${caller}: obstacle must be separate from the dynamic source; ` +
      'moving--moving and self-contact are not implemented'
    );
  }
  if (options.obstacle.ambientDim !== options.binding.dimension) {
    throw new Error(
      `${caller}: binding is R${options.binding.dimension}, ` +
      `obstacle is R${options.obstacle.ambientDim}`
    );
  }
  const group = options.sourceGroup;
  if (!options.obstacle.groups.includes(group)) {
    throw new Error(`${caller}: sourceGroup must belong to obstacle`);
  }
  if (!Number.isSafeInteger(group.verticesPerCell) ||
    group.verticesPerCell < 1 || group.indices.length === 0 ||
    group.indices.length % group.verticesPerCell !== 0) {
    throw new Error(`${caller}: sourceGroup must contain complete non-empty cells`);
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
  if (!Number.isFinite(options.stiffness) || !(options.stiffness > 0)) {
    throw new Error(`${caller}: stiffness must be finite and positive`);
  }
  const conservativeScale = options.conservativeScale ?? 0.9;
  if (!Number.isFinite(conservativeScale) ||
    conservativeScale <= 0 || conservativeScale >= 1) {
    throw new Error(`${caller}: conservativeScale must be in (0, 1)`);
  }
  const maximumQueryIterations = options.maximumQueryIterations ?? 32;
  if (!Number.isSafeInteger(maximumQueryIterations) ||
    maximumQueryIterations < 1) {
    throw new Error(
      `${caller}: maximumQueryIterations must be a positive safe integer`
    );
  }

  const dim = options.obstacle.ambientDim;
  const hullSourceVertices = Array.from(new Set(Array.from(group.indices)))
    .sort((a, b) => a - b);
  for (const vertex of hullSourceVertices) {
    if (!Number.isSafeInteger(vertex) || vertex < 0 ||
      vertex >= options.obstacle.vertexCount) {
      throw new Error(`${caller}: sourceGroup references vertex ${vertex} out of range`);
    }
  }
  const snapshot = new Float64Array(hullSourceVertices.length * dim);
  hullSourceVertices.forEach((vertex, slot) => {
    for (let axis = 0; axis < dim; axis++) {
      const value = options.obstacle.positions[vertex * dim + axis]!;
      if (!Number.isFinite(value)) {
        throw new Error(`${caller}: hull source coordinates must be finite`);
      }
      snapshot[slot * dim + axis] = value;
    }
  });
  // Two selected vertices at the same coordinates would make the support tie
  // ambiguous, and a returned witness would name one of them for no stated
  // reason. Refuse deliberately rather than pick.
  const seen = new Map<string, number>();
  hullSourceVertices.forEach((vertex, slot) => {
    const key = Array.from(
      snapshot.subarray(slot * dim, (slot + 1) * dim)
    ).join(',');
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new Error(
        `${caller}: obstacle vertices ${previous} and ${vertex} are coincident; ` +
        'a coincident hull vertex has no unique source witness'
      );
    }
    seen.set(key, vertex);
  });

  assertCurrentBinding(options.binding, caller);
  return {
    hullSourceVertices,
    snapshot,
    minimumDistance,
    conservativeScale,
    maximumQueryIterations
  };
}

function assertCurrentFamily(
  family: XpbdParticleSourceConvexHullBarrierFamilyN,
  caller: string
): void {
  assertCurrentBinding(family.binding, caller);
  family.assertSourceCurrent(caller);
}

function assertCurrentBinding(binding: XpbdParticleBindingN, caller: string): void {
  if (binding.source.ambientDim !== binding.dimension ||
    binding.source.vertexCount !== binding.particles.length ||
    binding.vertices.length !== binding.particles.length) {
    throw new Error(`${caller}: dynamic source vertex layout changed`);
  }
  for (let index = 0; index < binding.particles.length; index++) {
    if (binding.vertices[index]!.sourceVertexIndex !== index ||
      binding.vertices[index]!.particle !== binding.particles[index] ||
      binding.particles[index]!.dimension !== binding.dimension) {
      throw new Error(`${caller}: dynamic source-particle lineage changed`);
    }
  }
}

function validateStepContext(
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
    throw new Error(`${caller}: requestedStepLength must be finite and positive`);
  }
  if (typeof context.positionBefore !== 'function' ||
    typeof context.positionAfter !== 'function') {
    throw new Error(`${caller}: position lookups must be functions`);
  }
}

function finitePosition(value: VecN, dimension: number, label: string): VecN {
  if (!(value instanceof VecN) || value.dim !== dimension) {
    throw new Error(`${label} must be an R${dimension} VecN`);
  }
  for (const coordinate of value.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(`${label} must contain finite coordinates`);
    }
  }
  return value.clone();
}
