import { MatN, VecN } from '@holotope/core';
import type { SimplexConstitutiveEvaluationN } from './simplex-constitutive.js';

/**
 * Matrix-free directional curvature evidence for one simplex energy.
 *
 * `products[i]` is the derivative of the current-position gradient at vertex
 * `i`, hence the mathematical potential `Hessian(U) * direction`.
 */
export interface SimplexConstitutiveHessianVectorEvaluationN<
  TEvaluation extends SimplexConstitutiveEvaluationN<unknown>
> {
  /** Constitutive energy and gradient at the unperturbed positions. */
  readonly base: TEvaluation;
  /** Defensive direction copies in simplex-vertex order. */
  readonly directions: readonly VecN[];
  /** Directional derivative of the intrinsic right Cauchy–Green tensor. */
  readonly directionalRightCauchyGreen: MatN;
  /** Directional derivative of the law's second Piola stress. */
  readonly directionalSecondPiolaStress: MatN;
  /** Potential Hessian-vector products in simplex-vertex order. */
  readonly products: readonly VecN[];
  /** Norm of the summed products; translation invariance makes it zero. */
  readonly netProductResidual: number;
}

interface PreparedSimplexConstitutiveHessianVectorN<
  TEvaluation extends SimplexConstitutiveEvaluationN<unknown>
> {
  readonly caller: string;
  readonly base: TEvaluation;
  readonly currentPositions: readonly VecN[];
  readonly directions: readonly VecN[];
  readonly inverseRestFactor: MatN;
  readonly directionalRightCauchyGreen: MatN;
}

/** Internal directional kinematics shared by every simplex constitutive law. */
export function prepareSimplexConstitutiveHessianVectorN<
  TEvaluation extends SimplexConstitutiveEvaluationN<unknown>
>(
  caller: string,
  currentPositions: readonly VecN[],
  directions: readonly VecN[],
  base: TEvaluation
): PreparedSimplexConstitutiveHessianVectorN<TEvaluation> {
  const { ambientDimension, simplexDimension, restMetric } = base.deformation;
  if (currentPositions.length !== simplexDimension + 1) {
    throw new Error(`${caller}: current position count mismatch`);
  }
  if (directions.length !== currentPositions.length) {
    throw new Error(`${caller}: direction count must match simplex vertices`);
  }
  const copiedDirections = directions.map((direction, vertex) => {
    if (!(direction instanceof VecN) || direction.dim !== ambientDimension) {
      throw new Error(`${caller}: direction ${vertex} must be R${ambientDimension}`);
    }
    for (const coordinate of direction.data) {
      if (!Number.isFinite(coordinate)) {
        throw new Error(`${caller}: direction ${vertex} must be finite`);
      }
    }
    return direction.clone();
  });

  const inverseRestFactor = inverseLowerTriangular(
    choleskyPositive(restMetric, caller),
    caller
  );
  const directionalCurrentMetric = new MatN(simplexDimension);
  const origin = currentPositions[0]!;
  const originDirection = copiedDirections[0]!;
  for (let row = 0; row < simplexDimension; row++) {
    for (let column = row; column < simplexDimension; column++) {
      let value = 0;
      for (let axis = 0; axis < ambientDimension; axis++) {
        const rowEdge =
          currentPositions[row + 1]!.data[axis]! - origin.data[axis]!;
        const columnEdge =
          currentPositions[column + 1]!.data[axis]! - origin.data[axis]!;
        const rowDirection =
          copiedDirections[row + 1]!.data[axis]! - originDirection.data[axis]!;
        const columnDirection =
          copiedDirections[column + 1]!.data[axis]! - originDirection.data[axis]!;
        value += rowDirection * columnEdge + rowEdge * columnDirection;
      }
      if (!Number.isFinite(value)) {
        throw new Error(`${caller}: directional current metric is outside Float64`);
      }
      directionalCurrentMetric
        .set(row, column, value)
        .set(column, row, value);
    }
  }
  const directionalRightCauchyGreen = inverseRestFactor
    .multiply(directionalCurrentMetric)
    .multiply(inverseRestFactor.transpose());
  symmetrizeInPlace(directionalRightCauchyGreen);
  assertFiniteMatrix(
    directionalRightCauchyGreen,
    `${caller}: directional right Cauchy-Green`
  );

  return {
    caller,
    base,
    currentPositions,
    directions: Object.freeze(copiedDirections),
    inverseRestFactor,
    directionalRightCauchyGreen
  };
}

/** Internal gradient-product completion from a directional second Piola stress. */
export function completeSimplexConstitutiveHessianVectorN<
  TEvaluation extends SimplexConstitutiveEvaluationN<unknown>
>(
  prepared: PreparedSimplexConstitutiveHessianVectorN<TEvaluation>,
  directionalSecondPiolaStress: MatN
): SimplexConstitutiveHessianVectorEvaluationN<TEvaluation> {
  const {
    caller,
    base,
    currentPositions,
    directions,
    inverseRestFactor,
    directionalRightCauchyGreen
  } = prepared;
  const { ambientDimension, simplexDimension } = base.deformation;
  if (
    !(directionalSecondPiolaStress instanceof MatN) ||
    directionalSecondPiolaStress.n !== simplexDimension
  ) {
    throw new Error(`${caller}: directional second Piola stress dimension mismatch`);
  }
  assertFiniteMatrix(
    directionalSecondPiolaStress,
    `${caller}: directional second Piola stress`
  );

  const materialGradient = inverseRestFactor
    .transpose()
    .multiply(base.secondPiolaStress)
    .multiply(inverseRestFactor);
  const directionalMaterialGradient = inverseRestFactor
    .transpose()
    .multiply(directionalSecondPiolaStress)
    .multiply(inverseRestFactor);
  const products = Array.from(
    { length: simplexDimension + 1 },
    () => new VecN(ambientDimension)
  );
  const origin = currentPositions[0]!;
  const originDirection = directions[0]!;
  for (let vertex = 0; vertex < simplexDimension; vertex++) {
    const product = products[vertex + 1]!;
    for (let axis = 0; axis < ambientDimension; axis++) {
      let value = 0;
      for (let edge = 0; edge < simplexDimension; edge++) {
        const currentEdge =
          currentPositions[edge + 1]!.data[axis]! - origin.data[axis]!;
        const directionEdge =
          directions[edge + 1]!.data[axis]! - originDirection.data[axis]!;
        value +=
          directionEdge * materialGradient.get(edge, vertex) +
          currentEdge * directionalMaterialGradient.get(edge, vertex);
      }
      value *= base.restMeasure;
      if (!Number.isFinite(value)) {
        throw new Error(`${caller}: Hessian-vector product is outside Float64`);
      }
      product.data[axis] = value;
      products[0]!.data[axis] = products[0]!.data[axis]! - value;
    }
  }

  let netProductResidual = 0;
  for (let axis = 0; axis < ambientDimension; axis++) {
    let sum = 0;
    for (const product of products) sum += product.data[axis]!;
    netProductResidual = Math.hypot(netProductResidual, sum);
  }
  if (!Number.isFinite(netProductResidual)) {
    throw new Error(`${caller}: net product residual is outside Float64`);
  }

  return Object.freeze({
    base,
    directions,
    directionalRightCauchyGreen,
    directionalSecondPiolaStress,
    products: Object.freeze(products),
    netProductResidual
  });
}

function choleskyPositive(matrix: MatN, caller: string): MatN {
  const lower = new MatN(matrix.n);
  for (let row = 0; row < matrix.n; row++) {
    for (let column = 0; column <= row; column++) {
      let value = matrix.get(row, column);
      for (let k = 0; k < column; k++) {
        value -= lower.get(row, k) * lower.get(column, k);
      }
      if (row === column) {
        if (!(value > 0) || !Number.isFinite(value)) {
          throw new Error(`${caller}: rest metric must be positive definite`);
        }
        lower.set(row, column, Math.sqrt(value));
      } else {
        const entry = value / lower.get(column, column);
        if (!Number.isFinite(entry)) {
          throw new Error(`${caller}: rest factor is outside Float64`);
        }
        lower.set(row, column, entry);
      }
    }
  }
  return lower;
}

function inverseLowerTriangular(lower: MatN, caller: string): MatN {
  const inverse = new MatN(lower.n);
  for (let column = 0; column < lower.n; column++) {
    for (let row = 0; row < lower.n; row++) {
      let value = row === column ? 1 : 0;
      for (let k = 0; k < row; k++) {
        value -= lower.get(row, k) * inverse.get(k, column);
      }
      value /= lower.get(row, row);
      if (!Number.isFinite(value)) {
        throw new Error(`${caller}: inverse rest factor is outside Float64`);
      }
      inverse.set(row, column, value);
    }
  }
  return inverse;
}

function symmetrizeInPlace(matrix: MatN): void {
  for (let row = 0; row < matrix.n; row++) {
    for (let column = row + 1; column < matrix.n; column++) {
      const value =
        0.5 * (matrix.get(row, column) + matrix.get(column, row));
      matrix.set(row, column, value).set(column, row, value);
    }
  }
}

function assertFiniteMatrix(matrix: MatN, label: string): void {
  for (const value of matrix.data) {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} is outside Float64`);
    }
  }
}
