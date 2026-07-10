import { describe, expect, it } from 'vitest';
import { BivectorN, MatN, Rotor4, VecN, expBivector, rotationFromPlanes } from '@holotope/core';

function expectMatricesClose(a: MatN, b: MatN, digits = 12): void {
  expect(a.n).toBe(b.n);
  for (let k = 0; k < a.data.length; k++) {
    expect(a.data[k]!).toBeCloseTo(b.data[k]!, digits);
  }
}

function randomBivector(n: number, magnitude = 2): BivectorN {
  const b = new BivectorN(n);
  for (let k = 0; k < b.coeffs.length; k++) b.coeffs[k] = (Math.random() * 2 - 1) * magnitude;
  return b;
}

describe('BivectorN', () => {
  it('indexes all planes uniquely', () => {
    const n = 5;
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) seen.add(BivectorN.planeIndex(n, i, j));
    }
    expect(seen.size).toBe((n * (n - 1)) / 2);
    expect(Math.max(...seen)).toBe(seen.size - 1);
  });

  it('is antisymmetric through get/set', () => {
    const b = new BivectorN(4);
    b.set(3, 1, 0.7); // reversed plane order
    expect(b.get(1, 3)).toBeCloseTo(-0.7, 15);
    expect(b.get(3, 1)).toBeCloseTo(0.7, 15);
  });

  it('toSkewMatrix acts as the plane-rotation generator', () => {
    // d/dθ rotationInPlane at θ=0 equals the skew matrix of the unit bivector.
    const b = BivectorN.fromPlanes(4, [{ i: 1, j: 3, angle: 1 }]);
    const skew = b.toSkewMatrix();
    const h = 1e-7;
    const numeric = MatN.rotationInPlane(4, 1, 3, h);
    for (let k = 0; k < 16; k++) {
      const identity = k % 5 === 0 ? 1 : 0;
      expect((numeric.data[k]! - identity) / h).toBeCloseTo(skew.data[k]!, 6);
    }
  });
});

describe('expBivector', () => {
  it('exp(0) = I', () => {
    expectMatricesClose(expBivector(new BivectorN(4)), MatN.identity(4));
  });

  it('single-plane exp matches rotationInPlane across dimensions and angles', () => {
    for (const n of [3, 4, 6]) {
      for (const angle of [0.1, -1.3, Math.PI / 2, 3.0]) {
        const b = BivectorN.fromPlanes(n, [{ i: 0, j: n - 1, angle }]);
        expectMatricesClose(expBivector(b), MatN.rotationInPlane(n, 0, n - 1, angle));
      }
    }
  });

  it('commuting planes: exp(a·e01 + b·e23) = R01(a) · R23(b)', () => {
    const b = BivectorN.fromPlanes(4, [
      { i: 0, j: 1, angle: 0.8 },
      { i: 2, j: 3, angle: -1.7 }
    ]);
    const expected = MatN.rotationInPlane(4, 0, 1, 0.8).multiply(
      MatN.rotationInPlane(4, 2, 3, -1.7)
    );
    expectMatricesClose(expBivector(b), expected);
  });

  it('n=3 matches Rodrigues axis-angle', () => {
    // Bivector (θ12, −θ02, θ01) corresponds to rotation about axis
    // ω = (θ12, θ02·(−1)…) — verify against explicit Rodrigues instead of
    // trusting a convention: rotate basis vectors and compare.
    const axis = new VecN([0.3, -0.5, 0.8]).normalize();
    const angle = 1.1;
    // Skew matrix K with dx = ω × x has entries K = [[0,−ω2,ω1],[ω2,0,−ω0],[−ω1,ω0,0]].
    // In our plane convention: θ01 = ω2·angle? Derive by matching entries:
    // Ω[1][0] = θ01 = ω[2], Ω[2][0] = θ02 = −ω[1], Ω[2][1] = θ12 = ω[0].
    const w = axis.data;
    const b = new BivectorN(3);
    b.set(0, 1, w[2]! * angle);
    b.set(0, 2, -w[1]! * angle);
    b.set(1, 2, w[0]! * angle);
    const r = expBivector(b);

    // Rodrigues: v' = v cosθ + (ω×v) sinθ + ω(ω·v)(1−cosθ)
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    for (let basis = 0; basis < 3; basis++) {
      const v = VecN.basis(3, basis);
      const cross = new VecN([
        w[1]! * v.data[2]! - w[2]! * v.data[1]!,
        w[2]! * v.data[0]! - w[0]! * v.data[2]!,
        w[0]! * v.data[1]! - w[1]! * v.data[0]!
      ]);
      const dot = axis.dot(v);
      const expected = new VecN([
        v.data[0]! * c + cross.data[0]! * s + w[0]! * dot * (1 - c),
        v.data[1]! * c + cross.data[1]! * s + w[1]! * dot * (1 - c),
        v.data[2]! * c + cross.data[2]! * s + w[2]! * dot * (1 - c)
      ]);
      expect(r.applyTo(v).equalsApprox(expected, 1e-12)).toBe(true);
    }
  });

  it('always lands on the rotation manifold, even for large bivectors', () => {
    for (let trial = 0; trial < 20; trial++) {
      const r = expBivector(randomBivector(5, 10));
      expect(r.orthogonalityError()).toBeLessThan(1e-13);
    }
  });
});

describe('Rotor4', () => {
  it('all six plane rotors match rotationInPlane', () => {
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        for (const angle of [0.4, -2.1, Math.PI / 2]) {
          expectMatricesClose(
            Rotor4.fromPlane(i, j, angle).toMatrix(),
            MatN.rotationInPlane(4, i, j, angle)
          );
        }
      }
    }
  });

  it('fromBivector matches expBivector for random bivectors', () => {
    for (let trial = 0; trial < 25; trial++) {
      const b = randomBivector(4);
      expectMatricesClose(Rotor4.fromBivector(b).toMatrix(), expBivector(b), 10);
    }
  });

  it('rotor composition matches matrix composition', () => {
    const r1 = Rotor4.fromBivector(randomBivector(4));
    const r2 = Rotor4.fromBivector(randomBivector(4));
    expectMatricesClose(r1.multiply(r2).toMatrix(), r1.toMatrix().multiply(r2.toMatrix()), 11);
  });

  it('fromPlanes matches rotationFromPlanes', () => {
    const planes = [
      { i: 0, j: 3, angle: 0.6 },
      { i: 1, j: 2, angle: -1.2 },
      { i: 0, j: 1, angle: 2.9 }
    ];
    expectMatricesClose(Rotor4.fromPlanes(planes).toMatrix(), rotationFromPlanes(4, planes));
  });

  it('applyToPoint and applyToPositions match the matrix action', () => {
    const rotor = Rotor4.fromBivector(randomBivector(4));
    const matrix = rotor.toMatrix();
    const count = 9;
    const src = new Float64Array(count * 4).map(() => Math.random() * 4 - 2);
    const viaRotor = new Float64Array(count * 4);
    const viaMatrix = new Float64Array(count * 4);
    rotor.applyToPositions(src, viaRotor, count);
    matrix.applyToPositions(src, viaMatrix, count);
    for (let k = 0; k < src.length; k++) {
      expect(viaRotor[k]!).toBeCloseTo(viaMatrix[k]!, 11);
    }
    const p = new VecN(src.subarray(0, 4));
    expect(rotor.applyToPoint(p).equalsApprox(matrix.applyTo(p), 1e-11)).toBe(true);
  });

  it('long composition chains stay unit after normalize()', () => {
    let r = Rotor4.identity();
    const step = Rotor4.fromPlanes([
      { i: 0, j: 3, angle: 1e-3 },
      { i: 1, j: 2, angle: 1.3e-3 }
    ]);
    for (let k = 0; k < 20000; k++) r = step.multiply(r);
    r.normalize();
    expect(r.toMatrix().orthogonalityError()).toBeLessThan(1e-12);
  });

  it('identity rotor is a no-op', () => {
    const p = new VecN([1.5, -2.5, 3.5, 0.5]);
    expect(Rotor4.identity().applyToPoint(p).equalsApprox(p, 1e-15)).toBe(true);
  });
});

describe('Rotor4.slerp', () => {
  it('hits both endpoints exactly', () => {
    const a = Rotor4.fromBivector(randomBivector(4, 1));
    const b = Rotor4.fromBivector(randomBivector(4, 1));
    expectMatricesClose(Rotor4.slerp(a, b, 0).toMatrix(), a.toMatrix());
    expectMatricesClose(Rotor4.slerp(a, b, 1).toMatrix(), b.toMatrix());
  });

  it('follows the geodesic: slerp(I, exp(B), t) = exp(t·B)', async () => {
    const { expBivector: exp } = await import('@holotope/core');
    for (let trial = 0; trial < 10; trial++) {
      // Keep the left/right generator norms below π/2 (coefficients ≤ 0.8
      // give |u| ≤ 0.8√3 ≈ 1.39): past that, the quaternion shortest-arc
      // flip makes slerp take a genuinely shorter path than exp(t·B), and
      // the identity only holds on the short arc.
      const b = randomBivector(4, 0.8);
      const target = Rotor4.fromBivector(b);
      for (const t of [0.2, 0.5, 0.77]) {
        expectMatricesClose(
          Rotor4.slerp(Rotor4.identity(), target, t).toMatrix(),
          exp(b.clone().scale(t)),
          9
        );
      }
    }
  });

  it('interpolates single-plane rotations linearly in angle', () => {
    const a = Rotor4.fromPlane(0, 3, 0.4);
    const b = Rotor4.fromPlane(0, 3, 1.6);
    expectMatricesClose(
      Rotor4.slerp(a, b, 0.5).toMatrix(),
      MatN.rotationInPlane(4, 0, 3, 1.0),
      10
    );
  });

  it('hits the endpoints when only one factor quaternion crosses the cover', () => {
    // θ01 = θ23 = 3.3 splits isoclinically into left angle 0 and right
    // angle 3.3 > π: the right factor's dot against identity is negative
    // while the left's is +1. A per-quaternion shortest-arc flip would
    // negate only the right factor — which is −R, a different SO(4)
    // element — so slerp(a, b, 1) would come back sign-flipped. The cover
    // choice must be made once for the pair.
    const a = Rotor4.identity();
    const b = Rotor4.fromPlanes([
      { i: 0, j: 1, angle: 3.3 },
      { i: 2, j: 3, angle: 3.3 }
    ]);
    expectMatricesClose(Rotor4.slerp(a, b, 0).toMatrix(), a.toMatrix());
    expectMatricesClose(Rotor4.slerp(a, b, 1).toMatrix(), b.toMatrix());
    for (let k = 0; k <= 10; k++) {
      expect(Rotor4.slerp(a, b, k / 10).toMatrix().orthogonalityError()).toBeLessThan(1e-12);
    }
  });

  it('stays on the rotation manifold across the whole parameter range', () => {
    const a = Rotor4.fromBivector(randomBivector(4, 2));
    const b = Rotor4.fromBivector(randomBivector(4, 2));
    for (let k = 0; k <= 20; k++) {
      const r = Rotor4.slerp(a, b, k / 20);
      expect(r.toMatrix().orthogonalityError()).toBeLessThan(1e-12);
    }
  });

  it('is stable for nearly identical rotors (nlerp branch)', () => {
    const a = Rotor4.fromPlane(1, 2, 0.5);
    const b = Rotor4.fromPlane(1, 2, 0.5 + 1e-7);
    const mid = Rotor4.slerp(a, b, 0.5);
    expectMatricesClose(mid.toMatrix(), a.toMatrix(), 6);
    expect(mid.toMatrix().orthogonalityError()).toBeLessThan(1e-12);
  });
});
