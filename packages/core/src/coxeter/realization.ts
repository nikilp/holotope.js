import type { CoxeterDiagram } from './diagram.js';
import type { ExactValue } from './exact.js';

/**
 * Float64 realization of mirror-distance tuples as Cartesian points.
 *
 * With G the Gram matrix of the unit mirror normals (Gᵢᵢ = 1,
 * Gᵢⱼ = −cos(π/mᵢⱼ)) and N a matrix whose rows are the normals, a point
 * x has mirror distances d = N·x. Choosing N = L from the Cholesky
 * factorization G = L·Lᵀ fixes a deterministic frame; realizing a tuple
 * is one forward-substitution solve x = L⁻¹·d. Exact tuples convert to
 * Float64 exactly once, here at the boundary.
 */
export class CoxeterRealization {
  readonly rank: number;
  /** Lower-triangular Cholesky factor of the Gram matrix, row-major. */
  readonly choleskyL: Float64Array;

  constructor(diagram: CoxeterDiagram) {
    const n = (this.rank = diagram.rank);
    const G = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        G[i * n + j] = i === j ? 1 : -Math.cos(Math.PI / diagram.matrix[i]![j]!);
      }
    }
    const L = (this.choleskyL = new Float64Array(n * n));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let acc = G[i * n + j]!;
        for (let k = 0; k < j; k++) acc -= L[i * n + k]! * L[j * n + k]!;
        if (i === j) {
          if (acc <= 0) {
            throw new Error(`${diagram.id}: Gram matrix not positive definite (finite groups only)`);
          }
          L[i * n + i] = Math.sqrt(acc);
        } else {
          L[i * n + j] = acc / L[j * n + j]!;
        }
      }
    }
  }

  /** Solves L·x = d (forward substitution); writes and returns `out`. */
  realizeDistances(d: readonly number[], out?: Float64Array): Float64Array {
    const n = this.rank;
    const L = this.choleskyL;
    const x = out ?? new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = d[i]!;
      for (let k = 0; k < i; k++) acc -= L[i * n + k]! * x[k]!;
      x[i] = acc / L[i * n + i]!;
    }
    return x;
  }
}

/**
 * Realizes a whole orbit of exact tuples as packed Float64 Cartesian
 * positions (rank coordinates per point).
 */
export function realizeOrbit(
  diagram: CoxeterDiagram,
  tuples: ReadonlyArray<ReadonlyArray<ExactValue>>
): Float64Array {
  const realization = new CoxeterRealization(diagram);
  const n = diagram.rank;
  const positions = new Float64Array(tuples.length * n);
  const d = new Array<number>(n);
  const x = new Float64Array(n);
  for (let p = 0; p < tuples.length; p++) {
    for (let i = 0; i < n; i++) d[i] = diagram.ring.toNumber(tuples[p]![i]!);
    realization.realizeDistances(d, x);
    positions.set(x, p * n);
  }
  return positions;
}
