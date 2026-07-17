import { VecN } from '@holotope/core';
import { HyperplaneColliderN } from './hyperplane-collider.js';
import { GlomeSupportShapeN } from './support-shape.js';

export interface SmoothContactOptionsN {
  /** Separation/contact band in world units. Default 1e-12. */
  readonly tolerance?: number;
}

export interface SmoothPointContactPatchN {
  readonly kind: 'point';
  readonly normal: VecN;
  /** Actual surface witness on ordered shape A. */
  readonly pointA: VecN;
  /** Actual surface witness on ordered shape B. */
  readonly pointB: VecN;
  /** Signed motion of A along `normal` which aligns both witnesses. */
  readonly alignmentShift: number;
  readonly translationA: VecN;
  /** The common point after applying `translationA` to A. */
  readonly resolvedPoint: VecN;
  readonly penetrationDepth: number;
}

export interface GlomeGlomeContactOptionsN extends SmoothContactOptionsN {
  /** Extra spherical radius around A. Default 0. */
  readonly marginA?: number;
  /** Extra spherical radius around B. Default 0. */
  readonly marginB?: number;
}

export type GlomeGlomeContactStatusN =
  | 'separated'
  | 'touching'
  | 'overlapping'
  | 'coincident-centers';

export interface GlomeGlomeContactResultN {
  readonly status: GlomeGlomeContactStatusN;
  readonly intersects: boolean;
  /** Center distance minus both effective radii. */
  readonly signedDistance: number;
  readonly distance: number;
  readonly penetrationDepth: number;
  /** Unit direction from B toward A; null only at coincident centers. */
  readonly normal: VecN | null;
  readonly effectiveRadiusA: number;
  readonly effectiveRadiusB: number;
  readonly pointA: VecN | null;
  readonly pointB: VecN | null;
  readonly patch: SmoothPointContactPatchN | null;
}

/** Exact point contact for two solid N-balls, including spherical margins. */
export function glomeGlomeContactN(
  glomeA: GlomeSupportShapeN,
  glomeB: GlomeSupportShapeN,
  options: GlomeGlomeContactOptionsN = {}
): GlomeGlomeContactResultN {
  if (glomeA.dim !== glomeB.dim) {
    throw new Error(
      `glomeGlomeContactN: dimensions differ (${glomeA.dim} vs ${glomeB.dim})`
    );
  }
  const tolerance = resolvedTolerance(options.tolerance, 'glomeGlomeContactN');
  const marginA = resolvedMargin(options.marginA, 'marginA', 'glomeGlomeContactN');
  const marginB = resolvedMargin(options.marginB, 'marginB', 'glomeGlomeContactN');
  assertGlome(glomeA, 'glomeA', 'glomeGlomeContactN');
  assertGlome(glomeB, 'glomeB', 'glomeGlomeContactN');
  const effectiveRadiusA = glomeA.radius + marginA;
  const effectiveRadiusB = glomeB.radius + marginB;
  const delta = glomeA.center.clone().sub(glomeB.center);
  const centerDistance = delta.length();
  const signedDistance = centerDistance - effectiveRadiusA - effectiveRadiusB;
  const penetrationDepth = Math.max(0, -signedDistance);
  if (centerDistance === 0) {
    return {
      status: 'coincident-centers',
      intersects: signedDistance <= tolerance,
      signedDistance,
      distance: Math.max(0, signedDistance),
      penetrationDepth,
      normal: null,
      effectiveRadiusA,
      effectiveRadiusB,
      pointA: null,
      pointB: null,
      patch: null
    };
  }

  const normal = delta.multiplyScalar(1 / centerDistance);
  const pointA = glomeA.center.clone().sub(
    normal.clone().multiplyScalar(effectiveRadiusA)
  );
  const pointB = glomeB.center.clone().add(
    normal.clone().multiplyScalar(effectiveRadiusB)
  );
  const status = signedDistance > tolerance
    ? 'separated'
    : signedDistance < -tolerance
      ? 'overlapping'
      : 'touching';
  const patch = status === 'separated'
    ? null
    : pointPatch(normal, pointA, pointB, signedDistance, penetrationDepth);
  return {
    status,
    intersects: status !== 'separated',
    signedDistance,
    distance: Math.max(0, signedDistance),
    penetrationDepth,
    normal,
    effectiveRadiusA,
    effectiveRadiusB,
    pointA,
    pointB,
    patch
  };
}

export interface GlomeHyperplaneContactOptionsN extends SmoothContactOptionsN {
  /** Extra radius around the glome. Default 0. */
  readonly glomeMargin?: number;
}

export type GlomeHyperplaneContactStatusN =
  | 'separated'
  | 'touching'
  | 'overlapping';

export interface GlomeHyperplaneContactResultN {
  readonly status: GlomeHyperplaneContactStatusN;
  readonly intersects: boolean;
  /** Minimum glome surface distance to the plane's allowed half-space. */
  readonly signedDistance: number;
  readonly distance: number;
  readonly penetrationDepth: number;
  /** Unit direction from ordered B toward ordered A. */
  readonly normal: VecN;
  readonly shapeAType: 'glome' | 'hyperplane';
  readonly shapeBType: 'glome' | 'hyperplane';
  readonly effectiveRadius: number;
  readonly pointA: VecN;
  readonly pointB: VecN;
  readonly patch: SmoothPointContactPatchN | null;
}

/**
 * Exact ordered point contact between one N-ball and one infinite hyperplane.
 * The returned normal always follows the library convention B toward A.
 */
export function glomeHyperplaneContactN(
  shapeA: GlomeSupportShapeN | HyperplaneColliderN,
  shapeB: GlomeSupportShapeN | HyperplaneColliderN,
  options: GlomeHyperplaneContactOptionsN = {}
): GlomeHyperplaneContactResultN {
  const aIsGlome = shapeA instanceof GlomeSupportShapeN;
  const bIsGlome = shapeB instanceof GlomeSupportShapeN;
  if (aIsGlome === bIsGlome) {
    throw new Error('glomeHyperplaneContactN: expected exactly one glome and one hyperplane');
  }
  if (shapeA.dim !== shapeB.dim) {
    throw new Error(
      `glomeHyperplaneContactN: dimensions differ (${shapeA.dim} vs ${shapeB.dim})`
    );
  }
  const tolerance = resolvedTolerance(options.tolerance, 'glomeHyperplaneContactN');
  const margin = resolvedMargin(
    options.glomeMargin,
    'glomeMargin',
    'glomeHyperplaneContactN'
  );
  const glome = (aIsGlome ? shapeA : shapeB) as GlomeSupportShapeN;
  const plane = (aIsGlome ? shapeB : shapeA) as HyperplaneColliderN;
  assertGlome(glome, 'glome', 'glomeHyperplaneContactN');
  const effectiveRadius = glome.radius + margin;
  const glomePoint = glome.center.clone().sub(
    plane.normal.clone().multiplyScalar(effectiveRadius)
  );
  const signedDistance = plane.normal.dot(glomePoint) - plane.offset;
  const planePoint = glomePoint.clone().sub(
    plane.normal.clone().multiplyScalar(signedDistance)
  );
  const normal = aIsGlome
    ? plane.normal.clone()
    : plane.normal.clone().multiplyScalar(-1);
  const pointA = aIsGlome ? glomePoint : planePoint;
  const pointB = aIsGlome ? planePoint : glomePoint;
  const penetrationDepth = Math.max(0, -signedDistance);
  const status = signedDistance > tolerance
    ? 'separated'
    : signedDistance < -tolerance
      ? 'overlapping'
      : 'touching';
  return {
    status,
    intersects: status !== 'separated',
    signedDistance,
    distance: Math.max(0, signedDistance),
    penetrationDepth,
    normal,
    shapeAType: aIsGlome ? 'glome' : 'hyperplane',
    shapeBType: aIsGlome ? 'hyperplane' : 'glome',
    effectiveRadius,
    pointA,
    pointB,
    patch: status === 'separated'
      ? null
      : pointPatch(normal, pointA, pointB, signedDistance, penetrationDepth)
  };
}

function pointPatch(
  normal: VecN,
  pointA: VecN,
  pointB: VecN,
  signedDistance: number,
  penetrationDepth: number
): SmoothPointContactPatchN {
  const alignmentShift = -signedDistance;
  const translationA = normal.clone().multiplyScalar(alignmentShift);
  return {
    kind: 'point',
    normal: normal.clone(),
    pointA: pointA.clone(),
    pointB: pointB.clone(),
    alignmentShift,
    translationA,
    resolvedPoint: pointA.clone().add(translationA),
    penetrationDepth
  };
}

function assertGlome(glome: GlomeSupportShapeN, name: string, caller: string): void {
  if (
    !Number.isFinite(glome.radius) ||
    glome.radius < 0 ||
    Array.from(glome.center.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error(`${caller}: ${name} must retain a finite center and non-negative radius`);
  }
}

function resolvedTolerance(value: number | undefined, caller: string): number {
  const tolerance = value ?? 1e-12;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(`${caller}: tolerance must be finite and non-negative`);
  }
  return tolerance;
}

function resolvedMargin(
  value: number | undefined,
  name: string,
  caller: string
): number {
  const margin = value ?? 0;
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error(`${caller}: ${name} must be finite and non-negative`);
  }
  return margin;
}
