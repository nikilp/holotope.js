import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { BUTTONS, LAYER_SNAP_PX, POSE_SNAP_DEG, chapterAction, dialAngle, gaugeValue, keyAction, sliderKey } from '../../src/flatland/bindings.js';
import { ACTION_KINDS, CHAPTERS, createExperience, type Action } from '../../src/flatland/journey.js';
import { RUNGS, type Layer } from '../../src/flatland/world.js';

/**
 * The controls the page attaches, run here as the page runs them. The markup
 * census holds `flatland.html` to the ids the page reads, and each control to
 * the kind of thing it may touch.
 */

const html = await readFile(new URL('../../flatland.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../../src/flatland/app.ts', import.meta.url), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
const context = { passing: false, shadowOn: false, objectShown: true };

describe('the markup census', () => {
  it('has every element the page reads, each once', () => {
    const read = new Set([...app.matchAll(/\$(?:<[^>]+>)?\('([a-z-]+)'\)/g)].map((m) => m[1]!));
    // The pose buttons are read by name, one per named pose.
    for (const pose of ['facet', 'corner', 'edge']) read.add(`om-pose-${pose}`);
    for (const id of read) expect(ids.has(id), id).toBe(true);
    const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
    expect(all.length).toBe(new Set(all).size);
  });

  it('has a button for every binding, and a binding for every button', () => {
    const buttons = [...html.matchAll(/<button[^>]*\sid="([^"]+)"/g)].map((m) => m[1]!);
    const bound = new Set([...BUTTONS.map((b) => b.id), 'om-test']);
    expect(buttons.filter((b) => !bound.has(b))).toEqual([]);
    for (const b of BUTTONS) expect(buttons).toContain(b.id);
  });

  it('starts the page where its markup says, and loads it from the module the build bundles', () => {
    expect(html).toContain('data-start="through"');
    expect(html).toContain("import { createApp } from './src/flatland/app.ts';");
    expect(html).toMatch(/<title>Holotope\.js — One More Direction<\/title>/);
  });
});

describe('what each control may touch', () => {
  it('sends only actions of its kind', () => {
    const allowed: Record<string, readonly string[]> = {
      world: ['world', 'clock'], shadow: ['shadow'], view: ['view'], chapter: ['chapter'], camera: []
    };
    for (const b of BUTTONS) {
      for (const c of [context, { passing: true, shadowOn: true, objectShown: false }]) {
        const a = b.act(c);
        if (b.kind === 'camera') { expect(a).toBeNull(); continue; }
        expect(a).not.toBeNull();
        expect(allowed[b.kind], `${b.id} → ${a!.type}`).toContain(ACTION_KINDS[a!.type]);
      }
    }
  });

  it('toggles what it shows, from what is shown now', () => {
    const by = (id: string) => BUTTONS.find((b) => b.id === id)!;
    expect(by('om-pass').act(context)).toEqual({ type: 'play' });
    expect(by('om-pass').act({ ...context, passing: true })).toEqual({ type: 'stop' });
    expect(by('om-shadow').act(context)).toEqual({ type: 'shadow', on: true });
    expect(by('om-hide').act(context)).toEqual({ type: 'show-object', on: false });
    expect(by('om-hide').act({ ...context, objectShown: false })).toEqual({ type: 'show-object', on: true });
  });

  it('gives every chapter a button action that enters it', () => {
    for (const c of CHAPTERS) expect(chapterAction(c.id)).toEqual({ type: 'chapter', id: c.id });
  });
});

describe('the gauge lands on the heights where the cut changes', () => {
  const layers: Layer[] = [{ height: -Math.sqrt(3), corners: [0] }, { height: -1 / Math.sqrt(3), corners: [1, 2, 4] }];
  const H = 420;
  const R = 2.1;
  const at = (value: number): number => (R - value) / (2 * R);

  it('snaps to a layer within its reach, exactly', () => {
    const px = (2 * R) / H;
    expect(gaugeValue(at(-1 / Math.sqrt(3) + 3 * px), R, H, layers)).toBe(-1 / Math.sqrt(3));
    expect(gaugeValue(at(-Math.sqrt(3) - (LAYER_SNAP_PX - 1) * px), R, H, layers)).toBe(-Math.sqrt(3));
    expect(gaugeValue(at(4 * px), R, H, layers)).toBe(0);
  });

  it('leaves a value beyond that reach where the pointer put it, and stays within the reach', () => {
    const px = (2 * R) / H;
    expect(gaugeValue(at(-1.15), R, H, layers)).toBeCloseTo(-1.15, 12);
    expect(gaugeValue(at(-1 / Math.sqrt(3) + (LAYER_SNAP_PX + 2) * px), R, H, layers)).toBeCloseTo(-1 / Math.sqrt(3) + (LAYER_SNAP_PX + 2) * px, 12);
    expect(gaugeValue(-1, R, H, layers)).toBe(R);
    expect(gaugeValue(2, R, H, layers)).toBe(-R);
  });

  it('reaches the octahedron’s exact middle by a drag near it', () => {
    const x = createExperience('free', { instantTurns: true });
    x.dispatch({ type: 'rung', id: 'space' });
    x.dispatch({ type: 'pose', pose: 'corner' });
    const v = x.view();
    x.dispatch({ type: 'slide-to', offset: gaugeValue(at(0.012), v.reach, H, v.layers) });
    expect(x.view().cut.shape).toBe('a regular octahedron');
  });
});

describe('the dial lands on the named poses', () => {
  it('reads the angle of the pointer about its pivot, within a quarter turn', () => {
    expect(dialAngle('plane', 10, 10)).toBeCloseTo(Math.PI / 4, 12);
    expect(dialAngle('plane', -5, 10)).toBe(Math.PI / 2);
    expect(dialAngle('plane', 10, -5)).toBe(0);
  });

  it('snaps to a named pose within its reach, exactly', () => {
    for (const rung of ['plane', 'space'] as const) {
      for (const stop of Object.values(RUNGS[rung].stops)) {
        const near = stop + ((POSE_SNAP_DEG - 0.5) * Math.PI) / 180 * (stop > 1 ? -1 : 1);
        expect(dialAngle(rung, Math.cos(near), Math.sin(near))).toBe(stop);
      }
    }
  });
});

describe('keys', () => {
  it('slide, step to layers, and turn on the instruments', () => {
    expect(sliderKey('gauge', 'ArrowUp', false)).toEqual({ type: 'slide-step', steps: 1 });
    expect(sliderKey('gauge', 'ArrowDown', true)).toEqual({ type: 'slide-step', steps: -10 });
    expect(sliderKey('gauge', 'PageUp', false)).toEqual({ type: 'slide-layer', direction: 1 });
    expect(sliderKey('gauge', 'Home', false)).toEqual({ type: 'slide-to', offset: 0 });
    expect(sliderKey('dial', 'ArrowRight', false)).toEqual({ type: 'tip-step', steps: 1 });
    expect(sliderKey('dial', 'End', false)).toEqual({ type: 'pose', pose: 'edge' });
    expect(sliderKey('gauge', 'x', false)).toBeNull();
  });

  it('move the camera with the camera keys, and never send the model an action for them', () => {
    for (const k of ['q', 'E', '+', '-', 'c']) expect(typeof keyAction(k, false, context)).toBe('string');
  });

  it('send each other key to the hand it names', () => {
    const hands: [string, Action['type']][] = [
      ['ArrowUp', 'slide-step'], ['PageDown', 'slide-layer'], ['ArrowLeft', 'tip-step'], [' ', 'play'],
      ['s', 'shadow'], ['h', 'show-object'], ['r', 'reset'], ['Escape', 'inspect']
    ];
    for (const [key, type] of hands) expect((keyAction(key, false, context) as Action).type).toBe(type);
    expect(keyAction(' ', false, { ...context, passing: true })).toEqual({ type: 'stop' });
    expect(keyAction('z', false, context)).toBeNull();
  });
});
