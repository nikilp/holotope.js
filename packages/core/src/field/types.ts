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
  /** Whether the orbit left the escape radius rather than staying bounded. */
  readonly escaped: boolean;
  /** Iterations actually performed before escape or the iteration cap. */
  readonly iterations: number;
  /** Magnitude of the orbit at termination. */
  readonly magnitude: number;
  /** Smooth escape-time potential, continuous where the integer count is not. */
  readonly potential: number;
  /** Distance estimate to the set boundary, usable as a sphere-tracing bound. */
  readonly distance: number;
  /** Closest approach of the orbit to the trap shape, for interior colouring. */
  readonly orbitTrap: number;
  /** Orbit position at termination, in the field's own R4 coordinates. */
  readonly finalPoint: Vec4f64;
}

/**
 * A payload-valued function on R4. Approximate values are accompanied by
 * declared exact structure: symmetries, slice identities, and any distance
 * certificate on which a renderer may rely.
 */
export interface ImplicitField4<Record extends FieldEvaluation4 = FieldEvaluation4> {
  /** Stable identity, retained by anything that renders or samples the field. */
  readonly id: string;
  /** Declared exact symmetries, which a sampler may exploit rather than rediscover. */
  readonly symmetries: readonly FieldSymmetry4[];
  /** Declared facts about what particular 3-flats through the field contain. */
  readonly sliceTheorems: readonly FieldSliceTheorem4[];
  /**
   * Declared bound relating `distance` to true distance, when one holds.
   *
   * Sphere tracing is only sound with such a bound; its absence is why a
   * field may be sampled but not marched.
   */
  readonly distanceEstimator?: DistanceEstimatorDeclaration;
  /** Evaluates the field at one R4 point on the CPU, without side effects. */
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
