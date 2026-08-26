import {
  type MultipleRepresentationCandidatesN,
  type NoRepresentationCandidatesN,
  type RepresentationCandidateN,
  type RepresentationCandidateSetN,
  type RepresentationHitN,
  type RepresentationTargetMultiplicity,
  type UniqueRepresentationCandidateN,
  groupRepresentationCandidatesN
} from '@holotope/core';

/**
 * What one pick becomes on screen, decided away from the DOM so the decision
 * can be tested rather than inferred from the page.
 *
 * The page is a thin shell over this: it highlights `highlightHit` — clearing
 * the highlight when that is `null` — and prints `rows`. Every branch that is
 * not a single named source resolves to `null`, so "present the candidates and
 * choose none" is a property of this function rather than a habit of the
 * caller.
 */
export interface ObservationPresentation {
  /** How many sources the observation named, or why it named none. */
  readonly outcome: 'empty' | 'incomplete' | 'refused' | 'unique' | 'multiple';
  /** The hit to highlight, or `null` to clear. Non-null only for `unique`. */
  readonly highlightHit: RepresentationHitN | null;
  /** Label/value rows to print, in order. */
  readonly rows: readonly (readonly [string, string])[];
}

/** How the page words each multiplicity, written against the discriminated arms. */
export function targetSummary(
  grouped: RepresentationCandidateSetN
): { readonly multiplicity: RepresentationTargetMultiplicity; readonly text: string } {
  switch (grouped.targetMultiplicity) {
    case 'none': {
      const empty: NoRepresentationCandidatesN = grouped;
      return { multiplicity: empty.targetMultiplicity, text: 'nothing observed' };
    }
    case 'unique': {
      const one: UniqueRepresentationCandidateN = grouped;
      return {
        multiplicity: one.targetMultiplicity,
        text: 'unique · this observation names one source'
      };
    }
    case 'multiple': {
      const many: MultipleRepresentationCandidatesN = grouped;
      return {
        multiplicity: many.targetMultiplicity,
        text: `multiple · ${many.candidateCount} sources from ${many.hitCount} hits — choose one`
      };
    }
  }
}

/**
 * The page's own description of one hit's source record.
 *
 * Pure: it returns rows and touches no DOM, so the whole observation can be
 * painted by a single render. Splitting it out is the correction — it used to
 * paint directly, and the handler's own render then cleared it.
 *
 * Rows are `[label, value]` here, matching {@link ObservationPresentation}; they
 * are put into `reportCounts` order once, in {@link observationRows}.
 */
export function descriptionRows(
  hit: RepresentationHitN
): readonly (readonly [string, string])[] {
  const rows: (readonly [string, string])[] = [
    ['representation', hit.representation],
    ['source kind', hit.source.kind]
  ];
  // The source record is the answer a projection's coordinates cannot give.
  // Narrowed on `kind` rather than cast, so a wrong field name fails to
  // compile instead of silently reporting nothing.
  if (hit.source.kind === 'cell') {
    rows.push(['source cell index', String(hit.source.cellIndex)]);
    rows.push(['source cell dimension', String(hit.source.intrinsicDim)]);
    rows.push(['source vertices', hit.source.vertexIndices.join(', ')]);
  }
  rows.push(['ambient point', hit.ambientPointStatus]);
  if (hit.ambientPoint) {
    rows.push(['in R⁴', [...hit.ambientPoint.data].map((v) => v.toFixed(2)).join(', ')]);
  }
  rows.push(['ambiguity', hit.ambiguity]);
  return rows;
}

/**
 * Everything one observation paints, as a single collection.
 *
 * The page calls `reportCounts` exactly once with this. Painting in two calls
 * is what broke: `reportCounts` replaces the container's children, so a second
 * call erases the first.
 *
 * Provenance rows are appended when, and only when, a unique target was named —
 * the same condition that allows a highlight. Rows come back in `reportCounts`
 * order, `[value, label]`, which renders the value prominently and the label
 * after it.
 */
export function observationRows(
  presentation: ObservationPresentation,
  instruction: string
): readonly (readonly [number | string, string])[] {
  if (presentation.outcome === 'empty') return [[instruction, '']];
  const flipped = presentation.rows.map(
    ([label, value]): readonly [number | string, string] => [value, label]
  );
  if (presentation.highlightHit === null) return flipped;
  return [
    ...flipped,
    ...descriptionRows(presentation.highlightHit).map(
      ([label, value]): readonly [number | string, string] => [value, label]
    )
  ];
}

/** An encounter-local label. Position in this list, never a persistent identity. */
function label(candidate: RepresentationCandidateN, index: number): readonly [string, string] {
  const source = candidate.hits[0]!.source;
  const detail = source.kind === 'cell'
    ? `group "${source.reference.group.key ?? source.reference.groupIndexAtCreation}" ` +
      `cell ${source.reference.cellIndex}`
    : source.kind;
  return [
    `candidate #${index + 1}`,
    `source #${index + 1} · ${detail} · ${candidate.hitCount} hit(s)`
  ];
}

/**
 * Decides what an observation becomes, all-or-nothing.
 *
 * @param adapted - Hits successfully adapted from renderer intersections.
 * @param intersectionCount - How many intersections the renderer reported.
 * @param refusal - The adapter's message if any intersection refused.
 *
 * Adaptation is all-or-nothing on purpose: a partially adapted observation
 * describes less than the renderer saw, and a target derived from it could be
 * unique only among the intersections that happened to work. That is reported
 * as incomplete and nothing is acted on.
 */
export function presentObservation(
  adapted: readonly RepresentationHitN[],
  intersectionCount: number,
  refusal = ''
): ObservationPresentation {
  if (intersectionCount === 0) {
    return { outcome: 'empty', highlightHit: null, rows: [] };
  }
  if (refusal !== '' || adapted.length !== intersectionCount) {
    return {
      outcome: 'incomplete',
      highlightHit: null,
      rows: [
        ['observation', `incomplete · ${adapted.length} of ${intersectionCount} ` +
          'intersections adapted, so no target is named'],
        ['refused', refusal || 'an intersection could not be adapted']
      ]
    };
  }

  let grouped: RepresentationCandidateSetN;
  try {
    grouped = groupRepresentationCandidatesN(adapted);
  } catch (error) {
    // The grouping fails closed: an unclassifiable source, or a reference whose
    // topology has been retired. Neither is something to act on.
    return {
      outcome: 'refused',
      highlightHit: null,
      rows: [
        ['observation', 'refused · the hits do not name live sources'],
        ['refused', String(error instanceof Error ? error.message : error)]
      ]
    };
  }

  // Point ambiguity is reported on its own line: it answers whether the source
  // *point* is unique under the display map, which is a different question from
  // how many sources could be acted on.
  const pointReading: readonly [string, string] =
    ['point ambiguity', adapted[0]?.ambiguity ?? 'none'];

  if (grouped.targetMultiplicity === 'unique') {
    return {
      outcome: 'unique',
      highlightHit: grouped.candidate.hits[0]!,
      rows: [['target', targetSummary(grouped).text], pointReading]
    };
  }
  if (grouped.targetMultiplicity === 'none') {
    return { outcome: 'empty', highlightHit: null, rows: [] };
  }
  return {
    outcome: 'multiple',
    // Nothing is highlighted and nothing is described: this page presents the
    // candidates and selects none of them.
    highlightHit: null,
    rows: [
      ['target', targetSummary(grouped).text],
      ...grouped.candidates.map(label),
      ['choice', 'none made · this page presents candidates and selects none'],
      pointReading
    ]
  };
}
