/**
 * Headless example for the scale of the stationarity test.
 *
 * Deliberately unrouted: it drives one analytically solvable scene at six
 * timesteps over a fixed horizon and reports what each stop test delivered,
 * without choosing a camera, material, layout, or interaction policy.
 *
 * The distinction it exists to make concrete is about units. The packed
 * objective is `½‖x − x̃‖²_M + deltaTime² · U(x)`, so an entry of the packed
 * gradient carries mass·length — force·time². An absolute bound on its norm,
 * which is what `gradientTolerance` is and what the shipped default of `1e-8`
 * applies, therefore resolves forces only down to
 * `gradientTolerance / deltaTime²`. Refining the timestep *lowers* the force
 * the stop test can still see. `{ kind: 'maximum-acceleration-residual' }`
 * bounds `max_i ‖gradient_i‖ / (mass_i · deltaTime²)` over the free particles
 * instead, in length/time², and that quantity does not move with the timestep.
 *
 * What this shows is a resolution floor, **not** a defect in the minimizer.
 * Below the floor the warm start is already stationary to the authored
 * tolerance, the minimizer converges there without iterating, and the step
 * reports `applied` — converging immediately is a legitimate outcome and not a
 * refusable condition. Nothing is wrong except that the author bounded a
 * quantity that carries `deltaTime²` and then changed `deltaTime`.
 *
 * Neither criterion is better outright. They differ by exactly `deltaTime²`,
 * so no single one bounds both delivered position error and delivered
 * acceleration: over an eight-fold refinement at fixed authored tolerance the
 * packed norm holds position error to 1.5× while spreading acceleration by
 * 45.4×, and the acceleration residual does the reverse, 1.02× and 62.8×.
 * Bounding acceleration here buys a timestep-independent force resolution and
 * gives up the per-step position residual the packed norm was holding.
 */
import { VecN } from '@holotope/core';
import {
  XpbdParticleN,
  XpbdWorldN,
  compileXpbdIncrementalPotentialProblemN,
  minimizeXpbdIncrementalPotentialN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdConservativeForceProviderN,
  type XpbdIncrementalPotentialConvergenceEvidenceN,
  type XpbdIncrementalPotentialConvergenceKindN,
  type XpbdIncrementalPotentialConvergenceN
} from '@holotope/physics';

/** What one criterion delivered over the whole horizon at one timestep. */
export interface StationarityScaleRunN {
  /** The criterion that decided every step, read back off the result. */
  readonly convergenceKind: XpbdIncrementalPotentialConvergenceKindN;
  /** Its authored threshold, in that criterion's own unit. */
  readonly tolerance: number;
  /** Steps whose status was `applied`. */
  readonly applied: number;
  /**
   * Steps that converged at the warm start, without accepting an iteration.
   *
   * This is the only place a below-floor run differs from a resolved one, and
   * it is not a failure: the base was stationary to the authored tolerance.
   */
  readonly convergedAtWarmStart: number;
  /** Velocity along the forced axis at the end of the horizon. */
  readonly velocity: number;
  /** Distance from Newton's closed-form answer for that velocity. */
  readonly velocityError: number;
  /** Criterion residual at the final iterate of the last step. */
  readonly finalResidual: number;
}

/** One timestep, driven twice over the same fixed horizon. */
export interface StationarityScaleRowN {
  readonly deltaTime: number;
  /** `horizon / deltaTime`, so the physical interval is held fixed. */
  readonly steps: number;
  /** `deltaTime² · force`: the packed gradient the warm start presents. */
  readonly warmStartPackedGradient: number;
  /**
   * `packedTolerance / deltaTime²`: the smallest force the packed-gradient
   * test can still see at this timestep, in newtons.
   */
  readonly resolvableForce: number;
  /** The shipped default, an absolute bound on the packed gradient norm. */
  readonly packedGradient: StationarityScaleRunN;
  /** The per-particle acceleration bound, in length/time². */
  readonly accelerationResidual: StationarityScaleRunN;
}

/** Everything one drive of the scene reveals about the two stop tests. */
export interface StationarityScaleReport {
  /** Constant applied force, in newtons. */
  readonly force: number;
  /** Particle mass, in kilograms. */
  readonly mass: number;
  /** Fixed physical interval every row integrates, in seconds. */
  readonly horizon: number;
  /** `force · horizon / mass`: the answer every row is compared against. */
  readonly newtonVelocity: number;
  /** The packed-gradient tolerance in force, read off the first result. */
  readonly packedTolerance: number;
  /** The authored acceleration tolerance, read off the first result. */
  readonly accelerationTolerance: number;
  /**
   * `sqrt(packedTolerance / force)`: the timestep below which this force is
   * smaller than the packed-gradient test's own resolution.
   */
  readonly packedResolutionTimestep: number;
  readonly rows: readonly StationarityScaleRowN[];
  /**
   * Why the two spellings cannot both be authored, in the library's words.
   *
   * They are not interconvertible without a timestep and a mass, and are not
   * even in the same units, so there is no defensible reconciliation to pick.
   */
  readonly bothSpellingsRefused: string;
}

/**
 * `U(x) = −f · x`, so `gradU = −f` and the reported force is exactly `f`
 * everywhere. At a warm start the packed gradient is exactly `−deltaTime² f`,
 * which is what makes the resolution floor analytic here rather than fitted.
 */
function constantForceProvider(
  id: string,
  particles: readonly XpbdParticleN[],
  forces: readonly VecN[]
): XpbdConservativeForceProviderN {
  const evaluateAt: XpbdConservativeForceProviderN['evaluateAt'] = (
    positionOf
  ) => {
    let potentialEnergy = 0;
    particles.forEach((particle, index) => {
      potentialEnergy -= forces[index]!.dot(positionOf(particle));
    });
    return { potentialEnergy, forces: forces.map((force) => force.clone()) };
  };
  return {
    id,
    dimension: particles[0]!.dimension,
    particles,
    evaluate: () => evaluateAt((particle) => particle.position.clone()),
    evaluateAt
  };
}

function axisForce(dimension: number, magnitude: number): VecN {
  const force = new VecN(dimension);
  force.data[0] = magnitude;
  return force;
}

/** Constant applied force, in newtons. */
const FORCE = 1000;
/** Fixed physical interval, in seconds. Every row integrates exactly this. */
const HORIZON = 1e-3;
/**
 * Bound on residual acceleration, in m/s².
 *
 * One thousand times smaller than the 1000 m/s² this scene actually produces,
 * and authorable without knowing the timestep — which is the whole property
 * being demonstrated.
 */
const ACCELERATION_TOLERANCE = 1;
/** Refinements that bracket the floor: 1e-4 resolves the force, 1e-6 does not. */
const DELTA_TIMES = [1e-4, 5e-5, 1e-5, 5e-6, 2e-6, 1e-6] as const;

/**
 * Integrates the same scene over the fixed horizon under one stop test.
 *
 * Omitting `convergence` leaves the shipped packed-gradient default in force,
 * which is exactly what an author who never chose a criterion gets.
 */
function drive(
  deltaTime: number,
  convergence?: XpbdIncrementalPotentialConvergenceN
): StationarityScaleRunN {
  const particle = new XpbdParticleN({ id: 'p', position: [0, 0, 0] });
  const world = new XpbdWorldN({ dimension: 3 });
  world.addParticle(particle);
  world.addForceProvider(
    constantForceProvider('push', [particle], [axisForce(3, FORCE)])
  );

  const steps = Math.round(HORIZON / deltaTime);
  let applied = 0;
  let convergedAtWarmStart = 0;
  let evidence: XpbdIncrementalPotentialConvergenceEvidenceN | undefined;
  for (let index = 0; index < steps; index++) {
    const advance = stepXpbdIncrementalPotentialWorldN({
      world,
      deltaTime,
      ...(convergence === undefined ? {} : { minimization: { convergence } })
    });
    if (advance.step.status === 'applied') applied++;
    // The one observable difference below the floor, and it reads as success:
    // the base was already stationary to the authored tolerance.
    if (advance.step.progress.convergencePoint === 'initial') {
      convergedAtWarmStart++;
    }
    // Every terminal carries the criterion that decided it, whichever ran —
    // except an inadmissible base, which was never evaluated and so has no
    // measured residual to report. This scene has no barrier and cannot reach
    // that terminal, but the union says so and is narrowed rather than cast.
    const minimization = advance.step.minimization;
    if (minimization.status !== 'initial-state-refused') {
      evidence = minimization.convergence;
    }
  }
  if (evidence === undefined) {
    throw new Error('stationarity-scale: the horizon produced no step at all');
  }

  const velocity = particle.velocity.data[0]!;
  return {
    convergenceKind: evidence.kind,
    tolerance: evidence.tolerance,
    applied,
    convergedAtWarmStart,
    velocity,
    velocityError: Math.abs(velocity - (FORCE * HORIZON)),
    finalResidual: evidence.finalResidual
  };
}

/** The message a scene gets for authoring both spellings of the stop test. */
function refusalForBothSpellings(): string {
  const particle = new XpbdParticleN({ id: 'p', position: [0, 0, 0] });
  const problem = compileXpbdIncrementalPotentialProblemN({
    dimension: 3,
    particles: [particle],
    predictedPositions: [new VecN([0, 0, 0])],
    deltaTime: 1e-2,
    providers: [
      constantForceProvider('push', [particle], [axisForce(3, FORCE)])
    ]
  });
  try {
    minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: [0, 0, 0],
      gradientTolerance: 1e-8,
      convergence: {
        kind: 'maximum-acceleration-residual',
        tolerance: ACCELERATION_TOLERANCE
      }
    });
  } catch (refusal) {
    return refusal instanceof Error ? refusal.message : 'unexpected';
  }
  return 'none';
}

/**
 * Drives one free particle under a constant force at six timesteps, twice.
 *
 * @example
 * The table, and the two readings it exists to separate:
 * ```ts
 * const report = runStationarityScaleContract();
 * for (const line of summarizeStationarityScale(report)) log(line);
 *
 * // Newton's answer, which every row is measured against.
 * log('target', report.newtonVelocity);
 *
 * // The finest timestep, where the packed-gradient default can no longer
 * // resolve a 1000 N force: every step still reports applied, and the
 * // delivered velocity is identically zero.
 * const finest = report.rows[report.rows.length - 1];
 * if (finest !== undefined) {
 *   log('applied', finest.packedGradient.applied, 'of', finest.steps);
 *   log('resolvable force', finest.resolvableForce, 'N vs', report.force);
 *   log('packed', finest.packedGradient.velocity);        // 0
 *   log('acceleration', finest.accelerationResidual.velocity); // ~1
 * }
 *
 * // The two tolerances are not interconvertible, so authoring both is
 * // refused before the problem is evaluated even once.
 * log('refusal', report.bothSpellingsRefused);
 * ```
 */
export function runStationarityScaleContract(): StationarityScaleReport {
  const rows = DELTA_TIMES.map((deltaTime) => {
    const packedGradient = drive(deltaTime);
    const accelerationResidual = drive(deltaTime, {
      kind: 'maximum-acceleration-residual',
      tolerance: ACCELERATION_TOLERANCE
    });
    return {
      deltaTime,
      steps: Math.round(HORIZON / deltaTime),
      warmStartPackedGradient: deltaTime * deltaTime * FORCE,
      resolvableForce: packedGradient.tolerance / (deltaTime * deltaTime),
      packedGradient,
      accelerationResidual
    };
  });

  const first = rows[0];
  if (first === undefined) {
    throw new Error('stationarity-scale: no timestep was driven');
  }

  return {
    force: FORCE,
    mass: 1,
    horizon: HORIZON,
    newtonVelocity: FORCE * HORIZON,
    // Read back rather than restated: the default is whatever the library
    // applied, not whatever this file believes it to be.
    packedTolerance: first.packedGradient.tolerance,
    accelerationTolerance: first.accelerationResidual.tolerance,
    packedResolutionTimestep: Math.sqrt(first.packedGradient.tolerance / FORCE),
    rows,
    bothSpellingsRefused: refusalForBothSpellings()
  };
}
