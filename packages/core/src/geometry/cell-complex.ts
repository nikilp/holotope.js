/**
 * Cell complexes: the N-dimensional counterpart of a mesh.
 *
 * A CellComplex stores vertex positions in ambient R^n plus groups of cells
 * organized by intrinsic dimension: 1-cells (edges), 2-cells (faces),
 * 3-cells (tetrahedra or cuboids), and so on. The ambient dimension is
 * explicit on the object and never inferred from buffer sizes, so
 * mixed-dimension bugs fail fast.
 */

/**
 * How to interpret a cell's vertex tuple: a simplex (any dim), a cuboid
 * (binary corner order), or a polygon — a planar 2-cell whose vertices
 * form a cyclically ordered loop of any arity ≥ 3.
 */
export type CellKind = 'simplex' | 'cuboid' | 'polygon';

/** A homogeneous group of k-cells sharing arity and interpretation. */
export interface CellGroup {
  /**
   * Optional author-supplied structural identity for this group.
   *
   * Keys must be unique inside one complex. They are not required for
   * rendering, but make source-cell ids stable across order-independent
   * regeneration and serialization boundaries.
   */
  key?: string;
  /** Intrinsic dimension of each cell (1 = edge, 2 = face, 3 = solid cell…). */
  dim: number;
  /** Number of vertex indices per cell (2 for an edge, 4 for a quad or tet…). */
  verticesPerCell: number;
  kind: CellKind;
  /** Flat vertex indices, length = cellCount * verticesPerCell. */
  indices: Uint32Array;
}

export class CellComplex {
  readonly ambientDim: number;
  /** Packed vertex coordinates, length = vertexCount * ambientDim. */
  positions: Float64Array;
  groups: CellGroup[];

  constructor(ambientDim: number, positions: Float64Array, groups: CellGroup[] = []) {
    if (positions.length % ambientDim !== 0) {
      throw new Error(
        `CellComplex: positions length ${positions.length} is not a multiple of ambientDim ${ambientDim}`
      );
    }
    this.ambientDim = ambientDim;
    this.positions = positions;
    this.groups = groups;
    for (const g of groups) this.validateGroup(g);
    this.validateUniqueExplicitKeys();
  }

  get vertexCount(): number {
    return this.positions.length / this.ambientDim;
  }

  cellsOfDim(dim: number): CellGroup[] {
    return this.groups.filter((g) => g.dim === dim);
  }

  cellCount(dim: number): number {
    let count = 0;
    for (const g of this.cellsOfDim(dim)) count += g.indices.length / g.verticesPerCell;
    return count;
  }

  addGroup(group: CellGroup): this {
    this.validateGroup(group);
    if (
      group.key !== undefined &&
      this.groups.some((existing) => existing.key === group.key)
    ) {
      throw new Error(`CellComplex: duplicate group key "${group.key}"`);
    }
    this.groups.push(group);
    return this;
  }

  /** Copies vertex `i` into `out` (length ambientDim), allocating if omitted. */
  getPosition(i: number, out?: Float64Array): Float64Array {
    const n = this.ambientDim;
    const result = out ?? new Float64Array(n);
    for (let c = 0; c < n; c++) result[c] = this.positions[i * n + c]!;
    return result;
  }

  private validateGroup(g: CellGroup): void {
    if (g.key !== undefined && (typeof g.key !== 'string' || g.key.trim().length === 0)) {
      throw new Error('CellComplex: group key must be a non-empty string');
    }
    if (g.indices.length % g.verticesPerCell !== 0) {
      throw new Error(
        `CellComplex: group indices length ${g.indices.length} is not a multiple of verticesPerCell ${g.verticesPerCell}`
      );
    }
    const vertexCount = this.vertexCount;
    for (const idx of g.indices) {
      if (idx >= vertexCount) {
        throw new Error(`CellComplex: cell index ${idx} out of range (${vertexCount} vertices)`);
      }
    }
  }

  private validateUniqueExplicitKeys(): void {
    const keys = new Set<string>();
    for (const group of this.groups) {
      if (group.key === undefined) continue;
      if (keys.has(group.key)) {
        throw new Error(`CellComplex: duplicate group key "${group.key}"`);
      }
      keys.add(group.key);
    }
  }
}
