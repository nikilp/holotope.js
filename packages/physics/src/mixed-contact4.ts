import { VecN } from '@holotope/core';
import {
  type HyperboxBoundaryFeature4,
  type HyperboxContactPatchKind4
} from './hyperbox-contact4.js';
import { HyperplaneColliderN } from './hyperplane-collider.js';
import { HyperboxSupportShape4 } from './hyperbox4.js';
import { GlomeSupportShapeN } from './support-shape.js';
import type { SmoothPointContactPatchN } from './smooth-contact.js';

export interface MixedAnalyticContactOptions4 {
  /** Separation/contact band in world units. Default 1e-12. */
  readonly tolerance?: number;
  /** Tie band for non-unique minimum translations. Default 1e-12. */
  readonly degeneracyTolerance?: number;
  /** Band for retaining a numerically coincident box support feature. Default 1e-10. */
  readonly manifoldTolerance?: number;
}

export interface GlomeHyperboxContactOptions4
extends MixedAnalyticContactOptions4 {
  /** Extra spherical radius around the glome. Default 0. */
  readonly glomeMargin?: number;
  /** Spherical Minkowski radius around the hyperbox. Default 0. */
  readonly hyperboxMargin?: number;
}

export type GlomeHyperboxContactStatus4 =
  | 'separated'
  | 'touching'
  | 'overlapping'
  | 'ambiguous-interior';

export interface GlomeHyperboxContactResult4 {
  readonly status: GlomeHyperboxContactStatus4;
  readonly intersects: boolean;
  readonly signedDistance: number;
  readonly distance: number;
  readonly penetrationDepth: number;
  /** Unit direction from ordered B toward ordered A; null for an interior tie. */
  readonly normal: VecN | null;
  readonly shapeAType: 'glome' | 'hyperbox';
  readonly shapeBType: 'glome' | 'hyperbox';
  readonly glomeCenterInsideCore: boolean;
  readonly effectiveGlomeRadius: number;
  readonly hyperboxMargin: number;
  readonly boxFeature: HyperboxBoundaryFeature4 | null;
  readonly closestPointOnBoxCore: VecN | null;
  readonly pointA: VecN | null;
  readonly pointB: VecN | null;
  readonly patch: SmoothPointContactPatchN | null;
}

/** Exact ordered contact between a solid R4 glome and an oriented hyperbox. */
export function glomeHyperboxContact4(
  shapeA: GlomeSupportShapeN | HyperboxSupportShape4,
  shapeB: GlomeSupportShapeN | HyperboxSupportShape4,
  options: GlomeHyperboxContactOptions4 = {}
): GlomeHyperboxContactResult4 {
  const aIsGlome = shapeA instanceof GlomeSupportShapeN;
  const bIsGlome = shapeB instanceof GlomeSupportShapeN;
  if (aIsGlome === bIsGlome) {
    throw new Error('glomeHyperboxContact4: expected exactly one glome and one hyperbox');
  }
  if (shapeA.dim !== 4 || shapeB.dim !== 4) {
    throw new Error('glomeHyperboxContact4: both shapes must be in R4');
  }
  const tolerance = resolvedTolerance(
    options.tolerance,
    1e-12,
    'tolerance',
    'glomeHyperboxContact4'
  );
  const degeneracyTolerance = resolvedTolerance(
    options.degeneracyTolerance,
    1e-12,
    'degeneracyTolerance',
    'glomeHyperboxContact4'
  );
  const glomeMargin = resolvedMargin(
    options.glomeMargin,
    'glomeMargin',
    'glomeHyperboxContact4'
  );
  const hyperboxMargin = resolvedMargin(
    options.hyperboxMargin,
    'hyperboxMargin',
    'glomeHyperboxContact4'
  );
  const glome = (aIsGlome ? shapeA : shapeB) as GlomeSupportShapeN;
  const box = (aIsGlome ? shapeB : shapeA) as HyperboxSupportShape4;
  assertGlome4(glome, 'glomeHyperboxContact4');
  const effectiveGlomeRadius = glome.radius + glomeMargin;
  const axes = box.worldAxes();
  const centerDelta = glome.center.clone().sub(box.center);
  const local = new Float64Array(4);
  const clamped = new Float64Array(4);
  let inside = true;
  for (let axis = 0; axis < 4; axis++) {
    local[axis] = axes[axis]!.dot(centerDelta);
    const extent = box.halfExtents[axis]!;
    clamped[axis] = Math.max(-extent, Math.min(extent, local[axis]!));
    if (Math.abs(local[axis]!) > extent) inside = false;
  }

  if (!inside) {
    const closestPointOnBoxCore = localPointToWorld(box.center, axes, clamped);
    const delta = glome.center.clone().sub(closestPointOnBoxCore);
    const centerDistance = delta.length();
    if (!(centerDistance > 0)) {
      throw new Error('glomeHyperboxContact4: outside classification lost its direction');
    }
    const boxToGlome = delta.multiplyScalar(1 / centerDistance);
    const boxPoint = closestPointOnBoxCore.clone().add(
      boxToGlome.clone().multiplyScalar(hyperboxMargin)
    );
    const glomePoint = glome.center.clone().sub(
      boxToGlome.clone().multiplyScalar(effectiveGlomeRadius)
    );
    const signedDistance =
      centerDistance - effectiveGlomeRadius - hyperboxMargin;
    return orderedGlomeHyperboxResult(
      aIsGlome,
      signedDistance,
      tolerance,
      boxToGlome,
      glomePoint,
      boxPoint,
      effectiveGlomeRadius,
      hyperboxMargin,
      false,
      classifyBoxFeatureAtLocal(clamped, box.halfExtents, tolerance),
      closestPointOnBoxCore
    );
  }

  const exits: { axis: number; sign: -1 | 1; clearance: number }[] = [];
  for (let axis = 0; axis < 4; axis++) {
    exits.push({
      axis,
      sign: 1,
      clearance: box.halfExtents[axis]! - local[axis]!
    });
    exits.push({
      axis,
      sign: -1,
      clearance: box.halfExtents[axis]! + local[axis]!
    });
  }
  exits.sort((left, right) =>
    left.clearance - right.clearance || left.axis - right.axis || right.sign - left.sign
  );
  const minimum = exits[0]!;
  const tieBand = scaledTolerance(
    degeneracyTolerance,
    minimum.clearance,
    exits[1]!.clearance
  );
  const tied = exits.filter(
    ({ clearance }) => Math.abs(clearance - minimum.clearance) <= tieBand
  );
  const penetrationDepth =
    minimum.clearance + hyperboxMargin + effectiveGlomeRadius;
  const signedDistance = -penetrationDepth;
  if (tied.length !== 1) {
    return {
      status: 'ambiguous-interior',
      intersects: true,
      signedDistance,
      distance: 0,
      penetrationDepth,
      normal: null,
      shapeAType: aIsGlome ? 'glome' : 'hyperbox',
      shapeBType: aIsGlome ? 'hyperbox' : 'glome',
      glomeCenterInsideCore: true,
      effectiveGlomeRadius,
      hyperboxMargin,
      boxFeature: null,
      closestPointOnBoxCore: null,
      pointA: null,
      pointB: null,
      patch: null
    };
  }

  const boxToGlome = axes[minimum.axis]!.clone().multiplyScalar(minimum.sign);
  const faceLocal = local.slice();
  faceLocal[minimum.axis] = minimum.sign * box.halfExtents[minimum.axis]!;
  const closestPointOnBoxCore = localPointToWorld(box.center, axes, faceLocal);
  const boxPoint = closestPointOnBoxCore.clone().add(
    boxToGlome.clone().multiplyScalar(hyperboxMargin)
  );
  // To leave a containing box, the glome's opposite surface point is the
  // witness which reaches the chosen face after the minimum translation.
  const glomePoint = glome.center.clone().sub(
    boxToGlome.clone().multiplyScalar(effectiveGlomeRadius)
  );
  const boxFeature: HyperboxBoundaryFeature4 = {
    positiveMask: minimum.sign > 0 ? 1 << minimum.axis : 0,
    negativeMask: minimum.sign < 0 ? 1 << minimum.axis : 0,
    dimension: 3
  };
  return orderedGlomeHyperboxResult(
    aIsGlome,
    signedDistance,
    tolerance,
    boxToGlome,
    glomePoint,
    boxPoint,
    effectiveGlomeRadius,
    hyperboxMargin,
    true,
    boxFeature,
    closestPointOnBoxCore
  );
}

export interface HyperboxHyperplaneContactOptions4
extends MixedAnalyticContactOptions4 {
  /** Spherical Minkowski radius around the hyperbox. Default 0. */
  readonly hyperboxMargin?: number;
}

export type HyperboxHyperplaneContactStatus4 =
  | 'separated'
  | 'touching'
  | 'overlapping';

export interface HyperboxHyperplaneContactVertex4 {
  readonly id: string;
  readonly boxVertexId: number;
  readonly pointA: VecN;
  readonly pointB: VecN;
  readonly resolvedPoint: VecN;
}

export interface HyperboxHyperplaneContactPatch4 {
  readonly kind: HyperboxContactPatchKind4;
  readonly intrinsicDim: 0 | 1 | 2 | 3;
  readonly normal: VecN;
  readonly planeNormal: VecN;
  readonly originalPlaneOffset: number;
  readonly resolvedPlaneOffset: number;
  readonly penetrationDepth: number;
  readonly alignmentShift: number;
  readonly translationA: VecN;
  readonly boxRole: 'a' | 'b';
  readonly boxFeature: HyperboxBoundaryFeature4;
  readonly vertices: readonly HyperboxHyperplaneContactVertex4[];
  readonly solverPoints: readonly HyperboxHyperplaneContactVertex4[];
  readonly maxResolvedPlaneResidual: number;
}

export interface HyperboxHyperplaneContactResult4 {
  readonly status: HyperboxHyperplaneContactStatus4;
  readonly intersects: boolean;
  readonly signedDistance: number;
  readonly distance: number;
  readonly penetrationDepth: number;
  readonly normal: VecN;
  readonly shapeAType: 'hyperbox' | 'hyperplane';
  readonly shapeBType: 'hyperbox' | 'hyperplane';
  readonly hyperboxMargin: number;
  readonly boxFeature: HyperboxBoundaryFeature4;
  readonly patch: HyperboxHyperplaneContactPatch4 | null;
}

/** Exact ordered support-feature contact between an R4 hyperbox and plane. */
export function hyperboxHyperplaneContact4(
  shapeA: HyperboxSupportShape4 | HyperplaneColliderN,
  shapeB: HyperboxSupportShape4 | HyperplaneColliderN,
  options: HyperboxHyperplaneContactOptions4 = {}
): HyperboxHyperplaneContactResult4 {
  const aIsBox = shapeA instanceof HyperboxSupportShape4;
  const bIsBox = shapeB instanceof HyperboxSupportShape4;
  if (aIsBox === bIsBox) {
    throw new Error(
      'hyperboxHyperplaneContact4: expected exactly one hyperbox and one hyperplane'
    );
  }
  const tolerance = resolvedTolerance(
    options.tolerance,
    1e-12,
    'tolerance',
    'hyperboxHyperplaneContact4'
  );
  const manifoldTolerance = resolvedTolerance(
    options.manifoldTolerance,
    1e-10,
    'manifoldTolerance',
    'hyperboxHyperplaneContact4'
  );
  const hyperboxMargin = resolvedMargin(
    options.hyperboxMargin,
    'hyperboxMargin',
    'hyperboxHyperplaneContact4'
  );
  const box = (aIsBox ? shapeA : shapeB) as HyperboxSupportShape4;
  const plane = (aIsBox ? shapeB : shapeA) as HyperplaneColliderN;
  if (box.dim !== plane.dim) {
    throw new Error(
      `hyperboxHyperplaneContact4: dimensions differ (${box.dim} vs ${plane.dim})`
    );
  }
  const axes = box.worldAxes();
  const support = box.support(plane.normal.clone().multiplyScalar(-1));
  const coreSignedDistance = plane.normal.dot(support.point) - plane.offset;
  const signedDistance = coreSignedDistance - hyperboxMargin;
  const penetrationDepth = Math.max(0, -signedDistance);
  const status = contactStatus(signedDistance, tolerance);
  const freeAxes: number[] = [];
  let positiveMask = 0;
  let negativeMask = 0;
  for (let axis = 0; axis < 4; axis++) {
    const projection = axes[axis]!.dot(plane.normal);
    const variation = 2 * box.halfExtents[axis]! * Math.abs(projection);
    if (variation <= manifoldTolerance / 4) {
      freeAxes.push(axis);
    } else if (projection > 0) {
      negativeMask |= 1 << axis;
    } else {
      positiveMask |= 1 << axis;
    }
  }
  const boxFeature: HyperboxBoundaryFeature4 = {
    positiveMask,
    negativeMask,
    dimension: freeAxes.length
  };
  const orderedNormal = aIsBox
    ? plane.normal.clone()
    : plane.normal.clone().multiplyScalar(-1);
  const base = {
    status,
    intersects: status !== 'separated',
    signedDistance,
    distance: Math.max(0, signedDistance),
    penetrationDepth,
    normal: orderedNormal,
    shapeAType: aIsBox ? 'hyperbox' as const : 'hyperplane' as const,
    shapeBType: aIsBox ? 'hyperplane' as const : 'hyperbox' as const,
    hyperboxMargin,
    boxFeature
  };
  if (status === 'separated') return { ...base, patch: null };

  const alignmentShift = -signedDistance;
  const translationA = orderedNormal.clone().multiplyScalar(alignmentShift);
  const planeTranslation = aIsBox ? new VecN(4) : translationA;
  const resolvedPlaneOffset = plane.offset + plane.normal.dot(planeTranslation);
  const vertices: HyperboxHyperplaneContactVertex4[] = [];
  const combinations = 1 << freeAxes.length;
  let maxResolvedPlaneResidual = 0;
  for (let combination = 0; combination < combinations; combination++) {
    let boxVertexId = positiveMask;
    for (let free = 0; free < freeAxes.length; free++) {
      if ((combination & (1 << free)) !== 0) boxVertexId |= 1 << freeAxes[free]!;
    }
    const corePoint = box.resolveFeature(boxVertexId)!.point;
    const boxPoint = corePoint.sub(
      plane.normal.clone().multiplyScalar(hyperboxMargin)
    );
    const pointA = aIsBox ? boxPoint : boxPoint.clone().sub(translationA);
    const pointB = aIsBox ? boxPoint.clone().add(translationA) : boxPoint;
    const resolvedPoint = pointA.clone().add(translationA);
    maxResolvedPlaneResidual = Math.max(
      maxResolvedPlaneResidual,
      Math.abs(plane.normal.dot(resolvedPoint) - resolvedPlaneOffset)
    );
    vertices.push({
      id: `box:${boxVertexId.toString(16)}`,
      boxVertexId,
      pointA,
      pointB,
      resolvedPoint
    });
  }
  vertices.sort((left, right) => left.boxVertexId - right.boxVertexId);
  return {
    ...base,
    patch: {
      kind: patchKind(freeAxes.length as 0 | 1 | 2 | 3),
      intrinsicDim: freeAxes.length as 0 | 1 | 2 | 3,
      normal: orderedNormal,
      planeNormal: plane.normal.clone(),
      originalPlaneOffset: plane.offset,
      resolvedPlaneOffset,
      penetrationDepth,
      alignmentShift,
      translationA,
      boxRole: aIsBox ? 'a' : 'b',
      boxFeature,
      vertices,
      solverPoints: vertices,
      maxResolvedPlaneResidual
    }
  };
}

function orderedGlomeHyperboxResult(
  glomeIsA: boolean,
  signedDistance: number,
  tolerance: number,
  boxToGlome: VecN,
  glomePoint: VecN,
  boxPoint: VecN,
  effectiveGlomeRadius: number,
  hyperboxMargin: number,
  inside: boolean,
  boxFeature: HyperboxBoundaryFeature4,
  closestPointOnBoxCore: VecN
): GlomeHyperboxContactResult4 {
  const normal = glomeIsA
    ? boxToGlome.clone()
    : boxToGlome.clone().multiplyScalar(-1);
  const pointA = glomeIsA ? glomePoint : boxPoint;
  const pointB = glomeIsA ? boxPoint : glomePoint;
  const penetrationDepth = Math.max(0, -signedDistance);
  const status = contactStatus(signedDistance, tolerance);
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
    shapeAType: glomeIsA ? 'glome' : 'hyperbox',
    shapeBType: glomeIsA ? 'hyperbox' : 'glome',
    glomeCenterInsideCore: inside,
    effectiveGlomeRadius,
    hyperboxMargin,
    boxFeature,
    closestPointOnBoxCore,
    pointA,
    pointB,
    patch
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

function localPointToWorld(
  center: VecN,
  axes: readonly VecN[],
  local: ArrayLike<number>
): VecN {
  const point = center.clone();
  for (let axis = 0; axis < 4; axis++) {
    point.add(axes[axis]!.clone().multiplyScalar(local[axis]!));
  }
  return point;
}

function classifyBoxFeatureAtLocal(
  local: ArrayLike<number>,
  halfExtents: ArrayLike<number>,
  tolerance: number
): HyperboxBoundaryFeature4 {
  let positiveMask = 0;
  let negativeMask = 0;
  for (let axis = 0; axis < 4; axis++) {
    const band = scaledTolerance(tolerance, local[axis]!, halfExtents[axis]!);
    if (Math.abs(local[axis]! - halfExtents[axis]!) <= band) {
      positiveMask |= 1 << axis;
    }
    if (Math.abs(local[axis]! + halfExtents[axis]!) <= band) {
      negativeMask |= 1 << axis;
    }
  }
  return {
    positiveMask,
    negativeMask,
    dimension: 4 - popcount4(positiveMask | negativeMask)
  };
}

function contactStatus(
  signedDistance: number,
  tolerance: number
): 'separated' | 'touching' | 'overlapping' {
  return signedDistance > tolerance
    ? 'separated'
    : signedDistance < -tolerance
      ? 'overlapping'
      : 'touching';
}

function patchKind(dimension: 0 | 1 | 2 | 3): HyperboxContactPatchKind4 {
  return (['point', 'segment', 'polygon', 'polyhedron'] as const)[dimension];
}

function popcount4(value: number): number {
  let count = 0;
  for (let bit = 0; bit < 4; bit++) if ((value & (1 << bit)) !== 0) count++;
  return count;
}

function assertGlome4(glome: GlomeSupportShapeN, caller: string): void {
  if (
    glome.dim !== 4 ||
    !Number.isFinite(glome.radius) ||
    glome.radius < 0 ||
    Array.from(glome.center.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error(`${caller}: glome must retain a finite R4 center and radius`);
  }
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

function resolvedTolerance(
  value: number | undefined,
  fallback: number,
  name: string,
  caller: string
): number {
  const tolerance = value ?? fallback;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(`${caller}: ${name} must be finite and non-negative`);
  }
  return tolerance;
}

function scaledTolerance(tolerance: number, ...values: number[]): number {
  return tolerance * Math.max(1, ...values.map(Math.abs));
}
