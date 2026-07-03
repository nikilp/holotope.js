/**
 * The n=3 invariant: Holotope math specialized to three dimensions must
 * reproduce ordinary three.js behavior. This is the project's core
 * correctness contract — if these tests fail, the N-D generalization has
 * drifted from the semantics users already trust.
 */
import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import {
  MatN,
  OrthographicProjection,
  PerspectiveProjection,
  TransformN,
  VecN,
  createHypercube,
  rotationFromPlanes
} from '@holotope/core';
import { ProjectedEdges3D } from '@holotope/three';

const randomCoord = () => Math.random() * 4 - 2;

describe('n=3 invariant: rotations match three.js', () => {
  it.each([
    // Plane (i, j) rotating axis i toward axis j <-> three.js axis rotation.
    // xy-plane rotation = rotation about z, etc. (right-handed convention)
    ['xy plane = rotation about Z', 0, 1, (t: number) => new Matrix4().makeRotationZ(t)],
    ['zx plane = rotation about Y', 2, 0, (t: number) => new Matrix4().makeRotationY(t)],
    ['yz plane = rotation about X', 1, 2, (t: number) => new Matrix4().makeRotationX(t)]
  ])('%s', (_label, i, j, makeThree) => {
    for (const angle of [0.3, -1.2, Math.PI / 2, 2.9]) {
      const ours = MatN.rotationInPlane(3, i, j, angle);
      const theirs = makeThree(angle);
      for (let k = 0; k < 10; k++) {
        const p = [randomCoord(), randomCoord(), randomCoord()] as const;
        const v = ours.applyTo(new VecN(p));
        const tv = new Vector3(...p).applyMatrix4(theirs);
        expect(v.data[0]).toBeCloseTo(tv.x, 12);
        expect(v.data[1]).toBeCloseTo(tv.y, 12);
        expect(v.data[2]).toBeCloseTo(tv.z, 12);
      }
    }
  });

  it('composed plane rotations match composed three.js matrices', () => {
    const ours = rotationFromPlanes(3, [
      { i: 0, j: 1, angle: 0.7 }, // about Z first
      { i: 1, j: 2, angle: -0.4 } // then about X
    ]);
    const theirs = new Matrix4().makeRotationX(-0.4).multiply(new Matrix4().makeRotationZ(0.7));
    for (let k = 0; k < 10; k++) {
      const p = [randomCoord(), randomCoord(), randomCoord()] as const;
      const v = ours.applyTo(new VecN(p));
      const tv = new Vector3(...p).applyMatrix4(theirs);
      expect(v.data[0]).toBeCloseTo(tv.x, 12);
      expect(v.data[1]).toBeCloseTo(tv.y, 12);
      expect(v.data[2]).toBeCloseTo(tv.z, 12);
    }
  });

  it('TransformN matches three.js rotate-then-translate', () => {
    const ours = new TransformN(3, MatN.rotationInPlane(3, 0, 1, 1.1), new VecN([5, -6, 7]));
    const theirs = new Matrix4()
      .makeRotationZ(1.1)
      .premultiply(new Matrix4().makeTranslation(5, -6, 7));
    for (let k = 0; k < 10; k++) {
      const p = [randomCoord(), randomCoord(), randomCoord()] as const;
      const v = ours.applyToPoint(new VecN(p));
      const tv = new Vector3(...p).applyMatrix4(theirs);
      expect(v.data[0]).toBeCloseTo(tv.x, 12);
      expect(v.data[1]).toBeCloseTo(tv.y, 12);
      expect(v.data[2]).toBeCloseTo(tv.z, 12);
    }
  });
});

describe('ProjectedEdges3D', () => {
  it('renders a 3D cube unchanged through the n=3 identity projection', () => {
    const cube = createHypercube({ dim: 3, size: 2 });
    const edges = new ProjectedEdges3D(cube, new PerspectiveProjection({ fromDim: 3 }));
    const rendered = edges.geometry.getAttribute('position');
    expect(rendered.count).toBe(8);
    for (let v = 0; v < 8; v++) {
      expect(rendered.getX(v)).toBeCloseTo(cube.positions[v * 3]!, 6);
      expect(rendered.getY(v)).toBeCloseTo(cube.positions[v * 3 + 1]!, 6);
      expect(rendered.getZ(v)).toBeCloseTo(cube.positions[v * 3 + 2]!, 6);
    }
    edges.dispose();
  });

  it('projects a tesseract into two nested cubes under orthographic projection', () => {
    const tesseract = createHypercube({ dim: 4, size: 2 });
    const edges = new ProjectedEdges3D(tesseract, new OrthographicProjection({ fromDim: 4 }));
    const rendered = edges.geometry.getAttribute('position');
    expect(rendered.count).toBe(16);
    // Orthographic projection of the tesseract collapses w: each 3D corner
    // position (±1, ±1, ±1) appears exactly twice (w = ±1 layers).
    for (let v = 0; v < 16; v++) {
      expect(Math.abs(rendered.getX(v))).toBeCloseTo(1, 6);
      expect(Math.abs(rendered.getY(v))).toBeCloseTo(1, 6);
      expect(Math.abs(rendered.getZ(v))).toBeCloseTo(1, 6);
    }
    edges.dispose();
  });

  it('update(transform) applies a 4D rotation before projection', () => {
    const tesseract = createHypercube({ dim: 4, size: 2 });
    const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
    const edges = new ProjectedEdges3D(tesseract, projection);

    const before = Array.from(edges.geometry.getAttribute('position').array);
    const transform = new TransformN(4, MatN.rotationInPlane(4, 0, 3, 0.5));
    edges.update(transform);
    const after = Array.from(edges.geometry.getAttribute('position').array);

    expect(after).not.toEqual(before);
    // Spot-check one vertex end-to-end in Float64.
    const world = transform.applyToPoint(new VecN(tesseract.getPosition(0)));
    const expected = projection.projectPoint(world.toArray());
    expect(after[0]).toBeCloseTo(expected[0], 5);
    expect(after[1]).toBeCloseTo(expected[1], 5);
    expect(after[2]).toBeCloseTo(expected[2], 5);
    edges.dispose();
  });

  it('rejects dimension mismatches between complex and projection', () => {
    const tesseract = createHypercube({ dim: 4 });
    expect(
      () => new ProjectedEdges3D(tesseract, new PerspectiveProjection({ fromDim: 5 }))
    ).toThrow(/ambientDim/);
  });
});
