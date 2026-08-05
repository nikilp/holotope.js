import { classifyContactForce } from './contact-overlay.js';
import { SHEET_TIME_STEP, type SheetStepReport } from './scene.js';
import type { SheetSelection } from './selection.js';

/**
 * The inspector: a curated reading of the live system, built once and updated
 * in place.
 *
 * Rows are created at construction and only their value text changes
 * afterwards, so a number growing a digit cannot reflow the layout underneath a
 * reader who is watching it. The CSS carries fixed row heights and tabular
 * numerals; this module's job is simply never to rebuild the tree.
 *
 * The vocabulary is deliberate. Three different populations are reported
 * separately — pairs that exist, pairs the broadphase kept, and barriers whose
 * exact distance is inside the activation distance — because collapsing them
 * into one number is exactly the misreading that makes a broadphase look like a
 * contact solver.
 */

/** Scene facts the inspector states once rather than per step. */
export interface SheetPanelFacts {
  /** Source vertices held fixed, so a reader can see why it does not fall away. */
  readonly pinnedVertices: readonly number[];
  /** Obstacle cells contact indexes; pairs with the possible-pair count. */
  readonly obstacleCells: number;
  /** Both paired step filters, in the order the solve receives them. */
  readonly stepFilterIds: readonly string[];
}

/**
 * Which step the panel is describing, when that is not the live one.
 *
 * Scrubbing shows a *recorded* step. Every number below it was produced by the
 * solver at that step and stored, not recomputed now — so the panel says which
 * step it is reading rather than letting a reader assume the scene is live.
 */
export interface SheetReplayPosition {
  /** One-based applied step being shown. */
  readonly frame: number;
  /** How many applied steps are held. */
  readonly recorded: number;
  /** True once the recording stopped accepting frames. */
  readonly truncated: boolean;
}

/** A live inspector bound to one DOM subtree. */
export interface SheetPanel {
  readonly element: HTMLElement;
  /** Rewrites every value in place. */
  update(report: SheetStepReport | null, selection: SheetSelection | null,
    appliedSteps: number,
    replay?: SheetReplayPosition | null): void;
  /** Scene facts that do not change between steps. */
  describeScene(facts: SheetPanelFacts): void;
}

interface Row {
  readonly value: HTMLElement;
}

function section(title: string): HTMLElement {
  const heading = document.createElement('h3');
  heading.className = 'panel-heading';
  heading.textContent = title;
  return heading;
}

function makeRow(host: HTMLElement, label: string): Row {
  const row = document.createElement('div');
  row.className = 'panel-row';
  const left = document.createElement('span');
  left.className = 'panel-label';
  left.textContent = label;
  const value = document.createElement('span');
  value.className = 'panel-value';
  value.textContent = '—';
  row.append(left, value);
  host.appendChild(row);
  return { value };
}

const number = (value: number, digits = 3): string =>
  Number.isFinite(value) ? value.toFixed(digits) : '—';

/** The scene's fixed physics interval, so simulated time is stated, not implied. */


/** Inspector labels whose value belongs to one particular step. */
export const STEP_SCOPED_LABELS = [
  'status', 'diagnosis', 'minimizer iterations',
  'intrinsic stretch', 'discrete cosine fold', 'contact barrier', 'total',
  'hull source vertices', 'set queries', 'gjk iterations',
  'exactly active barriers', 'interior / edge features',
  'peak interior lateral',
  'fold hinges', 'stretch elements', 'min fold height', 'W range',
  'held by contact', 'pushed aside', 'no active barrier', 'peak lateral share'
] as const;

/** Contact-role populations for one report, from the barrier's own forces. */
function roles(report: SheetStepReport): {
  held: number; pushedAside: number; free: number; peakLateralFraction: number;
} {
  let held = 0;
  let pushedAside = 0;
  let free = 0;
  let peakLateralFraction = 0;
  for (const force of report.contactForces) {
    const { role, lateralFraction } = classifyContactForce(force);
    if (role === 'held') held++;
    else if (role === 'pushed-aside') pushedAside++;
    else free++;
    if (lateralFraction > peakLateralFraction) peakLateralFraction = lateralFraction;
  }
  return { held, pushedAside, free, peakLateralFraction };
}

/**
 * Every step-scoped value for one report, or all `'\u2014'` when there is no step.
 *
 * One function rather than a populate branch beside a clear branch. The original
 * code had both and they disagreed: the clear branch listed three labels while
 * the populate branch wrote fifteen, so a reset left twelve rows showing a
 * previous scene's energies, contact counts, fold height and W range beside
 * `applied steps: 0`. After a search-mode switch it was worse than stale \u2014 the
 * panel read `static-hierarchy` next to `hierarchy bound tests: n/a \u2014
 * exhaustive`, contradicting itself on screen.
 *
 * Deriving both cases here makes that class of drift unrepresentable, and makes
 * the guarantee testable without a DOM.
 */
export function stepScopedValues(
  report: SheetStepReport | null
): Readonly<Record<string, string>> {
  if (report === null) {
    return Object.freeze(
      Object.fromEntries(STEP_SCOPED_LABELS.map((label) => [label, '—']))
    );
  }
  const contact = roles(report);
  return Object.freeze({
    'status': report.refusalReason === null
      ? report.status
      : `${report.status} · ${report.refusalReason}`,
    'diagnosis': report.condition,
    'minimizer iterations': String(report.acceptedIterations),
    'intrinsic stretch': number(report.intrinsicEnergy),
    'discrete cosine fold': number(report.bendingEnergy),
    'contact barrier': number(report.contactEnergy),
    'total': number(report.totalPotential),
    // One certified closest-point query per sheet vertex, never one per cell:
    // the set-query count equals the vertex count by construction, and the
    // panel states it so a reader can check the claim rather than trust it.
    'hull source vertices': String(report.hullVertexCount),
    'set queries': String(report.setQueries),
    'gjk iterations': String(report.queryIterations),
    'exactly active barriers': String(report.activeBarriers),
    // Interior closest features must push along the support normal; a closest
    // point on the support's boundary legitimately carries a lateral
    // component, so the two are counted apart rather than blended.
    'interior / edge features':
      `${report.interiorBarriers} / ${report.edgeBarriers}`,
    'peak interior lateral': report.interiorBarriers === 0
      ? 'n/a'
      : report.peakInteriorLateralShare.toExponential(1),
    'fold hinges': String(report.hingeCount),
    'stretch elements': String(report.elementCount),
    'min fold height': number(report.minimumConormalHeight, 4),
    'W range': `${number(report.wRange[0], 2)} … ${number(report.wRange[1], 2)}`,
    // Direction, not magnitude. A support pushes along its surface normal; a
    // sum of per-cell barriers generally does not, and the difference is what
    // decides whether the obstacle is holding the sheet or sliding it off.
    'held by contact': String(contact.held),
    'pushed aside': String(contact.pushedAside),
    'no active barrier': String(contact.free),
    'peak lateral share': Number.isFinite(contact.peakLateralFraction)
      ? contact.peakLateralFraction.toFixed(2)
      : '∞'
  });
}

/**
 * The complete refusal note for one refused report.
 *
 * Pure and exported so both refusal flavours are testable without a DOM: a
 * pre-trial filter refusal names the exact term whose domain gate closed (for
 * the fold term, a degenerated triangle), while a minimizer iteration-limit is
 * reported as a compute-budget refusal with every domain gate still open.
 */
export function refusalNoteText(report: SheetStepReport): string {
  const evidence = report.refusalEvidence;
  let cause = '';
  if (evidence !== null && evidence.blockingFilterId !== null) {
    const what = evidence.blockingFilterId.includes('bend')
      ? 'a sheet triangle has degenerated past the fold term\u2019s authored ' +
        'measure floor, so its fold angle is no longer defined'
      : 'the contact term\u2019s admissible domain refused the segment';
    cause =
      ` The blocking term is \u201c${evidence.blockingFilterId}\u201d` +
      `${evidence.filterReason === null ? '' : ` (${evidence.filterReason})`}` +
      (evidence.blockingIndex === null
        ? ''
        : `, cell ${evidence.blockingIndex}`) +
      `: ${what}. ` +
      (evidence.trialsEvaluated === 0
        ? 'No line-search trial ran \u2014 the refusal is a domain gate at the ' +
          'current state, not a failed search.'
        : `${evidence.trialsEvaluated} line-search trial(s) ran before the ` +
          'refusal.');
  } else if (evidence !== null &&
    evidence.minimizationStatus === 'iteration-limit') {
    cause =
      ' The minimizer exhausted its iteration budget without meeting its ' +
      'gradient tolerance \u2014 a compute-budget refusal, with no domain gate ' +
      'closed and every contact distance still legal.';
  }
  return (
    `The solver refused this step (${report.condition}` +
    `${report.refusalReason === null ? '' : ` \u00b7 ${report.refusalReason}`}` +
    ').' + cause +
    ' The sheet is unchanged, so re-solving it would refuse the same way ' +
    '\u2014 playback stopped itself instead of spinning. Step to retry once, ' +
    'or Reset to restart the scene.' +
    (report.diagnosticsSource === 'unchanged-live-state'
      ? ' The energies and populations above describe that unchanged state, ' +
        'not a step that was taken.'
      : '')
  );
}

/**
 * Builds the inspector.
 *
 * @returns The root element to mount, plus an `update` that never rebuilds it.
 */
export function createSheetPanel(): SheetPanel {
  const element = document.createElement('div');
  element.className = 'panel';

  /**
   * Rows keyed by the label {@link stepScopedValues} uses.
   *
   * The update path writes whatever that function returns, so there is no
   * second list to fall out of step with it.
   */
  const stepRows = new Map<string, Row>();
  const stepRow = (label: string): Row => {
    const row = makeRow(element, label);
    stepRows.set(label, row);
    return row;
  };

  element.appendChild(section('step'));
  stepRow('status');
  stepRow('diagnosis');
  const applied = makeRow(element, 'applied steps');
  const simulated = makeRow(element, 'simulated time');
  stepRow('minimizer iterations');
  const showing = makeRow(element, 'showing');

  element.appendChild(section('potential energy'));
  stepRow('intrinsic stretch');
  stepRow('discrete cosine fold');
  stepRow('contact barrier');
  stepRow('total');

  element.appendChild(section('contact queries'));
  stepRow('hull source vertices');
  stepRow('set queries');
  stepRow('gjk iterations');
  stepRow('exactly active barriers');
  stepRow('interior / edge features');
  stepRow('peak interior lateral');

  element.appendChild(section('sheet'));
  const pinned = makeRow(element, 'pinned vertices');
  const obstacleCells = makeRow(element, 'obstacle cells');
  const filters = makeRow(element, 'paired step filters');
  stepRow('fold hinges');
  stepRow('stretch elements');
  stepRow('min fold height');
  stepRow('W range');
  stepRow('held by contact');
  stepRow('pushed aside');
  stepRow('no active barrier');
  stepRow('peak lateral share');

  element.appendChild(section('selection'));
  const cell = makeRow(element, 'source triangle');
  const vertices = makeRow(element, 'source vertices');
  const claim = makeRow(element, 'ambient claim');
  const exact = makeRow(element, 'exact R4 point');
  const ambiguity = makeRow(element, 'ambiguity');
  const lineage = makeRow(element, 'lineage');

  const sentence = document.createElement('p');
  sentence.className = 'panel-sentence';
  sentence.textContent = 'Click either view to select a source triangle.';
  element.appendChild(sentence);

  /**
   * Shown only while the last step was a typed refusal.
   *
   * The solver refusing is a result, not a crash, and the page stops rather
   * than re-solving an unchanged state every frame. Saying so is the difference
   * between a reader seeing a deliberate halt and a reader seeing a freeze.
   */
  const refusal = document.createElement('p');
  refusal.className = 'panel-refusal';
  refusal.hidden = true;
  element.appendChild(refusal);

  const legend = document.createElement('p');
  legend.className = 'panel-legend';
  legend.textContent =
    'Sheet colour encodes the W coordinate only — dark is low W, bright is ' +
    'high W. Green is the static obstacle; amber outlines the selected source ' +
    'triangle. Nothing here encodes stress, strain, or contact force.';
  element.appendChild(legend);

  return {
    element,
    describeScene(facts) {
      pinned.value.textContent = facts.pinnedVertices.join(', ');
      obstacleCells.value.textContent = String(facts.obstacleCells);
      // Naming both makes it visible that neither provider is solved without
      // the filter that certifies its search segment.
      filters.value.textContent = String(facts.stepFilterIds.length);
      filters.value.title = facts.stepFilterIds.join('  •  ');
    },
    update(report, selection, appliedSteps, replay = null) {
      applied.value.textContent = String(appliedSteps);
      // Stated rather than left for a reader to infer from a step count: the
      // scene advances 1/240 s per applied step, so wall time and scene time
      // are not the same quantity and the page should not imply they are.
      simulated.value.textContent =
        `${(appliedSteps * SHEET_TIME_STEP).toFixed(3)} s`;
      // Which step every number below belongs to. A scrubbed frame is a
      // recording, and a panel that looked identical either way would invite a
      // reader to take a replayed number for the state the solver is holding.
      showing.value.textContent = replay === null
        ? 'live state'
        : `step ${replay.frame} of ${replay.recorded}` +
          `${replay.truncated ? ' (recording full)' : ''}`;
      showing.value.title = replay === null
        ? 'The configuration the solver is currently holding.'
        : 'A recorded step. These values were produced when that step was ' +
          'solved, and are replayed, not recomputed.';
      // One assignment path for both cases, so a reset cannot leave a value
      // from the previous scene behind.
      for (const [label, text] of Object.entries(stepScopedValues(report))) {
        const row = stepRows.get(label);
        if (row !== undefined) row.value.textContent = text;
      }
      if (report === null || report.status === 'applied') {
        refusal.hidden = true;
        refusal.textContent = '';
      } else {
        refusal.hidden = false;
        refusal.textContent = refusalNoteText(report);
      }

      if (selection === null) {
        cell.value.textContent = '—';
        vertices.value.textContent = '—';
        claim.value.textContent = '—';
        exact.value.textContent = '—';
        ambiguity.value.textContent = '—';
        lineage.value.textContent = '—';
        sentence.textContent = 'Click either view to select a source triangle.';
      } else {
        cell.value.textContent = selection.sourceCellIndex === null
          ? selection.sourceKind
          : String(selection.sourceCellIndex);
        vertices.value.textContent = selection.sourceVertices.length === 0
          ? '—'
          : selection.sourceVertices.join(', ');
        claim.value.textContent = selection.claim;
        // The plan's fifth display item: say outright whether naming one R4
        // point is justified, rather than leaving it to be inferred.
        exact.value.textContent = selection.exactPointJustified
          ? 'justified'
          : 'not justified';
        ambiguity.value.textContent = selection.ambiguity ?? 'none';
        lineage.value.textContent = selection.lineage.join(' → ') || '—';
        sentence.textContent = selection.sentence;
      }
    }
  };
}
