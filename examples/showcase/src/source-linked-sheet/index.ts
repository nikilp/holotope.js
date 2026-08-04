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

const RESOLUTION = 5;
const TILES = 9;

interface PageState {
  scene: SheetScene;
  views: SheetViews;
  search: CandidateSearch;
  running: boolean;
  applied: number;
  report: SheetStepReport | null;
  selection: SheetSelection | null;
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

function build(search: CandidateSearch): PageState {
  const scene = buildSheetScene({
    resolution: RESOLUTION, tiles: TILES, search, id: 'sheet'
  });
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
    scene, views, search,
    running: false, applied: 0, report: null, selection: null
  };
}

let state = build('exhaustive');

function redraw(): void {
  panel.update(state.report, state.selection, state.applied, state.search);
}

function advance(): void {
  state.report = stepSheetScene(state.scene);
  if (state.report.status === 'applied') state.applied++;
  // A refusal leaves the configuration untouched, so continuing would re-solve
  // the same state and refuse identically — burning a full iteration budget per
  // frame while nothing moves. Stop, and let the status row say why.
  if (isRefusedReport(state.report)) state.running = false;
  state.views.refresh();
  // The selection follows the moving source: same triangle, new position.
  if (state.selection !== null) {
    state.views.showSelection(state.selection.sourceVertices);
  }
}

function reset(search: CandidateSearch = state.search): void {
  const wasRunning = state.running;
  state.views.dispose();
  state = build(search);
  state.running = wasRunning;
  state.views.resize();
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

function syncControls(): void {
  runButton.textContent = state.running ? 'Pause' : 'Run';
  runButton.setAttribute('aria-pressed', String(state.running));
  searchButton.textContent = state.search === 'exhaustive'
    ? 'Search: exhaustive'
    : 'Search: static hierarchy';
  searchButton.setAttribute(
    'aria-pressed', String(state.search === 'static-hierarchy')
  );
}

runButton.addEventListener('click', () => {
  state.running = !state.running;
  syncControls();
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
redraw();

function frame(): void {
  if (state.running) {
    advance();
    redraw();
    // `advance` clears `running` on a refusal. Resync so the Run control does
    // not keep claiming the scene is playing after it has stopped itself.
    if (!state.running) syncControls();
  }
  state.views.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
