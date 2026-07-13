import type { ExactRing, ExactValue } from '../coxeter/exact.js';

function scaleExact(value: ExactValue, scalar: bigint): ExactValue {
  return { a: value.a * scalar, b: value.b * scalar };
}

function exactVector(dim: number, fill: ExactValue): ExactValue[] {
  return Array.from({ length: dim }, () => fill);
}

function sameRing(left: ExactRing, right: ExactRing): boolean {
  return left.kind === right.kind;
}

/** A finite-rank lattice embedded exactly in a module over one supported ring. */
export class LatticeN {
  readonly ring: ExactRing;
  readonly rank: number;
  readonly ambientDim: number;
  /** Basis vectors, one ambient-space vector per lattice coefficient. */
  readonly basis: ReadonlyArray<ReadonlyArray<ExactValue>>;

  constructor(ring: ExactRing, basis: ReadonlyArray<ReadonlyArray<ExactValue>>) {
    if (basis.length === 0 || basis[0]!.length === 0) {
      throw new Error('LatticeN: basis must contain at least one non-empty vector');
    }
    const ambientDim = basis[0]!.length;
    if (basis.some((vector) => vector.length !== ambientDim)) {
      throw new Error('LatticeN: basis vectors must have one ambient dimension');
    }
    this.ring = ring;
    this.rank = basis.length;
    this.ambientDim = ambientDim;
    this.basis = basis.map((vector) => vector.map((value) => ({ ...value })));
  }

  /** The identity lattice Z^n represented in the selected exact ring. */
  static integer(ring: ExactRing, dim: number): LatticeN {
    if (!Number.isInteger(dim) || dim < 1) throw new Error(`LatticeN.integer: invalid dim ${dim}`);
    return new LatticeN(
      ring,
      Array.from({ length: dim }, (_, column) =>
        Array.from({ length: dim }, (_, row) => (row === column ? ring.one : ring.zero))
      )
    );
  }

  /** Exact ambient point for an integer coefficient vector. */
  point(coefficients: readonly bigint[]): ExactValue[] {
    if (coefficients.length !== this.rank) {
      throw new Error(`LatticeN.point: ${coefficients.length} coefficients for rank ${this.rank}`);
    }
    const out = exactVector(this.ambientDim, this.ring.zero);
    for (let column = 0; column < this.rank; column++) {
      for (let row = 0; row < this.ambientDim; row++) {
        out[row] = this.ring.add(
          out[row]!,
          scaleExact(this.basis[column]![row]!, coefficients[column]!)
        );
      }
    }
    return out;
  }
}

export interface FlatNOptions {
  ring: ExactRing;
  /** Row-major exact map from ambient coordinates to physical coordinates. */
  parallelProjection: ReadonlyArray<ReadonlyArray<ExactValue>>;
  /** Row-major exact map from ambient coordinates to internal coordinates. */
  perpendicularProjection: ReadonlyArray<ReadonlyArray<ExactValue>>;
  parallelOffset?: readonly ExactValue[];
  perpendicularOffset?: readonly ExactValue[];
  /** Positive common denominator for parallel exact coordinates. Default 1. */
  parallelDenominator?: bigint;
  /** Positive common denominator for perpendicular exact coordinates. Default 1. */
  perpendicularDenominator?: bigint;
}

/**
 * An exact parallel/perpendicular coordinate splitting of one ambient
 * module. It is the algebraic data of a cut-and-project flat; orthonormal
 * Float64 frames are a later rendering concern.
 */
export class FlatN {
  readonly ring: ExactRing;
  readonly ambientDim: number;
  readonly parallelDim: number;
  readonly perpendicularDim: number;
  readonly parallelProjection: ReadonlyArray<ReadonlyArray<ExactValue>>;
  readonly perpendicularProjection: ReadonlyArray<ReadonlyArray<ExactValue>>;
  readonly parallelOffset: readonly ExactValue[];
  readonly perpendicularOffset: readonly ExactValue[];
  readonly parallelDenominator: bigint;
  readonly perpendicularDenominator: bigint;

  constructor(options: FlatNOptions) {
    const { ring, parallelProjection, perpendicularProjection } = options;
    if (parallelProjection.length === 0 || perpendicularProjection.length === 0) {
      throw new Error('FlatN: both projections must have positive dimension');
    }
    const ambientDim = parallelProjection[0]!.length;
    if (
      ambientDim === 0 ||
      parallelProjection.some((row) => row.length !== ambientDim) ||
      perpendicularProjection.some((row) => row.length !== ambientDim)
    ) {
      throw new Error('FlatN: projection rows must share one positive ambient dimension');
    }
    const parallelOffset = options.parallelOffset ?? exactVector(parallelProjection.length, ring.zero);
    const perpendicularOffset =
      options.perpendicularOffset ?? exactVector(perpendicularProjection.length, ring.zero);
    if (
      parallelOffset.length !== parallelProjection.length ||
      perpendicularOffset.length !== perpendicularProjection.length
    ) {
      throw new Error('FlatN: offset dimension does not match its projection');
    }
    const parallelDenominator = options.parallelDenominator ?? 1n;
    const perpendicularDenominator = options.perpendicularDenominator ?? 1n;
    if (parallelDenominator < 1n || perpendicularDenominator < 1n) {
      throw new Error('FlatN: coordinate denominators must be positive');
    }
    this.ring = ring;
    this.ambientDim = ambientDim;
    this.parallelDim = parallelProjection.length;
    this.perpendicularDim = perpendicularProjection.length;
    this.parallelProjection = parallelProjection.map((row) => row.map((value) => ({ ...value })));
    this.perpendicularProjection = perpendicularProjection.map((row) =>
      row.map((value) => ({ ...value }))
    );
    this.parallelOffset = parallelOffset.map((value) => ({ ...value }));
    this.perpendicularOffset = perpendicularOffset.map((value) => ({ ...value }));
    this.parallelDenominator = parallelDenominator;
    this.perpendicularDenominator = perpendicularDenominator;
  }

  private project(
    point: readonly ExactValue[],
    projection: ReadonlyArray<ReadonlyArray<ExactValue>>,
    offset: readonly ExactValue[]
  ): ExactValue[] {
    if (point.length !== this.ambientDim) {
      throw new Error(`FlatN.project: point dim ${point.length}, expected ${this.ambientDim}`);
    }
    return projection.map((row, output) => {
      let value = offset[output]!;
      for (let input = 0; input < this.ambientDim; input++) {
        value = this.ring.add(value, this.ring.mul(row[input]!, point[input]!));
      }
      return value;
    });
  }

  projectParallel(point: readonly ExactValue[]): ExactValue[] {
    return this.project(point, this.parallelProjection, this.parallelOffset);
  }

  projectPerpendicular(point: readonly ExactValue[]): ExactValue[] {
    return this.project(point, this.perpendicularProjection, this.perpendicularOffset);
  }
}

export interface ExactHalfspace {
  /** The accepted side is `normal dot point <= bound`. */
  readonly normal: readonly ExactValue[];
  readonly bound: ExactValue;
  /** Facet convention; `defer` delegates equality to the model-set policy. */
  readonly boundary?: 'defer' | 'include' | 'exclude';
}

export type WindowLocation = 'inside' | 'boundary' | 'outside';

/** A convex exact window represented by ring-valued halfspaces. */
export class ConvexWindow {
  readonly ring: ExactRing;
  readonly dim: number;
  readonly halfspaces: readonly ExactHalfspace[];

  constructor(ring: ExactRing, dim: number, halfspaces: readonly ExactHalfspace[]) {
    if (!Number.isInteger(dim) || dim < 1) throw new Error(`ConvexWindow: invalid dim ${dim}`);
    if (halfspaces.length === 0) throw new Error('ConvexWindow: at least one halfspace required');
    if (halfspaces.some((halfspace) => halfspace.normal.length !== dim)) {
      throw new Error('ConvexWindow: halfspace normal dimension mismatch');
    }
    this.ring = ring;
    this.dim = dim;
    this.halfspaces = halfspaces.map((halfspace) => ({
      normal: halfspace.normal.map((value) => ({ ...value })),
      bound: { ...halfspace.bound },
      ...(halfspace.boundary === undefined ? {} : { boundary: halfspace.boundary })
    }));
  }

  classify(point: readonly ExactValue[]): WindowLocation {
    if (point.length !== this.dim) {
      throw new Error(`ConvexWindow.classify: point dim ${point.length}, expected ${this.dim}`);
    }
    let boundary = false;
    for (const halfspace of this.halfspaces) {
      let value = this.ring.zero;
      for (let i = 0; i < this.dim; i++) {
        value = this.ring.add(value, this.ring.mul(halfspace.normal[i]!, point[i]!));
      }
      const comparison = this.ring.compare(value, halfspace.bound);
      if (comparison > 0) return 'outside';
      if (comparison === 0) boundary = true;
    }
    return boundary ? 'boundary' : 'inside';
  }

  /**
   * Decision supplied by facets touched by a boundary point. Exclusion
   * wins at corners; `null` means at least one facet deferred to policy.
   */
  boundaryDecision(point: readonly ExactValue[]): boolean | null {
    let touched = false;
    let deferred = false;
    for (const halfspace of this.halfspaces) {
      let value = this.ring.zero;
      for (let i = 0; i < this.dim; i++) {
        value = this.ring.add(value, this.ring.mul(halfspace.normal[i]!, point[i]!));
      }
      if (this.ring.compare(value, halfspace.bound) !== 0) continue;
      touched = true;
      const convention = halfspace.boundary ?? 'defer';
      if (convention === 'exclude') return false;
      if (convention === 'defer') deferred = true;
    }
    if (!touched || deferred) return null;
    return true;
  }
}

export type WindowBoundaryPolicy = 'include' | 'exclude' | 'error';

export interface CoefficientRange {
  /** Inclusive integer bounds. */
  readonly min: bigint | number;
  readonly max: bigint | number;
}

export interface ModelPoint {
  /** Integer lattice coefficients: exact provenance of this point. */
  readonly coefficients: readonly bigint[];
  readonly ambient: readonly ExactValue[];
  readonly parallelExact: readonly ExactValue[];
  readonly perpendicularExact: readonly ExactValue[];
  /** Common exact-coordinate denominator used by `parallelExact`. */
  readonly parallelDenominator: bigint;
  /** Common exact-coordinate denominator used by `perpendicularExact`. */
  readonly perpendicularDenominator: bigint;
  readonly parallel: Float64Array;
  readonly perpendicular: Float64Array;
  readonly windowLocation: 'inside' | 'boundary';
}

export interface ModelSetPatch {
  readonly points: readonly ModelPoint[];
  readonly candidateCount: number;
  readonly boundaryCount: number;
}

export interface ModelSetSampleOptions {
  /** One inclusive range per lattice coefficient. */
  coefficientRanges: readonly CoefficientRange[];
  /** Safety cap on coefficient-box size. Default 1,000,000. */
  maxCandidates?: number;
}

/** A lattice viewed through an exact flat and compact acceptance window. */
export class ModelSet {
  readonly lattice: LatticeN;
  readonly flat: FlatN;
  readonly window: ConvexWindow;
  readonly boundaryPolicy: WindowBoundaryPolicy;

  constructor(
    lattice: LatticeN,
    flat: FlatN,
    window: ConvexWindow,
    boundaryPolicy: WindowBoundaryPolicy = 'error'
  ) {
    if (!sameRing(lattice.ring, flat.ring) || !sameRing(lattice.ring, window.ring)) {
      throw new Error('ModelSet: lattice, flat, and window must use one exact ring');
    }
    if (lattice.ambientDim !== flat.ambientDim) {
      throw new Error('ModelSet: lattice ambient dimension does not match flat');
    }
    if (flat.perpendicularDim !== window.dim) {
      throw new Error('ModelSet: window dimension does not match perpendicular space');
    }
    this.lattice = lattice;
    this.flat = flat;
    this.window = window;
    this.boundaryPolicy = boundaryPolicy;
  }

  sample({ coefficientRanges, maxCandidates = 1_000_000 }: ModelSetSampleOptions): ModelSetPatch {
    if (coefficientRanges.length !== this.lattice.rank) {
      throw new Error(
        `ModelSet.sample: ${coefficientRanges.length} ranges for rank ${this.lattice.rank}`
      );
    }
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
      throw new Error(`ModelSet.sample: invalid maxCandidates ${maxCandidates}`);
    }
    const toInteger = (value: bigint | number): bigint => {
      if (typeof value === 'bigint') return value;
      if (!Number.isSafeInteger(value)) {
        throw new Error(`ModelSet.sample: coefficient bound must be a safe integer, got ${value}`);
      }
      return BigInt(value);
    };
    const ranges = coefficientRanges.map(({ min, max }) => {
      const lo = toInteger(min);
      const hi = toInteger(max);
      if (lo > hi) throw new Error(`ModelSet.sample: invalid coefficient range ${lo}…${hi}`);
      return { min: lo, max: hi };
    });
    let candidateCountBig = 1n;
    for (const range of ranges) candidateCountBig *= range.max - range.min + 1n;
    if (candidateCountBig > BigInt(maxCandidates)) {
      throw new Error(
        `ModelSet.sample: coefficient box has ${candidateCountBig} candidates, cap is ${maxCandidates}`
      );
    }

    const points: ModelPoint[] = [];
    let boundaryCount = 0;
    const coefficients = Array<bigint>(this.lattice.rank).fill(0n);
    const visit = (axis: number): void => {
      if (axis < ranges.length) {
        for (let value = ranges[axis]!.min; value <= ranges[axis]!.max; value++) {
          coefficients[axis] = value;
          visit(axis + 1);
        }
        return;
      }
      const ambient = this.lattice.point(coefficients);
      const perpendicularExact = this.flat.projectPerpendicular(ambient);
      const location = this.window.classify(perpendicularExact);
      if (location === 'outside') return;
      if (location === 'boundary') {
        boundaryCount++;
        const facetDecision = this.window.boundaryDecision(perpendicularExact);
        if (facetDecision === false) return;
        if (facetDecision === null && this.boundaryPolicy === 'exclude') return;
        if (facetDecision === null && this.boundaryPolicy === 'error') {
          throw new Error(
            `ModelSet.sample: singular cut at lattice point [${coefficients.join(',')}]`
          );
        }
      }
      const parallelExact = this.flat.projectParallel(ambient);
      points.push({
        coefficients: coefficients.slice(),
        ambient,
        parallelExact,
        perpendicularExact,
        parallelDenominator: this.flat.parallelDenominator,
        perpendicularDenominator: this.flat.perpendicularDenominator,
        parallel: Float64Array.from(
          parallelExact,
          (value) => this.lattice.ring.toNumber(value) / Number(this.flat.parallelDenominator)
        ),
        perpendicular: Float64Array.from(perpendicularExact, (value) =>
          this.lattice.ring.toNumber(value) / Number(this.flat.perpendicularDenominator)
        ),
        windowLocation: location
      });
    };
    visit(0);
    return { points, candidateCount: Number(candidateCountBig), boundaryCount };
  }
}
