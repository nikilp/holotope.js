import type { SheetStepReport } from './scene.js';
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

/**
 * Builds the inspector.
 *
 * @returns The root element to mount, plus an `update` that never rebuilds it.
 */
export function createSheetPanel(): SheetPanel {
  const element = document.createElement('div');
  element.className = 'panel';

  element.appendChild(section('step'));
  const search = makeRow(element, 'candidate search');
  const status = makeRow(element, 'status');
  const condition = makeRow(element, 'diagnosis');
  const applied = makeRow(element, 'applied steps');
  const iterations = makeRow(element, 'minimizer iterations');

  element.appendChild(section('potential energy'));
  const intrinsic = makeRow(element, 'intrinsic stretch');
  const bending = makeRow(element, 'discrete cosine fold');
  const contact = makeRow(element, 'contact barrier');
  const total = makeRow(element, 'total');

  element.appendChild(section('contact populations'));
  const possible = makeRow(element, 'possible pairs');
  const retained = makeRow(element, 'broadphase retained');
  const active = makeRow(element, 'exactly active barriers');
  const boundTests = makeRow(element, 'hierarchy bound tests');

  element.appendChild(section('sheet'));
  const pinned = makeRow(element, 'pinned vertices');
  const obstacleCells = makeRow(element, 'obstacle cells');
  const filters = makeRow(element, 'paired step filters');
  const hinges = makeRow(element, 'fold hinges');
  const elements = makeRow(element, 'stretch elements');
  const conormal = makeRow(element, 'min fold height');
  const wRange = makeRow(element, 'W range');

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
      if (report === null) {
        status.value.textContent = '—';
        condition.value.textContent = '—';
        iterations.value.textContent = '—';
      } else {
        status.value.textContent = report.refusalReason === null
          ? report.status
          : `${report.status} · ${report.refusalReason}`;
        condition.value.textContent = report.condition;
        iterations.value.textContent = String(report.acceptedIterations);
        intrinsic.value.textContent = number(report.intrinsicEnergy);
        bending.value.textContent = number(report.bendingEnergy);
        contact.value.textContent = number(report.contactEnergy);
        total.value.textContent = number(report.totalPotential);
        possible.value.textContent = String(report.possiblePairs);
        retained.value.textContent = String(report.retainedPairs);
        active.value.textContent = String(report.activeBarriers);
        boundTests.value.textContent = report.hierarchyBoundTests === null
          ? 'n/a — exhaustive'
          : String(report.hierarchyBoundTests);
        hinges.value.textContent = String(report.hingeCount);
        elements.value.textContent = String(report.elementCount);
        conormal.value.textContent = number(report.minimumConormalHeight, 4);
        wRange.value.textContent =
          `${number(report.wRange[0], 2)} … ${number(report.wRange[1], 2)}`;
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
