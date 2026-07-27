import { CellComplex, VecN } from '@holotope/core';
import {
  XpbdParticleHyperplaneBarrierN
} from './xpbd-hyperplane-barrier.js';
import {
  XpbdParticleHyperplaneFamilyN,
  type XpbdParticleHyperplaneFamilyContactN
} from './xpbd-hyperplane-contact.js';
import {
  XpbdParticleHyperplaneBarrierStepFilterN,
  type XpbdIncrementalPotentialStepFilterN
} from './xpbd-incremental-potential-step-filter.js';
import {
  XpbdParticleN,
  XpbdWorldN,
  type XpbdConservativeForceProviderN
} from './xpbd-world.js';

/** Source-vertex evidence supplied to one barrier-family scalar policy. */
export interface XpbdParticleHyperplaneBarrierFamilyVertexContextN {
  /** Source vertex ordinal and particle-binding index. */
  readonly sourceVertexIndex: number;
  /** Defensive compile-time source-position copy. */
  readonly sourcePosition: VecN;
  /** Compile-time signed distance from the oriented plane. */
  readonly sourceSignedDistance: number;
  /** Open barrier boundary inherited from contact clearance. */
  readonly minimumDistance: number;
  /** `sourceSignedDistance - minimumDistance` at family compilation. */
  readonly sourceMargin: number;
}

/** Uniform or source-vertex scalar policy for a barrier family. */
export type XpbdParticleHyperplaneBarrierFamilyVertexScalarN =
  | number
  | ((
    vertex: XpbdParticleHyperplaneBarrierFamilyVertexContextN
  ) => number);

/** Construction options for a source-indexed point–plane barrier family. */
export interface CompileXpbdParticleHyperplaneBarrierFamilyNOptions {
  /** Stable family identity used as the prefix of compiled term IDs. */
  readonly id: string;
  /** Authoritative source-vertex, particle, plane, and clearance mapping. */
  readonly contacts: XpbdParticleHyperplaneFamilyN;
  /** Signed distance above which barrier energy is exactly zero. */
  readonly activationDistance:
    XpbdParticleHyperplaneBarrierFamilyVertexScalarN;
  /** Positive energy multiplier. */
  readonly stiffness: XpbdParticleHyperplaneBarrierFamilyVertexScalarN;
  /** Exact-impact fraction retained by each step filter; default `0.9`. */
  readonly conservativeScale?:
    XpbdParticleHyperplaneBarrierFamilyVertexScalarN;
}

/** One source vertex paired with its conservative and admissible-step terms. */
export interface XpbdParticleHyperplaneBarrierFamilyVertexN {
  /** Source vertex ordinal and particle-binding index. */
  readonly sourceVertexIndex: number;
  /** Defensive compile-time source-position copy. */
  readonly sourcePosition: VecN;
  /** Compile-time signed distance from the oriented plane. */
  readonly sourceSignedDistance: number;
  /** Open barrier boundary inherited from contact clearance. */
  readonly minimumDistance: number;
  /** Compile-time distance above the open barrier boundary. */
  readonly sourceMargin: number;
  /** Exact normal-contact provenance record reused by this vertex. */
  readonly normalContact: XpbdParticleHyperplaneFamilyContactN;
  /** Exact live particle mapped from the source vertex. */
  readonly particle: XpbdParticleN;
  /** Signed distance above which barrier energy is exactly zero. */
  readonly activationDistance: number;
  /** Positive energy multiplier. */
  readonly stiffness: number;
  /** Exact-impact fraction retained by the paired filter. */
  readonly conservativeScale: number;
  /** Conservative point–plane potential provider. */
  readonly barrier: XpbdParticleHyperplaneBarrierN;
  /** Exact affine point–plane admissible-step filter. */
  readonly stepFilter: XpbdParticleHyperplaneBarrierStepFilterN;
}

/** Paired terms accepted by an incremental-potential problem or step. */
export interface XpbdParticleHyperplaneBarrierFamilyTermsN {
  /** Source-ordered conservative barrier providers. */
  readonly providers: readonly XpbdConservativeForceProviderN[];
  /** Source-ordered filters paired one-to-one with the providers. */
  readonly stepFilters: readonly XpbdIncrementalPotentialStepFilterN[];
}

/**
 * Source-vertex-indexed RN point–static-hyperplane barrier assembly.
 *
 * The family reuses an existing normal-contact family's exact source,
 * particle, plane, and clearance mapping. It compiles one conservative
 * provider and one collision-free step filter per source vertex.
 *
 * Authoring a barrier without the filter that certifies its steps is the
 * mistake this exists to prevent: at one vertex the two are written
 * together, and at many they are compiled together, one pair per source
 * vertex, so the counts cannot drift apart.
 *
 * The normal-contact family stays authoritative for which particle answers
 * to which source vertex — this compiles energy terms over that mapping
 * rather than restating it, and `addToWorld` registers only the conservative
 * providers, leaving the projection constraints independent.
 *
 * @example
 * Four points held above the floor `y = 0`. Compiling yields one barrier
 * and one filter per source vertex, in source order, with identities
 * derived from the family's own:
 * ```ts
 * const heights = [0.5, 0.3, 0.8, 0.2];
 * const source = new CellComplex(
 *   3,
 *   new Float64Array(heights.flatMap((y, i) => [i, y, 0])),
 *   []
 * );
 * const particles = heights.map(
 *   (y, i) => new XpbdParticleN({ id: `v${i}`, position: new VecN([i, y, 0]) })
 * );
 * const contacts = compileXpbdParticleHyperplaneFamilyN({
 *   id: 'floor-contacts',
 *   source,
 *   particles,
 *   plane: new HyperplaneColliderN(new VecN([0, 1, 0]), 0)
 * });
 *
 * const family = compileXpbdParticleHyperplaneBarrierFamilyN({
 *   id: 'floor-barriers', contacts, activationDistance: 0.1, stiffness: 1
 * });
 *
 * family.vertices.length; // 4
 * family.vertices.map((v) => v.barrier.id);
 * // ['floor-barriers/vertex/0/barrier', … one per source vertex]
 * ```
 *
 * @example
 * `activationDistance`, `stiffness`, and `conservativeScale` each accept a
 * function of the source vertex, so a policy can depend on where a vertex
 * started. Here the vertices that begin nearest the plane are stiffened:
 * ```ts
 * const heights = [0.5, 0.3, 0.8, 0.2];
 * const source = new CellComplex(
 *   3,
 *   new Float64Array(heights.flatMap((y, i) => [i, y, 0])),
 *   []
 * );
 * const particles = heights.map(
 *   (y, i) => new XpbdParticleN({ id: `v${i}`, position: new VecN([i, y, 0]) })
 * );
 * const contacts = compileXpbdParticleHyperplaneFamilyN({
 *   id: 'floor-contacts',
 *   source,
 *   particles,
 *   plane: new HyperplaneColliderN(new VecN([0, 1, 0]), 0)
 * });
 *
 * const family = compileXpbdParticleHyperplaneBarrierFamilyN({
 *   id: 'floor-barriers',
 *   contacts,
 *   activationDistance: 0.1,
 *   stiffness: (vertex) => 1 / vertex.sourceSignedDistance
 * });
 *
 * family.vertices.map((v) => v.barrier.stiffness); // [2, 3.33…, 1.25, 5]
 * ```
 *
 * @example
 * The compiled terms append after terms already assembled, and the array
 * passed in is left alone — so several families can contribute to one
 * search without any of them owning the list:
 * ```ts
 * const heights = [0.5, 0.3, 0.8, 0.2];
 * const source = new CellComplex(
 *   3,
 *   new Float64Array(heights.flatMap((y, i) => [i, y, 0])),
 *   []
 * );
 * const particles = heights.map(
 *   (y, i) => new XpbdParticleN({ id: `v${i}`, position: new VecN([i, y, 0]) })
 * );
 * const contacts = compileXpbdParticleHyperplaneFamilyN({
 *   id: 'floor-contacts',
 *   source,
 *   particles,
 *   plane: new HyperplaneColliderN(new VecN([0, 1, 0]), 0)
 * });
 * const family = compileXpbdParticleHyperplaneBarrierFamilyN({
 *   id: 'floor-barriers', contacts, activationDistance: 0.1, stiffness: 1
 * });
 *
 * const base = { providers: [], stepFilters: [] };
 * const combined = family.incrementalPotentialTerms(base);
 *
 * combined.providers.length; // 4
 * combined.stepFilters.length; // 4 — one per provider, always
 * base.providers.length; // 0 — the input is not mutated
 * ```
 */
export class XpbdParticleHyperplaneBarrierFamilyN {
  /** Stable authored family identity. */
  readonly id: string;
  /** Ambient source, particle, and plane dimension. */
  readonly dimension: number;
  /** Authoritative source complex retained by the normal family. */
  readonly source: CellComplex;
  /** Geometric and provenance definition shared with contact response. */
  readonly normalFamily: XpbdParticleHyperplaneFamilyN;
  /** Exact particles in source-vertex order. */
  readonly particles: readonly XpbdParticleN[];
  /** Complete per-vertex barrier/filter records. */
  readonly vertices: readonly XpbdParticleHyperplaneBarrierFamilyVertexN[];
  /** Conservative providers in source-vertex order. */
  readonly barriers: readonly XpbdParticleHyperplaneBarrierN[];
  /** Admissible-step filters paired with `barriers`. */
  readonly stepFilters:
    readonly XpbdParticleHyperplaneBarrierStepFilterN[];
  private readonly terms: XpbdParticleHyperplaneBarrierFamilyTermsN;
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    id: string,
    normalFamily: XpbdParticleHyperplaneFamilyN,
    vertices: readonly XpbdParticleHyperplaneBarrierFamilyVertexN[]
  ) {
    this.id = id;
    this.dimension = normalFamily.dimension;
    this.source = normalFamily.source;
    this.normalFamily = normalFamily;
    this.particles = normalFamily.particles;
    this.vertices = Object.freeze(vertices.slice());
    this.barriers = Object.freeze(
      vertices.map((vertex) => vertex.barrier)
    );
    this.stepFilters = Object.freeze(
      vertices.map((vertex) => vertex.stepFilter)
    );
    this.terms = Object.freeze({
      providers: this.barriers,
      stepFilters: this.stepFilters
    });
  }

  /**
   * Compiles one paired barrier/filter record per normal-family source vertex.
   *
   * @param options Normal family and per-vertex barrier policies.
   */
  static compile(
    options: CompileXpbdParticleHyperplaneBarrierFamilyNOptions
  ): XpbdParticleHyperplaneBarrierFamilyN {
    validateCompilerInput(options);
    return new XpbdParticleHyperplaneBarrierFamilyN(
      options.id,
      options.contacts,
      compileVertices(options)
    );
  }

  /**
   * Returns the frozen provider/filter pair for direct option spreading.
   *
   * Optional base terms are preserved first, so material providers and
   * multiple barrier families can be composed without mutating their arrays.
   * The source layout is revalidated before exposing the terms.
   */
  incrementalPotentialTerms(
    base?: XpbdParticleHyperplaneBarrierFamilyTermsN
  ):
    XpbdParticleHyperplaneBarrierFamilyTermsN {
    const caller =
      'XpbdParticleHyperplaneBarrierFamilyN.incrementalPotentialTerms';
    validateCurrentLayout(
      this.normalFamily,
      caller
    );
    if (base === undefined) return this.terms;
    if (typeof base !== 'object' || base === null ||
      !Array.isArray(base.providers) ||
      !Array.isArray(base.stepFilters)) {
      throw new Error(`${caller}: base terms must contain provider/filter arrays`);
    }
    return Object.freeze({
      providers: Object.freeze([...base.providers, ...this.barriers]),
      stepFilters: Object.freeze([...base.stepFilters, ...this.stepFilters])
    });
  }

  /**
   * Registers only conservative barrier providers in an RN point world.
   *
   * Particles must already be registered. Normal projection constraints remain
   * an independent policy and are not added by this method.
   */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    const caller = 'XpbdParticleHyperplaneBarrierFamilyN.addToWorld';
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
    validateCurrentLayout(this.normalFamily, caller);
    preflightWorldIdentity(world, this.particles, this.barriers, caller);
    for (const barrier of this.barriers) world.addForceProvider(barrier);
    this.attachedWorld = world;
    return world;
  }
}

/** Compiles paired barrier and admissible-step terms over source vertices. */
export function compileXpbdParticleHyperplaneBarrierFamilyN(
  options: CompileXpbdParticleHyperplaneBarrierFamilyNOptions
): XpbdParticleHyperplaneBarrierFamilyN {
  return XpbdParticleHyperplaneBarrierFamilyN.compile(options);
}

function validateCompilerInput(
  options: CompileXpbdParticleHyperplaneBarrierFamilyNOptions
): void {
  const caller = 'compileXpbdParticleHyperplaneBarrierFamilyN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  if (typeof options.id !== 'string' || options.id.trim().length === 0) {
    throw new Error(`${caller}: id must be a non-empty string`);
  }
  if (!(options.contacts instanceof XpbdParticleHyperplaneFamilyN)) {
    throw new Error(
      `${caller}: contacts must be an XpbdParticleHyperplaneFamilyN`
    );
  }
  validateCurrentLayout(options.contacts, caller);
}

function compileVertices(
  options: CompileXpbdParticleHyperplaneBarrierFamilyNOptions
): XpbdParticleHyperplaneBarrierFamilyVertexN[] {
  return options.contacts.contacts.map((normalContact) => {
    const context = (): XpbdParticleHyperplaneBarrierFamilyVertexContextN =>
      Object.freeze({
        sourceVertexIndex: normalContact.sourceVertexIndex,
        sourcePosition: normalContact.sourcePosition.clone(),
        sourceSignedDistance: normalContact.sourceSignedDistance,
        minimumDistance: normalContact.clearance,
        sourceMargin: normalContact.sourceGap
      });
    const activationDistance = vertexScalar(
      options.activationDistance,
      context(),
      'activationDistance'
    );
    if (!(activationDistance > normalContact.clearance)) {
      throw new Error(
        'compileXpbdParticleHyperplaneBarrierFamilyN: activationDistance ' +
        'must be greater than minimumDistance'
      );
    }
    const stiffness = vertexScalar(
      options.stiffness,
      context(),
      'stiffness'
    );
    if (!(stiffness > 0)) {
      throw new Error(
        'compileXpbdParticleHyperplaneBarrierFamilyN: stiffness must be positive'
      );
    }
    const conservativeScale = options.conservativeScale === undefined
      ? 0.9
      : vertexScalar(
        options.conservativeScale,
        context(),
        'conservativeScale'
      );
    if (!(conservativeScale > 0 && conservativeScale < 1)) {
      throw new Error(
        'compileXpbdParticleHyperplaneBarrierFamilyN: conservativeScale ' +
        'must be in (0, 1)'
      );
    }
    const sourceVertexIndex = normalContact.sourceVertexIndex;
    const barrier = new XpbdParticleHyperplaneBarrierN({
      id: `${options.id}/vertex/${sourceVertexIndex}/barrier`,
      particle: normalContact.particle,
      plane: options.contacts.plane,
      minimumDistance: normalContact.clearance,
      activationDistance,
      stiffness
    });
    const stepFilter = new XpbdParticleHyperplaneBarrierStepFilterN({
      id: `${options.id}/vertex/${sourceVertexIndex}/step-filter`,
      barrier,
      conservativeScale
    });
    return Object.freeze({
      ...context(),
      normalContact,
      particle: normalContact.particle,
      activationDistance,
      stiffness,
      conservativeScale,
      barrier,
      stepFilter
    });
  });
}

function vertexScalar(
  policy: XpbdParticleHyperplaneBarrierFamilyVertexScalarN,
  context: XpbdParticleHyperplaneBarrierFamilyVertexContextN,
  label: string
): number {
  const value = typeof policy === 'function' ? policy(context) : policy;
  if (!Number.isFinite(value)) {
    throw new Error(
      `compileXpbdParticleHyperplaneBarrierFamilyN: ${label} must be finite`
    );
  }
  return value;
}

function validateCurrentLayout(
  normalFamily: XpbdParticleHyperplaneFamilyN,
  caller: string
): void {
  if (normalFamily.source.ambientDim !== normalFamily.dimension ||
    normalFamily.source.vertexCount !== normalFamily.particles.length ||
    normalFamily.source.positions.length !==
      normalFamily.particles.length * normalFamily.dimension ||
    normalFamily.contacts.length !== normalFamily.particles.length) {
    throw new Error(`${caller}: source vertex layout changed`);
  }
  for (let index = 0; index < normalFamily.particles.length; index++) {
    const particle = normalFamily.particles[index]!;
    const contact = normalFamily.contacts[index]!;
    if (contact.sourceVertexIndex !== index ||
      contact.particle !== particle ||
      contact.constraint.points[0] !== particle) {
      throw new Error(`${caller}: source-particle lineage changed`);
    }
    if (particle.dimension !== normalFamily.dimension) {
      throw new Error(`${caller}: particle ${index} dimension changed`);
    }
  }
}

function preflightWorldIdentity(
  world: XpbdWorldN,
  particles: readonly XpbdParticleN[],
  barriers: readonly XpbdParticleHyperplaneBarrierN[],
  caller: string
): void {
  for (const particle of particles) {
    const existing = world.particles.find(
      (candidate) => candidate.id === particle.id
    );
    if (existing === undefined) {
      throw new Error(
        `${caller}: particle "${particle.id}" is not registered`
      );
    }
    if (existing !== particle) {
      throw new Error(
        `${caller}: particle id "${particle.id}" is owned by another object`
      );
    }
  }
  for (const barrier of barriers) {
    const existing = world.forceProviders.find(
      (candidate) => candidate.id === barrier.id
    );
    if (existing !== undefined && existing !== barrier) {
      throw new Error(
        `${caller}: force provider id "${barrier.id}" is already owned`
      );
    }
  }
}
