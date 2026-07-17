import { VecN } from '@holotope/core';
import { HyperboxSupportShape4 } from './hyperbox4.js';

export type HyperboxSatFeatureClass4 =
  | 'facet-a'
  | 'facet-b'
  | 'edge-a-face-b'
  | 'face-a-edge-b';

export interface HyperboxSatAxisSource4 {
  readonly featureClass: HyperboxSatFeatureClass4;
  /** Local coordinate-axis indices spanning A's contributing feature. */
  readonly axesA: readonly number[];
  /** Local coordinate-axis indices spanning B's contributing feature. */
  readonly axesB: readonly number[];
}

export interface HyperboxSatOptions4 {
  /** Zero band for a dual 3-wedge before normalization. Default 1e-12. */
  axisEpsilon?: number;
  /** Absolute parallel-direction band used after normalization. Default 1e-14. */
  duplicateEpsilon?: number;
  /** Separation/contact band in world units. Default 1e-12. */
  contactTolerance?: number;
}

export interface HyperboxSatDiagnostics4 {
  /** Always 56: 8 facet normals plus 24+24 cross-family constructions. */
  readonly axesGenerated: number;
  readonly axesTested: number;
  readonly degenerateAxesSkipped: number;
  readonly duplicateAxesSkipped: number;
}

export interface HyperboxSatResult4 {
  readonly status: 'separated' | 'touching' | 'overlapping';
  readonly intersects: boolean;
  /** Winning normalized axis, oriented from B toward A / A's escape direction. */
  readonly axis: VecN;
  readonly source: HyperboxSatAxisSource4;
  /** Positive projected gap on the winning separating axis, else zero. */
  readonly separation: number;
  /** Minimum translation of A along `axis` for overlap, else zero. */
  readonly penetrationDepth: number;
  /** Positive for separation, negative for overlap, zero for touching. */
  readonly signedAxisDistance: number;
  readonly intervalA: readonly [number, number];
  readonly intervalB: readonly [number, number];
  readonly diagnostics: HyperboxSatDiagnostics4;
}

interface AxisCandidate {
  axis: VecN;
  source: HyperboxSatAxisSource4;
}

interface AxisEvaluation {
  candidate: AxisCandidate;
  orientedAxis: VecN;
  separation: number;
  penetrationDepth: number;
}

const FACE_PAIRS: readonly (readonly [number, number])[] = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]
];

/**
 * Complete separating-axis test for two full-dimensional oriented boxes in R4.
 * It constructs all 56 feature-family axes before removing zero/parallel copies.
 */
export function hyperboxSat4(
  boxA: HyperboxSupportShape4,
  boxB: HyperboxSupportShape4,
  options: HyperboxSatOptions4 = {}
): HyperboxSatResult4 {
  const axisEpsilon = resolvedTolerance(options.axisEpsilon, 1e-12, 'axisEpsilon');
  const duplicateEpsilon = resolvedTolerance(
    options.duplicateEpsilon,
    1e-14,
    'duplicateEpsilon'
  );
  if (duplicateEpsilon >= 1) {
    throw new Error('hyperboxSat4: duplicateEpsilon must be less than 1');
  }
  const contactTolerance = resolvedTolerance(
    options.contactTolerance,
    1e-12,
    'contactTolerance'
  );
  const axesA = boxA.worldAxes();
  const axesB = boxB.worldAxes();
  const constructed: AxisCandidate[] = [];

  for (let axis = 0; axis < 4; axis++) {
    constructed.push({
      axis: axesA[axis]!.clone(),
      source: { featureClass: 'facet-a', axesA: [axis], axesB: [] }
    });
  }
  for (let axis = 0; axis < 4; axis++) {
    constructed.push({
      axis: axesB[axis]!.clone(),
      source: { featureClass: 'facet-b', axesA: [], axesB: [axis] }
    });
  }
  for (let edgeA = 0; edgeA < 4; edgeA++) {
    for (const faceB of FACE_PAIRS) {
      constructed.push({
        axis: dualWedge3In4(axesA[edgeA]!, axesB[faceB[0]]!, axesB[faceB[1]]!),
        source: {
          featureClass: 'edge-a-face-b',
          axesA: [edgeA],
          axesB: [faceB[0], faceB[1]]
        }
      });
    }
  }
  for (const faceA of FACE_PAIRS) {
    for (let edgeB = 0; edgeB < 4; edgeB++) {
      constructed.push({
        axis: dualWedge3In4(axesA[faceA[0]]!, axesA[faceA[1]]!, axesB[edgeB]!),
        source: {
          featureClass: 'face-a-edge-b',
          axesA: [faceA[0], faceA[1]],
          axesB: [edgeB]
        }
      });
    }
  }

  const unique: AxisCandidate[] = [];
  let degenerateAxesSkipped = 0;
  let duplicateAxesSkipped = 0;
  for (const candidate of constructed) {
    const length = candidate.axis.length();
    if (!(length > axisEpsilon)) {
      degenerateAxesSkipped++;
      continue;
    }
    candidate.axis.multiplyScalar(1 / length);
    canonicalizeAxis(candidate.axis, axisEpsilon);
    if (
      unique.some(
        (accepted) => 1 - Math.abs(accepted.axis.dot(candidate.axis)) <= duplicateEpsilon
      )
    ) {
      duplicateAxesSkipped++;
      continue;
    }
    unique.push(candidate);
  }

  let bestSeparation: AxisEvaluation | undefined;
  let bestOverlap: AxisEvaluation | undefined;
  for (const candidate of unique) {
    const evaluation = evaluateAxis(boxA, axesA, boxB, axesB, candidate);
    if (evaluation.separation > contactTolerance) {
      if (
        !bestSeparation ||
        evaluation.separation > bestSeparation.separation + numericalTie(
          evaluation.separation,
          bestSeparation.separation
        )
      ) {
        bestSeparation = evaluation;
      }
    } else if (
      !bestOverlap ||
      evaluation.penetrationDepth < bestOverlap.penetrationDepth - numericalTie(
        evaluation.penetrationDepth,
        bestOverlap.penetrationDepth
      )
    ) {
      bestOverlap = evaluation;
    }
  }

  const diagnostics: HyperboxSatDiagnostics4 = {
    axesGenerated: constructed.length,
    axesTested: unique.length,
    degenerateAxesSkipped,
    duplicateAxesSkipped
  };
  const winner = bestSeparation ?? bestOverlap;
  if (!winner) throw new Error('hyperboxSat4: no nondegenerate candidate axes');
  const intervalA = projectionInterval(boxA, axesA, winner.orientedAxis);
  const intervalB = projectionInterval(boxB, axesB, winner.orientedAxis);
  if (bestSeparation) {
    return {
      status: 'separated',
      intersects: false,
      axis: winner.orientedAxis,
      source: winner.candidate.source,
      separation: winner.separation,
      penetrationDepth: 0,
      signedAxisDistance: winner.separation,
      intervalA,
      intervalB,
      diagnostics
    };
  }
  const depth = Math.max(0, winner.penetrationDepth);
  const status = depth <= contactTolerance ? 'touching' : 'overlapping';
  return {
    status,
    intersects: true,
    axis: winner.orientedAxis,
    source: winner.candidate.source,
    separation: 0,
    penetrationDepth: depth,
    signedAxisDistance: status === 'touching' ? 0 : -depth,
    intervalA,
    intervalB,
    diagnostics
  };
}

/** Hodge dual of `u ∧ v ∧ w` in oriented R4. Its sign is immaterial to SAT. */
function dualWedge3In4(u: VecN, v: VecN, w: VecN): VecN {
  const result = new VecN(4);
  for (let omitted = 0; omitted < 4; omitted++) {
    const rows: number[] = [];
    for (let row = 0; row < 4; row++) if (row !== omitted) rows.push(row);
    const determinant = determinant3(
      u.data[rows[0]!]!, v.data[rows[0]!]!, w.data[rows[0]!]!,
      u.data[rows[1]!]!, v.data[rows[1]!]!, w.data[rows[1]!]!,
      u.data[rows[2]!]!, v.data[rows[2]!]!, w.data[rows[2]!]!
    );
    result.data[omitted] = (omitted & 1) === 0 ? determinant : -determinant;
  }
  return result;
}

function determinant3(
  a00: number, a01: number, a02: number,
  a10: number, a11: number, a12: number,
  a20: number, a21: number, a22: number
): number {
  return a00 * (a11 * a22 - a12 * a21)
    - a01 * (a10 * a22 - a12 * a20)
    + a02 * (a10 * a21 - a11 * a20);
}

function canonicalizeAxis(axis: VecN, epsilon: number): void {
  for (const coordinate of axis.data) {
    if (Math.abs(coordinate) <= epsilon) continue;
    if (coordinate < 0) axis.multiplyScalar(-1);
    return;
  }
}

function evaluateAxis(
  boxA: HyperboxSupportShape4,
  axesA: readonly VecN[],
  boxB: HyperboxSupportShape4,
  axesB: readonly VecN[],
  candidate: AxisCandidate
): AxisEvaluation {
  const intervalA = projectionInterval(boxA, axesA, candidate.axis);
  const intervalB = projectionInterval(boxB, axesB, candidate.axis);
  if (intervalA[0] > intervalB[1]) {
    return {
      candidate,
      orientedAxis: candidate.axis.clone(),
      separation: intervalA[0] - intervalB[1],
      penetrationDepth: 0
    };
  }
  if (intervalB[0] > intervalA[1]) {
    return {
      candidate,
      orientedAxis: candidate.axis.clone().multiplyScalar(-1),
      separation: intervalB[0] - intervalA[1],
      penetrationDepth: 0
    };
  }
  const escapeNegative = intervalA[1] - intervalB[0];
  const escapePositive = intervalB[1] - intervalA[0];
  return escapeNegative <= escapePositive
    ? {
        candidate,
        orientedAxis: candidate.axis.clone().multiplyScalar(-1),
        separation: 0,
        penetrationDepth: escapeNegative
      }
    : {
        candidate,
        orientedAxis: candidate.axis.clone(),
        separation: 0,
        penetrationDepth: escapePositive
      };
}

function projectionInterval(
  box: HyperboxSupportShape4,
  axes: readonly VecN[],
  direction: VecN
): readonly [number, number] {
  const center = box.center.dot(direction);
  let radius = 0;
  for (let axis = 0; axis < 4; axis++) {
    radius += box.halfExtents[axis]! * Math.abs(axes[axis]!.dot(direction));
  }
  return [center - radius, center + radius];
}

function resolvedTolerance(
  supplied: number | undefined,
  fallback: number,
  name: string
): number {
  const value = supplied ?? fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`hyperboxSat4: ${name} must be finite and non-negative`);
  }
  return value;
}

function numericalTie(left: number, right: number): number {
  return 64 * Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
}
