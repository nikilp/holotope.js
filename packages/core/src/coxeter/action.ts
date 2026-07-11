import type { CoxeterDiagram } from './diagram.js';
import type { ExactRing, ExactValue } from './exact.js';

/**
 * A finite Coxeter group as a chamber-action graph: elements are integer
 * chamber IDs (0 = identity) and the only stored operation is right
 * multiplication by a generator. This is the group's source of truth —
 * matrices, rotors, and coordinates are all derived, never compared.
 */
export interface CoxeterAction {
  readonly diagram: CoxeterDiagram;
  readonly rank: number;
  readonly order: number;
  /**
   * leftMultiply[g * rank + i] = the element sᵢ·g — the point-reflection
   * table produced directly by the BFS (reflecting a chamber's point in
   * simple mirror i is left multiplication).
   */
  readonly leftMultiply: Uint16Array | Uint32Array;
  /**
   * rightMultiply[g * rank + i] = the element g·sᵢ. Right multiplication
   * by stabilizer generators closes **left cosets** g·W_S — exactly the
   * face translates of the Wythoff construction.
   */
  readonly rightMultiply: Uint16Array | Uint32Array;
  /** BFS tree: s(parentGenerator[g])·parent[g] = g; identity points at itself. */
  readonly parent: Uint16Array | Uint32Array;
  readonly parentGenerator: Uint8Array;
  /** (−1)^wordLength — the determinant of the reflection product. */
  readonly parity: Int8Array;
}

/**
 * Reflection in mirror `i`, acting on a signed mirror-distance tuple:
 * d′ⱼ = dⱼ − C[j][i]·dᵢ with C the doubled Gram matrix. Exact — this is
 * the entire geometric kernel of the enumeration.
 */
export function reflectDistances(
  point: readonly ExactValue[],
  mirror: number,
  twoGram: ReadonlyArray<ReadonlyArray<ExactValue>>,
  ring: ExactRing
): ExactValue[] {
  const d = point[mirror]!;
  return point.map((pj, j) => ring.sub(pj, ring.mul(twoGram[j]![mirror]!, d)));
}

/**
 * Enumerates the group by exact BFS on the orbit of a chamber-interior
 * point (all mirror distances 1): its stabilizer is trivial, so orbit
 * points correspond one-to-one with group elements. Throws if the count
 * disagrees with the diagram's declared order — the enumeration cannot
 * silently drift.
 */
export function enumerateCoxeterAction(diagram: CoxeterDiagram): CoxeterAction {
  const { rank, ring, twoGram } = diagram;
  const seed = Array.from({ length: rank }, () => ring.one);
  const points: ExactValue[][] = [seed];
  const index = new Map<string, number>([[ring.keyTuple(seed), 0]]);

  const next: number[] = [];
  const parent: number[] = [0];
  const parentGenerator: number[] = [255];
  const parity: number[] = [1];

  for (let head = 0; head < points.length; head++) {
    const p = points[head]!;
    for (let i = 0; i < rank; i++) {
      const q = reflectDistances(p, i, twoGram, ring);
      const key = ring.keyTuple(q);
      let qId = index.get(key);
      if (qId === undefined) {
        qId = points.length;
        index.set(key, qId);
        points.push(q);
        parent.push(head);
        parentGenerator.push(i);
        parity.push(-parity[head]!);
      }
      next[head * rank + i] = qId;
    }
  }

  if (points.length !== diagram.order) {
    throw new Error(
      `${diagram.id}: enumerated ${points.length} chambers, expected ${diagram.order}`
    );
  }

  // Derive the right-multiplication table by replaying BFS words: with
  // g = s_p·parent(g), associativity gives g·sᵢ = s_p·(parent(g)·sᵢ),
  // and BFS order guarantees parents are resolved before children.
  const order = points.length;
  const right = new Array<number>(order * rank);
  for (let i = 0; i < rank; i++) right[i] = next[i]!; // identity row
  for (let g = 1; g < order; g++) {
    const p = parent[g]!;
    const gen = parentGenerator[g]!;
    for (let i = 0; i < rank; i++) {
      right[g * rank + i] = next[right[p * rank + i]! * rank + gen]!;
    }
  }

  const Table = order <= 0xffff ? Uint16Array : Uint32Array;
  return {
    diagram,
    rank,
    order,
    leftMultiply: Table.from(next),
    rightMultiply: Table.from(right),
    parent: Table.from(parent),
    parentGenerator: Uint8Array.from(parentGenerator),
    parity: Int8Array.from(parity)
  };
}

/**
 * The orbit of an arbitrary exact mirror-distance tuple — the Wythoff
 * vertex set for a seed built from a ring pattern (1 on ringed mirrors,
 * 0 on unringed ones). Unlike chamber enumeration the stabilizer may be
 * nontrivial, so the orbit is a quotient: |orbit| = order / |stabilizer|.
 * Returns the distinct tuples in BFS order.
 */
export function orbitDistanceTuples(
  diagram: CoxeterDiagram,
  seed: readonly ExactValue[]
): ExactValue[][] {
  const { rank, ring, twoGram } = diagram;
  if (seed.length !== rank) {
    throw new Error(`${diagram.id}: seed has ${seed.length} entries, rank is ${rank}`);
  }
  const points: ExactValue[][] = [seed.slice()];
  const index = new Set<string>([ring.keyTuple(seed)]);
  for (let head = 0; head < points.length; head++) {
    for (let i = 0; i < rank; i++) {
      const q = reflectDistances(points[head]!, i, twoGram, ring);
      const key = ring.keyTuple(q);
      if (!index.has(key)) {
        index.add(key);
        points.push(q);
      }
    }
  }
  return points;
}

/**
 * The standard Wythoff seed for a ring pattern: distance 1 from every
 * ringed (active) mirror, 0 from the rest — every generator edge then
 * has exact length 2·1 in the realization.
 */
export function wythoffSeed(diagram: CoxeterDiagram, rings: readonly boolean[]): ExactValue[] {
  if (rings.length !== diagram.rank) {
    throw new Error(`${diagram.id}: ${rings.length} rings for rank ${diagram.rank}`);
  }
  if (!rings.some(Boolean)) {
    throw new Error(`${diagram.id}: at least one mirror must be ringed`);
  }
  return rings.map((r) => (r ? diagram.ring.one : diagram.ring.zero));
}
