import { VecN } from '../math/vecn.js';
import type {
  HomogeneousProjection,
  Projection,
  ProjectionDomainHalfSpaceN,
  ProjectionFibreN
} from './types.js';

/** Runtime capability check for custom projection implementations. */
export function isHomogeneousProjection(
  projection: Projection
): projection is HomogeneousProjection {
  const candidate = projection as Partial<HomogeneousProjection>;
  return (
    typeof candidate.homogeneousMatrix === 'function' &&
    typeof candidate.projectHomogeneousPoint === 'function' &&
    typeof candidate.projectHomogeneousPositions === 'function' &&
    typeof candidate.inverseFibre === 'function'
  );
}

/** Evaluates one point of an affine projection fibre. */
export function evaluateProjectionFibre(
  fibre: ProjectionFibreN,
  parameters: ArrayLike<number>
): VecN {
  if (parameters.length !== fibre.directions.length) {
    throw new Error(
      `evaluateProjectionFibre: expected ${fibre.directions.length} parameters, got ${parameters.length}`
    );
  }
  const point = fibre.point.clone();
  for (let direction = 0; direction < fibre.directions.length; direction++) {
    const parameter = parameters[direction]!;
    if (!Number.isFinite(parameter)) {
      throw new Error('evaluateProjectionFibre: parameters must be finite');
    }
    point.add(fibre.directions[direction]!.clone().multiplyScalar(parameter));
  }
  return point;
}

/** Signed open-half-space margin; positive means strictly inside. */
export function projectionDomainMargin(
  halfSpace: ProjectionDomainHalfSpaceN,
  point: VecN
): number {
  if (point.dim !== halfSpace.normal.dim) {
    throw new Error(
      `projectionDomainMargin: expected a ${halfSpace.normal.dim}D point, got ${point.dim}D`
    );
  }
  return halfSpace.offset + halfSpace.normal.dot(point);
}

/**
 * Tests only the fibre's declared projection domain. Callers constructing an
 * arbitrary point must separately establish that it lies on the affine flat.
 */
export function isPointInProjectionFibreDomain(
  fibre: ProjectionFibreN,
  point: VecN,
  tolerance = 0
): boolean {
  if (point.dim !== fibre.ambientDim) {
    throw new Error(
      `isPointInProjectionFibreDomain: expected a ${fibre.ambientDim}D point, got ${point.dim}D`
    );
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(
      'isPointInProjectionFibreDomain: tolerance must be finite and non-negative'
    );
  }
  if (fibre.domain.kind === 'unbounded') return true;
  return fibre.domain.halfSpaces.every(
    (halfSpace) => projectionDomainMargin(halfSpace, point) > tolerance
  );
}
