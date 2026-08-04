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

/** A live inspector bound to one DOM subtree. */
export interface SheetPanel {
  readonly element: HTMLElement;
  /** Rewrites every value in place. */
  update(report: SheetStepReport | null, selection: SheetSelection | null,
    appliedSteps: number, search: string): void;
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
  'possible pairs', 'broadphase retained', 'exactly active barriers',
  'hierarchy bound tests',
  'fold hinges', 'stretch elements', 'min fold height', 'W range'
] as const;

/**
 * Every step-scoped value for one report, or all `'—'` when there is no step.
 *
 * One function rather than a populate branch beside a clear branch. The original
 * code had both and they disagreed: the clear branch listed three labels while
 * the populate branch wrote fifteen, so a reset left twelve rows showing a
 * previous scene's energies, contact counts, fold height and W range beside
 * `applied steps: 0`. After a search-mode switch it was worse than stale — the
 * panel read `static-hierarchy` next to `hierarchy bound tests: n/a —
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
    'possible pairs': String(report.possiblePairs),
    'broadphase retained': String(report.retainedPairs),
    'exactly active barriers': String(report.activeBarriers),
    'hierarchy bound tests': report.hierarchyBoundTests === null
      ? 'n/a — exhaustive'
      : String(report.hierarchyBoundTests),
    'fold hinges': String(report.hingeCount),
    'stretch elements': String(report.elementCount),
    'min fold height': number(report.minimumConormalHeight, 4),
    'W range': `${number(report.wRange[0], 2)} … ${number(report.wRange[1], 2)}`
  });
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
  const search = makeRow(element, 'candidate search');
  stepRow('status');
  stepRow('diagnosis');
  const applied = makeRow(element, 'applied steps');
  const simulated = makeRow(element, 'simulated time');
  stepRow('minimizer iterations');

  element.appendChild(section('potential energy'));
  stepRow('intrinsic stretch');
  stepRow('discrete cosine fold');
  stepRow('contact barrier');
  stepRow('total');

  element.appendChild(section('contact populations'));
  stepRow('possible pairs');
  stepRow('broadphase retained');
  stepRow('exactly active barriers');
  stepRow('hierarchy bound tests');

  element.appendChild(section('sheet'));
  const pinned = makeRow(element, 'pinned vertices');
  const obstacleCells = makeRow(element, 'obstacle cells');
  const filters = makeRow(element, 'paired step filters');
  stepRow('fold hinges');
  stepRow('stretch elements');
  stepRow('min fold height');
  stepRow('W range');

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
    update(report, selection, appliedSteps, searchMode) {
      search.value.textContent = searchMode;
      applied.value.textContent = String(appliedSteps);
      // Stated rather than left for a reader to infer from a step count: the
      // scene advances 1/240 s per applied step, so wall time and scene time
      // are not the same quantity and the page should not imply they are.
      simulated.value.textContent =
        `${(appliedSteps * SHEET_TIME_STEP).toFixed(3)} s`;
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
        refusal.textContent =
          `The solver refused this step (${report.condition}` +
          `${report.refusalReason === null ? '' : ` \u00b7 ${report.refusalReason}`}` +
          '). The sheet is unchanged, so re-solving it would refuse the same ' +
          'way \u2014 playback stopped itself instead of spinning. Step to retry ' +
          'once, or Reset to restart the scene.' +
          (report.diagnosticsSource === 'unchanged-live-state'
            // Say which state the numbers above describe. A refused step
            // applied nothing, so they are the state still on screen rather
            // than an iterate the sheet moved to.
            ? ' The energies and populations above describe that unchanged ' +
              'state, not a step that was taken.'
            : '');
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
