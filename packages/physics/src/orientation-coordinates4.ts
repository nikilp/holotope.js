import { BivectorN, MatN, Rotor4 } from '@holotope/core';

export type OrientationTrivialization4 = 'world-left' | 'body-right';

export interface BivectorPairCoordinates4 {
  readonly left: Float64Array;
  readonly right: Float64Array;
}

export interface OrientationBranchToken4 {
  readonly pairSign: 1 | -1;
  readonly guardAtSelection: number;
}

export interface RelativeOrientationOptions4 {
  readonly trivialization?: OrientationTrivialization4;
  readonly previousBranch?: OrientationBranchToken4;
  /** Guard on `|wL + wR|`; zero is the SO(4) logarithm cut locus. */
  readonly cutLocusTolerance?: number;
  /** Retain a previous pair lift while its signed `wL + wR` guard is above `-hysteresis`. */
  readonly branchHysteresis?: number;
}

export type RelativeOrientationCoordinates4 =
  | {
      readonly status: 'regular';
      readonly error: BivectorN;
      readonly branch: OrientationBranchToken4;
      readonly cutLocusGuard: number;
      readonly shortestPairSign: 1 | -1;
      readonly usesShortestLift: boolean;
    }
  | {
      readonly status: 'cut-locus';
      readonly branch: OrientationBranchToken4;
      readonly cutLocusGuard: number;
      readonly shortestPairSign: 1 | -1;
    };

/**
 * Split a lexicographic R4 bivector `(01,02,03,12,13,23)` into the exact
 * quaternion-log coordinates consumed by `Rotor4.fromBivector`.
 */
export function splitBivectorPair4(bivector: BivectorN): BivectorPairCoordinates4 {
  requireBivector4(bivector, 'splitBivectorPair4');
  const [b01, b02, b03, b12, b13, b23] = bivector.coeffs as unknown as [
    number, number, number, number, number, number
  ];
  return {
    left: Float64Array.of(
      0.5 * (b12 - b03),
      -0.5 * (b02 + b13),
      0.5 * (b01 - b23)
    ),
    right: Float64Array.of(
      -0.5 * (b12 + b03),
      0.5 * (b02 - b13),
      -0.5 * (b01 + b23)
    )
  };
}

/** Inverse of `splitBivectorPair4` in the shipped Rotor4 convention. */
export function combineBivectorPair4(pair: BivectorPairCoordinates4): BivectorN {
  const u = requireFactorVector(pair.left, 'combineBivectorPair4.left');
  const v = requireFactorVector(pair.right, 'combineBivectorPair4.right');
  return new BivectorN(4, [
    u[2]! - v[2]!,
    v[1]! - u[1]!,
    -(u[0]! + v[0]!),
    u[0]! - v[0]!,
    -(u[1]! + v[1]!),
    -(u[2]! + v[2]!)
  ]);
}

/**
 * Relative SO(4) logarithm with an explicit shortest-lift theorem, cut-locus
 * result, and optional pair-level hysteresis token.
 */
export function relativeOrientationCoordinates4(
  current: Rotor4,
  target: Rotor4,
  options: RelativeOrientationOptions4 = {}
): RelativeOrientationCoordinates4 {
  requireUnitRotor(current, 'relativeOrientationCoordinates4.current');
  requireUnitRotor(target, 'relativeOrientationCoordinates4.target');
  const trivialization = options.trivialization ?? 'world-left';
  requireTrivialization(trivialization);
  const tolerance = requireNonNegativeFinite(
    options.cutLocusTolerance ?? 1e-10,
    'relativeOrientationCoordinates4.cutLocusTolerance'
  );
  const hysteresis = requireNonNegativeFinite(
    options.branchHysteresis ?? 1e-6,
    'relativeOrientationCoordinates4.branchHysteresis'
  );

  const relative = trivialization === 'world-left'
    ? current.multiply(target.conjugate())
    : target.conjugate().multiply(current);
  const rawGuard = relative.left[3]! + relative.right[3]!;
  const shortestPairSign: 1 | -1 = rawGuard < 0 ? -1 : 1;
  let pairSign = shortestPairSign;
  if (options.previousBranch !== undefined) {
    requireBranchToken(options.previousBranch);
    const previousGuard = options.previousBranch.pairSign * rawGuard;
    if (previousGuard >= -hysteresis) pairSign = options.previousBranch.pairSign;
  }

  const cutLocusGuard = Math.abs(rawGuard);
  const branch = (): OrientationBranchToken4 => Object.freeze({
    pairSign,
    guardAtSelection: pairSign * rawGuard
  });
  if (cutLocusGuard <= tolerance) {
    return {
      status: 'cut-locus',
      branch: branch(),
      cutLocusGuard,
      shortestPairSign
    };
  }

  // A retained longer lift can reach a quaternion antipode even away from
  // the SO(4) cut locus. It cannot be logged continuously there; fall back to
  // the regular shortest lift and expose that decision through the token.
  let left = quaternionLogVector(relative.left, pairSign);
  let right = quaternionLogVector(relative.right, pairSign);
  if ((left === undefined || right === undefined) && pairSign !== shortestPairSign) {
    pairSign = shortestPairSign;
    left = quaternionLogVector(relative.left, pairSign);
    right = quaternionLogVector(relative.right, pairSign);
  }
  if (left === undefined || right === undefined) {
    throw new Error('relativeOrientationCoordinates4: selected lift reached a quaternion antipode');
  }

  return {
    status: 'regular',
    error: combineBivectorPair4({ left, right }),
    branch: branch(),
    cutLocusGuard,
    shortestPairSign,
    usesShortestLift: pairSign === shortestPairSign
  };
}

/**
 * Differential of the SO(4) exponential in lexicographic bivector
 * coordinates. Factor blocks use the quaternion-log scale of Rotor4.
 */
export function orientationDexp4(
  error: BivectorN,
  trivialization: OrientationTrivialization4 = 'world-left'
): MatN {
  requireBivector4(error, 'orientationDexp4');
  requireTrivialization(trivialization);
  return assemblePairJacobian(
    error,
    trivialization === 'world-left' ? 1 : -1,
    trivialization === 'world-left' ? -1 : 1,
    false
  );
}

/** Analytic inverse of `orientationDexp4` on the regular chart. */
export function orientationDlog4(
  error: BivectorN,
  trivialization: OrientationTrivialization4 = 'world-left'
): MatN {
  requireBivector4(error, 'orientationDlog4');
  requireTrivialization(trivialization);
  return assemblePairJacobian(
    error,
    trivialization === 'world-left' ? 1 : -1,
    trivialization === 'world-left' ? -1 : 1,
    true
  );
}

/** Tight Euclidean operator norm of the 4x4 skew angular-velocity map. */
export function angularVelocityOperatorNorm4(omega: BivectorN): number {
  const pair = splitBivectorPair4(omega);
  return Math.hypot(...pair.left) + Math.hypot(...pair.right);
}

function assemblePairJacobian(
  error: BivectorN,
  leftSign: 1 | -1,
  rightSign: 1 | -1,
  inverse: boolean
): MatN {
  const pair = splitBivectorPair4(error);
  const left = factorJacobian(pair.left, leftSign, inverse);
  const right = factorJacobian(pair.right, rightSign, inverse);
  const result = new MatN(6);
  for (let column = 0; column < 6; column++) {
    const basis = new BivectorN(4);
    basis.coeffs[column] = 1;
    const split = splitBivectorPair4(basis);
    const transformed = combineBivectorPair4({
      left: applyMatrix3(left, split.left),
      right: applyMatrix3(right, split.right)
    });
    for (let row = 0; row < 6; row++) {
      result.data[row * 6 + column] = transformed.coeffs[row]!;
    }
  }
  return result;
}

function factorJacobian(
  vector: Float64Array,
  crossSign: 1 | -1,
  inverse: boolean
): Float64Array {
  const r = Math.hypot(vector[0]!, vector[1]!, vector[2]!);
  if (inverse && r >= Math.PI - 1e-8) {
    throw new Error('orientationDlog4: factor logarithm is outside the regular chart');
  }
  let first: number;
  let second: number;
  if (r < 1e-5) {
    const r2 = r * r;
    const r4 = r2 * r2;
    if (inverse) {
      first = -crossSign;
      second = 1 / 3 + r2 / 45 + (2 * r4) / 945;
    } else {
      first = crossSign * (1 - r2 / 3 + (2 * r4) / 45);
      second = 2 / 3 - (2 * r2) / 15 + (4 * r4) / 315;
    }
  } else if (inverse) {
    first = -crossSign;
    second = (1 - (r * Math.cos(r)) / Math.sin(r)) / (r * r);
  } else {
    const sine = Math.sin(r);
    first = crossSign * (sine * sine) / (r * r);
    second = (r - sine * Math.cos(r)) / (r * r * r);
  }

  const cross = crossMatrix3(vector);
  const crossSquared = multiplyMatrix3(cross, cross);
  const out = identityMatrix3();
  for (let index = 0; index < 9; index++) {
    out[index]! += first * cross[index]! + second * crossSquared[index]!;
  }
  return out;
}

function crossMatrix3(vector: Float64Array): Float64Array {
  const [x, y, z] = vector as unknown as [number, number, number];
  return Float64Array.of(0, -z, y, z, 0, -x, -y, x, 0);
}

function identityMatrix3(): Float64Array {
  return Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);
}

function multiplyMatrix3(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 3; k++) {
      for (let column = 0; column < 3; column++) {
        out[row * 3 + column]! += a[row * 3 + k]! * b[k * 3 + column]!;
      }
    }
  }
  return out;
}

function applyMatrix3(matrix: Float64Array, vector: Float64Array): Float64Array {
  return Float64Array.of(
    matrix[0]! * vector[0]! + matrix[1]! * vector[1]! + matrix[2]! * vector[2]!,
    matrix[3]! * vector[0]! + matrix[4]! * vector[1]! + matrix[5]! * vector[2]!,
    matrix[6]! * vector[0]! + matrix[7]! * vector[1]! + matrix[8]! * vector[2]!
  );
}

function quaternionLogVector(
  quaternion: Float64Array,
  pairSign: 1 | -1
): Float64Array | undefined {
  const x = pairSign * quaternion[0]!;
  const y = pairSign * quaternion[1]!;
  const z = pairSign * quaternion[2]!;
  const real = pairSign * quaternion[3]!;
  const vectorLength = Math.hypot(x, y, z);
  if (vectorLength < 1e-14) {
    return real < 0 ? undefined : new Float64Array(3);
  }
  const scale = Math.atan2(vectorLength, real) / vectorLength;
  return Float64Array.of(x * scale, y * scale, z * scale);
}

function requireBivector4(bivector: BivectorN, caller: string): void {
  if (bivector.n !== 4) throw new Error(`${caller}: expected a 4D bivector, got n=${bivector.n}`);
  for (const value of bivector.coeffs) {
    if (!Number.isFinite(value)) throw new Error(`${caller}: coefficients must be finite`);
  }
}

function requireFactorVector(vector: ArrayLike<number>, caller: string): ArrayLike<number> {
  if (vector.length !== 3) throw new Error(`${caller}: expected three factor coordinates`);
  for (let index = 0; index < 3; index++) {
    if (!Number.isFinite(vector[index]!)) throw new Error(`${caller}: coordinates must be finite`);
  }
  return vector;
}

function requireUnitRotor(rotor: Rotor4, caller: string): void {
  for (const [name, factor] of [['left', rotor.left], ['right', rotor.right]] as const) {
    const length = Math.hypot(factor[0]!, factor[1]!, factor[2]!, factor[3]!);
    if (!Number.isFinite(length) || Math.abs(length - 1) > 1e-10) {
      throw new Error(`${caller}: ${name} factor must be finite and normalized`);
    }
  }
}

function requireTrivialization(value: OrientationTrivialization4): void {
  if (value !== 'world-left' && value !== 'body-right') {
    throw new Error(`orientation coordinates: unknown trivialization ${String(value)}`);
  }
}

function requireBranchToken(token: OrientationBranchToken4): void {
  if (token.pairSign !== 1 && token.pairSign !== -1) {
    throw new Error('relativeOrientationCoordinates4.previousBranch: pairSign must be +1 or -1');
  }
  if (!Number.isFinite(token.guardAtSelection)) {
    throw new Error('relativeOrientationCoordinates4.previousBranch: guard must be finite');
  }
}

function requireNonNegativeFinite(value: number, caller: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${caller}: expected a finite non-negative value`);
  }
  return value;
}
