import type { CellComplex } from '../geometry/cell-complex.js';
import type { TransformN } from '../math/transform.js';
import { VecN } from '../math/vecn.js';
import type { HyperplaneSlice4 } from '../projection/slice.js';
import { sliceTetrahedraAmbient } from '../projection/slice.js';
import {
  affineSectionMapRecipe4,
  affineSliceChartMapRecipe4,
  createRepresentationLineageN,
  type RepresentationLineageN
} from './map.js';
import {
  createSourceCellLookupN,
  createSourceCellReferenceN,
  inspectSourceCellReferenceN,
  type SourceCellReferenceN
} from './source-reference.js';
import {
  createSourceSimplexReferenceN,
  projectPointToSourceSimplexN,
  type SourceSimplexCoordinateN
} from './source-simplex-coordinate.js';

/**
 * Renderer-independent triangle chart retaining the source cell of every face.
 *
 * `trianglePositions` contains `triangleCount` packed 3D triangles. Entry
 * `sourceCellIndices[t]` indexes `sourceCells` for triangle `t`. This is the
 * smallest record needed to resolve a chart point without depending on
 * Three.js raycast types or on a particular experiment runtime.
 */
export interface RepresentationCellChartN {
  /** Identifies the record as a triangulated source-cell chart. */
  readonly kind: 'representation-cell-chart';
  /** Ordered maps that produced the chart from authoritative source state. */
  readonly lineage: RepresentationLineageN;
  /** Packed xyz corners, nine consecutive numbers per rendered triangle. */
  readonly trianglePositions: ArrayLike<number>;
  /** Active triangle count within `trianglePositions`. */
  readonly triangleCount: number;
  /** Per-triangle index into `sourceCells`. */
  readonly sourceCellIndices: ArrayLike<number>;
  /** Persistent source references retained by this representation product. */
  readonly sourceCells: readonly SourceCellReferenceN[];
  /**
   * Whether and how a chart position can be lifted to ambient source space.
   * A projection retains source identity while refusing to invent one point
   * from its many-to-one inverse fibre.
   */
  readonly pointLift:
    | {
        /** Declares that applying `lift` names one exact ambient point. */
        readonly kind: 'exact';
        /** Embed one finite 3D chart point in the representation's ambient frame. */
        readonly lift: (point: ArrayLike<number>) => VecN;
      }
    | {
        /** Declares that this chart carries no unique point lift. */
        readonly kind: 'unavailable';
        /** Mathematical reason a visible point does not name one ambient point. */
        readonly reason: 'projection-ambiguous' | 'point-lift-unavailable';
      };
  /**
   * Source-to-ambient pose used when the chart was produced. The resolver
   * applies its inverse before constructing source-local barycentric
   * coordinates. Omit for an unposed source.
   */
  readonly sourceTransform?: TransformN;
}

/** Result of resolving a representation-chart point to its retained source. */
export type RepresentationChartSourceCellResolutionN =
  | {
      /** Declares that exactly one retained source cell was selected. */
      readonly kind: 'resolved';
      /** Lifecycle-aware source cell that produced the selected triangle. */
      readonly reference: SourceCellReferenceN;
      /** Triangle selected by the query or discovered by containment. */
      readonly triangleIndex: number;
      /**
       * Exact source coordinate, or why source identity survived while point
       * position did not.
       */
      readonly sourceCoordinate:
        | {
            /** Declares that both the ambient point and local coordinate are exact. */
            readonly kind: 'exact';
            /** Ambient point in the posed source frame. */
            readonly ambientPoint: VecN;
            /** Barycentric coordinate in the source cell's unposed local frame. */
            readonly coordinate: SourceSimplexCoordinateN;
            /** Euclidean source-space residual of the recovered coordinate. */
            readonly sourceResidual: number;
          }
        | {
            /** Declares that source identity survived but point position did not. */
            readonly kind: 'unavailable';
            /** Why this chart cannot supply one source-local coordinate. */
            readonly reason: 'projection-ambiguous' | 'point-lift-unavailable';
          };
    }
  | {
      /** Declares that the resolver refused to choose a source cell. */
      readonly kind: 'unavailable';
      /** Stable reason a unique source cell could not be returned. */
      readonly reason:
        | 'outside-representation'
        | 'ambiguous-source-cell'
        | 'source-cell-record-missing'
        | 'source-cell-retired'
        | 'source-cell-not-simplex'
        | 'source-coordinate-mismatch';
      /** Number of visible triangles containing the queried chart point. */
      readonly matchingTriangles: number;
      /** Number of distinct retained source cells among those triangles. */
      readonly matchingSourceCells: number;
    };

/**
 * Construct the exact triangulated chart of an affine R4 section.
 *
 * The returned record carries per-triangle source-cell references and an exact
 * chart lift. It is renderer-independent and can therefore be consumed by
 * headless experiments, Three.js adapters, or tests through the same resolver.
 *
 * @param complex - R4 source with simplex 3-cells.
 * @param slice - Affine hyperplane and its retained 3D chart.
 * @param options - Optional source pose and marching tolerance.
 */
export function createAffineSectionCellChart4N(
  complex: CellComplex,
  slice: HyperplaneSlice4,
  options: {
    /** Source pose applied before sectioning. Must be R4. */
    readonly transform?: TransformN;
    /** Signed-distance degeneracy tolerance. Default `1e-9`. */
    readonly epsilon?: number;
  } = {}
): RepresentationCellChartN {
  if (complex.ambientDim !== 4) {
    throw new Error(
      `createAffineSectionCellChart4N: expected an R4 complex, got R${complex.ambientDim}`
    );
  }
  const transform = options.transform;
  if (transform !== undefined && transform.dim !== 4) {
    throw new Error(
      `createAffineSectionCellChart4N: transform must be R4, got R${transform.dim}`
    );
  }
  const epsilon = options.epsilon ?? 1e-9;
  if (!Number.isFinite(epsilon) || epsilon <= 0) {
    throw new Error(
      'createAffineSectionCellChart4N: epsilon must be finite and positive'
    );
  }

  const groups = complex.cellsOfDim(3)
    .filter((group) => group.kind === 'simplex' && group.verticesPerCell === 4);
  let indexLength = 0;
  for (const group of groups) indexLength += group.indices.length;

  const tets = new Uint32Array(indexLength);
  let offset = 0;
  for (const group of groups) {
    tets.set(group.indices, offset);
    offset += group.indices.length;
  }

  const sourceCells: SourceCellReferenceN[] = [];
  const lookupIndices = groups.map((group) => createSourceCellLookupN(group));
  for (let tet = 0; tet < tets.length / 4; tet++) {
    const vertices = tets.subarray(tet * 4, tet * 4 + 4);
    let reference: SourceCellReferenceN | undefined;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const found = lookupIndices[groupIndex]!.find(vertices);
      if (found.kind !== 'source-cell-lookup-match') continue;
      reference = createSourceCellReferenceN(
        complex,
        groups[groupIndex]!,
        found.cellIndex
      );
      break;
    }
    if (reference === undefined) {
      throw new Error(
        `createAffineSectionCellChart4N: tetrahedron ${tet} is not a cell of its source groups`
      );
    }
    sourceCells.push(reference);
  }

  const worldPositions = new Float64Array(complex.positions.length);
  if (transform === undefined) {
    worldPositions.set(complex.positions);
  } else {
    transform.applyToPositions(complex.positions, worldPositions, complex.vertexCount);
  }
  const ambientPositions = new Float64Array((tets.length / 4) * 24);
  const trianglePositions = new Float64Array((tets.length / 4) * 18);
  const sourceCellIndices = new Uint32Array((tets.length / 4) * 2);
  const vertexCount = sliceTetrahedraAmbient(
    worldPositions,
    tets,
    slice,
    ambientPositions,
    epsilon,
    sourceCellIndices
  );
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const ambientBase = vertex * 4;
    for (let axis = 0; axis < 3; axis++) {
      const basis = slice.basis[axis]!;
      trianglePositions[vertex * 3 + axis] =
        basis[0]! * ambientPositions[ambientBase]! +
        basis[1]! * ambientPositions[ambientBase + 1]! +
        basis[2]! * ambientPositions[ambientBase + 2]! +
        basis[3]! * ambientPositions[ambientBase + 3]!;
    }
  }

  return Object.freeze({
    kind: 'representation-cell-chart' as const,
    lineage: createRepresentationLineageN(4, [
      affineSectionMapRecipe4(slice),
      affineSliceChartMapRecipe4(slice)
    ]),
    trianglePositions,
    triangleCount: vertexCount / 3,
    sourceCellIndices,
    sourceCells: Object.freeze(sourceCells),
    pointLift: Object.freeze({
      kind: 'exact' as const,
      lift: (point: ArrayLike<number>) => new VecN(slice.embedPoint(point))
    }),
    ...(transform === undefined ? {} : { sourceTransform: transform.clone() })
  });
}

/**
 * Resolve a point in a triangulated representation chart to its source cell.
 *
 * Containment chooses a rendered triangle, retained provenance chooses the
 * source cell, and an exact chart lift is projected onto that source simplex
 * to produce a local barycentric coordinate. No inverse is invented for a
 * projection: the cell remains resolved from its retained record while
 * `sourceCoordinate` reports `projection-ambiguous`.
 */
export function resolveRepresentationChartPointToSourceCellN(
  chart: RepresentationCellChartN,
  point: ArrayLike<number>,
  options: {
    /**
     * Known rendered triangle, such as a Three.js `faceIndex`. Supplying it
     * disambiguates points on a boundary shared by multiple source cells.
     */
    readonly triangleIndex?: number;
    /** Chart-space containment tolerance. Default `1e-6`. */
    readonly chartTolerance?: number;
    /** Source-space coordinate residual tolerance. Default `1e-9`. */
    readonly sourceTolerance?: number;
  } = {}
): RepresentationChartSourceCellResolutionN {
  validateChart(chart);
  assertFinitePoint3(point);
  const chartTolerance = positiveTolerance(
    options.chartTolerance ?? 1e-6,
    'resolveRepresentationChartPointToSourceCellN: chartTolerance'
  );
  const sourceTolerance = positiveTolerance(
    options.sourceTolerance ?? 1e-9,
    'resolveRepresentationChartPointToSourceCellN: sourceTolerance'
  );

  const matches: number[] = [];
  if (options.triangleIndex !== undefined) {
    const triangle = options.triangleIndex;
    if (!Number.isSafeInteger(triangle) || triangle < 0 || triangle >= chart.triangleCount) {
      throw new Error(
        `resolveRepresentationChartPointToSourceCellN: triangleIndex ${triangle} out of range`
      );
    }
    if (containsChartPoint(chart.trianglePositions, triangle * 9, point, chartTolerance)) {
      matches.push(triangle);
    }
  } else {
    for (let triangle = 0; triangle < chart.triangleCount; triangle++) {
      if (containsChartPoint(chart.trianglePositions, triangle * 9, point, chartTolerance)) {
        matches.push(triangle);
      }
    }
  }
  if (matches.length === 0) {
    return unavailable('outside-representation', 0, 0);
  }

  const cells = new Map<number, number>();
  for (const triangle of matches) {
    const sourceCell = chart.sourceCellIndices[triangle];
    if (
      sourceCell === undefined ||
      !Number.isSafeInteger(sourceCell) ||
      sourceCell < 0 ||
      sourceCell >= chart.sourceCells.length
    ) {
      return unavailable('source-cell-record-missing', matches.length, cells.size);
    }
    if (!cells.has(sourceCell)) cells.set(sourceCell, triangle);
  }
  if (cells.size !== 1) {
    return unavailable('ambiguous-source-cell', matches.length, cells.size);
  }

  const [sourceCellIndex, triangleIndex] = cells.entries().next().value as [
    number,
    number
  ];
  const reference = chart.sourceCells[sourceCellIndex]!;
  if (inspectSourceCellReferenceN(reference).kind !== 'current') {
    return unavailable('source-cell-retired', matches.length, 1);
  }
  if (
    reference.cellKind !== 'simplex' ||
    reference.vertexIndices.length !== reference.intrinsicDim + 1
  ) {
    return unavailable('source-cell-not-simplex', matches.length, 1);
  }
  if (chart.pointLift.kind === 'unavailable') {
    return {
      kind: 'resolved',
      reference,
      triangleIndex,
      sourceCoordinate: {
        kind: 'unavailable',
        reason: chart.pointLift.reason
      }
    };
  }

  const ambientPoint = chart.pointLift.lift(point);
  if (ambientPoint.dim !== reference.complex.ambientDim) {
    throw new Error(
      `resolveRepresentationChartPointToSourceCellN: point lift returned R${ambientPoint.dim}, source is R${reference.complex.ambientDim}`
    );
  }
  const sourcePoint = chart.sourceTransform === undefined
    ? ambientPoint
    : chart.sourceTransform.inverse().applyToPoint(ambientPoint);
  const simplex = createSourceSimplexReferenceN(reference);
  const projected = projectPointToSourceSimplexN(simplex, sourcePoint.data, {
    tolerance: sourceTolerance
  });
  const sourceResidual = Math.sqrt(projected.squaredDistance);
  let scale = 1;
  for (const value of sourcePoint.data) scale = Math.max(scale, Math.abs(value));
  if (sourceResidual > sourceTolerance * scale) {
    return unavailable('source-coordinate-mismatch', matches.length, 1);
  }

  return {
    kind: 'resolved',
    reference,
    triangleIndex,
    sourceCoordinate: {
      kind: 'exact',
      ambientPoint,
      coordinate: projected.coordinate,
      sourceResidual
    }
  };
}

function unavailable(
  reason: Extract<
    RepresentationChartSourceCellResolutionN,
    { readonly kind: 'unavailable' }
  >['reason'],
  matchingTriangles: number,
  matchingSourceCells: number
): Extract<
  RepresentationChartSourceCellResolutionN,
  { readonly kind: 'unavailable' }
> {
  return { kind: 'unavailable', reason, matchingTriangles, matchingSourceCells };
}

function validateChart(chart: RepresentationCellChartN): void {
  if (chart.kind !== 'representation-cell-chart') {
    throw new Error(
      'resolveRepresentationChartPointToSourceCellN: expected a 3D representation-cell-chart'
    );
  }
  if (!Number.isSafeInteger(chart.triangleCount) || chart.triangleCount < 0) {
    throw new Error(
      'resolveRepresentationChartPointToSourceCellN: triangleCount must be a non-negative integer'
    );
  }
  if (chart.trianglePositions.length < chart.triangleCount * 9) {
    throw new Error(
      'resolveRepresentationChartPointToSourceCellN: trianglePositions buffer is too small'
    );
  }
  if (chart.sourceCellIndices.length < chart.triangleCount) {
    throw new Error(
      'resolveRepresentationChartPointToSourceCellN: sourceCellIndices buffer is too small'
    );
  }
}

function assertFinitePoint3(point: ArrayLike<number>): void {
  if (point.length !== 3) {
    throw new Error(
      `resolveRepresentationChartPointToSourceCellN: expected a 3D chart point, got ${point.length}D`
    );
  }
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(point[axis])) {
      throw new Error(
        'resolveRepresentationChartPointToSourceCellN: chart point must be finite'
      );
    }
  }
}

function positiveTolerance(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be finite and positive`);
  }
  return value;
}

/** Barycentric point containment in one packed 3D triangle. */
function containsChartPoint(
  positions: ArrayLike<number>,
  base: number,
  point: ArrayLike<number>,
  tolerance: number
): boolean {
  const ax = positions[base]!, ay = positions[base + 1]!, az = positions[base + 2]!;
  const bx = positions[base + 3]!, by = positions[base + 4]!, bz = positions[base + 5]!;
  const cx = positions[base + 6]!, cy = positions[base + 7]!, cz = positions[base + 8]!;
  const v0x = bx - ax, v0y = by - ay, v0z = bz - az;
  const v1x = cx - ax, v1y = cy - ay, v1z = cz - az;
  const v2x = point[0]! - ax, v2y = point[1]! - ay, v2z = point[2]! - az;
  const d00 = v0x * v0x + v0y * v0y + v0z * v0z;
  const d01 = v0x * v1x + v0y * v1y + v0z * v1z;
  const d11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const d20 = v2x * v0x + v2y * v0y + v2z * v0z;
  const d21 = v2x * v1x + v2y * v1y + v2z * v1z;
  const denominator = d00 * d11 - d01 * d01;
  if (!(Math.abs(denominator) > 0)) return false;
  const v = (d11 * d20 - d01 * d21) / denominator;
  const w = (d00 * d21 - d01 * d20) / denominator;
  const u = 1 - v - w;
  if (u < -tolerance || v < -tolerance || w < -tolerance) return false;
  const px = ax + v * v0x + w * v1x;
  const py = ay + v * v0y + w * v1y;
  const pz = az + v * v0z + w * v1z;
  return Math.hypot(px - point[0]!, py - point[1]!, pz - point[2]!) <= tolerance;
}
