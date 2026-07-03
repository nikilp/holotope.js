import { describe, expect, it } from 'vitest';
import { MatN, TransformN, VecN, rotationFromPlanes } from '@holotope/core';

describe('VecN', () => {
  it('performs basic arithmetic', () => {
    const a = new VecN([1, 2, 3, 4]);
    const b = new VecN([4, 3, 2, 1]);
    expect(a.clone().add(b).toArray()).toEqual([5, 5, 5, 5]);
    expect(a.clone().sub(b).toArray()).toEqual([-3, -1, 1, 3]);
    expect(a.dot(b)).toBe(4 + 6 + 6 + 4);
    expect(new VecN([3, 0, 4, 0, 0]).length()).toBe(5);
  });

  it('rejects dimension mismatches', () => {
    expect(() => new VecN(3).add(new VecN(4))).toThrow(/dimension mismatch/);
  });

  it('normalizes and rejects zero vectors', () => {
    expect(new VecN([0, 5, 0, 0]).normalize().toArray()).toEqual([0, 1, 0, 0]);
    expect(() => new VecN(4).normalize()).toThrow();
  });
});

describe('MatN', () => {
  it('multiplies against identity', () => {
    const r = MatN.rotationInPlane(5, 1, 3, 0.7);
    expect(r.multiply(MatN.identity(5)).data).toEqual(r.data);
    expect(MatN.identity(5).multiply(r).data).toEqual(r.data);
  });

  it('rotates axis i toward axis j', () => {
    // Quarter turn in the (0,1) plane sends e0 to e1.
    const r = MatN.rotationInPlane(4, 0, 1, Math.PI / 2);
    const v = r.applyTo(VecN.basis(4, 0));
    expect(v.equalsApprox(VecN.basis(4, 1), 1e-15)).toBe(true);
  });

  it('leaves off-plane axes untouched', () => {
    const r = MatN.rotationInPlane(6, 0, 3, 1.1);
    for (const axis of [1, 2, 4, 5]) {
      const v = r.applyTo(VecN.basis(6, axis));
      expect(v.equalsApprox(VecN.basis(6, axis), 1e-15)).toBe(true);
    }
  });

  it('plane rotations are orthonormal and compositions stay orthonormal', () => {
    const r = rotationFromPlanes(4, [
      { i: 0, j: 3, angle: 0.6 },
      { i: 1, j: 2, angle: -1.2 },
      { i: 0, j: 1, angle: 2.9 }
    ]);
    expect(r.orthogonalityError()).toBeLessThan(1e-14);
  });

  it('preserves vector lengths under rotation', () => {
    const r = rotationFromPlanes(5, [
      { i: 0, j: 4, angle: 0.3 },
      { i: 2, j: 3, angle: 1.7 }
    ]);
    const v = new VecN([1, -2, 3, -4, 5]);
    expect(r.applyTo(v).length()).toBeCloseTo(v.length(), 12);
  });

  it('orthonormalizeInPlace repairs accumulated drift', () => {
    // Accumulate many small rotations without correction.
    let r = MatN.identity(4);
    const step = MatN.rotationInPlane(4, 0, 3, 1e-3).multiply(
      MatN.rotationInPlane(4, 1, 2, 1.3e-3)
    );
    for (let k = 0; k < 20000; k++) r = step.multiply(r);
    r.orthonormalizeInPlace();
    expect(r.orthogonalityError()).toBeLessThan(1e-13);
  });

  it('batch applyToPositions matches per-vector applyTo', () => {
    const r = rotationFromPlanes(4, [{ i: 0, j: 3, angle: 0.9 }]);
    const count = 7;
    const src = new Float64Array(count * 4).map(() => Math.random() * 2 - 1);
    const dst = new Float64Array(count * 4);
    r.applyToPositions(src, dst, count);
    for (let p = 0; p < count; p++) {
      const v = r.applyTo(new VecN(src.subarray(p * 4, p * 4 + 4)));
      for (let c = 0; c < 4; c++) expect(dst[p * 4 + c]).toBeCloseTo(v.data[c]!, 14);
    }
  });
});

describe('TransformN', () => {
  it('applies rotation then translation', () => {
    const t = new TransformN(
      4,
      MatN.rotationInPlane(4, 0, 1, Math.PI / 2),
      new VecN([10, 0, 0, 0])
    );
    const p = t.applyToPoint(VecN.basis(4, 0));
    expect(p.equalsApprox(new VecN([10, 1, 0, 0]), 1e-14)).toBe(true);
  });

  it('compose matches sequential application', () => {
    const parent = new TransformN(4, MatN.rotationInPlane(4, 1, 3, 0.4), new VecN([1, 2, 3, 4]));
    const child = new TransformN(4, MatN.rotationInPlane(4, 0, 2, -0.8), new VecN([-1, 0, 1, 0]));
    const p = new VecN([0.5, -0.5, 0.25, 1]);
    const sequential = parent.applyToPoint(child.applyToPoint(p));
    const composed = parent.compose(child).applyToPoint(p);
    expect(composed.equalsApprox(sequential, 1e-13)).toBe(true);
  });
});

describe('TransformN with Rotor4 backend', () => {
  it('rotor-backed transform matches the equivalent matrix-backed one', async () => {
    const { Rotor4, rotationFromPlanes: rfp } = await import('@holotope/core');
    const planes = [
      { i: 0, j: 3, angle: 0.7 },
      { i: 1, j: 2, angle: -0.4 }
    ];
    const viaRotor = new TransformN(4, Rotor4.fromPlanes(planes), new VecN([1, 2, 3, 4]));
    const viaMatrix = new TransformN(4, rfp(4, planes), new VecN([1, 2, 3, 4]));
    const p = new VecN([0.5, -1.5, 2.5, -0.5]);
    expect(viaRotor.applyToPoint(p).equalsApprox(viaMatrix.applyToPoint(p), 1e-12)).toBe(true);

    const count = 5;
    const src = new Float64Array(count * 4).map(() => Math.random() * 2 - 1);
    const a = new Float64Array(count * 4);
    const b = new Float64Array(count * 4);
    viaRotor.applyToPositions(src, a, count);
    viaMatrix.applyToPositions(src, b, count);
    for (let k = 0; k < src.length; k++) expect(a[k]!).toBeCloseTo(b[k]!, 12);
  });

  it('composes rotor+rotor, matrix+matrix, and mixed identically', async () => {
    const { Rotor4, rotationMatrix } = await import('@holotope/core');
    const r1 = Rotor4.fromPlane(0, 3, 0.9);
    const r2 = Rotor4.fromPlane(1, 2, -1.1);
    const t1r = new TransformN(4, r1, new VecN([1, 0, -1, 2]));
    const t2r = new TransformN(4, r2, new VecN([0, 3, 0, -2]));
    const t1m = new TransformN(4, r1.toMatrix(), t1r.position.clone());
    const t2m = new TransformN(4, r2.toMatrix(), t2r.position.clone());

    const p = new VecN([0.3, 0.7, -0.9, 1.3]);
    const expected = t1m.compose(t2m).applyToPoint(p);
    for (const composed of [t1r.compose(t2r), t1r.compose(t2m), t1m.compose(t2r)]) {
      expect(composed.applyToPoint(p).equalsApprox(expected, 1e-12)).toBe(true);
    }
    // rotor+rotor composition stays on the rotor fast path
    expect(rotationMatrix(t1r.compose(t2r).rotation).orthogonalityError()).toBeLessThan(1e-13);
  });

  it('rejects a Rotor4 rotation for non-4D transforms', async () => {
    const { Rotor4 } = await import('@holotope/core');
    expect(() => new TransformN(5, Rotor4.identity())).toThrow(/dimension mismatch/);
  });
});
