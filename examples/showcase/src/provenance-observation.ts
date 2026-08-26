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
