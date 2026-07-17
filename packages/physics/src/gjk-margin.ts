import { VecN } from '@holotope/core';
import {
  gjkDistance,
  type GjkOptions,
  type GjkResult
} from './gjk.js';
import { type SupportShapeN } from './support-shape.js';

export interface GjkMarginOptions extends GjkOptions {
  /** Spherical margin around shape A's convex core. */
  marginA: number;
  /** Spherical margin around shape B's convex core. */
  marginB: number;
}

export type GjkMarginStatus =
  | 'separated'
  | 'margin-contact'
  | 'core-contact'
  | 'iteration-limit';

/**
 * Shallow-contact result for two convex cores surrounded by spherical margins.
 * `core-contact` is intentionally non-metric: once the cores touch or overlap,
 * closest-point GJK no longer supplies a trustworthy penetration normal.
 */
export interface GjkMarginResult {
  readonly status: GjkMarginStatus;
  readonly intersects: boolean | null;
  /** Core distance minus both margins; null after core contact/indeterminacy. */
  readonly signedDistance: number | null;
  readonly distance: number | null;
  /** Penetration of margins only; null when the convex cores already contact. */
  readonly penetrationDepth: number | null;
  /** Unit vector from B toward A while the cores remain separated. */
  readonly normal: VecN | null;
  readonly closestPointA: VecN | null;
  readonly closestPointB: VecN | null;
  readonly contactPoint: VecN | null;
  readonly coreResult: GjkResult;
}

/**
 * Query rounded shapes by running GJK on their cores at positive distance.
 * This preserves a stable normal for ordinary shallow contacts and makes the
 * deep/core-overlap boundary explicit instead of fabricating EPA-like data.
 */
export function gjkMarginDistance(
  shapeA: SupportShapeN,
  shapeB: SupportShapeN,
  options: GjkMarginOptions
): GjkMarginResult {
  const { marginA, marginB, ...gjkOptions } = options;
  assertMargin(marginA, 'marginA');
  assertMargin(marginB, 'marginB');
  const coreResult = gjkDistance(shapeA, shapeB, gjkOptions);

  if (coreResult.intersects === null) {
    return {
      status: 'iteration-limit',
      intersects: null,
      signedDistance: null,
      distance: null,
      penetrationDepth: null,
      normal: null,
      closestPointA: null,
      closestPointB: null,
      contactPoint: null,
      coreResult
    };
  }
  if (coreResult.intersects || !coreResult.normal) {
    return {
      status: 'core-contact',
      intersects: true,
      signedDistance: null,
      distance: 0,
      penetrationDepth: null,
      normal: null,
      closestPointA: null,
      closestPointB: null,
      contactPoint: null,
      coreResult
    };
  }

  const signedDistance = coreResult.distance - marginA - marginB;
  const tolerance = options.absoluteTolerance ?? 1e-12;
  const intersects = signedDistance <= tolerance;
  const closestPointA = coreResult.closestPointA.clone().sub(
    coreResult.normal.clone().multiplyScalar(marginA)
  );
  const closestPointB = coreResult.closestPointB.clone().add(
    coreResult.normal.clone().multiplyScalar(marginB)
  );
  const contactPoint = closestPointA.clone().add(closestPointB).multiplyScalar(0.5);
  return {
    status: intersects ? 'margin-contact' : 'separated',
    intersects,
    signedDistance,
    distance: Math.max(0, signedDistance),
    penetrationDepth: Math.max(0, -signedDistance),
    normal: coreResult.normal.clone(),
    closestPointA,
    closestPointB,
    contactPoint,
    coreResult
  };
}

function assertMargin(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`gjkMarginDistance: ${name} must be finite and non-negative`);
  }
}
