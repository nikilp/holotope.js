import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  WORDS, castReadout, cutPhrase, dimensionsSentence, distance, honestNote, legend, lengthRange, measure, shadowSentence, signed
} from '../../src/flatland/copy.js';
import { ANA_KATA, ANA_KATA_GUIDED, CHAPTERS, PREDICTIONS, createExperience, tipStep, type Action, type View } from '../../src/flatland/journey.js';
import { RUNGS } from '../../src/flatland/world.js';

/**
 * The language rules of `copy.ts`, held over every sentence the journey says
 * in a wide sweep of states: every chapter, every pose, every layer of corners
 * and the steps between, the light on and off, every point picked, every
 * question answered, every passage.
 */

interface Said { readonly where: string; readonly text: string; readonly rung: string; }

function sweep(): Said[] {
  const out: Said[] = [];
  const record = (v: View, where: string): void => {
    const add = (k: string, t: string | null | undefined): void => { if (t) out.push({ where: `${where}:${k}`, text: t, rung: v.rung }); };
    add('setup', v.setup); add('invitation', v.invitation); add('hint', v.hint); add('status', v.status);
    add('event', v.event?.line); add('empty', v.empty?.headline); add('inspection', v.inspection?.text);
    add('reveal', v.prediction?.reveal); add('test', v.prediction?.test?.label);
    for (const w of v.empty?.ways ?? []) add('way', w.label);
    add('dimensions', dimensionsSentence(v.rung, v.dimensions));
    add('cast', castReadout(v.rung, v.shadowOn, v.corners.length, v.shadow.points.map((p) => p.corners.length), v.withhold));
  };
  for (const chapter of CHAPTERS) {
    for (const rung of ['plane', 'space'] as const) {
      const x = createExperience(chapter.id, { instantTurns: true });
      if (chapter.id === 'free') x.dispatch({ type: 'rung', id: rung });
      else if (chapter.rung !== rung) continue;
      const act = (a: Action, tag: string): void => { x.dispatch(a); record(x.view(), `${chapter.id}/${tag}`); };
      record(x.view(), `${chapter.id}/start`);
      for (const pose of ['facet', 'corner', 'edge'] as const) {
        act({ type: 'pose', pose }, pose);
        act({ type: 'slide-to', offset: -x.view().reach }, 'bottom');
        for (let k = 0; k < 50; k++) act({ type: 'slide-step', steps: 1 }, `step${k}`);
        act({ type: 'slide-to', offset: -x.view().reach }, 'bottom');
        for (let k = 0; k < 8; k++) act({ type: 'slide-layer', direction: 1 }, `layer${k}`);
        act({ type: 'slide-to', offset: 0.05 }, 'mid');
        for (let i = 0; i < x.view().cut.corners.length; i++) act({ type: 'inspect', target: { kind: 'cut-corner', index: i } }, `cut${i}`);
        act({ type: 'shadow', on: true }, 'cast');
        for (let i = 0; i < x.view().shadow.points.length; i++) act({ type: 'inspect', target: { kind: 'shadow-point', index: i } }, `point${i}`);
        for (let i = 0; i < x.view().corners.length; i++) act({ type: 'inspect', target: { kind: 'corner', index: i } }, `corner${i}`);
        act({ type: 'show-object', on: false }, 'hide');
        act({ type: 'show-object', on: true }, 'show');
        act({ type: 'shadow', on: false }, 'uncast');
        act({ type: 'look' }, 'look');
      }
      for (let k = 0; k < 9; k++) act({ type: 'tip-step', steps: 1 }, `tip${k}`);
      act({ type: 'play' }, 'play');
      for (let k = 0; k < 300 && x.view().passing; k++) act({ type: 'tick', dt: 1 / 30 }, `tick${k}`);
      act({ type: 'reset' }, 'reset');
      // Every question's own path to its answer.
      // (Whether these steps reach the answer is journey.test.ts's to hold; here they only gather what is said.)
      for (let k = 0; k < 4 && x.view().prediction?.test; k++) act(x.view().prediction!.test!.action, `test${k}`);
    }
  }
  for (const rung of ['plane', 'space'] as const) {
    out.push({ where: `honest/${rung}`, text: honestNote(rung), rung });
    for (const item of legend(rung)) out.push({ where: `legend/${rung}/${item.key}`, text: `${item.name}: ${item.text}`, rung });
    out.push({ where: `shadow/${rung}`, text: shadowSentence(rung, 7, [2]), rung });
  }
  for (const p of Object.values(PREDICTIONS)) {
    out.push({ where: `question/${p.id}`, text: p.question, rung: p.id === 'first-solid' || p.id === 'shadow-corner' ? 'space' : 'plane' });
  }
  return out;
}

const said = sweep();
const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/);

describe('the sweep is wide', () => {
  it('collects thousands of sentences from both rungs and every chapter', () => {
    expect(said.length).toBeGreaterThan(2000);
    for (const c of CHAPTERS) expect(said.some((s) => s.where.startsWith(`${c.id}/`))).toBe(true);
    expect(said.some((s) => s.where.endsWith(':reveal'))).toBe(true);
    expect(said.some((s) => s.where.endsWith(':empty'))).toBe(true);
    expect(said.some((s) => s.text.includes('collapsed'))).toBe(true);
    expect(said.some((s) => s.text.includes('convention'))).toBe(true);
  });
});

describe('typography', () => {
  it('sets every apostrophe as one, never as a straight quote', () => {
    expect(said.filter((s) => /[A-Za-z]'[A-Za-z]/.test(s.text))).toEqual([]);
  });
});

describe('rigid bodies: nothing grows, shrinks or deforms', () => {
  it('never says so', () => {
    const bad = said.filter((s) => /\b(grow|grows|grew|growing|shrink\w*|shrank|stretch\w*|deform\w*|morph\w*|melt\w*|squash\w*)\b/i.test(s.text));
    expect(bad).toEqual([]);
  });
});

describe('ana and kata are the space’s own words, never up and down', () => {
  it('never shares a sentence with a vertical word, unless the sentence says they are not up and down', () => {
    const vertical = /\b(up|down|upward|downward|above|below|top|bottom|higher|lower|highest|lowest|upright|rise|rises|fall|falls)\b/i;
    // The one way a vertical word may stand beside ana or kata: in a sentence that denies they mean it.
    const disclaims = /they are not up and down|ana and kata, not up and down|not a direction in the picture/;
    const bad = said.flatMap((s) => sentences(s.text).filter((t) => /\b(ana|kata)\b/.test(t) && vertical.test(t) && !disclaims.test(t)).map((t) => `${s.where}: ${t}`));
    expect(bad).toEqual([]);
    // And the disclaiming sentences are exactly the two introductions', free exploration's and chapter IV's.
    const disclaiming = new Set(said.flatMap((s) => sentences(s.text).filter((t) => /\b(ana|kata)\b/.test(t) && vertical.test(t))));
    expect(disclaiming.size).toBeGreaterThan(0);
    for (const t of disclaiming) expect([ANA_KATA, ANA_KATA_GUIDED].some((intro) => intro.includes(t)), t).toBe(true);
  });

  it('are introduced before they are used, in chapter IV and in free exploration’s space', () => {
    const setup = createExperience('up').view().setup;
    expect(setup).toContain(ANA_KATA_GUIDED);
    expect(setup.indexOf('are ana and kata')).toBeLessThan(setup.indexOf('ana of it'));
    const free = createExperience('free');
    free.dispatch({ type: 'rung', id: 'space' });
    expect(free.view().setup).toContain(ANA_KATA);
    // Never in the plane rung: there the missing direction is up and down, and is seen.
    expect(said.filter((s) => s.rung === 'plane' && /\b(ana|kata)\b/.test(s.text))).toEqual([]);
  });
});

describe('numbers are measured, and nothing present prints as nothing', () => {
  it('never prints 0.00', () => {
    // A number printed as zero: "0.00" standing alone, not the start of a small length such as "0.0084".
    expect(said.filter((s) => /(^|[^\d.])0\.00(?![\d])/.test(s.text))).toEqual([]);
    expect(said.some((s) => /(^|[^\d.])0\.00\d/.test(s.text))).toBe(true);
  });

  it('formats a tiny distance as a bound, and only zero as zero', () => {
    expect(distance(0)).toBe('0');
    expect(distance(1e-4)).toBe('under 0.005');
    expect(distance(-0.006)).toBe('0.01');
    expect(signed(0)).toBe('0.00');
    expect(signed(-0)).toBe('0.00');
    expect(signed(2e-3)).toBe('+under 0.005');
    expect(signed(-1.7320508)).toBe('−1.73');
  });

  it('keeps sizes out of the event line, which stays up while the numbers move on; a turn’s rigid edge is the one exception', () => {
    const events = said.filter((s) => s.where.endsWith(':event'));
    expect(events.length).toBeGreaterThan(100);
    const bad = events.filter((s) => /\d\.\d/.test(s.text.replace(/every edge is still \d\.\d\d long\./, '')));
    expect(bad).toEqual([]);
  });
});

describe('a shape is named only when it was counted', () => {
  const corners: [RegExp, number][] = [
    [/an? (equilateral )?triangle\b/, 3], [/a (square|rectangle|rhombus|four-sided shape)\b/, 4], [/a pentagon\b/, 5], [/an? (regular )?hexagon\b/, 6],
    [/an? (regular )?tetrahedron with its corners cut off/, 12], [/an? (regular )?tetrahedron\b(?! with)/, 4], [/an? (regular )?octahedron\b/, 6],
    [/a (cube|box)\b/, 8], [/a triangular prism/, 6], [/a hexagonal prism/, 12]
  ];

  it('names in every status line a shape with as many corners as the cut has', () => {
    for (const chapter of CHAPTERS) {
      const x = createExperience(chapter.id, { instantTurns: true });
      for (const angle of [0, 0.3, 0.9553166181245093, Math.PI / 3, 1.2, Math.PI / 2]) {
        x.dispatch({ type: 'tip-to', angle });
        for (let h = -2.4; h <= 2.4; h += 0.1) {
          x.dispatch({ type: 'slide-to', offset: Math.round(h * 10) / 10 });
          const v = x.view();
          if (v.meeting.kind !== 'crossing') continue;
          const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
          const solid = /a solid with (\w+) corners and (\w+) faces/.exec(v.status);
          if (solid) { expect(words.indexOf(solid[1]!)).toBe(v.cut.corners.length); expect(words.indexOf(solid[2]!)).toBe(v.cut.faces.length); continue; }
          const polygon = /a shape with (\w+) corners/.exec(v.status);
          if (polygon) { expect(words.indexOf(polygon[1]!)).toBe(v.cut.corners.length); continue; }
          const match = corners.find(([re]) => re.test(v.status));
          expect(match, v.status).toBeDefined();
          expect(v.cut.corners.length, v.status).toBe(match![1]);
        }
      }
    }
  });
});

describe('no claim the page cannot back', () => {
  it('claims no intuition, and no unique reconstruction', () => {
    expect(said.filter((s) => /\bintuition\b|you (now )?(understand|know|see) (four|the fourth)|\bteach/i.test(s.text))).toEqual([]);
    expect(said.filter((s) => /reconstruct|rebuild|recover|\bunique/i.test(s.text))).toEqual([]);
  });

  it('speaks of an inhabitant only in the observation model that says what it could meet', () => {
    const inhabitant = said.filter((s) => /inhabit|flatlander|creature|living in/i.test(s.text));
    expect(inhabitant.map((s) => s.where)).toEqual(['honest/plane']);
    expect(honestNote('plane')).toContain('it would meet even the cut only edge-on');
  });

  it('names the cut, the shadow and the camera apart in the legend, in both rungs, each for what it is', () => {
    for (const rung of ['plane', 'space'] as const) {
      const [cut, shadow, camera] = legend(rung);
      expect([cut!.name, shadow!.name, camera!.name]).toEqual(['The cut', 'The shadow', 'The camera']);
      expect(cut!.text).toMatch(new RegExp(`^where ${WORDS[rung].theObject} meets ${WORDS[rung].slice}\\.`));
      expect(shadow!.text).toMatch(new RegExp(`^all of ${WORDS[rung].theObject}, dropped straight along ${WORDS[rung].missing}\\.`));
      expect(camera!.text).toMatch(/^only how you look\./);
    }
  });
});

describe('a touch is explained by the reason that applies to it', () => {
  it('blames the tie-break from the far side, and the collapse from the near side', () => {
    for (const rung of ['plane', 'space'] as const) {
      const x = createExperience('free', { instantTurns: true });
      x.dispatch({ type: 'rung', id: rung });
      x.dispatch({ type: 'pose', pose: 'corner' });
      const [lo, hi] = x.view().extent;
      x.dispatch({ type: 'slide-to', offset: lo });
      const far = x.view().status;
      expect(far).toContain('at a single corner');
      expect(far).toContain('leaving it undrawn is the library’s convention');
      expect(far).not.toContain('collapsed');
      x.dispatch({ type: 'slide-to', offset: hi });
      const near = x.view().status;
      expect(near).toContain('the cut is only a single point');
      expect(near).toContain('collapsed');
      expect(near).not.toContain('convention');
      x.dispatch({ type: 'pose', pose: 'facet' });
      x.dispatch({ type: 'slide-to', offset: 1 });
      expect(x.view().status).toContain('and it is drawn');
    }
  });
});

describe('the light’s panel keeps an open question open', () => {
  it('counts the landings only when no question about them is open', () => {
    expect(castReadout('plane', true, 8, [2, 1, 1, 1, 1, 1, 1], true)).not.toMatch(/\b(two|seven|eight)\b/);
    expect(castReadout('plane', true, 8, [2, 1, 1, 1, 1, 1, 1])).toBe('Eight corners land on seven points; one point carries more than one.');
    expect(castReadout('space', false, 16, [])).toBe('The shadow is all of the tesseract, dropped straight along the direction your space lacks.');
  });
});

describe('lengths are said as the established facts allow (C1)', () => {
  it('prints a length, and a range of two, at the fewest decimals that tell them apart and never as zero', () => {
    expect(measure(1.41421356)).toBe('1.41');
    expect(measure(0.0032)).toBe('0.0032');
    expect(measure(0.00012)).toBe('0.00012');
    // The review's key-reachable triangle: sides 0.014 to 0.019, not one "0.01 on each side".
    expect(lengthRange(0.014, 0.0188)).toBe('0.014 to 0.019');
    expect(lengthRange(0.0149, 0.0151)).toBe('0.0149 to 0.0151');
    expect(lengthRange(0.7953, 2.0342)).toBe('0.80 to 2.03');
    expect(lengthRange(1, 1 + 1e-9)).toBeNull();
  });

  it('says "on each side" or "on every edge" only of a cut whose edges are equal, and otherwise brackets them', () => {
    const x = createExperience('free', { instantTurns: true });
    let equal = 0;
    let ranged = 0;
    for (const rung of ['plane', 'space'] as const) {
      x.dispatch({ type: 'rung', id: rung });
      const tips = new Set<number>([0]);
      let t = 0;
      for (let k = 0; k < 20; k++) { t = tipStep(rung, t, 1); tips.add(t); }
      for (const tip of tips) {
        x.dispatch({ type: 'tip-to', angle: tip });
        for (let k = -24; k <= 24; k++) {
          if (Math.abs(k / 10) > RUNGS[rung].reach) continue;
          x.dispatch({ type: 'slide-to', offset: k / 10 });
          const cut = x.view().cut;
          if (cut.empty) continue;
          const phrase = cutPhrase(rung, cut);
          const unrounded = cut.edgeLengths;
          const min = Math.min(...unrounded);
          const max = Math.max(...unrounded);
          if (/on each side|on every edge/.test(phrase)) {
            equal += 1;
            expect(cut.equalEdges, phrase).toBe(true);
            expect(max - min, phrase).toBeLessThanOrEqual(1e-9 * max);
          }
          const range = /its sides ([\d.]+) to ([\d.]+) long/.exec(phrase);
          if (range) {
            ranged += 1;
            const decimals = range[1]!.split('.')[1]!.length;
            expect(Math.abs(Number(range[1]) - min), phrase).toBeLessThanOrEqual(0.5 * 10 ** -decimals + 1e-12);
            expect(Math.abs(Number(range[2]) - max), phrase).toBeLessThanOrEqual(0.5 * 10 ** -decimals + 1e-12);
          }
        }
      }
    }
    expect(equal).toBeGreaterThan(50);
    expect(ranged).toBeGreaterThan(100);
  });
});

describe('the hints name every way to slide, and every view of the missing direction (D-4, A-1)', () => {
  it('names a tap wherever it names the up arrow', () => {
    const keyed = said.filter((s) => s.where.endsWith(':hint') && /↑/.test(s.text));
    expect(keyed.length).toBeGreaterThan(0);
    for (const s of keyed) expect(s.text, s.where).toMatch(/tap or drag the gauge/);
  });

  it('never says the gauge alone shows the missing direction: the dial shows it too', () => {
    expect(said.filter((s) => /only the gauge\b(?! and the dial)|the only view of/.test(s.text))).toEqual([]);
    expect(said.some((s) => /the gauge and dial draw ana at the top/.test(s.text))).toBe(true);
  });

  it('says the same on the atlas card that leads to the page', async () => {
    const atlas = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const at = atlas.indexOf('<a class="card text-only" href="./flatland.html">');
    expect(at).toBeGreaterThan(-1);
    const card = atlas.slice(at, atlas.indexOf('</a>', at));
    expect(card).toContain('One More Direction');
    expect(card).not.toMatch(/only the gauge\b(?! and the dial)/);
    expect(card).toContain('the gauge and the dial are the only views of the missing direction');
  });
});
