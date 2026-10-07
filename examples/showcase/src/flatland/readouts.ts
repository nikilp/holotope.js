import { count, cutPhrase, distance, signed } from './copy.js';
import { poseReadout, type Action, type View } from './journey.js';

/**
 * What the page prints beside the picture, as functions of the view, with no DOM: the gauge's layers of corners,
 * the disclosure's rows, and the lists the keyboard picks from. `app.ts` draws what these return.
 *
 * ## Withholding
 *
 * While a question about pile-ups is open (`view.withhold`, chapters III and V until answered), nothing here may
 * count corners per point or per layer, or set the number of the shadow's points beside the number of corners:
 * either would answer the question before the visitor has looked. So the gauge's ticks lose their "×n", the layers
 * row gives heights alone, the shadow row says only whether it is cast, and the shadow's points are not listed (their
 * number is the answer's half). The ticks themselves, the heights, the corners of the cut and of the cube stay: they
 * are the question's context. Everything returns on the reveal, and a chapter entered afresh withholds again.
 * `readouts.test.ts` holds each surface to this, open and answered.
 */

/** One tick on the gauge: a layer of corners, which side of the slice it is on, and how many corners, when that may be said. */
export interface LayerTick {
  readonly height: number;
  readonly side: 'on' | 'plus' | 'minus';
  /** How many corners lie at this height; null when one, or while a pile-up question is open. */
  readonly count: number | null;
}

export function layerTicks(view: View): readonly LayerTick[] {
  return view.layers.map((l) => {
    const d = l.height - view.offset;
    return {
      height: l.height,
      side: Math.abs(d) <= 1e-9 ? 'on' : d > 0 ? 'plus' : 'minus',
      count: view.withhold || l.corners.length < 2 ? null : l.corners.length
    };
  });
}

/** The disclosure's numbers, label and value. */
export function detailRows(view: View): readonly (readonly [string, string])[] {
  const w = view.words;
  const [lo, hi] = view.extent;
  const a = view.accounting;
  return [
    [`${w.slice} at`, signed(view.offset)],
    [`${w.theObject} spans`, `${signed(lo)} … ${signed(hi)}`],
    ['layers of corners', layerTicks(view).map((t) => `${signed(t.height)}${t.count === null ? '' : ` ×${t.count}`}`).join(', ')],
    ['turned', poseReadout(view)],
    ['the cut', view.cut.empty ? 'nothing' : `${cutPhrase(view.rung, view.cut)}; ${count(view.cut.corners.length, 'corner')}`],
    ['the shadow', view.withhold
      ? (view.shadowOn ? 'cast' : 'hidden')
      : `${count(view.shadow.points.length, 'point')} from ${count(view.corners.length, 'corner')}${view.shadowOn ? '' : ' (hidden)'}`],
    ['every edge', distance(view.edge)],
    // The library's own count of the cells it examined, so "nothing is drawn" is never a guess.
    ['cells examined', `${a.sourceCells}: ${a.sectionedCells} cut; ${a.suppressedOnPlaneCells} with no corner strictly ${w.minusSide}; `
      + `${a.cellsBelow} wholly ${w.minusSide}; ${a.collapsedSectionCells} collapsed to a point or a segment`],
    ['crossings found', `${a.crossingsFound}, welded into ${a.weldedVertices} points`]
  ];
}

export interface PickGroup {
  readonly title: 'Corners of the cut' | 'Points of the shadow' | 'Corners of the cube';
  readonly items: readonly { readonly label: string; readonly action: Action }[];
}

/** The keyboard's way to pick: every corner of the cut, every point of the shadow, every corner of the cube. */
export function pickGroups(view: View): readonly PickGroup[] {
  const groups: PickGroup[] = [];
  if (!view.cut.empty) {
    groups.push({ title: 'Corners of the cut', items: view.cut.corners.map((c, index) => ({
      label: c.on.length === 1 ? `At corner ${view.corners[c.on[0]!]!.name}` : `On the edge ${view.corners[c.on[0]!]!.name}–${view.corners[c.on[1]!]!.name}`,
      action: { type: 'inspect', target: { kind: 'cut-corner', index } } as const
    })) });
  }
  // Not while a pile-up question is open: the number of points beside the number of corners is the answer.
  if (view.shadowOn && !view.withhold) {
    groups.push({ title: 'Points of the shadow', items: view.shadow.points.map((p, index) => ({
      label: p.corners.map((i) => view.corners[i]!.name).join(' and '),
      action: { type: 'inspect', target: { kind: 'shadow-point', index } } as const
    })) });
  }
  if (view.rung === 'plane' && view.objectShown) {
    groups.push({ title: 'Corners of the cube', items: view.corners.map((c, index) => ({
      label: c.name, action: { type: 'inspect', target: { kind: 'corner', index } } as const
    })) });
  }
  return groups;
}
