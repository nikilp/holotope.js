import { VecN } from '@holotope/core';
import {
  applyXpbdIncrementalPotentialResultN,
  type XpbdIncrementalPotentialApplicationRefusedN,
  type XpbdIncrementalPotentialAppliedN,
  type XpbdIncrementalPotentialVelocityUpdateN
} from './xpbd-incremental-potential-application.js';
import {
  predictXpbdInertialStateN,
  type XpbdInertialPredictionN
} from './xpbd-incremental-potential.js';
import {
  minimizeXpbdIncrementalPotentialN,
  type XpbdIncrementalPotentialConvergedN,
  type XpbdIncrementalPotentialConvergenceN,
  type XpbdIncrementalPotentialMinimizationResultN
} from './xpbd-incremental-potential-minimizer.js';
import {
  recoverXpbdIncrementalPotentialFeasibleBaseN,
  type RecoverXpbdIncrementalPotentialFeasibleBaseNOptions,
  type XpbdIncrementalPotentialFeasibleWarmStartNOptions,
  type XpbdIncrementalPotentialFeasibleBaseResultN
} from './xpbd-incremental-potential-feasible-base.js';
import {
  type XpbdIncrementalPotentialDirectionPolicyN,
  type XpbdIncrementalPotentialDirectionPolicyNameN
} from './xpbd-incremental-potential-direction.js';
import {
  certifyXpbdIncrementalPotentialWarmStartN,
  compileXpbdIncrementalPotentialProblemN,
  type XpbdCertifiedWarmStartBaseN,
  type XpbdIncrementalPotentialProblemN,
  type XpbdIncrementalPotentialWarmStartCertificationN
} from './xpbd-incremental-potential-problem.js';
import {
  type XpbdIncrementalPotentialStepFilterN
} from './xpbd-incremental-potential-step-filter.js';
import {
  resolveXpbdIncrementalPotentialStepDirectionN
} from './xpbd-incremental-potential-step-direction.js';
import {
  XpbdParticleN,
  type XpbdConservativeForceProviderN
} from './xpbd-world.js';

export interface XpbdIncrementalPotentialMinimizationPolicyN {
  /**
   * Stop test to apply; defaults to `'packed-gradient'` at `1e-8`.
   *
   * The safe first choice for a scene whose timestep may change is
   * `{ kind: 'maximum-acceleration-residual', tolerance }`, which bounds the
   * residual acceleration left on the worst-resolved free particle and holds
   * that bound under refinement. It is not the better criterion outright: it
   * buys that stability by scattering the per-step position residual, and it
   * is the first choice under a changing timestep only because the failure it
   * removes is a real force dropped in silence. `'packed-gradient'` is the
   * legacy criterion described below, kept exactly as it was, and remains the
   * right choice at a fixed timestep or when position error is the budget.
   *
   * Mutually exclusive with {@link gradientTolerance}; authoring both is
   * refused before the step mutates anything.
   */
  readonly convergence?: XpbdIncrementalPotentialConvergenceN;
  /**
   * Absolute packed-gradient norm tolerance; default `1e-8`.
   *
   * The objective is `½‖x − x̃‖²_M + deltaTime² · U(x)`, so a potential's
   * contribution to this gradient carries the `deltaTime²` factor. The
   * threshold is therefore **not** invariant under timestep refinement: at
   * fixed tolerance, halving `deltaTime` quarters every force's share of the
   * gradient. Below `gradientTolerance / deltaTime²` in force magnitude a term
   * cannot move the iterate at all — the minimizer converges at the warm start
   * and the step reports `applied`, since converging immediately is a
   * legitimate outcome and not a refusable condition. Scale the tolerance with
   * `deltaTime²` to hold a fixed force resolution.
   */
  readonly gradientTolerance?: number;
  /** Accepted-step budget; default 128. Zero performs evaluation only. */
  readonly maximumIterations?: number;
  /** Initial Armijo step; default one. */
  readonly initialStep?: number;
  /** Armijo contraction in `(0, 1)`; default `0.5`. */
  readonly contractionFactor?: number;
  /** Armijo sufficient-decrease coefficient in `(0, 1)`; default `1e-4`. */
  readonly sufficientDecrease?: number;
  /** Trial budget for each Armijo search; default 32. */
  readonly maximumLineSearchTrials?: number;
  /** Packed search-direction policy; defaults to steepest descent. */
  /**
   * Packed search-direction policy, or the name of a shipped one.
   *
   * `'newton-cg'` is the configuration that sustains resting contact; it needs
   * the compiled objective, which this wrapper owns, so naming it here is the
   * only way a caller reading these options can reach it.
   */
  readonly directionPolicy?:
    | XpbdIncrementalPotentialDirectionPolicyN
    | XpbdIncrementalPotentialDirectionPolicyNameN;
  /**
   * Builds the direction policy from the problem this step compiles.
   *
   * The step owns compilation, so a policy needing the compiled objective
   * cannot be constructed by the caller beforehand. Invoked exactly once,
   * after compilation and before minimization. Mutually exclusive with
   * `directionPolicy`: supplying both is ambiguous about which is authoritative
   * rather than resolvable by precedence.
   */
  readonly directionPolicyFactory?: (
    problem: XpbdIncrementalPotentialProblemN
  ) => XpbdIncrementalPotentialDirectionPolicyN;
}

export interface XpbdIncrementalPotentialApplicationPolicyN {
  /** Default `backward-euler`. */
  readonly velocityUpdate?: XpbdIncrementalPotentialVelocityUpdateN;
  /** Default true, matching a successful `XpbdWorldN` outer step. */
  readonly clearForces?: boolean;
}

export interface StepXpbdIncrementalPotentialNOptions {
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];
  readonly providers: readonly XpbdConservativeForceProviderN[];
  /** Optional ordered particle-space admissible-step filters. */
  readonly stepFilters?: readonly XpbdIncrementalPotentialStepFilterN[];
  readonly deltaTime: number;
  /** Constant RN gravity; defaults to zero. */
  readonly gravity?: VecN | ArrayLike<number>;
  /**
   * Optional warm start in particle order. Fixed entries must equal their
   * inertial prediction. The default is the complete inertial prediction.
   * Explicit `initialPositions` takes precedence over `warmStart`.
   */
  readonly initialPositions?: readonly VecN[];
  /**
   * Selects the minimizer base when `initialPositions` is absent.
   *
   * `inertial-prediction` is the default: the base is the inertial prediction.
   * `previous-positions` keeps the base at the last admissible live state while
   * the inertial prediction still defines the objective's inertia term.
   * `feasible-inertial-prediction` searches the chord from those previous
   * positions toward the **certified** warm-start target — the prediction
   * under a `safe` verdict, the certified endpoint under `limited`, and the
   * authored anchor itself under `indeterminate` — for a point the complete
   * objective accepts, and retains every sampled result. Its reported
   * fractions are in that certified frame; see `feasibleBaseRecovery`.
   *
   * Every AUTOMATICALLY selected base movement is certified by the registered
   * step filters before it is installed: the anchor-to-prediction displacement
   * is submitted to every filter as one segment, a `limited` verdict shortens
   * the installed movement to the certified prefix, and an `indeterminate`
   * verdict installs the anchor instead — an uncertifiable automatic movement
   * does not happen. That certified endpoint, not the raw prediction, is also
   * what the feasible mode's chord search is retargeted onto.
   *
   * Point feasibility of a coordinate never certifies the
   * path to it: an unsigned contact law accepts a far-side placement, so
   * without this certification a warm start could install a base on the other
   * side of an obstacle and the filters, which certify only Armijo segments,
   * would never see the crossing. Explicit `initialPositions` remain the
   * authoritative, uncertified bypass. With no filter registered, behaviour is
   * unchanged.
   */
  readonly warmStart?:
    | 'inertial-prediction'
    | 'previous-positions'
    | 'feasible-inertial-prediction';
  /**
   * Sampling controls used only by `feasible-inertial-prediction`.
   * Supplying them with another policy is rejected rather than ignored.
   */
  readonly feasibleWarmStart?: XpbdIncrementalPotentialFeasibleWarmStartNOptions;
  readonly minimization?: XpbdIncrementalPotentialMinimizationPolicyN;
  readonly application?: XpbdIncrementalPotentialApplicationPolicyN;
}

/** Solver progress retained by every integrated step outcome. */
export interface XpbdIncrementalPotentialStepProgressN {
  /** Accepted minimizer iterations, whether or not the result was applied. */
  readonly acceptedIterations: number;
  /** Norm of accepted packed movement from minimizer base to final iterate. */
  readonly displacementNorm: number;
  /** Objective at the minimizer base minus objective at its final iterate. */
  readonly objectiveDecrease: number;
  /** Where convergence was declared, when the terminal is converged. */
  readonly convergencePoint?: 'initial' | 'accepted-iterate';
}

interface XpbdIncrementalPotentialStepBaseN<
  Minimization extends XpbdIncrementalPotentialMinimizationResultN =
    XpbdIncrementalPotentialMinimizationResultN
> {
  readonly prediction: XpbdInertialPredictionN;
  readonly problem: XpbdIncrementalPotentialProblemN;
  readonly minimization: Minimization;
  /** One decision-ready summary of whether the minimizer made progress. */
  readonly progress: XpbdIncrementalPotentialStepProgressN;
  /**
   * Complete initialization evidence when feasible chord recovery was run.
   * Absent for unchanged warm starts and when explicit positions bypass it.
   *
   * **Read the fractions in the recovery's own frame.** The recovery measures
   * every status, trial and fraction along the chord from the authored anchor
   * to the target THIS step handed it — which is the recovery target selected
   * by the warm-start policy, not unconditionally the inertial prediction.
   * Whenever registered step filters certify a `feasible-inertial-prediction`
   * movement to anything short of `safe`, the recovery runs from the authored
   * anchor to the **certified endpoint** instead, and its statuses, trials and
   * fractions describe that certified chord: the certified prefix under a
   * `limited` outcome, and the authored anchor itself under `indeterminate` —
   * where `target-feasible` with `fraction` one means nothing moved at all.
   * Under `safe`, and when no filter is registered, the target is the inertial
   * prediction exactly as before.
   *
   * Consumers needing the actual installed coordinate should read it rather
   * than rebuild it. `evaluation.coordinates` carries the accepted trial's own
   * packed coordinates — absent on the `anchor-refused` result, which accepted
   * none — and the base the solve started from is
   * `minimization.initial.coordinates`, or `minimization.initialCoordinates`
   * on the `initial-state-refused` terminal, which accepted no base evaluation
   * at all. Rebuilding that coordinate from a reported fraction and the
   * inertial prediction is unsound unless the outcome is `safe`: it coincides
   * only where the reported fraction is zero, which names the anchor in every
   * frame, and is wrong for every nonzero one.
   */
  readonly feasibleBaseRecovery?: XpbdIncrementalPotentialFeasibleBaseResultN;
  /**
   * Admissible-step certification of the automatic warm-start displacement.
   *
   * Present whenever registered step filters were consulted before an
   * automatically selected base was installed — that is, for the
   * `inertial-prediction` and `feasible-inertial-prediction` policies with at
   * least one filter registered and a nonzero anchor-to-prediction
   * displacement. Absent for `previous-positions` (zero displacement), for
   * explicit `initialPositions` (the documented authoritative bypass), and
   * when no filter is registered.
   */
  readonly warmStartCertification?: XpbdIncrementalPotentialWarmStartCertificationN;
}

export interface XpbdIncrementalPotentialStepAppliedN
  extends XpbdIncrementalPotentialStepBaseN<
    XpbdIncrementalPotentialConvergedN
  > {
  readonly status: 'applied';
  readonly application: XpbdIncrementalPotentialAppliedN;
}

export interface XpbdIncrementalPotentialStepMinimizationRefusedN
  extends XpbdIncrementalPotentialStepBaseN<
    Exclude<
      XpbdIncrementalPotentialMinimizationResultN,
      XpbdIncrementalPotentialConvergedN
    >
  > {
  readonly status: 'refused';
  readonly stage: 'minimization';
  readonly reason: 'not-converged';
}

export interface XpbdIncrementalPotentialStepApplicationRefusedN
  extends XpbdIncrementalPotentialStepBaseN<
    XpbdIncrementalPotentialConvergedN
  > {
  readonly status: 'refused';
  readonly stage: 'application';
  readonly reason: Exclude<
    XpbdIncrementalPotentialApplicationRefusedN['reason'],
    'not-converged'
  >;
  readonly application: Exclude<
    XpbdIncrementalPotentialApplicationRefusedN,
    { readonly reason: 'not-converged' }
  >;
}

export type XpbdIncrementalPotentialStepRefusedN =
  | XpbdIncrementalPotentialStepMinimizationRefusedN
  | XpbdIncrementalPotentialStepApplicationRefusedN;

export type XpbdIncrementalPotentialStepResultN =
  | XpbdIncrementalPotentialStepAppliedN
  | XpbdIncrementalPotentialStepRefusedN;

interface RuntimeParticleSnapshotN {
  readonly particle: XpbdParticleN;
  readonly id: string;
  readonly dimension: number;
  readonly position: VecN;
  readonly positionCoordinates: Float64Array;
  readonly velocity: VecN;
  readonly velocityCoordinates: Float64Array;
  readonly force: VecN;
  readonly forceCoordinates: Float64Array;
  readonly inverseMass: number;
  readonly gravityScale: number;
}

/**
 * Transactionally composes prediction, objective compilation, bounded
 * minimization, verification, and application for one conservative RN step.
 *
 * Typed refusal and thrown failure paths restore the complete pre-step
 * particle state. Only an `applied` result advances live particles.
 */
export function stepXpbdIncrementalPotentialN(
  options: StepXpbdIncrementalPotentialNOptions
): XpbdIncrementalPotentialStepResultN {
  const caller = 'stepXpbdIncrementalPotentialN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  if (!Array.isArray(options.particles) || options.particles.length === 0) {
    throw new Error(`${caller}: particles must be a non-empty array`);
  }
  for (let index = 0; index < options.particles.length; index++) {
    if (!(options.particles[index] instanceof XpbdParticleN)) {
      throw new Error(`${caller}: particle ${index} must be an XpbdParticleN`);
    }
  }
  validatePolicyObject(options.minimization, 'minimization', caller);
  validatePolicyObject(options.application, 'application', caller);
  if (
    options.warmStart !== undefined &&
    options.warmStart !== 'inertial-prediction' &&
    options.warmStart !== 'previous-positions' &&
    options.warmStart !== 'feasible-inertial-prediction'
  ) {
    throw new Error(
      `${caller}: warmStart must be "inertial-prediction", ` +
        `"previous-positions", or "feasible-inertial-prediction"`
    );
  }
  validateFeasibleWarmStart(options.feasibleWarmStart, options.warmStart, caller);

  const rollback = options.particles.map(snapshotRuntimeParticle);
  try {
    const prediction = predictXpbdInertialStateN({
      dimension: options.dimension,
      particles: options.particles,
      deltaTime: options.deltaTime,
      ...(options.gravity === undefined ? {} : { gravity: options.gravity })
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: options.dimension,
      particles: options.particles,
      predictedPositions: prediction.positions,
      deltaTime: options.deltaTime,
      providers: options.providers,
      ...(options.stepFilters === undefined
        ? {}
        : { stepFilters: options.stepFilters })
    });
    let feasibleBaseRecovery: XpbdIncrementalPotentialFeasibleBaseResultN | undefined;
    let warmStartCertification:
      XpbdIncrementalPotentialWarmStartCertificationN | undefined;
    let initialCoordinates: Float64Array;
    if (options.initialPositions !== undefined) {
      // Explicit coordinates remain authoritative and bypass automatic
      // recovery and certification even when the feasible policy was named.
      initialCoordinates = problem.packPositions(options.initialPositions);
    } else if (options.warmStart === 'previous-positions') {
      // The base is the anchor itself: zero automatic displacement, so there
      // is no movement for the filters to certify.
      initialCoordinates = problem.packPositions(
        rollback.map((snapshot) => new VecN(snapshot.positionCoordinates))
      );
    } else {
      // Both remaining policies move the base automatically from the authored
      // anchor toward the inertial prediction. That movement is certified by
      // every registered filter BEFORE anything is installed: point
      // feasibility of the prediction says the objective is defined there,
      // never that the path from the anchor is admissible.
      const anchorCoordinates = problem.packPositions(
        rollback.map((snapshot) => new VecN(snapshot.positionCoordinates))
      );
      const targetCoordinates = problem.packPositions(prediction.positions);
      // `undefined` is the no-filter case, and only that case: a scene with
      // nothing registered to certify segments keeps its pre-certification
      // base exactly. Every other verdict arrives as a certification.
      const certified: XpbdCertifiedWarmStartBaseN | undefined =
        certifyXpbdIncrementalPotentialWarmStartN(
          problem,
          anchorCoordinates,
          targetCoordinates,
          caller
        );
      warmStartCertification = certified?.certification;
      const effectiveTarget = certified === undefined
        ? targetCoordinates
        : certified.baseCoordinates;
      if (options.warmStart === 'feasible-inertial-prediction') {
        // The chord search runs within the certified movement: every sampled
        // fraction lies on the anchor-to-effective-target segment, and a
        // prefix of a certified prefix is certified.
        const recoveryOptions: RecoverXpbdIncrementalPotentialFeasibleBaseNOptions = {
          problem,
          anchorCoordinates,
          targetCoordinates: effectiveTarget,
          ...(options.feasibleWarmStart?.contractionFactor === undefined
            ? {}
            : { contractionFactor: options.feasibleWarmStart.contractionFactor }),
          ...(options.feasibleWarmStart?.maximumTrials === undefined
            ? {}
            : { maximumTrials: options.feasibleWarmStart.maximumTrials })
        };
        feasibleBaseRecovery = recoverXpbdIncrementalPotentialFeasibleBaseN(
          recoveryOptions
        );
        initialCoordinates = feasibleBaseRecovery.status === 'anchor-refused'
          ? anchorCoordinates
          : feasibleBaseRecovery.evaluation.coordinates.slice();
      } else {
        initialCoordinates = effectiveTarget;
      }
    }
    const policy = options.minimization;
    const directionPolicy = resolveXpbdIncrementalPotentialStepDirectionN(
      policy,
      problem,
      caller
    );
    const minimization = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates,
      ...(policy?.convergence === undefined
        ? {}
        : { convergence: policy.convergence }),
      ...(policy?.gradientTolerance === undefined
        ? {}
        : { gradientTolerance: policy.gradientTolerance }),
      ...(policy?.maximumIterations === undefined
        ? {}
        : { maximumIterations: policy.maximumIterations }),
      ...(policy?.initialStep === undefined
        ? {}
        : { initialStep: policy.initialStep }),
      ...(policy?.contractionFactor === undefined
        ? {}
        : { contractionFactor: policy.contractionFactor }),
      ...(policy?.sufficientDecrease === undefined
        ? {}
        : { sufficientDecrease: policy.sufficientDecrease }),
      ...(policy?.maximumLineSearchTrials === undefined
        ? {}
        : { maximumLineSearchTrials: policy.maximumLineSearchTrials }),
      ...(directionPolicy === undefined ? {} : { directionPolicy })
    });
    const progress = summarizeStepProgress(minimization);
    const base = {
      prediction,
      problem,
      progress,
      ...(feasibleBaseRecovery === undefined
        ? {}
        : { feasibleBaseRecovery }),
      ...(warmStartCertification === undefined
        ? {}
        : { warmStartCertification })
    } as const;

    if (minimization.status !== 'converged') {
      restoreRuntimeParticles(rollback);
      return Object.freeze({
        ...base,
        minimization,
        status: 'refused',
        stage: 'minimization',
        reason: 'not-converged'
      });
    }

    const applicationPolicy = options.application;
    const application = applyXpbdIncrementalPotentialResultN({
      result: minimization,
      ...(applicationPolicy?.velocityUpdate === undefined
        ? {}
        : { velocityUpdate: applicationPolicy.velocityUpdate }),
      ...(applicationPolicy?.clearForces === undefined
        ? {}
        : { clearForces: applicationPolicy.clearForces })
    });
    if (application.status === 'refused') {
      if (application.reason === 'not-converged') {
        throw new Error(
          `${caller}: converged minimization was refused as not-converged`
        );
      }
      restoreRuntimeParticles(rollback);
      return Object.freeze({
        ...base,
        minimization,
        status: 'refused',
        stage: 'application',
        reason: application.reason,
        application
      });
    }

    return Object.freeze({
      ...base,
      minimization,
      status: 'applied',
      application
    });
  } catch (error) {
    restoreRuntimeParticles(rollback);
    throw error;
  }
}

/** Computes accepted minimizer progress without interpreting whether it is enough. */
function summarizeStepProgress(
  minimization: XpbdIncrementalPotentialMinimizationResultN
): XpbdIncrementalPotentialStepProgressN {
  if (minimization.status === 'initial-state-refused') {
    return Object.freeze({
      acceptedIterations: 0,
      displacementNorm: 0,
      objectiveDecrease: 0
    });
  }
  let displacementNorm = 0;
  for (let coordinate = 0; coordinate < minimization.initial.coordinates.length; coordinate++) {
    displacementNorm = Math.hypot(
      displacementNorm,
      minimization.final.coordinates[coordinate]! -
        minimization.initial.coordinates[coordinate]!
    );
  }
  return Object.freeze({
    acceptedIterations: minimization.iterations.length,
    displacementNorm,
    objectiveDecrease:
      minimization.initial.objective - minimization.final.objective,
    ...(minimization.status === 'converged'
      ? { convergencePoint: minimization.convergencePoint }
      : {})
  });
}

function validatePolicyObject(
  value: unknown,
  name: string,
  caller: string
): void {
  if (value !== undefined && (typeof value !== 'object' || value === null)) {
    throw new Error(`${caller}: ${name} must be an object`);
  }
}

function validateFeasibleWarmStart(
  value: XpbdIncrementalPotentialFeasibleWarmStartNOptions | undefined,
  warmStart: StepXpbdIncrementalPotentialNOptions['warmStart'],
  caller: string
): void {
  if (value === undefined) return;
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${caller}: feasibleWarmStart must be an object`);
  }
  if (warmStart !== 'feasible-inertial-prediction') {
    throw new Error(
      `${caller}: feasibleWarmStart requires warmStart "feasible-inertial-prediction"`
    );
  }
  const unknown = Object.keys(value).filter(
    (key) => key !== 'contractionFactor' && key !== 'maximumTrials'
  );
  if (unknown.length > 0) {
    throw new Error(
      `${caller}: feasibleWarmStart has unknown option${unknown.length === 1 ? '' : 's'} ` +
        unknown.map((key) => `"${key}"`).join(', ')
    );
  }
  if (value.contractionFactor !== undefined &&
    (!Number.isFinite(value.contractionFactor) ||
      value.contractionFactor <= 0 || value.contractionFactor >= 1)) {
    throw new Error(
      `${caller}: feasibleWarmStart.contractionFactor must be finite and in (0, 1)`
    );
  }
  if (value.maximumTrials !== undefined &&
    (!Number.isSafeInteger(value.maximumTrials) || value.maximumTrials < 1)) {
    throw new Error(
      `${caller}: feasibleWarmStart.maximumTrials must be a positive integer`
    );
  }
}

function snapshotRuntimeParticle(
  particle: XpbdParticleN
): RuntimeParticleSnapshotN {
  return {
    particle,
    id: particle.id,
    dimension: particle.dimension,
    position: particle.position,
    positionCoordinates: particle.position.data.slice(),
    velocity: particle.velocity,
    velocityCoordinates: particle.velocity.data.slice(),
    force: particle.force,
    forceCoordinates: particle.force.data.slice(),
    inverseMass: particle.inverseMass,
    gravityScale: particle.gravityScale
  };
}

function restoreRuntimeParticles(
  snapshots: readonly RuntimeParticleSnapshotN[]
): void {
  for (const snapshot of snapshots) {
    const mutable = snapshot.particle as unknown as {
      id: string;
      dimension: number;
      position: VecN;
      velocity: VecN;
      force: VecN;
      inverseMass: number;
      gravityScale: number;
    };
    mutable.id = snapshot.id;
    mutable.dimension = snapshot.dimension;
    mutable.position = snapshot.position;
    mutable.velocity = snapshot.velocity;
    mutable.force = snapshot.force;
    mutable.inverseMass = snapshot.inverseMass;
    mutable.gravityScale = snapshot.gravityScale;
    mutable.position.data.set(snapshot.positionCoordinates);
    mutable.velocity.data.set(snapshot.velocityCoordinates);
    mutable.force.data.set(snapshot.forceCoordinates);
  }
}
