import {
  CellComplex,
  VecN,
  createSourceCellIdN,
  createSourceCellReferenceN,
  inspectSourceCellReferenceN,
  type CellGroup,
  type SourceCellIdN,
  type SourceCellReferenceN
} from '@holotope/core';
import {
  analyzeLinearSimplexMeasureN,
  type LinearSimplexMeasureAnalysisN
} from './simplex-measure-cast.js';
import {
  evaluateSimplexHingeCosineN,
  type SimplexHingeCosineEvaluationN,
  type SimplexHingeCosineRefusalReasonN
} from './simplex-hinge-cosine.js';
import type {
  XpbdIncrementalPotentialStepFilterContextN,
  XpbdIncrementalPotentialStepFilterEvaluationN,
  XpbdIncrementalPotentialStepFilterN
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
 * One interior hinge: a shared codimension-one face and its two apexes.
 *
 * Identity is source-side throughout. Cell ordinals and vertex indices name
 * the authored complex, never a position in this family's own arrays, so a
 * hinge stays recognizable across recompilation of an equivalent source.
 */
export interface XpbdSourceSimplexBendingHingeN {
  /** Family-scoped stable identity. */
  readonly id: string;
  /** Shared-face source vertices, numerically ascending. */
  readonly sharedVertices: readonly number[];
  /** Source vertex of the lower-ordinal incident cell, opposite the face. */
  readonly oppositeVertexA: number;
  /** Source vertex of the higher-ordinal incident cell, opposite the face. */
  readonly oppositeVertexB: number;
  /** Persistent reference to the lower-ordinal incident simplex. */
  readonly cellA: SourceCellReferenceN;
  /** Persistent reference to the higher-ordinal incident simplex. */
  readonly cellB: SourceCellReferenceN;
  /** Structural ids, stable across order-independent regeneration. */
  /** Structural id of the lower-ordinal incident cell. */
  readonly cellIdA: SourceCellIdN;
  /** Structural id of the higher-ordinal incident cell. */
  readonly cellIdB: SourceCellIdN;
  /** Fold coordinate captured from the source at compilation. */
  readonly restCoordinate: number;
  /** Conormal heights at rest, for auditing a near-degenerate rest shape. */
  /** First apex conormal height at rest. */
  readonly restHeightA: number;
  /** Second apex conormal height at rest. */
  readonly restHeightB: number;
  /** Shared-face conditioning at rest. */
  readonly restConditioning: number;
}

/** One hinge's contribution at a candidate state. */
export interface XpbdSourceSimplexBendingHingeEvaluationN {
  /** The compiled hinge this record belongs to. */
  readonly hinge: XpbdSourceSimplexBendingHingeN;
  /** Complete P48 geometry, including the per-vertex gradient. */
  readonly geometry: SimplexHingeCosineEvaluationN;
  /** `c - cRest`; zero at the captured rest shape. */
  readonly coordinateError: number;
  /** `0.5 * stiffness * weight * (c - cRest)^2`, with `weight = 1`. */
  readonly energy: number;
}

/** Aggregate conservative evaluation over every compiled hinge. */
export interface XpbdSourceSimplexCosineBendingFamilyEvaluationN
  extends XpbdConservativeForceProviderEvaluationN {
  /** Per-hinge records in compiled hinge order; never flattened to counts. */
  readonly hinges: readonly XpbdSourceSimplexBendingHingeEvaluationN[];
  /** One accumulated force per bound source vertex, in binding order. */
  readonly forces: readonly VecN[];
  /** Interior hinges evaluated. */
  readonly hingeCount: number;
  /** Codimension-one faces with exactly one incident cell; not hinges. */
  readonly boundaryFaceCount: number;
  /** Largest `|c - cRest|` over the evaluated hinges. */
  readonly maximumCoordinateError: number;
  /** Smallest conormal height seen; small means an ill-posed hinge. */
  readonly minimumConormalHeight: number;
  /** Smallest shared-face conditioning seen. */
  readonly minimumConditioning: number;
  /** Norm of the summed force; a bending potential exerts no net force. */
  readonly netForceResidual: number;
  /**
   * Largest skew component of `sum(x ⊗ f)`.
   *
   * Zero for a coordinate invariant under rigid motion, so a non-trivial value
   * would mean the gradient had drifted from the coordinate it claims to
   * differentiate.
   */
  readonly rotationalFirstMomentResidual: number;
  /** Weighting policy actually applied. */
  readonly weighting: 'unit-discrete';
  /** The literal weight; `1` for every hinge in this stage. */
  readonly weight: 1;
}

/** Provider and its paired filter, accepted together by a compiled problem. */
export interface XpbdSourceSimplexCosineBendingFamilyTermsN {
  /** Existing providers followed by this bending family provider. */
  readonly providers: readonly XpbdConservativeForceProviderN[];
  /** Existing filters followed by this family's paired segment certificate. */
  readonly stepFilters: readonly XpbdIncrementalPotentialStepFilterN[];
}

/** Why an aggregate bending segment query refused certification. */
export type XpbdSourceSimplexCosineBendingFilterRefusalReasonN =
  | 'initial-measure-violation'
  | 'no-certifiable-prefix';

/** One inspected source simplex paired with its measure analysis. */
export interface XpbdSourceSimplexBendingCellAnalysisN {
  /** Persistent reference to the inspected source simplex. */
  readonly cell: SourceCellReferenceN;
  /** Its ordinal within the compiled simplex group. */
  readonly cellIndex: number;
  /** Complete polynomial enclosure evidence for this cell over the segment. */
  readonly analysis: LinearSimplexMeasureAnalysisN;
}

/** Aggregate intrinsic-rank certification for one proposed segment. */
export type XpbdSourceSimplexCosineBendingFamilyStepFilterEvaluationN = {
  /** Per-cell analyses in persistent source-cell order. */
  readonly cells: readonly XpbdSourceSimplexBendingCellAnalysisN[];
  /** Source cell imposing the aggregate limit or refusal, otherwise `null`. */
  readonly blockingCellIndex: number | null;
} & (
  | { readonly status: 'safe'; readonly maximumStepLength: number }
  | { readonly status: 'limited'; readonly maximumStepLength: number }
  | {
    readonly status: 'indeterminate';
    readonly reason: XpbdSourceSimplexCosineBendingFilterRefusalReasonN;
  }
);

/** Construction options for one source-retained cosine-bending family. */
export interface CompileXpbdSourceSimplexCosineBendingFamilyNOptions {
  /** Stable provider identity and hinge-ID prefix. */
  readonly id: string;
  /** Authoritative source-vertex to particle mapping. */
  readonly binding: XpbdParticleBindingN;
  /** Simplex group belonging to `binding.source`. */
  readonly simplexGroup: CellGroup;
  /**
   * Uniform finite positive stiffness.
   *
   * Discretization-dependent. The energy is quartic in small fold angle, so a
   * value tuned on one mesh does not transfer to a refinement of it.
   */
  readonly stiffness: number;
  /**
   * Rest fold coordinate. `'source'` (the default) captures each hinge's
   * coordinate from the authored geometry; a finite scalar in `[-1, 1]` sets
   * every hinge, with `1` meaning flat.
   */
  readonly restCoordinate?: 'source' | number;
  /**
   * Minimum current/rest intrinsic measure ratio the paired filter certifies.
   *
   * Required, because endpoint evaluation alone cannot see a segment passing
   * through zero conormal height and arriving non-degenerate.
   */
  readonly minimumMeasureRatio: number;
  /** Relative rank/height tolerance for the hinge geometry. Default `1e-10`. */
  readonly tolerance?: number;
  /** Fraction of a certified prefix retained. Default `0.9`. */
  readonly conservativeScale?: number;
  /** Bracket resolution forwarded to `analyzeLinearSimplexMeasureN`. */
  readonly timeTolerance?: number;
  /** Subdivision depth bound forwarded to `analyzeLinearSimplexMeasureN`. */
  readonly maximumDepth?: number;
  /** Relative coefficient tolerance forwarded to the same analysis. */
  readonly relativeCoefficientTolerance?: number;
}

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'id', 'binding', 'simplexGroup', 'stiffness', 'restCoordinate',
  'minimumMeasureRatio', 'tolerance', 'conservativeScale', 'timeTolerance',
  'maximumDepth', 'relativeCoefficientTolerance'
]);

interface CompiledCellN {
  readonly cellIndex: number;
  readonly reference: SourceCellReferenceN;
  readonly vertices: readonly number[];
  readonly restPositions: readonly VecN[];
}

/**
 * Source-retained discrete cosine-fold bending over adjacent simplices.
 *
 * **This is a discrete stiffness, not a shell model.** The energy is
 * `0.5 k (c - c_rest)²` in the cosine coordinate, which makes it *quartic* in
 * the fold angle where a continuum bending energy is quadratic. The P48
 * measurement refined a fixed cylindrical strip in place and found the total
 * falling as `n^-2.99`: it does not converge to a non-zero continuum limit, and
 * no weighting fixes that. Stiffness values are therefore tied to the mesh they
 * were tuned on.
 *
 * The same fact has a practical consequence worth knowing before use: at a flat
 * rest shape the first derivative vanishes, so small folds produce very weak
 * restoring force. This resists large folds well and barely notices small ones.
 *
 * Only unit weighting exists here. The Discrete Shells face/height weight was
 * measured (`n^-2.00`, still not convergent) and deliberately not exposed,
 * because a weight enum would imply a calibration choice that neither option
 * earns.
 *
 * Identity is source-side. Hinges are keyed by their sorted shared-vertex
 * tuple and then by ascending incident cell ordinals, compared numerically —
 * a string sort would order vertex 10 before vertex 9. Rest geometry is
 * snapshotted at compilation, so writing new coordinates through
 * `binding.writeSourcePositions()` deforms the mesh against its captured rest
 * shape rather than silently redefining it. Changing the rest state is a
 * recompilation.
 *
 * First-order only: the family implements `XpbdConservativeForceProviderN` and
 * exposes no Hessian, so Newton-CG refuses the provider mixture rather than
 * silently dropping bending curvature.
 */
export class XpbdSourceSimplexCosineBendingFamilyN
implements XpbdConservativeForceProviderN {
  /** Stable provider identity and hinge-ID prefix. */
  readonly id: string;
  /** Ambient dimension `N`, taken from the binding. */
  readonly dimension: number;
  /** Authoritative source-vertex to particle mapping. */
  readonly binding: XpbdParticleBindingN;
  /** Bound particles in source-vertex order. */
  readonly particles: readonly XpbdParticleN[];
  /** Source complex owning the indexed simplex group. */
  readonly source: CellComplex;
  /** Compiled simplex group; identity, not structural equality, is required. */
  readonly simplexGroup: CellGroup;
  /** Intrinsic simplex dimension `d`, with `1 <= d < dimension`. */
  readonly simplexDimension: number;
  /** Compiled interior hinges in canonical source order. */
  readonly hinges: readonly XpbdSourceSimplexBendingHingeN[];
  /** Codimension-one faces with exactly one incident cell. */
  readonly boundaryFaceCount: number;
  /** Uniform stiffness; discretization-dependent, not a material constant. */
  readonly stiffness: number;
  /** Relative rank/height tolerance used by every hinge evaluation. */
  readonly tolerance: number;
  /** Minimum current/rest measure ratio the paired filter certifies. */
  readonly minimumMeasureRatio: number;
  /** Fraction of a certified prefix the filter retains. */
  readonly conservativeScale: number;
  /** Paired continuous-domain filter; pass it to every incremental solve. */
  readonly stepFilter: XpbdSourceSimplexCosineBendingFamilyStepFilterN;
  /** Weighting policy, exposed so the choice is visible rather than implied. */
  readonly weighting: 'unit-discrete' = 'unit-discrete';

  /** @internal Distinct source simplices the filter inspects, in cell order. */
  readonly compiledCells: readonly CompiledCellN[];
  /** @internal Forwarded measure-analysis controls. */
  readonly analysisOptions: Readonly<{
    timeTolerance?: number;
    maximumDepth?: number;
    relativeCoefficientTolerance?: number;
  }>;

  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    options: CompileXpbdSourceSimplexCosineBendingFamilyNOptions,
    compiled: {
      hinges: XpbdSourceSimplexBendingHingeN[];
      boundaryFaceCount: number;
      cells: CompiledCellN[];
      simplexDimension: number;
      tolerance: number;
      conservativeScale: number;
      analysisOptions: Record<string, number>;
    }
  ) {
    this.id = options.id;
    this.binding = options.binding;
    this.dimension = options.binding.dimension;
    this.particles = options.binding.particles;
    this.source = options.binding.source;
    this.simplexGroup = options.simplexGroup;
    this.simplexDimension = compiled.simplexDimension;
    this.hinges = Object.freeze(compiled.hinges);
    this.boundaryFaceCount = compiled.boundaryFaceCount;
    this.stiffness = options.stiffness;
    this.tolerance = compiled.tolerance;
    this.minimumMeasureRatio = options.minimumMeasureRatio;
    this.conservativeScale = compiled.conservativeScale;
    this.compiledCells = Object.freeze(compiled.cells);
    this.analysisOptions = Object.freeze(compiled.analysisOptions);
    this.stepFilter =
      new XpbdSourceSimplexCosineBendingFamilyStepFilterN(this);
  }

  /** Compiles interior hinges, rest geometry, and the paired filter. */
  static compile(
    options: CompileXpbdSourceSimplexCosineBendingFamilyNOptions
  ): XpbdSourceSimplexCosineBendingFamilyN {
    return new XpbdSourceSimplexCosineBendingFamilyN(
      options, validateAndCompile(options)
    );
  }

  /** Evaluates from the particles' current positions. */
  evaluate(): XpbdSourceSimplexCosineBendingFamilyEvaluationN {
    return this.evaluateAt((particle) => particle.position.clone());
  }

  /** Evaluates one candidate state without mutating live particles. */
  evaluateAt(
    positionOf: XpbdParticlePositionQueryN
  ): XpbdSourceSimplexCosineBendingFamilyEvaluationN {
    const caller = 'XpbdSourceSimplexCosineBendingFamilyN.evaluateAt';
    if (typeof positionOf !== 'function') {
      throw new Error(`${caller}: positionOf must be a function`);
    }
    assertCurrentFamily(this, caller);
    const positions = this.particles.map((particle, index) => {
      const value = positionOf(particle);
      if (!(value instanceof VecN) || value.dim !== this.dimension) {
        throw new Error(`${caller}: position ${index} must return R${this.dimension}`);
      }
      for (const coordinate of value.data) {
        if (!Number.isFinite(coordinate)) {
          throw new Error(`${caller}: position ${index} must be finite`);
        }
      }
      return value;
    });

    const forces = this.particles.map(() => new VecN(this.dimension));
    const records: XpbdSourceSimplexBendingHingeEvaluationN[] = [];
    let potentialEnergy = 0;
    let maximumCoordinateError = 0;
    let minimumConormalHeight = Number.POSITIVE_INFINITY;
    let minimumConditioning = Number.POSITIVE_INFINITY;

    for (const hinge of this.hinges) {
      const geometry = evaluateSimplexHingeCosineN({
        sharedFace: hinge.sharedVertices.map((vertex) => positions[vertex]!),
        oppositeA: positions[hinge.oppositeVertexA]!,
        oppositeB: positions[hinge.oppositeVertexB]!,
        tolerance: this.tolerance
      });
      if (geometry.status === 'refused') {
        // Recoverable: an Armijo backtrack can propose a smaller step.
        throw new XpbdPotentialDomainErrorN<SimplexHingeCosineRefusalReasonN>(
          this.id,
          geometry.reason,
          `${caller}: hinge "${hinge.id}" is degenerate (${geometry.reason})`
        );
      }
      const coordinateError = geometry.coordinate - hinge.restCoordinate;
      const energy = 0.5 * this.stiffness * coordinateError * coordinateError;
      potentialEnergy += energy;
      maximumCoordinateError = Math.max(
        maximumCoordinateError, Math.abs(coordinateError)
      );
      minimumConormalHeight = Math.min(
        minimumConormalHeight, geometry.heightA, geometry.heightB
      );
      minimumConditioning = Math.min(minimumConditioning, geometry.conditioning);

      const order = [
        ...hinge.sharedVertices, hinge.oppositeVertexA, hinge.oppositeVertexB
      ];
      order.forEach((vertex, slot) => {
        const gradient = geometry.gradient[slot]!;
        const force = forces[vertex]!;
        for (let axis = 0; axis < this.dimension; axis++) {
          force.data[axis]! -= this.stiffness * coordinateError * gradient.data[axis]!;
        }
      });
      records.push(Object.freeze({ hinge, geometry, coordinateError, energy }));
    }

    if (!Number.isFinite(potentialEnergy)) {
      throw new Error(`${caller}: potential energy is outside Float64`);
    }

    const net = new Float64Array(this.dimension);
    for (const force of forces) {
      for (let axis = 0; axis < this.dimension; axis++) net[axis]! += force.data[axis]!;
    }
    let netForceResidual = 0;
    for (const value of net) netForceResidual += value * value;
    netForceResidual = Math.sqrt(netForceResidual);

    let rotationalFirstMomentResidual = 0;
    for (let row = 0; row < this.dimension; row++) {
      for (let column = row + 1; column < this.dimension; column++) {
        let skew = 0;
        for (let index = 0; index < positions.length; index++) {
          skew += positions[index]!.data[row]! * forces[index]!.data[column]! -
            positions[index]!.data[column]! * forces[index]!.data[row]!;
        }
        rotationalFirstMomentResidual = Math.max(
          rotationalFirstMomentResidual, Math.abs(skew)
        );
      }
    }

    return Object.freeze({
      potentialEnergy,
      forces: Object.freeze(forces),
      hinges: Object.freeze(records),
      hingeCount: this.hinges.length,
      boundaryFaceCount: this.boundaryFaceCount,
      maximumCoordinateError,
      minimumConormalHeight: this.hinges.length === 0 ? 0 : minimumConormalHeight,
      minimumConditioning: this.hinges.length === 0 ? 0 : minimumConditioning,
      netForceResidual,
      rotationalFirstMomentResidual,
      weighting: 'unit-discrete' as const,
      weight: 1 as const
    });
  }

  /** Returns this provider with its paired filter, optionally after base terms. */
  incrementalPotentialTerms(
    base?: XpbdSourceSimplexCosineBendingFamilyTermsN
  ): XpbdSourceSimplexCosineBendingFamilyTermsN {
    const caller =
      'XpbdSourceSimplexCosineBendingFamilyN.incrementalPotentialTerms';
    assertCurrentFamily(this, caller);
    if (base === undefined) {
      return Object.freeze({
        providers: Object.freeze([this as XpbdConservativeForceProviderN]),
        stepFilters: Object.freeze([
          this.stepFilter as XpbdIncrementalPotentialStepFilterN
        ])
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

  /** Registers this provider; its particles must already be in the world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    const caller = 'XpbdSourceSimplexCosineBendingFamilyN.addToWorld';
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
}

/**
 * Aggregate intrinsic-rank certificate for one proposed bending segment.
 *
 * Endpoint evaluation is not enough on its own. A linear search segment can
 * begin and end with perfectly good hinges while passing through zero conormal
 * height in between, and at that instant the fold coordinate does not exist.
 * Both endpoints would look finite and the crossing would be invisible.
 *
 * The certificate reuses `analyzeLinearSimplexMeasureN` over each distinct
 * source simplex rather than inventing a second polynomial or sampling the
 * chord: non-zero intrinsic measure of both incident simplices implies a
 * full-rank shared face and a non-zero apex conormal, which is exactly the
 * condition the coordinate needs.
 *
 * What it returns is a conservative admissible prefix, not an exact collapse
 * time and not a collision response.
 */
export class XpbdSourceSimplexCosineBendingFamilyStepFilterN
implements XpbdIncrementalPotentialStepFilterN {
  readonly id: string;
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];
  private readonly family: XpbdSourceSimplexCosineBendingFamilyN;

  /**
   * Binds one filter to its family; the family constructs its own.
   *
   * @param family - The compiled family whose source cells this certifies.
   */
  constructor(family: XpbdSourceSimplexCosineBendingFamilyN) {
    this.family = family;
    this.id = `${family.id}/bending-measure-filter`;
    this.dimension = family.dimension;
    this.particles = family.particles;
  }

  /**
   * Certifies the complete segment, a strict prefix, or refuses.
   *
   * This is {@link evaluateSegment} under the narrower solver-seam type. The
   * two are one computation returning one object: nothing is recomputed and
   * nothing is stripped, so `cells` and `blockingCellIndex` are present on this
   * result at runtime even though the seam type does not declare them. Call
   * {@link evaluateSegment} to have them typed rather than to obtain them.
   */
  evaluate(
    context: XpbdIncrementalPotentialStepFilterContextN
  ): XpbdIncrementalPotentialStepFilterEvaluationN {
    return this.evaluateSegment(context) as
      XpbdIncrementalPotentialStepFilterEvaluationN;
  }

  /**
   * The same query, returning the family's own per-cell evidence as its type.
   *
   * Identical work and an identical object to {@link evaluate} — the difference
   * is static only. The seam type cannot carry per-cell records, and widening
   * it is not this slice's business, so the richer type lives here instead of
   * the evidence being discarded to fit.
   */
  evaluateSegment(
    context: XpbdIncrementalPotentialStepFilterContextN
  ): XpbdSourceSimplexCosineBendingFamilyStepFilterEvaluationN {
    const caller = 'XpbdSourceSimplexCosineBendingFamilyStepFilterN.evaluate';
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
    assertCurrentFamily(this.family, caller);

    const before = this.particles.map((particle) => context.positionBefore(particle));
    const after = this.particles.map((particle) => context.positionAfter(particle));
    const cells: XpbdSourceSimplexBendingCellAnalysisN[] = [];
    let limit = context.requestedStepLength;
    let blockingCellIndex: number | null = null;
    let initialViolation = false;

    // Each distinct source simplex is inspected exactly once, in persistent
    // cell order — a hinge shares its cells with its neighbours, so analysing
    // per hinge would repeat the same polynomial.
    for (const cell of this.family.compiledCells) {
      const analysis = analyzeLinearSimplexMeasureN({
        restPositions: cell.restPositions,
        startPositions: cell.vertices.map((vertex) => before[vertex]!),
        endPositions: cell.vertices.map((vertex) => after[vertex]!),
        minimumMeasureRatio: this.family.minimumMeasureRatio,
        ...this.family.analysisOptions
      });
      cells.push(Object.freeze({
        cell: cell.reference, cellIndex: cell.cellIndex, analysis
      }));
      if (analysis.status === 'initial-violation') {
        initialViolation = true;
        if (blockingCellIndex === null) blockingCellIndex = cell.cellIndex;
        continue;
      }
      if (analysis.status !== 'possible-violation') continue;
      // The earliest bracket start, scaled back to a strict prefix.
      const certified = analysis.timeBracket[0] * this.family.conservativeScale *
        context.requestedStepLength;
      if (certified < limit) {
        limit = certified;
        blockingCellIndex = cell.cellIndex;
      }
    }

    const frozenCells = Object.freeze(cells);
    if (initialViolation) {
      return Object.freeze({
        status: 'indeterminate' as const,
        reason: 'initial-measure-violation' as const,
        cells: frozenCells,
        blockingCellIndex
      });
    }
    if (!(limit > 0)) {
      return Object.freeze({
        status: 'indeterminate' as const,
        reason: 'no-certifiable-prefix' as const,
        cells: frozenCells,
        blockingCellIndex
      });
    }
    if (limit >= context.requestedStepLength) {
      return Object.freeze({
        status: 'safe' as const,
        maximumStepLength: context.requestedStepLength,
        cells: frozenCells,
        blockingCellIndex: null
      });
    }
    return Object.freeze({
      status: 'limited' as const,
      maximumStepLength: limit,
      cells: frozenCells,
      blockingCellIndex
    });
  }
}

/**
 * Compiles one source-retained cosine-bending family.
 *
 * **A discrete cosine-fold stiffness, not a continuum shell.** See
 * {@link XpbdSourceSimplexCosineBendingFamilyN} for the measured
 * non-convergence and what it means for choosing `stiffness`.
 *
 * @param options - The binding, its simplex group, a uniform positive
 * stiffness, the required `minimumMeasureRatio` for the paired filter, and an
 * optional rest coordinate.
 * @returns A compiled family exposing the provider and `stepFilter` together.
 * @throws If options are malformed, the group does not belong to the binding's
 * source, a simplex is degenerate, or any codimension-one face has more than
 * two incident cells. A non-manifold face refuses the whole compilation rather
 * than yielding a partial family.
 *
 * @example
 * A flat-rest R4 membrane strip. Note the filter travelling with the provider:
 * ```ts
 * const sheet = new CellComplex(4, Float64Array.from([
 *   0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0
 * ]), [{
 *   key: 'sheet', dim: 2, verticesPerCell: 3, kind: 'simplex',
 *   indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
 * }]);
 * const [group] = sheet.cellsOfDim(2);
 * if (!group) throw new Error('the sheet has no 2-cells');
 *
 * const binding = compileXpbdParticleBindingN({ id: 'sheet', source: sheet });
 * const bending = compileXpbdSourceSimplexCosineBendingFamilyN({
 *   id: 'sheet-bending',
 *   binding,
 *   simplexGroup: group,
 *   stiffness: 12,
 *   restCoordinate: 1,
 *   minimumMeasureRatio: 0.05
 * });
 *
 * log(bending.hinges.length);          // 1 interior hinge
 * log(bending.boundaryFaceCount);      // 4 boundary edges
 * log(bending.evaluate().potentialEnergy);  // 0 — the strip starts flat
 * ```
 */
export function compileXpbdSourceSimplexCosineBendingFamilyN(
  options: CompileXpbdSourceSimplexCosineBendingFamilyNOptions
): XpbdSourceSimplexCosineBendingFamilyN {
  return XpbdSourceSimplexCosineBendingFamilyN.compile(options);
}

function validateAndCompile(
  options: CompileXpbdSourceSimplexCosineBendingFamilyNOptions
): {
  hinges: XpbdSourceSimplexBendingHingeN[];
  boundaryFaceCount: number;
  cells: CompiledCellN[];
  simplexDimension: number;
  tolerance: number;
  conservativeScale: number;
  analysisOptions: Record<string, number>;
} {
  const caller = 'compileXpbdSourceSimplexCosineBendingFamilyN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  const unknown = Object.keys(options).filter((key) => !KNOWN_KEYS.has(key));
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
  const source = options.binding.source;
  const dimension = options.binding.dimension;
  const group = options.simplexGroup;
  if (!source.groups.includes(group)) {
    throw new Error(`${caller}: simplexGroup must belong to the binding's source`);
  }
  if (!Number.isSafeInteger(group.dim) || group.dim < 1 ||
    group.kind !== 'simplex' || group.verticesPerCell !== group.dim + 1 ||
    group.indices.length === 0 ||
    group.indices.length % group.verticesPerCell !== 0) {
    throw new Error(`${caller}: simplexGroup must contain complete non-empty simplices`);
  }
  if (group.dim >= dimension) {
    throw new Error(
      `${caller}: a ${group.dim}-simplex hinge needs ambient dimension above ` +
      `${group.dim}, source is R${dimension}`
    );
  }
  if (!Number.isFinite(options.stiffness) || !(options.stiffness > 0)) {
    throw new Error(`${caller}: stiffness must be finite and positive`);
  }
  if (!Number.isFinite(options.minimumMeasureRatio) ||
    !(options.minimumMeasureRatio > 0)) {
    throw new Error(`${caller}: minimumMeasureRatio must be finite and positive`);
  }
  const tolerance = options.tolerance ?? 1e-10;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error(`${caller}: tolerance must be finite and positive`);
  }
  const conservativeScale = options.conservativeScale ?? 0.9;
  if (!Number.isFinite(conservativeScale) ||
    conservativeScale <= 0 || conservativeScale >= 1) {
    throw new Error(`${caller}: conservativeScale must be in (0, 1)`);
  }
  const restOption = options.restCoordinate ?? 'source';
  if (restOption !== 'source') {
    if (typeof restOption !== 'number' || !Number.isFinite(restOption) ||
      restOption < -1 || restOption > 1) {
      throw new Error(
        `${caller}: restCoordinate must be 'source' or a finite number in [-1, 1]`
      );
    }
  }
  const analysisOptions: Record<string, number> = {};
  for (const key of
    ['timeTolerance', 'maximumDepth', 'relativeCoefficientTolerance'] as const) {
    const value = options[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${caller}: ${key} must be finite and positive`);
    }
    analysisOptions[key] = value;
  }

  const verticesPerCell = group.verticesPerCell;
  const cellCount = group.indices.length / verticesPerCell;
  const vertexCount = options.binding.particles.length;
  const cells: CompiledCellN[] = [];
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    const vertices: number[] = [];
    for (let slot = 0; slot < verticesPerCell; slot++) {
      const vertex = group.indices[cellIndex * verticesPerCell + slot]!;
      if (!Number.isSafeInteger(vertex) || vertex < 0 || vertex >= vertexCount) {
        throw new Error(
          `${caller}: cell ${cellIndex} references vertex ${vertex}, outside the binding`
        );
      }
      if (vertices.includes(vertex)) {
        throw new Error(`${caller}: cell ${cellIndex} repeats vertex ${vertex}`);
      }
      vertices.push(vertex);
    }
    const restPositions = vertices.map((vertex) => {
      const point = source.getPosition(vertex);
      for (let axis = 0; axis < dimension; axis++) {
        if (!Number.isFinite(point[axis])) {
          throw new Error(`${caller}: source vertex ${vertex} is not finite`);
        }
      }
      return new VecN(Float64Array.from(point.slice(0, dimension)));
    });
    cells.push({
      cellIndex,
      reference: createSourceCellReferenceN(source, group, cellIndex),
      vertices: Object.freeze(vertices),
      restPositions: Object.freeze(restPositions)
    });
  }

  // Canonical face key: sorted source-vertex tuple, compared numerically.
  // Sorting the tuple as a string would place vertex 10 before vertex 9 and
  // silently reorder hinges on any mesh with more than ten vertices.
  const incidence = new Map<string, number[]>();
  for (const cell of cells) {
    for (let omit = 0; omit < cell.vertices.length; omit++) {
      const face = cell.vertices
        .filter((_, slot) => slot !== omit)
        .slice()
        .sort((left, right) => left - right);
      const key = face.join(',');
      const owners = incidence.get(key);
      if (owners === undefined) incidence.set(key, [cell.cellIndex]);
      else owners.push(cell.cellIndex);
    }
  }

  const keys = [...incidence.keys()].sort((left, right) => {
    const a = left.split(',').map(Number);
    const b = right.split(',').map(Number);
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      if (a[index] !== b[index]) return a[index]! - b[index]!;
    }
    return a.length - b.length;
  });

  const hinges: XpbdSourceSimplexBendingHingeN[] = [];
  let boundaryFaceCount = 0;
  for (const key of keys) {
    const owners = incidence.get(key)!.slice().sort((left, right) => left - right);
    const sharedVertices = key.split(',').map(Number);
    if (owners.length === 1) { boundaryFaceCount++; continue; }
    if (owners.length > 2) {
      // All-or-nothing: pairing two of three incident cells would invent an
      // adjacency the source never authored.
      throw new Error(
        `${caller}: face [${sharedVertices.join(', ')}] has ${owners.length} ` +
        'incident cells; a non-manifold face has no unambiguous hinge'
      );
    }
    const [indexA, indexB] = owners as [number, number];
    const cellA = cells[indexA]!;
    const cellB = cells[indexB]!;
    const apex = (cell: CompiledCellN): number => {
      const found = cell.vertices.find((vertex) => !sharedVertices.includes(vertex));
      if (found === undefined) {
        throw new Error(`${caller}: cell ${cell.cellIndex} has no vertex off its face`);
      }
      return found;
    };
    const oppositeVertexA = apex(cellA);
    const oppositeVertexB = apex(cellB);

    const restGeometry = evaluateSimplexHingeCosineN({
      sharedFace: sharedVertices.map((vertex) =>
        new VecN(Float64Array.from(source.getPosition(vertex).slice(0, dimension)))),
      oppositeA: new VecN(
        Float64Array.from(source.getPosition(oppositeVertexA).slice(0, dimension))),
      oppositeB: new VecN(
        Float64Array.from(source.getPosition(oppositeVertexB).slice(0, dimension))),
      tolerance
    });
    if (restGeometry.status === 'refused') {
      throw new Error(
        `${caller}: rest hinge on face [${sharedVertices.join(', ')}] is ` +
        `degenerate (${restGeometry.reason})`
      );
    }

    hinges.push(Object.freeze({
      id: `${options.id}/hinge/${sharedVertices.join('-')}`,
      sharedVertices: Object.freeze(sharedVertices),
      oppositeVertexA,
      oppositeVertexB,
      cellA: cellA.reference,
      cellB: cellB.reference,
      cellIdA: createSourceCellIdN(cellA.reference),
      cellIdB: createSourceCellIdN(cellB.reference),
      restCoordinate: restOption === 'source' ? restGeometry.coordinate : restOption,
      restHeightA: restGeometry.heightA,
      restHeightB: restGeometry.heightB,
      restConditioning: restGeometry.conditioning
    }));
  }

  return {
    hinges,
    boundaryFaceCount,
    cells,
    simplexDimension: group.dim,
    tolerance,
    conservativeScale,
    analysisOptions
  };
}

/** Refuses a family whose source topology or particle lineage has changed. */
function assertCurrentFamily(
  family: XpbdSourceSimplexCosineBendingFamilyN,
  caller: string
): void {
  const binding = family.binding;
  if (binding.source.ambientDim !== binding.dimension ||
    binding.source.vertexCount !== binding.particles.length ||
    binding.vertices.length !== binding.particles.length) {
    throw new Error(`${caller}: source vertex layout changed`);
  }
  for (let index = 0; index < binding.particles.length; index++) {
    if (binding.vertices[index]!.sourceVertexIndex !== index ||
      binding.vertices[index]!.particle !== binding.particles[index]) {
      throw new Error(`${caller}: source-particle lineage changed`);
    }
  }
  if (!family.source.groups.includes(family.simplexGroup)) {
    throw new Error(`${caller}: simplex group was removed from the source`);
  }
  if (family.compiledCells.length !==
    family.simplexGroup.indices.length / family.simplexGroup.verticesPerCell) {
    throw new Error(`${caller}: simplex layout changed`);
  }
  for (const cell of family.compiledCells) {
    const status = inspectSourceCellReferenceN(cell.reference);
    if (status.kind === 'retired') {
      throw new Error(
        `${caller}: source cell ${cell.cellIndex} is retired (${status.reason})`
      );
    }
  }
}
