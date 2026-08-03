import {
  CellComplex,
  VecN,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  inspectSourceSimplexReferenceN,
  type CellGroup,
  type SourceSimplexReferenceN
} from '@holotope/core';

/**
 * One axis-aligned coordinate interval per axis.
 *
 * Shared with the exhaustive candidate family rather than reimplemented there.
 * The hierarchy may only reject what the exhaustive scan would reject, and both
 * decide with these exact numbers — an independently derived "equivalent" bound
 * would be a second source of truth for the same proof.
 */
export interface XpbdSourceSimplexBoundsN {
  readonly min: Float64Array;
  readonly max: Float64Array;
}

/**
 * Slack absorbing the rounding of the coordinates that formed a bound.
 *
 * Widening is always safe here: a bound that is slightly too large retains a
 * pair the exact barrier then rejects, while one that is slightly too small
 * could drop a real contact.
 */
export function xpbdSourceSimplexBoundsRoundoffN(...values: number[]): number {
  return 16 * Number.EPSILON * Math.max(1, ...values.map(Math.abs));
}

/** Raw coordinate bounds of one persistent obstacle simplex, plus roundoff. */
export function xpbdSourceSimplexBoundsN(
  reference: SourceSimplexReferenceN
): XpbdSourceSimplexBoundsN {
  const dim = reference.complex.ambientDim;
  const min = new Float64Array(dim).fill(Number.POSITIVE_INFINITY);
  const max = new Float64Array(dim).fill(Number.NEGATIVE_INFINITY);
  for (const vertex of reference.vertexIndices) {
    const point = reference.complex.getPosition(vertex);
    for (let axis = 0; axis < dim; axis++) {
      min[axis] = Math.min(min[axis]!, point[axis]!);
      max[axis] = Math.max(max[axis]!, point[axis]!);
    }
  }
  for (let axis = 0; axis < dim; axis++) {
    const roundoff = xpbdSourceSimplexBoundsRoundoffN(min[axis]!, max[axis]!);
    min[axis]! -= roundoff;
    max[axis]! += roundoff;
  }
  return { min, max };
}

/** The swept point envelope: both endpoints, expanded by activation distance. */
export function xpbdSweptPointBoundsN(
  before: VecN,
  after: VecN,
  padding: number
): XpbdSourceSimplexBoundsN {
  const min = new Float64Array(before.dim);
  const max = new Float64Array(before.dim);
  for (let axis = 0; axis < before.dim; axis++) {
    const start = before.data[axis]!;
    const end = after.data[axis]!;
    const roundoff = xpbdSourceSimplexBoundsRoundoffN(start, end, padding);
    min[axis] = Math.min(start, end) - padding - roundoff;
    max[axis] = Math.max(start, end) + padding + roundoff;
  }
  return { min, max };
}

/**
 * Inclusive overlap with the axis comparisons it needed.
 *
 * Separation on any single axis is a complete rejection proof: if Euclidean
 * point--simplex distance were at or below the activation distance, the
 * expanded query interval would meet the simplex interval on every axis.
 * Touching counts as overlapping, so a pair exactly at the boundary survives.
 */
export function xpbdSourceSimplexBoundsOverlapN(
  left: XpbdSourceSimplexBoundsN,
  right: XpbdSourceSimplexBoundsN
): { readonly overlaps: boolean; readonly axisTests: number } {
  let axisTests = 0;
  for (let axis = 0; axis < left.min.length; axis++) {
    axisTests++;
    if (left.max[axis]! < right.min[axis]! ||
      right.max[axis]! < left.min[axis]!) {
      return { overlaps: false, axisTests };
    }
  }
  return { overlaps: true, axisTests };
}

/** Construction options for one immutable static-obstacle hierarchy. */
export interface CompileXpbdSourceSimplexAabbHierarchyNOptions {
  /** Static obstacle complex owning the indexed simplex group. */
  readonly obstacle: CellComplex;
  /** Non-empty simplex group belonging to `obstacle`. */
  readonly simplexGroup: CellGroup;
  /**
   * Maximum simplices per leaf. Default 8.
   *
   * Smaller leaves prune more and store more nodes; a leaf larger than the
   * simplex count degenerates to one exhaustive leaf, which is legal and
   * reported rather than prevented.
   */
  readonly leafSize?: number;
}

/**
 * Work one hierarchy query actually performed.
 *
 * These are operation counts, never times. A tree that visits fewer nodes but
 * retains a different set is wrong, not fast, so the counts exist to show the
 * pruning is real — and, on an obstacle that cannot be separated, that it is
 * not.
 */
export interface XpbdSourceSimplexAabbQueryDiagnosticsN {
  /** Simplices indexed by the whole hierarchy. */
  readonly totalSimplices: number;
  /** Internal and leaf nodes reached, including those immediately rejected. */
  readonly visitedNodes: number;
  /** Leaves whose bound overlapped, so their simplices were tested. */
  readonly visitedLeaves: number;
  /** Individual simplex bounds compared; the exhaustive path tests all. */
  readonly testedSimplexBounds: number;
  /** Simplices whose own bound overlapped the query. */
  readonly retainedSimplices: number;
  /** Axis comparisons across node and simplex tests, after early exits. */
  readonly axisTests: number;
}

/** Retained simplices for one query box, in persistent obstacle-cell order. */
export interface XpbdSourceSimplexAabbQueryN {
  /** Source references, never tree ordinals; identity survives traversal. */
  readonly simplices: readonly SourceSimplexReferenceN[];
  /** Persistent group-cell ordinals, ascending, parallel to `simplices`. */
  readonly cellIndices: readonly number[];
  /** Auditable reduction counts for this exact query. */
  readonly diagnostics: XpbdSourceSimplexAabbQueryDiagnosticsN;
}

interface HierarchyNodeN {
  readonly bounds: XpbdSourceSimplexBoundsN;
  readonly begin: number;
  readonly end: number;
  readonly left: HierarchyNodeN | null;
  readonly right: HierarchyNodeN | null;
}

/**
 * An immutable AABB tree over one static source-simplex obstacle.
 *
 * It answers exactly one question: which persistent obstacle simplices could
 * lie within the activation distance of a queried point or segment. It never
 * measures a distance, never decides that a retained pair is in contact, and
 * never becomes contact identity — the P44 exact barrier and its conservative
 * prefix filter remain authoritative behind it.
 *
 * The obstacle is static for the hierarchy's lifetime. Bounds are computed once
 * at compilation, so a later coordinate change would silently invalidate every
 * one of them; the hierarchy therefore snapshots the coordinates it indexed and
 * refuses loudly rather than answering from a stale tree. There is no automatic
 * rebuild, because a rebuild that happens by itself is indistinguishable from a
 * tree that was never stale.
 *
 * Construction is deterministic, so equivalent sources produce equivalent
 * evidence: split on the axis of greatest centroid extent with ties to the
 * lowest axis index, stable-sort by centroid with ties to the persistent cell
 * index, and split at the lower median by count. Splitting by count rather than
 * by a geometric threshold is what keeps a degenerate obstacle — every centroid
 * identical — from putting every simplex on one side and recursing forever.
 */
export class XpbdSourceSimplexAabbHierarchyN {
  /** Ambient obstacle dimension. */
  readonly dimension: number;
  /** Static obstacle complex this hierarchy indexes. */
  readonly obstacle: CellComplex;
  /** Indexed simplex group; identity, not structural equality, is required. */
  readonly simplexGroup: CellGroup;
  /** Persistent obstacle simplices in group-cell order. */
  readonly simplices: readonly SourceSimplexReferenceN[];
  /** Maximum simplices per leaf, as resolved at compilation. */
  readonly leafSize: number;

  private readonly root: HierarchyNodeN;
  /** Simplex indices permuted into tree order; leaves address ranges of it. */
  private readonly order: Int32Array;
  private readonly bounds: readonly XpbdSourceSimplexBoundsN[];
  /** Vertices contributing to the indexed group, ascending and deduplicated. */
  private readonly contributingVertices: Int32Array;
  /** Their coordinates at compilation, for exact staleness comparison. */
  private readonly coordinateSnapshot: Float64Array;

  private constructor(
    obstacle: CellComplex,
    simplexGroup: CellGroup,
    simplices: readonly SourceSimplexReferenceN[],
    leafSize: number
  ) {
    this.dimension = obstacle.ambientDim;
    this.obstacle = obstacle;
    this.simplexGroup = simplexGroup;
    this.simplices = Object.freeze(simplices.slice());
    this.leafSize = leafSize;
    this.bounds = Object.freeze(simplices.map(xpbdSourceSimplexBoundsN));
    this.order = Int32Array.from(simplices.map((_, index) => index));
    this.root = buildNode(
      this.order, this.bounds, centroidsOf(this.bounds, this.dimension),
      0, simplices.length, this.dimension, leafSize
    );

    const unique = Array.from(new Set(Array.from(simplexGroup.indices)))
      .sort((a, b) => a - b);
    this.contributingVertices = Int32Array.from(unique);
    this.coordinateSnapshot = new Float64Array(unique.length * this.dimension);
    let at = 0;
    for (const vertex of unique) {
      const point = obstacle.getPosition(vertex);
      for (let axis = 0; axis < this.dimension; axis++) {
        this.coordinateSnapshot[at++] = point[axis]!;
      }
    }
  }

  /** Compiles persistent references, bounds, the tree, and the snapshot. */
  static compile(
    options: CompileXpbdSourceSimplexAabbHierarchyNOptions
  ): XpbdSourceSimplexAabbHierarchyN {
    const caller = 'compileXpbdSourceSimplexAabbHierarchyN';
    if (typeof options !== 'object' || options === null) {
      throw new Error(`${caller}: options must be an object`);
    }
    const allowed = ['obstacle', 'simplexGroup', 'leafSize'];
    const unknown = Object.keys(options).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `${caller}: unknown option${unknown.length === 1 ? '' : 's'} ` +
        unknown.sort().map((key) => `"${key}"`).join(', ')
      );
    }
    if (!(options.obstacle instanceof CellComplex)) {
      throw new Error(`${caller}: obstacle must be a CellComplex`);
    }
    const group = options.simplexGroup;
    if (!options.obstacle.groups.includes(group)) {
      throw new Error(`${caller}: simplexGroup must belong to obstacle`);
    }
    if (!Number.isSafeInteger(group.dim) || group.dim < 1 ||
      group.dim > options.obstacle.ambientDim || group.kind !== 'simplex' ||
      group.verticesPerCell !== group.dim + 1 || group.indices.length === 0 ||
      group.indices.length % group.verticesPerCell !== 0) {
      throw new Error(
        `${caller}: simplexGroup must contain complete non-empty simplices`
      );
    }
    const leafSize = options.leafSize ?? 8;
    if (!Number.isSafeInteger(leafSize) || leafSize < 1) {
      throw new Error(`${caller}: leafSize must be a positive safe integer`);
    }
    for (const vertex of group.indices) {
      const offset = vertex * options.obstacle.ambientDim;
      for (let axis = 0; axis < options.obstacle.ambientDim; axis++) {
        if (!Number.isFinite(options.obstacle.positions[offset + axis])) {
          throw new Error(`${caller}: obstacle simplex positions must be finite`);
        }
      }
    }
    const simplices = Array.from(
      { length: group.indices.length / group.verticesPerCell },
      (_, cellIndex) => createSourceSimplexReferenceN(
        createSourceCellReferenceN(options.obstacle, group, cellIndex)
      )
    );
    return new XpbdSourceSimplexAabbHierarchyN(
      options.obstacle, group, simplices, leafSize
    );
  }

  /**
   * Throws unless the indexed obstacle is exactly as it was at compilation.
   *
   * `O(indexed source coordinates)`, which is the point: it is cheaper than the
   * `O(dynamic vertices × simplices)` search it guards, and a stale tree that
   * merely looks plausible is worse than a slow one.
   */
  assertSourceCurrent(caller: string): void {
    if (!this.obstacle.groups.includes(this.simplexGroup)) {
      throw new Error(`${caller}: indexed obstacle simplex group was removed`);
    }
    if (this.simplices.length !==
      this.simplexGroup.indices.length / this.simplexGroup.verticesPerCell) {
      throw new Error(`${caller}: indexed obstacle simplex layout changed`);
    }
    for (let index = 0; index < this.simplices.length; index++) {
      const status = inspectSourceSimplexReferenceN(this.simplices[index]!);
      if (status.kind === 'retired') {
        throw new Error(
          `${caller}: indexed obstacle simplex ${index} is retired (${status.reason})`
        );
      }
    }
    let at = 0;
    for (const vertex of this.contributingVertices) {
      const point = this.obstacle.getPosition(vertex);
      for (let axis = 0; axis < this.dimension; axis++) {
        if (point[axis] !== this.coordinateSnapshot[at]) {
          throw new Error(
            `${caller}: the indexed obstacle moved — vertex ${vertex} axis ${axis} ` +
            `is ${point[axis]}, was ${this.coordinateSnapshot[at]}. ` +
            'This hierarchy indexes a static obstacle and is not rebuilt ' +
            'automatically; compile a new one after moving the source.'
          );
        }
        at++;
      }
    }
  }

  /**
   * Retained simplices whose bounds meet `bounds`, in obstacle-cell order.
   *
   * Traversal happens in tree order; the result is restored to the persistent
   * cell order the exhaustive path produces, so tree shape can never be
   * observed downstream as a different candidate sequence.
   */
  query(bounds: {
    readonly min: ArrayLike<number>;
    readonly max: ArrayLike<number>;
  }): XpbdSourceSimplexAabbQueryN {
    const caller = 'XpbdSourceSimplexAabbHierarchyN.query';
    if (typeof bounds !== 'object' || bounds === null) {
      throw new Error(`${caller}: bounds must be an object`);
    }
    if (bounds.min?.length !== this.dimension ||
      bounds.max?.length !== this.dimension) {
      throw new Error(
        `${caller}: bounds must be R${this.dimension} on both min and max`
      );
    }
    const min = new Float64Array(this.dimension);
    const max = new Float64Array(this.dimension);
    for (let axis = 0; axis < this.dimension; axis++) {
      min[axis] = bounds.min[axis]!;
      max[axis] = bounds.max[axis]!;
      if (!Number.isFinite(min[axis]!) || !Number.isFinite(max[axis]!)) {
        throw new Error(`${caller}: bounds must be finite`);
      }
      if (min[axis]! > max[axis]!) {
        throw new Error(`${caller}: bounds min exceeds max on axis ${axis}`);
      }
    }
    this.assertSourceCurrent(caller);
    return this.queryChecked({ min, max });
  }

  /**
   * The traversal, with validation and staleness already established.
   *
   * The candidate family calls this once per dynamic vertex after checking the
   * obstacle once per query, so a hundred vertices do not pay for a hundred
   * identical snapshot comparisons.
   */
  queryChecked(box: XpbdSourceSimplexBoundsN): XpbdSourceSimplexAabbQueryN {
    const cellIndices: number[] = [];
    let visitedNodes = 0;
    let visitedLeaves = 0;
    let testedSimplexBounds = 0;
    let axisTests = 0;

    const stack: HierarchyNodeN[] = [this.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      visitedNodes++;
      const nodeOverlap = xpbdSourceSimplexBoundsOverlapN(box, node.bounds);
      axisTests += nodeOverlap.axisTests;
      if (!nodeOverlap.overlaps) continue;
      if (node.left === null || node.right === null) {
        visitedLeaves++;
        for (let at = node.begin; at < node.end; at++) {
          const index = this.order[at]!;
          testedSimplexBounds++;
          const hit = xpbdSourceSimplexBoundsOverlapN(box, this.bounds[index]!);
          axisTests += hit.axisTests;
          if (hit.overlaps) cellIndices.push(index);
        }
        continue;
      }
      // Right first so left is popped first; traversal order is internal
      // either way, but a fixed order keeps node counts reproducible.
      stack.push(node.right);
      stack.push(node.left);
    }

    cellIndices.sort((a, b) => a - b);
    return Object.freeze({
      simplices: Object.freeze(cellIndices.map((index) => this.simplices[index]!)),
      cellIndices: Object.freeze(cellIndices),
      diagnostics: Object.freeze({
        totalSimplices: this.simplices.length,
        visitedNodes,
        visitedLeaves,
        testedSimplexBounds,
        retainedSimplices: cellIndices.length,
        axisTests
      })
    });
  }
}

/**
 * Compiles one immutable AABB hierarchy over a static source-simplex obstacle.
 *
 * Nothing selects this automatically. The exhaustive scan remains the default
 * and the correctness oracle, and a caller opts in by passing the compiled
 * hierarchy to `compileXpbdParticleSourceSimplexBarrierFamilyN`, where it must
 * name the same obstacle and group objects the family itself indexes.
 *
 * @param options - The static obstacle, its simplex group, and an optional
 * positive `leafSize` (default 8).
 * @returns An immutable hierarchy bound to those exact objects.
 * @throws If the group does not belong to the obstacle, is not a complete
 * non-empty simplex group, carries a non-finite coordinate, or if `leafSize`
 * is not a positive safe integer.
 *
 * @example
 * Compile once against a static obstacle, then query many times. The hierarchy
 * returns source references, so identity survives traversal:
 * ```ts
 * const obstacle = new CellComplex(4, Float64Array.from([
 *   0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
 *   5, 0, 0, 0, 6, 0, 0, 0, 5, 1, 0, 0, 5, 0, 1, 0
 * ]), [{
 *   key: 'obstacle', dim: 3, verticesPerCell: 4, kind: 'simplex',
 *   indices: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7])
 * }]);
 * const [group] = obstacle.cellsOfDim(3);
 * if (!group) throw new Error('the obstacle has no 3-cells');
 *
 * const hierarchy = compileXpbdSourceSimplexAabbHierarchyN({
 *   obstacle, simplexGroup: group, leafSize: 1
 * });
 *
 * const near = hierarchy.query({
 *   min: [-0.5, -0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5, 0.5]
 * });
 * log(near.cellIndices);                        // [0] — the far one is pruned
 * log(near.diagnostics.testedSimplexBounds);    // fewer than totalSimplices
 * log(near.simplices[0]?.parent.cellIndex);     // persistent obstacle identity
 * ```
 */
export function compileXpbdSourceSimplexAabbHierarchyN(
  options: CompileXpbdSourceSimplexAabbHierarchyNOptions
): XpbdSourceSimplexAabbHierarchyN {
  return XpbdSourceSimplexAabbHierarchyN.compile(options);
}

function centroidsOf(
  bounds: readonly XpbdSourceSimplexBoundsN[],
  dimension: number
): readonly Float64Array[] {
  return bounds.map((bound) => {
    const centroid = new Float64Array(dimension);
    for (let axis = 0; axis < dimension; axis++) {
      centroid[axis] = (bound.min[axis]! + bound.max[axis]!) / 2;
    }
    return centroid;
  });
}

function buildNode(
  order: Int32Array,
  bounds: readonly XpbdSourceSimplexBoundsN[],
  centroids: readonly Float64Array[],
  begin: number,
  end: number,
  dimension: number,
  leafSize: number
): HierarchyNodeN {
  const min = new Float64Array(dimension).fill(Number.POSITIVE_INFINITY);
  const max = new Float64Array(dimension).fill(Number.NEGATIVE_INFINITY);
  for (let at = begin; at < end; at++) {
    const bound = bounds[order[at]!]!;
    for (let axis = 0; axis < dimension; axis++) {
      min[axis] = Math.min(min[axis]!, bound.min[axis]!);
      max[axis] = Math.max(max[axis]!, bound.max[axis]!);
    }
  }
  const nodeBounds: XpbdSourceSimplexBoundsN = { min, max };
  if (end - begin <= leafSize) {
    return { bounds: nodeBounds, begin, end, left: null, right: null };
  }

  let axis = 0;
  let widest = Number.NEGATIVE_INFINITY;
  for (let candidate = 0; candidate < dimension; candidate++) {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let at = begin; at < end; at++) {
      const value = centroids[order[at]!]![candidate]!;
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    // Strictly greater, so an exact tie keeps the lowest axis index.
    if (high - low > widest) { widest = high - low; axis = candidate; }
  }

  const window = Array.from(order.subarray(begin, end));
  window.sort((left, right) => {
    const delta = centroids[left]![axis]! - centroids[right]![axis]!;
    // Persistent cell index breaks every tie, including all-equal centroids,
    // so the same source always produces the same tree.
    return delta !== 0 ? delta : left - right;
  });
  order.set(window, begin);

  // A count split, never a geometric one: coincident centroids would put every
  // simplex on one side of a plane and recurse without shrinking.
  const middle = begin + Math.floor((end - begin) / 2);
  return {
    bounds: nodeBounds,
    begin,
    end,
    left: buildNode(order, bounds, centroids, begin, middle, dimension, leafSize),
    right: buildNode(order, bounds, centroids, middle, end, dimension, leafSize)
  };
}
