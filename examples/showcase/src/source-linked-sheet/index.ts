import { describeRepresentationHitN } from '@holotope/core';
import { representationHitFromProjectedSurface } from '@holotope/three';
import {
  buildSheetScene,
  isRefusedReport,
  stepSheetScene,
  type SheetScene,
  type SheetStepReport
} from './scene.js';
import { createSheetPanel } from './panel.js';
import { createSheetReplay, type SheetReplay } from './replay.js';
import { readSheetSelection, type SheetSelection } from './selection.js';
import { createSheetViews, type SheetView, type SheetViews } from './view.js';

/**
 * Wiring: controls, the animation loop, and the selection that both views
 * share.
 *
 * Everything substantive lives elsewhere — the physics in `scene`, the
 * representations in `view`, the honest reading of a pick in `selection`, and
 * the inspector in `panel`. This file only connects them.
 */

/**
 * Sheet resolutions offered, coarsest first — a measured list, not a menu.
 *
 * Every step costs a full pass over each provider, so a finer sheet is a real
 * decision rather than a display setting; the control names the element count
 * so the trade is visible before it is made. 12x12 and 16x16 are deliberately
 * not offered: with 140+ simultaneously active stiff barriers at impact, the
 * steepest-descent minimizer exhausts its iteration budget around step 72,
 * so those scenes stop before they have shown anything. That measured
 * limitation is recorded in Kitchen as the second-order-minimizer bottleneck
 * rather than papered over with a bigger budget here.
 *
 * **Neither survivor is a vetted scene, and this page is not built.** Both
 * cross the support's surface once the sheet drapes past its finite edge — 8x8
 * at applied step 230 of 242, 5x5 at 575 of 1,045 — with every vertex still
 * legally outside the barrier's shell the whole way. That is why the route is
 * absent from the build inputs and the gallery: the list below is preserved
 * evidence of a measured failure, not a shortlist waiting to be published.
 * Restoring the route needs edge- and face-level contact candidates, not a
 * different entry here.
 */
const RESOLUTIONS = [5, 8] as const;

/** Recorded steps advanced per rendered frame, cycled by the speed control. */
const REPLAY_SPEEDS = [1, 2, 4, 8] as const;

interface PageState {
  scene: SheetScene;
  views: SheetViews;
  replay: SheetReplay;
  resolution: number;
  running: boolean;
  applied: number;
  /** The live report. A review never overwrites it. */
  report: SheetStepReport | null;
  selection: SheetSelection | null;
  /** One-based recorded step on display, or null while showing live state. */
  reviewing: number | null;
  /** The recorded report on display, paired with `reviewing`. */
  reviewReport: SheetStepReport | null;
  /**
   * Whether the recording is playing itself back.
   *
   * Distinct from `running`, and the distinction is the point: `running`
   * advances the solver and costs a full step, while this only walks frames
   * that were already paid for. A single control for both would make an
   * expensive thing and a free one look alike.
   */
  playing: boolean;
  /** Recorded steps advanced per rendered frame while playing. */
  speed: number;
}

const host = {
  perspective: document.getElementById('view-perspective'),
  coordinate: document.getElementById('view-coordinate'),
  slice: document.getElementById('view-slice'),
  panel: document.getElementById('inspector')
};
if (host.perspective === null || host.coordinate === null
  || host.slice === null || host.panel === null) {
  throw new Error('source-linked sheet: page is missing its view or panel hosts');
}

const panel = createSheetPanel();
host.panel.appendChild(panel.element);

function build(resolution: number): PageState {
  const scene = buildSheetScene({ resolution, id: 'sheet' });
  const views = createSheetViews(
    {
      perspective: host.perspective!,
      coordinate: host.coordinate!,
      slice: host.slice!
    },
    scene.sheet,
    scene.sheetGroup,
    scene.obstacle
  );
  panel.describeScene({
    pinnedVertices: scene.fixedVertices,
    obstacleCells:
      scene.obstacleGroup.indices.length / scene.obstacleGroup.verticesPerCell,
    // Both providers travel with their paired filter; the solve receives them
    // in this order.
    stepFilterIds: [scene.bending.stepFilter.id, scene.contact.stepFilter.id]
  });
  return {
    scene, views, resolution,
    replay: createSheetReplay(scene.sheet),
    running: false, applied: 0, report: null, selection: null,
    reviewing: null, reviewReport: null,
    playing: false, speed: REPLAY_SPEEDS[0]
  };
}

let state = build(RESOLUTIONS[0]);

function redraw(): void {
  const reviewing = state.reviewing;
  panel.update(
    reviewing === null ? state.report : state.reviewReport,
    state.selection, state.applied,
    reviewing === null ? null : {
      frame: reviewing,
      recorded: state.replay.length,
      truncated: state.replay.truncated
    }
  );
}

/** Puts the exact live configuration back before anything advances it. */
function leaveReview(): void {
  state.playing = false;
  if (state.reviewing === null) return;
  state.replay.endReview();
  state.reviewing = null;
  state.reviewReport = null;
  refreshSource();
}

/** Redraws both views and the selection outline from whatever the source holds. */
function refreshSource(): void {
  state.views.refresh();
  // The overlay is coloured from the forces the step already produced, so a
  // scrubbed frame shows that frame's contact roles rather than the live ones.
  const shown = state.reviewing === null ? state.report : state.reviewReport;
  if (shown !== null) state.views.showContact(shown.contactForces);
  // The selection follows the moving source: same triangle, new position.
  if (state.selection !== null) {
    state.views.showSelection(state.selection.sourceVertices);
  }
  syncSliceControl();
}

function advance(): void {
  leaveReview();
  state.report = stepSheetScene(state.scene);
  if (state.report.status === 'applied') {
    state.applied++;
    // Recorded after the step is applied, so a frame is the configuration that
    // step produced rather than the one it started from.
    state.replay.record(state.report);
  }
  // A refusal leaves the configuration untouched, so continuing would re-solve
  // the same state and refuse identically — burning a full iteration budget per
  // frame while nothing moves. Stop, and let the status row say why.
  if (isRefusedReport(state.report)) state.running = false;
  refreshSource();
  syncReplayControl();
}

/** Shows a recorded step. The solver's own state is untouched. */
function review(frame: number): void {
  if (state.replay.length === 0) return;
  const clamped = Math.min(Math.max(frame, 1), state.replay.length);
  state.running = false;
  state.reviewing = clamped;
  state.reviewReport = state.replay.review(clamped);
  refreshSource();
  syncControls();
  syncReplayControl();
  redraw();
}

/**
 * Starts or stops playback of the recording.
 *
 * Pressing play at the end starts over, which is what a reader who has just
 * watched it reach the end and pressed play again is asking for.
 */
function togglePlay(): void {
  if (state.replay.length === 0) return;
  if (state.playing) { state.playing = false; syncControls(); return; }
  state.running = false;
  const at = state.reviewing;
  if (at === null || at >= state.replay.length) review(1);
  state.playing = true;
  syncControls();
}

function reset(resolution: number = state.resolution): void {
  const wasRunning = state.running;
  const wasShowingContact = state.views.contactVisible;
  state.views.dispose();
  state = build(resolution);
  state.running = wasRunning;
  state.views.contactVisible = wasShowingContact;
  state.views.resize();
  syncReplayControl();
  syncSliceControl();
  redraw();
}

function select(view: SheetView, event: MouseEvent): void {
  const pick = state.views.pick(view, event);
  if (pick === null) {
    state.selection = null;
    state.views.showSelection(null);
    redraw();
    return;
  }
  const report = describeRepresentationHitN(
    representationHitFromProjectedSurface(pick.surface, pick.intersection)
  );
  state.selection = readSheetSelection(report, state.scene.sheetGroup);
  state.views.showSelection(state.selection.sourceVertices);
  redraw();
}

// --- controls ----------------------------------------------------------------

function control(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`source-linked sheet: missing #${id}`);
  return element;
}

const runButton = control('control-run');
const resolutionButton = control('control-resolution');
const replaySlider = control('control-replay') as HTMLInputElement;
const replayLabel = control('control-replay-label');
const playButton = control('control-play');
const restartButton = control('control-replay-restart');
const speedButton = control('control-replay-speed');
const contactButton = control('control-contact');
const sliceSlider = control('control-slice') as HTMLInputElement;
const sliceLabel = control('control-slice-label');

function syncControls(): void {
  runButton.textContent = state.running ? 'Pause' : 'Run';
  runButton.setAttribute('aria-pressed', String(state.running));
  const cells = (state.resolution - 1) * (state.resolution - 1) * 2;
  resolutionButton.textContent =
    `${state.resolution}×${state.resolution} · ${cells} tri`;
  playButton.textContent = state.playing ? '❚❚ Pause' : '▶ Play';
  playButton.setAttribute('aria-pressed', String(state.playing));
  speedButton.textContent = `×${state.speed}`;
  contactButton.setAttribute('aria-pressed', String(state.views.contactVisible));
}

/** Keeps the section control inside the range the source actually spans. */
function syncSliceControl(): void {
  const [low, high] = state.views.slice.range;
  sliceSlider.min = low.toFixed(3);
  sliceSlider.max = high.toFixed(3);
  sliceSlider.step = ((high - low) / 200 || 0.001).toFixed(5);
  sliceSlider.value = state.views.slice.offset.toFixed(3);
  // Segments and source triangles are different facts: the cut's size, and how
  // much of the sheet it crosses.
  sliceLabel.textContent =
    `Z = ${state.views.slice.offset.toFixed(2)} · ` +
    `${state.views.slice.segmentCount} segments · ` +
    `${state.views.slice.sourceCellCount} source triangles`;
}

/**
 * The scrubber tracks the recording, and only moves itself while the reader is
 * not holding it: a slider that jumped back to the end mid-drag would be
 * unusable during a run.
 */
function syncReplayControl(): void {
  const recorded = state.replay.length;
  const idle = recorded === 0;
  replaySlider.max = String(Math.max(recorded, 1));
  replaySlider.disabled = idle;
  playButton.toggleAttribute('disabled', idle);
  restartButton.toggleAttribute('disabled', idle);
  speedButton.toggleAttribute('disabled', idle);
  replaySlider.value = String(
    state.reviewing === null ? Math.max(recorded, 1) : state.reviewing
  );
  replayLabel.textContent = idle
    ? 'nothing recorded yet'
    : state.replay.truncated
      ? `step ${state.reviewing ?? recorded} / ${recorded} · recording full`
      : state.reviewing === null
        ? `${recorded} recorded · showing live`
        : `step ${state.reviewing} / ${recorded}`;
  // The ceiling is a property of this sheet, not of the page: a finer sheet
  // stores more per step and so records fewer of them. Saying how many before
  // the reader hits it beats letting the recording quietly stop growing.
  replaySlider.title =
    `${recorded} of at most ${state.replay.capacity} steps recorded ` +
    `at ${state.resolution}×${state.resolution}`;
}

runButton.addEventListener('click', () => {
  leaveReview();
  state.running = !state.running;
  syncControls();
  syncReplayControl();
  redraw();
});

control('control-step').addEventListener('click', () => {
  state.running = false;
  advance();
  syncControls();
  redraw();
});

control('control-reset').addEventListener('click', () => {
  state.running = false;
  reset();
  syncControls();
});

resolutionButton.addEventListener('click', () => {
  // A finer sheet is a different scene, so it starts from the beginning rather
  // than pretending the recorded run carries over to it.
  const next = RESOLUTIONS[
    (RESOLUTIONS.indexOf(state.resolution as typeof RESOLUTIONS[number]) + 1)
    % RESOLUTIONS.length
  ]!;
  state.running = false;
  reset(next);
  syncControls();
});

replaySlider.addEventListener('input', () => {
  state.playing = false;
  review(Number(replaySlider.value));
});

playButton.addEventListener('click', () => { togglePlay(); redraw(); });

restartButton.addEventListener('click', () => { review(1); });

speedButton.addEventListener('click', () => {
  state.speed = REPLAY_SPEEDS[
    (REPLAY_SPEEDS.indexOf(state.speed as typeof REPLAY_SPEEDS[number]) + 1)
    % REPLAY_SPEEDS.length
  ]!;
  syncControls();
});

contactButton.addEventListener('click', () => {
  state.views.contactVisible = !state.views.contactVisible;
  syncControls();
});

sliceSlider.addEventListener('input', () => {
  state.views.slice.setOffset(Number(sliceSlider.value));
  syncSliceControl();
});

control('control-reset-views').addEventListener('click', () => {
  state.views.resetCameras();
});

for (const key of ['perspective', 'coordinate'] as const) {
  const element = key === 'perspective' ? host.perspective : host.coordinate;
  element.addEventListener('click', (event) => {
    select(
      key === 'perspective' ? state.views.perspective : state.views.coordinate,
      event as MouseEvent
    );
  });
}

window.addEventListener('resize', () => { state.views.resize(); });

// --- loop --------------------------------------------------------------------

state.views.resize();
syncControls();
syncReplayControl();
syncSliceControl();
redraw();

function frame(): void {
  if (state.running) {
    advance();
    redraw();
    // `advance` clears `running` on a refusal. Resync so the Run control does
    // not keep claiming the scene is playing after it has stopped itself.
    if (!state.running) syncControls();
  } else if (state.playing) {
    // Playback only walks frames that were already solved, so it costs a
    // redraw rather than a step and can run far faster than the scene does.
    const next = (state.reviewing ?? 0) + state.speed;
    if (next >= state.replay.length) {
      review(state.replay.length);
      state.playing = false;
      syncControls();
    } else {
      review(next);
    }
  }
  state.views.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
