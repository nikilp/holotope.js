import { VecN } from '@holotope/core';
import type { HyperboxSupportShape4 } from './hyperbox4.js';
import type { SupportShapeN } from './support-shape.js';

/** Closed axis-aligned bounding box in R^n. Touching intervals overlap. */
export class AxisAlignedBoundsN {
  readonly dim: number;
  readonly min: Float64Array;
  readonly max: Float64Array;

  constructor(min: ArrayLike<number>, max: ArrayLike<number>) {
    if (min.length === 0 || min.length !== max.length) {
      throw new Error('AxisAlignedBoundsN: bounds must have the same positive dimension');
    }
    this.dim = min.length;
    this.min = Float64Array.from(min);
    this.max = Float64Array.from(max);
    for (let axis = 0; axis < this.dim; axis++) {
      const lower = this.min[axis]!;
      const upper = this.max[axis]!;
      if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
        throw new Error('AxisAlignedBoundsN: every interval must be finite and ordered');
      }
    }
  }

  overlaps(other: AxisAlignedBoundsN): boolean {
    if (other.dim !== this.dim) {
      throw new Error(
        `AxisAlignedBoundsN.overlaps: dimension ${this.dim} != ${other.dim}`
      );
    }
    for (let axis = 0; axis < this.dim; axis++) {
      if (this.max[axis]! < other.min[axis]! || other.max[axis]! < this.min[axis]!) {
        return false;
      }
    }
    return true;
  }
}

/**
 * Conservative world AABB from the 2n axial supports of any compact shape.
 *
 * `padding` should include the downstream narrowphase's contact tolerance.
 * A small scale-aware Float64 band also widens every interval to keep roundoff
 * at the support-to-bounds boundary from causing a false negative.
 */
export function supportShapeBoundsN(
  shape: SupportShapeN,
  padding = 0
): AxisAlignedBoundsN {
  if (!Number.isSafeInteger(shape.dim) || shape.dim < 1) {
    throw new Error('supportShapeBoundsN: shape dimension must be positive');
  }
  if (!Number.isFinite(padding) || padding < 0) {
    throw new Error('supportShapeBoundsN: padding must be finite and non-negative');
  }
  const min = new Float64Array(shape.dim);
  const max = new Float64Array(shape.dim);
  for (let axis = 0; axis < shape.dim; axis++) {
    const direction = VecN.basis(shape.dim, axis);
    const upper = shape.support(direction).point;
    const lower = shape.support(direction.multiplyScalar(-1)).point;
    if (upper.dim !== shape.dim || lower.dim !== shape.dim) {
      throw new Error('supportShapeBoundsN: support point dimension mismatch');
    }
    const rawMin = lower.data[axis]!;
    const rawMax = upper.data[axis]!;
    if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax) || rawMin > rawMax) {
      throw new Error('supportShapeBoundsN: axial supports must be finite and ordered');
    }
    const roundoff = boundsRoundoff(rawMin, rawMax);
    min[axis] = rawMin - padding - roundoff;
    max[axis] = rawMax + padding + roundoff;
  }
  return new AxisAlignedBoundsN(min, max);
}

/**
 * Conservative AABB of a closed bounds under one complete linear translation.
 *
 * `displacement` is the motion over a normalized interval, not a velocity.
 * Every intermediate translated bounds is contained in the result. The
 * operation is dimension-independent and does not assume anything about the
 * shape which produced the starting bounds.
 */
export function sweptBoundsN(
  bounds: AxisAlignedBoundsN,
  displacement: VecN | ArrayLike<number>
): AxisAlignedBoundsN {
  const delta = displacement instanceof VecN
    ? displacement
    : new VecN(displacement);
  if (
    delta.dim !== bounds.dim ||
    Array.from(delta.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error(
      `sweptBoundsN: displacement must contain ${bounds.dim} finite coordinates`
    );
  }
  const min = new Float64Array(bounds.dim);
  const max = new Float64Array(bounds.dim);
  for (let axis = 0; axis < bounds.dim; axis++) {
    const offset = delta.data[axis]!;
    const startMin = bounds.min[axis]!;
    const startMax = bounds.max[axis]!;
    const endMin = startMin + offset;
    const endMax = startMax + offset;
    const roundoff = boundsRoundoff(startMin, startMax, endMin, endMax);
    min[axis] = Math.min(startMin, endMin) - roundoff;
    max[axis] = Math.max(startMax, endMax) + roundoff;
  }
  return new AxisAlignedBoundsN(min, max);
}

/** Axial support bounds followed by their complete translational sweep. */
export function supportShapeSweptBoundsN(
  shape: SupportShapeN,
  displacement: VecN | ArrayLike<number>,
  padding = 0
): AxisAlignedBoundsN {
  return sweptBoundsN(supportShapeBoundsN(shape, padding), displacement);
}

/** Analytic R4 hyperbox AABB; equivalent to axial supports with one axis build. */
export function hyperboxBounds4(
  shape: HyperboxSupportShape4,
  padding = 0
): AxisAlignedBoundsN {
  if (!Number.isFinite(padding) || padding < 0) {
    throw new Error('hyperboxBounds4: padding must be finite and non-negative');
  }
  const center = shape.center;
  const axes = shape.worldAxes();
  const min = new Float64Array(4);
  const max = new Float64Array(4);
  for (let worldAxis = 0; worldAxis < 4; worldAxis++) {
    let radius = 0;
    for (let localAxis = 0; localAxis < 4; localAxis++) {
      radius +=
        shape.halfExtents[localAxis]! *
        Math.abs(axes[localAxis]!.data[worldAxis]!);
    }
    const rawMin = center.data[worldAxis]! - radius;
    const rawMax = center.data[worldAxis]! + radius;
    const roundoff = boundsRoundoff(rawMin, rawMax);
    min[worldAxis] = rawMin - padding - roundoff;
    max[worldAxis] = rawMax + padding + roundoff;
  }
  return new AxisAlignedBoundsN(min, max);
}

export interface BroadphaseProxyN<T> {
  /** Stable identity; must be unique in one candidate query. */
  readonly id: string;
  readonly bounds: AxisAlignedBoundsN;
  readonly value: T;
}

export interface BroadphaseCandidatePairN<T> {
  readonly proxyA: BroadphaseProxyN<T>;
  readonly proxyB: BroadphaseProxyN<T>;
}

export interface BroadphaseDiagnosticsN {
  readonly providerId: string;
  readonly proxyCount: number;
  readonly possiblePairs: number;
  readonly candidatePairs: number;
  readonly rejectedPairs: number;
  /** Sweep axis, or null for a provider without one. */
  readonly axis: number | null;
  /** Intervals surviving the primary-axis rejection. */
  readonly primaryAxisOverlaps: number;
  /** Closed-interval tests on non-primary axes. */
  readonly secondaryAxisTests: number;
  /** Adjacent swaps needed when a coherent sweep order was reused. */
  readonly sortSwaps: number;
  readonly reusedOrder: boolean;
}

export interface BroadphaseCandidateResultN<T> {
  readonly pairs: readonly BroadphaseCandidatePairN<T>[];
  readonly diagnostics: BroadphaseDiagnosticsN;
}

/** Candidate generation only; it must be conservative for its supplied bounds. */
export interface BroadphaseCandidateProviderN<T> {
  readonly id: string;
  compute(
    proxies: readonly BroadphaseProxyN<T>[]
  ): BroadphaseCandidateResultN<T>;
  reset?(): void;
}

/** Auditable O(n^2) reference which emits every unordered pair. */
export class AllPairsCandidateProviderN<T>
implements BroadphaseCandidateProviderN<T> {
  readonly id = 'all-pairs';

  compute(proxies: readonly BroadphaseProxyN<T>[]): BroadphaseCandidateResultN<T> {
    const validated = validateProxies(proxies);
    const pairs: BroadphaseCandidatePairN<T>[] = [];
    for (let left = 0; left < validated.length - 1; left++) {
      for (let right = left + 1; right < validated.length; right++) {
        pairs.push({ proxyA: validated[left]!, proxyB: validated[right]! });
      }
    }
    const possiblePairs = unorderedPairCount(validated.length);
    return {
      pairs,
      diagnostics: {
        providerId: this.id,
        proxyCount: validated.length,
        possiblePairs,
        candidatePairs: pairs.length,
        rejectedPairs: 0,
        axis: null,
        primaryAxisOverlaps: 0,
        secondaryAxisTests: 0,
        sortSwaps: 0,
        reusedOrder: false
      }
    };
  }
}

export interface SweepAndPruneCandidateProviderNOptions {
  /** Fixed coordinate axis, or adaptive center-spread selection. Default auto. */
  readonly axis?: number | 'auto';
}

/**
 * Deterministic single-axis sweep-and-prune with full R^n AABB rejection.
 *
 * The previous primary-axis order seeds insertion sort when proxy identity and
 * the chosen axis are coherent. Candidate output is always canonically sorted
 * by stable pair identity, independent of input and sweep order.
 */
export class SweepAndPruneCandidateProviderN<T>
implements BroadphaseCandidateProviderN<T> {
  readonly id = 'sweep-and-prune';
  private readonly axisPolicy: number | 'auto';
  private previousAxis: number | null = null;
  private previousOrder: string[] = [];

  constructor(options: SweepAndPruneCandidateProviderNOptions = {}) {
    this.axisPolicy = options.axis ?? 'auto';
    if (
      this.axisPolicy !== 'auto' &&
      (!Number.isSafeInteger(this.axisPolicy) || this.axisPolicy < 0)
    ) {
      throw new Error('SweepAndPruneCandidateProviderN: axis must be auto or non-negative');
    }
  }

  compute(proxies: readonly BroadphaseProxyN<T>[]): BroadphaseCandidateResultN<T> {
    const validated = validateProxies(proxies);
    const possiblePairs = unorderedPairCount(validated.length);
    if (validated.length === 0) {
      this.previousAxis = null;
      this.previousOrder = [];
      return {
        pairs: [],
        diagnostics: {
          providerId: this.id,
          proxyCount: 0,
          possiblePairs: 0,
          candidatePairs: 0,
          rejectedPairs: 0,
          axis: null,
          primaryAxisOverlaps: 0,
          secondaryAxisTests: 0,
          sortSwaps: 0,
          reusedOrder: false
        }
      };
    }
    const dim = validated[0]!.bounds.dim;
    const axis = this.resolveAxis(validated, dim);
    const previousRanks = new Map(this.previousOrder.map((id, index) => [id, index]));
    const reusedOrder =
      this.previousAxis === axis &&
      this.previousOrder.length === validated.length &&
      validated.every(({ id }) => previousRanks.has(id));
    const byId = new Map(validated.map((proxy) => [proxy.id, proxy]));
    const ordered = reusedOrder
      ? this.previousOrder.map((id) => byId.get(id)!)
      : [...validated];
    let sortSwaps = 0;
    if (reusedOrder) {
      sortSwaps = insertionSort(ordered, (left, right) => compareProxyOnAxis(left, right, axis));
    } else {
      ordered.sort((left, right) => compareProxyOnAxis(left, right, axis));
    }

    const active: BroadphaseProxyN<T>[] = [];
    const pairs: BroadphaseCandidatePairN<T>[] = [];
    let primaryAxisOverlaps = 0;
    let secondaryAxisTests = 0;
    for (const current of ordered) {
      for (let index = active.length - 1; index >= 0; index--) {
        if (active[index]!.bounds.max[axis]! < current.bounds.min[axis]!) {
          active.splice(index, 1);
        }
      }
      for (const other of active) {
        primaryAxisOverlaps++;
        let overlaps = true;
        for (let otherAxis = 0; otherAxis < dim; otherAxis++) {
          if (otherAxis === axis) continue;
          secondaryAxisTests++;
          if (
            other.bounds.max[otherAxis]! < current.bounds.min[otherAxis]! ||
            current.bounds.max[otherAxis]! < other.bounds.min[otherAxis]!
          ) {
            overlaps = false;
            break;
          }
        }
        if (overlaps) pairs.push(canonicalPair(other, current));
      }
      active.push(current);
    }
    pairs.sort(comparePairs);
    this.previousAxis = axis;
    this.previousOrder = ordered.map(({ id }) => id);
    return {
      pairs,
      diagnostics: {
        providerId: this.id,
        proxyCount: validated.length,
        possiblePairs,
        candidatePairs: pairs.length,
        rejectedPairs: possiblePairs - pairs.length,
        axis,
        primaryAxisOverlaps,
        secondaryAxisTests,
        sortSwaps,
        reusedOrder
      }
    };
  }

  reset(): void {
    this.previousAxis = null;
    this.previousOrder = [];
  }

  private resolveAxis(proxies: readonly BroadphaseProxyN<T>[], dim: number): number {
    if (this.axisPolicy !== 'auto') {
      if (this.axisPolicy >= dim) {
        throw new Error(
          `SweepAndPruneCandidateProviderN: axis ${this.axisPolicy} outside R${dim}`
        );
      }
      return this.axisPolicy;
    }
    let bestAxis = 0;
    let bestSpread = Number.NEGATIVE_INFINITY;
    for (let axis = 0; axis < dim; axis++) {
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      for (const { bounds } of proxies) {
        const center = 0.5 * (bounds.min[axis]! + bounds.max[axis]!);
        minimum = Math.min(minimum, center);
        maximum = Math.max(maximum, center);
      }
      const spread = maximum - minimum;
      if (spread > bestSpread) {
        bestSpread = spread;
        bestAxis = axis;
      }
    }
    return bestAxis;
  }
}

function validateProxies<T>(
  proxies: readonly BroadphaseProxyN<T>[]
): BroadphaseProxyN<T>[] {
  const seen = new Set<string>();
  let dim: number | undefined;
  const validated = [...proxies];
  for (const proxy of validated) {
    if (proxy.id.length === 0) {
      throw new Error('BroadphaseCandidateProviderN: proxy ID must not be empty');
    }
    if (seen.has(proxy.id)) {
      throw new Error(`BroadphaseCandidateProviderN: duplicate proxy ID ${proxy.id}`);
    }
    seen.add(proxy.id);
    dim ??= proxy.bounds.dim;
    if (proxy.bounds.dim !== dim) {
      throw new Error('BroadphaseCandidateProviderN: proxy dimensions must match');
    }
    for (let axis = 0; axis < proxy.bounds.dim; axis++) {
      const lower = proxy.bounds.min[axis]!;
      const upper = proxy.bounds.max[axis]!;
      if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
        throw new Error('BroadphaseCandidateProviderN: proxy bounds must remain finite and ordered');
      }
    }
  }
  validated.sort((left, right) => compareIds(left.id, right.id));
  return validated;
}

function canonicalPair<T>(
  first: BroadphaseProxyN<T>,
  second: BroadphaseProxyN<T>
): BroadphaseCandidatePairN<T> {
  return compareIds(first.id, second.id) <= 0
    ? { proxyA: first, proxyB: second }
    : { proxyA: second, proxyB: first };
}

function compareProxyOnAxis<T>(
  left: BroadphaseProxyN<T>,
  right: BroadphaseProxyN<T>,
  axis: number
): number {
  return (
    left.bounds.min[axis]! - right.bounds.min[axis]! ||
    left.bounds.max[axis]! - right.bounds.max[axis]! ||
    compareIds(left.id, right.id)
  );
}

function comparePairs<T>(
  left: BroadphaseCandidatePairN<T>,
  right: BroadphaseCandidatePairN<T>
): number {
  return (
    compareIds(left.proxyA.id, right.proxyA.id) ||
    compareIds(left.proxyB.id, right.proxyB.id)
  );
}

function insertionSort<T>(values: T[], compare: (left: T, right: T) => number): number {
  let swaps = 0;
  for (let index = 1; index < values.length; index++) {
    let cursor = index;
    while (cursor > 0 && compare(values[cursor]!, values[cursor - 1]!) < 0) {
      [values[cursor - 1], values[cursor]] = [values[cursor]!, values[cursor - 1]!];
      swaps++;
      cursor--;
    }
  }
  return swaps;
}

function unorderedPairCount(count: number): number {
  return (count * (count - 1)) / 2;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundsRoundoff(...values: number[]): number {
  return 16 * Number.EPSILON * Math.max(1, ...values.map(Math.abs));
}
