import {
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  inspectSourceSimplexReferenceN,
  type CellGroup,
  type SourceSimplexReferenceN
} from '@holotope/core';
import {
  XpbdSourceSimplexPairBarrierN,
  XpbdSourceSimplexPairBarrierStepFilterN
} from './xpbd-source-simplex-pair-barrier.js';
import type { XpbdIncrementalPotentialStepFilterN } from './xpbd-incremental-potential-step-filter.js';
import type { XpbdParticleBindingN } from './xpbd-particle-binding.js';
import type { XpbdConservativeForceProviderN, XpbdWorldN } from './xpbd-world.js';

/** Construction options for one deformable-feature/static-feature family. */
export interface CompileXpbdSourceSimplexPairBarrierFamilyNOptions {
  /** Stable family identity and per-cell barrier/filter ID prefix. */
  readonly id: string;
  /** Authoritative source-vertex to particle mapping for the deforming side. */
  readonly binding: XpbdParticleBindingN;
  /** Simplicial group of `binding.source` supplying the deforming features. */
  readonly simplexGroup: CellGroup;
  /** One static opposing source feature; refused by name when retired. */
  readonly obstacle: SourceSimplexReferenceN;
  /** Open unsigned distance boundary shared by every pair. Default zero. */
  readonly minimumDistance?: number;
  /** Distance at and above which every pair's energy is exactly zero. */
  readonly activationDistance: number;
  /** Positive energy scale shared by every pair. */
  readonly stiffness: number;
  /** Relative affine-rank tolerance forwarded to each query. Default `1e-10`. */
  readonly rankTolerance?: number;
  /** Fraction of each certified prefix retained by the filters. Default `0.9`. */
  readonly conservativeScale?: number;
}

/** A compiled family: one pair barrier and one paired filter per source cell. */
export class XpbdSourceSimplexPairBarrierFamilyN {
  /** Stable family identity. */
  readonly id: string;
  /** One barrier per cell of the deforming group, in cell order. */
  readonly barriers: readonly XpbdSourceSimplexPairBarrierN[];
  /** The barriers, as the provider list a world step consumes. */
  readonly providers: readonly XpbdConservativeForceProviderN[];
  /** One paired filter per barrier, in the same cell order. */
  readonly stepFilters: readonly XpbdIncrementalPotentialStepFilterN[];
  /** The deforming feature references, one per cell, in cell order. */
  readonly features: readonly SourceSimplexReferenceN[];
  /** The shared static opposing feature. */
  readonly obstacle: SourceSimplexReferenceN;

  private constructor(
    id: string,
    barriers: readonly XpbdSourceSimplexPairBarrierN[],
    features: readonly SourceSimplexReferenceN[],
    obstacle: SourceSimplexReferenceN,
    conservativeScale: number
  ) {
    this.id = id;
    this.barriers = barriers;
    this.providers = barriers;
    this.features = features;
    this.obstacle = obstacle;
    this.stepFilters = Object.freeze(barriers.map((barrier, cellIndex) =>
      new XpbdSourceSimplexPairBarrierStepFilterN({
        id: `${id}-filter-${cellIndex}`,
        barrier,
        conservativeScale
      })));
  }

  /**
   * Compiles one pair barrier and one paired step filter per source cell of a
   * deforming simplicial group against one static opposing feature.
   *
   * The energy is the **sum over source cells** of the pair barrier. One
   * *candidate pair* is emitted per source cell by construction — but that is
   * not the same as one term per contact, and the difference is the limitation
   * to understand before tuning a stiffness.
   *
   * When the closest approach falls on a sub-feature shared by several cells,
   * every one of those cells produces a term **naming the same witness point at
   * the same distance**: a contact under an edge shared by two cells is one
   * physical interaction entering the potential twice (measured: identical
   * witness pair, identical distance, exactly 2× the energy), and a refinement
   * that puts several cells at the contact multiplies it again by however many
   * of them are equidistant — 4× when four are, less when they are not (a
   * mid-edge-split refinement measured 3.63×). Effective contact stiffness
   * therefore follows local mesh topology: an edge contact is stiffer than an
   * interior contact on the same surface.
   *
   * This is the familiar behaviour of per-element penalty contact, and it does
   * not weaken the barrier — non-penetration still holds, every individual term
   * is independently correct, and forces still conserve. It is *not* the same
   * shape of dependence as the cosine bending family's: a bending hinge is a
   * distinct entity appearing in exactly one term, whereas a shared contact
   * feature appears in several. A decomposition that counted each geometric
   * feature pair once (point–cell and edge–edge, as the published feature-pair
   * literature does) would not duplicate; this family deliberately does not
   * attempt that, and says so rather than averaging it away. A stiffness tuned
   * on one mesh does not transfer to a refinement of it, nor across regions of
   * differing local connectivity.
   *
   * Registration order changes nothing; reversing a cell's vertex order
   * permutes its weights and changes no scalar.
   *
   * Every per-pair semantics is the barrier's own: tied witnesses, certified
   * zero distance, uncertified comparisons, and the open minimum refuse by
   * type instead of fabricating a force. The paired filters certify each
   * proposed segment by the two-sided Lipschitz bound, per cell.
   */
  static compile(
    options: CompileXpbdSourceSimplexPairBarrierFamilyNOptions
  ): XpbdSourceSimplexPairBarrierFamilyN {
    const caller = 'compileXpbdSourceSimplexPairBarrierFamilyN';
    if (typeof options !== 'object' || options === null) {
      throw new Error(`${caller}: options must be an object`);
    }
    const unknown = Object.keys(options).filter((key) => ![
      'id', 'binding', 'simplexGroup', 'obstacle', 'minimumDistance',
      'activationDistance', 'stiffness', 'rankTolerance', 'conservativeScale'
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
    const binding = options.binding;
    if (typeof binding !== 'object' || binding === null ||
        typeof binding.particleForSourceVertex !== 'function') {
      throw new Error(`${caller}: binding must be an XpbdParticleBindingN`);
    }
    const group = options.simplexGroup;
    if (typeof group !== 'object' || group === null || group.kind !== 'simplex') {
      throw new Error(`${caller}: simplexGroup must be a simplicial CellGroup`);
    }
    const obstacleStatus = inspectSourceSimplexReferenceN(options.obstacle);
    if (obstacleStatus.kind === 'retired') {
      throw new Error(`${caller}: obstacle is retired (${obstacleStatus.reason})`);
    }
    const source = binding.source;
    if (!source.groups.includes(group)) {
      throw new Error(`${caller}: simplexGroup does not belong to the binding's source`);
    }
    const conservativeScale = options.conservativeScale ?? 0.9;
    const cellCount = group.indices.length / group.verticesPerCell;
    if (cellCount === 0) {
      throw new Error(`${caller}: simplexGroup has no cells`);
    }
    const barriers: XpbdSourceSimplexPairBarrierN[] = [];
    const features: SourceSimplexReferenceN[] = [];
    for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
      const feature = createSourceSimplexReferenceN(
        createSourceCellReferenceN(source, group, cellIndex)
      );
      features.push(feature);
      barriers.push(new XpbdSourceSimplexPairBarrierN({
        id: `${options.id}-${cellIndex}`,
        particlesA: feature.vertexIndices.map(
          (vertexIndex) => binding.particleForSourceVertex(vertexIndex)
        ),
        featureA: feature,
        featureB: options.obstacle,
        ...(options.minimumDistance !== undefined
          ? { minimumDistance: options.minimumDistance }
          : {}),
        activationDistance: options.activationDistance,
        stiffness: options.stiffness,
        ...(options.rankTolerance !== undefined
          ? { rankTolerance: options.rankTolerance }
          : {})
      }));
    }
    return new XpbdSourceSimplexPairBarrierFamilyN(
      options.id,
      Object.freeze(barriers),
      Object.freeze(features),
      options.obstacle,
      conservativeScale
    );
  }

  /** Registers every barrier as a force provider of one world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    for (const barrier of this.barriers) world.addForceProvider(barrier);
    return world;
  }
}

/**
 * Compiles a source-retained deformable-feature/static-feature contact family:
 * one {@link XpbdSourceSimplexPairBarrierN} and one paired step filter per
 * source cell. See {@link XpbdSourceSimplexPairBarrierFamilyN.compile} for
 * the discretization-defined energy-density contract this family states
 * openly.
 *
 * @example
 * A two-triangle sheet patch against a static tetrahedral spike — the P53d
 * configuration where every sheet vertex is legally separated while a
 * triangle interior is pierced, which point-only contact cannot see:
 * ```ts
 * const sheet = new CellComplex(4, Float64Array.from([
 *   0, 0, 0, 1.2,
 *   1, 0, 0, 1.2,
 *   0, 1, 0, 1.2,
 *   1, 1, 0, 1.2
 * ]), [{ dim: 2, verticesPerCell: 3, kind: 'simplex',
 *        indices: Uint32Array.from([0, 1, 2, 1, 3, 2]) }]);
 * const obstacle = new CellComplex(4, Float64Array.from([
 *   0.3, 0.3, 0, -0.5,
 *   0.3, 0.3, 0, 0.9,
 *   0.55, 0.1, 0.08, -0.5,
 *   0.1, 0.55, -0.08, -0.5
 * ]), [{ dim: 3, verticesPerCell: 4, kind: 'simplex',
 *        indices: Uint32Array.from([0, 1, 2, 3]) }]);
 * const sheetGroup = sheet.groups[0];
 * const spikeGroup = obstacle.groups[0];
 * if (sheetGroup === undefined || spikeGroup === undefined) {
 *   throw new Error('expected both authored groups');
 * }
 * const binding = compileXpbdParticleBindingN({ id: 'sheet', source: sheet });
 * const family = compileXpbdSourceSimplexPairBarrierFamilyN({
 *   id: 'contact',
 *   binding,
 *   simplexGroup: sheetGroup,
 *   obstacle: createSourceSimplexReferenceN(
 *     createSourceCellReferenceN(obstacle, spikeGroup, 0)
 *   ),
 *   activationDistance: 0.25,
 *   stiffness: 3
 * });
 * log('pairs', family.barriers.length); // 2 — one per sheet triangle
 *
 * const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
 * binding.addToWorld(world);
 * family.addToWorld(world);
 * const advance = stepXpbdIncrementalPotentialWorldN({
 *   world,
 *   deltaTime: 0.01,
 *   stepFilters: family.stepFilters,
 *   warmStart: 'feasible-inertial-prediction',
 *   minimization: { directionPolicy: 'steepest-descent' }
 * });
 * log('step', advance.step.status);
 *
 * // The witness explains WHICH features carried an active term, or refuses
 * // by type when no unique gradient exists.
 * const first = family.barriers[0];
 * if (first === undefined) throw new Error('expected a compiled barrier');
 * try {
 *   const evaluation = first.evaluate();
 *   log('distance', evaluation.distance);
 *   log('weights', evaluation.pair.witness.coordinateA.weights);
 * } catch (refusal) {
 *   log('typed refusal', String(refusal));
 * }
 * ```
 */
export function compileXpbdSourceSimplexPairBarrierFamilyN(
  options: CompileXpbdSourceSimplexPairBarrierFamilyNOptions
): XpbdSourceSimplexPairBarrierFamilyN {
  return XpbdSourceSimplexPairBarrierFamilyN.compile(options);
}
