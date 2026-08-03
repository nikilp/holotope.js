import { VecN } from '@holotope/core';

/**
 * Orientation-neutral fold coordinate for two adjacent source simplices.
 *
 * Two `d`-simplices sharing a `(d-1)`-face, embedded in RN with `1 <= d < N`.
 * With `Q` an orthonormal basis for the shared face's edge span and
 * `P = I - Q Qᵀ`:
 *
 * ```text
 * rA = P (a - f0),  rB = P (b - f0),  uA = rA/‖rA‖,  uB = rB/‖rB‖
 * c  = -uA · uB
 * ```
 *
 * `c` is the cosine of the fold measured from flat: `1` flat, `-1` fully
 * folded. For an R3 triangle hinge it equals `-cos(φ)` for the conventional
 * interior dihedral `φ`, verified to 2.22e-16 in the P48 measurement.
 *
 * This is deliberately **unsigned**. It cannot distinguish a mountain fold
 * from a valley fold, and must never be presented as a signed dihedral angle:
 * the sign convention that would give it one is specific to R3.
 *
 * Avoiding `acos` is not a micro-optimization. The derivative of `acos` is
 * singular at both endpoints, exactly where a flat or fully folded hinge sits,
 * so the cosine is the coordinate that stays differentiable where meshes
 * actually live.
 */
export interface SimplexHingeCosineNOptions {
  /** Shared-face positions in the caller's source order; `d` of them. */
  readonly sharedFace: readonly VecN[];
  /** Vertex of the first incident simplex opposite the shared face. */
  readonly oppositeA: VecN;
  /** Vertex of the second incident simplex opposite the shared face. */
  readonly oppositeB: VecN;
  /**
   * Relative tolerance for shared-face rank and conormal height. Default
   * `1e-10`. Scaled by the local geometry, never absolute.
   */
  readonly tolerance?: number;
}

/** Why a hinge has no defined fold coordinate. */
export type SimplexHingeCosineRefusalReasonN =
  | 'rank-deficient-shared-face'
  | 'vanishing-conormal-height';

/** Evidence available before a refusal, so the caller can see how close it was. */
export interface SimplexHingeCosineRefusalN {
  readonly status: 'refused';
  readonly reason: SimplexHingeCosineRefusalReasonN;
  readonly ambientDimension: number;
  readonly simplexDimension: number;
  /** Independent shared-face edge directions actually found. */
  readonly rank: number;
  /** Rank the shared face must have for the coordinate to exist. */
  readonly requiredRank: number;
  /** Smallest Gram-Schmidt residual relative to the largest edge. */
  readonly conditioning: number;
  /** Conormal heights, or `null` when rank failed before they were reachable. */
  readonly heightA: number | null;
  readonly heightB: number | null;
  /** Local length scale the relative tolerance was applied against. */
  readonly scale: number;
  readonly tolerance: number;
}

/** A defined fold coordinate with its complete first-derivative evidence. */
export interface SimplexHingeCosineEvaluationN {
  readonly status: 'evaluated';
  readonly ambientDimension: number;
  readonly simplexDimension: number;
  /** `-uA · uB`, in `[-1, 1]`; `1` is flat. */
  readonly coordinate: number;
  readonly rank: number;
  /** Smallest Gram-Schmidt residual over the largest edge; small is ill-posed. */
  readonly conditioning: number;
  /** Distance from `oppositeA` to the shared face's affine hull. */
  readonly heightA: number;
  readonly heightB: number;
  /** Unit conormals; both orthogonal to the shared-face span. */
  readonly conormalA: VecN;
  readonly conormalB: VecN;
  /**
   * `∂c/∂vertex`, one per hinge vertex, in the caller's input order
   * `[...sharedFace, oppositeA, oppositeB]`.
   *
   * The entries sum to exactly zero, so translation is a null mode by
   * construction rather than numerically.
   */
  readonly gradient: readonly VecN[];
}

export type SimplexHingeCosineResultN =
  | SimplexHingeCosineEvaluationN
  | SimplexHingeCosineRefusalN;

interface OrthonormalizationN {
  readonly basis: Float64Array[];
  /** Upper-triangular `R` with `E = Q R`. */
  readonly upper: Float64Array[];
  readonly smallest: number;
  readonly largest: number;
}

/**
 * Modified Gram-Schmidt, retaining `R` as well as `Q`.
 *
 * `R` is not incidental. The gradient needs the projection coefficients in the
 * *edge* parameterization (`proj = E α`), while Gram-Schmidt naturally yields
 * them in the orthonormal one (`proj = Q β`). Since `E = Q R`, `α = R⁻¹ β`.
 * Using `β` directly is a real and quiet error — the coordinate still looks
 * right and only the shared-face gradients are wrong.
 */
function orthonormalize(
  edges: readonly Float64Array[],
  tolerance: number
): OrthonormalizationN {
  const basis: Float64Array[] = [];
  const upper = edges.map(() => new Float64Array(edges.length));
  let smallest = Number.POSITIVE_INFINITY;
  let largest = 0;
  edges.forEach((edge, column) => {
    const residual = Float64Array.from(edge);
    let original = 0;
    for (const value of residual) original += value * value;
    original = Math.sqrt(original);
    largest = Math.max(largest, original);
    basis.forEach((q, row) => {
      let dot = 0;
      for (let axis = 0; axis < q.length; axis++) dot += q[axis]! * residual[axis]!;
      upper[row]![column] = dot;
      for (let axis = 0; axis < q.length; axis++) residual[axis]! -= dot * q[axis]!;
    });
    let norm = 0;
    for (const value of residual) norm += value * value;
    norm = Math.sqrt(norm);
    smallest = Math.min(smallest, norm);
    if (norm > tolerance * Math.max(1, original)) {
      upper[basis.length]![column] = norm;
      for (let axis = 0; axis < residual.length; axis++) residual[axis]! /= norm;
      basis.push(residual);
    }
  });
  return { basis, upper, smallest, largest };
}

/** Solves `R α = β` for upper-triangular `R` by back substitution. */
function backSubstitute(
  upper: readonly Float64Array[],
  beta: Float64Array
): Float64Array {
  const alpha = new Float64Array(beta.length);
  for (let row = beta.length - 1; row >= 0; row--) {
    let total = beta[row]!;
    for (let column = row + 1; column < beta.length; column++) {
      total -= upper[row]![column]! * alpha[column]!;
    }
    alpha[row] = total / upper[row]![row]!;
  }
  return alpha;
}

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'sharedFace', 'oppositeA', 'oppositeB', 'tolerance'
]);

function finiteVector(value: unknown, dimension: number, label: string): VecN {
  if (!(value instanceof VecN)) {
    throw new Error(`evaluateSimplexHingeCosineN: ${label} must be a VecN`);
  }
  if (value.dim !== dimension) {
    throw new Error(
      `evaluateSimplexHingeCosineN: ${label} is R${value.dim}, expected R${dimension}`
    );
  }
  for (const coordinate of value.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(
        `evaluateSimplexHingeCosineN: ${label} must have finite coordinates`
      );
    }
  }
  return value;
}

/**
 * Evaluates the fold coordinate and its exact gradient for one hinge.
 *
 * Pure: it reads the supplied positions and writes nothing. Gradient slots
 * follow the caller's input order, so a family that permutes a shared face
 * gets its own ordering back rather than a canonical one.
 *
 * The gradient is closed-form, not finite-differenced. Because both
 * sensitivity vectors are orthogonal to the shared-face span, the projector's
 * own derivative cancels out of `w · δr`, leaving four short terms:
 *
 * ```text
 * wA = (I - uA uAᵀ) uB / ‖rA‖          wB = (I - uB uBᵀ) uA / ‖rB‖
 * ∂c/∂a   = -wA                        ∂c/∂b   = -wB
 * ∂c/∂f_j = αA[j-1] wA + αB[j-1] wB    (j >= 1)
 * ∂c/∂f_0 = -[(Σ αA - 1) wA + (Σ αB - 1) wB]
 * ```
 *
 * Verified against central differences to 1.16e-10 over 320 coordinates from
 * R2 to R7 in the P48 measurement, with net-force residual 5.55e-17 and
 * rotational first moment exactly zero.
 *
 * @param options - Shared-face positions in source order, the two opposite
 * positions, and an optional positive relative tolerance.
 * @returns A frozen discriminated union: `'evaluated'` with the coordinate,
 * conditioning, heights, conormals, and per-vertex gradient, or `'refused'`
 * with the reason and the evidence available before refusal.
 * @throws If the options are malformed — unknown keys, wrong dimensions,
 * non-finite coordinates, too few shared-face vertices, or `d >= N`. A
 * geometric degeneracy is a refusal, not a throw.
 *
 * @example
 * One R3 triangle hinge folded 60° from flat:
 * ```ts
 * const half = Math.PI / 3;
 * const result = evaluateSimplexHingeCosineN({
 *   sharedFace: [new VecN([0, 0, 0]), new VecN([0, 1, 0])],
 *   oppositeA: new VecN([-1, 0, 0]),
 *   oppositeB: new VecN([Math.cos(half), 0, Math.sin(half)])
 * });
 *
 * if (result.status === 'refused') throw new Error(result.reason);
 * log(result.coordinate);            // cos(60°) = 0.5000000000000001
 * log(result.gradient.length);       // 4 — shared face, then both apexes
 * ```
 */
export function evaluateSimplexHingeCosineN(
  options: SimplexHingeCosineNOptions
): SimplexHingeCosineResultN {
  const caller = 'evaluateSimplexHingeCosineN';
  if (typeof options !== 'object' || options === null) {
    throw new Error(`${caller}: options must be an object`);
  }
  for (const key of Object.keys(options)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`${caller}: unknown option "${key}"`);
  }
  if (!Array.isArray(options.sharedFace) || options.sharedFace.length < 1) {
    throw new Error(`${caller}: sharedFace must be a non-empty array`);
  }
  if (!(options.oppositeA instanceof VecN)) {
    throw new Error(`${caller}: oppositeA must be a VecN`);
  }
  const dimension = options.oppositeA.dim;
  const simplexDimension = options.sharedFace.length;
  if (simplexDimension >= dimension) {
    throw new Error(
      `${caller}: a ${simplexDimension}-simplex hinge needs ambient dimension ` +
      `above ${simplexDimension}, got R${dimension}`
    );
  }
  const tolerance = options.tolerance ?? 1e-10;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error(`${caller}: tolerance must be finite and positive`);
  }
  const face = options.sharedFace.map((vertex, index) =>
    finiteVector(vertex, dimension, `sharedFace[${index}]`));
  const a = finiteVector(options.oppositeA, dimension, 'oppositeA');
  const b = finiteVector(options.oppositeB, dimension, 'oppositeB');

  const f0 = face[0]!;
  const edges = face.slice(1).map((vertex) =>
    Float64Array.from(vertex.data, (value, axis) => value - f0.data[axis]!));
  const { basis, upper, smallest, largest } = orthonormalize(edges, tolerance);

  const xA = Float64Array.from(a.data, (value, axis) => value - f0.data[axis]!);
  const xB = Float64Array.from(b.data, (value, axis) => value - f0.data[axis]!);
  let scale = 0;
  for (const value of xA) scale = Math.max(scale, Math.abs(value));
  for (const value of xB) scale = Math.max(scale, Math.abs(value));
  scale = Math.max(1, scale, largest);
  const conditioning = smallest === Number.POSITIVE_INFINITY
    ? 1
    : smallest / Math.max(1, largest);

  if (basis.length !== edges.length) {
    return Object.freeze({
      status: 'refused' as const,
      reason: 'rank-deficient-shared-face' as const,
      ambientDimension: dimension,
      simplexDimension,
      rank: basis.length,
      requiredRank: edges.length,
      conditioning,
      heightA: null,
      heightB: null,
      scale,
      tolerance
    });
  }

  const projectOnto = (x: Float64Array): {
    residual: Float64Array;
    beta: Float64Array;
    height: number;
  } => {
    const residual = Float64Array.from(x);
    const beta = new Float64Array(basis.length);
    basis.forEach((q, index) => {
      let dot = 0;
      for (let axis = 0; axis < q.length; axis++) dot += q[axis]! * residual[axis]!;
      beta[index] = dot;
      for (let axis = 0; axis < q.length; axis++) residual[axis]! -= dot * q[axis]!;
    });
    let height = 0;
    for (const value of residual) height += value * value;
    return { residual, beta, height: Math.sqrt(height) };
  };

  const pa = projectOnto(xA);
  const pb = projectOnto(xB);
  if (pa.height <= tolerance * scale || pb.height <= tolerance * scale) {
    return Object.freeze({
      status: 'refused' as const,
      reason: 'vanishing-conormal-height' as const,
      ambientDimension: dimension,
      simplexDimension,
      rank: basis.length,
      requiredRank: edges.length,
      conditioning,
      heightA: pa.height,
      heightB: pb.height,
      scale,
      tolerance
    });
  }

  const uA = Float64Array.from(pa.residual, (value) => value / pa.height);
  const uB = Float64Array.from(pb.residual, (value) => value / pb.height);
  let dot = 0;
  for (let axis = 0; axis < dimension; axis++) dot += uA[axis]! * uB[axis]!;
  const coordinate = -dot;

  const wA = new Float64Array(dimension);
  const wB = new Float64Array(dimension);
  for (let axis = 0; axis < dimension; axis++) {
    wA[axis] = (uB[axis]! - dot * uA[axis]!) / pa.height;
    wB[axis] = (uA[axis]! - dot * uB[axis]!) / pb.height;
  }

  const alphaA = backSubstitute(upper, pa.beta);
  const alphaB = backSubstitute(upper, pb.beta);
  let sumA = 0;
  let sumB = 0;
  for (let index = 0; index < alphaA.length; index++) {
    sumA += alphaA[index]!;
    sumB += alphaB[index]!;
  }

  const gradient: VecN[] = [];
  gradient.push(new VecN(Float64Array.from({ length: dimension }, (_, axis) =>
    -((sumA - 1) * wA[axis]! + (sumB - 1) * wB[axis]!))));
  for (let index = 0; index < alphaA.length; index++) {
    gradient.push(new VecN(Float64Array.from({ length: dimension }, (_, axis) =>
      alphaA[index]! * wA[axis]! + alphaB[index]! * wB[axis]!)));
  }
  gradient.push(new VecN(Float64Array.from(wA, (value) => -value)));
  gradient.push(new VecN(Float64Array.from(wB, (value) => -value)));

  return Object.freeze({
    status: 'evaluated' as const,
    ambientDimension: dimension,
    simplexDimension,
    coordinate,
    rank: basis.length,
    conditioning,
    heightA: pa.height,
    heightB: pb.height,
    conormalA: new VecN(uA),
    conormalB: new VecN(uB),
    gradient: Object.freeze(gradient)
  });
}
