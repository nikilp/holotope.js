import { MatN } from '../math/matn.js';

export interface SymmetricEigenOptions {
  /** Relative convergence threshold for the off-diagonal Frobenius norm. */
  tolerance?: number;
  /** Relative tolerance used to validate that the input is symmetric. */
  symmetryTolerance?: number;
  /** Maximum number of complete cyclic Jacobi sweeps. */
  maxSweeps?: number;
}

export interface SymmetricEigensystem {
  /** Eigenvalues in ascending order. */
  readonly values: Float64Array;
  /** Orthonormal eigenvectors stored as columns. */
  readonly vectors: MatN;
  /** Absolute Euclidean residual ||A v_i - lambda_i v_i|| for each pair. */
  readonly residualNorms: Float64Array;
  readonly sweeps: number;
  readonly rotations: number;
  readonly maxResidual: number;
  /** Max absolute entry of V^T V - I. */
  readonly orthogonalityError: number;
}

const DEFAULT_TOLERANCE = 1e-12;
const DEFAULT_SYMMETRY_TOLERANCE = 1e-12;
const DEFAULT_MAX_SWEEPS = 64;

/**
 * Deterministic Float64 eigendecomposition of a real symmetric matrix.
 *
 * A cyclic Jacobi iteration is used as the auditable dense reference path.
 * It is intentionally not a sparse large-matrix solver. Equal and nearly
 * equal eigenvalues define an invariant eigenspace, but the individual basis
 * vectors returned inside that space are not mathematically unique.
 */
export function symmetricEigenDecomposition(
  matrix: MatN,
  options: SymmetricEigenOptions = {}
): SymmetricEigensystem {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const symmetryTolerance = options.symmetryTolerance ?? DEFAULT_SYMMETRY_TOLERANCE;
  const maxSweeps = options.maxSweeps ?? DEFAULT_MAX_SWEEPS;
  validatePositiveFinite('tolerance', tolerance);
  validatePositiveFinite('symmetryTolerance', symmetryTolerance);
  if (!Number.isSafeInteger(maxSweeps) || maxSweeps < 1) {
    throw new Error('symmetricEigenDecomposition: maxSweeps must be a positive integer');
  }
  if (!Number.isSafeInteger(matrix.n) || matrix.n < 1) {
    throw new Error('symmetricEigenDecomposition: matrix dimension must be positive');
  }

  const n = matrix.n;
  const original = matrix.clone();
  const a = matrix.clone();
  let frobeniusNorm = 0;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const value = original.get(row, col);
      if (!Number.isFinite(value)) {
        throw new Error('symmetricEigenDecomposition: matrix entries must be finite');
      }
      frobeniusNorm = Math.hypot(frobeniusNorm, value);
    }
    for (let col = row + 1; col < n; col++) {
      const upper = original.get(row, col);
      const lower = original.get(col, row);
      const scale = Math.max(1, Math.abs(upper), Math.abs(lower));
      if (Math.abs(upper - lower) > symmetryTolerance * scale) {
        throw new Error('symmetricEigenDecomposition: matrix must be symmetric');
      }
      // The validation above is the policy boundary. Averaging only removes
      // last-bit disagreement before the symmetric Jacobi updates begin.
      const average = 0.5 * upper + 0.5 * lower;
      a.set(row, col, average).set(col, row, average);
    }
  }

  const convergenceScale = frobeniusNorm > 0 ? frobeniusNorm : 1;
  const threshold = tolerance * convergenceScale;
  const vectors = MatN.identity(n);
  let sweeps = 0;
  let rotations = 0;
  let converged = offDiagonalFrobeniusNorm(a) <= threshold;

  while (!converged && sweeps < maxSweeps) {
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a.get(p, q);
        if (apq === 0) continue;
        const app = a.get(p, p);
        const aqq = a.get(q, q);
        const pivotScale = Math.max(Math.abs(app), Math.abs(aqq), Math.abs(apq));
        const scaledDelta = aqq / pivotScale - app / pivotScale;
        const scaledApq = apq / pivotScale;
        const tangent = scaledDelta === 0
          ? 1
          : (2 * scaledApq) /
            (scaledDelta +
              Math.sign(scaledDelta) * Math.hypot(scaledDelta, 2 * scaledApq));
        const cosine = 1 / Math.hypot(1, tangent);
        const sine = tangent * cosine;

        for (let k = 0; k < n; k++) {
          if (k === p || k === q) continue;
          const akp = a.get(k, p);
          const akq = a.get(k, q);
          const newKp = cosine * akp - sine * akq;
          const newKq = sine * akp + cosine * akq;
          a.set(k, p, newKp).set(p, k, newKp);
          a.set(k, q, newKq).set(q, k, newKq);
        }
        a.set(p, p, app - tangent * apq);
        a.set(q, q, aqq + tangent * apq);
        a.set(p, q, 0).set(q, p, 0);

        for (let row = 0; row < n; row++) {
          const vip = vectors.get(row, p);
          const viq = vectors.get(row, q);
          vectors.set(row, p, cosine * vip - sine * viq);
          vectors.set(row, q, sine * vip + cosine * viq);
        }
        rotations++;
      }
    }
    sweeps++;
    converged = offDiagonalFrobeniusNorm(a) <= threshold;
  }

  if (!converged) {
    throw new Error(
      `symmetricEigenDecomposition: failed to converge within ${maxSweeps} sweeps`
    );
  }

  const order = Array.from({ length: n }, (_, index) => index)
    .sort((left, right) => a.get(left, left) - a.get(right, right));
  const values = new Float64Array(n);
  const orderedVectors = new MatN(n);
  for (let col = 0; col < n; col++) {
    const sourceCol = order[col]!;
    values[col] = a.get(sourceCol, sourceCol);
    let largestRow = 0;
    let largestMagnitude = -1;
    for (let row = 0; row < n; row++) {
      const value = vectors.get(row, sourceCol);
      orderedVectors.set(row, col, value);
      const magnitude = Math.abs(value);
      if (magnitude > largestMagnitude) {
        largestMagnitude = magnitude;
        largestRow = row;
      }
    }
    // Fix the arbitrary sign for deterministic non-degenerate eigenvectors.
    // This does not assign a canonical basis to a repeated eigenspace.
    if (orderedVectors.get(largestRow, col) < 0) {
      for (let row = 0; row < n; row++) {
        orderedVectors.set(row, col, -orderedVectors.get(row, col));
      }
    }
  }

  const residualNorms = new Float64Array(n);
  let maxResidual = 0;
  for (let col = 0; col < n; col++) {
    let norm = 0;
    for (let row = 0; row < n; row++) {
      let applied = 0;
      for (let k = 0; k < n; k++) {
        applied += original.get(row, k) * orderedVectors.get(k, col);
      }
      const residual = applied - values[col]! * orderedVectors.get(row, col);
      norm = Math.hypot(norm, residual);
    }
    residualNorms[col] = norm;
    maxResidual = Math.max(maxResidual, norm);
  }

  return {
    values,
    vectors: orderedVectors,
    residualNorms,
    sweeps,
    rotations,
    maxResidual,
    orthogonalityError: orderedVectors.orthogonalityError()
  };
}

function offDiagonalFrobeniusNorm(matrix: MatN): number {
  let norm = 0;
  for (let row = 0; row < matrix.n; row++) {
    for (let col = row + 1; col < matrix.n; col++) {
      const value = matrix.get(row, col);
      norm = Math.hypot(norm, value, value);
    }
  }
  return norm;
}

function validatePositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`symmetricEigenDecomposition: ${name} must be finite and positive`);
  }
}
