import { describe, expect, it } from 'vitest';
import { BivectorN, Rotor4, TransformN, VecN } from '@holotope/core';
import { HyperboxSupportShape4 } from '../src/hyperbox4.js';
import { hyperboxContactPatch4 } from '../src/hyperbox-contact4.js';
import { hyperboxSat4 } from '../src/hyperbox-sat4.js';
import { contactTangentBasis4 } from '../src/contact-kinematics4.js';

/**
 * Contact enumeration for two boxes whose faces are very nearly parallel.
 *
 * A demo consuming the released contact path met
 * `intersectContactHalfspaces4: failed to enumerate a bounded contact patch`
 * on an ordinary head-on collision. This file reproduces that state directly —
 * no simulation, no solver, no timestep — derives what the contact set must be
 * independently of the enumerator, and holds the enumerator to it.
 *
 * The demo's own account of the failure is treated here as evidence to check,
 * not as a specification. Everything asserted below is re-derived.
 */

// ---------------------------------------------------------------------------
// Rebuilding the captured pose exactly, from public API only
// ---------------------------------------------------------------------------

/**
 * Pure-quaternion logarithm: the `u` such that `expPure(u) === q`.
 *
 * `Rotor4` has no component-level constructor, and it should not grow one for
 * a test. It does expose `fromBivector`, which is `expPure` of the left/right
 * generators, so a captured rotor is rebuilt by taking each quaternion's log
 * and inverting the bivector-to-generator map. The round trip is asserted
 * rather than assumed — see `reproduces the captured rotors exactly`.
 */
function quaternionLog(q: readonly number[]): [number, number, number] {
  const [x, y, z, w] = q as [number, number, number, number];
  const vectorLength = Math.hypot(x, y, z);
  if (vectorLength === 0) return [0, 0, 0];
  const angle = Math.atan2(vectorLength, w);
  const scale = angle / vectorLength;
  return [x * scale, y * scale, z * scale];
}

/**
 * Rebuild a rotor from its left/right quaternions.
 *
 * `fromBivector` reads `[t01, t02, t03, t12, t13, t23]` and forms
 * `u = ((t12 − t03)/2, −(t02 + t13)/2, (t01 − t23)/2)` and
 * `v = (−(t12 + t03)/2, (t02 − t13)/2, −(t01 + t23)/2)`. Inverting that pair
 * of linear maps gives the six coefficients below.
 */
function rotorFromQuaternions(left: readonly number[], right: readonly number[]): Rotor4 {
  const [u1, u2, u3] = quaternionLog(left);
  const [v1, v2, v3] = quaternionLog(right);
  const bivector = new BivectorN(4);
  bivector.coeffs[0] = u3 - v3; // t01
  bivector.coeffs[1] = v2 - u2; // t02
  bivector.coeffs[2] = -(u1 + v1); // t03
  bivector.coeffs[3] = u1 - v1; // t12
  bivector.coeffs[4] = -(u2 + v2); // t13
  bivector.coeffs[5] = -(u3 + v3); // t23
  return Rotor4.fromBivector(bivector);
}

/**
 * The state entering the substep that threw, captured at substep granularity
 * from the consuming demo. Recorded verbatim; nothing here is rounded.
 */
const CAPTURED = {
  striker: {
    halfExtents: [0.4, 0.5, 0.6, 0.7] as const,
    position: [-0.44552779920046426, 0, 0, 0] as const,
    left: [
      -1.7430833769714435e-8, -1.1704618146132482e-8, -6.1733073095966e-8, 0.999999999999998
    ] as const,
    right: [
      -1.7430834030310573e-8, 1.1704617448148303e-8, 6.17330731583725e-8, 0.999999999999998
    ] as const
  },
  target: {
    halfExtents: [0.45, 0.55, 0.65, 0.75] as const,
    position: [0.40213889960022914, 0, 0, 0] as const,
    left: [
      7.4052562522278685e-9, 4.869120947830507e-9, 2.5059960383480715e-8, 0.9999999999999998
    ] as const,
    right: [
      7.405256211835048e-9, -4.869121059390302e-9, -2.505996037323098e-8, 0.9999999999999998
    ] as const
  }
} as const;

function capturedPair(): [HyperboxSupportShape4, HyperboxSupportShape4] {
  const a = new HyperboxSupportShape4(
    CAPTURED.striker.halfExtents,
    new TransformN(
      4,
      rotorFromQuaternions(CAPTURED.striker.left, CAPTURED.striker.right),
      new VecN([...CAPTURED.striker.position])
    )
  );
  const b = new HyperboxSupportShape4(
    CAPTURED.target.halfExtents,
    new TransformN(
      4,
      rotorFromQuaternions(CAPTURED.target.left, CAPTURED.target.right),
      new VecN([...CAPTURED.target.position])
    )
  );
  return [a, b];
}

/** How far outside the posed box `point` lies. Negative is strictly inside. */
function outsideBy(
  point: VecN,
  halfExtents: readonly number[],
  pose: TransformN
): number {
  const local = pose.inverse().applyToPoint(point.clone());
  let worst = -Infinity;
  for (let axis = 0; axis < 4; axis++) {
    worst = Math.max(worst, Math.abs(local.data[axis]!) - halfExtents[axis]!);
  }
  return worst;
}

describe('the captured pose, rebuilt without a simulation', () => {
  it('reproduces the captured rotors exactly', () => {
    // If the rebuild were approximate, every measurement below would be about a
    // nearby pose rather than the reported one.
    // Agreement is asserted in units of the last place, not in decimals: near
    // 1.0 an ULP is 2.2e-16, so a fixed decimal count either demands more than
    // Float64 can carry or accepts far less than the round trip achieves.
    const ulpsApart = (actual: number, expected: number): number =>
      Math.abs(actual - expected) / Math.max(Number.EPSILON * Math.abs(expected), 5e-324);
    for (const body of [CAPTURED.striker, CAPTURED.target]) {
      const rotor = rotorFromQuaternions(body.left, body.right);
      for (let k = 0; k < 4; k++) {
        expect(ulpsApart(rotor.left[k]!, body.left[k]!)).toBeLessThanOrEqual(1);
        expect(ulpsApart(rotor.right[k]!, body.right[k]!)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is a genuine overlap, not a grazing or separated pair', () => {
    const [a, b] = capturedPair();
    const sat = hyperboxSat4(a, b);
    expect(sat.status).toBe('overlapping');
    // The separating axis is essentially the line of centres, and the overlap
    // is a real depth rather than a tolerance artefact.
    expect(Math.abs(Math.abs(sat.axis.data[0]!) - 1)).toBeLessThan(1e-7);
  });

  it('enumerates, and returns the single contact point the geometry defines', () => {
    // This threw before the tangent basis was reorthogonalized:
    // `intersectContactHalfspaces4: failed to enumerate a bounded contact
    // patch`. The next block derives, without the enumerator, that the answer
    // must be one point; this checks the enumerator now agrees.
    const [a, b] = capturedPair();
    const result = hyperboxContactPatch4(a, b);
    expect(result.patch).not.toBeNull();
    const patch = result.patch!;
    expect(patch.intrinsicDim).toBe(0);
    expect(patch.kind).toBe('point');
    expect(patch.vertices).toHaveLength(1);
    expect(patch.solverPoints).toHaveLength(1);

    // And it is the point derived independently below, not merely some point.
    const sat = hyperboxSat4(a, b);
    const expected = a
      .support(sat.axis.clone().multiplyScalar(-1))
      .point.clone()
      .add(patch.translationA);
    // Agreement to 1e-8. The enumerated vertex is the solution of a constraint
    // triple drawn from a set that still contains a near-degenerate row, so its
    // accuracy is set by that solve rather than by machine epsilon; measured,
    // the two differ by 9.5e-10 on coordinates of order 0.7. The tolerance is
    // stated rather than tuned: the property that has to hold exactly is
    // containment, asserted below.
    let separation = 0;
    for (let axis = 0; axis < 4; axis++) {
      separation = Math.hypot(
        separation, patch.vertices[0]!.point.data[axis]! - expected.data[axis]!
      );
    }
    expect(separation).toBeLessThan(1e-8);

    // Contained in both bodies, which is what makes it a contact point.
    const shiftedA = new TransformN(
      4, a.transform.rotation, a.transform.position.clone().add(patch.translationA)
    );
    expect(outsideBy(patch.vertices[0]!.point, CAPTURED.striker.halfExtents, shiftedA))
      .toBeLessThan(1e-9);
    expect(outsideBy(patch.vertices[0]!.point, CAPTURED.target.halfExtents, b.transform))
      .toBeLessThan(1e-9);
  });
});

describe('what the contact set must be, derived without the enumerator', () => {
  /**
   * Both bodies are rotated here, so the pair is reduced to a single relative
   * rotation before reasoning: put A in B's frame. The contact normal is then
   * B's x axis, and the question is which feature of A is extreme along it.
   */
  it('A is tilted out of parallel in all three planes containing the normal', () => {
    const [a, b] = capturedPair();
    const relative = b.transform.inverse();
    // A's four local axes, expressed in B's frame.
    const axes = [0, 1, 2, 3].map((k) => {
      const e = new VecN([0, 0, 0, 0]);
      e.data[k] = 1;
      const world = (a.transform.rotation as Rotor4).applyToPoint(e);
      return (relative.rotation as Rotor4).applyToPoint(world);
    });

    // A's x axis is not exactly B's x axis: it has components in y, z and w.
    const ax = axes[0]!;
    expect(Math.abs(ax.data[0]!)).toBeGreaterThan(0.999999);
    for (const axis of [1, 2, 3]) {
      expect(Math.abs(ax.data[axis]!)).toBeGreaterThan(0);
    }
    // All three off-axis components are non-zero and of different size, so the
    // misalignment is a genuine three-plane tilt and not a single-plane one.
    const off = [1, 2, 3].map((axis) => Math.abs(ax.data[axis]!));
    expect(new Set(off).size).toBe(3);
  });

  it('so the supporting feature is a single vertex, and the contact set is that point', () => {
    // For two convex bodies in touching contact the contact set is the
    // intersection of their supporting features along the contact normal. B's
    // supporting feature is a whole 3-face. A's is found by asking which of its
    // sixteen corners is extreme along −(B's x): because A's x axis has a
    // non-zero component in every one of y, z and w, exactly one corner is
    // strictly extreme, so the supporting feature is a vertex, and the
    // intersection is that single point.
    const [a, b] = capturedPair();
    const direction = new VecN([-1, 0, 0, 0]);
    const support = a.support(direction);

    // Strictly extreme: the runner-up corner is measurably behind it. That is
    // what makes the supporting feature zero-dimensional rather than a face
    // that happens to be reported as a point.
    const corners: { point: VecN; value: number }[] = [];
    for (let mask = 0; mask < 16; mask++) {
      const local = new VecN([0, 0, 0, 0]);
      for (let axis = 0; axis < 4; axis++) {
        local.data[axis] =
          (mask & (1 << axis) ? 1 : -1) * CAPTURED.striker.halfExtents[axis]!;
      }
      const world = a.transform.applyToPoint(local);
      corners.push({ point: world, value: world.data[0]! });
    }
    corners.sort((p, q) => p.value - q.value);
    const best = corners[0]!;
    const runnerUp = corners[1]!;
    expect(runnerUp.value - best.value).toBeGreaterThan(1e-9);

    // And the support query agrees with that corner.
    for (let axis = 0; axis < 4; axis++) {
      expect(support.point.data[axis]!).toBeCloseTo(best.point.data[axis]!, 12);
    }
  });

  it('the expected contact point lies in both bodies after the API’s alignment shift', () => {
    // `hyperboxContactPatch4` translates A along the SAT minimum-translation
    // axis into a just-touching configuration before generating any point, so
    // the expected point must be checked against the TRANSLATED A. The shift is
    // reconstructed here from the SAT result, the same way the API computes it.
    const [a, b] = capturedPair();
    const sat = hyperboxSat4(a, b);
    const normal = sat.axis.clone();
    const alignmentShift = sat.intervalB[1] - sat.intervalA[0];
    const translation = normal.clone().multiplyScalar(alignmentShift);

    const shiftedA = new TransformN(
      4,
      a.transform.rotation,
      a.transform.position.clone().add(translation)
    );
    const support = a.support(normal.clone().multiplyScalar(-1));
    const expectedPoint = support.point.clone().add(translation);

    // Inside the translated A — it is one of its corners, moved with it.
    expect(outsideBy(expectedPoint, CAPTURED.striker.halfExtents, shiftedA))
      .toBeLessThan(1e-9);
    // And inside B, which is what makes it a contact point rather than merely a
    // point on A.
    expect(outsideBy(expectedPoint, CAPTURED.target.halfExtents, b.transform))
      .toBeLessThan(1e-9);
  });
});

// ---------------------------------------------------------------------------
// The configuration matrix
// ---------------------------------------------------------------------------

const A_HALF = [0.4, 0.5, 0.6, 0.7] as const;
const B_HALF = [0.45, 0.55, 0.65, 0.75] as const;

interface Posed {
  readonly a: HyperboxSupportShape4;
  readonly b: HyperboxSupportShape4;
}

/** A pair separated along x by `gap`, with A turned through `planes`. */
function posedPair(options: {
  readonly planes?: readonly (readonly [number, number])[];
  readonly angle?: number;
  readonly bPlanes?: readonly (readonly [number, number])[];
  readonly bAngle?: number;
  readonly gap: number;
  readonly scale?: number;
  readonly offset?: readonly number[];
}): Posed {
  const scale = options.scale ?? 1;
  const shift = options.offset ?? [0, 0, 0, 0];
  const turn = (
    planes: readonly (readonly [number, number])[] | undefined,
    angle: number | undefined
  ): Rotor4 =>
    planes === undefined || planes.length === 0 || angle === undefined || angle === 0
      ? Rotor4.identity()
      : Rotor4.fromPlanes(planes.map(([i, j]) => ({ i, j, angle })));

  const aHalf = A_HALF.map((h) => h * scale);
  const bHalf = B_HALF.map((h) => h * scale);
  return {
    a: new HyperboxSupportShape4(
      aHalf,
      new TransformN(
        4,
        turn(options.planes, options.angle),
        new VecN([shift[0]!, shift[1]!, shift[2]!, shift[3]!])
      )
    ),
    b: new HyperboxSupportShape4(
      bHalf,
      new TransformN(
        4,
        turn(options.bPlanes, options.bAngle),
        new VecN([
          shift[0]! + options.gap * scale, shift[1]!, shift[2]!, shift[3]!
        ])
      )
    )
  };
}

/** Dimension, extent and containment of a posed pair's patch. */
function inspect(pair: Posed): {
  readonly status: string;
  readonly dim: number;
  readonly vertices: number;
  readonly solverPoints: number;
  readonly outside: number;
  readonly extent: number;
} {
  const sat = hyperboxSat4(pair.a, pair.b);
  const result = hyperboxContactPatch4(pair.a, pair.b);
  if (result.patch === null) {
    return { status: sat.status, dim: -1, vertices: 0, solverPoints: 0, outside: 0, extent: 0 };
  }
  const patch = result.patch;
  const shiftedA = new TransformN(
    4,
    pair.a.transform.rotation,
    pair.a.transform.position.clone().add(patch.translationA)
  );
  let outside = -Infinity;
  for (const vertex of patch.vertices) {
    outside = Math.max(
      outside,
      outsideBy(vertex.point, pair.a.halfExtents as unknown as number[], shiftedA),
      outsideBy(vertex.point, pair.b.halfExtents as unknown as number[], pair.b.transform)
    );
  }
  let extent = 0;
  for (const p of patch.vertices) {
    for (const q of patch.vertices) {
      let d = 0;
      for (let axis = 0; axis < 4; axis++) {
        d += (p.point.data[axis]! - q.point.data[axis]!) ** 2;
      }
      extent = Math.max(extent, Math.sqrt(d));
    }
  }
  return {
    status: sat.status,
    dim: patch.intrinsicDim,
    vertices: patch.vertices.length,
    solverPoints: patch.solverPoints.length,
    outside,
    extent
  };
}

describe('the configuration matrix', () => {
  it('exact parallel faces keep their full three-dimensional patch', () => {
    // The fix must not collapse a genuine patch into a point. This is the case
    // a naive support-vertex fallback would destroy.
    const reading = inspect(posedPair({ gap: 0.83 }));
    expect(reading.status).toBe('overlapping');
    expect(reading.dim).toBe(3);
    expect(reading.vertices).toBe(8);
    expect(reading.outside).toBeLessThan(1e-12);
    // Its extent is the diagonal of the overlapping face region, not a point.
    expect(reading.extent).toBeGreaterThan(1);
  });

  it('one, two and three tilted planes give dimension 2, 1 and 0', () => {
    const families = [
      { planes: [[0, 1]] as const, dim: 2, vertices: 4 },
      { planes: [[0, 1], [0, 2]] as const, dim: 1, vertices: 2 },
      { planes: [[0, 1], [0, 2], [0, 3]] as const, dim: 0, vertices: 1 }
    ];
    // 1e-7 is excluded here and covered separately below: at that angle the
    // alignment translation overshoots the touching configuration, which is a
    // different situation and a second, still-open defect.
    for (const family of families) {
      for (const angle of [1e-3, 1e-5, 1e-9]) {
        const reading = inspect(posedPair({ planes: family.planes, angle, gap: 0.83 }));
        expect(`${family.dim}@${angle}`).toBe(`${reading.dim}@${angle}`);
        expect(reading.vertices).toBe(family.vertices);
        expect(reading.outside).toBeLessThan(1e-9);
      }
    }
  });

  it('both bodies rotated, in different planes, still enumerates', () => {
    // The captured failure had both bodies turned. A fixture that turns only
    // one would not have covered it.
    // Angles are chosen outside the overshoot regime recorded as OPEN below;
    // measured, this family enumerates at 1e-2 through 1e-7 and at 1e-9, and
    // throws only at 1e-8.
    for (const angle of [1e-3, 1e-6]) {
      const reading = inspect(
        posedPair({
          planes: [[0, 1], [0, 2], [0, 3]],
          angle,
          bPlanes: [[0, 2]],
          bAngle: -angle / 2,
          gap: 0.83
        })
      );
      expect(reading.dim).toBeGreaterThanOrEqual(0);
      expect(reading.vertices).toBeGreaterThan(0);
      expect(reading.outside).toBeLessThan(1e-9);
    }
  });

  it('survives translation and scaling of the whole configuration', () => {
    // A contact set is a geometric object: moving or scaling both bodies must
    // not change its dimension, and must scale its extent.
    const base = inspect(posedPair({ planes: [[0, 1]], angle: 1e-5, gap: 0.83 }));
    const moved = inspect(
      posedPair({ planes: [[0, 1]], angle: 1e-5, gap: 0.83, offset: [12, -7, 3, 5] })
    );
    expect(moved.dim).toBe(base.dim);
    expect(moved.vertices).toBe(base.vertices);
    expect(moved.outside).toBeLessThan(1e-8);

    const scaled = inspect(posedPair({ planes: [[0, 1]], angle: 1e-5, gap: 0.83, scale: 100 }));
    expect(scaled.dim).toBe(base.dim);
    expect(scaled.extent / base.extent).toBeGreaterThan(50);
  });

  it('separated pairs still report no patch', () => {
    // The fix must not invent contact where there is none.
    for (const gap of [0.86, 1.2, 4]) {
      const reading = inspect(posedPair({ gap }));
      expect(reading.status).toBe('separated');
      expect(reading.dim).toBe(-1);
      expect(reading.vertices).toBe(0);
    }
    // Including for tilted and for both-rotated pairs.
    expect(inspect(posedPair({ planes: [[0, 1], [0, 2], [0, 3]], angle: 1e-4, gap: 1.5 })).dim)
      .toBe(-1);
  });

  it('full patch vertices and reduced solver points are reported separately', () => {
    // A three-dimensional patch has more vertices than the solver is handed;
    // a point patch has exactly one of each. Conflating the two counts would
    // hide a collapsed patch behind a healthy-looking solver set.
    const full = inspect(posedPair({ gap: 0.83 }));
    expect(full.vertices).toBe(8);
    expect(full.solverPoints).toBeLessThanOrEqual(full.vertices);
    expect(full.solverPoints).toBeGreaterThanOrEqual(4);

    const point = inspect(
      posedPair({ planes: [[0, 1], [0, 2], [0, 3]], angle: 1e-5, gap: 0.83 })
    );
    expect(point.vertices).toBe(1);
    expect(point.solverPoints).toBe(1);
  });

  it('the tangent basis is orthonormal for normals close to a coordinate axis', () => {
    // The defect, stated at its source rather than through its consequence.
    for (const epsilon of [1e-6, 1e-8, 1e-10, 1e-12, 0]) {
      const normal = new VecN([1, epsilon, -epsilon / 2, epsilon / 3]).normalize();
      const basis = contactTangentBasis4(normal);
      for (const tangent of basis) {
        expect(Math.abs(tangent.dot(normal))).toBeLessThan(1e-15);
        expect(Math.abs(tangent.length() - 1)).toBeLessThan(1e-15);
      }
      for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
        expect(Math.abs(basis[i]!.dot(basis[j]!))).toBeLessThan(1e-15);
      }
    }
  });
});

describe('a second defect, distinct from the one fixed here', () => {
  it('OPEN: the alignment translation overshoots the touching configuration', () => {
    // Recorded, not repaired. This is NOT the tangent-basis cancellation that
    // the rest of this file is about, and it is not asserted to be wanted
    // behaviour.
    //
    // SUPERSEDES an earlier description of this case, which called the axis
    // "cross-family". It is not: `hyperboxSat4` reports
    // `source.featureClass === 'facet-a'` with `axesA: [0]`, so the axis IS a
    // facet normal — A's own, carrying A's 1e-7 tilt. Two corrections that
    // followed from that misreading, "make SAT prefer a facet normal" and
    // "align along the reference box's facet normal instead of the raw axis",
    // are withdrawn: both merely select the axis SAT already returns.
    //
    // What is actually wrong is the translation. A is moved along that axis
    // until the projected intervals touch, and the result overshoots: measured,
    // all eight of A's corners that reach the contact plane sit 5.0e-9 to
    // 1.05e-7 OUTSIDE B. No feasible vertex exists for the enumerator to find,
    // so no tolerance could rescue it without admitting points outside B.
    const pair = posedPair({ planes: [[0, 1]], angle: 1e-7, gap: 0.83 });
    const sat = hyperboxSat4(pair.a, pair.b);
    expect(sat.status).toBe('overlapping');
    // The axis is A's facet normal, reported as such.
    expect(sat.source.featureClass).toBe('facet-a');
    expect(Array.from(sat.source.axesA)).toEqual([0]);
    const axisA = pair.a.worldAxes()[0]!;
    expect(Math.abs(Math.abs(axisA.dot(sat.axis)) - 1)).toBeLessThan(1e-12);
    expect(() => hyperboxContactPatch4(pair.a, pair.b)).toThrow(
      /failed to enumerate a bounded contact patch/
    );

    // The corners are outside B, which is why no tolerance could rescue this.
    const shift = sat.intervalB[1] - sat.intervalA[0];
    const translation = sat.axis.clone().multiplyScalar(shift);
    let bestOutside = Infinity;
    for (let mask = 0; mask < 16; mask++) {
      const local = new VecN([0, 0, 0, 0]);
      for (let k = 0; k < 4; k++) {
        local.data[k] = (mask & (1 << k) ? 1 : -1) * A_HALF[k]!;
      }
      const point = pair.a.transform.applyToPoint(local).add(translation);
      if (Math.abs(sat.axis.dot(point) - sat.intervalB[1]) > 1e-9) continue;
      bestOutside = Math.min(
        bestOutside,
        outsideBy(point, B_HALF as unknown as number[], pair.b.transform)
      );
    }
    expect(bestOutside).toBeGreaterThan(1e-9);
  });

  it('OPEN: the neighbouring angles are unaffected, so this is narrow', () => {
    // The same family at 1e-5 and 1e-9 enumerates correctly, which is what
    // makes the case above a specific axis-selection regime rather than a
    // general failure of nearly-parallel contact.
    for (const angle of [1e-5, 1e-9]) {
      const reading = inspect(posedPair({ planes: [[0, 1]], angle, gap: 0.83 }));
      expect(reading.dim).toBe(2);
      expect(reading.outside).toBeLessThan(1e-9);
    }
  });
});
