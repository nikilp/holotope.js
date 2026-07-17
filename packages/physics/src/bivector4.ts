import { BivectorN, MatN, Rotor4 } from '@holotope/core';

/**
 * Applies a vector rotation to a 4D bivector: Ω' = R Ω Rᵀ.
 *
 * This dense reference path is intentionally simple and auditable. A later
 * optimized backend can replace it with the so(3)⊕so(3) split without
 * changing the observable coefficient convention.
 */
export function rotateBivector4(bivector: BivectorN, rotation: Rotor4 | MatN): BivectorN {
  if (bivector.n !== 4) {
    throw new Error(`rotateBivector4: expected a 4D bivector, got n=${bivector.n}`);
  }
  const matrix = rotation instanceof Rotor4 ? rotation.toMatrix() : rotation;
  if (matrix.n !== 4) {
    throw new Error(`rotateBivector4: expected a 4D rotation, got n=${matrix.n}`);
  }

  const transformed = matrix
    .multiply(bivector.toSkewMatrix())
    .multiply(matrix.transpose());
  const result = new BivectorN(4);
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      // Average the antisymmetric pair to remove multiplication roundoff.
      result.set(i, j, 0.5 * (transformed.get(j, i) - transformed.get(i, j)));
    }
  }
  return result;
}

/** Changes a world-frame bivector into the body frame of `bodyToWorld`. */
export function inverseRotateBivector4(
  bivectorWorld: BivectorN,
  bodyToWorld: Rotor4
): BivectorN {
  return rotateBivector4(bivectorWorld, bodyToWorld.conjugate());
}
