import { XpbdPotentialDomainErrorN } from './xpbd-potential-domain.js';
import type { XpbdSourceSimplexPairBarrierFamilyN } from './xpbd-source-simplex-pair-barrier-family.js';
import {
  XpbdSourceSimplexPairFrictionN,
  normalizeXpbdSourceSimplexPairSlipRegularizationN,
  type XpbdPreparedSourceSimplexPairFrictionN,
  type XpbdSourceSimplexPairFrictionPrepareNOptions,
  type XpbdSourceSimplexPairFrictionPrepareRefusalN,
  type XpbdSourceSimplexPairResolvedSlipRegularizationN,
  type XpbdSourceSimplexPairSlipRegularizationN
} from './xpbd-source-simplex-pair-friction.js';

/** Construction options for one lagged friction family over a contact family. */
export interface CompileXpbdSourceSimplexPairFrictionFamilyNOptions {
  /** Stable family identity and per-term id prefix. */
  readonly id: string;
  /** The P56 contact family whose pairs, witnesses and filters are reused. */
  readonly contact: XpbdSourceSimplexPairBarrierFamilyN;
  /** Isotropic Coulomb coefficient shared by every term; `0` disables them. */
  readonly frictionCoefficient: number;
  /**
   * Slip regularization scale shared by every term.
   *
   * A bare number is a world length, unchanged. See
   * {@link XpbdSourceSimplexPairSlipRegularizationN} for the timestep-invariant
   * alternative and the measured reason it exists.
   */
  readonly slipRegularization: XpbdSourceSimplexPairSlipRegularizationN;
}

/** One contact pair that could not produce a friction term this step. */
export interface XpbdSourceSimplexPairFrictionSkipN {
  /** Index of the contact cell whose pair was skipped. */
  readonly cellIndex: number;
  /** Provider id the term would have carried. */
  readonly id: string;
  /** Why no lag was frozen — always a typed P56/domain reason. */
  readonly reason: XpbdSourceSimplexPairFrictionPrepareRefusalN;
}

/** The prepared terms of one lag iteration, plus what was legitimately skipped. */
export interface XpbdSourceSimplexPairFrictionPreparationN {
  /** One prepared term per contact cell that carried a certified unique pair. */
  readonly prepared: readonly XpbdPreparedSourceSimplexPairFrictionN[];
  /** Every pair that could not justify a term, with its typed reason. */
  readonly skipped: readonly XpbdSourceSimplexPairFrictionSkipN[];
  /** Marks every prepared term consumed, after an accepted applied step. */
  readonly markConsumed: () => void;
  /** Restores every prepared term after a refusal or a throw. */
  readonly rollback: () => void;
}

/**
 * One lagged friction term per source cell of a P56 contact family.
 *
 * It reuses rather than recomputes: the same source references, the same
 * certified witnesses, the same barrier force magnitude, the same particle
 * identities and source order, and the same conservative step filters. There
 * is **no obstacle-cell fan-out** — one contact pair yields at most one
 * friction term.
 *
 * ## Effective friction follows mesh topology, and this says so
 *
 * The P56 review established that one physical shared feature enters the
 * cell-wise contact potential more than once: a contact under an edge shared
 * by two cells produces two terms naming the same witness. Friction inherits
 * that exactly, because it is built from those same per-cell pairs — so the
 * **effective friction coefficient is not mesh-independent**. An edge contact
 * resists more than an interior contact on the same surface, and a refinement
 * that puts more cells at the contact resists more again.
 *
 * This family deliberately does not average duplicate witnesses away or
 * invent a continuum quadrature: both would hide a discretization fact behind
 * a number that looks physical. Tune `frictionCoefficient` for a mesh, and
 * re-measure it after a refinement.
 */
export class XpbdSourceSimplexPairFrictionFamilyN {
  /** Stable family identity. */
  readonly id: string;
  /** The contact family this friction rides on. */
  readonly contact: XpbdSourceSimplexPairBarrierFamilyN;
  /** One friction term per contact cell, in the contact family's cell order. */
  readonly terms: readonly XpbdSourceSimplexPairFrictionN[];
  /** Shared Coulomb coefficient. */
  readonly frictionCoefficient: number;
  /** Shared regularization scale, normalized to its discriminated form. */
  readonly slipRegularization: XpbdSourceSimplexPairResolvedSlipRegularizationN;

  private constructor(
    id: string,
    contact: XpbdSourceSimplexPairBarrierFamilyN,
    terms: readonly XpbdSourceSimplexPairFrictionN[],
    frictionCoefficient: number,
    slipRegularization: XpbdSourceSimplexPairResolvedSlipRegularizationN
  ) {
    this.id = id;
    this.contact = contact;
    this.terms = terms;
    this.frictionCoefficient = frictionCoefficient;
    this.slipRegularization = slipRegularization;
  }

  /** Compiles one friction term per contact pair. */
  static compile(
    options: CompileXpbdSourceSimplexPairFrictionFamilyNOptions
  ): XpbdSourceSimplexPairFrictionFamilyN {
    const caller = 'compileXpbdSourceSimplexPairFrictionFamilyN';
    if (typeof options !== 'object' || options === null) {
      throw new Error(`${caller}: options must be an object`);
    }
    const unknown = Object.keys(options).filter((key) => ![
      'id', 'contact', 'frictionCoefficient', 'slipRegularization'
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
    const contact = options.contact;
    if (typeof contact !== 'object' || contact === null ||
        !Array.isArray(contact.barriers)) {
      throw new Error(`${caller}: contact must be an XpbdSourceSimplexPairBarrierFamilyN`);
    }
    const terms = contact.barriers.map((barrier, cellIndex) =>
      new XpbdSourceSimplexPairFrictionN({
        id: `${options.id}-${cellIndex}`,
        barrier,
        frictionCoefficient: options.frictionCoefficient,
        slipRegularization: options.slipRegularization
      }));
    return new XpbdSourceSimplexPairFrictionFamilyN(
      options.id, contact, Object.freeze(terms),
      options.frictionCoefficient,
      // Normalized once here so a family with no contact cells still refuses a
      // malformed scale, rather than accepting it because no term validated it.
      normalizeXpbdSourceSimplexPairSlipRegularizationN(
        options.slipRegularization, caller
      )
    );
  }

  /**
   * Freezes one lag per contact pair at the current accepted state.
   *
   * A pair that cannot justify a term — tied, zero-distance, uncertified, or
   * below the barrier's minimum — is **skipped with its typed reason**, never
   * given a fabricated frame and never silently dropped. The returned
   * preparation carries both lists plus atomic consume/rollback over all of
   * them, so a partially consumed family is not representable.
   */
  prepare(
    options?: XpbdSourceSimplexPairFrictionPrepareNOptions
  ): XpbdSourceSimplexPairFrictionPreparationN {
    const prepared: XpbdPreparedSourceSimplexPairFrictionN[] = [];
    const skipped: XpbdSourceSimplexPairFrictionSkipN[] = [];
    this.terms.forEach((term, cellIndex) => {
      try {
        prepared.push(term.prepare(options));
      } catch (error) {
        if (error instanceof XpbdPotentialDomainErrorN) {
          skipped.push({
            cellIndex,
            id: term.id,
            reason: error.reason as XpbdSourceSimplexPairFrictionPrepareRefusalN
          });
          return;
        }
        throw error;
      }
    });
    const frozenPrepared = Object.freeze([...prepared]);
    return Object.freeze({
      prepared: frozenPrepared,
      skipped: Object.freeze(skipped),
      markConsumed: (): void => {
        for (const term of frozenPrepared) term.markConsumed();
      },
      rollback: (): void => {
        for (const term of frozenPrepared) term.rollback();
      }
    });
  }
}

/**
 * Compiles a lagged friction family over a P56 contact family: one term per
 * source cell, reusing that family's references, witnesses, barrier force
 * magnitudes, particle identities and step filters.
 *
 * See {@link XpbdSourceSimplexPairFrictionFamilyN} for the mesh-topology
 * dependence this states rather than averages away.
 *
 * @example
 * One lag iteration end to end, with every typed branch handled:
 * ```ts
 * const sheet = new CellComplex(4, Float64Array.from([
 *   0, 0, 0, 1.2, 1, 0, 0, 1.2, 0, 1, 0, 1.2, 1, 1, 0, 1.2
 * ]), [{ dim: 2, verticesPerCell: 3, kind: 'simplex',
 *        indices: Uint32Array.from([0, 1, 2, 1, 3, 2]) }]);
 * const support = new CellComplex(4, Float64Array.from([
 *   0.3, 0.3, 0, -0.5, 0.3, 0.3, 0, 0.9,
 *   0.55, 0.1, 0.08, -0.5, 0.1, 0.55, -0.08, -0.5
 * ]), [{ dim: 3, verticesPerCell: 4, kind: 'simplex',
 *        indices: Uint32Array.from([0, 1, 2, 3]) }]);
 * const sheetGroup = sheet.groups[0];
 * const supportGroup = support.groups[0];
 * if (sheetGroup === undefined || supportGroup === undefined) {
 *   throw new Error('expected both authored groups');
 * }
 * const binding = compileXpbdParticleBindingN({ id: 'sheet', source: sheet });
 * const contact = compileXpbdSourceSimplexPairBarrierFamilyN({
 *   id: 'contact', binding, simplexGroup: sheetGroup,
 *   obstacle: createSourceSimplexReferenceN(
 *     createSourceCellReferenceN(support, supportGroup, 0)
 *   ),
 *   activationDistance: 0.3, stiffness: 3
 * });
 * const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
 * binding.addToWorld(world);
 * contact.addToWorld(world);
 *
 * const friction = compileXpbdSourceSimplexPairFrictionFamilyN({
 *   id: 'friction', contact, frictionCoefficient: 0.4, slipRegularization: 1e-3
 * });
 *
 * const preparation = friction.prepare();
 * log('terms', preparation.prepared.length);
 * for (const skip of preparation.skipped) {
 *   log('no friction for cell', skip.cellIndex, skip.reason);
 * }
 *
 * const advance = stepXpbdIncrementalPotentialWorldN({
 *   world,
 *   deltaTime: 0.01,
 *   stepFilters: contact.stepFilters,        // the P56 filters, reused
 *   preparedProviders: preparation.prepared, // transient, this step only
 *   warmStart: 'feasible-inertial-prediction',
 *   minimization: { directionPolicy: 'steepest-descent' }
 * });
 *
 * // Commit or roll the lag back with the step it was minimized against.
 * if (advance.step.status === 'applied') preparation.markConsumed();
 * else preparation.rollback();
 * ```
 */
export function compileXpbdSourceSimplexPairFrictionFamilyN(
  options: CompileXpbdSourceSimplexPairFrictionFamilyNOptions
): XpbdSourceSimplexPairFrictionFamilyN {
  return XpbdSourceSimplexPairFrictionFamilyN.compile(options);
}
