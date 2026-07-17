import { VecN } from '@holotope/core';
import {
  type SupportFeatureId,
  type SupportShapeN
} from './support-shape.js';

/** Oriented plane `normal · x = offset`; the allowed half-space is positive. */
export class HyperplaneColliderN {
  readonly dim: number;
  readonly normal: VecN;
  readonly offset: number;

  constructor(normal: VecN | ArrayLike<number>, offset = 0) {
    const source = normal instanceof VecN ? normal.clone() : new VecN(normal);
    if (
      source.dim < 1 ||
      Array.from(source.data).some((coordinate) => !Number.isFinite(coordinate)) ||
      source.lengthSq() === 0
    ) {
      throw new Error('HyperplaneColliderN: normal must be a nonzero finite vector');
    }
    if (!Number.isFinite(offset)) {
      throw new Error('HyperplaneColliderN: offset must be finite');
    }
    const length = source.length();
    this.dim = source.dim;
    this.normal = source.multiplyScalar(1 / length);
    this.offset = offset / length;
  }
}

export interface HyperplaneQueryOptions {
  /** World-space separation/contact band. Default 1e-12. */
  tolerance?: number;
}

export interface HyperplaneQueryResult {
  readonly status: 'separated' | 'touching' | 'penetrating';
  /** Minimum `normal · x - offset` over the shape. */
  readonly signedDistance: number;
  readonly distance: number;
  readonly penetrationDepth: number;
  /** Unit vector from the plane's forbidden side toward the allowed side. */
  readonly normal: VecN;
  readonly pointOnShape: VecN;
  readonly pointOnPlane: VecN;
  readonly featureId: SupportFeatureId;
}

/** Exact one-support query against an infinite oriented hyperplane. */
export function querySupportShapeHyperplane(
  shape: SupportShapeN,
  plane: HyperplaneColliderN,
  options: HyperplaneQueryOptions = {}
): HyperplaneQueryResult {
  if (shape.dim !== plane.dim) {
    throw new Error(
      `querySupportShapeHyperplane: shape dimension ${shape.dim} != plane dimension ${plane.dim}`
    );
  }
  const tolerance = options.tolerance ?? 1e-12;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('querySupportShapeHyperplane: tolerance must be finite and non-negative');
  }
  const support = shape.support(plane.normal.clone().multiplyScalar(-1));
  if (
    support.point.dim !== shape.dim ||
    Array.from(support.point.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error(
      `querySupportShapeHyperplane: support must contain ${shape.dim} finite coordinates`
    );
  }
  const signedDistance = plane.normal.dot(support.point) - plane.offset;
  const status = signedDistance > tolerance
    ? 'separated'
    : signedDistance < -tolerance
      ? 'penetrating'
      : 'touching';
  return {
    status,
    signedDistance,
    distance: Math.max(0, signedDistance),
    penetrationDepth: Math.max(0, -signedDistance),
    normal: plane.normal.clone(),
    pointOnShape: support.point.clone(),
    pointOnPlane: support.point.clone().sub(
      plane.normal.clone().multiplyScalar(signedDistance)
    ),
    featureId: support.featureId
  };
}
