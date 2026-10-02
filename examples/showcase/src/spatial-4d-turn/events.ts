import type { SceneObject } from './scene.js';
import { createProducts, type SectionProduct } from './section.js';
import {
  OFFSET_LIMIT, REFERENCE_STATE, TURN_LIMIT, applyTo, createSlice, setOffset, setPhase, setTheta,
  type TurnState
} from './turn-state.js';

/**
 * Where, along a control, things happen — found by looking, not by typing, and
 * found AGAIN whenever another control moves.
 *
 * Each slider is annotated with the range over which the companion is in the
 * cut and the points at which the block leaves it. Both are obtained by driving
 * a private copy of the SAME products the viewport draws across the slider's
 * own grid and recording transitions.
 *
 * The events along one control depend on where the OTHER controls are: the
 * angles at which the ball is in the cut depend on the offset and on where the
 * ball is along its path, and the phases at which it is in the cut depend on
 * how the knife is set. So every scan is AT the other controls' values, records
 * them, and the page rescans when they change. A mark computed for other values
 * is not approximately right; it answers a different question.
 */

export interface EventWindow {
  /** First grid value at which the body is in or touching the cut. */
  readonly enter: number;
  /** Last grid value at which it still is. */
  readonly exit: number;
}

export interface FaceChange {
  readonly from: number;
  readonly to: number;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

export interface ControlEvents {
  readonly gridStep: number;
  readonly min: number;
  readonly max: number;
  /** The values of the OTHER controls these events were scanned at. */
  readonly at: Readonly<Record<string, number>>;
  readonly companionWindows: readonly EventWindow[];
  readonly blockWindows: readonly EventWindow[];
  readonly faceChanges: readonly FaceChange[];
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Extend an open window to `v`, or open one at `v`. Declared types stop the
 *  narrowing that otherwise turns a `let x: T | null = null` into `never` inside a loop. */
const extend = (open: EventWindow | null, v: number): EventWindow =>
  ({ enter: open?.enter ?? v, exit: v });
const TURN_LIMIT_DEG = (TURN_LIMIT * 180) / Math.PI;

/** Holds one private product set and scans it; reused so a drag rebuilds nothing. */
export class EventScanner {
  private readonly slice = createSlice();
  private readonly products: SectionProduct[];
  private readonly block: SectionProduct | undefined;
  private readonly companion: SectionProduct | undefined;

  constructor(scene: readonly SceneObject[]) {
    this.products = createProducts(scene, this.slice);
    this.block = this.products.find((p) => p.faces.length > 0);
    this.companion = this.products.find((p) => p.faces.length === 0);
  }

  /** Along the TURN (degrees), at a fixed offset and phase. */
  turnEvents(atOffset: number, atPhaseDeg = 0, gridStepDeg = 0.5): ControlEvents {
    return this.scan(-TURN_LIMIT_DEG, TURN_LIMIT_DEG, gridStepDeg,
      { offset: atOffset, phase: atPhaseDeg },
      (deg) => setPhase(setOffset(setTheta(REFERENCE_STATE, rad(deg)), atOffset), rad(atPhaseDeg)));
  }

  /** Along the OFFSET (world units), at a fixed turn and phase. */
  offsetEvents(atThetaDeg: number, atPhaseDeg = 0, gridStep = 0.01): ControlEvents {
    return this.scan(-OFFSET_LIMIT, OFFSET_LIMIT, gridStep,
      { turn: atThetaDeg, phase: atPhaseDeg },
      (o) => setPhase(setOffset(setTheta(REFERENCE_STATE, rad(atThetaDeg)), o), rad(atPhaseDeg)));
  }

  /**
   * Along the ball's PATH (phase, degrees 0…359, matching the slider: 360 is 0
   * again), at a fixed turn and offset. A window straddling 359° → 0° would be
   * reported as two; the rest position at phase 0 is outside the reference cut,
   * so none does here.
   */
  phaseEvents(atThetaDeg: number, atOffset: number, gridStepDeg = 1): ControlEvents {
    return this.scan(0, 359, gridStepDeg,
      { turn: atThetaDeg, offset: atOffset },
      (p) => setPhase(setOffset(setTheta(REFERENCE_STATE, rad(atThetaDeg)), atOffset), rad(p)));
  }

  private scan(
    min: number, max: number, step: number, at: Readonly<Record<string, number>>,
    stateAt: (value: number) => TurnState
  ): ControlEvents {
    const companionWindows: EventWindow[] = [];
    const blockWindows: EventWindow[] = [];
    const faceChanges: FaceChange[] = [];
    let companionOpen: EventWindow | null = null;
    let blockOpen: EventWindow | null = null;
    let previousFaces: string[] | null = null;
    let previous = min;
    const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);

    for (let raw = min; raw <= max + step / 2; raw += step) {
      const v = Number(raw.toFixed(decimals));
      const state = stateAt(v);
      applyTo(this.slice, state);
      for (const p of this.products) { p.setPhase(state.phase); p.update(this.slice); }

      if (this.companion) {
        const inside = this.companion.status !== 'outside';
        if (inside) companionOpen = extend(companionOpen, v);
        else if (companionOpen) { companionWindows.push(companionOpen); companionOpen = null; }
      }
      if (this.block) {
        const inside = this.block.status !== 'outside';
        if (inside) blockOpen = extend(blockOpen, v);
        else if (blockOpen) { blockWindows.push(blockOpen); blockOpen = null; }
        const names = [...this.block.presentFaces].map((o) => this.block!.faces[o]!.name).sort();
        if (previousFaces !== null && names.join('|') !== previousFaces.join('|')) {
          faceChanges.push({ from: previous, to: v, before: previousFaces, after: names });
        }
        previousFaces = names;
      }
      previous = v;
    }
    if (companionOpen) companionWindows.push(companionOpen);
    if (blockOpen) blockWindows.push(blockOpen);
    return { gridStep: step, min, max, at, companionWindows, blockWindows, faceChanges };
  }

  dispose(): void { for (const p of this.products) p.dispose(); }
}

/** One-shot conveniences for tests and callers that scan once. */
export function scanTurnEvents(
  scene: readonly SceneObject[], gridStepDeg = 0.5, atOffset = 0, atPhaseDeg = 0
): ControlEvents {
  const s = new EventScanner(scene);
  try { return s.turnEvents(atOffset, atPhaseDeg, gridStepDeg); } finally { s.dispose(); }
}
export function scanOffsetEvents(
  scene: readonly SceneObject[], gridStep = 0.01, atThetaDeg = 0, atPhaseDeg = 0
): ControlEvents {
  const s = new EventScanner(scene);
  try { return s.offsetEvents(atThetaDeg, atPhaseDeg, gridStep); } finally { s.dispose(); }
}
export function scanPhaseEvents(
  scene: readonly SceneObject[], gridStepDeg = 1, atThetaDeg = 0, atOffset = 0
): ControlEvents {
  const s = new EventScanner(scene);
  try { return s.phaseEvents(atThetaDeg, atOffset, gridStepDeg); } finally { s.dispose(); }
}
