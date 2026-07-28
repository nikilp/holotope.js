import { VecN } from '@holotope/core';
import {
  stepXpbdIncrementalPotentialN,
  xpbdMassPreconditionedDirectionN,
  xpbdNewtonDirectionPolicyN
} from '@holotope/physics';
import { FLOOR_AXIS, type NdContactScene } from './scene.js';

/**
 * Which search direction the minimizer is given.
 *
 * These are the rungs of the escalation ladder measured in
 * `kitchen/nd-contact/findings.md`, and the reason the demo exists in its
 * current form: on the identical scene, `default` freezes and `newton` reaches
 * rest. `mass-diagonal` is included because it is the rung a caller reaches for
 * first — it is discoverable from the options type — and it is a no-op on this
 * problem, which is the finding rather than an accident.
 */
export type NdContactDirection = 'default' | 'mass-diagonal' | 'newton';

export interface AdvanceNdContactOptions {
  readonly scene: NdContactScene;
  /** Zero-based index of this step; carried into the record for plotting. */
  readonly stepIndex: number;
  readonly deltaTime?: number;
  readonly direction?: NdContactDirection;
  /**
   * Overrides the minimizer's gradient tolerance.
   *
   * Exposed because loosening it is the trap: past the objective's gradient
   * norm at the current state, every solve converges at `initial` in zero
   * iterations and the scene stops moving while reporting success. The demo
   * shows that rather than hiding it.
   */
  readonly gradientTolerance?: number;
  readonly maximumIterations?: number;
}

/** One step filter's verdict on one line-search segment. */
export interface NdContactFilterVerdict {
  readonly filterId: string;
  readonly status: 'safe' | 'limited' | 'indeterminate';
  readonly maximumStepLength?: number;
  /** Present only on `indeterminate`: why the filter declined to certify. */
  readonly reason?: string;
}

/** Everything one step produced, flattened to what an instrument can read. */
export interface NdContactStepRecord {
  readonly dimension: number;
  readonly stepIndex: number;
  readonly time: number;
  /** Whether the solved state actually reached the particles. */
  readonly applied: boolean;
  /** Minimizer terminal: `converged`, `iteration-limit`, and so on. */
  readonly terminal: string;
  /** Present when the terminal is `converged`. */
  readonly convergencePoint?: 'initial' | 'accepted-iterate';
  /** Accepted Newton/descent iterates — zero means the solver did nothing. */
  readonly acceptedIterations: number;
  /** Euclidean norm of the position change actually applied this step. */
  readonly displacement: number;
  readonly gradientNormInitial: number;
  readonly gradientNormFinal: number;
  readonly gradientTolerance: number;
  readonly filterVerdicts: readonly NdContactFilterVerdict[];
  /** Armijo trial step lengths, in order, with why each was rejected. */
  readonly armijoTrials: readonly { readonly stepLength: number; readonly status: string }[];
  /** Newton direction outcomes seen this step, tallied. */
  readonly directionOutcomes: Readonly<Record<string, number>>;
  /** Largest absolute floor-axis speed after the step. */
  readonly maximumSpeed: number;
  /** Smallest floor-axis coordinate after the step. */
  readonly minimumHeight: number;
}

const minimizationFor = (
  options: AdvanceNdContactOptions
): Record<string, unknown> | undefined => {
  const policy: Record<string, unknown> = {};
  if (options.gradientTolerance !== undefined) {
    policy['gradientTolerance'] = options.gradientTolerance;
  }
  if (options.maximumIterations !== undefined) {
    policy['maximumIterations'] = options.maximumIterations;
  }
  switch (options.direction ?? 'default') {
    case 'mass-diagonal':
      policy['directionPolicy'] = xpbdMassPreconditionedDirectionN;
      break;
    case 'newton':
      // The Newton policy needs the compiled problem, so it is reachable only
      // through the factory — which is precisely why a caller enumerating the
      // options type never finds it. See findings.md.
      policy['directionPolicyFactory'] = (problem: never) =>
        xpbdNewtonDirectionPolicyN({ problem });
      break;
    default:
      break;
  }
  return Object.keys(policy).length > 0 ? policy : undefined;
};

const distance = (before: readonly VecN[], after: readonly VecN[]): number => {
  let total = 0;
  for (const [index, start] of before.entries()) {
    const end = after[index]!;
    for (let axis = 0; axis < start.dim; axis++) {
      const delta = end.data[axis]! - start.data[axis]!;
      total += delta * delta;
    }
  }
  return Math.sqrt(total);
};

/**
 * Advances one scene by one step.
 *
 * `scene.dimension` is passed through as data. There is deliberately no branch
 * on it anywhere in this function, and the demo's central claim is that there
 * does not need to be: the same call drives R², R³ and R⁴ to bitwise identical
 * trajectories on the coordinates they share.
 *
 * `initialPositions` is passed explicitly rather than defaulted. The default is
 * the inertial prediction, which for a particle already resting near a barrier
 * lies outside the barrier's open domain, and a domain refusal at the base
 * point is fatal by design — so the obvious call throws after about forty steps.
 * P39 proposes `warmStart: 'previous-positions'` for exactly this; when it
 * lands, this is the line that changes.
 */
export function advanceNdContact(options: AdvanceNdContactOptions): NdContactStepRecord {
  const { scene, stepIndex } = options;
  const deltaTime = options.deltaTime ?? 1 / 120;
  const before = scene.particles.map((particle) => particle.position.clone());
  const minimization = minimizationFor(options);

  const result = stepXpbdIncrementalPotentialN({
    dimension: scene.dimension,
    particles: scene.particles,
    providers: scene.providers,
    stepFilters: scene.stepFilters,
    deltaTime,
    gravity: scene.gravity,
    initialPositions: before.map((position) => position.clone()),
    ...(minimization ? { minimization: minimization as never } : {})
  });

  const minimization_ = result.minimization as unknown as {
    readonly status: string;
    readonly convergencePoint?: 'initial' | 'accepted-iterate';
    readonly initial: { readonly gradientNorm: number };
    readonly final: { readonly gradientNorm: number };
    readonly gradientTolerance: number;
    readonly iterations: readonly {
      readonly directionEvidence?: { readonly outcome?: string };
      readonly search?: {
        readonly trials?: readonly { readonly stepLength: number; readonly status: string }[];
        readonly stepFilters?: readonly {
          readonly filterId: string;
          readonly evaluation: {
            readonly status: 'safe' | 'limited' | 'indeterminate';
            readonly maximumStepLength?: number;
            readonly reason?: string;
          };
        }[];
      };
    }[];
  };

  const filterVerdicts: NdContactFilterVerdict[] = [];
  const armijoTrials: { stepLength: number; status: string }[] = [];
  const directionOutcomes: Record<string, number> = {};
  for (const iteration of minimization_.iterations) {
    const outcome = iteration.directionEvidence?.outcome;
    if (outcome) directionOutcomes[outcome] = (directionOutcomes[outcome] ?? 0) + 1;
    for (const trial of iteration.search?.trials ?? []) {
      armijoTrials.push({ stepLength: trial.stepLength, status: trial.status });
    }
    for (const filter of iteration.search?.stepFilters ?? []) {
      filterVerdicts.push({
        filterId: filter.filterId,
        status: filter.evaluation.status,
        ...(filter.evaluation.maximumStepLength !== undefined
          ? { maximumStepLength: filter.evaluation.maximumStepLength }
          : {}),
        ...(filter.evaluation.reason !== undefined ? { reason: filter.evaluation.reason } : {})
      });
    }
  }

  const after = scene.particles.map((particle) => particle.position);
  return Object.freeze({
    dimension: scene.dimension,
    stepIndex,
    time: stepIndex * deltaTime,
    applied: result.status === 'applied',
    terminal: minimization_.status,
    ...(minimization_.convergencePoint !== undefined
      ? { convergencePoint: minimization_.convergencePoint }
      : {}),
    acceptedIterations: minimization_.iterations.length,
    displacement: distance(before, after),
    gradientNormInitial: minimization_.initial.gradientNorm,
    gradientNormFinal: minimization_.final.gradientNorm,
    gradientTolerance: minimization_.gradientTolerance,
    filterVerdicts,
    armijoTrials,
    directionOutcomes,
    maximumSpeed: Math.max(
      ...scene.particles.map((particle) => Math.abs(particle.velocity.data[FLOOR_AXIS]!))
    ),
    minimumHeight: Math.min(
      ...scene.particles.map((particle) => particle.position.data[FLOOR_AXIS]!)
    )
  });
}
