import { GRAZE_EPSILON } from '../spatial-4d-turn/section.js';

/**
 * Every sentence the experience says about the world, as functions of the
 * model's own numbers. Rules, held by `copy.test.ts`:
 *
 * - The bodies are rigid. Nothing here says a body grows, shrinks, deforms or
 *   changes shape; what changes is where the slice cuts it.
 * - Slice and shadow are always named apart: the slice is the exact solid
 *   where your 3D view crosses the body, the shadow is all of the body
 *   flattened onto your view.
 * - Ana and kata are defined once, against your slice: ana is the side its
 *   normal points to, kata the other. They never mean up and down in space.
 *   When the slice is untilted its normal is +w, Hinton's ana.
 * - Touching is the library's word, with its tolerance: the slice meets the
 *   body only along its boundary, within 10⁻⁹, and the renderer draws solids
 *   only, so nothing appears.
 * - Nothing present prints as 0.00: a small distance prints as its bound.
 * - Prescribed motion is called prescribed; physics is called physics.
 */

/** A distance for reading: two places, and never "0.00" for something that is not zero. */
export function distance(value: number): string {
  const a = Math.abs(value);
  if (a === 0) return '0';
  if (a < 0.005) return 'under 0.005';
  return a.toFixed(2);
}

/**
 * A signed reading at a fixed number of places that never prints a signed zero:
 * exactly zero prints "0", and a non-zero value that would round to zero prints
 * its bound ("+under 0.005"). Used for the slice's offset and the numbers panel.
 */
export function signedReading(value: number, places: number): string {
  if (value === 0) return (0).toFixed(places);
  const sign = value > 0 ? '+' : '−';
  const shown = Math.abs(value).toFixed(places);
  if (Number(shown) === 0) return `${sign}under ${(0.5 * 10 ** -places).toFixed(places + 1)}`;
  return `${sign}${shown}`;
}

/** Which side of your slice a signed gap lies on. */
export function side(gap: number): 'ana' | 'kata' {
  return gap > 0 ? 'ana' : 'kata';
}

/**
 * A body's one-line caption: where it is relative to your slice. Four cases,
 * never merged: in the slice and drawn; in the slice but drawn as nothing (a
 * renderer omission — the library's membership and the picture disagree, and
 * the caption says so rather than calling the body absent); touching only
 * along its boundary; and outside, with how far and to which side.
 */
export function caption(name: string, status: 'present' | 'tangent' | 'outside', gap: number, drawn: number): string {
  if (status === 'present' && drawn > 0) return `${name} — in your slice`;
  if (status === 'present') return `${name} — in your slice, but the renderer drew nothing for it`;
  if (status === 'tangent') return `${name} — touching your slice, only along its boundary`;
  return `${name} — not in your slice: ${distance(gap)} ${side(gap)} of it`;
}

/** Why a body shows nothing in the picture, one sentence each, from the model. */
export function absentReason(
  name: string, status: 'present' | 'tangent' | 'outside', gap: number, frame: 'in' | 'partial' | 'out' | null,
  reachable: boolean, drawn: number
): string {
  if (status === 'tangent') {
    return `${name} touches your slice only along its boundary (within 10⁻⁹). The cut there is a face, an edge or `
      + 'a point, not a solid, and the renderer draws solids only — so no cut is drawn, though nothing is missing.';
  }
  if (status === 'outside') {
    return `${name} is not in your slice. All of it lies ${distance(gap)} ${side(gap)} of your slice — still there, `
      + 'just elsewhere along the direction your slice cannot show.'
      + (reachable ? '' : ' Your slice cannot slide that far along this normal.');
  }
  if (drawn === 0) {
    return `${name} is in your slice, by the library’s test, but the renderer was handed nothing to draw for it `
      + '— an omission in the picture, not an absence in the world.';
  }
  if (frame === 'out') return `${name} is in your slice, but outside the camera’s view.`;
  return `${name} is in your slice.`;
}

/**
 * What a small marker or a hollow ball in the picture means, so that neither is
 * read as a cut. The markers and the hollow drawing are the section modules'
 * display conventions; this says which one is on screen.
 */
export function drawingNote(marker: 'touch' | 'nearest' | null, hollow: boolean): string {
  if (marker === 'touch') return 'The small marker is the point where it touches.';
  if (marker === 'nearest') return 'The small marker is where your slice would first touch it — not a cut.';
  if (hollow) return `It is cut within ${GRAZE_EPSILON} of its edge, so it is drawn hollow; the cut is still a solid ball.`;
  return '';
}

/** The empty view's headline: true whether or not a marker is on screen. */
export const EMPTY_HEADLINE = 'Your slice cuts nothing in view — and nothing has gone.';

/** The short line that defines the gauge, once. */
export const GAUGE_LEGEND = 'Each bar is a body’s extent across your slice; the line is your slice. '
  + 'Ana is the side your slice’s normal points to, kata the other.';

/** What the hidden-plane map is, said once — and named apart from the shadow. */
export const PLANE_LEGEND = 'The hidden plane: the x–w plane, seen from outside. Every body is flattened onto it along y and z — '
  + 'its footprint, not its shadow. Your slice crosses this plane as the bright line, and whatever the line crosses, '
  + 'your slice cuts: the bright chord is that cut, flattened.';

/** The map's one-line caption. */
export function planeNote(studyOpen: boolean): string {
  return studyOpen
    ? 'x across, w up. Here your slice is fixed at w = 0; only the box turns.'
    : 'x across, w up. Footprints, not shadows. The shaded side is ana.';
}

/** What the shadow is and is not. */
export const SHADOW_LEGEND = 'Lines: each body’s shadow — all of it, flattened onto your view along the slice’s normal. '
  + 'Solid: your slice of it — exactly the part your view crosses. Overlapping shadows are not contact.';

/** The observer line: where the slice sits relative to the centre point it turns about. */
export function pivotLine(signedDistance: number): string {
  if (Math.abs(signedDistance) < 1e-12) return 'Your slice passes through the centre point, so turning pivots about it.';
  return `Your slice is ${distance(signedDistance)} from the centre point, so turning now sweeps rather than pivots.`;
}

/** A notable change in the picture, said as what the model did. */
export function eventLine(kind: 'appeared' | 'vanished' | 'touching' | 'struck', name: string, gap: number, cause: 'orbit' | 'physics' | 'slice'): string {
  const mover = cause === 'slice' ? 'your slice moved' : cause === 'orbit' ? 'it moved along its prescribed orbit' : 'it moved';
  switch (kind) {
    case 'appeared': return `${name} appeared — ${mover}, and now your slice cuts it.`;
    case 'vanished': return `${name} vanished from your slice — ${mover}, out to the ${side(gap)} side. It has not gone.`;
    case 'touching': return `${name} is touching your slice — only along its boundary, so nothing solid is drawn.`;
    case 'struck': return `${name} was struck.`;
  }
}

/** The blow, said with where the cause was at that step — the line stays on screen while the clock runs on. */
export function strikeLine(ballGap: number): string {
  if (ballGap === 0) return 'The box was struck — by the ball, then in your slice.';
  return `The box was struck by something your slice cannot show: the ball, then ${distance(ballGap)} ${side(ballGap)} of your slice.`;
}

/** The three clocks, named for what drives them. The physics step is read from the simulation's settings. */
export function clockName(kind: 'orbit' | 'physics' | 'study', dt: number, substeps: number): string {
  if (kind === 'orbit') return 'Prescribed orbit — no physics';
  if (kind === 'study') return 'Prescribed turn — not a physics simulation';
  return `Physics clock — fixed steps of 1/${Math.round(1 / dt)} s, ${substeps} substeps each`;
}

/**
 * What the visitor has done in this chapter. 'found' is an appearance their own slice move caused,
 * never one the orbit or the clock caused.
 */
type Seen = ReadonlySet<'played' | 'appeared' | 'found' | 'vanished' | 'struck' | 'turned' | 'slid' | 'shadow' | 'frozen' | 'studied' | 'compared' | 'faced'>;

/** What the model shows now, as far as a hint may depend on it. */
interface HintModel {
  /** The ball (either world's) is drawn in the slice. */
  readonly ballInSlice: boolean;
  /** The clock of the world in front is running. */
  readonly playing: boolean;
  /** The ball's prescribed orbit meets the turning world's slice at some phase. */
  readonly orbitMeets: boolean;
  /** Where the ball was at this launch's blow — in the slice or beyond it — or null before the blow. */
  readonly strike: 'seen' | 'hidden' | null;
  /** The view is empty and only a replay of the clock can bring a body back into reach. */
  readonly outOfReach: boolean;
  /** The separate turning scene is in front, where your slice is fixed. */
  readonly studyOpen: boolean;
}

/**
 * The next thing to try, from what has happened and what the model shows now.
 * Never on a timer; every hint stays true however the chapter was reached.
 */
export function hint(chapter: string, seen: Seen, now: HintModel): string {
  switch (chapter) {
    case 'arrival':
      if (!seen.has('played')) return 'Press play. The ball follows a prescribed orbit that takes it through the fourth direction.';
      if (seen.has('found') && now.ballInSlice) return 'Found it: your slice moved to the ball. The ball moves only along its prescribed orbit; your slice moves only when you move it.';
      if (seen.has('vanished') && !now.ballInSlice) return 'It vanished — it has not gone. Pause, then follow it: drag your bright line on the map toward its footprint, or press ↑ or ↓.';
      if (now.ballInSlice) return 'There it is, in your slice. It is the same rigid ball throughout; only where your slice cuts it changes.';
      if (!now.orbitMeets) return 'Its orbit never meets your slice as it stands. Slide or turn your slice back toward its footprint on the map.';
      if (!now.playing) return 'Press play: the ball’s orbit carries it through your slice.';
      return 'Watch the hidden plane: the ball’s footprint will cross your line.';
    case 'cuts':
      if (!seen.has('turned')) return 'Turn your slice: drag a bright end of the line on the map, or press ← and →. Watch what it cuts.';
      if (!seen.has('shadow')) return 'The block never moved; your slice did. Lift the shadow to see all of it, flattened onto your view.';
      if (!seen.has('faced')) return 'Tap a coloured face to follow it: solid where your slice cuts it, lines in its shadow.';
      return 'Now drag the picture. Turning the camera changes where you look from — never what your slice cuts.';
    case 'collision':
      if (!seen.has('struck')) return seen.has('played') ? 'Watch the box.' : 'Press play and watch the box.';
      if (now.outOfReach) return 'Both bodies have carried on beyond your slice’s reach. Replay to just after the blow to look again.';
      if (now.strike === 'seen') return 'This time the ball was in your slice when it struck. Freeze an instant to compare the slice with the shadow.';
      if (!seen.has('turned') && !seen.has('shadow')) return 'Find the cause: look at the hidden plane, or lift the shadow.';
      if (now.strike === 'hidden') return 'The ball was beyond your slice, along w. Freeze an instant to compare the slice with the shadow.';
      return 'Replay the launch, or step to the blow, and find what struck the box.';
    case 'spin':
      if (!seen.has('struck')) return seen.has('played') ? 'Watch the box.' : 'Press play. The blow lands off-centre.';
      if (now.outOfReach) return 'Both bodies have carried on beyond your slice’s reach. Replay to just after the blow to look again.';
      if (!seen.has('frozen')) return 'Freeze, and the shadow lifts: the box is turning in a plane your slice cannot show.';
      return 'Its slice changes width as it turns; the box itself is rigid. Chapter V turns the same box by hand.';
    case 'turning':
      if (!seen.has('studied')) return 'Drag the angle, or press play for the prescribed turn.';
      if (!seen.has('compared')) return 'Switch to the ordinary turn: the same box, turned within your slice.';
      return 'Both are turns of one rigid box. Only the turn through w changes what your fixed slice cuts.';
    default:
      if (now.studyOpen) return 'This is the turning scene, where your slice is fixed. Choose a world to slide and turn your slice.';
      return 'Every instrument is open here. Switch worlds, slide and turn your slice, run the clocks.';
  }
}
