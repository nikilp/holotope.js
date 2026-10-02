import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every control in the page has a listener in the wiring.
 *
 * This is a source-level check, and it is here for one reason: twice, a range
 * replacement elsewhere in main.ts swallowed the block of listeners, leaving
 * sliders that moved and did nothing — and the model/controller tests, which
 * never touch the DOM, stayed green. There is no DOM environment in this
 * repository, so the shipped wiring cannot be exercised by test; the next best
 * thing is to refuse to let a control exist in the markup without a handler in
 * the code.
 *
 * What it proves, exactly: that the listener TEXT is present in the executable
 * source. Not that it runs, and not that the handler is right — the in-browser
 * checks with genuine input would be. Comments are stripped
 * first, because the previous version accepted a listener that survived only
 * inside a comment (found in review).
 */

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', '..', 'spatial-4d-turn-classic.html'), 'utf8');
const main = readFileSync(join(here, '..', '..', 'src', 'spatial-4d-turn', 'main.ts'), 'utf8');

/**
 * Source without comments: block comments first, then line comments. main.ts
 * has no `//` inside a string literal, which this simple strip would remove
 * too; if one is ever added, this helper must learn to skip strings.
 */
export const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Whitespace-insensitive, so a listener that spans a line break still counts. */
const flat = (source: string): string => source.replace(/\s+/g, '');

const code = flat(stripComments(main));

/** id → the identifier main.ts binds it to, and the event it must listen for. */
const CONTROLS: Record<string, { bound: string; event: string }> = {
  turn: { bound: 'turn', event: 'input' },
  offset: { bound: 'offset', event: 'input' },
  phase: { bound: 'phase', event: 'input' },
  play: { bound: 'playButton', event: 'click' },
  context: { bound: 'contextToggle', event: 'change' },
  'reset-section': { bound: "panel.querySelector<HTMLButtonElement>('#reset-section')!", event: 'click' },
  'reset-view': { bound: "panel.querySelector<HTMLButtonElement>('#reset-view')!", event: 'click' }
};

describe('every control in the markup has a listener in the wiring', () => {
  it('lists every interactive control the page has', () => {
    const ids = [...html.matchAll(/<(?:input|button)[^>]*\bid="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.sort()).toEqual(Object.keys(CONTROLS).sort());
  });

  for (const [id, { bound, event }] of Object.entries(CONTROLS)) {
    it(`#${id} is bound and listens for ${event}`, () => {
      expect(code, `#${id} is selected`).toContain(flat(`'#${id}'`));
      const needle = flat(`${bound}.addEventListener('${event}'`);
      expect(code.includes(needle), `#${id} has a ${event} listener on ${bound}`).toBe(true);
    });
  }
});

describe('the matcher itself', () => {
  const needle = flat("offset.addEventListener('input'");

  it('accepts the live listener', () => {
    expect(code.includes(needle)).toBe(true);
  });

  it('rejects the same listener inside a line comment', () => {
    expect(flat(stripComments("  // offset.addEventListener('input', () => {});")).includes(needle)).toBe(false);
  });

  it('rejects it inside a block comment', () => {
    expect(flat(stripComments("/* offset.addEventListener('input', () => {}); */")).includes(needle)).toBe(false);
  });

  it('keeps code that follows a comment', () => {
    expect(flat(stripComments("// note\noffset.addEventListener('input', x);")).includes(needle)).toBe(true);
  });
});

describe('stopping is one function, shared by the Play button and the probe', () => {
  // Found in review: the button toggled `playing` without refreshing, so the
  // knife's marks stayed where the last throttled rescan left them, while the
  // probe's pause refreshed — a test of the probe was not a test of the button.
  it('defines pause once, and pause refreshes', () => {
    expect(code.match(/constpause=/g)?.length).toBe(1);
    expect(code).toContain('constpause=():void=>{setPlaying(false);update();}');
  });

  it('the Play button stops through pause(), never through setPlaying alone', () => {
    expect(code).toContain(
      flat("playButton.addEventListener('click', () => { if (playing) pause(); else setPlaying(true); })")
    );
  });

  it('the probe exposes that same function', () => {
    expect(code).toContain('play:()=>setPlaying(true),pause,');
  });
});

describe('the pivot note is the tested function, not a copy of its sentence', () => {
  // Found in review: the page carried its own sentence with a fixed "(negative:
  // behind it)" and named the wrong side on half the slider. The page now calls
  // observerNote(), which turn.test.ts holds at both signs; this pin keeps the
  // page on that function.
  it('main.ts writes the note from observerNote and carries no side annotation of its own', () => {
    expect(code).toContain('constnote=observerNote(fromPivot);');
    expect(code).toContain('pivotNote.textContent=note.sentence;');
    expect(stripComments(main)).not.toMatch(/behind it/);
  });
});

describe('the projection context is presentation only, and stays out of the picker', () => {
  // Source pins, labelled as such: the toggle's handler may set the layer's
  // visibility, the checkbox and the note, and nothing else; the layer hangs
  // off the viewport, never off a product; the picker still raycasts only the
  // products' visible meshes. context.test.ts holds the behaviour.
  it('the toggle only calls setContext, and setContext touches visibility, checkbox and note', () => {
    expect(code).toContain("contextToggle.addEventListener('change',()=>{setContext(contextToggle.checked);});");
    expect(code).toContain('constsetContext=(on:boolean):void=>{context.setVisible(on);contextToggle.checked=on;'
      + 'contextNote.hidden=!on;contextNote.textContent=context.describe();};');
  });

  it('the layer is added to the viewport as its own root, and the picker walks products only', () => {
    expect(code).toContain('viewport.add(context.object);');
    expect(code).not.toMatch(/\.object\.add\(context/);
    expect(code).toContain('constvisible=products.flatMap((p)=>visibleMeshes(p.object));');
  });
});

describe('the marks are scanned at the exact phase', () => {
  // A negative source pin: the defect was `Math.round(deg(state.phase))` feeding
  // the scans. The model-level case is in events.test.ts; this refuses the
  // rounding's return in the page code, which no headless test can run.
  it('main.ts never rounds the phase before scanning', () => {
    expect(code).not.toMatch(/Math\.round\(deg\(state\.phase\)\)/);
    expect(code).toContain('constphaseDeg=deg(state.phase);');
  });
});
