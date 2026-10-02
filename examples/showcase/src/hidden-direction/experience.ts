import { Frustum, Matrix4, Sphere, Vector3, type PerspectiveCamera } from 'three';
import {
  OFFSET_LIMIT, TURN_LIMIT, distanceFromPivot, setOffset, setPhase, setTheta, type TurnState
} from '../spatial-4d-turn/turn-state.js';
import { SCENE, positionAt, type GlomeObject } from '../spatial-4d-turn/scene.js';
import { ON_PLANE_EPSILON } from '../spatial-4d-turn/section.js';
import { BOX, DEFAULT_SETTINGS, PRESETS, type PresetId } from '../spatial-4d-contact/simulation.js';
import { STUDY_PLANES, type StudyMode } from '../spatial-4d-contact/study.js';
import { ContactWorld, TurnWorld, type BodyReading } from './worlds.js';
import {
  AT_ZERO, EMPTY_HEADLINE, GAUGE_LEGEND, PLANE_LEGEND, SHADOW_LEGEND, absentReason, caption, clockName, drawingNote, eventLine,
  briefState, hint, planeNote, pivotLine, replayLine, side, strikeLine, type Cause, type StrikeObservation
} from './copy.js';
import { FaceShadow } from './identity.js';
import { PLANE_EXTENT, chordOf, lineOf } from './plane.js';

/**
 * The Hidden Direction — one experience over the spatial pages' tested
 * modules. This controller holds every piece of state the page shows and is
 * the only thing the page's controls call (`dispatch`). It is DOM-free, so the
 * tests drive exactly the path the page drives.
 *
 * ## Four kinds of action, kept apart
 *
 * - **view** — the observer moves: the slice slides or turns, the shadow is
 *   lifted, a body is singled out. The world's state — the orbit phase, the
 *   physics simulation, the prescribed turn's angle — is never touched.
 * - **time** — a clock moves: the prescribed orbit, or the physics clock, which
 *   only ever steps forward or replays from launch. A replay is narrated as a
 *   replay, never as motion: nothing moved to get there.
 * - **study** — the separate prescribed-turn scene; it reads and writes nothing
 *   of the collision or the slice.
 * - **chapter** — establishes a chapter's stated state in full, whatever came
 *   before, and says so.
 *
 * The camera is the page's, not the controller's: orbiting the view is a pure
 * presentation change and appears here only as an input to framing.
 */

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
/** A slice position the page computes: exactly zero when it comes within AT_ZERO of zero. */
const landed = (v: number): number => (Math.abs(v) < AT_ZERO ? 0 : v);

export type ChapterId = 'arrival' | 'cuts' | 'collision' | 'spin' | 'turning' | 'free';
export type WorldKind = 'turn' | 'contact';

interface ChapterSpec {
  readonly id: ChapterId;
  readonly numeral: string;
  readonly title: string;
  readonly world: WorldKind;
  /** The stated state the chapter establishes — said to the visitor, and established in full. */
  readonly setup: string;
  /** One line under the title: what to try first. */
  readonly invite: string;
}

export const CHAPTERS: readonly ChapterSpec[] = [
  {
    id: 'arrival', numeral: 'I', title: 'Something passes through', world: 'turn',
    setup: 'Slice untilted, through the centre point. The ball’s orbit at its start, paused. Camera as you left it.',
    invite: 'Your view is a slice of a four-dimensional world. Let the ball pass through it.'
  },
  {
    id: 'cuts', numeral: 'II', title: 'One block, many slices', world: 'turn',
    setup: 'Slice untilted, through the centre point. The ball’s orbit at its start, paused. Camera as you left it.',
    invite: 'The block never moves. Turn your slice and watch what it cuts — then turn the camera, and watch what it doesn’t.'
  },
  {
    id: 'collision', numeral: 'III', title: 'A collision you cannot see', world: 'contact',
    setup: 'Slice untilted, through the centre point. Launch A, physics clock at 0, paused. Camera as you left it.',
    invite: 'Press play and watch the box.'
  },
  {
    id: 'spin', numeral: 'IV', title: 'A spin in a hidden plane', world: 'contact',
    setup: 'Slice untilted, through the centre point. Launch B — the same drop, 0.8 to the side — clock at 0, paused. '
      + 'Camera as you left it.',
    invite: 'Press play. The blow lands off-centre.'
  },
  {
    id: 'turning', numeral: 'V', title: 'Turn the object, not the slice', world: 'contact',
    setup: 'A separate scene: the same box, turned by a prescribed angle through the fourth direction, starting at 0°. '
      + 'The slice is fixed at w = 0. Entering pauses the collision’s clock; nothing else of the collision changes. '
      + 'Camera as you left it.',
    invite: 'Drag the angle. The box is rigid; your fixed slice meets different parts of it.'
  },
  {
    id: 'free', numeral: '∞', title: 'Explore freely', world: 'turn',
    setup: 'Everything stays where you left it. Choose a world to use every instrument in it; the turning scene keeps its fixed slice.',
    invite: 'Choose a world, slide and turn your slice, run the clocks, lift the shadow.'
  }
];

export type ActionKind = 'view' | 'time' | 'study' | 'chapter';

export type Action =
  | { readonly type: 'chapter'; readonly id: ChapterId }
  | { readonly type: 'world'; readonly world: WorldKind }
  | { readonly type: 'cut-offset'; readonly value: number }
  | { readonly type: 'cut-nudge'; readonly delta: number }
  | { readonly type: 'cut-turn'; readonly degrees: number }
  | { readonly type: 'cut-turn-nudge'; readonly delta: number }
  | { readonly type: 'cut-reset' }
  | { readonly type: 'cut-to'; readonly body: string }
  | { readonly type: 'shadow'; readonly on: boolean }
  | { readonly type: 'focus'; readonly body: string | null }
  | { readonly type: 'focus-face'; readonly ordinal: number | null }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'step' }
  | { readonly type: 'step-back' }
  | { readonly type: 'jump-touch' }
  | { readonly type: 'jump-after' }
  | { readonly type: 'replay' }
  | { readonly type: 'preset'; readonly id: PresetId }
  | { readonly type: 'orbit-phase'; readonly degrees: number }
  | { readonly type: 'freeze' }
  | { readonly type: 'study-mode'; readonly mode: StudyMode }
  | { readonly type: 'study-angle'; readonly degrees: number }
  | { readonly type: 'study-play' }
  | { readonly type: 'study-pause' }
  | { readonly type: 'tick'; readonly seconds: number };

/** What each action is allowed to touch. `play`/`pause` move the clock of the scene in front. */
export function kindOf(action: Action): ActionKind {
  switch (action.type) {
    case 'chapter': case 'world': return 'chapter';
    case 'cut-offset': case 'cut-nudge': case 'cut-turn': case 'cut-turn-nudge': case 'cut-reset': case 'cut-to':
    case 'shadow': case 'focus': case 'focus-face':
    // Freeze stops every clock where it stands and lifts the shadow: no state moves, so it is a view action.
    case 'freeze':
      return 'view';
    case 'study-mode': case 'study-angle': case 'study-play': case 'study-pause':
      return 'study';
    default:
      return 'time';
  }
}

/** Seconds per revolution of the ball's prescribed orbit while playing — the accepted page's period. */
const ORBIT_PERIOD_S = 12;
/** Most physics steps per frame, and the longest frame the clocks will credit — the accepted page's limits. */
const MAX_STEPS_PER_TICK = 8;
const MAX_TICK_S = 0.1;

/** Where the slice must sit to cut a body, within the slider's reach — or null if no reachable offset meets it. */
function reachTarget(low: number, high: number): number | null {
  const target = Math.min(Math.max((low + high) / 2, -OFFSET_LIMIT), OFFSET_LIMIT);
  return target >= low && target <= high ? target : null;
}

/** Actions that move your slice. Refused while the turning scene is in front: there the slice is fixed at w = 0. */
const SLICE_ACTIONS: ReadonlySet<Action['type']> = new Set(['cut-offset', 'cut-nudge', 'cut-turn', 'cut-turn-nudge', 'cut-reset', 'cut-to']);
/**
 * Actions that move the collision's clock. Refused unless the collision is in front, so that a clock is
 * never moved out of sight — the turning scene in particular promises to leave the collision as it is.
 */
const COLLISION_CLOCK_ACTIONS: ReadonlySet<Action['type']> = new Set(['step', 'step-back', 'jump-touch', 'jump-after', 'replay', 'preset']);

/** The turning scene's ball, looked up as the section modules look it up. */
const COMPANION = SCENE.find((o) => o.id === 'companion') as GlomeObject;
/** Phases sampled to decide whether the ball's prescribed orbit ever meets a slice. */
const ORBIT_SAMPLES = 720;

/**
 * Whether the ball's prescribed orbit meets the slice at some phase: its centre, by the scene's own
 * `positionAt`, within the radius of the slice (with the sectioner's tolerance). A hint may then say
 * the ball will come; otherwise it must not.
 *
 * Sampled, and the sampling's limit is this: the orbit turns in the z–w plane, so for a normal in the
 * x–w plane n·c(φ) = 3.6 n_x + 0.92 n_w cos φ. Its extremes, at φ = 0 and π, are among the samples,
 * and neighbouring samples differ in n·c by less than 0.009, far under the ball's diameter, so the
 * samples decide as the continuous orbit does, up to rounding. Any sampling that keeps both extremes
 * and steps less than a diameter decides the same — eight samples do (the review's RV4 is equivalent);
 * one that misses the extremes does not, within a few millionths of tangency (`copy.test.ts`).
 */
function orbitMeets(slice: { signedDistance(p: readonly number[]): number }): boolean {
  for (let k = 0; k < ORBIT_SAMPLES; k++) {
    const c = positionAt(COMPANION, (2 * Math.PI * k) / ORBIT_SAMPLES);
    if (Math.abs(slice.signedDistance(c)) <= COMPANION.radius + ON_PLANE_EPSILON) return true;
  }
  return false;
}

interface EventNote { readonly line: string; readonly at: number }

/** Below this, in every bivector coefficient, the box is not turning (the central blow leaves it at zero). */
const SPIN_EPSILON = 1e-12;

export function createExperience(start: ChapterId = 'arrival') {
  const turnWorld = new TurnWorld();
  const contactWorld = new ContactWorld();

  // Observer state — the slice in each world, the shadow, the focus. Never touched by time.
  let turnKnife: TurnState = { theta: 0, offset: 0, phase: 0 };
  let contactKnife: TurnState = { theta: 0, offset: 0, phase: 0 };
  let shadow = false;
  let focus: string | null = null;
  let faceFocus: number | null = null;
  const block = turnWorld.products.find((p) => p.complex !== null)!;
  const faceShadow = new FaceShadow(block.complex!, turnWorld.context.projection);
  turnWorld.root.add(faceShadow.object);
  type Mark = 'played' | 'appeared' | 'found' | 'vanished' | 'turned' | 'slid' | 'shadow' | 'frozen' | 'studied' | 'compared' | 'faced';
  const seen = new Set<Mark>();

  // Clocks.
  let orbitPlaying = false;
  let physicsPlaying = false;
  let accumulator = 0;
  let studyOpen = false;

  let chapter: ChapterId = start;
  let world: WorldKind = 'turn';
  let event: EventNote | null = null;
  let sequence = 0;
  let lastStatus = new Map<string, string>();
  let lastCause: Cause = { kind: 'slice' };
  /** The latest blow you saw in this run, with the slice you saw it with. Null until one is shown. */
  let strike: StrikeObservation | null = null;
  /** The blow was shown in this action and said so: what else changed in the same action follows its line. */
  let strikeSaid = false;
  /** Whether the orbit meets the turning world's slice, cached against the slice it was computed for. */
  let orbitCache: { theta: number; offset: number; meets: boolean } | null = null;

  const knife = (): TurnState => (world === 'turn' ? turnKnife : contactKnife);
  const setKnife = (k: TurnState): void => { if (world === 'turn') turnKnife = k; else contactKnife = k; };

  function apply(): void {
    turnWorld.apply(turnKnife);
    faceShadow.show(world === 'turn' ? faceFocus : null);
    contactWorld.apply(contactKnife);
    contactWorld.study.update();
    turnWorld.context.setVisible(shadow && world === 'turn');
    contactWorld.views.context.setVisible(shadow && world === 'contact' && !studyOpen);
    contactWorld.study.views.context.visible = shadow && studyOpen;
    turnWorld.root.visible = world === 'turn';
    contactWorld.root.visible = world === 'contact' && !studyOpen;
    contactWorld.study.views.object.visible = world === 'contact' && studyOpen;
  }

  /** Notice changes in the picture and say what did them. */
  function notice(): void {
    const bodies = readBodies();
    const next = new Map<string, string>();
    const lines: string[] = [];
    const after: string[] = [];
    for (const b of bodies) {
      const key = `${world}:${b.id}`;
      // A body the library places in the slice but the renderer draws nothing for is neither "appeared" nor "vanished".
      // A body outside is keyed by its side as well, so that one which changes sides without meeting the slice is said.
      const now = b.status === 'outside' ? `outside:${side(b.gap)}` : b.status === 'tangent' ? 'tangent' : b.drawn > 0 ? 'present' : 'omitted';
      next.set(key, now);
      const before = lastStatus.get(key);
      if (before === undefined || before === now) continue;
      // The marks are the ball's: the arrival chapter's hints are about following it.
      const ball = b.id === 'companion' || b.id === 'ball';
      let kind: Parameters<typeof eventLine>[0];
      if (now === 'present') {
        // Drawn on a face only, the meeting is still a boundary one; from a boundary meeting into the interior, the
        // slice met the body already and now passes through it; otherwise the body appeared.
        kind = b.meeting.kind === 'boundary' ? 'face' : before === 'tangent' ? 'entered' : 'appeared';
        seen.add('appeared');
        // Credit the visitor only for the ball brought in by their own slice move, and only for the latest one.
        if (ball) { if (lastCause.kind === 'slice') seen.add('found'); else seen.delete('found'); }
      }
      // Event lines stay on screen while the clock runs on, so they say nothing about a marker that may
      // already be gone; the caption and the picture's own tag say what a marker is while it is there.
      else if (now.startsWith('outside')) {
        kind = before.startsWith('outside') ? 'crossed' : 'vanished';
        if (ball) { if (kind === 'vanished') seen.add('vanished'); seen.delete('found'); }
      }
      else if (now === 'tangent') kind = 'touching';
      else continue;
      lines.push(eventLine(kind, b.name, b.gap, lastCause, b.meeting));
      // After the blow's line, the ball's state is left out where that line already gives it.
      const inSlice = kind === 'appeared' || kind === 'entered' || kind === 'face';
      const told = strikeSaid && strike !== null && ball
        && ((inSlice && strike.gap === 0) || ((kind === 'vanished' || kind === 'crossed') && strike.gap !== 0 && side(strike.gap) === side(b.gap)));
      if (!told) after.push(briefState(kind, b.name, b.gap, b.meeting));
    }
    lastStatus = next;
    if (lines.length === 0) return;
    // Every change is said: after the blow's line when one was said in this action, otherwise after the first
    // change's own line, each as what it left the body as.
    if (strikeSaid && event !== null) {
      if (after.length > 0) event = { line: `${event.line} ${after.join(' ')}`, at: event.at };
    } else {
      event = { line: [lines[0]!, ...after.slice(1)].join(' '), at: ++sequence };
    }
  }

  /** A sentence, then what any marker on screen for this body means. */
  function withNote(sentence: string, b: BodyReading): string {
    const note = drawingNote(b.marker, b.hollow);
    return note ? `${sentence} ${note}` : sentence;
  }

  function readBodies(): BodyReading[] {
    if (world === 'turn') return turnWorld.bodies();
    if (studyOpen) return [];
    return contactWorld.bodies();
  }

  /** Establish a chapter's stated state in full. Nothing from an earlier chapter survives unless the chapter says so. */
  function enter(id: ChapterId): void {
    chapter = id;
    const spec = CHAPTERS.find((c) => c.id === id)!;
    event = null;
    seen.clear();
    // "Everything stays where you left it": free exploration keeps the focus and the followed face too.
    if (id === 'free') { lastCause = { kind: 'slice' }; apply(); lastStatus = new Map(); notice(); return; }
    focus = null;
    faceFocus = null;
    strike = null;
    world = spec.world;
    shadow = false;
    orbitPlaying = false;
    physicsPlaying = false;
    accumulator = 0;
    studyOpen = false;
    contactWorld.study.setPlaying(false);
    if (id === 'arrival' || id === 'cuts') {
      turnKnife = { theta: 0, offset: 0, phase: 0 };
    } else if (id === 'collision' || id === 'spin') {
      contactKnife = { theta: 0, offset: 0, phase: 0 };
      contactWorld.launch(id === 'collision' ? 'central' : 'off-centre');
    } else if (id === 'turning') {
      studyOpen = true;
      contactWorld.study.reset();
      contactWorld.study.setMode('fourth');
    }
    apply();
    lastStatus = new Map();
    notice();
  }

  /**
   * The blow is on screen now: record where the ball is against the slice it is seen with, and say so.
   * `replayedTo` is the step a replay from launch landed on, when that is how the blow came to be shown.
   */
  function observeStrike(replayedTo: number | null): void {
    apply();
    const ball = contactWorld.bodies().find((b) => b.id === 'ball')!;
    strike = { step: contactWorld.sim.steps, gap: ball.gap, offset: contactKnife.offset, degrees: deg(contactKnife.theta) };
    event = { line: strikeLine(ball.gap, replayedTo), at: ++sequence };
    strikeSaid = true;
  }

  /** Step the physics clock n fixed steps; a blow is described at the very step it lands, with the ball where it was then. */
  function stepPhysics(n: number): void {
    for (let k = 0; k < n; k++) {
      const before = contactWorld.sim.impacts;
      contactWorld.step();
      if (contactWorld.sim.impacts > before) observeStrike(null);
    }
  }

  /**
   * A replay from launch to a step. It is narrated as a replay; if it lands on the blow, the blow is shown
   * afresh with the slice you have now, and recorded so. Before the blow there is nothing to remember.
   */
  function replayTo(steps: number): void {
    physicsPlaying = false;
    accumulator = 0;
    contactWorld.replayTo(steps);
    lastCause = { kind: 'replay', step: contactWorld.sim.steps };
    if (contactWorld.sim.impacts === 0) strike = null;
    else if (contactWorld.sim.steps === contactWorld.impactStep()) observeStrike(contactWorld.sim.steps);
  }

  /** Whether the box is turning now, from the simulation's own angular velocity. */
  function boxSpinning(): boolean {
    return contactWorld.sim.state('box').angularVelocity.some((c) => Math.abs(c) > SPIN_EPSILON);
  }

  function dispatch(action: Action): void {
    if (studyOpen && SLICE_ACTIONS.has(action.type)) return;
    if (COLLISION_CLOCK_ACTIONS.has(action.type) && (world !== 'contact' || studyOpen)) return;
    // What changes the picture: the slice, the orbit, the physics clock — or a replay, which says so itself.
    lastCause = kindOf(action) === 'view' ? { kind: 'slice' } : world === 'turn' ? { kind: 'orbit' } : { kind: 'physics' };
    strikeSaid = false;
    const said = sequence;
    mark(action);
    switch (action.type) {
      case 'chapter': enter(action.id); return;
      // The line on screen was about the world left behind; the new world has said nothing yet.
      case 'world':
        if (world !== action.world || studyOpen) event = null;
        world = action.world;
        studyOpen = false;
        break;
      case 'cut-offset': setKnife(setOffset(knife(), action.value)); break;
      // A keyboard step, like any position the page computes, lands on zero when it comes within AT_ZERO
      // of it; a drag is never snapped.
      case 'cut-nudge': setKnife(setOffset(knife(), landed(knife().offset + action.delta))); break;
      case 'cut-turn': setKnife(setTheta(knife(), rad(action.degrees))); break;
      case 'cut-turn-nudge': setKnife(setTheta(knife(), landed(knife().theta + rad(action.delta)))); break;
      case 'cut-reset': setKnife({ ...knife(), theta: 0, offset: 0 }); break;
      case 'cut-to': {
        const b = readBodies().find((x) => x.id === action.body);
        const target = b ? reachTarget(b.low, b.high) : null;
        if (target !== null) setKnife(setOffset(knife(), landed(target)));
        break;
      }
      case 'shadow': shadow = action.on; break;
      case 'focus': focus = action.body; break;
      case 'focus-face': faceFocus = world === 'turn' ? action.ordinal : null; break;
      case 'play':
        if (world === 'turn') orbitPlaying = true;
        else if (studyOpen) contactWorld.study.setPlaying(true);
        else physicsPlaying = true;
        break;
      case 'pause':
        orbitPlaying = false;
        physicsPlaying = false;
        accumulator = 0;
        contactWorld.study.setPlaying(false);
        break;
      case 'freeze':
        orbitPlaying = false;
        physicsPlaying = false;
        accumulator = 0;
        contactWorld.study.setPlaying(false);
        shadow = true;
        break;
      // The collision's clock: only reached with the collision in front (refused above otherwise).
      case 'step': physicsPlaying = false; stepPhysics(1); break;
      case 'step-back': replayTo(contactWorld.sim.steps - 1); break;
      case 'jump-touch': {
        const n = contactWorld.impactStep();
        if (n !== null) replayTo(n - 1);
        break;
      }
      case 'jump-after': {
        const n = contactWorld.impactStep();
        if (n !== null) replayTo(n);
        break;
      }
      case 'replay':
        physicsPlaying = false; accumulator = 0; strike = null; contactWorld.launch(contactWorld.presetId);
        lastCause = { kind: 'replay', step: 0 };
        break;
      case 'preset':
        physicsPlaying = false; accumulator = 0; strike = null; contactWorld.launch(action.id);
        lastCause = { kind: 'launch', name: PRESETS.find((p) => p.id === action.id)!.name.charAt(0) };
        break;
      case 'orbit-phase': turnKnife = setPhase(turnKnife, rad(action.degrees)); break;
      case 'study-mode': contactWorld.study.setMode(action.mode); break;
      case 'study-angle': contactWorld.study.setPlaying(false); contactWorld.study.setAngle(rad(action.degrees)); break;
      case 'study-play': contactWorld.study.setPlaying(true); break;
      case 'study-pause': contactWorld.study.setPlaying(false); break;
      case 'tick': {
        const s = Math.min(Math.max(action.seconds, 0), MAX_TICK_S);
        // Every clock advances only with its world in front: a clock is never moved out of sight.
        if (orbitPlaying && world === 'turn') turnKnife = setPhase(turnKnife, turnKnife.phase + (2 * Math.PI * s) / ORBIT_PERIOD_S);
        if (physicsPlaying && world === 'contact' && !studyOpen) {
          accumulator += s;
          let steps = 0;
          while (accumulator >= DEFAULT_SETTINGS.dt && steps < MAX_STEPS_PER_TICK) { accumulator -= DEFAULT_SETTINGS.dt; steps++; }
          // A slow frame slows the clock rather than leaving a backlog to be paid later in a burst.
          if (steps === MAX_STEPS_PER_TICK) accumulator = Math.min(accumulator, DEFAULT_SETTINGS.dt);
          if (steps > 0) stepPhysics(steps);
        }
        if (studyOpen) contactWorld.study.advance(s);
        break;
      }
    }
    apply();
    notice();
    // A replay or a fresh launch is always said: if no body changed in the picture, as itself.
    if ((lastCause.kind === 'replay' || lastCause.kind === 'launch') && sequence === said) {
      event = { line: replayLine(lastCause), at: ++sequence };
    }
  }

  /** Remember what the visitor did, for the chapter's next hint. */
  function mark(action: Action): void {
    switch (action.type) {
      case 'play': seen.add(studyOpen ? 'studied' : 'played'); break;
      case 'cut-turn': case 'cut-turn-nudge': seen.add('turned'); break;
      case 'cut-offset': case 'cut-nudge': case 'cut-to': seen.add('slid'); break;
      case 'shadow': if (action.on) seen.add('shadow'); break;
      case 'freeze': seen.add('frozen'); seen.add('shadow'); break;
      case 'focus-face': if (action.ordinal !== null) seen.add('faced'); break;
      case 'study-angle': case 'study-play': seen.add('studied'); break;
      case 'study-mode': if (action.mode === 'ordinary') seen.add('compared'); break;
      default: break;
    }
  }

  /** Where each drawn body lies against the camera's view volume. */
  function frameOf(b: BodyReading, camera: PerspectiveCamera | null): 'in' | 'partial' | 'out' | null {
    if (camera === null || b.drawnBound === null) return null;
    camera.updateMatrixWorld();
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const c = new Vector3(...b.drawnBound.centre);
    const sphere = new Sphere(c, b.drawnBound.radius);
    if (!frustum.intersectsSphere(sphere)) return 'out';
    const inner = frustum.planes.every((p) => p.distanceToPoint(c) >= b.drawnBound!.radius);
    return inner ? 'in' : 'partial';
  }

  /**
   * The ways back from an empty view. A view action for what the slice misses, a camera-only turn
   * for what the camera misses. Only when neither can help — the struck bodies have carried on
   * beyond the slider's reach — a replay of the physics clock, from launch, said as such.
   */
  function recoveriesFor(bodies: readonly { id: string; name: string; drawn: number; frame: 'in' | 'partial' | 'out' | null; reachable: boolean; drawnBound: BodyReading['drawnBound'] }[]) {
    const out: { label: string; action: Action | null; frame: BodyReading['drawnBound'] }[] = [];
    for (const b of bodies) {
      if (b.drawn > 0 && b.frame === 'out') out.push({ label: `Turn the camera to the ${b.name.toLowerCase()}`, action: null, frame: b.drawnBound });
      else if (b.reachable) out.push({ label: `Slide your slice to the ${b.name.toLowerCase()}`, action: { type: 'cut-to', body: b.id }, frame: null });
    }
    if (out.length === 0 && world === 'contact' && !studyOpen && contactWorld.sim.impacts > 0) {
      out.push({ label: 'Replay to just after the blow', action: { type: 'jump-after' }, frame: null });
      out.push({ label: 'Replay the launch', action: { type: 'replay' }, frame: null });
    }
    return out;
  }

  /** The whole picture the page renders, from the model. */
  function view(camera: PerspectiveCamera | null = null) {
    const spec = CHAPTERS.find((c) => c.id === chapter)!;
    const k = knife();
    const slice = world === 'turn' ? turnWorld.slice : contactWorld.slice;
    const bodies = readBodies().map((b) => {
      const frame = frameOf(b, camera);
      return {
        id: b.id, name: b.name, colour: b.colour, status: b.status, drawn: b.drawn,
        low: b.low, high: b.high, gap: b.gap, frame, focused: focus === b.id,
        meeting: b.meeting,
        caption: [caption(b.name, b.status, b.gap, b.drawn, b.meeting), drawingNote(b.marker, b.hollow)].filter(Boolean).join('. '),
        reason: withNote(absentReason(b.name, b.status, b.gap, frame, reachTarget(b.low, b.high) !== null, b.drawn, b.meeting), b),
        reachable: reachTarget(b.low, b.high) !== null,
        footprint: b.footprint,
        drawnBound: b.drawnBound
      };
    });
    const visible = bodies.filter((b) => b.drawn > 0 && b.frame !== 'out');
    const empty = !studyOpen && bodies.length > 0 && visible.length === 0
      ? {
          headline: EMPTY_HEADLINE,
          reasons: bodies.map((b) => ({ id: b.id, line: b.reason, colour: b.colour })),
          recoveries: recoveriesFor(bodies)
        }
      : null;
    const physics = world === 'contact' && !studyOpen;
    const study = contactWorld.study;
    const { dt, substeps } = DEFAULT_SETTINGS;
    const clock = world === 'turn'
      ? { kind: 'orbit' as const, name: clockName('orbit', dt, substeps), playing: orbitPlaying, readout: `orbit at ${deg(turnKnife.phase).toFixed(0)}°` }
      : physics
        ? {
            kind: 'physics' as const, name: clockName('physics', dt, substeps), playing: physicsPlaying,
            readout: `${contactWorld.sim.time.toFixed(3)} s · step ${contactWorld.sim.steps}`
              + (physicsPlaying ? '' : ' · paused')
          }
        : { kind: 'study' as const, name: clockName('study', dt, substeps), playing: study.playing, readout: `${study.angleDegrees().toFixed(1)}° in the ${STUDY_PLANES[study.mode].label} plane` };
    const preset = PRESETS.find((p) => p.id === contactWorld.presetId)!;
    const ballInSlice = bodies.some((b) => (b.id === 'companion' || b.id === 'ball') && b.drawn > 0);
    if (orbitCache === null || orbitCache.theta !== turnKnife.theta || orbitCache.offset !== turnKnife.offset) {
      orbitCache = { theta: turnKnife.theta, offset: turnKnife.offset, meets: orbitMeets(turnWorld.slice) };
    }
    // The slice in front: the turning scene's own, fixed at w = 0, while it is open; otherwise the world's.
    const cutSlice = studyOpen ? study.slice : slice;
    // The map: the slice in front as a line on the x–w plane, and every body's footprint with the line's chord through it.
    const line = lineOf(Array.from(cutSlice.normal.data), cutSlice.offset);
    // Whether the line crosses a footprint is the library's status; the footprint arithmetic only shapes the chord.
    const footprints = studyOpen
      ? [{ id: 'study-box', name: BOX.name, colour: BOX.colour, footprint: contactWorld.studyFootprint(), meets: study.views.box.status !== 'outside' }]
      : bodies.map((b) => ({ id: b.id, name: b.name, colour: b.colour, footprint: b.footprint, meets: b.status !== 'outside' }));
    return {
      hint: hint(chapter, seen, {
        ballInSlice,
        playing: world === 'turn' ? orbitPlaying : physicsPlaying,
        orbitMeets: orbitCache.meets,
        struck: physics && contactWorld.sim.impacts > 0,
        spinning: physics && boxSpinning(),
        boxInSlice: physics && bodies.some((b) => b.id === 'box' && b.drawn > 0),
        boxReachable: physics && bodies.some((b) => b.id === 'box' && b.reachable),
        ballReachable: bodies.some((b) => (b.id === 'companion' || b.id === 'ball') && b.reachable),
        offCentre: physics && contactWorld.presetId === 'off-centre',
        strike: physics && contactWorld.sim.impacts > 0 ? strike : null,
        // Nothing in view and only a replay can bring a body back.
        outOfReach: empty !== null && empty.recoveries.every((r) => r.action !== null && kindOf(r.action) === 'time'),
        studyOpen
      }),
      face: faceFocus === null || world !== 'turn' ? null : { ordinal: faceFocus, name: block.faces[faceFocus]!.name, colour: block.faces[faceFocus]!.colour },
      /** The source faces the slice cuts now, for following one without a pointer. */
      facesCut: world === 'turn' ? Array.from(block.presentFaces).sort((a, b) => a - b) : [],
      chapter: { id: spec.id, numeral: spec.numeral, title: spec.title, setup: spec.setup, invite: spec.invite },
      world,
      studyOpen,
      cut: {
        degrees: studyOpen ? 0 : deg(k.theta), offset: cutSlice.offset,
        turnLimit: deg(TURN_LIMIT), offsetLimit: OFFSET_LIMIT,
        normal: Array.from(cutSlice.normal.data),
        pivot: pivotLine(distanceFromPivot(cutSlice))
      },
      bodies,
      empty,
      clock,
      preset: physics ? { id: preset.id, name: preset.name } : null,
      impacts: physics ? contactWorld.sim.impacts : 0,
      shadow: { on: shadow, legend: SHADOW_LEGEND },
      gauge: GAUGE_LEGEND,
      plane: {
        line,
        extent: PLANE_EXTENT,
        /** The slice can be turned and slid from the map only where it is yours to move. */
        movable: !studyOpen,
        legend: PLANE_LEGEND,
        note: planeNote(studyOpen),
        footprints: footprints.map(({ meets, ...f }) => ({ ...f, chord: line === null ? null : chordOf(f.footprint, line, meets) }))
      },
      event: event === null ? null : event.line,
      eventId: event === null ? 0 : event.at,
      study: studyOpen ? { mode: study.mode, degrees: study.angleDegrees(), description: study.describe() } : null
    };
  }

  enter(start);

  return {
    dispatch,
    view,
    /** The scene graph roots the page adds to its viewport. */
    roots: [turnWorld.root, contactWorld.root, contactWorld.study.views.object],
    /** Read-only handles for verification: the same objects the page renders. */
    worlds: { turn: turnWorld, contact: contactWorld },
    faceShadow,
    /** The turning world's block section, for picking a face in the picture. */
    block,
    dispose(): void { faceShadow.dispose(); turnWorld.dispose(); contactWorld.dispose(); }
  };
}
