import {
  CellComplex,
  VecN,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  inspectSourceSimplexReferenceN,
  type CellGroup,
  type SourceSimplexReferenceN
} from '@holotope/core';
import {
  type XpbdIncrementalPotentialStepFilterContextN,
  type XpbdIncrementalPotentialStepFilterN
} from './xpbd-incremental-potential-step-filter.js';
import { XpbdParticleBindingN } from './xpbd-particle-binding.js';
import {
  XpbdSourceSimplexAabbHierarchyN,
  xpbdSourceSimplexBoundsN,
  xpbdSourceSimplexBoundsOverlapN,
  xpbdSweptPointBoundsN,
  type XpbdSourceSimplexAabbQueryDiagnosticsN,
  type XpbdSourceSimplexBoundsN
} from './xpbd-source-simplex-aabb-hierarchy.js';
import {
  XpbdParticleSourceSimplexBarrierN,
  XpbdParticleSourceSimplexBarrierStepFilterN,
  type XpbdParticleSourceSimplexBarrierEvaluationN,
  type XpbdParticleSourceSimplexBarrierStepFilterEvaluationN
} from './xpbd-source-simplex-barrier.js';
import {
  XpbdParticleN,
  XpbdWorldN,
  type XpbdConservativeForceProviderEvaluationN,
  type XpbdConservativeForceProviderN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

/** One stable source-vertex--obstacle-simplex candidate identity. */
export interface XpbdParticleSourceSimplexCandidateN {
  /** Family-scoped stable identity for this source-feature pair. */
  readonly id: string;
  /** Dynamic source vertex whose bound particle supplies the point. */
  readonly sourceVertexIndex: number;
  /** Exact live particle bound to `sourceVertexIndex`. */
  readonly particle: XpbdParticleN;
  /** Obstacle cell ordinal within the compiled simplex group. */
  readonly obstacleCellIndex: number;
  /** Persistent finite obstacle simplex. */
  readonly simplex: SourceSimplexReferenceN;
}

/** How one candidate query was organized, and what it cost. */
export interface XpbdParticleSourceSimplexCandidateDiagnosticsN {
  /**
   * Rejection rule and search organization.
   *
   * `'exhaustive-swept-aabb'` remains the default and the correctness oracle.
   * `'hierarchical-swept-aabb'` applies the identical inclusive AABB rule to
   * the identical per-simplex bounds, reached through a compiled static
   * hierarchy instead of a full scan.
   */
  readonly provider: 'exhaustive-swept-aabb' | 'hierarchical-swept-aabb';
  /** The selected search strategy, stated separately from the rejection rule. */
  readonly strategy: 'exhaustive' | 'static-aabb-hierarchy';
  /** Dynamic source vertices considered. */
  readonly sourceVertexCount: number;
  /** Static obstacle simplices considered. */
  readonly obstacleSimplexCount: number;
  /** Complete bipartite pair count before rejection. */
  readonly possiblePairs: number;
  /** Pairs retained by conservative coordinate-interval overlap. */
  readonly candidatePairs: number;
  /** Pairs proven unable to enter the activation envelope. */
  readonly rejectedPairs: number;
  /** Coordinate interval comparisons performed before early exits. */
  readonly axisTests: number;
  /**
   * Per-query hierarchy work, summed over dynamic vertices.
   *
   * Absent under the exhaustive default, where no hierarchy ran. Present
   * counts are operations, never times.
   */
  readonly hierarchy?: XpbdSourceSimplexAabbQueryDiagnosticsN;
}

/** Immutable candidate set valid only for the point or segment queried. */
export interface XpbdParticleSourceSimplexCandidateQueryN {
  /** Whether the bounds enclose one point or one complete linear segment. */
  readonly scope: 'point' | 'segment';
  /** Activation distance used to expand every point bound. */
  readonly activationDistance: number;
  /** Source-ordered candidates; identity remains stable across queries. */
  readonly candidates: readonly XpbdParticleSourceSimplexCandidateN[];
  /** Auditable reduction counts. */
  readonly diagnostics: XpbdParticleSourceSimplexCandidateDiagnosticsN;
}

/** Construction options for one dynamic point--static-simplex barrier family. */
export interface CompileXpbdParticleSourceSimplexBarrierFamilyNOptions {
  /** Stable provider identity and candidate-ID prefix. */
  readonly id: string;
  /** One live particle per authoritative dynamic source vertex. */
  readonly binding: XpbdParticleBindingN;
  /** Separate static obstacle complex supplying finite simplices. */
  readonly obstacle: CellComplex;
  /** Non-empty simplex group belonging to `obstacle`. */
  readonly simplexGroup: CellGroup;
  /** Open unsigned-distance boundary. Default zero. */
  readonly minimumDistance?: number;
  /** Distance at and above which every pair energy is zero. */
  readonly activationDistance: number;
  /** Positive energy scale shared by active pairs. */
  readonly stiffness: number;
  /** Fraction of each certified Lipschitz prefix retained. Default `0.9`. */
  readonly conservativeScale?: number;
  /** Scale-relative closest-simplex tolerance. Default `1e-9`. */
  readonly projectionTolerance?: number;
  /** Relative affine-rank tolerance. Default `1e-10`. */
  readonly rankTolerance?: number;
  /** Bound on exact active-face candidates per simplex query. Default `262143`. */
  readonly maxCandidateFaces?: number;
  /**
   * Optional precompiled static hierarchy over the same obstacle and group.
   *
   * Omitting it keeps the exhaustive scan, which stays the default and the
   * oracle. When supplied it must index the exact `obstacle` and
   * `simplexGroup` objects this family indexes — a structurally identical
   * hierarchy over a different source is not interchangeable, because the
   * bounds it cached describe different coordinates.
   *
   * There is no `'fast'` string and no size threshold. A hierarchy is a thing
   * the caller compiled and can inspect, not a mode the library picks.
   */
  readonly candidateHierarchy?: XpbdSourceSimplexAabbHierarchyN;
}

/** One active pair's finite-distance barrier evidence. */
export interface XpbdParticleSourceSimplexActiveCandidateN {
  /** Source-retained feature-pair identity. */
  readonly candidate: XpbdParticleSourceSimplexCandidateN;
  /** P44 finite-distance energy, force, and closest barycentric coordinate. */
  readonly evaluation: XpbdParticleSourceSimplexBarrierEvaluationN;
}

/** Aggregate conservative evaluation over only point-query-active pairs. */
export interface XpbdParticleSourceSimplexBarrierFamilyEvaluationN
  extends XpbdConservativeForceProviderEvaluationN {
  /** Conservative point query used before exact distance evaluation. */
  readonly candidateQuery: XpbdParticleSourceSimplexCandidateQueryN;
  /** Pairs whose exact distance is below the activation distance. */
  readonly activeCandidates: readonly XpbdParticleSourceSimplexActiveCandidateN[];
  /** One accumulated force per bound source vertex. */
  readonly forces: readonly VecN[];
}

/** One segment candidate paired with its P44 admissible-prefix evidence. */
export interface XpbdParticleSourceSimplexSegmentCandidateN {
  /** Source-retained feature-pair identity. */
  readonly candidate: XpbdParticleSourceSimplexCandidateN;
  /** Safe, limited, or explicitly refused finite-simplex certification. */
  readonly evaluation: XpbdParticleSourceSimplexBarrierStepFilterEvaluationN;
}

/** Why an aggregate point--simplex segment query refused certification. */
export type XpbdParticleSourceSimplexBarrierFamilyStepFilterRefusalReasonN =
  'candidate-initial-domain-violation';

/** Aggregate candidate and certification evidence for one proposed segment. */
export type XpbdParticleSourceSimplexBarrierFamilyStepFilterEvaluationN = {
  /** Conservative candidate set for this exact proposed segment. */
  readonly candidateQuery: XpbdParticleSourceSimplexCandidateQueryN;
  /** Per-candidate finite-simplex certifications in stable source order. */
  readonly candidates: readonly XpbdParticleSourceSimplexSegmentCandidateN[];
  /** Pair imposing the aggregate limit or refusal, otherwise `null`. */
  readonly blockingCandidateId: string | null;
} & (
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
      XpbdParticleSourceSimplexBarrierFamilyStepFilterRefusalReasonN;
  }
);

/** Provider/filter pair accepted by an incremental-potential problem. */
export interface XpbdParticleSourceSimplexBarrierFamilyTermsN {
  /** Existing providers followed by this dynamic family provider. */
  readonly providers: readonly XpbdConservativeForceProviderN[];
  /** Existing filters followed by this family's candidate-aware filter. */
  readonly stepFilters: readonly XpbdIncrementalPotentialStepFilterN[];
}

interface PositionSnapshotN {
  readonly before: readonly VecN[];
  readonly after: readonly VecN[];
}

interface CandidateQueryInternalN {
  readonly query: XpbdParticleSourceSimplexCandidateQueryN;
  readonly positions: PositionSnapshotN;
}

/**
 * Source-indexed RN barriers from dynamic points to a static simplex mesh.
 *
 * The family keeps one authoritative particle binding and persistent obstacle
 * simplex references. At each evaluation it visits the complete bipartite
 * source-feature space, rejects pairs only by a conservative coordinate-bound
 * proof, and instantiates P44 barriers only for the retained candidates. The
 * paired step filter repeats that query over the complete proposed segment.
 *
 * This is a deterministic Float64 reference active set, not a spatial tree.
 * Candidate sets are scoped to the point or segment named by their query and
 * must not be cached across changed coordinates. The obstacle is one-sided
 * and static during a solve; moving--moving and mesh self-contact are outside
 * this contract.
 */
export class XpbdParticleSourceSimplexBarrierFamilyN
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
  /** Compiled obstacle simplex group. */
  readonly simplexGroup: CellGroup;
  /** Persistent obstacle simplices in group-cell order. */
  readonly simplices: readonly SourceSimplexReferenceN[];
  /** Open unsigned-distance boundary. */
  readonly minimumDistance: number;
  /** Exact-zero barrier boundary and candidate-envelope padding. */
  readonly activationDistance: number;
  /** Positive energy scale shared by pair barriers. */
  readonly stiffness: number;
  /** Closest-simplex solve tolerance. */
  readonly projectionTolerance: number;
  /** Affine-rank tolerance. */
  readonly rankTolerance: number;
  /** Exact active-face enumeration bound. */
  readonly maxCandidateFaces: number;
  /** Strict prefix scale shared by pair filters. */
  readonly conservativeScale: number;
  /**
   * Selected static hierarchy, or `null` for the exhaustive default.
   *
   * Public so the chosen strategy is inspectable from the family itself, not
   * only from a query it happened to run.
   */
  readonly candidateHierarchy: XpbdSourceSimplexAabbHierarchyN | null;
  /** Candidate-aware admissible-segment filter paired with this provider. */
  readonly stepFilter: XpbdParticleSourceSimplexBarrierFamilyStepFilterN;
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    options: CompileXpbdParticleSourceSimplexBarrierFamilyNOptions,
    simplices: readonly SourceSimplexReferenceN[],
    minimumDistance: number,
    projectionTolerance: number,
    rankTolerance: number,
    maxCandidateFaces: number,
    conservativeScale: number
  ) {
    this.id = options.id;
    this.dimension = options.binding.dimension;
    this.binding = options.binding;
    this.particles = options.binding.particles;
    this.obstacle = options.obstacle;
    this.simplexGroup = options.simplexGroup;
    this.simplices = Object.freeze(simplices.slice());
    this.minimumDistance = minimumDistance;
    this.activationDistance = options.activationDistance;
    this.stiffness = options.stiffness;
    this.projectionTolerance = projectionTolerance;
    this.rankTolerance = rankTolerance;
    this.maxCandidateFaces = maxCandidateFaces;
    this.conservativeScale = conservativeScale;
    this.candidateHierarchy = options.candidateHierarchy ?? null;
    this.stepFilter = new XpbdParticleSourceSimplexBarrierFamilyStepFilterN(this);
  }

  /** Compiles persistent source identities and the paired segment filter. */
  static compile(
    options: CompileXpbdParticleSourceSimplexBarrierFamilyNOptions
  ): XpbdParticleSourceSimplexBarrierFamilyN {
    const validated = validateCompilerInput(options);
    return new XpbdParticleSourceSimplexBarrierFamilyN(
      options,
      compileSimplexReferences(options.obstacle, options.simplexGroup),
      validated.minimumDistance,
      validated.projectionTolerance,
      validated.rankTolerance,
      validated.maxCandidateFaces,
      validated.conservativeScale
    );
  }

  /** Queries candidates at one particle-space state without evaluating energy. */
  queryAt(
    positionOf: XpbdParticlePositionQueryN
  ): XpbdParticleSourceSimplexCandidateQueryN {
    return queryAtInternal(this, positionOf).query;
  }

  /** Evaluates candidates from the particles' current positions. */
  evaluate(): XpbdParticleSourceSimplexBarrierFamilyEvaluationN {
    return this.evaluateAt((particle) => particle.position.clone());
  }

  /** Evaluates active candidate barriers without mutating live state. */
  evaluateAt(
    positionOf: XpbdParticlePositionQueryN
  ): XpbdParticleSourceSimplexBarrierFamilyEvaluationN {
    const internal = queryAtInternal(this, positionOf);
    const forces = this.particles.map(() => new VecN(this.dimension));
    const activeCandidates: XpbdParticleSourceSimplexActiveCandidateN[] = [];
    let potentialEnergy = 0;
    for (const candidate of internal.query.candidates) {
      const barrier = barrierForCandidate(this, candidate);
      const position = internal.positions.before[candidate.sourceVertexIndex]!;
      const evaluation = barrier.evaluateAt(() => position);
      if (evaluation.distance >= this.activationDistance) continue;
      potentialEnergy += evaluation.potentialEnergy;
      forces[candidate.sourceVertexIndex]!.add(evaluation.forces[0]);
      activeCandidates.push(Object.freeze({ candidate, evaluation }));
    }
    if (!Number.isFinite(potentialEnergy)) {
      throw new Error(
        'XpbdParticleSourceSimplexBarrierFamilyN.evaluateAt: potential energy is outside Float64'
      );
    }
    return Object.freeze({
      candidateQuery: internal.query,
      activeCandidates: Object.freeze(activeCandidates),
      potentialEnergy,
      forces: Object.freeze(forces)
    });
  }

  /** Returns this provider and its paired filter, optionally after base terms. */
  incrementalPotentialTerms(
    base?: XpbdParticleSourceSimplexBarrierFamilyTermsN
  ): XpbdParticleSourceSimplexBarrierFamilyTermsN {
    assertCurrentFamily(this, 'XpbdParticleSourceSimplexBarrierFamilyN.incrementalPotentialTerms');
    if (base === undefined) {
      return Object.freeze({
        providers: Object.freeze([this]),
        stepFilters: Object.freeze([this.stepFilter])
      });
    }
    if (typeof base !== 'object' || base === null ||
      !Array.isArray(base.providers) || !Array.isArray(base.stepFilters)) {
      throw new Error(
        'XpbdParticleSourceSimplexBarrierFamilyN.incrementalPotentialTerms: ' +
        'base terms must contain provider/filter arrays'
      );
    }
    return Object.freeze({
      providers: Object.freeze([...base.providers, this]),
      stepFilters: Object.freeze([...base.stepFilters, this.stepFilter])
    });
  }

  /** Registers this one dynamic provider; particles must already be present. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    const caller = 'XpbdParticleSourceSimplexBarrierFamilyN.addToWorld';
    if (!(world instanceof XpbdWorldN)) {
      throw new Error(`${caller}: expected an XpbdWorldN`);
    }
    if (world.dimension !== this.dimension) {
      throw new Error(`${caller}: family is R${this.dimension}, world is R${world.dimension}`);
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
        throw new Error(`${caller}: particle id "${particle.id}" is owned by another object`);
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
}

/** Candidate-aware aggregate segment filter paired with one barrier family. */
export class XpbdParticleSourceSimplexBarrierFamilyStepFilterN
implements XpbdIncrementalPotentialStepFilterN {
  /** Stable authored filter identity. */
  readonly id: string;
  /** Ambient particle and obstacle dimension. */
  readonly dimension: number;
  /** Exact particles whose proposed segments are inspected. */
  readonly particles: readonly XpbdParticleN[];
  /** Paired dynamic barrier family. */
  readonly family: XpbdParticleSourceSimplexBarrierFamilyN;

  /** Creates the one filter owned by a compiled family. */
  constructor(family: XpbdParticleSourceSimplexBarrierFamilyN) {
    if (!(family instanceof XpbdParticleSourceSimplexBarrierFamilyN)) {
      throw new Error(
        'XpbdParticleSourceSimplexBarrierFamilyStepFilterN: family must be compiled'
      );
    }
    this.id = `${family.id}/step-filter`;
    this.dimension = family.dimension;
    this.particles = family.particles;
    this.family = family;
  }

  /** Certifies the complete segment using only its conservative candidates. */
  evaluate(
    context: XpbdIncrementalPotentialStepFilterContextN
  ): XpbdParticleSourceSimplexBarrierFamilyStepFilterEvaluationN {
    validateStepContext(context, this.dimension);
    const internal = querySegmentInternal(this.family, context);
    const candidates: XpbdParticleSourceSimplexSegmentCandidateN[] = [];
    let maximumStepLength = context.requestedStepLength;
    let blockingCandidateId: string | null = null;
    let refusedCandidateId: string | null = null;
    for (const candidate of internal.query.candidates) {
      const barrier = barrierForCandidate(this.family, candidate);
      const filter = new XpbdParticleSourceSimplexBarrierStepFilterN({
        id: `${candidate.id}/step-filter`,
        barrier,
        conservativeScale: this.family.conservativeScale
      });
      const before = internal.positions.before[candidate.sourceVertexIndex]!;
      const after = internal.positions.after[candidate.sourceVertexIndex]!;
      const evaluation = filter.evaluate({
        dimension: this.dimension,
        requestedStepLength: context.requestedStepLength,
        positionBefore: () => before,
        positionAfter: () => after
      });
      candidates.push(Object.freeze({ candidate, evaluation }));
      if (evaluation.status === 'indeterminate') {
        refusedCandidateId ??= candidate.id;
        continue;
      }
      if (evaluation.maximumStepLength < maximumStepLength) {
        maximumStepLength = evaluation.maximumStepLength;
        blockingCandidateId = candidate.id;
      }
    }
    if (refusedCandidateId !== null) {
      return Object.freeze({
        status: 'indeterminate',
        reason: 'candidate-initial-domain-violation',
        candidateQuery: internal.query,
        candidates: Object.freeze(candidates),
        blockingCandidateId: refusedCandidateId
      });
    }
    const evidence = {
      candidateQuery: internal.query,
      candidates: Object.freeze(candidates),
      blockingCandidateId
    } as const;
    if (maximumStepLength < context.requestedStepLength) {
      return Object.freeze({
        ...evidence,
        status: 'limited',
        maximumStepLength
      });
    }
    return Object.freeze({
      ...evidence,
      status: 'safe',
      maximumStepLength: context.requestedStepLength
    });
  }
}

/** Compiles a dynamic point--static-simplex family and paired filter. */
export function compileXpbdParticleSourceSimplexBarrierFamilyN(
  options: CompileXpbdParticleSourceSimplexBarrierFamilyNOptions
): XpbdParticleSourceSimplexBarrierFamilyN {
  return XpbdParticleSourceSimplexBarrierFamilyN.compile(options);
}

function validateCompilerInput(
  options: CompileXpbdParticleSourceSimplexBarrierFamilyNOptions
): {
  readonly minimumDistance: number;
  readonly projectionTolerance: number;
  readonly rankTolerance: number;
  readonly maxCandidateFaces: number;
  readonly conservativeScale: number;
} {
  const caller = 'compileXpbdParticleSourceSimplexBarrierFamilyN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  const allowed = [
    'id', 'binding', 'obstacle', 'simplexGroup', 'minimumDistance',
    'activationDistance', 'stiffness', 'conservativeScale',
    'projectionTolerance', 'rankTolerance', 'maxCandidateFaces',
    'candidateHierarchy'
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
      `${caller}: binding is R${options.binding.dimension}, obstacle is R${options.obstacle.ambientDim}`
    );
  }
  const group = options.simplexGroup;
  if (!options.obstacle.groups.includes(group)) {
    throw new Error(`${caller}: simplexGroup must belong to obstacle`);
  }
  if (!Number.isSafeInteger(group.dim) || group.dim < 1 ||
    group.dim > options.obstacle.ambientDim || group.kind !== 'simplex' ||
    group.verticesPerCell !== group.dim + 1 || group.indices.length === 0 ||
    group.indices.length % group.verticesPerCell !== 0) {
    throw new Error(`${caller}: simplexGroup must contain complete non-empty simplices`);
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
  const projectionTolerance = options.projectionTolerance ?? 1e-9;
  const rankTolerance = options.rankTolerance ?? 1e-10;
  for (const [label, value] of [
    ['projectionTolerance', projectionTolerance],
    ['rankTolerance', rankTolerance]
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${caller}: ${label} must be finite and positive`);
    }
  }
  const maxCandidateFaces = options.maxCandidateFaces ?? 262_143;
  if (!Number.isSafeInteger(maxCandidateFaces) || maxCandidateFaces < 1) {
    throw new Error(`${caller}: maxCandidateFaces must be a positive safe integer`);
  }
  const candidateHierarchy = options.candidateHierarchy;
  if (candidateHierarchy !== undefined) {
    if (!(candidateHierarchy instanceof XpbdSourceSimplexAabbHierarchyN)) {
      throw new Error(
        `${caller}: candidateHierarchy must be an XpbdSourceSimplexAabbHierarchyN`
      );
    }
    // Object identity, not structural equality. A hierarchy caches bounds for
    // the coordinates it indexed; another source's tree would answer confidently
    // about geometry this family never sees.
    if (candidateHierarchy.obstacle !== options.obstacle) {
      throw new Error(`${caller}: candidateHierarchy indexes a different obstacle`);
    }
    if (candidateHierarchy.simplexGroup !== group) {
      throw new Error(`${caller}: candidateHierarchy indexes a different simplex group`);
    }
    if (candidateHierarchy.dimension !== options.binding.dimension) {
      throw new Error(
        `${caller}: candidateHierarchy is R${candidateHierarchy.dimension}, ` +
        `binding is R${options.binding.dimension}`
      );
    }
  }
  assertCurrentBinding(options.binding, caller);
  assertFiniteObstacle(options.obstacle, group, caller);
  return {
    minimumDistance,
    projectionTolerance,
    rankTolerance,
    maxCandidateFaces,
    conservativeScale
  };
}

function compileSimplexReferences(
  obstacle: CellComplex,
  group: CellGroup
): readonly SourceSimplexReferenceN[] {
  return Object.freeze(Array.from(
    { length: group.indices.length / group.verticesPerCell },
    (_, cellIndex) => createSourceSimplexReferenceN(
      createSourceCellReferenceN(obstacle, group, cellIndex)
    )
  ));
}

function queryAtInternal(
  family: XpbdParticleSourceSimplexBarrierFamilyN,
  positionOf: XpbdParticlePositionQueryN
): CandidateQueryInternalN {
  if (typeof positionOf !== 'function') {
    throw new Error(
      'XpbdParticleSourceSimplexBarrierFamilyN.queryAt: positionOf must be a function'
    );
  }
  const positions = family.particles.map((particle, index) => finitePosition(
    positionOf(particle),
    family.dimension,
    `XpbdParticleSourceSimplexBarrierFamilyN.queryAt: position ${index}`
  ));
  return queryCandidates(
    family,
    { before: positions, after: positions },
    'point'
  );
}

function querySegmentInternal(
  family: XpbdParticleSourceSimplexBarrierFamilyN,
  context: XpbdIncrementalPotentialStepFilterContextN
): CandidateQueryInternalN {
  const before = family.particles.map((particle, index) => finitePosition(
    context.positionBefore(particle),
    family.dimension,
    `XpbdParticleSourceSimplexBarrierFamilyStepFilterN: positionBefore ${index}`
  ));
  const after = family.particles.map((particle, index) => finitePosition(
    context.positionAfter(particle),
    family.dimension,
    `XpbdParticleSourceSimplexBarrierFamilyStepFilterN: positionAfter ${index}`
  ));
  return queryCandidates(family, { before, after }, 'segment');
}

function queryCandidates(
  family: XpbdParticleSourceSimplexBarrierFamilyN,
  positions: PositionSnapshotN,
  scope: 'point' | 'segment'
): CandidateQueryInternalN {
  const caller = 'XpbdParticleSourceSimplexBarrierFamilyN candidate query';
  assertCurrentFamily(family, caller);
  const hierarchy = family.candidateHierarchy;
  // Checked once per query rather than once per dynamic vertex: the obstacle
  // cannot change between two vertices of the same query, and paying
  // O(coordinates) per vertex would undo what the tree buys.
  if (hierarchy !== null) hierarchy.assertSourceCurrent(caller);

  const candidates: XpbdParticleSourceSimplexCandidateN[] = [];
  const push = (sourceVertexIndex: number, obstacleCellIndex: number): void => {
    candidates.push(Object.freeze({
      id: `${family.id}/source-vertex/${sourceVertexIndex}/obstacle-cell/${obstacleCellIndex}`,
      sourceVertexIndex,
      particle: family.particles[sourceVertexIndex]!,
      obstacleCellIndex,
      simplex: family.simplices[obstacleCellIndex]!
    }));
  };

  // Recomputed per query under the exhaustive default because the obstacle is
  // only assumed static by the hierarchy, which pays for that assumption with
  // its staleness check.
  const obstacleBounds = hierarchy === null
    ? family.simplices.map(xpbdSourceSimplexBoundsN)
    : null;
  let axisTests = 0;
  let hierarchyDiagnostics: XpbdSourceSimplexAabbQueryDiagnosticsN | null = null;

  for (let sourceVertexIndex = 0;
    sourceVertexIndex < family.particles.length;
    sourceVertexIndex++) {
    const pointBounds: XpbdSourceSimplexBoundsN = xpbdSweptPointBoundsN(
      positions.before[sourceVertexIndex]!,
      positions.after[sourceVertexIndex]!,
      family.activationDistance
    );
    if (hierarchy === null) {
      for (let obstacleCellIndex = 0;
        obstacleCellIndex < family.simplices.length;
        obstacleCellIndex++) {
        const overlap = xpbdSourceSimplexBoundsOverlapN(
          pointBounds, obstacleBounds![obstacleCellIndex]!
        );
        axisTests += overlap.axisTests;
        if (!overlap.overlaps) continue;
        push(sourceVertexIndex, obstacleCellIndex);
      }
      continue;
    }
    // The tree applies the identical rule to the identical bounds and returns
    // ascending cell order, so the emitted sequence is the exhaustive one.
    const retained = hierarchy.queryChecked(pointBounds);
    axisTests += retained.diagnostics.axisTests;
    hierarchyDiagnostics = accumulateHierarchyDiagnostics(
      hierarchyDiagnostics, retained.diagnostics
    );
    for (const obstacleCellIndex of retained.cellIndices) {
      push(sourceVertexIndex, obstacleCellIndex);
    }
  }

  const possiblePairs = family.particles.length * family.simplices.length;
  const query = Object.freeze({
    scope,
    activationDistance: family.activationDistance,
    candidates: Object.freeze(candidates),
    diagnostics: Object.freeze({
      provider: (hierarchy === null
        ? 'exhaustive-swept-aabb'
        : 'hierarchical-swept-aabb') as
        XpbdParticleSourceSimplexCandidateDiagnosticsN['provider'],
      strategy: (hierarchy === null
        ? 'exhaustive'
        : 'static-aabb-hierarchy') as
        XpbdParticleSourceSimplexCandidateDiagnosticsN['strategy'],
      sourceVertexCount: family.particles.length,
      obstacleSimplexCount: family.simplices.length,
      possiblePairs,
      candidatePairs: candidates.length,
      rejectedPairs: possiblePairs - candidates.length,
      axisTests,
      ...(hierarchyDiagnostics === null
        ? {}
        : { hierarchy: Object.freeze(hierarchyDiagnostics) })
    })
  });
  return { query, positions };
}

/** Sums per-vertex hierarchy work into one per-query record. */
function accumulateHierarchyDiagnostics(
  total: XpbdSourceSimplexAabbQueryDiagnosticsN | null,
  next: XpbdSourceSimplexAabbQueryDiagnosticsN
): XpbdSourceSimplexAabbQueryDiagnosticsN {
  if (total === null) return next;
  return {
    // Constant across vertices; the others accumulate.
    totalSimplices: next.totalSimplices,
    visitedNodes: total.visitedNodes + next.visitedNodes,
    visitedLeaves: total.visitedLeaves + next.visitedLeaves,
    testedSimplexBounds: total.testedSimplexBounds + next.testedSimplexBounds,
    retainedSimplices: total.retainedSimplices + next.retainedSimplices,
    axisTests: total.axisTests + next.axisTests
  };
}

function barrierForCandidate(
  family: XpbdParticleSourceSimplexBarrierFamilyN,
  candidate: XpbdParticleSourceSimplexCandidateN
): XpbdParticleSourceSimplexBarrierN {
  return new XpbdParticleSourceSimplexBarrierN({
    id: `${candidate.id}/barrier`,
    particle: candidate.particle,
    simplex: candidate.simplex,
    minimumDistance: family.minimumDistance,
    activationDistance: family.activationDistance,
    stiffness: family.stiffness,
    projectionTolerance: family.projectionTolerance,
    rankTolerance: family.rankTolerance,
    maxCandidateFaces: family.maxCandidateFaces
  });
}

function assertCurrentFamily(
  family: XpbdParticleSourceSimplexBarrierFamilyN,
  caller: string
): void {
  assertCurrentBinding(family.binding, caller);
  if (!family.obstacle.groups.includes(family.simplexGroup)) {
    throw new Error(`${caller}: obstacle simplex group was removed`);
  }
  if (family.simplices.length !==
    family.simplexGroup.indices.length / family.simplexGroup.verticesPerCell) {
    throw new Error(`${caller}: obstacle simplex layout changed`);
  }
  for (let index = 0; index < family.simplices.length; index++) {
    const status = inspectSourceSimplexReferenceN(family.simplices[index]!);
    if (status.kind === 'retired') {
      throw new Error(`${caller}: obstacle simplex ${index} is retired (${status.reason})`);
    }
  }
  assertFiniteObstacle(family.obstacle, family.simplexGroup, caller);
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

function assertFiniteObstacle(
  obstacle: CellComplex,
  group: CellGroup,
  caller: string
): void {
  for (const vertex of group.indices) {
    const offset = vertex * obstacle.ambientDim;
    for (let axis = 0; axis < obstacle.ambientDim; axis++) {
      if (!Number.isFinite(obstacle.positions[offset + axis])) {
        throw new Error(`${caller}: obstacle simplex positions must be finite`);
      }
    }
  }
}

function validateStepContext(
  context: XpbdIncrementalPotentialStepFilterContextN,
  dimension: number
): void {
  const caller = 'XpbdParticleSourceSimplexBarrierFamilyStepFilterN.evaluate';
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

