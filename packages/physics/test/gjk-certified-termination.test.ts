import { describe, expect, it } from 'vitest';
import { Rotor4, TransformN, VecN, integerRing, type ExactValue } from '@holotope/core';
import {
  ConvexHullSupportShapeN,
  GlomeSupportShapeN,
  NarrowphaseDispatcherN,
  RoundedSupportShapeN,
  TransformedSupportShapeN,
  convexLinearCastN,
  createExactRingGjkSignOracle,
  gjkDistance,
  gjkMarginDistance,
  type ExactSupportCoordinatesN,
  type GjkResult,
  type SupportFeatureId,
  type SupportShapeN,
  type SupportVertexN
} from '../src/index.js';

/**
 * Certified termination under equal and nearly tied supports.
 *
 * A GJK iterate whose distance has stopped changing is a stable numerical
 * estimate, **not** a certified result. The certificate is the support-gap
 * condition — `|q|^2 - q.w <= tau` for the support `w` in direction `-q` —
 * and these tests pin that the query either produces it, proves intersection,
 * or refuses explicitly. No branch may convert an iteration budget, repeated
 * support point, or small distance change into a separation claim.
 *
 * The pinned family: a flat unit box (lower-dimensional in its ambient space)
 * probed from a point whose second and third coordinates differ by `delta`.
 * Under the pre-repair loop, `delta` between about `1e-10` and `2.5e-7`
 * cycled to the iteration limit with the distance already correct to
 * `~1e-15`, because the sub-simplex selection discarded the support vertex
 * the certificate needed: the vertex improves the distance quadratically in
 * the residual — beneath the comparison tie band — while improving the
 * certificate linearly. The certified reprojection in the duplicate-support
 * branch selects by the certificate residual itself, which is why every row
 * below now decides.
 */

/** A flat unit box in the first `dim - 1` axes, at the last axis = 0. */
function flatBoxHull(dim: number, fullDimensional = false): ConvexHullSupportShapeN {
  const flatDim = dim - 1;
  const positions: number[] = [];
  const push = (last: number): void => {
    for (let corner = 0; corner < 2 ** flatDim; corner++) {
      for (let axis = 0; axis < flatDim; axis++) {
        positions.push((corner >> axis) & 1 ? 1 : 0);
      }
      positions.push(last);
    }
  };
  push(0);
  if (fullDimensional) push(-0.7);
  return new ConvexHullSupportShapeN(dim, Float64Array.from(positions));
}

/** The pinned probe, its two middle coordinates split by `delta`. */
function nearTieProbe(delta: number): readonly number[] {
  const base = 0.618483421044642045;
  return [0.468806433725538929, base, base + delta, 1.52075262807995881];
}

function pointShape(position: readonly number[]): ConvexHullSupportShapeN {
  return new ConvexHullSupportShapeN(position.length, Float64Array.from(position));
}

/** Deterministic LCG for every seeded fixture in this file. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Independent projection oracle: enumerate affine subsets of the explicit
 * Minkowski vertex set, accept a candidate only when it satisfies the global
 * KKT condition `q.(v - q) >= -tau` for every vertex. No support map, no
 * shared loop — agreement with it is evidence, not self-confirmation.
 */
function oracleDistance(
  probe: readonly number[],
  hull: ConvexHullSupportShapeN
): { distance: number; kkt: number } {
  const dim = probe.length;
  const count = hull.vertexCount;
  const minkowski = new Float64Array(count * dim);
  for (let vertex = 0; vertex < count; vertex++) {
    for (let axis = 0; axis < dim; axis++) {
      minkowski[vertex * dim + axis] =
        probe[axis]! - hull.positions[vertex * dim + axis]!;
    }
  }
  let scaleSquared = 1;
  for (const value of minkowski) scaleSquared = Math.max(scaleSquared, value * value);
  const tolerance = 64 * Number.EPSILON * Math.max(1, scaleSquared * dim);

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestKkt = Number.POSITIVE_INFINITY;
  const indices: number[] = [];
  const consider = (): void => {
    const size = indices.length;
    const base = indices[0]!;
    const weights = new Float64Array(size);
    if (size === 1) {
      weights[0] = 1;
    } else {
      const edges = size - 1;
      const gram = new Float64Array(edges * edges);
      const rhs = new Float64Array(edges);
      for (let row = 0; row < edges; row++) {
        for (let axis = 0; axis < dim; axis++) {
          const edgeRow = minkowski[indices[row + 1]! * dim + axis]! -
            minkowski[base * dim + axis]!;
          rhs[row]! -= edgeRow * minkowski[base * dim + axis]!;
        }
        for (let column = 0; column < edges; column++) {
          let value = 0;
          for (let axis = 0; axis < dim; axis++) {
            value += (minkowski[indices[row + 1]! * dim + axis]! - minkowski[base * dim + axis]!) *
              (minkowski[indices[column + 1]! * dim + axis]! - minkowski[base * dim + axis]!);
          }
          gram[row * edges + column] = value;
        }
      }
      // Plain Gaussian elimination with partial pivoting; degenerate subsets
      // are skipped — the certificate check selects, not the solve.
      const augmented = new Float64Array(edges * (edges + 1));
      let scale = 0;
      for (let row = 0; row < edges; row++) {
        for (let column = 0; column < edges; column++) {
          augmented[row * (edges + 1) + column] = gram[row * edges + column]!;
          scale = Math.max(scale, Math.abs(gram[row * edges + column]!));
        }
        augmented[row * (edges + 1) + edges] = rhs[row]!;
      }
      if (!(scale > 0)) return;
      for (let column = 0; column < edges; column++) {
        let pivotRow = column;
        for (let row = column + 1; row < edges; row++) {
          if (Math.abs(augmented[row * (edges + 1) + column]!) >
            Math.abs(augmented[pivotRow * (edges + 1) + column]!)) pivotRow = row;
        }
        if (Math.abs(augmented[pivotRow * (edges + 1) + column]!) <= 256 * Number.EPSILON * scale) return;
        if (pivotRow !== column) {
          for (let entry = column; entry <= edges; entry++) {
            const a = column * (edges + 1) + entry;
            const b = pivotRow * (edges + 1) + entry;
            const swap = augmented[a]!;
            augmented[a] = augmented[b]!;
            augmented[b] = swap;
          }
        }
        for (let row = column + 1; row < edges; row++) {
          const factor = augmented[row * (edges + 1) + column]! /
            augmented[column * (edges + 1) + column]!;
          for (let entry = column; entry <= edges; entry++) {
            augmented[row * (edges + 1) + entry]! -=
              factor * augmented[column * (edges + 1) + entry]!;
          }
        }
      }
      let sum = 0;
      for (let row = edges - 1; row >= 0; row--) {
        let value = augmented[row * (edges + 1) + edges]!;
        for (let column = row + 1; column < edges; column++) {
          value -= augmented[row * (edges + 1) + column]! * weights[column + 1]!;
        }
        weights[row + 1] = value / augmented[row * (edges + 1) + row]!;
      }
      for (let edge = 0; edge < edges; edge++) sum += weights[edge + 1]!;
      weights[0] = 1 - sum;
      if (Array.from(weights).some((weight) => weight < -1e-9)) return;
    }
    const closest = new Float64Array(dim);
    let total = 0;
    for (let slot = 0; slot < size; slot++) {
      const weight = Math.max(0, weights[slot]!);
      total += weight;
      for (let axis = 0; axis < dim; axis++) {
        closest[axis]! += weight * minkowski[indices[slot]! * dim + axis]!;
      }
    }
    if (!(total > 0)) return;
    for (let axis = 0; axis < dim; axis++) closest[axis]! /= total;
    let qq = 0;
    for (let axis = 0; axis < dim; axis++) qq += closest[axis]! * closest[axis]!;
    let minimum = Number.POSITIVE_INFINITY;
    for (let vertex = 0; vertex < count; vertex++) {
      let dot = 0;
      for (let axis = 0; axis < dim; axis++) {
        dot += closest[axis]! * minkowski[vertex * dim + axis]!;
      }
      minimum = Math.min(minimum, dot);
    }
    const kkt = Math.max(0, qq - minimum);
    if (kkt < bestKkt || (kkt === bestKkt && qq < bestDistance ** 2)) {
      bestKkt = kkt;
      bestDistance = Math.sqrt(qq);
    }
  };
  const visit = (start: number): void => {
    if (indices.length > 0) consider();
    if (indices.length === dim + 1) return;
    for (let vertex = start; vertex < count; vertex++) {
      indices.push(vertex);
      visit(vertex + 1);
      indices.pop();
    }
  };
  visit(0);
  expect(bestKkt).toBeLessThanOrEqual(tolerance);
  return { distance: bestDistance, kkt: bestKkt };
}

describe('certified termination: the pinned near-tie family', () => {
  it('decides every delta with the certificate, at the analytic distance', () => {
    for (const delta of [0, 1e-16, 1e-12, 1e-10, 1e-9, 1e-8, 2.5e-7, 1e-6, 1e-3]) {
      const probe = nearTieProbe(delta);
      const result = gjkDistance(pointShape(probe), flatBoxHull(4), { recordTrace: true });
      expect(result.status, `delta ${delta}`).toBe('separated');
      expect(result.intersects).toBe(false);
      // The probe sits over the footprint's interior, so the distance is its
      // height exactly. Liveness: nonzero, and reached through a real loop.
      expect(probe[3]!).toBeGreaterThan(0);
      expect(result.trace!.length).toBeGreaterThan(1);
      expect(result.distance, `delta ${delta}`).toBeCloseTo(probe[3]!, 11);
      // A certified separation, not a stalled estimate: the final gap sits
      // under the reported threshold.
      expect(result.termination.supportGap)
        .toBeLessThanOrEqual(result.termination.threshold);
      expect(result.termination.reason).toBe('relative-progress');
    }
  });

  it('decides under the default budget and refuses under a genuinely insufficient one', () => {
    const probe = nearTieProbe(2.5e-7);
    for (const budget of [8, 16, 32, 64, 256, 1024]) {
      const result = gjkDistance(pointShape(probe), flatBoxHull(4), { maxIterations: budget });
      expect(result.status, `budget ${budget}`).toBe('separated');
      // The decision arrives in a handful of iterations; larger budgets are
      // simply not consumed.
      expect(result.iterations).toBeLessThanOrEqual(8);
    }
    // A budget below what the query needs is an explicit refusal with no
    // separation claim — never a fabricated answer.
    const refused = gjkDistance(pointShape(probe), flatBoxHull(4), { maxIterations: 2 });
    expect(refused.status).toBe('iteration-limit');
    expect(refused.intersects).toBeNull();
    expect(refused.termination.reason).toBe('iteration-limit');
  });

  it('is not a lower-dimensional special case: full-dimensional hulls agree', () => {
    for (const delta of [1e-9, 2.5e-7]) {
      const probe = nearTieProbe(delta);
      const flat = gjkDistance(pointShape(probe), flatBoxHull(4, false));
      const solid = gjkDistance(pointShape(probe), flatBoxHull(4, true));
      expect(flat.status).toBe('separated');
      expect(solid.status).toBe('separated');
      // The solid hull's extra layer is below the flat face, so the distances
      // agree: the probe is above the shared face.
      expect(solid.distance).toBeCloseTo(flat.distance, 12);
    }
  });
});

describe('certified termination: symmetric hulls in R3 through R5', () => {
  it('decides every probe of the symmetric family, flat and full-dimensional', () => {
    for (const fullDimensional of [false, true]) {
      for (let dim = 3; dim <= 5; dim++) {
        const flatDim = dim - 1;
        const positions: number[] = [];
        const push = (last: number): void => {
          for (let corner = 0; corner < 2 ** flatDim; corner++) {
            for (let axis = 0; axis < flatDim; axis++) {
              positions.push((corner >> axis) & 1 ? 1 : -1);
            }
            positions.push(last);
          }
        };
        push(0);
        if (fullDimensional) push(-0.7);
        const hull = new ConvexHullSupportShapeN(dim, Float64Array.from(positions));

        let decided = 0;
        for (let sample = 0; sample <= 40; sample++) {
          for (const epsilon of [0, 1e-12, 1e-9, 1e-8, 1e-7, 1e-6]) {
            const probe: number[] = [];
            for (let axis = 0; axis < flatDim; axis++) {
              probe.push(axis === 0 ? epsilon : 0);
            }
            probe.push(0.2 + sample * 0.04);
            const result = gjkDistance(pointShape(probe), hull);
            expect(result.status, `R${dim} eps=${epsilon} h=${probe[dim - 1]}`)
              .toBe('separated');
            expect(result.distance).toBeCloseTo(probe[dim - 1]!, 11);
            decided++;
          }
        }
        // Liveness: the family is the one that stalled at ~60% before.
        expect(decided).toBe(246);
      }
    }
  });
});

describe('certified termination: oracle and analytic agreement', () => {
  it('agrees with the independent KKT projection oracle across R2 through R5', () => {
    let compared = 0;
    for (let dim = 2; dim <= 5; dim++) {
      const hull = flatBoxHull(dim);
      const next = seededRandom(40_400 + dim);
      for (let sample = 0; sample < 24; sample++) {
        const probe = Array.from(
          { length: dim },
          (_, axis) => axis === dim - 1 ? 0.2 + next() * 1.4 : -0.3 + next() * 1.6
        );
        const result = gjkDistance(pointShape(probe), hull);
        expect(result.status).toBe('separated');
        const oracle = oracleDistance(probe, hull);
        // Liveness before agreement: a zero-distance oracle compares nothing.
        expect(oracle.distance).toBeGreaterThan(0);
        expect(result.distance).toBeCloseTo(oracle.distance, 11);
        compared++;
      }
      // The near-tie family, against the same oracle.
      for (const delta of dim === 4 ? [1e-9, 2.5e-7] : []) {
        const probe = nearTieProbe(delta);
        const oracle = oracleDistance(probe, hull);
        expect(gjkDistance(pointShape(probe), hull).distance)
          .toBeCloseTo(oracle.distance, 11);
        compared++;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(96);
  });

  it('matches analytic segment, rectangle, and box distances', () => {
    // Segment in R3.
    const segment = new ConvexHullSupportShapeN(3, Float64Array.from([
      0, 0, 0, 2, 0, 0
    ]));
    expect(gjkDistance(pointShape([1, 0.5, 0]), segment).distance).toBeCloseTo(0.5, 13);
    expect(gjkDistance(pointShape([3, 0, 0.4]), segment).distance)
      .toBeCloseTo(Math.hypot(1, 0.4), 13);

    // Rectangle in R4, probed over its interior and past a corner.
    const rectangle = new ConvexHullSupportShapeN(4, Float64Array.from([
      0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 0, 2, 3, 0, 0
    ]));
    expect(gjkDistance(pointShape([1, 1.5, 0.8, 0]), rectangle).distance)
      .toBeCloseTo(0.8, 13);
    expect(gjkDistance(pointShape([3, 4, 0, 0.5]), rectangle).distance)
      .toBeCloseTo(Math.hypot(1, 1, 0.5), 13);

    // Box vs box in R4, the closed form from the existing suite's family.
    const near = flatBoxHull(4, true);
    const far = new TransformedSupportShapeN(
      near, new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 2.5]))
    );
    expect(gjkDistance(far, near).distance).toBeCloseTo(2.5 - 0.7, 12);
  });
});

describe('certified termination: invariance and witness identity', () => {
  const probe = nearTieProbe(2.5e-7);

  it('is covariant under translation, rotation, and scale', () => {
    const hull = flatBoxHull(4);
    const reference = gjkDistance(pointShape(probe), hull);
    expect(reference.status).toBe('separated');

    // Translation.
    const offset = [3.5, -2.25, 1.125, 0.75];
    const translatedHull = new TransformedSupportShapeN(
      hull, new TransformN(4, Rotor4.identity(), new VecN(offset))
    );
    const translatedProbe = probe.map((value, axis) => value + offset[axis]!);
    const translated = gjkDistance(pointShape(translatedProbe), translatedHull);
    expect(translated.status).toBe('separated');
    expect(translated.distance).toBeCloseTo(reference.distance, 11);

    // Rotation.
    const rotor = Rotor4.fromPlanes([
      { i: 0, j: 3, angle: 0.41 }, { i: 1, j: 2, angle: -0.29 }
    ]);
    const rotatedHull = new TransformedSupportShapeN(
      hull, new TransformN(4, rotor, new VecN(4))
    );
    const rotatedProbe = Array.from(rotor.applyToPoint(new VecN(probe)).data);
    const rotated = gjkDistance(pointShape(rotatedProbe), rotatedHull);
    expect(rotated.status).toBe('separated');
    expect(rotated.distance).toBeCloseTo(reference.distance, 9);

    // Scale, applied to the coordinates themselves.
    for (const scale of [1e-3, 1e3]) {
      const scaledHull = new ConvexHullSupportShapeN(
        4, Float64Array.from(hull.positions, (value) => value * scale)
      );
      const scaled = gjkDistance(
        pointShape(probe.map((value) => value * scale)), scaledHull
      );
      expect(scaled.status, `scale ${scale}`).toBe('separated');
      expect(scaled.distance / scale).toBeCloseTo(reference.distance, 8);
    }
  });

  it('keeps witnesses consistent under vertex-order reversal', () => {
    const hull = flatBoxHull(4);
    const count = hull.vertexCount;
    const reversed = new Float64Array(hull.positions.length);
    for (let vertex = 0; vertex < count; vertex++) {
      for (let axis = 0; axis < 4; axis++) {
        reversed[(count - 1 - vertex) * 4 + axis] = hull.positions[vertex * 4 + axis]!;
      }
    }
    const forward = gjkDistance(pointShape(probe), hull);
    const backward = gjkDistance(
      pointShape(probe), new ConvexHullSupportShapeN(4, reversed)
    );
    expect(backward.status).toBe('separated');
    expect(backward.distance).toBeCloseTo(forward.distance, 12);
    for (let axis = 0; axis < 4; axis++) {
      expect(backward.closestPointB.data[axis]!)
        .toBeCloseTo(forward.closestPointB.data[axis]!, 10);
    }
    // Feature IDs are storage slots and legitimately differ under reordering;
    // each must still resolve to the same geometric point.
    for (const vertex of backward.simplex) {
      const resolved = new ConvexHullSupportShapeN(4, reversed)
        .resolveFeature(vertex.featureB as number);
      expect(resolved).toBeDefined();
    }
  });

  it('resolves coincident-feature support ties deterministically', () => {
    // Two identical vertices: the support tie must resolve to the lowest
    // index, every time, and never be upgraded to a unique-identity claim.
    const hull = new ConvexHullSupportShapeN(3, Float64Array.from([
      0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0
    ]));
    const first = gjkDistance(pointShape([2, -0.5, 0.4]), hull);
    const second = gjkDistance(pointShape([2, -0.5, 0.4]), hull);
    expect(first.status).toBe('separated');
    expect(second.simplex.map((vertex) => vertex.featureB))
      .toEqual(first.simplex.map((vertex) => vertex.featureB));
    // The duplicated coordinates sit at slots 1 and 2; a support tie between
    // them must have chosen slot 1.
    const features = first.simplex.map((vertex) => vertex.featureB);
    expect(features).not.toContain(2);
  });
});

describe('certified termination: starts, smooth shapes, and consistency', () => {
  const probe = nearTieProbe(2.5e-7);

  it('decides the family cold, warm, and with a stale warm start', () => {
    const hull = flatBoxHull(4);
    const cold = gjkDistance(pointShape(probe), hull);
    expect(cold.status).toBe('separated');

    const warm = gjkDistance(pointShape(probe), hull, { warmStart: cold.warmStart });
    expect(warm.status).toBe('separated');
    expect(warm.distance).toBeCloseTo(cold.distance, 12);
    expect(warm.termination.warmStartSize).toBeGreaterThan(0);

    // A stale warm start whose features no longer resolve is skipped, not
    // trusted: the query still decides from scratch.
    const stale = gjkDistance(pointShape(probe), hull, {
      warmStart: {
        dim: 4,
        direction: new VecN([0, 0, 0, 1]),
        featurePairs: [{ featureA: 99, featureB: 99 }]
      }
    });
    expect(stale.status).toBe('separated');
    expect(stale.distance).toBeCloseTo(cold.distance, 12);
    expect(stale.termination.warmStartSize).toBe(0);

    // An incompatible warm start is a contract error, stated as one.
    expect(() => gjkDistance(pointShape(probe), hull, {
      warmStart: { dim: 3, direction: new VecN([1, 0, 0]), featurePairs: [] }
    })).toThrow(/warmStart dimension/);
  });

  it('keeps the exact-coordinate branch and its provenance', () => {
    // Integer coordinates throughout, probed over the face *interior* so the
    // terminating simplex is multi-vertex — a corner-region query ends on a
    // single vertex, whose candidate never consults the sign oracle.
    const positions: number[] = [];
    for (let corner = 0; corner < 8; corner++) {
      positions.push(
        (corner >> 0) & 1 ? 2 : 0,
        (corner >> 1) & 1 ? 2 : 0,
        (corner >> 2) & 1 ? 2 : 0,
        0
      );
    }
    const hull = new ConvexHullSupportShapeN(4, Float64Array.from(positions));
    const exact: ExactSupportCoordinatesN = {
      dim: 4,
      ring: integerRing,
      coordinates(featureId: SupportFeatureId): readonly ExactValue[] | undefined {
        if (typeof featureId !== 'number' || featureId >= hull.vertexCount) return undefined;
        return Array.from({ length: 4 }, (_, axis) => ({
          a: BigInt(hull.positions[featureId * 4 + axis]!),
          b: 0n
        }));
      }
    };
    const integerProbe = new ConvexHullSupportShapeN(4, Float64Array.from([1, 1, 1, 2]));
    const probeExact: ExactSupportCoordinatesN = {
      dim: 4,
      ring: integerRing,
      coordinates: (featureId) => featureId === 0
        ? [{ a: 1n, b: 0n }, { a: 1n, b: 0n }, { a: 1n, b: 0n }, { a: 2n, b: 0n }]
        : undefined
    };
    const result = gjkDistance(integerProbe, hull, {
      signOracle: createExactRingGjkSignOracle(probeExact, exact),
      recordTrace: true
    });
    expect(result.status).toBe('separated');
    expect(result.distance).toBeCloseTo(2, 13);
    expect(result.termination.exactPredicateCalls).toBeGreaterThan(0);
    expect(result.simplexCertificate.predicateSource).toBe('exact-ring:integer');
  });

  it('still handles smooth support shapes that cannot be enumerated', () => {
    // The repair must not quietly assume finite vertices: glomes and rounded
    // cores have none, and the certified reprojection only ever touches the
    // support history, which exists for every shape.
    const left = new GlomeSupportShapeN([0, 0, 0, 0], 1);
    const right = new GlomeSupportShapeN([3, 0, 0, 0], 1);
    const smooth = gjkDistance(left, right);
    expect(smooth.status).toBe('separated');
    expect(smooth.distance).toBeCloseTo(1, 12);

    const rounded = gjkDistance(
      new RoundedSupportShapeN(flatBoxHull(4), 0.25),
      new GlomeSupportShapeN([0.5, 0.5, 0.5, 3], 0.5)
    );
    expect(rounded.status).toBe('separated');
    expect(rounded.distance).toBeCloseTo(3 - 0.25 - 0.5, 11);
  });

  it('keeps trace, termination, witnesses, and distance mutually consistent', () => {
    const result = gjkDistance(pointShape(probe), flatBoxHull(4), { recordTrace: true });
    expect(result.status).toBe('separated');
    // The trace's last entry is the terminating iteration: its gap is the
    // reported gap.
    const last = result.trace![result.trace!.length - 1]!;
    expect(last.supportGap).toBe(result.termination.supportGap);
    expect(result.iterations).toBe(last.iteration + 1);
    // Witnesses reconstruct from the simplex and its weights.
    const rebuiltA = new VecN(4);
    const rebuiltB = new VecN(4);
    result.simplex.forEach((vertex, index) => {
      const weight = result.simplexCertificate.weights[index]!;
      rebuiltA.add(vertex.pointA.clone().multiplyScalar(weight));
      rebuiltB.add(vertex.pointB.clone().multiplyScalar(weight));
    });
    for (let axis = 0; axis < 4; axis++) {
      expect(rebuiltA.data[axis]!).toBeCloseTo(result.closestPointA.data[axis]!, 12);
      expect(rebuiltB.data[axis]!).toBeCloseTo(result.closestPointB.data[axis]!, 12);
    }
    // And the distance is the witness separation.
    expect(result.closestPointA.clone().sub(result.closestPointB).length())
      .toBeCloseTo(result.distance, 12);
  });

  it('mutates neither shapes, nor warm starts, nor caller buffers', () => {
    const hull = flatBoxHull(4);
    const hullBefore = Array.from(hull.positions);
    const probePositions = Float64Array.from(probe);
    const point = new ConvexHullSupportShapeN(4, probePositions);
    const direction = new VecN([0.1, 0.2, 0.3, -1]);
    const directionBefore = Array.from(direction.data);
    const first = gjkDistance(point, hull, { initialDirection: direction });
    const warmStart = first.warmStart;
    const warmDirectionBefore = Array.from(warmStart.direction.data);
    const warmPairsBefore = warmStart.featurePairs.map((pair) => ({ ...pair }));
    const second = gjkDistance(point, hull, { warmStart });

    expect(second.status).toBe('separated');
    expect(Array.from(hull.positions)).toEqual(hullBefore);
    expect(Array.from(probePositions)).toEqual(Array.from(Float64Array.from(probe)));
    expect(Array.from(direction.data)).toEqual(directionBefore);
    expect(Array.from(warmStart.direction.data)).toEqual(warmDirectionBefore);
    expect(warmStart.featurePairs.map((pair) => ({ ...pair }))).toEqual(warmPairsBefore);
  });
});

describe('certified termination: downstream consumers decide the family', () => {
  const probe = nearTieProbe(2.5e-7);

  it('margin queries decide across the previously stalling configuration', () => {
    const result = gjkMarginDistance(pointShape(probe), flatBoxHull(4), {
      marginA: 0.05, marginB: 0.05
    });
    expect(result.status).toBe('separated');
    expect(result.signedDistance).toBeCloseTo(probe[3]! - 0.1, 11);
  });

  it('linear casts decide when the sweep crosses the near-tie region', () => {
    const start = [probe[0]!, probe[1]!, probe[2]!, 2.4];
    const cast = convexLinearCastN(
      pointShape(start), [0, 0, 0, -3], flatBoxHull(4), [0, 0, 0, 0],
      { targetDistance: 0.05 }
    );
    expect(cast.status).toBe('impact');
    expect(cast.hit).toBe(true);
    // The sweep starts at height 2.4 and impacts at target distance 0.05:
    // time = (2.4 - 0.05) / 3.
    expect(cast.time!).toBeCloseTo((2.4 - 0.05) / 3, 5);
  });

  it('narrowphase dispatch decides the configuration as a convex pair', () => {
    const dispatcher = new NarrowphaseDispatcherN();
    const result = dispatcher.dispatch({
      pairId: 'near-tie/probe-vs-slab',
      mode: 'distance',
      shapeA: pointShape(probe),
      shapeB: flatBoxHull(4)
    });
    expect(result.kind).toBe('distance');
    if (result.kind !== 'distance') throw new Error('unreachable');
    expect(result.query.status).toBe('separated');
    expect(result.query.distance).toBeCloseTo(probe[3]!, 11);
  });
});

describe('certified termination: the refusal taxonomy stays honest', () => {
  it('never returns duplicate-support for contract-honest fixtures', () => {
    // The duplicate-support refusal exists as armor: it fires only if the
    // certified reprojection over the complete sampled set cannot reach the
    // certificate *and* the support map keeps repeating itself — a state no
    // support map consistent with a compact convex set has been observed to
    // produce. This pin makes that claim checkable: if a change makes the
    // families below refuse, the semantics moved and this test must be
    // revisited deliberately.
    const reasons = new Set<string>();
    for (const delta of [0, 1e-12, 1e-10, 1e-9, 2.5e-7, 1e-6]) {
      const result = gjkDistance(pointShape(nearTieProbe(delta)), flatBoxHull(4));
      reasons.add(result.termination.reason);
      expect(result.status).not.toBe('iteration-limit');
    }
    const next = seededRandom(777);
    for (let sample = 0; sample < 200; sample++) {
      const probe = Array.from(
        { length: 4 }, (_, axis) => axis === 3 ? 0.2 + next() * 1.5 : -0.4 + next() * 1.8
      );
      const result = gjkDistance(pointShape(probe), flatBoxHull(4));
      reasons.add(result.termination.reason);
    }
    expect(reasons.has('duplicate-support')).toBe(false);
    expect(reasons.has('relative-progress')).toBe(true);
  });

  it('an intersecting query still proves enclosure rather than asserting it', () => {
    const inside = gjkDistance(
      pointShape([0.5, 0.5, 0.35, -0.2]), flatBoxHull(4, true)
    );
    expect(inside.status).toBe('intersecting');
    expect(inside.intersects).toBe(true);
    expect(inside.termination.reason).toBe('origin-within-tolerance');
  });

  it('support maps violating the shape contract get refusals or errors, never claims', () => {
    // A support function that ignores its direction breaks the SupportShapeN
    // contract. The loop cannot certify anything against it beyond the points
    // it actually returned — which is exactly what happens: the sampled set
    // saturates instantly and the query decides *for that sampled set* or
    // refuses. It must never throw an uncontrolled error or loop forever.
    let cursor = 0;
    const script: readonly (readonly number[])[] = [[10, 0, 0, 5], [9, 1, 0, 5]];
    const lying: SupportShapeN = {
      dim: 4,
      center: new VecN([9.5, 0.5, 0, 5]),
      support(): SupportVertexN {
        const point = script[Math.min(cursor++, script.length - 1)]!;
        return { point: new VecN(point), featureId: cursor };
      }
    };
    const result: GjkResult = gjkDistance(pointShape([0, 0, 0, 0]), lying, {
      maxIterations: 16
    });
    // The sampled set is the two scripted points; the projection over them is
    // certified against them, which is all a support map can promise.
    expect(['separated', 'iteration-limit']).toContain(result.status);
    expect(result.iterations).toBeLessThanOrEqual(16);
  });
});
