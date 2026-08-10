/**
 * Headless composition example for one lagged friction transaction.
 *
 * Deliberately unrouted: it demonstrates the *lifecycle* a dissipative
 * contact term requires — freeze a lag at an accepted state, minimize against
 * that frozen snapshot, then commit or roll it back — without choosing a
 * camera, material, layout, or interaction policy.
 *
 * The distinction this example exists to make concrete is easy to state and
 * easy to get wrong: the term is conservative **only while one lag is held**.
 * That is what lets a line search evaluate it repeatedly and see one
 * consistent objective. Dissipation happens between accepted states, when the
 * lag is refreshed. It is therefore not the post-projection Coulomb velocity
 * response (`XpbdParticleHyperplaneFrictionN`), which the incremental path
 * refuses on purpose, and not a globally conservative physical force.
 *
 * Both live branches appear here: a sticking evaluation at zero slip and a
 * saturated sliding one sitting exactly on the Coulomb bound, plus a typed
 * refusal from a pair that cannot supply a friction frame at all.
 */
import {
  CellComplex,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN
} from '@holotope/core';
import {
  XpbdPotentialDomainErrorN,
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexPairBarrierFamilyN,
  compileXpbdSourceSimplexPairFrictionFamilyN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdSourceSimplexPairFrictionEvaluationN,
  type XpbdSourceSimplexPairFrictionFamilyN,
  type XpbdSourceSimplexPairFrictionLagN,
  type XpbdSourceSimplexPairFrictionPreparationN,
  type XpbdSourceSimplexPairFrictionRegimeN,
  type XpbdSourceSimplexPairFrictionSkipN
} from '@holotope/physics';

/** What one prepared-and-executed friction transaction reveals. */
export interface LaggedFrictionContractReport {
  /** How many contact pairs produced a friction term this iteration. */
  readonly preparedTerms: number;
  /** Pairs that could not supply a frame, with their typed reasons. */
  readonly skipped: readonly XpbdSourceSimplexPairFrictionSkipN[];
  /** Regime at zero slip — the sticking branch, reached live. */
  readonly restingRegime: XpbdSourceSimplexPairFrictionRegimeN;
  /** Regime under a large tangential displacement — the saturated branch. */
  readonly slidingRegime: XpbdSourceSimplexPairFrictionRegimeN;
  /**
   * Whether the sliding probe's term can exert force at all.
   *
   * Reported beside the regime, never inferred from it. The two answer
   * different questions — regime is about slip, activity is about the lagged
   * normal force — and a term can read `'sliding'` while exerting exactly
   * nothing.
   */
  readonly slidingContactActive: boolean;
  /**
   * The regularization length this lag was frozen with, in world length units.
   *
   * Under an authored slip length it is that length; under an authored slip
   * velocity it is `velocity * deltaTime`, resolved once when the lag froze
   * and constant for as long as the lag is held.
   */
  readonly regularizationLength: number;
  /** `mu * laggedNormalForce`: the bound the tangential force may not exceed. */
  readonly forceLimit: number;
  /** How far the saturated force sits from that bound; ~0 when sliding. */
  readonly saturationResidual: number;
  /** The P56 margin that justified freezing this frame. */
  readonly uniquenessGap: number;
  /** Certified pair distance at the accepted base. */
  readonly baseDistance: number;
  /** Authored world providers, unchanged by the transaction. */
  readonly authoredProviderIds: readonly string[];
  /** The transaction's transient terms, reported separately. */
  readonly preparedProviderIds: readonly string[];
  /** Status of the delegated step. */
  readonly stepStatus: string;
  /** Lag state after commit-or-rollback. */
  readonly lagStateAfterStep: string;
  /** A typed refusal from a pair that cannot carry friction at all. */
  readonly refusalReason: string;
  /** Slip magnitude under the sliding probe, from the evaluation itself. */
  readonly slidingSlip: number;
  /** How far the slip vector departs from the frozen tangent plane; ~0. */
  readonly slipNormalComponent: number;
  /** The lagged normal magnitude the Coulomb bound was built from. */
  readonly laggedNormalForce: number;
  /** Distance between the frozen base witness points; equals `baseDistance`. */
  readonly baseWitnessSeparation: number;
}

function sheetComplex(): CellComplex {
  return new CellComplex(4, Float64Array.from([
    0, 0, 0, 1.2,
    1, 0, 0, 1.2,
    0, 1, 0, 1.2,
    1, 1, 0, 1.2
  ]), [{
    dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
  }]);
}

function supportComplex(): CellComplex {
  return new CellComplex(4, Float64Array.from([
    0.3, 0.3, 0, -0.5,
    0.3, 0.3, 0, 0.9,
    0.55, 0.1, 0.08, -0.5,
    0.1, 0.55, -0.08, -0.5
  ]), [{
    dim: 3, verticesPerCell: 4, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 3])
  }]);
}

/**
 * Runs one complete lag iteration and reports what survived the call.
 *
 * @example
 * The whole lifecycle in one call, with the distinctions that matter read
 * back off the report:
 * ```ts
 * const report = runLaggedFrictionContract();
 *
 * // Both branches of the regularized law are live, not merely constructed.
 * log('at rest', report.restingRegime);        // 'sticking'
 * log('displaced', report.slidingRegime);      // 'sliding'
 * log('slip', report.slidingSlip);
 * // Regime is about slip; activity is about the lagged normal force. Read
 * // both — a term can report 'sliding' while exerting exactly nothing.
 * log('active', report.slidingContactActive);  // true
 * // The scale that decided which branch, frozen with the lag.
 * log('eps', report.regularizationLength);     // 1e-3, the authored length
 * // The slip never leaves the frozen tangent plane.
 * log('off-plane', report.slipNormalComponent); // ~0
 *
 * // Coulomb is a bound, not an identity: the force equals mu * lambda only
 * // when saturated, which is what `saturationResidual` being ~0 shows here.
 * log('limit', report.forceLimit, 'from', report.laggedNormalForce);
 * log('residual', report.saturationResidual);
 *
 * // The frozen frame is justified by a measured P56 margin, and the base
 * // witness separation is exactly the certified distance.
 * log('margin', report.uniquenessGap);
 * log('distance', report.baseDistance, report.baseWitnessSeparation);
 *
 * // Transient terms never merge into the world's authored registry.
 * log('authored', report.authoredProviderIds);
 * log('prepared', report.preparedProviderIds);
 * log('step', report.stepStatus, 'lag now', report.lagStateAfterStep);
 *
 * // A pair with no unique frame refuses by type instead of inventing one.
 * log('refusal', report.refusalReason);
 * log('terms', report.preparedTerms, 'skipped', report.skipped.length);
 * ```
 */
export function runLaggedFrictionContract(): LaggedFrictionContractReport {
  const sheet = sheetComplex();
  const support = supportComplex();
  const sheetGroup = sheet.groups[0];
  const supportGroup = support.groups[0];
  if (sheetGroup === undefined || supportGroup === undefined) {
    throw new Error('runLaggedFrictionContract: expected both authored groups');
  }

  const binding = compileXpbdParticleBindingN({ id: 'sheet', source: sheet });
  const contact = compileXpbdSourceSimplexPairBarrierFamilyN({
    id: 'contact',
    binding,
    simplexGroup: sheetGroup,
    obstacle: createSourceSimplexReferenceN(
      createSourceCellReferenceN(support, supportGroup, 0)
    ),
    // Comfortably beyond the 0.3 separation this scene sets up. At exactly 0.3
    // the clamped-log barrier is zero by construction, so the lag would freeze a
    // ~1e-31 normal force: `contactActive` would still read `true`, correctly,
    // while the Coulomb bound it reports carried no physical meaning. This
    // example exists to show a force-carrying contact next to an inert one, so
    // the active side has to actually press.
    activationDistance: 0.6,
    stiffness: 3
  });
  const friction: XpbdSourceSimplexPairFrictionFamilyN =
    compileXpbdSourceSimplexPairFrictionFamilyN({
      id: 'friction',
      contact,
      frictionCoefficient: 0.5,
      // A LENGTH in world units — not a velocity threshold, and not scaled by
      // the timestep. Slip below it is regularized; above it, saturated.
      slipRegularization: 1e-3
    });

  const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
  binding.addToWorld(world);
  contact.addToWorld(world);

  // 1. Freeze one lag per contact pair at the accepted state.
  const preparation: XpbdSourceSimplexPairFrictionPreparationN = friction.prepare();
  const first = preparation.prepared[0];
  if (first === undefined) {
    throw new Error('runLaggedFrictionContract: no contact pair could carry friction');
  }
  const lag: XpbdSourceSimplexPairFrictionLagN = first.lag;

  // 2. Both live branches of the regularized Coulomb law.
  const resting: XpbdSourceSimplexPairFrictionEvaluationN = first.evaluate();
  const sliding = first.evaluateAt((particle) => {
    const position = particle.position.clone();
    position.data[0] = position.data[0]! + 0.05;
    return position;
  });

  // 3. Minimize against the frozen lag. Prepared providers are transient and
  //    reported separately from the world's authored registry.
  const advance = stepXpbdIncrementalPotentialWorldN({
    world,
    deltaTime: 0.01,
    stepFilters: contact.stepFilters,
    preparedProviders: preparation.prepared,
    warmStart: 'feasible-inertial-prediction',
    minimization: { directionPolicy: 'steepest-descent' }
  });

  // 4. Commit or roll back with the step the lag was minimized against.
  if (advance.step.status === 'applied') preparation.markConsumed();
  else preparation.rollback();

  // 5. A pair that cannot supply a frame refuses by type rather than
  //    fabricating one. Exactly parallel features are the canonical case.
  const parallelSheet = new CellComplex(4, Float64Array.from([
    -1, 0.5, 0, 0, 1, 0.5, 0, 0, 0, 1.5, 0, 0
  ]), [{
    dim: 2, verticesPerCell: 3, kind: 'simplex', indices: Uint32Array.from([0, 1, 2])
  }]);
  const parallelSupport = new CellComplex(4, Float64Array.from([
    -1, 0, 0, 0, 1, 0, 0, 0
  ]), [{
    dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from([0, 1])
  }]);
  const parallelSheetGroup = parallelSheet.groups[0];
  const parallelSupportGroup = parallelSupport.groups[0];
  let refusalReason = 'none';
  if (parallelSheetGroup !== undefined && parallelSupportGroup !== undefined) {
    const parallelBinding = compileXpbdParticleBindingN({
      id: 'parallel', source: parallelSheet
    });
    const parallelContact = compileXpbdSourceSimplexPairBarrierFamilyN({
      id: 'parallel-contact',
      binding: parallelBinding,
      simplexGroup: parallelSheetGroup,
      obstacle: createSourceSimplexReferenceN(
        createSourceCellReferenceN(parallelSupport, parallelSupportGroup, 0)
      ),
      activationDistance: 0.3,
      stiffness: 3
    });
    const parallelFriction = compileXpbdSourceSimplexPairFrictionFamilyN({
      id: 'parallel-friction',
      contact: parallelContact,
      frictionCoefficient: 0.5,
      slipRegularization: 1e-3
    });
    try {
      parallelFriction.terms[0]?.prepare();
    } catch (refusal) {
      refusalReason = refusal instanceof XpbdPotentialDomainErrorN
        ? refusal.reason
        : 'unexpected';
    }
  }

  // Read the frozen witness points and the slip vector directly: a field
  // nothing reads cannot influence a decision, and these are the evidence a
  // caller uses to explain a force after the fact.
  const baseWitnessSeparation = lag.basePointA.clone().sub(lag.basePointB).length();
  const slipNormalComponent = Math.abs(sliding.slip.dot(lag.normal));

  return {
    preparedTerms: preparation.prepared.length,
    skipped: preparation.skipped,
    restingRegime: resting.regime,
    slidingRegime: sliding.regime,
    slidingContactActive: sliding.contactActive,
    regularizationLength: lag.regularizationLength,
    forceLimit: sliding.forceLimit,
    saturationResidual: Math.abs(sliding.tangentForce.length() - sliding.forceLimit),
    uniquenessGap: lag.uniquenessGap,
    baseDistance: lag.baseDistance,
    authoredProviderIds: advance.selection.providerIds,
    preparedProviderIds: advance.selection.preparedProviderIds ?? [],
    stepStatus: advance.step.status,
    lagStateAfterStep: first.lag.state,
    refusalReason,
    slidingSlip: sliding.slipMagnitude,
    slipNormalComponent,
    laggedNormalForce: lag.laggedNormalForce,
    baseWitnessSeparation
  };
}
