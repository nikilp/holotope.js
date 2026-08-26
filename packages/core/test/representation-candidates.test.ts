import { describe, expect, it } from 'vitest';
import { CellComplex } from '../src/geometry/cell-complex.js';
import { VecN } from '../src/math/vecn.js';
import {
  createRepresentationLineageN,
  createSourceCellIdN,
  createSourceCellReferenceN,
  groupRepresentationCandidatesN,
  inspectSourceCellReferenceN,
  type RepresentationAmbiguity,
  type RepresentationHitN
} from '../src/index.js';

/**
 * Grouping the hits of one observation into manipulation targets.
 *
 * The hits here are built directly rather than raycast, because these are unit
 * tests of the grouping rule. The rule itself is exercised end-to-end against
 * real Three.js intersections in `examples/showcase/test`, where nothing about
 * a hit is written by hand.
 */

/** One triangle, authored the same way every time. */
function triangleComplex(): CellComplex {
  return new CellComplex(4, Float64Array.from([
    -1, -1, 0, 0, 1, -1, 0, 0, 0, 1, 0, 0,
    -1, -1, 0, 1, 1, -1, 0, 1, 0, 1, 0, 1
  ]), [
    { key: 'faces', dim: 2, verticesPerCell: 3, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 2, 3, 4, 5]) }
  ]);
}

function cellHit(
  complex: CellComplex,
  cellIndex: number,
  overrides: Partial<RepresentationHitN> = {}
): RepresentationHitN {
  const group = complex.groups[0]!;
  const reference = createSourceCellReferenceN(complex, group, cellIndex);
  return {
    representation: 'projected-surface',
    point3: [0, 0, 0],
    ambientDim: 4,
    ambientPointStatus: 'exact',
    ambientPoint: new VecN([0, 0, 0, cellIndex]),
    ambiguity: 'projection-overlap',
    lineage: createRepresentationLineageN(4, []),
    source: {
      kind: 'cell',
      complex,
      intrinsicDim: 2,
      cellIndex,
      vertexIndices: [cellIndex * 3, cellIndex * 3 + 1, cellIndex * 3 + 2],
      reference,
      id: createSourceCellIdN(reference)
    },
    ...overrides
  } as RepresentationHitN;
}

describe('groupRepresentationCandidatesN', () => {
  it('reports none for an observation that named nothing', () => {
    const grouped = groupRepresentationCandidatesN([]);
    expect(grouped.targetMultiplicity).toBe('none');
    expect(grouped.candidateCount).toBe(0);
    expect(grouped.hitCount).toBe(0);
    expect(grouped.candidates).toHaveLength(0);
  });

  it('reports unique for one source, and exposes it without a choice', () => {
    const complex = triangleComplex();
    const grouped = groupRepresentationCandidatesN([cellHit(complex, 0)]);
    expect(grouped.targetMultiplicity).toBe('unique');
    if (grouped.targetMultiplicity !== 'unique') return;
    expect(grouped.candidateCount).toBe(1);
    expect(grouped.hitCount).toBe(1);
    expect(grouped.candidate.hitCount).toBe(1);
    expect(grouped.candidate.source.kind).toBe('cell');
  });

  it('reports multiple for two live cells of one complex', () => {
    const complex = triangleComplex();
    const grouped = groupRepresentationCandidatesN([
      cellHit(complex, 0), cellHit(complex, 1)
    ]);
    expect(grouped.targetMultiplicity).toBe('multiple');
    expect(grouped.candidateCount).toBe(2);
    expect(grouped.hitCount).toBe(2);
  });

  it('FALSIFIER: two equal-looking source objects are not one candidate', () => {
    // The load-bearing control. Both complexes are authored identically, so
    // their SourceCellIdN values are byte-identical — grouping on that id, or
    // on structural equality of the complexes, would merge two distinct things
    // a caller can act on.
    const first = triangleComplex();
    const second = triangleComplex();
    const hitA = cellHit(first, 0);
    const hitB = cellHit(second, 0);
    const idA = hitA.source.kind === 'cell' ? JSON.stringify(hitA.source.id) : 'a';
    const idB = hitB.source.kind === 'cell' ? JSON.stringify(hitB.source.id) : 'b';
    expect(idA).toBe(idB);
    expect(first).not.toBe(second);

    const grouped = groupRepresentationCandidatesN([hitA, hitB]);
    expect(grouped.targetMultiplicity).toBe('multiple');
    expect(grouped.candidateCount).toBe(2);
  });

  it('FALSIFIER: grouping does not collapse to the first hit', () => {
    const complex = triangleComplex();
    const grouped = groupRepresentationCandidatesN([
      cellHit(complex, 0), cellHit(complex, 1)
    ]);
    // Collapsing to hits[0] would report a unique target and lose the second.
    expect(grouped.targetMultiplicity).not.toBe('unique');
    expect(grouped.candidates.map((c) => c.hitCount)).toEqual([1, 1]);
  });

  it('FALSIFIER: duplicate hits on one cell collapse but are not lost', () => {
    const complex = triangleComplex();
    const grouped = groupRepresentationCandidatesN([
      cellHit(complex, 0),
      cellHit(complex, 0, { ambientPointStatus: 'approximate' }),
      cellHit(complex, 0, { point3: [1, 2, 3] })
    ]);
    expect(grouped.targetMultiplicity).toBe('unique');
    if (grouped.targetMultiplicity !== 'unique') return;
    expect(grouped.candidateCount).toBe(1);
    // Every hit is retained: the count of hits is not the count of candidates.
    expect(grouped.hitCount).toBe(3);
    expect(grouped.candidate.hitCount).toBe(3);
    expect(grouped.candidate.hits).toHaveLength(3);
    expect(grouped.candidate.hits[2]!.point3).toEqual([1, 2, 3]);
  });

  it('groups hits that disagree about ambient-point status', () => {
    // Different observations of one source, not different sources.
    const complex = triangleComplex();
    const grouped = groupRepresentationCandidatesN([
      cellHit(complex, 0, { ambientPointStatus: 'exact' }),
      cellHit(complex, 0, { ambientPointStatus: 'unavailable' })
    ]);
    expect(grouped.targetMultiplicity).toBe('unique');
    expect(new Set(grouped.candidates[0]!.hits.map((h) => h.ambientPointStatus)).size)
      .toBe(2);
  });

  it('FALSIFIER: point ambiguity does not determine target multiplicity', () => {
    const complex = triangleComplex();
    const other = triangleComplex();
    const cases: [RepresentationAmbiguity, RepresentationHitN[], string, number][] = [
      // 'none' must not force one candidate.
      ['none', [cellHit(complex, 0, { ambiguity: 'none' }),
        cellHit(other, 0, { ambiguity: 'none' })], 'multiple', 2],
      // 'projection-overlap' must not force several.
      ['projection-overlap', [cellHit(complex, 0, { ambiguity: 'projection-overlap' })],
        'unique', 1],
      ['none', [cellHit(complex, 0, { ambiguity: 'none' })], 'unique', 1],
      ['projection-overlap', [cellHit(complex, 0, { ambiguity: 'projection-overlap' }),
        cellHit(other, 0, { ambiguity: 'projection-overlap' })], 'multiple', 2]
    ];
    for (const [ambiguity, hits, expected, count] of cases) {
      const grouped = groupRepresentationCandidatesN(hits);
      expect(grouped.targetMultiplicity, `${ambiguity} -> ${expected}`).toBe(expected);
      expect(grouped.candidateCount).toBe(count);
    }
  });

  it('never modifies or reinterprets a hit’s point-level ambiguity', () => {
    const complex = triangleComplex();
    const hit = cellHit(complex, 0, { ambiguity: 'first-ray-hit' });
    const grouped = groupRepresentationCandidatesN([hit]);
    expect(grouped.candidates[0]!.hits[0]).toBe(hit);
    expect(grouped.candidates[0]!.hits[0]!.ambiguity).toBe('first-ray-hit');
    expect(hit.ambiguity).toBe('first-ray-hit');
  });

  it('preserves encounter order and claims nothing more for it', () => {
    const complex = triangleComplex();
    const forward = groupRepresentationCandidatesN([
      cellHit(complex, 0), cellHit(complex, 1)
    ]);
    const backward = groupRepresentationCandidatesN([
      cellHit(complex, 1), cellHit(complex, 0)
    ]);
    const ordinals = (set: typeof forward): number[] =>
      set.candidates.map((c) =>
        c.source.kind === 'cell' ? c.source.reference.cellIndex : -1);
    expect(ordinals(forward)).toEqual([0, 1]);
    expect(ordinals(backward)).toEqual([1, 0]);
  });

  it('separates cells of different groups within one complex', () => {
    const complex = new CellComplex(4, Float64Array.from([
      -1, -1, 0, 0, 1, -1, 0, 0, 0, 1, 0, 0
    ]), [
      { key: 'a', dim: 2, verticesPerCell: 3, kind: 'simplex',
        indices: Uint32Array.from([0, 1, 2]) },
      { key: 'b', dim: 2, verticesPerCell: 3, kind: 'simplex',
        indices: Uint32Array.from([0, 1, 2]) }
    ]);
    const hitOf = (groupIndex: number): RepresentationHitN => {
      const group = complex.groups[groupIndex]!;
      const reference = createSourceCellReferenceN(complex, group, 0);
      return {
        representation: 'projected-surface', point3: [0, 0, 0], ambientDim: 4,
        ambientPointStatus: 'unavailable', ambiguity: 'projection-overlap',
        lineage: createRepresentationLineageN(4, []),
        source: { kind: 'cell', complex, intrinsicDim: 2, cellIndex: 0,
          vertexIndices: [0, 1, 2], reference, id: createSourceCellIdN(reference) }
      } as RepresentationHitN;
    };
    const grouped = groupRepresentationCandidatesN([hitOf(0), hitOf(1)]);
    // Same complex, same ordinal, different live group: two targets.
    expect(grouped.targetMultiplicity).toBe('multiple');
    expect(grouped.candidateCount).toBe(2);
  });

  it('FALSIFIER: an unclassifiable hit throws instead of being set aside', () => {
    // Both shapes of the old defect. Alone it reported an empty observation
    // with a hitCount of zero; beside a real hit it reported a unique target a
    // caller was told was safe to act on, while one hit had never been
    // classified at all.
    const alien = { source: { kind: 'not-a-real-kind' } } as unknown as RepresentationHitN;
    expect(() => groupRepresentationCandidatesN([alien]))
      .toThrow(/unsupported source kind/);
    const complex = triangleComplex();
    expect(() => groupRepresentationCandidatesN([cellHit(complex, 0), alien]))
      .toThrow(/unsupported source kind/);
  });

  it('reconciles counts: input hits equal the sum of candidate hit counts', () => {
    const complex = triangleComplex();
    const other = triangleComplex();
    for (const hits of [
      [cellHit(complex, 0)],
      [cellHit(complex, 0), cellHit(complex, 0)],
      [cellHit(complex, 0), cellHit(complex, 1)],
      [cellHit(complex, 0), cellHit(other, 0), cellHit(complex, 0)]
    ]) {
      const grouped = groupRepresentationCandidatesN(hits);
      const summed = grouped.candidates.reduce((total, c) => total + c.hitCount, 0);
      expect(grouped.hitCount, `${hits.length} hits`).toBe(hits.length);
      expect(summed, `${hits.length} hits`).toBe(hits.length);
    }
    // And 'none' now means the input was genuinely empty.
    const empty = groupRepresentationCandidatesN([]);
    expect(empty.targetMultiplicity).toBe('none');
    expect(empty.hitCount).toBe(0);
  });

  it('FALSIFIER: a candidate record cannot be reassigned', () => {
    const complex = triangleComplex();
    const grouped = groupRepresentationCandidatesN([cellHit(complex, 0)]);
    const candidate = grouped.candidates[0]!;
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.hits)).toBe(true);
    // Non-strict assignment leaves the value unchanged; strict mode throws.
    const loose = candidate as { hitCount: number; source: unknown; hits: unknown };
    expect(() => { loose.hitCount = 99; }).toThrow();
    expect(() => { loose.source = { kind: 'replaced' }; }).toThrow();
    expect(() => { loose.hits = []; }).toThrow();
    expect(candidate.hitCount).toBe(1);
    expect(candidate.source.kind).toBe('cell');
  });

  it('leaves caller-owned hits and sources unfrozen', () => {
    // Shallow by design: the grouping's structure is fixed, the objects it
    // retains stay the caller's to mutate.
    const complex = triangleComplex();
    const hit = cellHit(complex, 0);
    const grouped = groupRepresentationCandidatesN([hit]);
    expect(Object.isFrozen(hit)).toBe(false);
    expect(Object.isFrozen(grouped.candidates[0]!.source)).toBe(false);
    expect(Object.isFrozen(complex)).toBe(false);
    expect(grouped.candidates[0]!.hits[0]).toBe(hit);
  });

  it('FALSIFIER: a retired reference refuses rather than merging with the live cell', () => {
    const complex = triangleComplex();
    const stale = cellHit(complex, 0);
    // Retire it by rewriting the cell's vertex tuple in place. The ordinal
    // still points somewhere, which is exactly what made the merge possible.
    complex.groups[0]!.indices[0] = 2;
    complex.groups[0]!.indices[2] = 0;
    const staleReference = stale.source.kind === 'cell' ? stale.source.reference : null;
    expect(inspectSourceCellReferenceN(staleReference!).kind).toBe('retired');

    const fresh = cellHit(complex, 0);
    expect(() => groupRepresentationCandidatesN([stale, fresh]))
      .toThrow(/retired \(cell-vertices-changed\)/);
    // The live one alone still groups.
    expect(groupRepresentationCandidatesN([fresh]).targetMultiplicity).toBe('unique');
  });

  it('groups two separately-created current references to the same live cell', () => {
    // Validation must not turn every fresh snapshot into its own candidate.
    const complex = triangleComplex();
    const first = cellHit(complex, 0);
    const second = cellHit(complex, 0);
    const referenceOf = (hit: RepresentationHitN) =>
      hit.source.kind === 'cell' ? hit.source.reference : null;
    expect(referenceOf(first)).not.toBe(referenceOf(second));
    const grouped = groupRepresentationCandidatesN([first, second]);
    expect(grouped.targetMultiplicity).toBe('unique');
    expect(grouped.candidateCount).toBe(1);
    expect(grouped.hitCount).toBe(2);
  });

  it('refuses a hit whose source complex and reference complex disagree', () => {
    const complex = triangleComplex();
    const other = triangleComplex();
    const hit = cellHit(complex, 0);
    const mismatched = {
      ...hit,
      source: { ...(hit.source as object), complex: other }
    } as RepresentationHitN;
    expect(() => groupRepresentationCandidatesN([mismatched]))
      .toThrow(/different objects/);
  });

  it('groups all three supported source variants', () => {
    const complex = triangleComplex();
    const fieldA = { name: 'a' } as unknown as never;
    const fieldB = { name: 'b' } as unknown as never;
    const record = { value: 1 } as unknown as never;
    const base = cellHit(complex, 0);
    const sampleHit = (field: never, cellIndex: number): RepresentationHitN =>
      ({ ...base, source: { kind: 'sample-cell', field, cellIndex } } as RepresentationHitN);
    const recordHit = (field: never, evaluation: never): RepresentationHitN =>
      ({ ...base, source: { kind: 'field-record', field, record: evaluation } } as RepresentationHitN);

    // Same field, same cell ordinal: one candidate.
    expect(groupRepresentationCandidatesN([sampleHit(fieldA, 3), sampleHit(fieldA, 3)])
      .candidateCount).toBe(1);
    // Same field, different ordinal: two.
    expect(groupRepresentationCandidatesN([sampleHit(fieldA, 3), sampleHit(fieldA, 4)])
      .candidateCount).toBe(2);
    // Different field objects at the same ordinal: two.
    expect(groupRepresentationCandidatesN([sampleHit(fieldA, 3), sampleHit(fieldB, 3)])
      .candidateCount).toBe(2);
    // Field records group on the record object.
    expect(groupRepresentationCandidatesN([recordHit(fieldA, record), recordHit(fieldA, record)])
      .candidateCount).toBe(1);
    expect(groupRepresentationCandidatesN([
      recordHit(fieldA, record), recordHit(fieldA, { value: 1 } as unknown as never)
    ]).candidateCount).toBe(2);
    // And the three kinds never collide with one another.
    expect(groupRepresentationCandidatesN([
      cellHit(complex, 0), sampleHit(fieldA, 0), recordHit(fieldA, record)
    ]).candidateCount).toBe(3);
  });

  it('returns a frozen result whose counts cannot drift', () => {
    const complex = triangleComplex();
    const grouped = groupRepresentationCandidatesN([cellHit(complex, 0)]);
    expect(Object.isFrozen(grouped)).toBe(true);
    expect(Object.isFrozen(grouped.candidates)).toBe(true);
    expect(Object.isFrozen(grouped.candidates[0]!.hits)).toBe(true);
  });
});
