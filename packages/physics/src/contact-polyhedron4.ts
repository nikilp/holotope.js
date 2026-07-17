import { VecN } from '@holotope/core';
import { contactTangentBasis4 } from './contact-kinematics4.js';

export type ContactPatchKind4 = 'point' | 'segment' | 'polygon' | 'polyhedron';

/** World-space halfspace `normal.dot(point) <= offset`. */
export interface ContactHalfspace4 {
  readonly normal: VecN;
  readonly offset: number;
}

export interface ContactPlaneIntersectionOptions4 {
  readonly feasibilityTolerance: number;
  readonly vertexTolerance: number;
  readonly rankTolerance: number;
  readonly maxSolverPoints: number;
}

export interface ContactPlaneVertex4 {
  readonly tangent: Float64Array;
  readonly point: VecN;
  readonly activeHalfspaces: readonly number[];
}

export interface ContactPlaneIntersectionDiagnostics4 {
  readonly constraints: number;
  readonly effectiveConstraints: number;
  readonly triplesTested: number;
  readonly feasibleCandidates: number;
  readonly uniqueVertices: number;
  readonly solverPoints: number;
}

export interface ContactPlaneIntersection4 {
  readonly kind: ContactPatchKind4;
  readonly intrinsicDim: 0 | 1 | 2 | 3;
  readonly vertices: readonly ContactPlaneVertex4[];
  readonly solverIndices: readonly number[];
  readonly diagnostics: ContactPlaneIntersectionDiagnostics4;
}

export interface ContactPointReduction4 {
  readonly kind: ContactPatchKind4;
  readonly intrinsicDim: 0 | 1 | 2 | 3;
  readonly solverIndices: readonly number[];
}

/** Deterministically reduce coplanar R4 points without losing affine span. */
export function reduceContactPoints4(
  points: readonly VecN[],
  planeNormal: VecN,
  maxSolverPoints: number,
  rankTolerance: number
): ContactPointReduction4 {
  if (points.length === 0) {
    throw new Error('reduceContactPoints4: points must not be empty');
  }
  if (
    planeNormal.dim !== 4 ||
    Array.from(planeNormal.data).some((value) => !Number.isFinite(value)) ||
    !(planeNormal.length() > 0) ||
    points.some((point) =>
      point.dim !== 4 || Array.from(point.data).some((value) => !Number.isFinite(value))
    )
  ) {
    throw new Error('reduceContactPoints4: expected finite R4 points and normal');
  }
  if (
    !Number.isSafeInteger(maxSolverPoints) ||
    maxSolverPoints < 4 ||
    maxSolverPoints > 32
  ) {
    throw new Error('reduceContactPoints4: maxSolverPoints must be in [4, 32]');
  }
  if (!Number.isFinite(rankTolerance) || rankTolerance < 0) {
    throw new Error('reduceContactPoints4: rankTolerance must be finite and non-negative');
  }
  const normal = planeNormal.clone().normalize();
  const tangentBasis = contactTangentBasis4(normal, undefined, rankTolerance);
  const origin = points[0]!;
  const tangentPoints = points.map((point) => {
    const delta = point.clone().sub(origin);
    return Float64Array.from(tangentBasis.map((axis) => axis.dot(delta)));
  });
  const affine = affineBasis3(tangentPoints, rankTolerance);
  const intrinsicDim = affine.length as 0 | 1 | 2 | 3;
  return {
    kind: patchKind(intrinsicDim),
    intrinsicDim,
    solverIndices: reducedSolverIndices(
      tangentPoints,
      affine,
      maxSolverPoints,
      rankTolerance
    )
  };
}

interface Halfspace3 {
  coefficient: Float64Array;
  bound: number;
  sourceIndex: number;
}

/**
 * Enumerates the bounded intersection of R4 halfspaces inside one contact
 * hyperplane. The resulting problem is three-dimensional: every vertex is the
 * feasible intersection of three independent projected boundary planes.
 */
export function intersectContactHalfspaces4(
  planeNormal: VecN,
  planeOffset: number,
  halfspaces: readonly ContactHalfspace4[],
  options: ContactPlaneIntersectionOptions4
): ContactPlaneIntersection4 {
  assertInputs(planeNormal, planeOffset, halfspaces, options);
  const normal = planeNormal.clone().normalize();
  const origin = normal.clone().multiplyScalar(planeOffset);
  const tangentBasis = contactTangentBasis4(normal, undefined, options.rankTolerance);
  const constraints: Halfspace3[] = halfspaces.map((halfspace, sourceIndex) => ({
    coefficient: Float64Array.from(
      tangentBasis.map((tangent) => halfspace.normal.dot(tangent))
    ),
    bound: halfspace.offset - halfspace.normal.dot(origin),
    sourceIndex
  }));
  const effective = constraints.filter(
    (constraint) => length3(constraint.coefficient) > options.rankTolerance
  );
  for (const constraint of constraints) {
    if (
      length3(constraint.coefficient) <= options.rankTolerance &&
      constraint.bound < -scaledTolerance(
        options.feasibilityTolerance,
        constraint.bound
      )
    ) {
      throw new Error(
        'intersectContactHalfspaces4: contact plane lies outside a supplied halfspace'
      );
    }
  }

  const candidates: { tangent: Float64Array; point: VecN }[] = [];
  let triplesTested = 0;
  let feasibleCandidates = 0;
  for (let i = 0; i < effective.length - 2; i++) {
    for (let j = i + 1; j < effective.length - 1; j++) {
      for (let k = j + 1; k < effective.length; k++) {
        triplesTested++;
        const tangent = solveConstraintTriple(
          effective[i]!,
          effective[j]!,
          effective[k]!,
          options.rankTolerance
        );
        if (
          !tangent ||
          !satisfiesAll(tangent, constraints, options.feasibilityTolerance)
        ) {
          continue;
        }
        feasibleCandidates++;
        if (
          candidates.some(
            (candidate) =>
              distance3(candidate.tangent, tangent) <= options.vertexTolerance
          )
        ) {
          continue;
        }
        candidates.push({
          tangent,
          point: tangentToWorld(tangent, origin, tangentBasis)
        });
      }
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      'intersectContactHalfspaces4: failed to enumerate a bounded contact patch'
    );
  }
  candidates.sort((left, right) => lexicographic3(left.tangent, right.tangent));

  const tangentPoints = candidates.map(({ tangent }) => tangent);
  const affine = affineBasis3(tangentPoints, options.rankTolerance);
  const intrinsicDim = affine.length as 0 | 1 | 2 | 3;
  const vertices = candidates.map(({ tangent, point }): ContactPlaneVertex4 => ({
    tangent,
    point,
    activeHalfspaces: constraints
      .filter((constraint) => {
        const projection = dot3(constraint.coefficient, tangent);
        return Math.abs(projection - constraint.bound) <= scaledTolerance(
          Math.max(options.feasibilityTolerance, options.vertexTolerance),
          projection,
          constraint.bound
        );
      })
      .map(({ sourceIndex }) => sourceIndex)
      .sort((left, right) => left - right)
  }));
  const solverIndices = reducedSolverIndices(
    tangentPoints,
    affine,
    options.maxSolverPoints,
    options.rankTolerance
  );
  return {
    kind: patchKind(intrinsicDim),
    intrinsicDim,
    vertices,
    solverIndices,
    diagnostics: {
      constraints: constraints.length,
      effectiveConstraints: effective.length,
      triplesTested,
      feasibleCandidates,
      uniqueVertices: vertices.length,
      solverPoints: solverIndices.length
    }
  };
}

function solveConstraintTriple(
  a: Halfspace3,
  b: Halfspace3,
  c: Halfspace3,
  tolerance: number
): Float64Array | null {
  const determinant = determinant3(a.coefficient, b.coefficient, c.coefficient);
  const scale = Math.max(
    1,
    length3(a.coefficient) * length3(b.coefficient) * length3(c.coefficient)
  );
  if (Math.abs(determinant) <= tolerance * scale) return null;
  return new Float64Array([
    determinant3(
      [a.bound, a.coefficient[1]!, a.coefficient[2]!],
      [b.bound, b.coefficient[1]!, b.coefficient[2]!],
      [c.bound, c.coefficient[1]!, c.coefficient[2]!]
    ) / determinant,
    determinant3(
      [a.coefficient[0]!, a.bound, a.coefficient[2]!],
      [b.coefficient[0]!, b.bound, b.coefficient[2]!],
      [c.coefficient[0]!, c.bound, c.coefficient[2]!]
    ) / determinant,
    determinant3(
      [a.coefficient[0]!, a.coefficient[1]!, a.bound],
      [b.coefficient[0]!, b.coefficient[1]!, b.bound],
      [c.coefficient[0]!, c.coefficient[1]!, c.bound]
    ) / determinant
  ]);
}

function determinant3(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  c: ArrayLike<number>
): number {
  return a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!)
    - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!)
    + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
}

function satisfiesAll(
  point: ArrayLike<number>,
  constraints: readonly Halfspace3[],
  tolerance: number
): boolean {
  return constraints.every((constraint) => {
    const projection = dot3(constraint.coefficient, point);
    return projection <= constraint.bound + scaledTolerance(
      tolerance,
      projection,
      constraint.bound
    );
  });
}

function tangentToWorld(
  tangent: ArrayLike<number>,
  origin: VecN,
  tangentBasis: readonly VecN[]
): VecN {
  const point = origin.clone();
  for (let axis = 0; axis < 3; axis++) {
    point.add(tangentBasis[axis]!.clone().multiplyScalar(tangent[axis]!));
  }
  return point;
}

function affineBasis3(
  points: readonly ArrayLike<number>[],
  tolerance: number
): Float64Array[] {
  if (points.length <= 1) return [];
  const origin = points[0]!;
  const basis: Float64Array[] = [];
  for (let index = 1; index < points.length && basis.length < 3; index++) {
    const candidate = subtract3(points[index]!, origin);
    for (const accepted of basis) {
      addScaled3(candidate, accepted, -dot3(candidate, accepted));
    }
    const length = length3(candidate);
    if (length > tolerance) basis.push(scale3(candidate, 1 / length));
  }
  return basis;
}

function reducedSolverIndices(
  points: readonly ArrayLike<number>[],
  affineBasis: readonly ArrayLike<number>[],
  maximum: number,
  rankTolerance: number
): number[] {
  if (points.length <= maximum) return points.map((_, index) => index);
  const selected: number[] = [];
  const extremes: number[] = [];
  const add = (index: number): void => {
    if (!selected.includes(index) && selected.length < maximum) selected.push(index);
  };
  const addExtreme = (index: number): void => {
    if (!extremes.includes(index)) extremes.push(index);
  };

  for (const direction of affineBasis) {
    let minimum = 0;
    let maximumIndex = 0;
    for (let index = 1; index < points.length; index++) {
      const projection = dot3(points[index]!, direction);
      if (projection < dot3(points[minimum]!, direction)) minimum = index;
      if (projection > dot3(points[maximumIndex]!, direction)) maximumIndex = index;
    }
    addExtreme(minimum);
    addExtreme(maximumIndex);
  }

  for (const index of extremes) {
    const before = affineRankOfSelection(points, selected, rankTolerance);
    const after = affineRankOfSelection(points, [...selected, index], rankTolerance);
    if (selected.length === 0 || after > before) add(index);
    if (after >= affineBasis.length && selected.length >= affineBasis.length + 1) break;
  }
  for (let index = 0; index < points.length && selected.length < maximum; index++) {
    const before = affineRankOfSelection(points, selected, rankTolerance);
    const after = affineRankOfSelection(points, [...selected, index], rankTolerance);
    if (selected.length === 0 || after > before) add(index);
    if (after >= affineBasis.length && selected.length >= affineBasis.length + 1) break;
  }
  for (const index of extremes) add(index);

  while (selected.length < maximum) {
    let bestIndex = -1;
    let bestDistance = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < points.length; index++) {
      if (selected.includes(index)) continue;
      const minimumDistance = selected.length === 0
        ? 0
        : Math.min(
          ...selected.map((chosen) => distance3(points[index]!, points[chosen]!))
        );
      if (minimumDistance > bestDistance) {
        bestDistance = minimumDistance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    add(bestIndex);
  }
  return selected.sort((left, right) => left - right);
}

function affineRankOfSelection(
  points: readonly ArrayLike<number>[],
  indices: readonly number[],
  tolerance: number
): number {
  return affineBasis3(indices.map((index) => points[index]!), tolerance).length;
}

function patchKind(dimension: 0 | 1 | 2 | 3): ContactPatchKind4 {
  return (['point', 'segment', 'polygon', 'polyhedron'] as const)[dimension];
}

function lexicographic3(left: ArrayLike<number>, right: ArrayLike<number>): number {
  for (let axis = 0; axis < 3; axis++) {
    const difference = left[axis]! - right[axis]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function dot3(left: ArrayLike<number>, right: ArrayLike<number>): number {
  return left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
}

function length3(value: ArrayLike<number>): number {
  return Math.sqrt(dot3(value, value));
}

function distance3(left: ArrayLike<number>, right: ArrayLike<number>): number {
  return length3(subtract3(left, right));
}

function subtract3(left: ArrayLike<number>, right: ArrayLike<number>): Float64Array {
  return new Float64Array([
    left[0]! - right[0]!,
    left[1]! - right[1]!,
    left[2]! - right[2]!
  ]);
}

function addScaled3(
  target: Float64Array,
  value: ArrayLike<number>,
  scale: number
): void {
  for (let axis = 0; axis < 3; axis++) {
    target[axis] = target[axis]! + value[axis]! * scale;
  }
}

function scale3(value: Float64Array, scale: number): Float64Array {
  for (let axis = 0; axis < 3; axis++) value[axis] = value[axis]! * scale;
  return value;
}

function scaledTolerance(tolerance: number, ...values: number[]): number {
  return tolerance * Math.max(1, ...values.map(Math.abs));
}

function assertInputs(
  planeNormal: VecN,
  planeOffset: number,
  halfspaces: readonly ContactHalfspace4[],
  options: ContactPlaneIntersectionOptions4
): void {
  if (
    planeNormal.dim !== 4 ||
    Array.from(planeNormal.data).some((value) => !Number.isFinite(value)) ||
    !(planeNormal.length() > 0)
  ) {
    throw new Error('intersectContactHalfspaces4: plane normal must be nonzero finite R4');
  }
  if (!Number.isFinite(planeOffset)) {
    throw new Error('intersectContactHalfspaces4: plane offset must be finite');
  }
  if (halfspaces.length < 4) {
    throw new Error('intersectContactHalfspaces4: at least four halfspaces are required');
  }
  for (const halfspace of halfspaces) {
    if (
      halfspace.normal.dim !== 4 ||
      Array.from(halfspace.normal.data).some((value) => !Number.isFinite(value)) ||
      !Number.isFinite(halfspace.offset)
    ) {
      throw new Error('intersectContactHalfspaces4: halfspaces must be finite R4 planes');
    }
  }
  for (const [name, value] of [
    ['feasibilityTolerance', options.feasibilityTolerance],
    ['vertexTolerance', options.vertexTolerance],
    ['rankTolerance', options.rankTolerance]
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`intersectContactHalfspaces4: ${name} must be finite and non-negative`);
    }
  }
  if (
    !Number.isSafeInteger(options.maxSolverPoints) ||
    options.maxSolverPoints < 4 ||
    options.maxSolverPoints > 32
  ) {
    throw new Error(
      'intersectContactHalfspaces4: maxSolverPoints must be an integer in [4, 32]'
    );
  }
}
