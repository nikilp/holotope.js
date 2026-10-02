import { GRAZE_EPSILON } from '../spatial-4d-turn/section.js';
import type { Meeting } from './worlds.js';

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
 * - Three facts are said apart, because they can differ: whether the slice
 *   meets a body (the library's status), what the meeting is and its
 *   dimension (read from the posed corners, within 10⁻⁹, and said "not
 *   established" when the corners leave it open), and what the renderer drew.
 *   A slice lying on a box's 3-face meets it in a solid cuboid whether or not
 *   anything is drawn; whether it is drawn is the sectioner's convention for a
 *   slice through a boundary — it cuts only cells with a corner strictly kata
 *   of the slice, and counts a corner on the slice as ana.
 * - A side is said with its subject: "the ball now lies ana of your slice",
 *   never "out to the ana side" after a move that could be the slice's.
 * - Nothing present prints as 0.00, and nothing prints a signed zero: a small
 *   distance prints as its bound, an exact zero without a sign.
 * - Prescribed motion is called prescribed; physics is called physics; a
 *   replay from launch is called a replay, never motion.
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

/**
 * A number for an ARIA value attribute or an unsigned readout: fixed places, and never a negative
 * zero — "-0.00" is a valid number, but it reads as a sign that is not there.
 */
export function plainReading(value: number, places: number): string {
  const shown = value.toFixed(places);
  return Number(shown) === 0 ? (0).toFixed(places) : shown;
}

/**
 * A slice position the page computes — a keyboard step, or the middle of a body's extent — that comes
 * within this of zero lands on zero: undone steps leave round-off (three up and three down leave
 * −6.9·10⁻¹⁸) that would otherwise print as a signed bound. A position you drag to is kept as given.
 * It is a thousandth of the sectioner's 10⁻⁹.
 */
export const AT_ZERO = 1e-12;

/**
 * A signed reading of a value the page derives rather than one you set — a component of the slice's
 * normal, a body's extent across the slice. Within AT_ZERO of zero it is zero: at a turn of exactly 90°
 * the normal's w component is cos 90° = 6·10⁻¹⁷ in floating point, which is no displacement at all.
 */
export function derivedReading(value: number, places: number): string {
  return signedReading(Math.abs(value) < AT_ZERO ? 0 : value, places);
}

/** Which side of your slice a signed gap lies on. */
export function side(gap: number): 'ana' | 'kata' {
  return gap > 0 ? 'ana' : 'kata';
}

/** A side length, for reading. */
const sideLength = (v: number): string => v.toFixed(2);

/**
 * What the slice shares with a body, as a noun phrase: "its −w face, a solid 4.40 × 2.60 × 1.60
 * cuboid". `short` leaves the lengths out, for a line that stays on screen.
 */
export function meetingPhrase(m: Meeting, short = false): string {
  switch (m.kind) {
    case 'none': return 'nothing';
    case 'through': return 'a solid';
    case 'unsettled': return 'part of its boundary, of a dimension not established within 10⁻⁹';
    case 'boundary': {
      const sides = short ? '' : ` ${m.sides.map(sideLength).join(' × ')}`;
      if (m.dim === 3) return `${m.face ? `its ${m.face} face` : 'one of its 3-faces'}, a solid${sides} cuboid`;
      if (m.dim === 2) return `a flat${sides} rectangle, with no thickness`;
      if (m.dim === 1) return short ? 'one of its edges' : `one of its edges,${sides} long`;
      return 'a single point';
    }
  }
}

/**
 * Why a body the slice meets only on its boundary has nothing drawn. A ball's touch is a single point,
 * marked but never drawn, whichever side the ball lies on. A box's edge or corner leaves the sectioner
 * no surface, from either side. A box's 2- or 3-face is drawn or not by the sectioner's convention.
 */
function undrawnBecause(m: Extract<Meeting, { kind: 'boundary' }>, name: string): string {
  const it = name.toLowerCase();
  if (m.body === 'ball') return 'A single point has no volume, so only a marker is drawn.';
  if (m.dim < 2) {
    return `Nothing is drawn for it, whichever side of your slice the ${it} lies on: `
      + `${m.dim === 1 ? 'an edge' : 'a single point'} leaves the sectioner no surface to emit.`;
  }
  if (m.rest === 'ana') {
    return `Nothing is drawn for it. The library’s sectioner cuts only the cells of the ${it} that have a corner `
      + 'strictly kata of your slice, and it counts a corner on your slice as ana; here every corner is on your '
      + 'slice or ana of it, so there is nothing to cut. That is the sectioner’s convention for a slice lying on a '
      + `boundary, not the shape of the meeting — with the ${it} kata of your slice instead, a meeting like this one `
      + `is drawn. A little ana-ward, inside the ${it}, the cut is drawn.`;
  }
  return 'Nothing is drawn for it.';
}

/**
 * A body's one-line caption: where it is relative to your slice. The cases
 * are never merged: in the slice and drawn; in the slice only on its boundary
 * and drawn (said with what the meeting is); in the slice but drawn as nothing
 * (a renderer omission — the library's membership and the picture disagree,
 * and the caption says so rather than calling the body absent); meeting it
 * only on its boundary with nothing drawn, said with what the meeting is; and
 * outside, with how far and to which side.
 */
export function caption(
  name: string, status: 'present' | 'tangent' | 'outside', gap: number, drawn: number, meeting: Meeting
): string {
  if (status === 'outside') return `${name} — not in your slice: ${distance(gap)} ${side(gap)} of it`;
  if (status === 'present' && drawn === 0) return `${name} — in your slice, but the renderer drew nothing for it`;
  const drawnNote = status === 'present' ? '' : '; nothing drawn';
  if (meeting.kind === 'boundary' && meeting.dim === 0) return `${name} — touching your slice at a single point${drawnNote}`;
  if (meeting.kind === 'boundary' || meeting.kind === 'unsettled') {
    return `${name} — ${status === 'present' ? 'in' : 'meets'} your slice only on its boundary: ${meetingPhrase(meeting)}${drawnNote}`;
  }
  return status === 'present' ? `${name} — in your slice` : `${name} — meets your slice${drawnNote}`;
}

/** Why a body shows nothing in the picture, one sentence each, from the model. */
export function absentReason(
  name: string, status: 'present' | 'tangent' | 'outside', gap: number, frame: 'in' | 'partial' | 'out' | null,
  reachable: boolean, drawn: number, meeting: Meeting
): string {
  if (status === 'tangent') {
    if (meeting.kind === 'boundary' && meeting.dim === 0) {
      return `${name} touches your slice at a single point, within 10⁻⁹. ${undrawnBecause(meeting, name)}`;
    }
    if (meeting.kind === 'boundary') {
      return `${name} meets your slice only on its boundary, within 10⁻⁹: ${meetingPhrase(meeting)}. `
        + undrawnBecause(meeting, name);
    }
    return `${name} meets your slice only on its boundary, within 10⁻⁹, but the corners on your slice do not `
      + 'make up one face, so what the meeting is — and its dimension — is not established at that tolerance. '
      + 'Nothing is drawn for it.';
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

/**
 * The empty view's headline: true whether or not a marker is on screen, and when the slice meets a body
 * whose meeting is not drawn (a solid face at the kata limit is met, not drawn).
 */
export const EMPTY_HEADLINE = 'No cut is drawn in view — and nothing has gone.';

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
  // Exactly zero, as every readout prints it: the page's own computed positions land there (AT_ZERO).
  if (signedDistance === 0) return 'Your slice passes through the centre point, so turning pivots about it.';
  return `Your slice is ${distance(signedDistance)} from the centre point, so turning now sweeps rather than pivots.`;
}

/**
 * What changed the picture. The slice is yours; the orbit and the physics clock move the bodies; a
 * replay rebuilds the run from its launch, so nothing moved to get there.
 */
export type Cause =
  | { readonly kind: 'slice' }
  | { readonly kind: 'orbit' }
  | { readonly kind: 'physics' }
  | { readonly kind: 'replay'; readonly step: number }
  | { readonly kind: 'launch'; readonly name: string };

function causeClause(cause: Cause): string {
  switch (cause.kind) {
    case 'slice': return 'you moved your slice';
    case 'orbit': return 'it moved along its prescribed orbit';
    case 'physics': return 'it moved';
    case 'replay': return `the run was replayed from launch to step ${cause.step}`;
    case 'launch': return `launch ${cause.name} was started afresh, at step 0`;
  }
}

/**
 * A notable change in the picture, said as what did it. The body's side gets its own clause with the
 * body as subject, so it can never be read as the side the slice moved to; `crossed` is a body that
 * stayed outside the slice but is now on its other side. `entered` is a body the slice met only on its
 * boundary and now passes through: it did not appear, since the slice met it already.
 */
export function eventLine(
  kind: 'appeared' | 'entered' | 'vanished' | 'crossed' | 'touching', name: string, gap: number, cause: Cause, meeting: Meeting
): string {
  const by = causeClause(cause);
  const it = name.toLowerCase();
  switch (kind) {
    case 'appeared': return `${name} appeared — ${by}, and now your slice cuts it.`;
    case 'entered': return `${name} now passes through your slice — ${by}, and its cut is drawn.`;
    case 'vanished': return `${name} vanished from your slice — ${by}; the ${it} now lies ${side(gap)} of your slice. It has not gone.`;
    case 'crossed': return `${name} is still not in your slice — ${by}; the ${it} now lies ${side(gap)} of your slice.`;
    case 'touching':
      if (meeting.kind === 'boundary' && meeting.body === 'ball') return `${name} is touching your slice at a single point — ${by}. Only a marker is drawn.`;
      return `${name} now meets your slice only on its boundary — ${by}. The meeting is ${meetingPhrase(meeting, true)}; nothing is drawn for it.`;
  }
}

/** A replay or a fresh launch that changed nothing else in the picture, said as itself. */
export function replayLine(cause: Extract<Cause, { kind: 'replay' | 'launch' }>): string {
  return cause.kind === 'replay'
    ? `The run was replayed from launch to step ${cause.step}.`
    : `Launch ${cause.name} was started afresh, at step 0.`;
}

/**
 * The blow, said with where the cause was at that step — the line stays on screen while the clock runs
 * on. `replayedTo` is the step a replay from launch landed on, when that is how the blow came to be shown.
 */
export function strikeLine(ballGap: number, replayedTo: number | null = null): string {
  const lead = replayedTo === null ? 'The box was struck' : `Replayed from launch to step ${replayedTo}, the blow: the box was struck there`;
  if (ballGap === 0) return `${lead} — by the ball, then in your slice.`;
  return `${lead} by something your slice cannot show: the ball, then ${distance(ballGap)} ${side(ballGap)} of your slice.`;
}

/**
 * Where the ball was at a blow you saw, with the slice you saw it with — a historical observation,
 * recorded when the clock steps through the blow or a replay lands on it, and quoted with its slice so
 * that it stays true after the slice moves.
 */
export interface StrikeObservation {
  readonly step: number;
  /** The ball's gap from the slice at that step: 0 when the slice met it. */
  readonly gap: number;
  readonly offset: number;
  readonly degrees: number;
}

function sliceThen(o: StrikeObservation): string {
  const turn = o.degrees === 0 ? 'untilted' : `turned ${signedReading(o.degrees, 1)}°`;
  return `your slice was ${turn}, at ${signedReading(o.offset, 2)}`;
}

/** The three clocks, named for what drives them. The physics step is read from the simulation's settings. */
export function clockName(kind: 'orbit' | 'physics' | 'study', dt: number, substeps: number): string {
  if (kind === 'orbit') return 'Prescribed orbit — no physics';
  if (kind === 'study') return 'Prescribed turn — not a physics simulation';
  return `Physics clock — fixed steps of 1/${Math.round(1 / dt)} s, ${substeps} substeps each`;
}

/**
 * What the visitor has done in this chapter. 'found' is an appearance their own slice move caused,
 * never one the orbit or the clock caused. Whether the box has been struck is not remembered here: it
 * is a fact of the current run, read from the model, so a replay or a new launch cannot leave it stale.
 */
type Seen = ReadonlySet<'played' | 'appeared' | 'found' | 'vanished' | 'turned' | 'slid' | 'shadow' | 'frozen' | 'studied' | 'compared' | 'faced'>;

/** What the model shows now, as far as a hint may depend on it. */
interface HintModel {
  /** The ball (either world's) is drawn in the slice. */
  readonly ballInSlice: boolean;
  /** The clock of the world in front is running. */
  readonly playing: boolean;
  /** The ball's prescribed orbit meets the turning world's slice at some phase. */
  readonly orbitMeets: boolean;
  /** The current run has passed its blow. */
  readonly struck: boolean;
  /** The box is turning now — measured, not assumed from the launch. */
  readonly spinning: boolean;
  /** The box is drawn in the slice in front. */
  readonly boxInSlice: boolean;
  /** The launch in front lands its blow off-centre. */
  readonly offCentre: boolean;
  /** The latest blow you saw in this run, with the slice you saw it with; null before one. */
  readonly strike: StrikeObservation | null;
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
      if (seen.has('vanished') && !now.ballInSlice) return 'It vanished — it has not gone. Pause, then follow it: drag the bright line on the gauge beside the picture toward the ball’s bar, or press ↑ or ↓. The hidden plane shows where it is.';
      if (now.ballInSlice) return 'There it is, in your slice. It is the same rigid ball throughout; only where your slice cuts it changes.';
      if (!now.orbitMeets) return 'Its orbit never meets your slice as it stands. Slide or turn your slice back toward its footprint on the map.';
      if (!now.playing) return 'Press play: the ball’s orbit carries it through your slice.';
      return 'Watch the hidden plane: the ball’s footprint will cross your line.';
    case 'cuts':
      if (!seen.has('turned')) return 'Turn your slice: drag a bright end of the line on the map, or press ← and →. Watch what it cuts.';
      if (!seen.has('shadow')) return 'The block never moved; your slice did. Lift the shadow to see all of it, flattened onto your view.';
      if (!seen.has('faced')) return 'Click or tap a coloured face, or press Follow a face, to follow it: solid where your slice cuts it, lines in its shadow.';
      return 'Now drag the picture. Turning the camera changes where you look from — never what your slice cuts.';
    case 'collision':
      if (!now.struck) return now.playing ? 'Watch the box.' : 'Press play and watch the box.';
      if (now.outOfReach) return 'Both bodies have carried on beyond your slice’s reach. Replay to just after the blow to look again.';
      if (now.strike && now.strike.gap === 0) {
        return `At the blow, step ${now.strike.step}, ${sliceThen(now.strike)}, and the ball was in it. Freeze an instant to compare the slice with the shadow.`;
      }
      if (!seen.has('turned') && !seen.has('shadow')) return 'Find the cause: look at the hidden plane, or lift the shadow.';
      if (now.strike) {
        return `At the blow, step ${now.strike.step}, ${sliceThen(now.strike)}, and the ball was ${distance(now.strike.gap)} `
          + `${side(now.strike.gap)} of it — beyond it, along the direction it cannot show. Freeze an instant to compare the slice with the shadow.`;
      }
      return 'Replay the launch, or step to the blow, and find what struck the box.';
    case 'spin':
      if (!now.struck) return now.playing ? 'Watch the box.' : now.offCentre ? 'Press play. The blow lands off-centre.' : 'Press play and watch the box.';
      if (now.outOfReach) return 'Both bodies have carried on beyond your slice’s reach. Replay to just after the blow to look again.';
      if (!now.spinning) return 'This launch’s blow is central, so the box does not turn. Launch B lands it off-centre.';
      if (!seen.has('frozen')) return 'Freeze, and the shadow lifts: the box is turning in a plane your slice cannot show.';
      if (!now.boxInSlice) return 'The box is turning beyond your slice now. Slide your slice back to it to watch its slice change width as it turns.';
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
