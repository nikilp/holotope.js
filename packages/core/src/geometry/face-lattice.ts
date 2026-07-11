/**
 * Canonical face lattice: the complete incidence structure of a polytope,
 * kept separate from the render-oriented `CellComplex`. `CellComplex`
 * stores homogeneous fixed-arity groups for rendering; a `FaceLattice`
 * stores every k-face with ragged arities plus the boundary maps between
 * consecutive layers. Wythoff-constructed polytopes are born as face
 * lattices and compiled down to cell complexes.
 */

/** Ragged array of index tuples: item i is data[offsets[i] … offsets[i+1]). */
export interface RaggedIndexBuffer {
  /** Length = itemCount + 1. */
  readonly offsets: Uint32Array;
  /** Concatenated item data. */
  readonly data: Uint32Array;
}

export function buildRagged(items: ReadonlyArray<ReadonlyArray<number>>): RaggedIndexBuffer {
  const offsets = new Uint32Array(items.length + 1);
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i]!.length;
    offsets[i + 1] = total;
  }
  const data = new Uint32Array(total);
  for (let i = 0; i < items.length; i++) data.set(items[i]!, offsets[i]!);
  return { offsets, data };
}

export function raggedCount(buffer: RaggedIndexBuffer): number {
  return buffer.offsets.length - 1;
}

/** Item `i` as a subarray view (no copy). */
export function raggedItem(buffer: RaggedIndexBuffer, i: number): Uint32Array {
  return buffer.data.subarray(buffer.offsets[i]!, buffer.offsets[i + 1]!);
}

/** All k-faces of one dimension. */
export interface FaceLayer {
  /**
   * Vertex set of each face. For 2-faces the vertices are stored in
   * canonical cyclic (loop) order; other layers are order-insensitive.
   */
  readonly vertices: RaggedIndexBuffer;
  /** Orbit/type of each face under the constructing symmetry group. */
  readonly typeId: Uint16Array;
}

export interface FaceLattice {
  readonly rank: number;
  readonly vertexCount: number;
  /** layers[k] holds all k-faces, k = 1 … rank − 1. layers[0] is trivial. */
  readonly layers: ReadonlyArray<FaceLayer | undefined>;
  /**
   * boundary[k] maps each k-face to its incident (k−1)-face IDs.
   * boundary[0] and boundary[1] may be undefined (edge boundaries are
   * the edge vertex pairs themselves).
   */
  readonly boundary: ReadonlyArray<RaggedIndexBuffer | undefined>;
}

/** Face counts by dimension: [vertices, edges, 2-faces, …]. */
export function fVector(lattice: FaceLattice): number[] {
  const f = [lattice.vertexCount];
  for (let k = 1; k < lattice.rank; k++) {
    const layer = lattice.layers[k];
    f.push(layer ? raggedCount(layer.vertices) : 0);
  }
  return f;
}

/** Alternating-sum Euler characteristic of the boundary complex. */
export function eulerCharacteristic(lattice: FaceLattice): number {
  return fVector(lattice).reduce((acc, n, k) => acc + (k % 2 === 0 ? n : -n), 0);
}
