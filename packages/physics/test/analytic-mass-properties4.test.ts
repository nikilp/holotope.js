import { describe, expect, it } from 'vitest';
import {
  BivectorN,
  Rotor4,
  createHyperrectangle,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  HyperboxCollider4,
  PhysicsWorld4,
  RigidBody4,
  massPropertiesFromCellComplex4,
  massPropertiesOfGlome4,
  massPropertiesOfHyperbox4
} from '../src/index.js';

/**
 * Analytic R4 mass properties, checked against arithmetic rather than against
 * another implementation.
 *
 * For a uniform solid hyperbox of half-extents `h` and density `ρ`:
 *
 *   V   = 16 h₀h₁h₂h₃
 *   m   = ρV
 *   COM = 0
 *   Cᵢᵢ = m hᵢ²/3,  Cᵢⱼ = 0 for i ≠ j
 *   Iᵢⱼ = Cᵢᵢ + Cⱼⱼ = m(hᵢ² + hⱼ²)/3
 *
 * For a uniform solid glome of radius `r`:
 *
 *   V   = π²r⁴/2
 *   ∫|x|² dV = ∫₀ʳ 2π²s⁵ ds = π²r⁶/3, so ∫|x|² dm = m·2r²/3
 *   Cᵢᵢ = m r²/6 by symmetry,  Iᵢⱼ = m r²/3 in every plane
 *
 * Half-extents are strictly increasing and chosen so all six pair sums differ.
 * A cube's second moments are degenerate, which would hide both ordering
 * mistakes and accidental isotropy.
 */

const PLANES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3]
] as const;

/** Ascending, so the principal frame is the authored frame. */
const HALF = [0.5, 1.25, 2, 3.5] as const;

/**
 * Relative error, because `toBeCloseTo` compares absolute differences and so
 * means nothing at 1e-24 and everything at 1e30. Every scale test below is a
 * question about proportion, not about absolute distance.
 */
const relativeError = (actual: number, expected: number): number =>
  Math.abs(actual - expected) / Math.abs(expected);

describe('massPropertiesOfHyperbox4 against the product-domain oracle', () => {
  const density = 1.7;
  const properties = massPropertiesOfHyperbox4([...HALF], { density });
  const volume = 16 * HALF[0] * HALF[1] * HALF[2] * HALF[3];
  const mass = density * volume;
  const secondMoment = (axis: number): number => (mass * HALF[axis]! ** 2) / 3;

  it('integrates the product volume and its mass', () => {
    expect(properties.volume).toBeCloseTo(volume, 9);
    expect(properties.mass).toBeCloseTo(mass, 9);
  });

  it('centres the body on the origin of the authored frame', () => {
    for (const component of properties.centerOfMass.data) {
      expect(component).toBe(0);
    }
  });

  it('produces a diagonal source covariance matching m·hᵢ²/3', () => {
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const expected = row === col ? secondMoment(row) : 0;
        expect(properties.covarianceAtCenter.get(row, col)).toBeCloseTo(expected, 9);
      }
    }
  });

  it('gives the six plane inertias m(hᵢ² + hⱼ²)/3', () => {
    PLANES.forEach(([i, j], plane) => {
      expect(properties.inertiaDiagonal[plane]!).toBeCloseTo(
        secondMoment(i) + secondMoment(j),
        9
      );
    });
  });

  it('scales linearly with density and to the sixth power in extent', () => {
    const single = massPropertiesOfHyperbox4([...HALF]);
    const heavy = massPropertiesOfHyperbox4([...HALF], { density: 3 });
    expect(heavy.mass).toBeCloseTo(single.mass * 3, 9);
    for (let plane = 0; plane < 6; plane += 1) {
      expect(heavy.inertiaDiagonal[plane]!).toBeCloseTo(single.inertiaDiagonal[plane]! * 3, 9);
    }
    // Volume grows as s⁴ and each second moment carries a further s², so a
    // uniformly scaled box has inertia s⁶ times the original.
    const scaled = massPropertiesOfHyperbox4(HALF.map((h) => h * 2));
    for (let plane = 0; plane < 6; plane += 1) {
      expect(scaled.inertiaDiagonal[plane]!).toBeCloseTo(
        single.inertiaDiagonal[plane]! * 64,
        6
      );
    }
  });

  it('obeys the scaling law at extreme but finite scales', () => {
    // Dividing an inertia by its own mass and the square of the scale asks the
    // implementation to agree with itself: both sides are the same product.
    // The scaling law is not an identity in the source, which never scales
    // anything — it recomputes from the scaled extents — so a wrong exponent
    // anywhere in the formula breaks it. Volume is checked too: it is the
    // quantity that overflows first and it was the one nothing pinned.
    const unit = massPropertiesOfHyperbox4([...HALF]);
    for (const scale of [1e-6, 1e-3, 1e3, 1e5]) {
      const scaled = massPropertiesOfHyperbox4(HALF.map((h) => h * scale));
      expect(relativeError(scaled.volume, 16 * HALF.reduce((p, h) => p * h * scale, 1)))
        .toBeLessThan(1e-12);
      expect(relativeError(scaled.volume, unit.volume * scale ** 4)).toBeLessThan(1e-12);
      expect(relativeError(scaled.mass, unit.mass * scale ** 4)).toBeLessThan(1e-12);
      for (let plane = 0; plane < 6; plane += 1) {
        expect(relativeError(scaled.inertiaDiagonal[plane]!, unit.inertiaDiagonal[plane]! * scale ** 6))
          .toBeLessThan(1e-12);
      }
    }
  });
});

describe('massPropertiesOfHyperbox4 frame convention', () => {
  it('leaves an already-ascending box in the authored frame', () => {
    const properties = massPropertiesOfHyperbox4([...HALF]);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        expect(properties.principalAxes.get(row, col)).toBeCloseTo(row === col ? 1 : 0, 12);
      }
    }
    // Ascending second moments, as the type documents.
    for (let axis = 1; axis < 4; axis += 1) {
      expect(properties.principalSecondMoments[axis]!).toBeGreaterThan(
        properties.principalSecondMoments[axis - 1]!
      );
    }
  });

  it('permutes a descending box into the canonical ascending frame', () => {
    const descending = massPropertiesOfHyperbox4([...HALF].reverse());
    const ascending = massPropertiesOfHyperbox4([...HALF]);
    // Same solid, so the canonical representation is the same numbers.
    for (let axis = 0; axis < 4; axis += 1) {
      expect(descending.principalSecondMoments[axis]!).toBeCloseTo(
        ascending.principalSecondMoments[axis]!,
        9
      );
    }
    for (let plane = 0; plane < 6; plane += 1) {
      expect(descending.inertiaDiagonal[plane]!).toBeCloseTo(
        ascending.inertiaDiagonal[plane]!,
        9
      );
    }
    // …reached by a genuine reorientation rather than by relabelling.
    expect(descending.principalAxes.determinant()).toBeCloseTo(1, 12);
    let identity = true;
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        if (Math.abs(descending.principalAxes.get(row, col) - (row === col ? 1 : 0)) > 1e-12) {
          identity = false;
        }
      }
    }
    expect(identity).toBe(false);
  });

  it('keeps repeated extents in an orientation-preserving frame', () => {
    for (const half of [
      [1, 1, 1, 1],
      [1, 1, 2, 3],
      [2, 2, 2, 5]
    ]) {
      const properties = massPropertiesOfHyperbox4(half);
      expect(properties.principalAxes.determinant()).toBeCloseTo(1, 12);
      for (let axis = 1; axis < 4; axis += 1) {
        expect(properties.principalSecondMoments[axis]!).toBeGreaterThanOrEqual(
          properties.principalSecondMoments[axis - 1]! - 1e-12
        );
      }
    }
  });

  it('returns a signed permutation for every ordering of the authored axes', () => {
    // This is what the documented advice rests on. "Give the collider the same
    // half-extents sorted ascending" is only sound if the principal frame
    // relabels axes and nothing else — if the determinant repair could return a
    // frame that mixes two axes, sorting the extents would not describe it.
    for (const half of [
      [...HALF],
      [...HALF].reverse(),
      [3.5, 0.5, 2, 1.25],
      [2, 3.5, 0.5, 1.25],
      [1, 1, 1, 1],
      [1, 1, 2, 3],
      [3, 2, 1, 1],
      [2, 2, 2, 5],
      [1.25, 0.5, 1.25, 0.5]
    ]) {
      const axes = massPropertiesOfHyperbox4(half).principalAxes;
      expect(axes.determinant()).toBeCloseTo(1, 12);
      for (let row = 0; row < 4; row += 1) {
        const rowEntries = [0, 1, 2, 3].map((col) => axes.get(row, col));
        const colEntries = [0, 1, 2, 3].map((col) => axes.get(col, row));
        for (const entries of [rowEntries, colEntries]) {
          const unit = entries.filter((entry) => Math.abs(Math.abs(entry) - 1) < 1e-12);
          const zero = entries.filter((entry) => Math.abs(entry) < 1e-12);
          expect(`${half}/${row}: ${unit.length} unit, ${zero.length} zero`)
            .toBe(`${half}/${row}: 1 unit, 3 zero`);
        }
      }
    }
  });

  it('refuses inputs that do not describe a solid box', () => {
    expect(() => massPropertiesOfHyperbox4([1, 2, 3])).toThrow(/expected 4 half-extents/);
    expect(() => massPropertiesOfHyperbox4([1, 2, 3, 0])).toThrow(/finite and positive/);
    expect(() => massPropertiesOfHyperbox4([1, 2, 3, -1])).toThrow(/finite and positive/);
    expect(() => massPropertiesOfHyperbox4([1, 2, 3, Number.NaN])).toThrow(/finite and positive/);
    expect(() => massPropertiesOfHyperbox4([1, 2, 3, Number.POSITIVE_INFINITY]))
      .toThrow(/finite and positive/);
    expect(() => massPropertiesOfHyperbox4([...HALF], { density: 0 })).toThrow(/density/);
    expect(() => massPropertiesOfHyperbox4([...HALF], { density: -1 })).toThrow(/density/);
    expect(() => massPropertiesOfHyperbox4([1e120, 1e120, 1e120, 1e120]))
      .toThrow(/massPropertiesOfHyperbox4: inputs overflow to a non-finite/);
  });
});

describe('a hyperbox body paired with its collider', () => {
  /**
   * The failure this guards against is silent: `fromMassProperties` adopts the
   * principal rotor, so a collider handed the *authored* half-extents describes
   * a differently-shaped solid than the one the inertia was computed for, and
   * nothing throws. Only the occupied region can tell the two apart, so the
   * collider is asked for its sixteen world vertices.
   */
  const AUTHORED = [3.5, 2, 1.25, 0.5];

  /** A set of points, order-independent and printable when it disagrees. */
  const asSet = (points: readonly number[][]): string =>
    points.map((point) => point.map((v) => v.toFixed(9)).join(',')).sort().join(' | ');

  const cornersOf = (half: readonly number[]): number[][] =>
    Array.from({ length: 16 }, (_, mask) =>
      [0, 1, 2, 3].map((axis) => (mask & (1 << axis) ? 1 : -1) * half[axis]!)
    );

  /** Corners of a collider carried by a body built from the authored box. */
  const posedCorners = (colliderHalf: readonly number[]): number[][] => {
    const body = RigidBody4.fromMassProperties(massPropertiesOfHyperbox4(AUTHORED));
    const collider = new HyperboxCollider4({
      id: 'crate',
      halfExtents: [...colliderHalf],
      participant: body
    });
    return collider.shape.enumerateVertices().map((vertex) => vertex.point.toArray());
  };

  it('occupies the authored region when the collider gets ascending half-extents', () => {
    expect(asSet(posedCorners([...AUTHORED].sort((a, b) => a - b))))
      .toBe(asSet(cornersOf(AUTHORED)));
  });

  it('occupies a different region when the collider gets the authored order', () => {
    // The negative control. Without it the assertion above would pass equally
    // well against a frame that happened to be the identity, and would
    // establish nothing about why the sort is necessary.
    expect(asSet(posedCorners(AUTHORED))).not.toBe(asSet(cornersOf(AUTHORED)));
  });

  it('needs no sort when the authored extents already ascend', () => {
    const ascending = [...HALF];
    const body = RigidBody4.fromMassProperties(massPropertiesOfHyperbox4(ascending));
    const collider = new HyperboxCollider4({
      id: 'crate',
      halfExtents: ascending,
      participant: body
    });
    expect(asSet(collider.shape.enumerateVertices().map((v) => v.point.toArray())))
      .toBe(asSet(cornersOf(ascending)));
  });
});

describe('massPropertiesOfGlome4 against the continuum derivation', () => {
  const radius = 1.75;
  const density = 2.25;
  const properties = massPropertiesOfGlome4(radius, { density });
  const volume = (Math.PI ** 2 * radius ** 4) / 2;
  const mass = density * volume;

  it('integrates π²r⁴/2 and its mass', () => {
    expect(properties.volume).toBeCloseTo(volume, 9);
    expect(properties.mass).toBeCloseTo(mass, 9);
  });

  it('is isotropic with second moment m·r²/6', () => {
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const expected = row === col ? (mass * radius * radius) / 6 : 0;
        expect(properties.covarianceAtCenter.get(row, col)).toBeCloseTo(expected, 9);
      }
    }
  });

  it('gives m·r²/3 in every one of the six planes', () => {
    for (let plane = 0; plane < 6; plane += 1) {
      expect(properties.inertiaDiagonal[plane]!).toBeCloseTo((mass * radius * radius) / 3, 9);
    }
  });

  it('has no preferred frame, so the principal rotor is the identity', () => {
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        expect(properties.principalAxes.get(row, col)).toBeCloseTo(row === col ? 1 : 0, 12);
      }
    }
    // Compared against the library's own identity rather than against an
    // assumed component order.
    const body = RigidBody4.fromMassProperties(properties);
    const identity = Rotor4.identity();
    identity.left.forEach((component, index) => {
      expect(body.rotation.left[index]!).toBeCloseTo(component, 12);
    });
    identity.right.forEach((component, index) => {
      expect(body.rotation.right[index]!).toBeCloseTo(component, 12);
    });
  });

  it('scales linearly with density and to the sixth power in radius', () => {
    const single = massPropertiesOfGlome4(radius);
    expect(massPropertiesOfGlome4(radius, { density: 4 }).mass).toBeCloseTo(single.mass * 4, 9);
    expect(massPropertiesOfGlome4(radius * 2).inertiaDiagonal[0]!).toBeCloseTo(
      single.inertiaDiagonal[0]! * 64,
      6
    );
  });

  it('obeys the scaling law at extreme but finite scales', () => {
    // `inertiaDiagonal[0]` is 2·(m r²/6) and `(mass · r · r)/3` is m r²/3, which
    // are the same double for every input — the old assertion here measured a
    // difference of exactly zero at every radius and established only
    // finiteness. Mass against the closed form, and the r⁴/r⁶ scaling law, are
    // claims the implementation can actually fail.
    const unit = massPropertiesOfGlome4(1);
    for (const r of [1e-5, 1e-2, 1e2, 1e4]) {
      const properties = massPropertiesOfGlome4(r);
      expect(relativeError(properties.mass, (Math.PI ** 2 * r ** 4) / 2)).toBeLessThan(1e-12);
      expect(relativeError(properties.volume, unit.volume * r ** 4)).toBeLessThan(1e-12);
      expect(relativeError(properties.inertiaDiagonal[0]!, unit.inertiaDiagonal[0]! * r ** 6))
        .toBeLessThan(1e-12);
    }
  });

  it('refuses inputs that do not describe a solid ball', () => {
    expect(() => massPropertiesOfGlome4(0)).toThrow(/radius/);
    expect(() => massPropertiesOfGlome4(-1)).toThrow(/radius/);
    expect(() => massPropertiesOfGlome4(Number.NaN)).toThrow(/radius/);
    expect(() => massPropertiesOfGlome4(Number.POSITIVE_INFINITY)).toThrow(/radius/);
    expect(() => massPropertiesOfGlome4(2, { density: 0 })).toThrow(/density/);
    // Finite volume and mass, but a second moment that is not: the guard has to
    // reach past the mass to catch it, and has to name this function doing it.
    expect(() => massPropertiesOfGlome4(1e60))
      .toThrow(/massPropertiesOfGlome4: inputs overflow to a non-finite second moment/);
  });
});

describe('the analytic hyperbox agrees with the canonical complex chain', () => {
  // The same solid reached two ways: closed form, and integrated from a
  // tetrahedralized boundary. `createHyperrectangle` takes edge lengths, so the
  // half-extents are half of those.
  const edges = [1, 2.5, 4, 7] as const;
  const density = 1.4;
  const viaComplex = massPropertiesFromCellComplex4(
    tetrahedralizeCuboidCells(
      createHyperrectangle({ dim: 4, edgeLengths: [...edges], maxCellDimension: 3 })
    ),
    { density }
  );
  const viaAnalytic = massPropertiesOfHyperbox4(
    edges.map((edge) => edge / 2),
    { density }
  );

  it('agrees on volume, mass and centre', () => {
    expect(viaAnalytic.volume).toBeCloseTo(viaComplex.volume, 9);
    expect(viaAnalytic.mass).toBeCloseTo(viaComplex.mass, 9);
    for (let axis = 0; axis < 4; axis += 1) {
      expect(viaAnalytic.centerOfMass.data[axis]!).toBeCloseTo(
        viaComplex.centerOfMass.data[axis]!,
        9
      );
    }
  });

  it('agrees on the source-frame covariance', () => {
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        expect(viaAnalytic.covarianceAtCenter.get(row, col)).toBeCloseTo(
          viaComplex.covarianceAtCenter.get(row, col),
          8
        );
      }
    }
  });

  it('agrees on the canonical principal moments and plane inertias', () => {
    for (let axis = 0; axis < 4; axis += 1) {
      expect(viaAnalytic.principalSecondMoments[axis]!).toBeCloseTo(
        viaComplex.principalSecondMoments[axis]!,
        8
      );
    }
    for (let plane = 0; plane < 6; plane += 1) {
      expect(viaAnalytic.inertiaDiagonal[plane]!).toBeCloseTo(
        viaComplex.inertiaDiagonal[plane]!,
        8
      );
    }
  });

  it('reconstructs the same inertia operator, whatever frame each chose', () => {
    // Q Λ Qᵀ is frame-independent even when Q differs by a sign or by the
    // arbitrary choice inside a degenerate eigenspace, so it is the honest
    // comparison between two principal frames of the same solid.
    const reconstruct = (properties: typeof viaAnalytic): number[] => {
      const out: number[] = [];
      for (let row = 0; row < 4; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          let sum = 0;
          for (let axis = 0; axis < 4; axis += 1) {
            sum +=
              properties.principalAxes.get(row, axis) *
              properties.principalSecondMoments[axis]! *
              properties.principalAxes.get(col, axis);
          }
          out.push(sum);
        }
      }
      return out;
    };
    const analytic = reconstruct(viaAnalytic);
    const complex = reconstruct(viaComplex);
    analytic.forEach((value, index) => {
      expect(value).toBeCloseTo(complex[index]!, 8);
    });
  });

  it('produces the same rigid-body dynamics under a torque-free spin', () => {
    const spin = BivectorN.fromPlanes(4, [
      { i: 0, j: 1, angle: 3.4 },
      { i: 1, j: 2, angle: 0.11 }
    ]);
    const run = (properties: typeof viaAnalytic): number[] => {
      const world = new PhysicsWorld4({ gravity: [0, 0, 0, 0] });
      const body = RigidBody4.fromMassProperties(properties, { gravityScale: 0 });
      body.setAngularVelocityWorld(spin);
      world.addBody(body);
      for (let step = 0; step < 600; step += 1) world.step(1 / 240, 2);
      return Array.from(body.angularVelocityWorld().coeffs);
    };
    const analytic = run(viaAnalytic);
    const complex = run(viaComplex);
    analytic.forEach((value, plane) => {
      expect(value).toBeCloseTo(complex[plane]!, 6);
    });
  });
});

describe('the analytic glome against an independent numerical integration', () => {
  // A ball has no exact tetrahedralization, so nothing here can claim exact
  // agreement. What the closed forms need is an oracle that does not share
  // their derivation: this one counts lattice points inside the ball and
  // accumulates x₀² over them, which is a different method reaching the same
  // two numbers.
  //
  // The estimate's error is NOT monotone in the sample count — an
  // equidistributed sequence improves on average and wanders locally, so
  // "refining moves it closer" is false for particular pairs and an earlier
  // version of this block passed only because it happened to compare against an
  // unusually bad coarse point. Each estimate is therefore checked against a
  // band it has to land inside.
  const radius = 1;
  const exact = massPropertiesOfGlome4(radius);

  /** Volume and ∫x₀²dV of the unit ball, by indicator count over [-1,1]⁴. */
  const integrate = (samples: number): { volume: number; secondMoment: number } => {
    let inside = 0;
    let squaredSum = 0;
    // A fixed additive-recurrence lattice, so the test cannot flake on a seed.
    const golden = [0.7548776662466927, 0.5698402909980532, 0.2207440846057596,
      0.8566748838545029];
    for (let n = 1; n <= samples; n += 1) {
      const point = [0, 1, 2, 3].map((axis) => ((n * golden[axis]!) % 1) * 2 - 1);
      const squared = point.reduce((sum, u) => sum + u * u, 0);
      if (squared <= 1) {
        inside += 1;
        squaredSum += point[0]! * point[0]!;
      }
    }
    // The cube has 4-volume 2⁴ = 16, so each sample carries 16/samples.
    return { volume: (inside / samples) * 16, secondMoment: (squaredSum / samples) * 16 };
  };

  it('reaches π²r⁴/2 within the band the lattice can support', () => {
    const estimate = integrate(200_000).volume;
    expect(relativeError(estimate, exact.volume)).toBeLessThan(0.01);
    // The band has teeth: it is tight enough to reject a volume off by a
    // percent, which is what pins the formula rather than merely its order of
    // magnitude.
    expect(relativeError(estimate, exact.volume * 1.02)).toBeGreaterThan(0.01);
    expect(relativeError(estimate, exact.volume * 0.98)).toBeGreaterThan(0.01);
  });

  it('reaches m·r²/6 for the second moment, which no other test pins', () => {
    // Everywhere else the glome's second moment is compared against a constant
    // transcribed from the same derivation the source used, which catches a
    // typo but not a shared mistake. Density is 1 here, so ∫x₀²dV is the
    // covariance entry directly.
    const estimate = integrate(200_000).secondMoment;
    const closedForm = (exact.mass * radius * radius) / 6;
    expect(relativeError(estimate, closedForm)).toBeLessThan(0.02);
    expect(relativeError(estimate, closedForm * 1.05)).toBeGreaterThan(0.02);
    expect(relativeError(estimate, closedForm * 0.95)).toBeGreaterThan(0.02);
    expect(exact.covarianceAtCenter.get(0, 0)).toBeCloseTo(closedForm, 12);
  });

  it('matches the closed form the continuum derivation gives', () => {
    expect(exact.volume).toBeCloseTo((Math.PI ** 2) / 2, 12);
    expect(exact.inertiaDiagonal[0]!).toBeCloseTo(exact.mass / 3, 12);
  });
});
