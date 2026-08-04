import { describeRepresentationHitN } from '@holotope/core';
import { representationHitFromProjectedSurface } from '@holotope/three';
import {
  buildSheetScene,
  isRefusedReport,
  stepSheetScene,
  type CandidateSearch,
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
 * Sheet resolutions offered, coarsest first.
 *
 * Every step costs a full pass over each provider, so a finer sheet is a real
 * decision rather than a display setting — the control names the element count
 * so the trade is visible before it is made.
 */
const RESOLUTIONS = [5, 8, 12, 16] as const;
const TILES = 9;

/** Recorded steps advanced per rendered frame, cycled by the speed control. */
const REPLAY_SPEEDS = [1, 2, 4, 8] as const;

interface PageState {
  scene: SheetScene;
  views: SheetViews;
  replay: SheetReplay;
  search: CandidateSearch;
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
  panel: document.getElementById('inspector')
};
if (host.perspective === null || host.coordinate === null || host.panel === null) {
  throw new Error('source-linked sheet: page is missing its view or panel hosts');
}

const panel = createSheetPanel();
host.panel.appendChild(panel.element);

function build(search: CandidateSearch, resolution: number): PageState {
  const scene = buildSheetScene({ resolution, tiles: TILES, search, id: 'sheet' });
  const views = createSheetViews(
    { perspective: host.perspective!, coordinate: host.coordinate! },
    scene.sheet,
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
    scene, views, search, resolution,
    replay: createSheetReplay(scene.sheet),
    running: false, applied: 0, report: null, selection: null,
    reviewing: null, reviewReport: null,
    playing: false, speed: REPLAY_SPEEDS[0]
  };
}

let state = build('exhaustive', RESOLUTIONS[0]);

function redraw(): void {
  const reviewing = state.reviewing;
  panel.update(
    reviewing === null ? state.report : state.reviewReport,
    state.selection, state.applied, state.search,
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
  // The selection follows the moving source: same triangle, new position.
  if (state.selection !== null) {
    state.views.showSelection(state.selection.sourceVertices);
  }
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

function reset(
  search: CandidateSearch = state.search,
  resolution: number = state.resolution
): void {
  const wasRunning = state.running;
  state.views.dispose();
  state = build(search, resolution);
  state.running = wasRunning;
  state.views.resize();
  syncReplayControl();
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
const searchButton = control('control-search');
const resolutionButton = control('control-resolution');
const replaySlider = control('control-replay') as HTMLInputElement;
const replayLabel = control('control-replay-label');
const playButton = control('control-play');
const restartButton = control('control-replay-restart');
const speedButton = control('control-replay-speed');

function syncControls(): void {
  runButton.textContent = state.running ? 'Pause' : 'Run';
  runButton.setAttribute('aria-pressed', String(state.running));
  searchButton.textContent = state.search === 'exhaustive'
    ? 'Search: exhaustive'
    : 'Search: static hierarchy';
  searchButton.setAttribute(
    'aria-pressed', String(state.search === 'static-hierarchy')
  );
  const cells = (state.resolution - 1) * (state.resolution - 1) * 2;
  resolutionButton.textContent =
    `${state.resolution}×${state.resolution} · ${cells} tri`;
  playButton.textContent = state.playing ? '❚❚ Pause' : '▶ Play';
  playButton.setAttribute('aria-pressed', String(state.playing));
  speedButton.textContent = `×${state.speed}`;
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
  reset(state.search, next);
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

control('control-reset-views').addEventListener('click', () => {
  state.views.resetCameras();
});

searchButton.addEventListener('click', () => {
  // Changing broadphase organization restarts the deterministic scene so the
  // two settings can be compared from the same start. It changes which bounds
  // are asked, never the ordered candidates or the trajectory.
  reset(state.search === 'exhaustive' ? 'static-hierarchy' : 'exhaustive');
  syncControls();
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
