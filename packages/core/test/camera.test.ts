import { describe, expect, it } from 'vitest';
import { CameraN, MatN, Rotor4, TransformN, VecN } from '@holotope/core';

describe('MatN.determinant', () => {
  it('computes known determinants', () => {
    expect(MatN.identity(4).determinant()).toBeCloseTo(1, 12);
    expect(MatN.rotationInPlane(4, 1, 3, 2.3).determinant()).toBeCloseTo(1, 12);
    const reflection = MatN.identity(4);
    reflection.set(3, 3, -1);
    expect(reflection.determinant()).toBeCloseTo(-1, 12);
    const singular = new MatN(3, [1, 2, 3, 2, 4, 6, 0, 1, 1]);
    expect(singular.determinant()).toBeCloseTo(0, 12);
  });
});

describe('TransformN.inverse', () => {
  it('matrix backend: inverse composes to identity', () => {
    const t = new TransformN(4, MatN.rotationInPlane(4, 0, 3, 1.2), new VecN([1, -2, 3, 4]));
    const roundTrip = t.inverse().compose(t);
    const p = new VecN([0.4, -0.6, 1.1, -1.7]);
    expect(roundTrip.applyToPoint(p).equalsApprox(p, 1e-12)).toBe(true);
  });

  it('rotor backend: inverse composes to identity and stays a rotor', () => {
    const t = new TransformN(
      4,
      Rotor4.fromPlanes([
        { i: 0, j: 3, angle: 0.7 },
        { i: 1, j: 2, angle: -1.9 }
      ]),
      new VecN([-1, 0.5, 2, -3])
    );
    const inverse = t.inverse();
    expect(inverse.rotation).toBeInstanceOf(Rotor4);
    const p = new VecN([2, -1, 0.25, 1.5]);
    expect(inverse.compose(t).applyToPoint(p).equalsApprox(p, 1e-12)).toBe(true);
    expect(t.compose(inverse).applyToPoint(p).equalsApprox(p, 1e-12)).toBe(true);
  });
});

describe('CameraN', () => {
  it('looks down its negative last axis, matching the three.js convention at n=3', () => {
    // Camera at +5z looking at origin: backward column = +z, so view maps
    // the target to (0, 0, −5) — exactly three.js camera space.
    const camera = new CameraN(3, new VecN([0, 0, 5]));
    camera.lookAt(new VecN(3));
    const viewTarget = camera.viewTransform().applyToPoint(new VecN(3));
    expect(viewTarget.equalsApprox(new VecN([0, 0, -5]), 1e-12)).toBe(true);
  });

  it('4D: view space puts the target on the negative w axis at its distance', () => {
    const position = new VecN([3, -1, 2, 4]);
    const target = new VecN([0, 1, 0, -2]);
    const camera = new CameraN(4, position).lookAt(target);
    const view = camera.viewTransform();

    const viewPosition = view.applyToPoint(position);
    expect(viewPosition.equalsApprox(new VecN(4), 1e-12)).toBe(true);

    const distance = position.distanceTo(target);
    const viewTarget = view.applyToPoint(target);
    expect(viewTarget.equalsApprox(new VecN([0, 0, 0, -distance]), 1e-12)).toBe(true);
  });

  it('produces an orthonormal, orientation-preserving frame from any pose', () => {
    let state = 0x7f4a7c15;
    const nextCoordinate = (): number => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 0x100000000 * 6 - 3;
    };
    const positions = [
      // Near-standard-axis directions exercise the cancellation branch that
      // a nondeterministic test used to encounter only occasionally.
      new VecN([3, 1e-10, -2e-10, 3e-10]),
      new VecN([-2e-10, -2.5, 3e-10, -1e-10]),
      new VecN([1e-10, -2e-10, 2, 4e-10]),
      new VecN([-3e-10, 2e-10, -1e-10, -2.75])
    ];
    for (let trial = 0; trial < 32; trial++) {
      positions.push(new VecN([
        nextCoordinate(),
        nextCoordinate(),
        nextCoordinate(),
        nextCoordinate()
      ]));
    }

    for (const position of positions) {
      const camera = new CameraN(4, position);
      camera.lookAt(new VecN([0, 0, 0, 0]));
      expect(camera.rotation.orthogonalityError()).toBeLessThan(1e-12);
      expect(camera.rotation.determinant()).toBeCloseTo(1, 10);
    }
  });

  it('successive lookAt calls change the frame continuously', () => {
    const camera = new CameraN(4, new VecN([0, 0, 0, 6]));
    camera.lookAt(new VecN(4));
    const before = camera.rotation.clone();
    camera.lookAt(new VecN([0.01, -0.02, 0.015, 0]));
    let maxDelta = 0;
    for (let k = 0; k < 16; k++) {
      maxDelta = Math.max(maxDelta, Math.abs(camera.rotation.data[k]! - before.data[k]!));
    }
    expect(maxDelta).toBeLessThan(0.02); // small target move → small frame change
  });

  it('rejects a target at the camera position', () => {
    const camera = new CameraN(4, new VecN([1, 1, 1, 1]));
    expect(() => camera.lookAt(new VecN([1, 1, 1, 1]))).toThrow(/coincides/);
  });
});
