import type { CellGroup } from '@holotope/core';
import type { RepresentationHitReportN } from '@holotope/core';

/**
 * Turning one picked pixel into an honest statement about the source.
 *
 * A representation map from R4 to R3 is generally many-to-one, so a pick
 * answers two independent questions that are easy to conflate. *Which* source
 * primitive produced this pixel is structural, and the render product knows it
 * exactly. *Where in R4* the observation lands is a separate question the
 * projection may simply not determine — several R4 points can project to the
 * same pixel of the same triangle.
 *
 * This module keeps those apart. It is pure: it interprets a hit description
 * that someone else obtained, and returns plain data. No renderer, no DOM.
 */

/** A source-linked reading of one pick. */
export interface SheetSelection {
  /** Structural kind of the picked source primitive. */
  readonly sourceKind: string;
  /** Source 2-cell that generated the picked triangle, when it is a cell. */
  readonly sourceCellIndex: number | null;
  /** Source vertices of that cell, so both views can highlight the same one. */
  readonly sourceVertices: readonly number[];
  /** Reduction kinds that produced this representation, outermost first. */
  readonly lineage: readonly string[];
  /** What may be said about an ambient R4 point. */
  readonly claim: string;
  /** Why the ambient point is under-determined, when it is. */
  readonly ambiguity: string | null;
  /**
   * Whether naming one exact R4 point is justified.
   *
   * True only for a `'unique'` claim. Every other claim means the observation
   * identifies a primitive without pinning a point on it.
   */
  readonly exactPointJustified: boolean;
  /** A sentence a non-expert can read without being misled. */
  readonly sentence: string;
}

/** Source vertex indices of one cell in a group, for cross-view highlighting. */
export function cellVertices(
  group: CellGroup,
  cellIndex: number
): readonly number[] {
  const per = group.verticesPerCell;
  const count = group.indices.length / per;
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= count) {
    return [];
  }
  return Array.from(group.indices.slice(cellIndex * per, (cellIndex + 1) * per));
}

/**
 * Plain-language reading of one claim/ambiguity combination.
 *
 * The `'unique'` branch is the only one allowed to speak of a single R4 point.
 * Everything else names the triangle and says plainly that the point is not
 * determined, because the alternative — quietly reporting the first ray hit as
 * though it were the material point — is the misreading this whole vocabulary
 * exists to prevent.
 */
function describe(
  claim: string,
  ambiguity: string | null,
  cellIndex: number | null
): string {
  const triangle = cellIndex === null
    ? 'this source triangle'
    : `source triangle ${cellIndex}`;
  switch (claim) {
    case 'unique':
      return `This view determines one R4 point on ${triangle}. The map is ` +
        'invertible here, so the point is justified.';
    case 'on-selected-primitive':
      return ambiguity === 'projection-overlap'
        ? `The pick names ${triangle} exactly, but several R4 points project ` +
          'to this pixel, so no single R4 point is justified.'
        : `The pick names ${triangle} exactly. The R4 point is not determined ` +
          `(${ambiguity ?? 'ambiguous'}).`;
    case 'approximate':
      return `The pick names ${triangle}. Its R4 point is approximate ` +
        `(${ambiguity ?? 'ambiguous'}), not exact.`;
    case 'unavailable':
      return `The pick names ${triangle}. This representation offers no R4 ` +
        'point at all.';
    default:
      return `The pick names ${triangle}. Its R4 point is not determined.`;
  }
}

/**
 * Reads one hit description as a source-linked selection.
 *
 * @param report - The description of a hit already obtained from a render
 * product.
 * @param group - The source cell group the picked complex was drawn from,
 * used to recover the cell's vertices for cross-view highlighting.
 * @returns A plain-data selection whose sentence never claims a unique R4
 * point unless the report does.
 *
 * @example
 * ```ts
 * const selection = readSheetSelection(
 *   describeRepresentationHitN(hit), sheetGroup
 * );
 * log(selection.sourceCellIndex);        // which triangle
 * log(selection.exactPointJustified);    // false for a perspective overlap
 * log(selection.sentence);               // safe to show a reader
 * ```
 */
export function readSheetSelection(
  report: RepresentationHitReportN,
  group: CellGroup
): SheetSelection {
  const source = report.source;
  const cellIndex = source.kind === 'cell' ? source.cellIndex : null;
  const ambient = report.ambient;
  const ambiguity = ambient.claim === 'unique'
    ? null
    : (ambient.ambiguity as string | undefined) ?? null;
  return {
    sourceKind: source.kind,
    sourceCellIndex: cellIndex,
    sourceVertices: cellIndex === null ? [] : cellVertices(group, cellIndex),
    lineage: [...report.lineageKinds],
    claim: ambient.claim,
    ambiguity,
    exactPointJustified: ambient.claim === 'unique',
    sentence: describe(ambient.claim, ambiguity, cellIndex)
  };
}
