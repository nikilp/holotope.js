import type { CellComplex } from '../geometry/cell-complex.js';
import { MatN } from '../math/matn.js';
import {
  symmetricEigenDecomposition,
  type SymmetricEigenOptions,
  type SymmetricEigensystem
} from './symmetric-eigen.js';

export interface GraphLaplacianDiagnostics {
  readonly inputEdgeCount: number;
  readonly uniqueEdgeCount: number;
  readonly duplicateEdgeCount: number;
}

/** The unweighted combinatorial Laplacian of a CellComplex 1-skeleton. */
export interface GraphLaplacianOperator {
  readonly vertexCount: number;
  /** Canonical undirected pairs [minVertex, maxVertex], sorted lexicographically. */
  readonly edges: Uint32Array;
  readonly degrees: Uint32Array;
  /** Canonical connected-component IDs, ordered by each component's first vertex. */
  readonly componentOfVertex: Uint32Array;
  readonly componentCount: number;
  readonly diagnostics: GraphLaplacianDiagnostics;

  /** Applies Lx in O(V + E), supporting out === values. */
  apply(values: ArrayLike<number>, out?: Float64Array): Float64Array;
  /** Materializes the exact-integer Float64 reference matrix D - A. */
  toDense(): MatN;
}

export interface EigenvalueCluster {
  readonly start: number;
  readonly multiplicity: number;
  readonly value: number;
  readonly minimum: number;
  readonly maximum: number;
}

export interface GraphLaplacianModesOptions extends SymmetricEigenOptions {
  /** Relative gap used to group adjacent numerical eigenvalues. */
  clusterTolerance?: number;
}

export interface GraphLaplacianModes {
  readonly operator: GraphLaplacianOperator;
  readonly eigensystem: SymmetricEigensystem;
  readonly clusters: readonly EigenvalueCluster[];
}

const DEFAULT_CLUSTER_TOLERANCE = 1e-10;

/**
 * Builds L = D - A from all 1-cell groups in a CellComplex.
 *
 * The 1-skeleton is interpreted as a simple undirected graph. Repeated and
 * reversed edges are deduplicated and reported; self-loops and non-edge
 * 1-cell arities are rejected because their Laplacian semantics are not
 * implicit in this contract.
 */
export function graphLaplacian(complex: CellComplex): GraphLaplacianOperator {
  const vertexCount = complex.vertexCount;
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 1) {
    throw new Error('graphLaplacian: complex must contain at least one vertex');
  }

  const inputPairs: Array<readonly [number, number]> = [];
  for (const group of complex.cellsOfDim(1)) {
    if (group.verticesPerCell !== 2) {
      throw new Error('graphLaplacian: every 1-cell group must have verticesPerCell = 2');
    }
    for (let offset = 0; offset < group.indices.length; offset += 2) {
      const left = group.indices[offset]!;
      const right = group.indices[offset + 1]!;
      if (left === right) {
        throw new Error(`graphLaplacian: self-loop at vertex ${left} is not supported`);
      }
      inputPairs.push(left < right ? [left, right] : [right, left]);
    }
  }
  inputPairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const uniquePairs: Array<readonly [number, number]> = [];
  for (const pair of inputPairs) {
    const previous = uniquePairs[uniquePairs.length - 1];
    if (previous === undefined || previous[0] !== pair[0] || previous[1] !== pair[1]) {
      uniquePairs.push(pair);
    }
  }

  const edges = new Uint32Array(uniquePairs.length * 2);
  const degrees = new Uint32Array(vertexCount);
  for (let edge = 0; edge < uniquePairs.length; edge++) {
    const [left, right] = uniquePairs[edge]!;
    edges[edge * 2] = left;
    edges[edge * 2 + 1] = right;
    degrees[left]!++;
    degrees[right]!++;
  }

  const { componentOfVertex, componentCount } = connectedComponents(vertexCount, edges);
  const diagnostics: GraphLaplacianDiagnostics = {
    inputEdgeCount: inputPairs.length,
    uniqueEdgeCount: uniquePairs.length,
    duplicateEdgeCount: inputPairs.length - uniquePairs.length
  };
  return new CombinatorialGraphLaplacian(
    vertexCount,
    edges,
    degrees,
    componentOfVertex,
    componentCount,
    diagnostics
  );
}

/** Computes the complete dense modal basis of a CellComplex 1-skeleton. */
export function graphLaplacianModes(
  complex: CellComplex,
  options: GraphLaplacianModesOptions = {}
): GraphLaplacianModes {
  const clusterTolerance = options.clusterTolerance ?? DEFAULT_CLUSTER_TOLERANCE;
  if (!Number.isFinite(clusterTolerance) || clusterTolerance <= 0) {
    throw new Error('graphLaplacianModes: clusterTolerance must be finite and positive');
  }
  const operator = graphLaplacian(complex);
  const eigensystem = symmetricEigenDecomposition(operator.toDense(), {
    ...(options.tolerance === undefined ? {} : { tolerance: options.tolerance }),
    ...(options.symmetryTolerance === undefined
      ? {}
      : { symmetryTolerance: options.symmetryTolerance }),
    ...(options.maxSweeps === undefined ? {} : { maxSweeps: options.maxSweeps })
  });
  return {
    operator,
    eigensystem,
    clusters: clusterEigenvalues(eigensystem.values, clusterTolerance)
  };
}

/** Returns the basis-independent orthogonal projector for one mode cluster. */
export function eigenspaceProjector(
  eigensystem: SymmetricEigensystem,
  cluster: EigenvalueCluster
): MatN {
  const n = eigensystem.values.length;
  if (
    eigensystem.vectors.n !== n ||
    !Number.isSafeInteger(cluster.start) ||
    !Number.isSafeInteger(cluster.multiplicity) ||
    cluster.start < 0 ||
    cluster.multiplicity < 1 ||
    cluster.start + cluster.multiplicity > n
  ) {
    throw new Error('eigenspaceProjector: cluster is outside the eigensystem');
  }
  const projector = new MatN(n);
  const end = cluster.start + cluster.multiplicity;
  for (let col = cluster.start; col < end; col++) {
    for (let row = 0; row < n; row++) {
      const vr = eigensystem.vectors.get(row, col);
      for (let other = 0; other < n; other++) {
        projector.data[row * n + other]! += vr * eigensystem.vectors.get(other, col);
      }
    }
  }
  return projector;
}

class CombinatorialGraphLaplacian implements GraphLaplacianOperator {
  constructor(
    readonly vertexCount: number,
    readonly edges: Uint32Array,
    readonly degrees: Uint32Array,
    readonly componentOfVertex: Uint32Array,
    readonly componentCount: number,
    readonly diagnostics: GraphLaplacianDiagnostics
  ) {}

  apply(values: ArrayLike<number>, out?: Float64Array): Float64Array {
    if (values.length !== this.vertexCount) {
      throw new Error(`graphLaplacian.apply: expected ${this.vertexCount} values`);
    }
    const result = out ?? new Float64Array(this.vertexCount);
    if (result.length !== this.vertexCount) {
      throw new Error(`graphLaplacian.apply: expected an output of length ${this.vertexCount}`);
    }
    const source: ArrayLike<number> = values === result ? result.slice() : values;
    result.fill(0);
    for (let offset = 0; offset < this.edges.length; offset += 2) {
      const left = this.edges[offset]!;
      const right = this.edges[offset + 1]!;
      const delta = source[left]! - source[right]!;
      result[left]! += delta;
      result[right]! -= delta;
    }
    return result;
  }

  toDense(): MatN {
    const matrix = new MatN(this.vertexCount);
    for (let vertex = 0; vertex < this.vertexCount; vertex++) {
      matrix.set(vertex, vertex, this.degrees[vertex]!);
    }
    for (let offset = 0; offset < this.edges.length; offset += 2) {
      const left = this.edges[offset]!;
      const right = this.edges[offset + 1]!;
      matrix.set(left, right, -1).set(right, left, -1);
    }
    return matrix;
  }
}

function connectedComponents(
  vertexCount: number,
  edges: Uint32Array
): { componentOfVertex: Uint32Array; componentCount: number } {
  const parent = new Uint32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) parent[vertex] = vertex;

  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root]!;
    let vertex = start;
    while (parent[vertex] !== vertex) {
      const next = parent[vertex]!;
      parent[vertex] = root;
      vertex = next;
    }
    return root;
  };

  for (let offset = 0; offset < edges.length; offset += 2) {
    const leftRoot = find(edges[offset]!);
    const rightRoot = find(edges[offset + 1]!);
    if (leftRoot !== rightRoot) {
      // Always retain the smaller root, making it the first vertex in its component.
      parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
    }
  }

  const roots = new Uint32Array(vertexCount);
  const uniqueRoots: number[] = [];
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const root = find(vertex);
    roots[vertex] = root;
    if (root === vertex) uniqueRoots.push(root);
  }
  const componentByRoot = new Map(uniqueRoots.map((root, index) => [root, index]));
  const componentOfVertex = new Uint32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    componentOfVertex[vertex] = componentByRoot.get(roots[vertex]!)!;
  }
  return { componentOfVertex, componentCount: uniqueRoots.length };
}

function clusterEigenvalues(
  values: Float64Array,
  tolerance: number
): readonly EigenvalueCluster[] {
  const clusters: EigenvalueCluster[] = [];
  let start = 0;
  while (start < values.length) {
    let end = start + 1;
    while (end < values.length) {
      const previous = values[end - 1]!;
      const current = values[end]!;
      const scale = Math.max(1, Math.abs(previous), Math.abs(current));
      if (Math.abs(current - previous) > tolerance * scale) break;
      end++;
    }
    let sum = 0;
    for (let index = start; index < end; index++) sum += values[index]!;
    clusters.push({
      start,
      multiplicity: end - start,
      value: sum / (end - start),
      minimum: values[start]!,
      maximum: values[end - 1]!
    });
    start = end;
  }
  return clusters;
}
