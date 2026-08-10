import { describe, expect, it } from 'vitest';
import { sampleBarrierCurve, summarizeNdContactRun } from '../src/nd-contact/instruments.js';
import { buildNdContactScene } from '../src/nd-contact/scene.js';
import { advanceNdContact, type NdContactDirection, type NdContactStepRecord } from '../src/nd-contact/step.js';

interface RunOptions {
  readonly dimension: number;
  readonly steps: number;
  readonly direction?: NdContactDirection;
  readonly gradientTolerance?: number;
  readonly activationDistance?: number;
}

function run(options: RunOptions): readonly NdContactStepRecord[] {
  const scene = buildNdContactScene({
    dimension: options.dimension,
    ...(options.activationDistance !== undefined
      ? { activationDistance: options.activationDistance }
      : {})
  });
  const records: NdContactStepRecord[] = [];
  for (let stepIndex = 0; stepIndex < options.steps; stepIndex++) {
    records.push(
      advanceNdContact({
        scene,
        stepIndex,
        ...(options.direction !== undefined ? { direction: options.direction } : {}),
        ...(options.gradientTolerance !== undefined
          ? { gradientTolerance: options.gradientTolerance }
          : {})
      })
    );
  }
  return records;
}

const heights = (records: readonly NdContactStepRecord[]): readonly number[] =>
  records.map((record) => record.minimumHeight);

describe('the ND contact demo drives one step path across dimensions', () => {
  /**
   * The demo's central claim, asserted the sharp way.
   *
   * "No dimension branch is visible on reading" is a much weaker statement than
   * this: a scene differing only in how many axes it has must evolve through the
   * *same doubles* in the axes it shares, because the same code ran on them.
   */
  it('produces bitwise identical trajectories in R2, R3 and R4', () => {
    const runs = [2, 3, 4].map((dimension) =>
      run({ dimension, steps: 60, direction: 'newton' })
    );

    expect(heights(runs[1]!)).toEqual(heights(runs[0]!));
    expect(heights(runs[2]!)).toEqual(heights(runs[1]!));

    // Liveness first: identical trajectories are trivially satisfied by three
    // scenes that never moved.
    for (const records of runs) {
      expect(summarizeNdContactRun(records).moved).toBe(true);
    }
  }, 120_000);

  /**
   * The R⁴ pane needs the extra axes to carry real state, or a hyperplane
   * section is degenerate — everything at one offset and nothing anywhere else.
   *
   * Spreading them is only safe if the extra axes do not disturb the shared
   * ones. Each barrier is axis-aligned, so a coordinate enters only its own
   * axis's barrier, and gravity acts along the floor axis alone; the prediction
   * is that x and y evolve identically whether or not w is spread. Asserted
   * rather than assumed, because it is a claim about the solver's coupling.
   */
  it('leaves the shared coordinates bitwise unchanged when the extra axes are spread', () => {
    const shared = (spread: number): readonly number[] => {
      const scene = buildNdContactScene({ dimension: 4, extraAxisSpread: spread });
      const trace: number[] = [];
      for (let stepIndex = 0; stepIndex < 60; stepIndex++) {
        advanceNdContact({ scene, stepIndex, direction: 'newton' });
        for (const particle of scene.particles) {
          trace.push(particle.position.data[0]!, particle.position.data[1]!);
        }
      }
      return trace;
    };

    const flat = shared(0);
    const spreadOut = shared(0.35);
    expect(spreadOut).toEqual(flat);

    // Liveness: the trace is only meaningful if the scene actually moved.
    expect(new Set(flat).size).toBeGreaterThan(1);
  }, 120_000);

  /**
   * The escalation ladder, as the demo will render it: same scene, same code
   * path, one rung freezes and one reaches rest. The ordering of the diagnosis
   * levers exists because of this measurement.
   */
  it('freezes on the default direction and reaches rest on Newton', () => {
    const frozen = summarizeNdContactRun(run({ dimension: 3, steps: 200 }));
    const rested = summarizeNdContactRun(
      run({ dimension: 3, steps: 200, direction: 'newton' })
    );

    // Liveness first for both: each scene really did fall.
    expect(frozen.moved).toBe(true);
    expect(rested.moved).toBe(true);

    expect(frozen.reachedRest).toBe(false);
    expect(frozen.refused).toBeGreaterThan(0);
    expect(frozen.firstRefusedStep).toBeGreaterThan(0);
    expect(frozen.terminals['iteration-limit']).toBeGreaterThan(0);

    expect(rested.reachedRest).toBe(true);
    expect(rested.refused).toBe(0);
    expect(rested.settledStep).toBeGreaterThan(0);
  }, 120_000);

  /**
   * `mass-diagonal` is the rung a caller finds first, because it is the one
   * policy reachable from the options type. Pinning that it changes nothing here
   * keeps the finding honest: the ladder has two rungs, not three.
   */
  it('is unchanged by the mass-diagonal direction, which is a no-op here', () => {
    const base = run({ dimension: 3, steps: 60 });
    const massDiagonal = run({ dimension: 3, steps: 60, direction: 'mass-diagonal' });
    expect(heights(massDiagonal)).toEqual(heights(base));
  }, 120_000);
});

describe('the diagnosis seam names legitimate levers', () => {
  it('classifies a refused step as iteration-limit and offers Newton first', () => {
    const records = run({ dimension: 3, steps: 120 });
    const refused = records.find((record) => !record.applied);
    expect(refused).toBeDefined();

    const diagnosis = refused!.diagnosis;
    expect(diagnosis.condition).toBe('iteration-limit');
    expect(diagnosis.levers[0]).toBe('newton-direction-policy');
    expect(diagnosis.levers).not.toContain('lower-gradient-tolerance');
  }, 120_000);

  /**
   * The trap, and the one place the tolerance is a legitimate lever.
   *
   * Past the objective's gradient norm at the current state every solve
   * converges at `initial` in zero iterations: each step reports success and the
   * scene never moves. The diagnosis has to name this, because nothing in the
   * step result does.
   */
  it('classifies silent success and is the only place tolerance is named', () => {
    const records = run({ dimension: 3, steps: 60, gradientTolerance: 1e-2 });
    const summary = summarizeNdContactRun(records);

    // Every step succeeded and the scene never moved.
    expect(summary.applied).toBe(60);
    expect(summary.moved).toBe(false);
    expect(summary.reachedRest).toBe(false);

    const diagnosis = records[0]!.diagnosis;
    expect(diagnosis.condition).toBe('converged-without-iteration');
    // This scene is the silent success itself: every step reports `applied`
    // and nothing moves. Both offered levers are legitimate — lower the packed
    // threshold, or state the stop test in a unit that does not shrink with
    // the timestep, which is what makes this failure mode possible at all.
    expect(diagnosis.levers).toEqual([
      'lower-gradient-tolerance',
      'timestep-independent-convergence'
    ]);
    expect(records[0]!.convergencePoint).toBe('initial');
    expect(records[0]!.acceptedIterations).toBe(0);
  }, 120_000);

  it('classifies a progressing step as progressed with no levers', () => {
    const records = run({ dimension: 3, steps: 20, direction: 'newton' });
    const progressing = records.find((record) => record.applied && record.displacement > 0);
    expect(progressing).toBeDefined();

    const diagnosis = progressing!.diagnosis;
    expect(diagnosis.condition).toBe('progressed');
    expect(diagnosis.levers).toEqual([]);
  }, 120_000);
});

describe('the barrier instrument reads the shipped kernel', () => {
  it('is exactly zero at and beyond the activation distance', () => {
    const curve = sampleBarrierCurve({ activationDistance: 0.05, stiffness: 1 });
    const active = curve.filter((sample) => sample.distance < 0.05);
    const clamped = curve.filter((sample) => sample.distance >= 0.05);

    expect(active.length).toBeGreaterThan(0);
    expect(clamped.length).toBeGreaterThan(0);
    // Not merely small — exactly zero, which is the property that makes the law
    // usable: a configuration away from contact is not perturbed at all.
    for (const sample of clamped) {
      expect(sample.energy).toBe(0);
      expect(sample.firstDerivative).toBe(0);
    }
    for (const sample of active) {
      expect(sample.energy).toBeGreaterThan(0);
    }
  });

  it('rises monotonically as the gap closes', () => {
    const curve = sampleBarrierCurve({ activationDistance: 0.05, stiffness: 1 })
      .filter((sample) => sample.distance < 0.05);
    for (let index = 1; index < curve.length; index++) {
      expect(curve[index]!.energy).toBeLessThanOrEqual(curve[index - 1]!.energy);
    }
  });
});

describe('step filter verdicts are recorded', () => {
  it('records a verdict for every filter on every line-search trial', () => {
    const records = run({ dimension: 3, steps: 40, direction: 'newton' });
    const withTrials = records.filter((record) => record.filterVerdicts.length > 0);
    expect(withTrials.length).toBeGreaterThan(0);

    const statuses = new Set(
      records.flatMap((record) => record.filterVerdicts.map((verdict) => verdict.status))
    );
    // Whatever the solver actually produces, the recorded set must be drawn from
    // the filter's declared vocabulary and nothing else.
    for (const status of statuses) {
      expect(['safe', 'limited', 'indeterminate']).toContain(status);
    }
  }, 120_000);
});
