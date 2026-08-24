import type { VecN } from '@holotope/core';
import {
  diagnoseXpbdIncrementalPotentialStepN,
  type XpbdIncrementalPotentialDiagnosisN
} from './xpbd-incremental-potential-diagnosis.js';
import {
  stepXpbdIncrementalPotentialN,
  type XpbdIncrementalPotentialApplicationPolicyN,
  type XpbdIncrementalPotentialMinimizationPolicyN,
  type XpbdIncrementalPotentialStepResultN
} from './xpbd-incremental-potential-step.js';
import type { XpbdIncrementalPotentialFeasibleWarmStartNOptions } from './xpbd-incremental-potential-feasible-base.js';
import type { XpbdIncrementalPotentialStepFilterN } from './xpbd-incremental-potential-step-filter.js';
import {
  XpbdWorldN,
  XpbdParticleN,
  type XpbdConservativeForceProviderN
} from './xpbd-world.js';

/**
 * One nonlinear advance of an authored world through the incremental-potential
 * transaction.
 *
 * The world is authoritative for dimension, particle order, gravity, and the
 * force-provider registry, so a caller stops repeating those four at every
 * step and they cannot drift from the world being rendered or inspected.
 *
 * Step filters stay explicit. `XpbdWorldN` owns no filter registry, and
 * inventing an implicit global one would make an ordered policy invisible at
 * the call site.
 */
export interface StepXpbdIncrementalPotentialWorldNOptions {
  /** Authoritative dimension, particle order, gravity, and provider registry. */
  readonly world: XpbdWorldN;
  /** Ordered admissible-segment filters; no implicit world registry exists. */
  readonly stepFilters?: readonly XpbdIncrementalPotentialStepFilterN[];
  /**
   * Transient conservative providers prepared for **this step only**, such as
   * a lagged friction term frozen at the accepted base state.
   *
   * They are deliberately not part of the world's authored registry: the world
   * stays authoritative for what a scene *is*, while these describe what one
   * transaction additionally minimizes against. They appear in the returned
   * selection evidence under their own field, never merged into
   * `providerIds`, so an authored base term and a transient lagged one are
   * always distinguishable after the fact. Supplying none leaves this step's
   * behaviour and its returned object exactly as they were.
   */
  readonly preparedProviders?: readonly XpbdConservativeForceProviderN[];
  /**
   * Physical interval, finite and strictly positive.
   *
   * A zero interval is not a cheap no-op step: it is not a physical
   * optimization step at all, and it is rejected exactly as negative and
   * non-finite intervals are. A render loop that can produce a zero elapsed
   * time should skip that frame rather than ask for a step of it.
   */
  readonly deltaTime: number;
  /**
   * Explicit minimizer base in the world's particle order.
   *
   * Takes precedence over `warmStart` and bypasses both feasible-base
   * recovery and the warm-start segment certification entirely, so a step
   * given one returns no `feasibleBaseRecovery` and no
   * `warmStartCertification` evidence. The coordinates are the caller's own
   * uncertified decision: no registered filter is consulted about the
   * movement to them.
   */
  readonly initialPositions?: readonly VecN[];
  /** Minimizer base when `initialPositions` is absent; see the lower step. */
  readonly warmStart?:
    | 'inertial-prediction'
    | 'previous-positions'
    | 'feasible-inertial-prediction';
  /**
   * Chord-sampling controls belonging to `feasible-inertial-prediction`.
   * Supplying them with another warm start is rejected, not ignored.
   */
  readonly feasibleWarmStart?: XpbdIncrementalPotentialFeasibleWarmStartNOptions;
  /** Direction policy, tolerances, and budgets for the bounded minimizer. */
  readonly minimization?: XpbdIncrementalPotentialMinimizationPolicyN;
  /** Velocity-reconstruction and force-clearing policy for a converged step. */
  readonly application?: XpbdIncrementalPotentialApplicationPolicyN;
}

/**
 * What the world contributed, captured before delegation.
 *
 * Identifiers rather than live objects: this is evidence about which registry
 * entries the step ran against, and it must stay readable after the particles
 * it names have moved.
 */
export interface XpbdIncrementalPotentialWorldSelectionN {
  /** Ambient dimension read from the world, not from the options. */
  readonly dimension: number;
  /** Every registered particle, in world registration order. */
  readonly particleIds: readonly string[];
  /** Every registered force provider, in authored world order. */
  readonly providerIds: readonly string[];
  /** The supplied filters, in supplied order; never sorted or deduplicated. */
  readonly stepFilterIds: readonly string[];
  /**
   * Transient prepared providers, in supplied order — present **only** when
   * some were supplied, so a step without them returns the object it always
   * did. Kept separate from `providerIds` on purpose: a reader must be able to
   * tell an authored scene term from a one-transaction lagged one.
   */
  readonly preparedProviderIds?: readonly string[];
}

/**
 * The complete result of one world-scoped advance.
 *
 * `step` is the unchanged lower-level result, not a simplified success flag —
 * every feasible-base trial, candidate record, Newton evidence, minimizer
 * terminal, and application refusal remains reachable through it.
 */
export interface XpbdIncrementalPotentialWorldStepN {
  /** Which registry entries this step ran against, captured before it ran. */
  readonly selection: XpbdIncrementalPotentialWorldSelectionN;
  /** The unchanged lower-level transaction result, refusals included. */
  readonly step: XpbdIncrementalPotentialStepResultN;
  /** That same result classified once, so no caller parses a message. */
  readonly diagnosis: XpbdIncrementalPotentialDiagnosisN;
}

const KNOWN_OPTION_KEYS: ReadonlySet<string> = new Set([
  'world',
  'stepFilters',
  'preparedProviders',
  'deltaTime',
  'initialPositions',
  'warmStart',
  'feasibleWarmStart',
  'minimization',
  'application'
]);

/**
 * Registries the incremental-potential transaction cannot represent.
 *
 * Projected scalar constraints, velocity responses, and state guards belong to
 * the world's own `step()` path. Running the optimization path while they are
 * registered would advance the scene as though they had been applied, so their
 * presence is a configuration error rather than something to ignore.
 */
const UNSUPPORTED_REGISTRIES = [
  { kind: 'scalar constraint', read: (world: XpbdWorldN) => world.constraints },
  { kind: 'velocity response', read: (world: XpbdWorldN) => world.velocityResponses },
  { kind: 'state guard', read: (world: XpbdWorldN) => world.stateGuards }
] as const;

/**
 * Advances one authored `XpbdWorldN` through the incremental-potential
 * transaction, once.
 *
 * This is orchestration, not a second solver. It derives the four
 * authoritative inputs from the world, refuses the registries the optimization
 * path cannot honor, delegates exactly once to
 * {@link stepXpbdIncrementalPotentialN}, and diagnoses that result once. Every
 * numeric decision — prediction, compilation, feasible-base recovery,
 * minimization, verification, application, rollback — belongs to the delegated
 * step and is unchanged here.
 *
 * A world has two solver paths and they are not interchangeable for one
 * physical interval. `world.step()` and `world.stepAdaptive()` run projected
 * XPBD with the registered constraints, responses, and guards; this runs the
 * nonlinear optimization transaction with conservative potentials only.
 * Choose one per interval. This function never calls either of the others.
 *
 * Configuration problems throw, because no physical step was attempted:
 * unknown option keys, an empty world, an unsupported registry, a
 * non-conservative provider. Mathematical and algorithmic outcomes stay typed
 * in the returned `step`, including every refusal — they are results, not
 * errors.
 *
 * @param options - The world, an explicit filter order, the interval, and the
 * warm-start/minimization/application policies the lower-level step accepts.
 * @returns Frozen selection evidence, the unchanged lower-level step, and its
 * diagnosis.
 * @throws If the options or the world's registries cannot express a legal
 * optimization step. Thrown before any particle is touched.
 *
 * @example
 * One R4 point falling onto a finite static tetrahedron. The world supplies
 * dimension, particle order, gravity, and the contact provider; only the
 * ordered filter and the interval are named at the call site.
 * ```ts
 * const point = new CellComplex(4, Float64Array.from([0.25, 0.25, 0.25, 0.06]), []);
 * const binding = compileXpbdParticleBindingN({ id: 'point', source: point });
 * for (const particle of binding.particles) particle.velocity.data[3] = -6;
 *
 * const obstacle = new CellComplex(
 *   4,
 *   Float64Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
 *   [{
 *     key: 'obstacle', dim: 3, verticesPerCell: 4, kind: 'simplex',
 *     indices: Uint32Array.from([0, 1, 2, 3])
 *   }]
 * );
 * const [face] = obstacle.cellsOfDim(3);
 * if (!face) throw new Error('the obstacle has no 3-cells');
 *
 * const contact = compileXpbdParticleSourceSimplexBarrierFamilyN({
 *   id: 'contact', binding, obstacle, simplexGroup: face,
 *   minimumDistance: 0.05, activationDistance: 0.8, stiffness: 1.7
 * });
 *
 * const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
 * binding.addToWorld(world);
 * contact.addToWorld(world);
 *
 * const advance = stepXpbdIncrementalPotentialWorldN({
 *   world,
 *   deltaTime: 1 / 120,
 *   stepFilters: [contact.stepFilter],
 *   warmStart: 'feasible-inertial-prediction',
 *   minimization: { directionPolicy: 'steepest-descent' }
 * });
 *
 * log(advance.selection.providerIds);  // ['contact'] — authored world order
 * log(advance.step.status);            // 'applied', or a typed refusal
 * log(advance.diagnosis.condition);    // why, without parsing a message
 * ```
 */
export function stepXpbdIncrementalPotentialWorldN(
  options: StepXpbdIncrementalPotentialWorldNOptions
): XpbdIncrementalPotentialWorldStepN {
  const caller = 'stepXpbdIncrementalPotentialWorldN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  for (const key of Object.keys(options)) {
    if (!KNOWN_OPTION_KEYS.has(key)) {
      throw new Error(`${caller}: unknown option "${key}"`);
    }
  }

  const world = options.world;
  if (!(world instanceof XpbdWorldN)) {
    throw new Error(`${caller}: world must be an XpbdWorldN`);
  }
  const particles = world.particles;
  if (particles.length === 0) {
    throw new Error(`${caller}: world has no registered particles`);
  }
  // Validated here as well as lower down. Delegating this one reached far
  // enough that the thrown message named `predictXpbdInertialStateN`, an
  // internal helper the caller never mentioned — so the first thing a reader
  // saw when asking for a zero-length step was a function they had not called.
  // The lower-level check stays; it guards the standalone entry point.
  if (!Number.isFinite(options.deltaTime) || options.deltaTime <= 0) {
    throw new Error(`${caller}: deltaTime must be finite and positive`);
  }

  // Refuse before anything is derived, so an unsupported world never reaches
  // the point of looking like a step that merely failed.
  for (const registry of UNSUPPORTED_REGISTRIES) {
    const entries = registry.read(world);
    const first = entries[0];
    if (first !== undefined) {
      throw new Error(
        `${caller}: the incremental-potential path cannot apply a registered ` +
          `${registry.kind} ("${first.id}"). Registered ${registry.kind}s run ` +
          'through world.step(); use one solver path per interval.'
      );
    }
  }

  // Authored order is preserved, and a mixed registry is a configuration
  // error rather than a silent selection of the conservative subset.
  const providers: XpbdConservativeForceProviderN[] = [];
  for (const provider of world.forceProviders) {
    if (typeof (provider as Partial<XpbdConservativeForceProviderN>).evaluateAt
      !== 'function') {
      throw new Error(
        `${caller}: registered force provider "${provider.id}" is not ` +
          'conservative — it defines no evaluateAt(positionOf), so the ' +
          'optimization path cannot represent it. Remove it or use world.step().'
      );
    }
    providers.push(provider as XpbdConservativeForceProviderN);
  }

  const stepFilters = options.stepFilters ?? [];
  if (!Array.isArray(stepFilters)) {
    throw new Error(`${caller}: stepFilters must be an array`);
  }

  // Prepared providers are validated against the authored world before
  // anything is derived: a colliding identity or a foreign particle is a
  // configuration error, not a step that merely failed.
  const preparedProviders = options.preparedProviders ?? [];
  if (!Array.isArray(preparedProviders)) {
    throw new Error(`${caller}: preparedProviders must be an array`);
  }
  if (preparedProviders.length > 0) {
    const authoredIds = new Set(providers.map((provider) => provider.id));
    const worldParticles = new Set<XpbdParticleN>(particles);
    const seen = new Set<string>();
    for (const prepared of preparedProviders) {
      if (typeof prepared !== 'object' || prepared === null ||
        typeof (prepared as Partial<XpbdConservativeForceProviderN>).evaluateAt
          !== 'function') {
        throw new Error(
          `${caller}: every prepared provider must be conservative — it must ` +
          'define evaluateAt(positionOf)'
        );
      }
      if (authoredIds.has(prepared.id)) {
        throw new Error(
          `${caller}: prepared provider "${prepared.id}" collides with an ` +
          'authored world force provider of the same id'
        );
      }
      if (seen.has(prepared.id)) {
        throw new Error(`${caller}: duplicate prepared provider id "${prepared.id}"`);
      }
      seen.add(prepared.id);
      for (const particle of prepared.particles) {
        if (!worldParticles.has(particle)) {
          throw new Error(
            `${caller}: prepared provider "${prepared.id}" names particle ` +
            `"${particle.id}", which this world does not own`
          );
        }
      }
    }
  }

  // Snapshotted before delegation and frozen, so a caller mutating its own
  // filter array afterwards cannot reshape the returned evidence. Duplicate
  // filter IDs are left for the existing compiler refusal rather than being
  // deduplicated here.
  const selection: XpbdIncrementalPotentialWorldSelectionN = Object.freeze({
    dimension: world.dimension,
    particleIds: Object.freeze(particles.map((particle) => particle.id)),
    providerIds: Object.freeze(providers.map((provider) => provider.id)),
    stepFilterIds: Object.freeze(stepFilters.map((filter) => filter.id)),
    // Conditional, so a step with no prepared provider returns the object it
    // returned before this option existed.
    ...(preparedProviders.length === 0 ? {} : {
      preparedProviderIds: Object.freeze(preparedProviders.map((provider) => provider.id))
    })
  });

  const step = stepXpbdIncrementalPotentialN({
    dimension: world.dimension,
    particles,
    // Authored order first, then the transaction's transient terms: the
    // world's registry stays authoritative and its order is never reshuffled.
    providers: preparedProviders.length === 0
      ? providers
      : [...providers, ...preparedProviders],
    gravity: world.gravity,
    stepFilters: stepFilters.slice(),
    deltaTime: options.deltaTime,
    ...(options.initialPositions === undefined
      ? {}
      : { initialPositions: options.initialPositions }),
    ...(options.warmStart === undefined ? {} : { warmStart: options.warmStart }),
    ...(options.feasibleWarmStart === undefined
      ? {}
      : { feasibleWarmStart: options.feasibleWarmStart }),
    ...(options.minimization === undefined
      ? {}
      : { minimization: options.minimization }),
    ...(options.application === undefined
      ? {}
      : { application: options.application })
  });

  return Object.freeze({
    selection,
    step,
    diagnosis: diagnoseXpbdIncrementalPotentialStepN(step)
  });
}
