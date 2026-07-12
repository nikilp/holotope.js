import { describe, expect, it } from 'vitest';
import {
  MatN,
  Rotor4,
  Rotor4Track,
  VecN,
  constrainUp,
  doubleSpin,
  isoclinicSpin,
  spin
} from '@holotope/core';

function expectRotorsEqual(a: Rotor4, b: Rotor4, digits = 10): void {
  // Compare actions, not factor signs: (l, r) and (−l, −r) coincide.
  const ma = a.toMatrix().data;
  const mb = b.toMatrix().data;
  for (let k = 0; k < 16; k++) expect(ma[k]).toBeCloseTo(mb[k]!, digits);
}

const KEYS = [
  Rotor4.identity(),
  Rotor4.fromPlanes([
    { i: 0, j: 3, angle: 1.1 },
    { i: 1, j: 2, angle: -0.6 }
  ]),
  Rotor4.fromPlanes([
    { i: 0, j: 1, angle: 2.0 },
    { i: 2, j: 3, angle: 1.4 }
  ]),
  Rotor4.fromPlanes([{ i: 1, j: 3, angle: -1.8 }])
];

describe('Rotor4Track', () => {
  it.each(['step', 'linear', 'cubic'] as const)('%s sampling hits every key exactly', (mode) => {
    const track = new Rotor4Track([0, 1, 2.5, 4], KEYS, mode);
    for (const [t, key] of [[0, 0], [1, 1], [2.5, 2], [4, 3]] as const) {
      expectRotorsEqual(track.sample(t), KEYS[key]!);
    }
    // Clamping beyond the range.
    expectRotorsEqual(track.sample(-5), KEYS[0]!);
    expectRotorsEqual(track.sample(99), KEYS[3]!);
  });

  it('is cover-invariant: jointly negating a key changes nothing', () => {
    const flipped = KEYS.map((r, i) => {
      if (i !== 2) return r;
      const clone = r.clone();
      for (let k = 0; k < 4; k++) {
        clone.left[k]! *= -1;
        clone.right[k]! *= -1;
      }
      return clone;
    });
    const a = new Rotor4Track([0, 1, 2.5, 4], KEYS, 'cubic');
    const b = new Rotor4Track([0, 1, 2.5, 4], flipped, 'cubic');
    for (let t = 0; t <= 4; t += 0.17) expectRotorsEqual(a.sample(t), b.sample(t), 12);
  });

  it('a single-factor sign flip cannot corrupt sampling (central-inversion immunity)', () => {
    // Flipping one factor of a key encodes the central inversion −Id, a
    // different SO(4) element. The track must interpolate to the key AS
    // GIVEN — i.e. through −Id at that key — never silently "repair" it
    // into the unflipped rotation, and never emit non-rotations.
    const flipped = KEYS.map((r, i) => {
      if (i !== 1) return r;
      const clone = r.clone();
      for (let k = 0; k < 4; k++) clone.left[k]! *= -1;
      return clone;
    });
    const track = new Rotor4Track([0, 1, 2.5, 4], flipped, 'linear');
    expectRotorsEqual(track.sample(1), flipped[1]!, 12); // key honored exactly
    for (let t = 0; t <= 4; t += 0.13) {
      expect(track.sample(t).toMatrix().orthogonalityError()).toBeLessThan(1e-12);
    }
  });

  it('linear sampling of a single-plane pair is linear in angle', () => {
    const track = new Rotor4Track([0, 1], [Rotor4.fromPlane(0, 3, 0.2), Rotor4.fromPlane(0, 3, 1.8)]);
    for (const t of [0.25, 0.5, 0.75]) {
      expectRotorsEqual(track.sample(t), Rotor4.fromPlane(0, 3, 0.2 + 1.6 * t), 10);
    }
  });

  it('cubic sampling is C¹: finite-difference velocity is continuous across keys', () => {
    const track = new Rotor4Track([0, 1, 2, 3], KEYS, 'cubic');
    const h = 1e-5;
    for (const tk of [1, 2]) {
      // Angular velocity estimate on each side of the key via the
      // matrix log of R(t)⁻¹R(t+h) ≈ ω h, compared through the frame.
      const velocity = (t0: number, t1: number): Float64Array => {
        const a = track.sample(t0).toMatrix();
        const b = track.sample(t1).toMatrix();
        const rel = a.transpose().multiply(b).data;
        // Extract the 6 plane components of the skew part / h.
        const out = new Float64Array(6);
        let k = 0;
        for (let i = 0; i < 4; i++) {
          for (let j = i + 1; j < 4; j++) {
            out[k++] = (rel[i * 4 + j]! - rel[j * 4 + i]!) / (2 * (t1 - t0));
          }
        }
        return out;
      };
      const before = velocity(tk - 2 * h, tk - h);
      const after = velocity(tk + h, tk + 2 * h);
      for (let k = 0; k < 6; k++) expect(after[k]).toBeCloseTo(before[k]!, 3);
    }
  });

  it('subdivides segments whose factor arcs approach π (log stays conditioned)', async () => {
    // An isoclinic key whose driven factor turns by nearly 2π: its
    // quaternion sits near −1, so after joint neighborhooding one
    // factor arc is ≈ 0 while the other is ≈ π — the near-antipodal
    // configuration that must trigger midpoint insertion.
    const { BivectorN } = await import('@holotope/core');
    const a = Math.PI - 0.05;
    const nearAntipodal = Rotor4.fromBivector(new BivectorN(4).set(0, 1, a).set(2, 3, a));
    const track = new Rotor4Track([0, 1], [Rotor4.identity(), nearAntipodal], 'linear');
    expect(track.keyCount).toBeGreaterThan(2);
    for (let t = 0; t <= 1; t += 0.1) {
      expect(track.sample(t).toMatrix().orthogonalityError()).toBeLessThan(1e-12);
    }
  });

  it('rejects non-increasing times and mismatched lengths', () => {
    expect(() => new Rotor4Track([0, 0], [Rotor4.identity(), Rotor4.identity()])).toThrow(
      /increasing/
    );
    expect(() => new Rotor4Track([0], [Rotor4.identity(), Rotor4.identity()])).toThrow(/keys/);
  });
});

describe('procedural motion', () => {
  it('spin matches rotationInPlane at every sampled time', () => {
    const motion = spin(0, 3, 0.7);
    for (const t of [0, 0.5, 2, 9]) {
      const expected = MatN.rotationInPlane(4, 0, 3, 0.7 * t).data;
      const actual = motion(t).toMatrix().data;
      for (let k = 0; k < 16; k++) expect(actual[k]).toBeCloseTo(expected[k]!, 10);
    }
  });

  it('doubleSpin equals the commuting product of its two spins', () => {
    const motion = doubleSpin([0, 1], 0.9, [2, 3], -0.4);
    for (const t of [0.3, 1.7]) {
      const expected = Rotor4.fromPlanes([
        { i: 0, j: 1, angle: 0.9 * t },
        { i: 2, j: 3, angle: -0.4 * t }
      ]);
      expectRotorsEqual(motion(t), expected, 10);
    }
    expect(() => doubleSpin([0, 1], 1, [1, 2], 1)).toThrow(/disjoint/);
  });

  it('isoclinic spins drive exactly one quaternion factor', () => {
    const left = isoclinicSpin(0.8, 'left')(1.3);
    const right = isoclinicSpin(0.8, 'right')(1.3);
    const identity = Rotor4.identity();
    // One factor moves, the other stays at identity (up to sign).
    const stays = (q: Float64Array): boolean =>
      Math.abs(Math.abs(q[3]!) - 1) < 1e-12;
    expect(stays(left.right) !== stays(left.left)).toBe(true);
    expect(stays(right.left) !== stays(right.right)).toBe(true);
    expect(stays(left.right) && stays(right.left)).toBe(true);
    void identity;
  });

  it('every point moves at equal speed under an isoclinic spin', () => {
    const motion = isoclinicSpin(1, 'left');
    const r = motion(0.4);
    for (let trial = 0; trial < 8; trial++) {
      const p = new VecN([0, 0, 0, 0].map(() => Math.random() * 2 - 1)).normalize();
      const moved = r.applyToPoint(p.clone());
      let dot = 0;
      for (let c = 0; c < 4; c++) dot += p.data[c]! * moved.data[c]!;
      // Displacement angle is the same for every unit point.
      expect(Math.acos(Math.max(-1, Math.min(1, dot)))).toBeCloseTo(0.4, 10);
    }
  });
});

describe('constrainUp', () => {
  it('the constrained rotor fixes the up axis and changes nothing when already fixed', () => {
    const up = new VecN([0, 1, 0, 0]);
    const wild = Rotor4.fromPlanes([
      { i: 0, j: 1, angle: 0.8 },
      { i: 1, j: 3, angle: -0.5 },
      { i: 2, j: 3, angle: 1.2 }
    ]);
    const constrained = constrainUp(wild, up);
    const image = constrained.applyToPoint(up.clone());
    // fromBivector's series exponential bounds the residual near 1e-9.
    for (let c = 0; c < 4; c++) expect(image.data[c]).toBeCloseTo(up.data[c]!, 7);

    // Idempotent: constraining an already-constrained rotor is identity.
    expectRotorsEqual(constrainUp(constrained, up), constrained, 7);

    // A rotor that already fixes up passes through unchanged.
    const horizontal = Rotor4.fromPlanes([
      { i: 0, j: 2, angle: 0.9 },
      { i: 0, j: 3, angle: 0.4 }
    ]);
    expectRotorsEqual(constrainUp(horizontal, up), horizontal, 7);
  });
});
