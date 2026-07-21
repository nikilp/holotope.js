import {
  Rotor4,
  VecN
} from '@holotope/core';
import {
  gjkDistance,
  type GjkOptions,
  type GjkResult,
  type GjkWarmStartN
} from './gjk.js';
import {
  HyperplaneColliderN,
  querySupportShapeHyperplane,
  type HyperplaneQueryResult
} from './hyperplane-collider.js';
import {
  convexLinearCastN,
  type ConvexLinearCastOptionsN,
  type LinearCastReasonN,
  type LinearCastStatusN
} from './linear-cast.js';
import { angularVelocityOperatorNorm4 } from './orientation-coordinates4.js';
import { RigidTrajectory4 } from './rigid-trajectory4.js';
import {
  GlomeSupportShapeN,
  RoundedSupportShapeN,
  TransformedSupportShapeN,
  supportShapeVerticesN,
  type SupportFeatureId,
  type SupportShapeN,
  type SupportVertexN
} from './support-shape.js';

export interface RigidCastMotion4 {
  readonly trajectory: RigidTrajectory4;
  /** Inferred for auditable built-ins; required for opaque support functions. */
  readonly boundingRadius?: number;
}

export interface RigidCastTraceEntry4 {
  readonly iteration: number;
  readonly time: number;
  readonly distance: number;
  readonly closingSpeedBound: number | null;
  readonly advance: number | null;
}

export interface ConvexRigidCastResult4 {
  readonly kind: 'rigid-convex';
  readonly status: LinearCastStatusN;
  readonly reason: LinearCastReasonN;
  readonly hit: boolean | null;
  readonly time: number | null;
  readonly safeTime: number;
  readonly distance: number;
  readonly normal: VecN | null;
  readonly pointA: VecN;
  readonly pointB: VecN;
  readonly iterations: number;
  readonly gjkIterations: number;
  readonly boundingRadiusA: number;
  readonly boundingRadiusB: number;
  readonly angularSpeedBoundA: number;
  readonly angularSpeedBoundB: number;
  readonly finalQuery: GjkResult;
  readonly trace?: readonly RigidCastTraceEntry4[];
}

export interface HyperplaneRigidCastResult4 {
  readonly kind: 'rigid-hyperplane';
  readonly status: LinearCastStatusN;
  readonly reason: Exclude<LinearCastReasonN, 'gjk-iteration-limit'>;
  readonly hit: boolean | null;
  readonly time: number | null;
  readonly safeTime: number;
  readonly distance: number;
  readonly normal: VecN;
  readonly pointOnShape: VecN;
  readonly pointOnPlane: VecN;
  readonly featureId: SupportFeatureId;
  readonly iterations: number;
  readonly boundingRadius: number;
  readonly angularSpeedBound: number;
  readonly finalQuery: HyperplaneQueryResult;
  readonly trace?: readonly RigidCastTraceEntry4[];
}

interface ResolvedRigidCastMotion4 {
  trajectory: RigidTrajectory4;
  boundingRadius: number;
  angularSpeedBound: number;
}

interface ResolvedRigidCastOptions4 {
  maxIterations: number;
  targetDistance: number;
  distanceTolerance: number;
  timeTolerance: number;
  speedTolerance: number;
  gjkOptions: Omit<
    GjkOptions,
    'absoluteTolerance' | 'warmStart' | 'signOracle'
  >;
  recordTrace: boolean;
}

/**
 * Exact pivot radius for auditable built-in supports, or null for an opaque
 * support function without a finite vertex enumeration.
 */
export function supportShapeBoundingRadius4(
  shape: SupportShapeN,
  pivot: VecN | ArrayLike<number> = shape.center
): number | null {
  if (shape.dim !== 4) {
    throw new Error('supportShapeBoundingRadius4: shape must be R4');
  }
  const center = vector4(pivot, 'pivot', 'supportShapeBoundingRadius4');
  if (shape instanceof GlomeSupportShapeN) {
    return center.distanceTo(shape.center) + shape.radius;
  }
  if (shape instanceof RoundedSupportShapeN) {
    const source = supportShapeBoundingRadius4(shape.source, center);
    return source === null ? null : source + shape.margin;
  }
  if (shape instanceof TransformedSupportShapeN) {
    const localPivot = shape.transform.inverse().applyToPoint(center);
    return supportShapeBoundingRadius4(shape.source, localPivot);
  }
  const vertices = supportShapeVerticesN(shape);
  if (vertices === undefined) return null;
  let radius = 0;
  for (const vertex of vertices) {
    radius = Math.max(radius, vertex.point.distanceTo(center));
  }
  return radius;
}

/** Conservative advancement for two explicit constant-generator R4 paths. */
export function convexRigidCast4(
  shapeA: SupportShapeN,
  motionA: RigidCastMotion4,
  shapeB: SupportShapeN,
  motionB: RigidCastMotion4,
  options: ConvexLinearCastOptionsN = {}
): ConvexRigidCastResult4 {
  if (shapeA.dim !== 4 || shapeB.dim !== 4) {
    throw new Error('convexRigidCast4: both shapes must be R4');
  }
  const resolved = resolveOptions(options, 'convexRigidCast4');
  const resolvedA = resolveMotion(shapeA, motionA, 'motionA');
  const resolvedB = resolveMotion(shapeB, motionB, 'motionB');
  if (
    resolvedA.angularSpeedBound === 0 &&
    resolvedB.angularSpeedBound === 0
  ) {
    const linear = convexLinearCastN(
      shapeA,
      resolvedA.trajectory.linearDisplacement,
      shapeB,
      resolvedB.trajectory.linearDisplacement,
      options
    );
    return {
      kind: 'rigid-convex',
      status: linear.status,
      reason: linear.reason,
      hit: linear.hit,
      time: linear.time,
      safeTime: linear.safeTime,
      distance: linear.distance,
      normal: linear.normal?.clone() ?? null,
      pointA: linear.pointA.clone(),
      pointB: linear.pointB.clone(),
      iterations: linear.iterations,
      gjkIterations: linear.gjkIterations,
      boundingRadiusA: resolvedA.boundingRadius,
      boundingRadiusB: resolvedB.boundingRadius,
      angularSpeedBoundA: 0,
      angularSpeedBoundB: 0,
      finalQuery: linear.finalQuery,
      ...(linear.trace
        ? {
            trace: linear.trace.map((entry) => ({
              iteration: entry.iteration,
              time: entry.time,
              distance: entry.distance,
              closingSpeedBound: entry.closingSpeed,
              advance: entry.advance
            }))
          }
        : {})
    };
  }
  const movedA = new RigidTrajectorySupportShape4(shapeA, resolvedA.trajectory);
  const movedB = new RigidTrajectorySupportShape4(shapeB, resolvedB.trajectory);
  const relativeDisplacement = resolvedA.trajectory.linearDisplacement.clone()
    .sub(resolvedB.trajectory.linearDisplacement);
  const angularClosingBound = resolvedA.angularSpeedBound *
    resolvedA.boundingRadius + resolvedB.angularSpeedBound *
    resolvedB.boundingRadius;
  const trace: RigidCastTraceEntry4[] | undefined = resolved.recordTrace
    ? []
    : undefined;
  let time = 0;
  let safeTime = 0;
  let previousNormal: VecN | null = null;
  let warmStart: GjkWarmStartN | undefined;
  let totalGjkIterations = 0;
  let finalQuery: GjkResult | undefined;

  for (let iteration = 0; iteration <= resolved.maxIterations; iteration++) {
    movedA.setTime(time);
    movedB.setTime(time);
    const query = gjkDistance(movedA, movedB, {
      ...resolved.gjkOptions,
      absoluteTolerance: resolved.distanceTolerance,
      ...(warmStart ? { warmStart } : {})
    });
    finalQuery = query;
    totalGjkIterations += query.iterations;
    if (query.status === 'iteration-limit') {
      trace?.push({
        iteration,
        time,
        distance: query.distance,
        closingSpeedBound: null,
        advance: null
      });
      return convexResult(
        'indeterminate',
        'gjk-iteration-limit',
        null,
        null,
        safeTime,
        previousNormal,
        iteration + 1,
        totalGjkIterations,
        query,
        resolvedA,
        resolvedB,
        trace
      );
    }
    if (query.intersects ||
        query.distance <= resolved.targetDistance + resolved.distanceTolerance) {
      trace?.push({
        iteration,
        time,
        distance: query.intersects ? 0 : query.distance,
        closingSpeedBound: null,
        advance: null
      });
      const initial = time === 0 && query.intersects;
      return convexResult(
        initial ? 'initial-overlap' : 'impact',
        initial ? 'initial-overlap' : 'contact-band',
        true,
        time,
        time,
        query.normal ?? previousNormal,
        iteration + 1,
        totalGjkIterations,
        query,
        resolvedA,
        resolvedB,
        trace
      );
    }
    const normal = query.normal;
    if (!normal) {
      throw new Error('convexRigidCast4: separated GJK result has no normal');
    }
    previousNormal = normal.clone();
    const closingSpeedBound = -normal.dot(relativeDisplacement) +
      angularClosingBound;
    if (closingSpeedBound <= resolved.speedTolerance) {
      trace?.push({
        iteration,
        time,
        distance: query.distance,
        closingSpeedBound,
        advance: null
      });
      return convexResult(
        'miss',
        'separating-motion',
        false,
        null,
        1,
        normal,
        iteration + 1,
        totalGjkIterations,
        query,
        resolvedA,
        resolvedB,
        trace
      );
    }
    const advance = (query.distance - resolved.targetDistance) /
      closingSpeedBound;
    trace?.push({
      iteration,
      time,
      distance: query.distance,
      closingSpeedBound,
      advance
    });
    if (!Number.isFinite(advance) || advance <= resolved.timeTolerance) {
      return convexResult(
        'indeterminate',
        'advancement-stalled',
        null,
        null,
        safeTime,
        normal,
        iteration + 1,
        totalGjkIterations,
        query,
        resolvedA,
        resolvedB,
        trace
      );
    }
    const nextTime = time + advance;
    if (nextTime > 1 + resolved.timeTolerance) {
      return convexResult(
        'miss',
        'past-horizon',
        false,
        null,
        1,
        normal,
        iteration + 1,
        totalGjkIterations,
        query,
        resolvedA,
        resolvedB,
        trace
      );
    }
    safeTime = time;
    time = Math.min(1, nextTime);
    warmStart = query.warmStart;
  }
  return convexResult(
    'indeterminate',
    'advancement-limit',
    null,
    null,
    safeTime,
    previousNormal,
    resolved.maxIterations + 1,
    totalGjkIterations,
    finalQuery!,
    resolvedA,
    resolvedB,
    trace
  );
}

/** Conservative rigid cast of one compact R4 support against a fixed plane. */
export function supportShapeHyperplaneRigidCast4(
  shape: SupportShapeN,
  motion: RigidCastMotion4,
  plane: HyperplaneColliderN,
  options: ConvexLinearCastOptionsN = {}
): HyperplaneRigidCastResult4 {
  if (shape.dim !== 4 || plane.dim !== 4) {
    throw new Error('supportShapeHyperplaneRigidCast4: shape and plane must be R4');
  }
  const resolved = resolveOptions(options, 'supportShapeHyperplaneRigidCast4');
  const resolvedMotion = resolveMotion(shape, motion, 'motion');
  const moved = new RigidTrajectorySupportShape4(
    shape,
    resolvedMotion.trajectory
  );
  const angularClosingBound = resolvedMotion.angularSpeedBound *
    resolvedMotion.boundingRadius;
  const trace: RigidCastTraceEntry4[] | undefined = resolved.recordTrace
    ? []
    : undefined;
  let time = 0;
  let safeTime = 0;
  let finalQuery: HyperplaneQueryResult | undefined;
  for (let iteration = 0; iteration <= resolved.maxIterations; iteration++) {
    moved.setTime(time);
    const query = querySupportShapeHyperplane(moved, plane, {
      tolerance: resolved.distanceTolerance
    });
    finalQuery = query;
    if (query.status === 'penetrating') {
      trace?.push({
        iteration,
        time,
        distance: 0,
        closingSpeedBound: null,
        advance: null
      });
      const initial = time === 0;
      return hyperplaneResult(
        initial ? 'initial-overlap' : 'impact',
        initial ? 'initial-overlap' : 'contact-band',
        true,
        time,
        time,
        iteration + 1,
        query,
        resolvedMotion,
        trace
      );
    }
    if (
      query.status === 'touching' ||
      query.signedDistance <= resolved.targetDistance + resolved.distanceTolerance
    ) {
      trace?.push({
        iteration,
        time,
        distance: query.distance,
        closingSpeedBound: null,
        advance: null
      });
      return hyperplaneResult(
        'impact',
        'contact-band',
        true,
        time,
        time,
        iteration + 1,
        query,
        resolvedMotion,
        trace
      );
    }
    const closingSpeedBound = -plane.normal.dot(
      resolvedMotion.trajectory.linearDisplacement
    ) + angularClosingBound;
    if (closingSpeedBound <= resolved.speedTolerance) {
      trace?.push({
        iteration,
        time,
        distance: query.distance,
        closingSpeedBound,
        advance: null
      });
      return hyperplaneResult(
        'miss',
        'separating-motion',
        false,
        null,
        1,
        iteration + 1,
        query,
        resolvedMotion,
        trace
      );
    }
    const advance = (query.signedDistance - resolved.targetDistance) /
      closingSpeedBound;
    trace?.push({
      iteration,
      time,
      distance: query.distance,
      closingSpeedBound,
      advance
    });
    if (!Number.isFinite(advance) || advance <= resolved.timeTolerance) {
      return hyperplaneResult(
        'indeterminate',
        'advancement-stalled',
        null,
        null,
        safeTime,
        iteration + 1,
        query,
        resolvedMotion,
        trace
      );
    }
    const nextTime = time + advance;
    if (nextTime > 1 + resolved.timeTolerance) {
      return hyperplaneResult(
        'miss',
        'past-horizon',
        false,
        null,
        1,
        iteration + 1,
        query,
        resolvedMotion,
        trace
      );
    }
    safeTime = time;
    time = Math.min(1, nextTime);
  }
  return hyperplaneResult(
    'indeterminate',
    'advancement-limit',
    null,
    null,
    safeTime,
    resolved.maxIterations + 1,
    finalQuery!,
    resolvedMotion,
    trace
  );
}

function resolveMotion(
  shape: SupportShapeN,
  motion: RigidCastMotion4,
  name: string
): ResolvedRigidCastMotion4 {
  const pivot = motion.trajectory.start.position;
  const inferred = supportShapeBoundingRadius4(shape, pivot);
  if (motion.boundingRadius === undefined && inferred === null) {
    throw new Error(
      `convex rigid cast: ${name}.boundingRadius is required for an opaque support shape`
    );
  }
  const boundingRadius = motion.boundingRadius ?? inferred!;
  if (!Number.isFinite(boundingRadius) || boundingRadius < 0) {
    throw new Error(
      `convex rigid cast: ${name}.boundingRadius must be finite and non-negative`
    );
  }
  if (
    inferred !== null &&
    boundingRadius < inferred - 1e-12 * Math.max(1, inferred)
  ) {
    throw new Error(
      `convex rigid cast: ${name}.boundingRadius ${boundingRadius} is smaller than inferred radius ${inferred}`
    );
  }
  const angularSpeedBound = angularVelocityOperatorNorm4(
    motion.trajectory.angularDisplacementWorld
  );
  return { trajectory: motion.trajectory, boundingRadius, angularSpeedBound };
}

function resolveOptions(
  options: ConvexLinearCastOptionsN,
  owner: string
): ResolvedRigidCastOptions4 {
  const maxIterations = options.maxIterations ?? 32;
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new Error(`${owner}: maxIterations must be a positive integer`);
  }
  const resolved = {
    maxIterations,
    targetDistance: options.targetDistance ?? 0,
    distanceTolerance: options.distanceTolerance ?? 1e-12,
    timeTolerance: options.timeTolerance ?? 1e-12,
    speedTolerance: options.speedTolerance ?? 1e-14,
    gjkOptions: { ...options.gjkOptions },
    recordTrace: options.recordTrace ?? false
  };
  for (const name of [
    'targetDistance',
    'distanceTolerance',
    'timeTolerance',
    'speedTolerance'
  ] as const) {
    if (!Number.isFinite(resolved[name]) || resolved[name] < 0) {
      throw new Error(`${owner}: ${name} must be finite and non-negative`);
    }
  }
  return resolved;
}

function convexResult(
  status: LinearCastStatusN,
  reason: LinearCastReasonN,
  hit: boolean | null,
  time: number | null,
  safeTime: number,
  normal: VecN | null,
  iterations: number,
  gjkIterations: number,
  finalQuery: GjkResult,
  motionA: ResolvedRigidCastMotion4,
  motionB: ResolvedRigidCastMotion4,
  trace: RigidCastTraceEntry4[] | undefined
): ConvexRigidCastResult4 {
  return {
    kind: 'rigid-convex',
    status,
    reason,
    hit,
    time,
    safeTime,
    distance: finalQuery.distance,
    normal: normal?.clone() ?? null,
    pointA: finalQuery.closestPointA.clone(),
    pointB: finalQuery.closestPointB.clone(),
    iterations,
    gjkIterations,
    boundingRadiusA: motionA.boundingRadius,
    boundingRadiusB: motionB.boundingRadius,
    angularSpeedBoundA: motionA.angularSpeedBound,
    angularSpeedBoundB: motionB.angularSpeedBound,
    finalQuery,
    ...(trace ? { trace } : {})
  };
}

function hyperplaneResult(
  status: LinearCastStatusN,
  reason: HyperplaneRigidCastResult4['reason'],
  hit: boolean | null,
  time: number | null,
  safeTime: number,
  iterations: number,
  finalQuery: HyperplaneQueryResult,
  motion: ResolvedRigidCastMotion4,
  trace: RigidCastTraceEntry4[] | undefined
): HyperplaneRigidCastResult4 {
  return {
    kind: 'rigid-hyperplane',
    status,
    reason,
    hit,
    time,
    safeTime,
    distance: finalQuery.distance,
    normal: finalQuery.normal.clone(),
    pointOnShape: finalQuery.pointOnShape.clone(),
    pointOnPlane: finalQuery.pointOnPlane.clone(),
    featureId: finalQuery.featureId,
    iterations,
    boundingRadius: motion.boundingRadius,
    angularSpeedBound: motion.angularSpeedBound,
    finalQuery,
    ...(trace ? { trace } : {})
  };
}

/** Mutable rigid view used only within one cast. */
class RigidTrajectorySupportShape4 implements SupportShapeN {
  readonly source: SupportShapeN;
  readonly trajectory: RigidTrajectory4;
  private rotation = Rotor4.identity();
  private inverseRotation = Rotor4.identity();
  private pivot: VecN;

  constructor(source: SupportShapeN, trajectory: RigidTrajectory4) {
    this.source = source;
    this.trajectory = trajectory;
    this.pivot = trajectory.start.position.clone();
  }

  get dim(): number {
    return 4;
  }

  get center(): VecN {
    return this.transformPoint(this.source.center);
  }

  get polytopeTopology(): SupportShapeN['polytopeTopology'] {
    return this.source.polytopeTopology;
  }

  setTime(time: number): void {
    this.rotation = Rotor4.fromBivector(
      this.trajectory.angularDisplacementWorld.clone().scale(time)
    );
    this.inverseRotation = this.rotation.conjugate();
    this.pivot = this.trajectory.start.position.clone().add(
      this.trajectory.linearDisplacement.clone().multiplyScalar(time)
    );
  }

  support(direction: VecN): SupportVertexN {
    const localDirection = this.inverseRotation.applyToPoint(direction);
    const support = this.source.support(localDirection);
    return {
      point: this.transformPoint(support.point),
      featureId: support.featureId
    };
  }

  resolveFeature(featureId: SupportFeatureId): SupportVertexN | undefined {
    const support = this.source.resolveFeature?.(featureId);
    if (!support) return undefined;
    return {
      point: this.transformPoint(support.point),
      featureId: support.featureId
    };
  }

  enumerateVertices(): readonly SupportVertexN[] | undefined {
    const vertices = this.source.enumerateVertices?.();
    return vertices?.map((support) => ({
      point: this.transformPoint(support.point),
      featureId: support.featureId
    }));
  }

  private transformPoint(point: VecN): VecN {
    return this.rotation.applyToPoint(
      point.clone().sub(this.trajectory.start.position)
    ).add(this.pivot);
  }
}

function vector4(
  value: VecN | ArrayLike<number>,
  name: string,
  owner: string
): VecN {
  const vector = value instanceof VecN ? value.clone() : new VecN(value);
  if (
    vector.dim !== 4 ||
    Array.from(vector.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error(`${owner}: ${name} must contain four finite coordinates`);
  }
  return vector;
}
