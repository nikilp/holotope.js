import type { TransformN } from '../math/transform.js';
import type { VecN } from '../math/vecn.js';
import type { RepresentationLineageN } from './map.js';
import type { SourceCellReferenceN } from './source-reference.js';
import type { SourceSimplexCoordinateN } from './source-simplex-coordinate.js';

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
   * Numerical defaults appropriate for the buffers carried by this chart.
   * Omitted legacy/user-authored charts use `chart=1e-6`, `source=1e-9`.
   */
  readonly defaultTolerances?: {
    /** Default chart-space containment tolerance. */
    readonly chart: number;
    /** Default source-space reconstruction-residual tolerance. */
    readonly source: number;
  };
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
