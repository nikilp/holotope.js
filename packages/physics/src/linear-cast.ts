import { VecN } from '@holotope/core';
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
import type {
  SupportFeatureId,
  SupportShapeN,
  SupportVertexN
} from './support-shape.js';

export type LinearCastStatusN =
  | 'impact'
  | 'initial-overlap'
  | 'miss'
  | 'indeterminate';

export type LinearCastReasonN =
  | 'contact-band'
  | 'initial-overlap'
  | 'separating-motion'
  | 'past-horizon'
  | 'gjk-iteration-limit'
  | 'advancement-stalled'
  | 'advancement-limit';

export interface ConvexLinearCastOptionsN {
  /** Maximum conservative-advancement steps. Default 32. */
  readonly maxIterations?: number;
  /** Report impact at this non-negative separation. Default 0. */
  readonly targetDistance?: number;
  /** World-space contact band. Default 1e-12. */
  readonly distanceTolerance?: number;
  /** Normalized sweep-fraction progress band. Default 1e-12. */
  readonly timeTolerance?: number;
  /** Closing-speed zero band in displacement units. Default 1e-14. */
  readonly speedTolerance?: number;
  /** GJK policy reused at every sampled pose. Warm starts are managed internally. */
  readonly gjkOptions?: Omit<
    GjkOptions,
    'absoluteTolerance' | 'warmStart' | 'signOracle'
  >;
  /** Retain one compact record per advancement step. Default false. */
  readonly recordTrace?: boolean;
}

export interface LinearCastTraceEntryN {
  readonly iteration: number;
  readonly time: number;
  readonly distance: number;
  readonly closingSpeed: number | null;
  readonly advance: number | null;
}

export interface ConvexLinearCastResultN {
  readonly kind: 'convex';
  readonly status: LinearCastStatusN;
  readonly reason: LinearCastReasonN;
  readonly hit: boolean | null;
  /** Normalized fraction in [0,1], or null when no impact is certified. */
  readonly time: number | null;
  /** Interval [0, safeTime) is certified outside the requested contact band. */
  readonly safeTime: number;
  readonly distance: number;
  /** Last separating normal from B toward A; null for an initial overlap. */
  readonly normal: VecN | null;
  readonly pointA: VecN;
  readonly pointB: VecN;
  readonly iterations: number;
  readonly gjkIterations: number;
  readonly finalQuery: GjkResult;
  readonly trace?: readonly LinearCastTraceEntryN[];
}

export interface HyperplaneLinearCastOptionsN {
  /** Report impact at this non-negative separation. Default 0. */
  readonly targetDistance?: number;
  /** World-space contact band. Default 1e-12. */
  readonly distanceTolerance?: number;
  /** Normalized sweep-fraction band. Default 1e-12. */
  readonly timeTolerance?: number;
  /** Closing-speed zero band in displacement units. Default 1e-14. */
  readonly speedTolerance?: number;
}

export interface HyperplaneLinearCastResultN {
  readonly kind: 'hyperplane';
  readonly status: Exclude<LinearCastStatusN, 'indeterminate'>;
  readonly reason: Exclude<
    LinearCastReasonN,
    'gjk-iteration-limit' | 'advancement-stalled' | 'advancement-limit'
  >;
  readonly hit: boolean;
  readonly time: number | null;
  readonly safeTime: number;
  readonly distance: number;
  readonly normal: VecN;
  readonly pointOnShape: VecN;
  readonly pointOnPlane: VecN;
  readonly featureId: SupportFeatureId;
  readonly finalQuery: HyperplaneQueryResult;
}

interface ResolvedConvexCastOptionsN {
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

interface ResolvedHyperplaneCastOptionsN {
  targetDistance: number;
  distanceTolerance: number;
  timeTolerance: number;
  speedTolerance: number;
}

/**
 * Dimension-independent linear shape cast for two compact convex bodies.
 *
 * The input vectors are complete displacements over one normalized interval,
 * not velocities. Each advancement is bounded by the current separating
 * plane, so no sampled step can pass through first contact. Rotation is an
 * explicitly separate trajectory problem and is not approximated here.
 */
export function convexLinearCastN(
  shapeA: SupportShapeN,
  displacementA: VecN | ArrayLike<number>,
  shapeB: SupportShapeN,
  displacementB: VecN | ArrayLike<number>,
  options: ConvexLinearCastOptionsN = {}
): ConvexLinearCastResultN {
  if (shapeA.dim !== shapeB.dim) {
    throw new Error(
      `convexLinearCastN: shape dimensions differ (${shapeA.dim} vs ${shapeB.dim})`
    );
  }
  const dim = shapeA.dim;
  const deltaA = finiteVector(displacementA, dim, 'displacementA', 'convexLinearCastN');
  const deltaB = finiteVector(displacementB, dim, 'displacementB', 'convexLinearCastN');
  const relativeDisplacement = deltaA.clone().sub(deltaB);
  const resolved = resolveConvexOptions(options);
  const movedA = new OffsetSupportShapeN(shapeA);
  const movedB = new OffsetSupportShapeN(shapeB);
  const trace: LinearCastTraceEntryN[] | undefined = resolved.recordTrace
    ? []
    : undefined;
  let time = 0;
  let safeTime = 0;
  let previousNormal: VecN | null = null;
  let warmStart: GjkWarmStartN | undefined;
  let totalGjkIterations = 0;
  let finalQuery: GjkResult | undefined;

  for (let iteration = 0; iteration <= resolved.maxIterations; iteration++) {
    movedA.setOffset(deltaA, time);
    movedB.setOffset(deltaB, time);
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
        closingSpeed: null,
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
        trace
      );
    }
    if (query.intersects) {
      trace?.push({
        iteration,
        time,
        distance: 0,
        closingSpeed: null,
        advance: null
      });
      const initial = time === 0;
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
        trace
      );
    }
    if (query.distance <= resolved.targetDistance + resolved.distanceTolerance) {
      trace?.push({
        iteration,
        time,
        distance: query.distance,
        closingSpeed: null,
        advance: null
      });
      return convexResult(
        'impact',
        'contact-band',
        true,
        time,
        time,
        query.normal ?? previousNormal,
        iteration + 1,
        totalGjkIterations,
        query,
        trace
      );
    }

    const normal = query.normal;
    if (!normal) {
      throw new Error('convexLinearCastN: separated GJK result has no normal');
    }
    previousNormal = normal.clone();
    const closingSpeed = -normal.dot(relativeDisplacement);
    if (closingSpeed <= resolved.speedTolerance) {
      trace?.push({
        iteration,
        time,
        distance: query.distance,
        closingSpeed,
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
        trace
      );
    }
    const advance = (query.distance - resolved.targetDistance) / closingSpeed;
    trace?.push({
      iteration,
      time,
      distance: query.distance,
      closingSpeed,
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
    trace
  );
}

/** Exact linear cast of one compact support shape against a static plane. */
export function supportShapeHyperplaneLinearCastN(
  shape: SupportShapeN,
  displacement: VecN | ArrayLike<number>,
  plane: HyperplaneColliderN,
  options: HyperplaneLinearCastOptionsN = {}
): HyperplaneLinearCastResultN {
  if (shape.dim !== plane.dim) {
    throw new Error(
      `supportShapeHyperplaneLinearCastN: shape dimension ${shape.dim} != plane dimension ${plane.dim}`
    );
  }
  const delta = finiteVector(
    displacement,
    shape.dim,
    'displacement',
    'supportShapeHyperplaneLinearCastN'
  );
  const resolved = resolveHyperplaneOptions(options);
  const initial = querySupportShapeHyperplane(shape, plane, {
    tolerance: resolved.distanceTolerance
  });
  if (initial.status === 'penetrating') {
    return hyperplaneResult(
      'initial-overlap',
      'initial-overlap',
      true,
      0,
      0,
      initial
    );
  }
  if (
    initial.status === 'touching' ||
    initial.signedDistance <= resolved.targetDistance + resolved.distanceTolerance
  ) {
    return hyperplaneResult('impact', 'contact-band', true, 0, 0, initial);
  }
  const closingSpeed = -plane.normal.dot(delta);
  if (closingSpeed <= resolved.speedTolerance) {
    return hyperplaneResult(
      'miss',
      'separating-motion',
      false,
      null,
      1,
      initial
    );
  }
  const impactTime =
    (initial.signedDistance - resolved.targetDistance) / closingSpeed;
  if (impactTime > 1 + resolved.timeTolerance) {
    return hyperplaneResult(
      'miss',
      'past-horizon',
      false,
      null,
      1,
      initial
    );
  }
  const time = Math.max(0, Math.min(1, impactTime));
  const moved = new OffsetSupportShapeN(shape);
  moved.setOffset(delta, time);
  const finalQuery = querySupportShapeHyperplane(moved, plane, {
    tolerance: resolved.distanceTolerance
  });
  return hyperplaneResult('impact', 'contact-band', true, time, time, finalQuery);
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
  trace: LinearCastTraceEntryN[] | undefined
): ConvexLinearCastResultN {
  return {
    kind: 'convex',
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
    finalQuery,
    ...(trace ? { trace } : {})
  };
}

function hyperplaneResult(
  status: HyperplaneLinearCastResultN['status'],
  reason: HyperplaneLinearCastResultN['reason'],
  hit: boolean,
  time: number | null,
  safeTime: number,
  finalQuery: HyperplaneQueryResult
): HyperplaneLinearCastResultN {
  return {
    kind: 'hyperplane',
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
    finalQuery
  };
}

function resolveConvexOptions(
  options: ConvexLinearCastOptionsN
): ResolvedConvexCastOptionsN {
  const maxIterations = options.maxIterations ?? 32;
  if (!Number.isSafeInteger(maxIterations) || maxIterations < 1) {
    throw new Error('convexLinearCastN: maxIterations must be a positive integer');
  }
  const values = resolveCommonOptions(options, 'convexLinearCastN');
  return {
    maxIterations,
    ...values,
    gjkOptions: { ...options.gjkOptions },
    recordTrace: options.recordTrace ?? false
  };
}

function resolveHyperplaneOptions(
  options: HyperplaneLinearCastOptionsN
): ResolvedHyperplaneCastOptionsN {
  return resolveCommonOptions(options, 'supportShapeHyperplaneLinearCastN');
}

function resolveCommonOptions(
  options: HyperplaneLinearCastOptionsN,
  owner: string
): ResolvedHyperplaneCastOptionsN {
  const resolved = {
    targetDistance: options.targetDistance ?? 0,
    distanceTolerance: options.distanceTolerance ?? 1e-12,
    timeTolerance: options.timeTolerance ?? 1e-12,
    speedTolerance: options.speedTolerance ?? 1e-14
  };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${owner}: ${name} must be finite and non-negative`);
    }
  }
  return resolved;
}

function finiteVector(
  value: VecN | ArrayLike<number>,
  dim: number,
  name: string,
  owner: string
): VecN {
  const vector = value instanceof VecN ? value.clone() : new VecN(value);
  if (
    vector.dim !== dim ||
    Array.from(vector.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error(`${owner}: ${name} must contain ${dim} finite coordinates`);
  }
  return vector;
}

/** Mutable translated view used only within one cast. */
class OffsetSupportShapeN implements SupportShapeN {
  readonly source: SupportShapeN;
  private readonly offset: VecN;

  constructor(source: SupportShapeN) {
    this.source = source;
    this.offset = new VecN(source.dim);
  }

  get dim(): number {
    return this.source.dim;
  }

  get center(): VecN {
    return this.source.center.clone().add(this.offset);
  }

  get polytopeTopology(): SupportShapeN['polytopeTopology'] {
    return this.source.polytopeTopology;
  }

  setOffset(displacement: VecN, time: number): void {
    for (let axis = 0; axis < this.dim; axis++) {
      this.offset.data[axis] = displacement.data[axis]! * time;
    }
  }

  support(direction: VecN): SupportVertexN {
    const support = this.source.support(direction);
    return {
      point: support.point.clone().add(this.offset),
      featureId: support.featureId
    };
  }

  resolveFeature(featureId: SupportFeatureId): SupportVertexN | undefined {
    const support = this.source.resolveFeature?.(featureId);
    if (!support) return undefined;
    return {
      point: support.point.clone().add(this.offset),
      featureId: support.featureId
    };
  }

  enumerateVertices(): readonly SupportVertexN[] | undefined {
    const vertices = this.source.enumerateVertices?.();
    return vertices?.map((support) => ({
      point: support.point.clone().add(this.offset),
      featureId: support.featureId
    }));
  }
}
