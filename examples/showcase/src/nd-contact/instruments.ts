import {
  evaluateClampedLogBarrier,
  type XpbdIncrementalPotentialDiagnosisConditionN,
  type XpbdIncrementalPotentialDiagnosisLeverN
} from '@holotope/physics';
import type { NdContactStepRecord } from './step.js';

/** One sample of the barrier law, for plotting. */
export interface BarrierSample {
  readonly distance: number;
  readonly energy: number;
  readonly firstDerivative: number;
}

export interface SampleBarrierCurveOptions {
  readonly activationDistance: number;
  readonly stiffness: number;
  readonly samples?: number;
  /** Largest distance plotted; defaults to 1.6× activation to show the clamp. */
  readonly maximumDistance?: number;
}

/**
 * Samples the shipped barrier law across a distance range.
 *
 * This is IPC's Figure 3 drawn from the kernel the solver actually uses rather
 * than replotted from the paper. The range deliberately extends past
 * `activationDistance` so the clamp is visible as *exactly* zero rather than
 * merely small — the property that makes the law usable.
 *
 * The domain is open at zero, so the first sample is offset rather than starting
 * at `0`: asking the kernel for the value at contact is a range error, not a
 * large number, and that is worth showing rather than smoothing over.
 */
export function sampleBarrierCurve(options: SampleBarrierCurveOptions): readonly BarrierSample[] {
  const { activationDistance, stiffness } = options;
  const samples = options.samples ?? 192;
  const maximumDistance = options.maximumDistance ?? activationDistance * 1.6;
  const first = maximumDistance / samples / 8;

  const curve: BarrierSample[] = [];
  for (let index = 0; index < samples; index++) {
    const distance = first + (maximumDistance - first) * (index / (samples - 1));
    const evaluation = evaluateClampedLogBarrier({
      coordinate: distance,
      activation: activationDistance,
      stiffness
    });
    curve.push(
      Object.freeze({
        distance,
        energy: evaluation.energy,
        firstDerivative: evaluation.firstDerivative
      })
    );
  }
  return Object.freeze(curve);
}

/** Aggregate view of a run, for the readouts beside each pane. */
export interface NdContactRunSummary {
  readonly steps: number;
  readonly applied: number;
  readonly refused: number;
  /** Minimizer terminals, tallied. */
  readonly terminals: Readonly<Record<string, number>>;
  /** Diagnosis conditions, tallied. */
  readonly conditions: Readonly<
    Record<XpbdIncrementalPotentialDiagnosisConditionN, number>
  >;
  /** Suggested caller-controlled levers, tallied without applying any. */
  readonly levers: Readonly<Record<XpbdIncrementalPotentialDiagnosisLeverN, number>>;
  /** Step filter verdicts, tallied across every line-search trial. */
  readonly filterVerdicts: Readonly<Record<string, number>>;
  /** First step that was refused, or `null` if none was. */
  readonly firstRefusedStep: number | null;
  /** First step at which the scene had moved and then come to rest. */
  readonly settledStep: number | null;
  /** Whether the scene ever moved. The liveness companion for every claim below. */
  readonly moved: boolean;
  /**
   * Whether the run genuinely reached rest.
   *
   * Deliberately conjunctive, because each clause alone is satisfiable by a
   * failure: every step applied (a frozen scene refuses), the scene moved (a
   * scene that never fell is motionless but applied), and it stopped (a falling
   * scene is neither). `39e412a` established this assertion style after a
   * stability check was found to be satisfiable by a halted simulation.
   */
  readonly reachedRest: boolean;
}

export interface SummarizeOptions {
  /** Speed below which the scene counts as at rest. */
  readonly restSpeed?: number;
}

/**
 * Accumulates a run summary one record at a time.
 *
 * The live page needs a summary every frame over a run that grows to hundreds of
 * steps. Re-reducing the whole history each frame is quadratic and, measured on
 * the page, dominated the solver by an order of magnitude — the scene advanced
 * about four steps per second while the step itself costs well under a
 * millisecond. Folding each record in once keeps the readout honest and cheap.
 */
export interface NdContactRunAccumulator {
  add(record: NdContactStepRecord): void;
  readonly summary: NdContactRunSummary;
}

export function createNdContactRunAccumulator(
  options: SummarizeOptions = {}
): NdContactRunAccumulator {
  const restSpeed = options.restSpeed ?? 1e-6;
  const terminals: Record<string, number> = {};
  const conditions = {} as Record<
    XpbdIncrementalPotentialDiagnosisConditionN,
    number
  >;
  const levers = {} as Record<XpbdIncrementalPotentialDiagnosisLeverN, number>;
  const filterVerdicts: Record<string, number> = {};
  let steps = 0;
  let applied = 0;
  let firstRefusedStep: number | null = null;
  let settledStep: number | null = null;
  let moved = false;
  let lastSpeed = Number.POSITIVE_INFINITY;

  return {
    add(record: NdContactStepRecord): void {
      steps++;
      terminals[record.terminal] = (terminals[record.terminal] ?? 0) + 1;
      const { condition } = record.diagnosis;
      conditions[condition] = (conditions[condition] ?? 0) + 1;
      for (const lever of record.diagnosis.levers) {
        levers[lever] = (levers[lever] ?? 0) + 1;
      }
      for (const verdict of record.filterVerdicts) {
        filterVerdicts[verdict.status] = (filterVerdicts[verdict.status] ?? 0) + 1;
      }
      if (record.applied) applied++;
      else if (firstRefusedStep === null) firstRefusedStep = record.stepIndex;
      if (record.displacement > 0) moved = true;
      if (settledStep === null && moved && record.maximumSpeed < restSpeed) {
        settledStep = record.stepIndex;
      }
      lastSpeed = record.maximumSpeed;
    },
    get summary(): NdContactRunSummary {
      return Object.freeze({
        steps,
        applied,
        refused: steps - applied,
        terminals: Object.freeze({ ...terminals }),
        conditions: Object.freeze({ ...conditions }),
        levers: Object.freeze({ ...levers }),
        filterVerdicts: Object.freeze({ ...filterVerdicts }),
        firstRefusedStep,
        settledStep,
        moved,
        reachedRest: steps > 0 && applied === steps && moved && lastSpeed < restSpeed
      });
    }
  };
}

/** Reduces a run's step records to the numbers the panes display. */
export function summarizeNdContactRun(
  records: readonly NdContactStepRecord[],
  options: SummarizeOptions = {}
): NdContactRunSummary {
  const accumulator = createNdContactRunAccumulator(options);
  for (const record of records) accumulator.add(record);
  return accumulator.summary;
}
