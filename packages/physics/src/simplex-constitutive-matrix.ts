import { MatN } from '@holotope/core';

/** Internal Cholesky inverse for a symmetric positive-definite material metric. */
export function inversePositiveDefiniteN(matrix: MatN, caller: string): MatN {
  const lower = new MatN(matrix.n);
  for (let row = 0; row < matrix.n; row++) {
    for (let column = 0; column <= row; column++) {
      let value = matrix.get(row, column);
      for (let k = 0; k < column; k++) {
        value -= lower.get(row, k) * lower.get(column, k);
      }
      if (row === column) {
        if (!(value > 0) || !Number.isFinite(value)) {
          throw new Error(`${caller}: current metric must be positive definite`);
        }
        lower.set(row, column, Math.sqrt(value));
      } else {
        const entry = value / lower.get(column, column);
        if (!Number.isFinite(entry)) {
          throw new Error(`${caller}: current metric factor is outside the Float64 range`);
        }
        lower.set(row, column, entry);
      }
    }
  }

  const inverseLower = new MatN(matrix.n);
  for (let column = 0; column < matrix.n; column++) {
    for (let row = 0; row < matrix.n; row++) {
      let value = row === column ? 1 : 0;
      for (let k = 0; k < row; k++) {
        value -= lower.get(row, k) * inverseLower.get(k, column);
      }
      value /= lower.get(row, row);
      if (!Number.isFinite(value)) {
        throw new Error(`${caller}: inverse current metric is outside the Float64 range`);
      }
      inverseLower.set(row, column, value);
    }
  }
  return inverseLower.transpose().multiply(inverseLower);
}
