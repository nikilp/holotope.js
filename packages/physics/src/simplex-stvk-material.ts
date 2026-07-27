import { MatN, VecN } from '@holotope/core';
import { evaluateSimplexMetricDeformationN } from './simplex-deformation.js';
import {
  completeSimplexConstitutiveEvaluationN,
  type SimplexConstitutiveEvaluationN
} from './simplex-constitutive.js';
import {
  completeSimplexConstitutiveHessianVectorN,
  prepareSimplexConstitutiveHessianVectorN,
  type SimplexConstitutiveHessianVectorEvaluationN
} from './simplex-constitutive-curvature.js';

/** Isotropic St. Venant–Kirchhoff parameters in intrinsic material coordinates. */
export interface SimplexStVenantKirchhoffMaterialN {
  readonly firstLameParameter: number;
  readonly shearModulus: number;
}

/** Energy, stress, and current-position gradient for one simplex element. */
export interface SimplexStVenantKirchhoffEvaluationN
  extends SimplexConstitutiveEvaluationN<SimplexStVenantKirchhoffMaterialN> {
  /** `lambda tr(E) I + 2 mu E` in P11's rest-material basis. */
  readonly secondPiolaStress: MatN;
}

/**
 * Evaluates an isotropic St. Venant–Kirchhoff material on a k-simplex in RN.
 *
 * This is a constitutive CPU reference, not a solver or inversion barrier.
 * Full-dimensional orientation evidence remains available on `deformation`.
 */
export function evaluateSimplexStVenantKirchhoffN(
  restPositions: readonly VecN[],
  currentPositions: readonly VecN[],
  material: SimplexStVenantKirchhoffMaterialN
): SimplexStVenantKirchhoffEvaluationN {
  const deformation = evaluateSimplexMetricDeformationN(
    restPositions,
    currentPositions
  );
  const simplexDimension = deformation.simplexDimension;
  const { firstLameParameter, shearModulus } = validateMaterial(
    material,
    simplexDimension
  );
  const volumetricModulus = firstLameParameter +
    2 * shearModulus / simplexDimension;

  const strain = deformation.greenLagrangeStrain;
  let trace = 0;
  let squaredNorm = 0;
  for (let row = 0; row < simplexDimension; row++) {
    trace += strain.get(row, row);
    for (let column = 0; column < simplexDimension; column++) {
      squaredNorm += strain.get(row, column) ** 2;
    }
  }
  let deviatoricSquaredNorm = squaredNorm - trace * trace / simplexDimension;
  const deviatoricTolerance = 256 * Number.EPSILON * Math.max(
    1,
    squaredNorm,
    trace * trace
  );
  if (deviatoricSquaredNorm < -deviatoricTolerance) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: deviatoric strain norm is numerically negative'
    );
  }
  if (deviatoricSquaredNorm < 0) deviatoricSquaredNorm = 0;

  const energyDensity = shearModulus * deviatoricSquaredNorm +
    0.5 * volumetricModulus * trace * trace;
  if (!Number.isFinite(energyDensity)) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: energy density is outside the Float64 range'
    );
  }

  const secondPiolaStress = new MatN(simplexDimension);
  for (let row = 0; row < simplexDimension; row++) {
    for (let column = 0; column < simplexDimension; column++) {
      const value = 2 * shearModulus * strain.get(row, column) +
        (row === column ? firstLameParameter * trace : 0);
      if (!Number.isFinite(value)) {
        throw new Error(
          'evaluateSimplexStVenantKirchhoffN: stress is outside the Float64 range'
        );
      }
      secondPiolaStress.set(row, column, value);
    }
  }

  return completeSimplexConstitutiveEvaluationN({
    caller: 'evaluateSimplexStVenantKirchhoffN',
    restPositions,
    currentPositions,
    deformation,
    material: Object.freeze({ firstLameParameter, shearModulus }),
    energyDensity,
    secondPiolaStress
  });
}

/**
 * Evaluates the exact matrix-free StVK potential Hessian along one direction.
 *
 * The returned products are derivatives of the vertex gradients, with the
 * mathematical sign `Hessian(U) * direction`.
 *
 * This is the optional capability that lets a compiled objective containing
 * StVK elements answer
 * `evaluateXpbdIncrementalPotentialAnalyticHessianVectorN` exactly. A law
 * without it still works as a force provider, but is named by that routine's
 * completeness preflight rather than silently contributing nothing.
 *
 * @example
 * A unit tetrahedron stretched along x, with one vertex pulled further the
 * same way. The products are the curvature felt at each vertex, and they
 * sum to zero: the element's internal response has nowhere else to go:
 * ```ts
 * const rest = [
 *   new VecN([0, 0, 0]), new VecN([1, 0, 0]),
 *   new VecN([0, 1, 0]), new VecN([0, 0, 1])
 * ];
 * const current = [
 *   new VecN([0, 0, 0]), new VecN([1.2, 0, 0]),
 *   new VecN([0, 1, 0]), new VecN([0, 0, 1])
 * ];
 * const directions = [
 *   new VecN([0, 0, 0]), new VecN([1, 0, 0]),
 *   new VecN([0, 0, 0]), new VecN([0, 0, 0])
 * ];
 *
 * const curvature = evaluateSimplexStVenantKirchhoffHessianVectorN(
 *   rest, current, directions, { firstLameParameter: 1, shearModulus: 1 }
 * );
 *
 * curvature.products.map((p) => p.data[0]); // [-0.83, 0.83, 0, 0]
 * curvature.netProductResidual; // 0
 * ```
 *
 * @example
 * Translation invariance is exact rather than approximate. Moving every
 * vertex the same way cannot change the stored energy, so the curvature
 * along a rigid translation vanishes identically — a cheap check that a
 * material's analytic derivative is the derivative of its own energy:
 * ```ts
 * const rest = [
 *   new VecN([0, 0, 0]), new VecN([1, 0, 0]),
 *   new VecN([0, 1, 0]), new VecN([0, 0, 1])
 * ];
 * const current = [
 *   new VecN([0, 0, 0]), new VecN([1.2, 0, 0]),
 *   new VecN([0, 1, 0]), new VecN([0, 0, 1])
 * ];
 * const translation = Array.from({ length: 4 }, () => new VecN([1, 0, 0]));
 *
 * const curvature = evaluateSimplexStVenantKirchhoffHessianVectorN(
 *   rest, current, translation, { firstLameParameter: 1, shearModulus: 1 }
 * );
 *
 * curvature.products.every((p) => p.lengthSq() === 0); // true, exactly
 * ```
 */
export function evaluateSimplexStVenantKirchhoffHessianVectorN(
  restPositions: readonly VecN[],
  currentPositions: readonly VecN[],
  directions: readonly VecN[],
  material: SimplexStVenantKirchhoffMaterialN
): SimplexConstitutiveHessianVectorEvaluationN<
  SimplexStVenantKirchhoffEvaluationN
> {
  const caller = 'evaluateSimplexStVenantKirchhoffHessianVectorN';
  const base = evaluateSimplexStVenantKirchhoffN(
    restPositions,
    currentPositions,
    material
  );
  const prepared = prepareSimplexConstitutiveHessianVectorN(
    caller,
    currentPositions,
    directions,
    base
  );
  const { firstLameParameter, shearModulus } = base.material;
  const directionalStrainTrace =
    0.5 * matrixTrace(prepared.directionalRightCauchyGreen);
  const directionalStress = new MatN(
    base.deformation.simplexDimension
  );
  for (let row = 0; row < directionalStress.n; row++) {
    for (let column = 0; column < directionalStress.n; column++) {
      directionalStress.set(
        row,
        column,
        shearModulus *
          prepared.directionalRightCauchyGreen.get(row, column) +
          (row === column
            ? firstLameParameter * directionalStrainTrace
            : 0)
      );
    }
  }
  return completeSimplexConstitutiveHessianVectorN(
    prepared,
    directionalStress
  );
}

function validateMaterial(
  material: SimplexStVenantKirchhoffMaterialN,
  simplexDimension: number
): SimplexStVenantKirchhoffMaterialN {
  if (typeof material !== 'object' || material === null) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: material must be an object'
    );
  }
  const { firstLameParameter, shearModulus } = material;
  if (!Number.isFinite(firstLameParameter)) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: firstLameParameter must be finite'
    );
  }
  if (!(shearModulus > 0) || !Number.isFinite(shearModulus)) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: shearModulus must be finite and positive'
    );
  }
  const volumetricModulus = firstLameParameter +
    2 * shearModulus / simplexDimension;
  if (!(volumetricModulus > 0) || !Number.isFinite(volumetricModulus)) {
    throw new Error(
      'evaluateSimplexStVenantKirchhoffN: material must satisfy lambda + 2 mu / k > 0'
    );
  }
  return { firstLameParameter, shearModulus };
}

function matrixTrace(matrix: MatN): number {
  let trace = 0;
  for (let axis = 0; axis < matrix.n; axis++) {
    trace += matrix.get(axis, axis);
  }
  return trace;
}
