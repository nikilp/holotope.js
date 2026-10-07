import { describe, expect, it } from 'vitest';
import { castReadout, legend } from '../../src/flatland/copy.js';
import { createExperience, type Experience, type View } from '../../src/flatland/journey.js';
import { detailRows, layerTicks, pickGroups } from '../../src/flatland/readouts.js';

/**
 * C3: while chapter III's or V's question is open, no surface beside the picture counts the pile-ups, or sets the
 * shadow's number of points beside the number of corners: not the gauge, not the layers row, not the shadow row, not
 * the pick lists, not the legend, not the light's panel. The answer returns on the reveal; a chapter entered afresh,
 * or reset, withholds again; and withholding is presentation only.
 */

/** Everything printed beside the picture that could carry a count, as text. */
function surfaces(v: View): { gauge: string; rows: string; lists: string; legend: string; cast: string } {
  return {
    gauge: layerTicks(v).map((t) => (t.count === null ? '' : `×${t.count}`)).join(' '),
    rows: detailRows(v).map(([k, val]) => `${k}: ${val}`).join('\n'),
    lists: pickGroups(v).map((g) => `${g.title}: ${g.items.map((i) => i.label).join(' | ')}`).join('\n'),
    legend: legend(v.rung, v.withhold).map((l) => l.text).join(' '),
    cast: castReadout(v.rung, v.shadowOn, v.corners.length, v.shadow.points.map((p) => p.corners.length), v.withhold)
  };
}

/** Whether any surface counts corners per point or per layer, or lists the shadow's points. */
function leaks(v: View): string[] {
  const s = surfaces(v);
  const out: string[] = [];
  if (/×\d/.test(s.gauge)) out.push(`gauge: ${s.gauge}`);
  if (/×\d/.test(s.rows)) out.push('layers row counts corners per layer');
  if (/the shadow: .*\b(point|points)\b/.test(s.rows)) out.push('shadow row counts its points');
  if (/Points of the shadow/.test(s.lists)) out.push('the shadow’s points are listed');
  if (/larger dot/.test(s.legend)) out.push('the legend describes a larger dot');
  if (/land on .* point/.test(s.cast)) out.push(`cast: ${s.cast}`);
  return out;
}

/** Follow the offered steps to the answer: a pose, a pointing out, a pick. Bounded, so a step that never arrives fails. */
const answer = (x: Experience): void => {
  for (let k = 0; k < 8 && !x.view().prediction!.revealed; k++) x.dispatch(x.view().prediction!.test!.action);
  expect(x.view().prediction!.revealed).toBe(true);
};

describe('while a pile-up question is open, nothing beside the picture answers it (C3)', () => {
  for (const chapter of ['shadow', 'up-shadow'] as const) {
    it(`${chapter === 'shadow' ? 'III' : 'V'}: withholds on every surface, open, after a wrong pick, and after the place is pointed out`, () => {
      const x = createExperience(chapter, { instantTurns: true });
      expect(x.view().withhold).toBe(true);
      expect(leaks(x.view())).toEqual([]);
      // A pick that does not answer: in III a point only one corner lands on; in V, any point, but in a pose the
      // question is not about. Still open, still withheld.
      const start = x.view().pose!;
      if (chapter === 'up-shadow') x.dispatch({ type: 'pose', pose: 'corner' });
      const wrong = chapter === 'shadow' ? x.view().shadow.points.findIndex((p) => p.corners.length === 1) : 0;
      expect(wrong).toBeGreaterThanOrEqual(0);
      x.dispatch({ type: 'inspect', target: { kind: 'shadow-point', index: wrong } });
      expect(x.view().inspection).not.toBeNull();
      expect(x.view().prediction!.revealed).toBe(false);
      expect(leaks(x.view())).toEqual([]);
      x.dispatch({ type: 'pose', pose: start });
      // Pointed out, not yet shown.
      x.dispatch({ type: 'inspect', target: null });
      x.dispatch(x.view().prediction!.test!.action);
      expect(x.view().attention).not.toBeNull();
      expect(leaks(x.view())).toEqual([]);
      // The context the question needs stays: the ticks, their heights, the cut's corners.
      expect(layerTicks(x.view()).length).toBeGreaterThan(1);
      expect(detailRows(x.view()).find(([k]) => k === 'layers of corners')![1]).toMatch(/[−+]?\d\.\d\d/);
      expect(pickGroups(x.view()).some((g) => g.title === 'Corners of the cut')).toBe(true);
      expect(legend(x.view().rung, true)[1]!.text).toMatch(/Pick a dot to see which corners land on it\./);
    });

    it(`${chapter === 'shadow' ? 'III' : 'V'}: restores every count on the reveal, and withholds again on a fresh entry or a reset`, () => {
      const x = createExperience(chapter, { instantTurns: true });
      answer(x);
      const v = x.view();
      expect(v.withhold).toBe(false);
      const s = surfaces(v);
      expect(s.gauge).toMatch(/×2|×3|×8/);
      expect(s.rows).toMatch(/×\d/);
      expect(s.lists).toMatch(/Points of the shadow/);
      expect(s.legend).toMatch(/A larger dot is a point several corners land on/);
      expect(s.cast).toMatch(/land on/);
      x.dispatch({ type: 'reset' });
      expect(x.view().withhold).toBe(true);
      expect(leaks(x.view())).toEqual([]);
      answer(x);
      x.dispatch({ type: 'chapter', id: chapter === 'shadow' ? 'up-shadow' : 'shadow' });
      expect(x.view().withhold).toBe(true);
      expect(leaks(x.view())).toEqual([]);
    });
  }

  it('counts freely in the chapters that ask nothing about pile-ups', () => {
    for (const chapter of ['through', 'corner', 'up', 'free'] as const) {
      const x = createExperience(chapter, { instantTurns: true });
      x.dispatch({ type: 'shadow', on: true });
      expect(x.view().withhold).toBe(false);
      if (x.view().shadowOn) expect(pickGroups(x.view()).some((g) => g.title === 'Points of the shadow'), chapter).toBe(true);
    }
  });

  it('withholds presentation only: the worlds, the cut and the shadow are the same withheld and answered', () => {
    for (const chapter of ['shadow', 'up-shadow'] as const) {
      const x = createExperience(chapter, { instantTurns: true });
      const w = x.world();
      const before = { source: Array.from(w.source.positions), corners: w.corners().map((c) => [...c.posed]), cut: x.view().cut, shadow: x.view().shadow };
      answer(x);
      x.dispatch({ type: 'inspect', target: null });
      expect({ source: Array.from(w.source.positions), corners: w.corners().map((c) => [...c.posed]), cut: x.view().cut, shadow: x.view().shadow }).toEqual(before);
    }
  });
});
