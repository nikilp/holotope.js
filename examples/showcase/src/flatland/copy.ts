import type { CutSummary, Meeting, RungId } from './world.js';

/**
 * Every sentence One More Direction says about its worlds, as functions of the
 * model's own numbers. Rules, held by `test/flatland/copy.test.ts`:
 *
 * - The cube and the tesseract are rigid. Nothing here says either grows,
 *   shrinks, stretches or deforms; what changes is where the slice meets it.
 * - The cut, the shadow and the camera are named apart, always. The cut is
 *   where the object meets the slice. The shadow is all of the object, dropped
 *   along the missing direction onto the slice. The camera is only how you look.
 * - Up and down are the plane's missing direction, and that direction can be
 *   seen in the picture. Ana and kata are your space's two ways along the
 *   direction it lacks; they are introduced once, as the space's own words, and
 *   are never said to mean up and down.
 * - What the slice meets and what is drawn are said apart, because the
 *   sectioner's tie-break makes them differ on a boundary: a point on the slice
 *   counts as lying on its far side, so a face lying on the slice is drawn from
 *   one side and not the other.
 * - Numbers are measured, never typed, and nothing present prints as 0.00.
 * - A shape is named only when it was counted: corners, sides or faces, and
 *   equal lengths, from the library's own result.
 */

/** A distance for reading: two places, and never "0.00" for something that is not zero. */
export function distance(value: number): string {
  const a = Math.abs(value);
  if (a === 0) return '0';
  if (a < 0.005) return 'under 0.005';
  return a.toFixed(2);
}

/** A signed reading that never prints a signed zero: exactly zero prints "0.00", a tiny value its bound. */
export function signed(value: number): string {
  if (value === 0) return '0.00';
  const sign = value > 0 ? '+' : '−';
  const shown = Math.abs(value).toFixed(2);
  if (Number(shown) === 0) return `${sign}under 0.005`;
  return `${sign}${shown}`;
}

/** The words each rung uses for its object, its slice and its missing direction. */
export interface RungWords {
  readonly object: string;
  readonly theObject: string;
  readonly TheObject: string;
  readonly slice: string;
  readonly Slice: string;
  /** The way the missing axis points, and the other way. */
  readonly plus: string;
  readonly minus: string;
  /** "above the plane" / "ana of your space": a side, said with its subject. */
  readonly plusSide: string;
  readonly minusSide: string;
  readonly missing: string;
  readonly facet: string;
}

export const WORDS: Record<RungId, RungWords> = {
  plane: {
    object: 'cube', theObject: 'the cube', TheObject: 'The cube',
    slice: 'the plane', Slice: 'The plane',
    plus: 'up', minus: 'down',
    plusSide: 'above the plane', minusSide: 'below the plane',
    missing: 'the direction the plane lacks',
    facet: 'face'
  },
  space: {
    object: 'tesseract', theObject: 'the tesseract', TheObject: 'The tesseract',
    slice: 'your space', Slice: 'Your space',
    plus: 'ana', minus: 'kata',
    plusSide: 'ana of your space', minusSide: 'kata of your space',
    missing: 'the direction your space lacks',
    facet: 'cell'
  }
};

export type PoseName = 'facet' | 'corner' | 'edge';

/** The tip's named poses, as the buttons say them. */
export function poseLabel(rung: RungId, pose: PoseName): string {
  if (pose === 'facet') return rung === 'plane' ? 'Face first' : 'Cell first';
  return pose === 'corner' ? 'Corner first' : 'Edge first';
}

/** A pose in a sentence: "face first", "corner first", or "turned 31.0°" between named poses. */
export function poseInSentence(rung: RungId, pose: PoseName | null, degrees: number): string {
  if (pose !== null) return poseLabel(rung, pose).toLowerCase();
  return `turned ${degrees.toFixed(1)}°`;
}

/** The cut, said with its measured size. */
export function cutPhrase(rung: RungId, cut: CutSummary): string {
  if (cut.empty) return 'nothing';
  const lengths = [...new Set(cut.edgeLengths)].sort((a, b) => a - b);
  const one = (n: number): string => n.toFixed(2);
  if (rung === 'plane') {
    if (cut.shape === 'a square') return `a square, ${one(lengths[0]!)} on each side`;
    if (cut.shape === 'a rectangle') return `a rectangle, ${one(lengths[0]!)} by ${one(lengths[lengths.length - 1]!)}`;
    if (cut.shape === 'an equilateral triangle') return `an equilateral triangle, ${one(lengths[0]!)} on each side`;
    if (cut.shape === 'a regular hexagon') return `a regular hexagon, ${one(lengths[0]!)} on each side`;
    if (cut.shape === 'a hexagon') return `a hexagon, its sides ${one(lengths[0]!)} and ${one(lengths[lengths.length - 1]!)} in turn`;
    return cut.shape;
  }
  if (cut.shape === 'a cube') return `a cube, ${one(lengths[0]!)} on every edge`;
  if (cut.shape === 'a regular tetrahedron') return `a regular tetrahedron, ${one(lengths[0]!)} on every edge`;
  if (cut.shape === 'a regular octahedron') return `a regular octahedron, ${one(lengths[0]!)} on every edge`;
  return cut.shape;
}

/** Why the cut has the corners it has: the count rule, from the cut's own provenance. */
export function cornerReason(rung: RungId, cut: CutSummary): string {
  if (cut.empty) return '';
  const words = WORDS[rung];
  const onEdges = cut.corners.filter((c) => c.on.length === 2).length;
  const atCorners = cut.corners.length - onEdges;
  const parts: string[] = [];
  if (onEdges > 0) parts.push(`${count(onEdges, 'edge')} of ${words.theObject} cross${onEdges === 1 ? 'es' : ''} ${words.slice}`);
  if (atCorners > 0) parts.push(`${count(atCorners, 'corner')} of ${words.theObject} lie${atCorners === 1 ? 's' : ''} in ${words.slice}`);
  return `${capitalise(parts.join(', and '))}: one corner of the cut for each.`;
}

export function count(n: number, noun: string): string {
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen'];
  const plural = noun === 'vertex' ? 'vertices' : `${noun}s`;
  return `${words[n] ?? String(n)} ${n === 1 ? noun : plural}`;
}

export function capitalise(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** What the slice meets, in one sentence, honest about the tie-break. */
export function meetingSentence(rung: RungId, meeting: Meeting, cut: CutSummary): string {
  const w = WORDS[rung];
  if (meeting.kind === 'apart') {
    // `side` is where the SLICE is: below the object puts the object above it.
    const where = meeting.side === 'below' ? w.plusSide : w.minusSide;
    return `${w.Slice} meets nothing of ${w.theObject}. ${w.TheObject} is still there: its nearest corner is ${distance(meeting.gap)} ${where}.`;
  }
  if (meeting.kind === 'touching') return touchingSentence(rung, meeting);
  return `${w.Slice} meets ${w.theObject} in ${cutPhrase(rung, cut)}.`;
}

/**
 * A slice that only touches the object: what it shares, whether the library drew it, and why not, from the
 * section's own accounting. Two different reasons leave a touch undrawn, and they are said apart: from the far
 * side, no cell has a corner strictly below the slice, so the tie-break suppresses every cell; from the near side
 * at a corner or an edge, cells do straddle the slice, but every cut collapses to a point or a segment.
 */
function touchingSentence(rung: RungId, meeting: Extract<Meeting, { kind: 'touching' }>): string {
  const w = WORDS[rung];
  const what = meeting.feature === 'corner' ? 'at a single corner'
    : meeting.feature === 'edge' ? 'along one edge'
      : meeting.feature === 'face' ? (rung === 'plane' ? 'along a whole face, a square' : 'along a whole square face')
        : 'along a whole cell, a cube';
  if (meeting.drawn) {
    return `${w.Slice} touches ${w.theObject} ${what}, and it is drawn: the rest of ${w.theObject} lies ${w.minusSide}, where the library cuts it.`;
  }
  if (meeting.undrawn === 'collapsed') {
    const thin = meeting.feature === 'corner' ? 'a single point' : 'a line segment';
    return `${w.Slice} touches ${w.theObject} ${what}. Nothing is drawn: there the cut is only ${thin}, and the library leaves out a cut `
      + 'that has collapsed to a point or a segment. The meeting is real.';
  }
  return `${w.Slice} touches ${w.theObject} ${what}. Nothing is drawn: the library cuts only where a corner lies strictly ${w.minusSide}, `
    + `and counts a corner in ${w.slice} as ${w.plusSide.replace(/ (the plane|your space)$/, '')} it. The meeting is real; leaving it undrawn is the library’s convention.`;
}

/** What made a change, said with its subject. */
export type Cause = 'slide' | 'turn' | 'pass' | 'chapter' | 'reset' | 'rung';

export function causePhrase(rung: RungId, cause: Cause): string {
  const w = WORDS[rung];
  switch (cause) {
    case 'slide': return `you slid ${w.slice}`;
    case 'pass': return `${w.slice} is passing through`;
    case 'turn': return `you turned ${w.theObject}`;
    default: return '';
  }
}

/**
 * The event line after a change: what the slice now meets, and what did it.
 * A turn also says what did not change, because a new cut is not a new object.
 */
export function eventLine(rung: RungId, before: { readonly meeting: Meeting; readonly cut: CutSummary }, after: { readonly meeting: Meeting; readonly cut: CutSummary }, cause: Cause, edge: number): string {
  const w = WORDS[rung];
  const why = causePhrase(rung, cause);
  const tail = why ? ` — ${why}.` : '.';
  const rigid = cause === 'turn' ? ` ${w.TheObject} is the same ${w.object}: every edge is still ${edge.toFixed(2)} long.` : '';
  // A line stays on screen until the next change it names, so it quotes no size that could move on under it:
  // the counted shape and the side only. The readout beside it carries the live numbers.
  if (after.meeting.kind === 'apart') {
    // `side` is where the SLICE is: below the object puts the object above it.
    const side = after.meeting.side === 'below' ? w.plusSide : w.minusSide;
    if (before.meeting.kind === 'apart') return `${w.Slice} still meets nothing of ${w.theObject}${tail} ${w.TheObject} lies ${side}.${rigid}`;
    return `${w.Slice} has left ${w.theObject}: nothing is cut${tail} ${w.TheObject} is still there, ${side}.${rigid}`;
  }
  if (after.meeting.kind === 'touching') return `${meetingSentence(rung, after.meeting, after.cut).replace(/\.$/, '')}${tail}${rigid}`;
  const now = after.cut.shape;
  if (before.meeting.kind !== 'crossing') return `${w.Slice} now meets ${w.theObject}: ${now}${tail}${rigid}`;
  return `The cut is now ${now}${tail}${rigid}`;
}

/** The shadow, in one sentence: all of the object, dropped along the missing direction, and its pile-ups. */
export function shadowSentence(rung: RungId, points: number, piled: readonly number[]): string {
  const w = WORDS[rung];
  const corners = rung === 'plane' ? 8 : 16;
  const pile = piled.length === 0 ? 'Every corner lands on a point of its own.'
    : piled.length === 1 ? `${capitalise(count(piled[0]!, 'corner'))} land on one point of it: overlap, not identity.`
      : `${capitalise(count(piled.length, 'point'))} of it each carry ${piled.every((p) => p === piled[0]) ? `${count(piled[0]!, 'corner')}` : 'several corners'}: overlap, not identity.`;
  return `The shadow is all of ${w.theObject}, dropped straight along ${w.missing}: its ${corners} corners land on ${points} points. ${pile}`;
}

/** A corner, said with where it is. */
export function cornerSentence(rung: RungId, name: string, height: number): string {
  const w = WORDS[rung];
  if (height === 0 || Math.abs(height) < 1e-9) return `Corner ${name} lies in ${w.slice}.`;
  return `Corner ${name} is ${distance(height)} ${height > 0 ? w.plusSide : w.minusSide}.`;
}

/** The dimensions on show, said apart: the world's, the slice's, the object's, the cut's, the shadow's, and the screen's. */
export function dimensionsSentence(rung: RungId, d: { readonly world: number; readonly slice: number; readonly object: number; readonly cut: number | null; readonly shadow: number }): string {
  const w = WORDS[rung];
  const cut = d.cut === null ? 'nothing is cut just now' : `the cut is ${d.cut}-dimensional, ${d.cut === 2 ? 'a flat shape' : 'a solid'}`;
  return `The world has ${d.world} directions and ${w.slice} has ${d.slice}. ${w.TheObject} is ${d.object}-dimensional; ${cut}; `
    + `the shadow is ${d.shadow}-dimensional. Your screen is flat: it shows ${rung === 'plane' ? 'all of this' : 'your space'} in perspective, `
    + 'so a length on screen is not a length in the world.';
}

/** The legend: the cut, the shadow and the camera, named apart, each with what it is. */
export function legend(rung: RungId): readonly { readonly key: 'cut' | 'shadow' | 'camera'; readonly name: string; readonly text: string }[] {
  const w = WORDS[rung];
  return [
    { key: 'cut', name: 'The cut', text: `where ${w.theObject} meets ${w.slice}. ${rung === 'plane'
      ? 'Each side takes the colour of the cube’s face it lies in; the bright edges of the cube are the ones the plane crosses, one for each corner of the cut.'
      : 'Each face takes the colour of the tesseract’s cell it lies in: x red, y green, z blue, w gold, darker on the − side.'}` },
    { key: 'shadow', name: 'The shadow', text: `all of ${w.theObject}, dropped straight along ${w.missing}. A larger dot is a point several corners land on.` },
    { key: 'camera', name: 'The camera', text: 'only how you look. Dragging the picture moves it, and nothing else.' }
  ];
}

/**
 * What the picture is, and what it is not: the observation model behind the analogy, and why no single view
 * gives the object back.
 */
export function honestNote(rung: RungId): string {
  return rung === 'plane'
    ? 'The plane holds only the cut and the shadow. This picture shows the cube from outside the plane, which nothing living in the plane could do: '
      + 'it would meet even the cut only edge-on. A cut keeps one slice and a shadow piles corners together, so neither alone tells you the whole cube.'
    : 'Your space holds only the cut and the shadow. The tesseract itself is never drawn: there is nowhere outside your space to see it from. '
      + 'A cut keeps one slice and a shadow piles corners together, so neither alone tells you the whole tesseract; turning and sliding is how you learn more of it.';
}

/**
 * The light's panel: what the shadow is when hidden, and how the corners land when cast; while a question about
 * the pile-ups is open (`withhold`), only how to find out.
 */
export function castReadout(rung: RungId, on: boolean, corners: number, landings: readonly number[], withhold = false): string {
  const w = WORDS[rung];
  if (!on) return `The shadow is all of ${w.theObject}, dropped straight along ${w.missing}.`;
  if (withhold) return `The shadow is all of ${w.theObject}, dropped straight along ${w.missing}. Pick a point of it to see what lands there.`;
  const piles = landings.filter((n) => n > 1).length;
  return `${capitalise(count(corners, 'corner'))} land on ${count(landings.length, 'point')}; `
    + `${piles === 0 ? 'none share one' : `${count(piles, 'point')} ${piles === 1 ? 'carries' : 'carry'} more than one`}.`;
}
