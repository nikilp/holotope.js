import { inspectSourceCellReferenceN } from './source-reference.js';
import type { RepresentationHitN, RepresentationSourceN } from './types.js';
import type { FieldEvaluation4 } from '../field/types.js';

/**
 * How many distinct sources one observation names.
 *
 * This is a different question from {@link RepresentationAmbiguity}, which says
 * whether a hit names more than one source *point* under the display map. A
 * manipulation does not act on a point; it acts on a source. The two are
 * independent, and all four combinations occur:
 *
 * | display map | coincident sources | point ambiguity | target multiplicity |
 * | --- | --- | --- | --- |
 * | injective section | one | `none` | `unique` |
 * | lossy projection | one | `projection-overlap` | `unique` |
 * | injective section | two | `none` | `multiple` |
 * | lossy projection | two | `projection-overlap` | `multiple` |
 *
 * The third row is the one that costs a caller something: the point really is
 * unique, so `ambiguity: 'none'` is truthful, and two source cells are still
 * candidates for the action.
 */
export type RepresentationTargetMultiplicity = 'none' | 'unique' | 'multiple';

/**
 * One manipulation target, and every supplied hit that named it.
 *
 * `hits` keeps all of them, including hits that disagree about
 * `ambientPointStatus` or land on different rendered primitives: those are
 * different observations *of one source*, not different sources.
 */
export interface RepresentationCandidateN<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> {
  /** The source this candidate names, taken from its first supplied hit. */
  readonly source: RepresentationSourceN<Evaluation>;
  /** Every supplied hit that resolved to this source, in encounter order. */
  readonly hits: readonly RepresentationHitN<Evaluation>[];
  /** How many hits were grouped here. Never a primitive or intersection count. */
  readonly hitCount: number;
}

/**
 * The observation was empty: no hits were supplied at all.
 *
 * This arm means exactly that, and `hitCount === 0` is true by construction. A
 * hit whose source cannot be identified never lands here — it throws, so a
 * partially-understood observation can never be narrowed to a target.
 */
export interface NoRepresentationCandidatesN<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> {
  /** Narrows a {@link RepresentationCandidateSetN} to the empty observation. */
  readonly targetMultiplicity: 'none';
  /** Empty, so a caller iterating candidates needs no special case here. */
  readonly candidates: readonly [];
  /** How many hits were supplied. Zero here by construction. */
  readonly hitCount: 0;
  /** How many distinct sources were named. Zero here by construction. */
  readonly candidateCount: 0;
}

/** Exactly one source was named; a caller may act on it without asking. */
export interface UniqueRepresentationCandidateN<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> {
  /** Narrows a {@link RepresentationCandidateSetN} to a single named source. */
  readonly targetMultiplicity: 'unique';
  /** The one source named, reachable without indexing into a list. */
  readonly candidate: RepresentationCandidateN<Evaluation>;
  /** The same candidate as a one-element list, for uniform iteration. */
  readonly candidates: readonly [RepresentationCandidateN<Evaluation>];
  /** Total hits supplied, which may exceed one for a single source. */
  readonly hitCount: number;
  /** How many distinct sources were named. One here by construction. */
  readonly candidateCount: 1;
}

/** Several sources were named; acting on one of them is the caller's choice. */
export interface MultipleRepresentationCandidatesN<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> {
  /** Narrows a {@link RepresentationCandidateSetN} to a contested observation. */
  readonly targetMultiplicity: 'multiple';
  /** Every named source, in the order its first hit arrived — and only that. */
  readonly candidates: readonly RepresentationCandidateN<Evaluation>[];
  /** Total hits supplied across every candidate. */
  readonly hitCount: number;
  /** How many distinct sources were named; at least two here. */
  readonly candidateCount: number;
}

/** What one observation names, discriminated on how many sources it found. */
export type RepresentationCandidateSetN<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
> =
  | NoRepresentationCandidatesN<Evaluation>
  | UniqueRepresentationCandidateN<Evaluation>
  | MultipleRepresentationCandidatesN<Evaluation>;

/**
 * Identity keys, built from live object references rather than from values.
 *
 * Objects are numbered on first sight and the number is used in the key, which
 * makes reference identity comparable as a string without ever comparing the
 * objects structurally. Two complexes that look identical get different
 * numbers, which is the entire point.
 */
class ObjectIdentity {
  private readonly seen = new Map<object, number>();

  of(value: object): number {
    const existing = this.seen.get(value);
    if (existing !== undefined) return existing;
    const next = this.seen.size;
    this.seen.set(value, next);
    return next;
  }
}

/**
 * The live identity of a hit's source.
 *
 * For a cell the identity is the `reference`: its complex object, its group
 * object, and the cell's ordinal within that group. Deliberately *not*
 * `SourceCellIdN` — that is structural identity for regeneration boundaries,
 * and two separately authored complexes produce byte-identical ids while being
 * two different things a caller can act on.
 *
 * A cell's reference is inspected before it can name a candidate. A retired
 * one throws rather than grouping: its ordinal still points somewhere, so a
 * stale snapshot would otherwise merge with whatever cell now occupies that
 * slot and be handed back as if it were live.
 *
 * The dispatch is exhaustive over {@link RepresentationSourceN}, and the
 * `never` binding at the end is load-bearing: adding a variant to that union
 * fails this file's compilation until the new variant's identity rule is
 * written, rather than silently falling through to a partial result.
 */
function identityOf(
  source: RepresentationSourceN,
  objects: ObjectIdentity
): string {
  switch (source.kind) {
    case 'cell': {
      const reference = source.reference;
      if (source.complex !== reference.complex) {
        throw new Error(
          'groupRepresentationCandidatesN: hit.source.complex and ' +
          'hit.source.reference.complex are different objects, so the hit does not ' +
          'name one live cell'
        );
      }
      const status = inspectSourceCellReferenceN(reference);
      if (status.kind === 'retired') {
        throw new Error(
          `groupRepresentationCandidatesN: source cell reference is retired ` +
          `(${status.reason}); it no longer names live topology and must not be ` +
          'grouped with the cell now at its ordinal'
        );
      }
      return `cell:${objects.of(reference.complex)}:${objects.of(reference.group)}:${reference.cellIndex}`;
    }
    case 'sample-cell':
      return `sample-cell:${objects.of(source.field)}:${source.cellIndex}`;
    case 'field-record':
      return `field-record:${objects.of(source.field)}:${objects.of(source.record)}`;
    default: {
      const exhaustive: never = source;
      throw new Error(
        'groupRepresentationCandidatesN: unsupported source kind ' +
        `${JSON.stringify((exhaustive as { kind?: unknown }).kind)}; every declared ` +
        'RepresentationSourceN variant has an identity rule, so this is a hit this ' +
        'version cannot classify'
      );
    }
  }
}

/**
 * Groups the hits of one visual observation into distinct manipulation targets.
 *
 * Hand it every {@link RepresentationHitN} produced for one observation — one
 * per renderer intersection, adapted by whichever released adapter matches the
 * product each intersection came from — and it reports whether that observation
 * names zero, one, or several sources.
 *
 * Grouping is by **live object identity**: for a cell, its complex object, its
 * group object, and its ordinal within that group. Two distinct complexes stay
 * two candidates even when their `SourceCellIdN` values are byte-identical,
 * which they are whenever two sources were authored the same way.
 *
 * Encounter order is preserved and means only that: the order the hits arrived
 * in. It is not nearest, preferred, authoritative, or a priority.
 *
 * **Fail-closed.** Every hit must resolve to an identity or the call throws.
 * There is no arm in which an unclassified hit sits beside a target a caller is
 * told is safe to act on, and `hitCount` always equals the sum of the
 * candidates' own counts. `'none'` means the input was empty, not that nothing
 * could be understood.
 *
 * **Retired topology is refused.** A cell's `SourceCellReferenceN` is inspected
 * before it may name a candidate; a retired one throws with its reason. This is
 * a topology check the reference already supports, not a freshness check: a
 * hit's pose and ambient point may still be out of date and nothing here
 * detects that.
 *
 * **Structural immutability.** The result, its candidates array, each candidate
 * record and each candidate's hits array are frozen, so the grouping's own
 * structure and counts cannot drift. The hits, sources, complexes, fields and
 * evaluation records reached through them are caller-owned and are left exactly
 * as they arrived.
 *
 * **What this does not do.** It groups the hits it is given and nothing else.
 * It cannot discover an intersection a renderer or caller left out; it does not
 * map a renderer intersection back to the product that drew it; it does not
 * decide which candidate is nearest or preferred; it does not detect whether a
 * hit's pose or ambient point has since gone stale; it keeps no clock, version,
 * registry or persistent state; and it does not make `SourceCellIdN` globally
 * unique. It also never modifies or reinterprets a hit's point-level
 * `ambiguity`, which continues to answer its own separate question.
 *
 * @param hits - Every hit produced for one observation, in encounter order.
 *
 * @example
 * ```ts
 * // Pass every hit for one observation — one per renderer intersection,
 * // each adapted first. Taking `intersections[0]` discards the rest.
 * const grouped = groupRepresentationCandidatesN([]);
 * if (grouped.targetMultiplicity === 'unique') {
 *   grouped.candidate.source; // one source named: safe to act on
 * } else if (grouped.targetMultiplicity === 'multiple') {
 *   grouped.candidates.length; // several named: the caller chooses
 * }
 * // Point-level ambiguity is a separate reading, and is left untouched.
 * grouped.candidates[0]?.hits[0]?.ambiguity;
 * ```
 */
export function groupRepresentationCandidatesN<
  Evaluation extends FieldEvaluation4 = FieldEvaluation4
>(
  hits: readonly RepresentationHitN<Evaluation>[]
): RepresentationCandidateSetN<Evaluation> {
  const objects = new ObjectIdentity();
  const byIdentity = new Map<string, RepresentationHitN<Evaluation>[]>();
  const order: string[] = [];

  for (const hit of hits) {
    // Throws rather than setting the hit aside. A result that omitted a hit
    // could still be narrowed to `unique`, and "unique among the hits I
    // understood" is not a safe thing to act on.
    const identity = identityOf(hit.source, objects);
    const existing = byIdentity.get(identity);
    if (existing === undefined) {
      byIdentity.set(identity, [hit]);
      order.push(identity);
    } else {
      existing.push(hit);
    }
  }

  const candidates = order.map((identity): RepresentationCandidateN<Evaluation> => {
    const grouped = byIdentity.get(identity)!;
    // Each record is frozen, and so is its hits array: the grouping's own
    // structure and counts cannot drift. The hits and sources inside stay
    // caller-owned and are deliberately left alone.
    return Object.freeze({
      // The source of the first hit that named this candidate. Later hits
      // named the same live cell, so any of them would do.
      source: grouped[0]!.source,
      hits: Object.freeze(grouped.slice()),
      hitCount: grouped.length
    });
  });

  const hitCount = hits.length;
  if (candidates.length === 0) {
    return Object.freeze({
      targetMultiplicity: 'none',
      candidates: Object.freeze([]) as readonly [],
      hitCount: 0,
      candidateCount: 0
    }) satisfies NoRepresentationCandidatesN<Evaluation>;
  }
  if (candidates.length === 1) {
    return Object.freeze({
      targetMultiplicity: 'unique',
      candidate: candidates[0]!,
      candidates: Object.freeze([candidates[0]!]) as readonly [
        RepresentationCandidateN<Evaluation>
      ],
      hitCount,
      candidateCount: 1
    }) satisfies UniqueRepresentationCandidateN<Evaluation>;
  }
  return Object.freeze({
    targetMultiplicity: 'multiple',
    candidates: Object.freeze(candidates),
    hitCount,
    candidateCount: candidates.length
  }) satisfies MultipleRepresentationCandidatesN<Evaluation>;
}
