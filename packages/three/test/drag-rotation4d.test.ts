import { describe, expect, it } from 'vitest';
import { Rotor4 } from '@holotope/core';
import { DragRotation4D } from '@holotope/three';

function expectRotorsClose(a: Rotor4, b: Rotor4, digits = 12): void {
  const ma = a.toMatrix();
  const mb = b.toMatrix();
  for (let k = 0; k < 16; k++) expect(ma.data[k]!).toBeCloseTo(mb.data[k]!, digits);
}

describe('DragRotation4D', () => {
  it('starts at identity and resets to identity', () => {
    const drag = new DragRotation4D();
    expectRotorsClose(drag.rotor, Rotor4.identity());
    drag.applyDrag(100, -40);
    drag.reset();
    expectRotorsClose(drag.rotor, Rotor4.identity());
  });

  it('horizontal drag rotates in the horizontal plane only', () => {
    const drag = new DragRotation4D({ speed: 0.01 });
    drag.applyDrag(50, 0); // 0.5 rad in xw
    expectRotorsClose(drag.rotor, Rotor4.fromPlane(0, 3, 0.5));
  });

  it('vertical drag rotates in the vertical plane only', () => {
    const drag = new DragRotation4D({ speed: 0.01 });
    drag.applyDrag(0, -30); // −0.3 rad in yw
    expectRotorsClose(drag.rotor, Rotor4.fromPlane(1, 3, -0.3));
  });

  it('respects custom planes', () => {
    const drag = new DragRotation4D({
      horizontalPlane: [2, 3],
      verticalPlane: [0, 1],
      speed: 0.02
    });
    drag.applyDrag(10, 0);
    expectRotorsClose(drag.rotor, Rotor4.fromPlane(2, 3, 0.2));
  });

  it('sequential drags accumulate as composition, staying unit', () => {
    const drag = new DragRotation4D({ speed: 0.01 });
    drag.applyDrag(20, 10);
    drag.applyDrag(-5, 35);
    const expected = Rotor4.fromPlanes([
      { i: 0, j: 3, angle: -0.05 },
      { i: 1, j: 3, angle: 0.35 }
    ]).multiply(
      Rotor4.fromPlanes([
        { i: 0, j: 3, angle: 0.2 },
        { i: 1, j: 3, angle: 0.1 }
      ])
    );
    expectRotorsClose(drag.rotor, expected, 11);
    expect(drag.rotor.toMatrix().orthogonalityError()).toBeLessThan(1e-13);
  });

  it('stays on the rotation manifold across thousands of small drags', () => {
    const drag = new DragRotation4D();
    for (let k = 0; k < 5000; k++) drag.applyDrag(Math.random() * 4 - 2, Math.random() * 4 - 2);
    expect(drag.rotor.toMatrix().orthogonalityError()).toBeLessThan(1e-13);
  });
});
