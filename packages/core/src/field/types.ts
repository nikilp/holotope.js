/** A four-dimensional point. Field coordinates are always packed in this order. */
export type Vec4f64 = readonly [number, number, number, number];

export type DistanceCertificate = 'provenNDA' | 'provenProduct' | 'heuristic';

export interface DistanceEstimatorDeclaration {
  readonly certificate: DistanceCertificate;
  readonly description: string;
  /** Conservative multiplier recommended for finite-precision sphere tracing. */
  readonly recommendedStepSafety: number;
}

export interface FieldSymmetry4 {
  readonly id: string;
  readonly description: string;
}

export interface FieldSliceTheorem4 {
  readonly id: string;
  readonly description: string;
}

/** Stable semantic payload returned for every field evaluation. */
export interface FieldEvaluation4 {
  /** Signed sampling value: negative inside, positive outside. */
  readonly value: number;
  readonly escaped: boolean;
  readonly iterations: number;
  readonly magnitude: number;
  readonly potential: number;
  readonly distance: number;
  readonly orbitTrap: number;
  readonly finalPoint: Vec4f64;
}

/**
 * A payload-valued function on R4. Approximate values are accompanied by
 * declared exact structure: symmetries, slice identities, and any distance
 * certificate on which a renderer may rely.
 */
export interface ImplicitField4<Record extends FieldEvaluation4 = FieldEvaluation4> {
  readonly id: string;
  readonly symmetries: readonly FieldSymmetry4[];
  readonly sliceTheorems: readonly FieldSliceTheorem4[];
  readonly distanceEstimator?: DistanceEstimatorDeclaration;
  evalCPU(point: ArrayLike<number>): Record;
}

export function readVec4(point: ArrayLike<number>, label: string): Vec4f64 {
  if (point.length !== 4) throw new Error(`${label}: expected a 4D point, got ${point.length}D`);
  const out: Vec4f64 = [point[0]!, point[1]!, point[2]!, point[3]!];
  if (out.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error(`${label}: point coordinates must be finite`);
  }
  return out;
}
