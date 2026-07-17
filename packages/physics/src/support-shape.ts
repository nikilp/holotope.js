import {
  type CellComplex,
  MatN,
  Rotor4,
  TransformN,
  VecN
} from '@holotope/core';
import type { ConvexPolytopeTopologyN } from './polytope-topology.js';

/** Stable source feature identity carried through support queries and GJK. */
export type SupportFeatureId = number | string;

export interface SupportVertexN {
  /** Support point in the shape's current/world coordinate frame. */
  readonly point: VecN;
  /** Stable source feature; vertex index for a vertex hull. */
  readonly featureId: SupportFeatureId;
}

/** Minimal convex-shape contract required by dimension-generic GJK. */
export interface SupportShapeN {
  readonly dim: number;
  /** A point inside the convex hull, used only to choose an initial direction. */
  readonly center: VecN;
  /** Farthest point in `direction`; ties must resolve deterministically. */
  support(direction: VecN): SupportVertexN;
  /**
   * Rehydrate a direction-independent source feature at the current pose.
   * Optional because smooth and rounded supports depend on query direction.
   */
  resolveFeature?(featureId: SupportFeatureId): SupportVertexN | undefined;
  /**
   * Enumerate every source vertex when the support shape is a polytope.
   * Smooth and opaque support functions leave this unavailable. Stable feature
   * IDs let contact features survive rigid pose changes.
   */
  enumerateVertices?(): readonly SupportVertexN[] | undefined;
  /** Optional pose-independent incidence compiled from the stable vertex IDs. */
  readonly polytopeTopology?: ConvexPolytopeTopologyN | undefined;
}

/** Returns a validated polytope vertex enumeration, or undefined when absent. */
export function supportShapeVerticesN(
  shape: SupportShapeN
): readonly SupportVertexN[] | undefined {
  const vertices = shape.enumerateVertices?.();
  if (vertices === undefined) return undefined;
  if (vertices.length === 0) {
    throw new Error('supportShapeVerticesN: enumeration must not be empty');
  }
  const ids = new Set<string>();
  for (const vertex of vertices) {
    if (
      vertex.point.dim !== shape.dim ||
      Array.from(vertex.point.data).some((value) => !Number.isFinite(value))
    ) {
      throw new Error(
        `supportShapeVerticesN: every vertex must contain ${shape.dim} finite coordinates`
      );
    }
    const key = supportFeatureKeyN(vertex.featureId);
    if (ids.has(key)) {
      throw new Error(`supportShapeVerticesN: duplicate feature ID ${key}`);
    }
    ids.add(key);
  }
  return vertices;
}

/** Type-preserving canonical key for a numeric or string support feature. */
export function supportFeatureKeyN(featureId: SupportFeatureId): string {
  if (typeof featureId === 'number') {
    if (!Number.isFinite(featureId)) {
      throw new Error('supportFeatureKeyN: numeric feature IDs must be finite');
    }
    return `n:${featureId}`;
  }
  return `s:${JSON.stringify(featureId)}`;
}

/**
 * Convex hull of a packed vertex cloud. Cell topology is not required by GJK;
 * when constructed from a CellComplex, returned feature IDs are its vertex IDs.
 */
export class ConvexHullSupportShapeN implements SupportShapeN {
  readonly dim: number;
  readonly positions: Float64Array;
  readonly center: VecN;

  constructor(dim: number, positions: ArrayLike<number>) {
    if (!Number.isSafeInteger(dim) || dim < 1) {
      throw new Error('ConvexHullSupportShapeN: dim must be a positive integer');
    }
    if (positions.length === 0 || positions.length % dim !== 0) {
      throw new Error(
        'ConvexHullSupportShapeN: positions must contain one or more packed points'
      );
    }
    this.dim = dim;
    this.positions = Float64Array.from(positions);
    if (Array.from(this.positions).some((value) => !Number.isFinite(value))) {
      throw new Error('ConvexHullSupportShapeN: coordinates must be finite');
    }
    this.center = new VecN(dim);
    const count = this.positions.length / dim;
    for (let vertex = 0; vertex < count; vertex++) {
      for (let axis = 0; axis < dim; axis++) {
        this.center.data[axis]! += this.positions[vertex * dim + axis]! / count;
      }
    }
  }

  static fromCellComplex(complex: CellComplex): ConvexHullSupportShapeN {
    return new ConvexHullSupportShapeN(complex.ambientDim, complex.positions);
  }

  get vertexCount(): number {
    return this.positions.length / this.dim;
  }

  support(direction: VecN): SupportVertexN {
    assertDirection(direction, this.dim, 'ConvexHullSupportShapeN');
    let bestVertex = 0;
    let bestDot = Number.NEGATIVE_INFINITY;
    for (let vertex = 0; vertex < this.vertexCount; vertex++) {
      let dot = 0;
      for (let axis = 0; axis < this.dim; axis++) {
        dot += this.positions[vertex * this.dim + axis]! * direction.data[axis]!;
      }
      // Strict comparison makes equal-support ties resolve to the lowest
      // source vertex ID, keeping traces and warm starts deterministic.
      if (dot > bestDot) {
        bestDot = dot;
        bestVertex = vertex;
      }
    }
    return {
      point: new VecN(
        this.positions.subarray(bestVertex * this.dim, (bestVertex + 1) * this.dim)
      ),
      featureId: bestVertex
    };
  }

  resolveFeature(featureId: SupportFeatureId): SupportVertexN | undefined {
    if (
      typeof featureId !== 'number' ||
      !Number.isSafeInteger(featureId) ||
      featureId < 0 ||
      featureId >= this.vertexCount
    ) {
      return undefined;
    }
    return {
      point: new VecN(
        this.positions.subarray(featureId * this.dim, (featureId + 1) * this.dim)
      ),
      featureId
    };
  }

  enumerateVertices(): readonly SupportVertexN[] {
    return Array.from({ length: this.vertexCount }, (_, vertex) => ({
      point: new VecN(
        this.positions.subarray(vertex * this.dim, (vertex + 1) * this.dim)
      ),
      featureId: vertex
    }));
  }
}

/** Rigid world transform around any local support shape. */
export class TransformedSupportShapeN implements SupportShapeN {
  readonly source: SupportShapeN;
  transform: TransformN;

  constructor(source: SupportShapeN, transform?: TransformN) {
    this.source = source;
    this.transform = transform?.clone() ?? TransformN.identity(source.dim);
    if (this.transform.dim !== source.dim) {
      throw new Error(
        `TransformedSupportShapeN: transform dim ${this.transform.dim} != shape dim ${source.dim}`
      );
    }
  }

  get dim(): number {
    return this.source.dim;
  }

  get center(): VecN {
    return this.transform.applyToPoint(this.source.center);
  }

  get polytopeTopology(): ConvexPolytopeTopologyN | undefined {
    return this.source.polytopeTopology;
  }

  support(direction: VecN): SupportVertexN {
    assertDirection(direction, this.dim, 'TransformedSupportShapeN');
    const inverseDirection = applyInverseRotation(this.transform, direction);
    const local = this.source.support(inverseDirection);
    return {
      point: this.transform.applyToPoint(local.point),
      featureId: local.featureId
    };
  }

  resolveFeature(featureId: SupportFeatureId): SupportVertexN | undefined {
    const local = this.source.resolveFeature?.(featureId);
    if (!local) return undefined;
    return {
      point: this.transform.applyToPoint(local.point),
      featureId: local.featureId
    };
  }

  enumerateVertices(): readonly SupportVertexN[] | undefined {
    const local = this.source.enumerateVertices?.();
    return local?.map((vertex) => ({
      point: this.transform.applyToPoint(vertex.point),
      featureId: vertex.featureId
    }));
  }
}

/** N-ball (a glome in R4) with analytic support. */
export class GlomeSupportShapeN implements SupportShapeN {
  readonly dim: number;
  readonly center: VecN;
  radius: number;

  constructor(center: VecN | ArrayLike<number>, radius: number) {
    this.center = center instanceof VecN ? center.clone() : new VecN(center);
    this.dim = this.center.dim;
    if (this.dim < 1 || Array.from(this.center.data).some((value) => !Number.isFinite(value))) {
      throw new Error('GlomeSupportShapeN: center must contain finite coordinates');
    }
    if (!Number.isFinite(radius) || radius < 0) {
      throw new Error('GlomeSupportShapeN: radius must be finite and non-negative');
    }
    this.radius = radius;
  }

  support(direction: VecN): SupportVertexN {
    assertDirection(direction, this.dim, 'GlomeSupportShapeN');
    const length = direction.length();
    const point = this.center.clone();
    if (length > 0 && this.radius > 0) {
      point.add(direction.clone().multiplyScalar(this.radius / length));
    }
    return { point, featureId: 'smooth' };
  }
}

/** Minkowski sum of a convex core with an N-ball margin. */
export class RoundedSupportShapeN implements SupportShapeN {
  readonly source: SupportShapeN;
  margin: number;

  constructor(source: SupportShapeN, margin: number) {
    if (!Number.isFinite(margin) || margin < 0) {
      throw new Error('RoundedSupportShapeN: margin must be finite and non-negative');
    }
    this.source = source;
    this.margin = margin;
  }

  get dim(): number {
    return this.source.dim;
  }

  get center(): VecN {
    return this.source.center.clone();
  }

  support(direction: VecN): SupportVertexN {
    assertDirection(direction, this.dim, 'RoundedSupportShapeN');
    const support = this.source.support(direction);
    const point = support.point.clone();
    const length = direction.length();
    if (length > 0 && this.margin > 0) {
      point.add(direction.clone().multiplyScalar(this.margin / length));
    }
    return { point, featureId: support.featureId };
  }
}

function assertDirection(direction: VecN, dim: number, owner: string): void {
  if (
    direction.dim !== dim ||
    Array.from(direction.data).some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`${owner}: direction must contain ${dim} finite coordinates`);
  }
}

function applyInverseRotation(transform: TransformN, direction: VecN): VecN {
  const rotation = transform.rotation;
  if (rotation instanceof Rotor4) return rotation.conjugate().applyToPoint(direction);
  if (rotation instanceof MatN) return rotation.transpose().applyTo(direction);
  // RotationBackend is currently closed over MatN | Rotor4. This branch keeps
  // failure explicit if another backend is added without support-shape work.
  throw new Error('TransformedSupportShapeN: unsupported rotation backend');
}
