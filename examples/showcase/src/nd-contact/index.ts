import { diagnoseNdContactStep, type NdContactDiagnosis } from './diagnose.js';
import { createNdContactRunAccumulator, type NdContactRunAccumulator } from './instruments.js';
import {
  createBarrierPlot,
  createPane2D,
  createPane3D,
  createPane4DProjection,
  createPane4DSection,
  type NdContactPane,
  type SectionView
} from './panes.js';
import { PerspectiveProjection } from '@holotope/core';
import { FLOOR_AXIS, buildNdContactScene, type NdContactScene } from './scene.js';
import { advanceNdContact, type NdContactDirection, type NdContactStepRecord } from './step.js';
import { setupShowcaseUI } from '../ui.js';

setupShowcaseUI();

interface Settings {
  direction: NdContactDirection;
  activationDistance: number;
  stiffness: number;
  gradientTolerance: number | undefined;
  sliceOffset: number;
}

const settings: Settings = {
  direction: 'default',
  activationDistance: 0.05,
  stiffness: 1,
  gradientTolerance: undefined,
  sliceOffset: 0
};

interface Panel {
  readonly dimension: number;
  scene: NdContactScene;
  pane: NdContactPane;
  accumulator: NdContactRunAccumulator;
  latest: NdContactStepRecord | null;
  stepIndex: number;
  readonly host: HTMLElement;
  readonly readout: HTMLElement;
}

const R4_SPREAD = 0.35;

const sceneFor = (dimension: number): NdContactScene =>
  buildNdContactScene({
    dimension,
    activationDistance: settings.activationDistance,
    stiffness: settings.stiffness,
    // Only R⁴ spreads its extra axes, so its section sweep has something to
    // reveal. Verified not to disturb the shared coordinates.
    ...(dimension >= 4 ? { extraAxisSpread: R4_SPREAD } : {})
  });

const projection4 = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
let section: SectionView | null = null;

const paneFor = (dimension: number, host: HTMLElement, scene: NdContactScene): NdContactPane => {
  if (dimension === 2) return createPane2D(host, scene);
  if (dimension === 3) return createPane3D(host, scene);
  // The R⁴ panel drives two views of one source: a projection and an exact
  // section. `pane.draw` fans out to both.
  const projected = createPane4DProjection(host, scene, projection4);
  const sectioned = createPane4DSection(document.getElementById('view4s')!, scene);
  section = sectioned;
  return {
    draw: () => {
      sectioned.setOffset(settings.sliceOffset);
      projected.draw();
      sectioned.pane.draw();
    },
    resize: () => {
      projected.resize();
      sectioned.pane.resize();
    },
    dispose: () => {
      projected.dispose();
      sectioned.pane.dispose();
      section = null;
    }
  };
};

const buildPanel = (dimension: number, hostId: string, readoutId: string): Panel => {
  const host = document.getElementById(hostId)!;
  const scene = sceneFor(dimension);
  return {
    dimension,
    scene,
    pane: paneFor(dimension, host, scene),
    accumulator: createNdContactRunAccumulator(),
    latest: null,
    stepIndex: 0,
    host,
    readout: document.getElementById(readoutId)!
  };
};

const panels: Panel[] = [
  buildPanel(2, 'view2', 'readout2'),
  buildPanel(3, 'view3', 'readout3'),
  buildPanel(4, 'view4p', 'readout4')
];
const barrier = createBarrierPlot(document.getElementById('barrier')!);

/** Rebuilds every scene from the current settings. Barriers hold `d̂` and `κ`
 * at construction, so changing either is a rebuild rather than a mutation. */
const reset = (): void => {
  for (const panel of panels) {
    panel.pane.dispose();
    panel.scene = sceneFor(panel.dimension);
    panel.pane = paneFor(panel.dimension, panel.host, panel.scene);
    panel.accumulator = createNdContactRunAccumulator();
    panel.latest = null;
    panel.stepIndex = 0;
  }
};

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

const controls = document.getElementById('controls')!;

const control = (label: string, node: HTMLElement): HTMLElement => {
  const wrap = document.createElement('div');
  wrap.className = 'ctl';
  const text = document.createElement('label');
  text.textContent = label;
  wrap.append(text, node);
  controls.appendChild(wrap);
  return wrap;
};

let running = true;

const playButton = document.createElement('button');
playButton.className = 'primary';
playButton.textContent = 'pause';
playButton.addEventListener('click', () => {
  running = !running;
  playButton.textContent = running ? 'pause' : 'play';
});
controls.appendChild(playButton);

const resetButton = document.createElement('button');
resetButton.textContent = 'reset';
resetButton.addEventListener('click', reset);
controls.appendChild(resetButton);

const select = (
  label: string,
  entries: readonly (readonly [string, string])[],
  onChange: (value: string) => void
): void => {
  const node = document.createElement('select');
  for (const [value, text] of entries) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    node.appendChild(option);
  }
  node.addEventListener('change', () => {
    onChange(node.value);
    reset();
  });
  control(label, node);
};

select(
  'direction',
  [
    ['default', 'default (steepest descent)'],
    ['mass-diagonal', 'mass-diagonal (a no-op here)'],
    ['newton', 'Newton (reaches rest)']
  ],
  (value) => {
    settings.direction = value as NdContactDirection;
  }
);

select(
  'tolerance',
  [
    ['default', 'default (1e-8)'],
    ['1e-2', '1e-2 — silent success']
  ],
  (value) => {
    settings.gradientTolerance = value === 'default' ? undefined : Number(value);
  }
);

const slider = (
  label: string,
  min: number,
  max: number,
  step: number,
  initial: number,
  format: (value: number) => string,
  apply: (value: number) => void
): void => {
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initial);
  const value = document.createElement('span');
  value.className = 'val';
  value.textContent = format(initial);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    value.textContent = format(next);
    apply(next);
    reset();
  });
  control(label, input).appendChild(value);
};

slider('d̂', 0.01, 0.3, 0.01, settings.activationDistance, (v) => v.toFixed(2), (v) => {
  settings.activationDistance = v;
});
slider('κ', -2, 3, 0.5, 0, (v) => `10^${v.toFixed(1)}`, (v) => {
  settings.stiffness = 10 ** v;
});

// The slice sweeps the R⁴ pane's section hyperplane. It changes only what is
// *shown*: the source keeps evolving on coordinates the section cannot display,
// which is the claim the provenance readout below makes checkable.
const offsetLabel = document.getElementById('offsetLabel')!;
const sliceInput = document.createElement('input');
sliceInput.type = 'range';
sliceInput.min = '-0.9';
sliceInput.max = '0.9';
sliceInput.step = '0.01';
sliceInput.value = '0';
const sliceValue = document.createElement('span');
sliceValue.className = 'val';
sliceValue.textContent = '0.00';
sliceInput.addEventListener('input', () => {
  settings.sliceOffset = Number(sliceInput.value);
  sliceValue.textContent = settings.sliceOffset.toFixed(2);
  offsetLabel.textContent = settings.sliceOffset.toFixed(2);
});
control('slice w', sliceInput).appendChild(sliceValue);

/* -------------------------------------------------------------------------- */
/* Readouts — built as DOM nodes; every value here is solver-derived            */
/* -------------------------------------------------------------------------- */

const conditionClass = (diagnosis: NdContactDiagnosis): string =>
  diagnosis.condition === 'progressed'
    ? 'progressed'
    : diagnosis.condition === 'converged-without-iteration'
      ? 'silent'
      : 'frozen';

const appendRow = (parent: HTMLElement, label: string, value: string): void => {
  const row = document.createElement('div');
  row.className = 'row';
  const left = document.createElement('span');
  left.textContent = label;
  const right = document.createElement('span');
  right.textContent = value;
  row.append(left, right);
  parent.appendChild(row);
};

const appendSection = (parent: HTMLElement, title: string): void => {
  const node = document.createElement('div');
  node.className = 'sect';
  node.textContent = title;
  parent.appendChild(node);
};

const appendNote = (parent: HTMLElement, className: string, text: string): void => {
  const node = document.createElement('div');
  node.className = className;
  node.textContent = text;
  parent.appendChild(node);
};

const tally = (counts: Readonly<Record<string, number>>): string =>
  Object.entries(counts)
    .map(([key, count]) => `${key} ${count}`)
    .join('   ') || '—';

const renderReadout = (panel: Panel): void => {
  const latest = panel.latest;
  panel.readout.replaceChildren();
  if (!latest) {
    appendNote(panel.readout, 'summary', 'waiting for the first step…');
    return;
  }

  const diagnosis = diagnoseNdContactStep(latest);
  const { summary } = panel.accumulator;

  const head = document.createElement('div');
  head.className = 'row';
  const headLabel = document.createElement('span');
  headLabel.textContent = 'diagnosis';
  const badge = document.createElement('span');
  badge.className = `cond ${conditionClass(diagnosis)}`;
  badge.textContent = diagnosis.condition;
  head.append(headLabel, badge);
  panel.readout.appendChild(head);

  if (diagnosis.levers.length > 0) {
    appendNote(panel.readout, 'levers', `levers: ${diagnosis.levers.join(', ')}`);
  }
  appendNote(panel.readout, 'summary', diagnosis.summary);

  appendSection(panel.readout, `step ${latest.stepIndex} · t = ${latest.time.toFixed(3)} s`);
  appendRow(
    panel.readout,
    'terminal',
    latest.terminal + (latest.convergencePoint ? ` @ ${latest.convergencePoint}` : '')
  );
  appendRow(panel.readout, 'applied', String(latest.applied));
  appendRow(panel.readout, 'accepted iterations', String(latest.acceptedIterations));
  appendRow(panel.readout, 'displacement', latest.displacement.toExponential(2));
  appendRow(panel.readout, '|gradient| final', latest.gradientNormFinal.toExponential(2));
  appendRow(panel.readout, 'min height', latest.minimumHeight.toFixed(6));
  appendRow(panel.readout, 'max |v|', latest.maximumSpeed.toFixed(4));

  appendSection(panel.readout, 'run');
  appendRow(panel.readout, 'applied / refused', `${summary.applied} / ${summary.refused}`);
  appendRow(panel.readout, 'moved', String(summary.moved));
  appendRow(panel.readout, 'reached rest', String(summary.reachedRest));

  appendSection(panel.readout, 'step filter verdicts');
  appendNote(panel.readout, 'summary', tally(summary.filterVerdicts));

  appendSection(panel.readout, 'direction outcomes');
  appendNote(panel.readout, 'summary', tally(latest.directionOutcomes));

  if (panel.dimension >= 4) appendProvenance(panel);
};

/**
 * The one-number version of "simulation operates on the source, not the
 * picture".
 *
 * The floor is the hyperplane `x₁ = 0`, so a particle's signed distance to it in
 * the source is simply its `x₁`. The same particle's height as *read off the
 * projected image* is the second component of its projection, which perspective
 * scales by the hidden coordinate. Those two numbers disagree, and the barrier
 * was evaluated on the first.
 */
const appendProvenance = (panel: Panel): void => {
  const last = panel.scene.dimension - 1;
  // Report the particle the section is currently cutting closest to.
  const nearest = panel.scene.particles.reduce((best, particle) =>
    Math.abs(particle.position.data[last]! - settings.sliceOffset) <
    Math.abs(best.position.data[last]! - settings.sliceOffset)
      ? particle
      : best
  );
  const sourceHeight = nearest.position.data[FLOOR_AXIS]!;
  const projectedHeight = projection4.projectPoint(nearest.position.data)[1];
  const w = nearest.position.data[last]!;
  const radius = section?.ballRadius ?? 0;
  const delta = Math.abs(w - settings.sliceOffset);

  appendSection(panel.readout, 'provenance — source vs picture');
  const box = document.createElement('div');
  box.className = 'prov';
  panel.readout.appendChild(box);
  appendRow(box, 'nearest to slice', nearest.id);
  appendRow(box, 'source w', w.toFixed(4));
  appendRow(box, 'source height x₁', sourceHeight.toFixed(6));
  appendRow(box, 'projected height', projectedHeight.toFixed(6));
  appendRow(box, 'disagreement', Math.abs(sourceHeight - projectedHeight).toExponential(2));
  appendRow(box, 'in section', delta < radius ? `yes (Δw ${delta.toFixed(3)})` : `no (Δw ${delta.toFixed(3)})`);
  appendNote(
    panel.readout,
    'summary',
    'The barrier was evaluated on the source height. A particle absent from the ' +
      'section is still in the simulation — the section is a picture, not the state.'
  );
};

/* -------------------------------------------------------------------------- */
/* Loop                                                                        */
/* -------------------------------------------------------------------------- */

const MAX_STEPS = 600;
const STEP_BUDGET_MS = 10;

const tick = (): void => {
  if (running) {
    // Advance under a wall-clock budget rather than one step per frame: dt is
    // 1/120 s, so a single step per frame runs at half speed at best, and the
    // frozen configuration is far slower still because a refused step does the
    // full solve before discarding it.
    const deadline = performance.now() + STEP_BUDGET_MS;
    let advanced = true;
    while (advanced && performance.now() < deadline) {
      advanced = false;
      for (const panel of panels) {
        if (panel.stepIndex >= MAX_STEPS) continue;
        const record = advanceNdContact({
          scene: panel.scene,
          stepIndex: panel.stepIndex,
          direction: settings.direction,
          ...(settings.gradientTolerance !== undefined
            ? { gradientTolerance: settings.gradientTolerance }
            : {})
        });
        panel.accumulator.add(record);
        panel.latest = record;
        panel.stepIndex++;
        advanced = true;
      }
    }
  }
  for (const panel of panels) {
    panel.pane.draw();
    renderReadout(panel);
  }

  const gap = Math.min(
    ...panels.flatMap((panel) =>
      panel.scene.particles.map((particle) => particle.position.data[FLOOR_AXIS]!)
    )
  );
  barrier.draw(settings.activationDistance, settings.stiffness, gap);
  requestAnimationFrame(tick);
};

addEventListener('resize', () => {
  for (const panel of panels) panel.pane.resize();
  barrier.resize();
});

tick();
