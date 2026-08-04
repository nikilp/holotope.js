import type { CellComplex } from '@holotope/core';
import type { SheetStepReport } from './scene.js';

/**
 * A recording of applied steps, so a run can be scrubbed after it has been paid
 * for.
 *
 * The scene costs far more per step than a frame does to draw, which makes
 * watching it live the most expensive possible way to look at it. Recording the
 * source positions as they are produced turns a one-shot animation into
 * something a reader can go back through at their own pace.
 *
 * What is stored is the **source** configuration — the R4 positions the solver
 * produced — and the report produced alongside them. Both views are derived
 * from that source, so restoring it restores the whole page: neither projection
 * is recorded, and neither can drift from what actually happened.
 *
 * Nothing here re-solves anything, and nothing here is ever handed back to the
 * solver. A recording is stored at single precision, which is ample to look at
 * and *not* the state the solver must resume from — so reviewing a frame holds
 * the exact live configuration aside and {@link SheetReplay.endReview} puts it
 * back untouched. That is why showing a frame and resuming a run cannot be the
 * same operation.
 */

/** Positions are stored at single precision; the solver keeps working in double. */
const BYTES_PER_COORDINATE = 4;

/**
 * How much a recording may hold.
 *
 * Chosen so the default sheet records far past the step where it stops being
 * interesting, and the finest one still covers a full run: at 24×24 this is
 * about 3,500 steps, and the scene refuses well before that.
 */
const BUDGET_BYTES = 32 * 1024 * 1024;

/** A growing recording bound to one sheet. */
export interface SheetReplay {
  /** Applied steps held. */
  readonly length: number;
  /** True once the budget stopped it accepting frames. */
  readonly truncated: boolean;
  /** Most frames this recording will ever hold. */
  readonly capacity: number;
  /** Whether the source currently shows a recorded frame rather than live state. */
  readonly reviewing: boolean;
  /** Stores the configuration as it stands. Ignored once full. */
  record(report: SheetStepReport): void;
  /**
   * Writes a recorded configuration onto the source for viewing.
   *
   * The first call holds the exact live configuration aside; every call after
   * it replaces only what is on display. Always pair with
   * {@link SheetReplay.endReview} before stepping again.
   *
   * @param frame - One-based applied step.
   * @returns The report recorded with that step.
   */
  review(frame: number): SheetStepReport;
  /** Puts the exact live configuration back. Harmless when not reviewing. */
  endReview(): void;
}

/**
 * Starts a recording of a sheet's applied steps.
 *
 * @param sheet - The source complex whose positions are recorded and restored.
 * @returns A recording that grows until its byte budget is reached.
 *
 * @example
 * ```ts
 * const replay = createSheetReplay(scene.sheet);
 * const report = stepSheetScene(scene);
 * if (report.status === 'applied') replay.record(report);
 *
 * replay.review(12);   // the sheet now shows step 12
 * replay.endReview();  // and is back to exactly where the solver left it
 * ```
 */
export function createSheetReplay(sheet: CellComplex): SheetReplay {
  const stride = sheet.positions.length;
  const capacity = Math.max(
    1, Math.floor(BUDGET_BYTES / (stride * BYTES_PER_COORDINATE))
  );
  const positions: Float32Array[] = [];
  const reports: SheetStepReport[] = [];
  /** The exact configuration the solver last left, while a frame is on display. */
  let live: Float64Array | null = null;

  return {
    get length() { return positions.length; },
    get truncated() { return positions.length >= capacity; },
    capacity,
    get reviewing() { return live !== null; },
    record(report) {
      if (positions.length >= capacity) return;
      const frame = new Float32Array(stride);
      frame.set(sheet.positions);
      positions.push(frame);
      reports.push(report);
    },
    review(frame) {
      const stored = positions[frame - 1];
      const report = reports[frame - 1];
      if (stored === undefined || report === undefined) {
        throw new RangeError(
          `createSheetReplay: frame ${frame} is outside 1..${positions.length}`
        );
      }
      // Taken once, before anything is overwritten. Taking it again mid-review
      // would save a recorded frame as though it were the live state.
      if (live === null) live = Float64Array.from(sheet.positions);
      sheet.positions.set(stored);
      return report;
    },
    endReview() {
      if (live === null) return;
      sheet.positions.set(live);
      live = null;
    }
  };
}
