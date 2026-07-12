import { describe, expect, it } from 'vitest';
import { Matrix4, Object3D, Vector3 } from 'three';
import { MatN, ObjectN, SceneN, TransformN, VecN, rotationMatrix } from '@holotope/core';

/**
 * n=3 reduction: a 4D hierarchy whose rotations act only on the spatial
 * axes (planes among x, y, z) and whose translations have zero w must
 * compose exactly as a three.js Object3D hierarchy — the scene graph
 * inherits the kernel's core correctness contract.
 */
describe('ObjectN reduces to three.js Object3D at n=3', () => {
  const spatialTransform = (i: number, j: number, angle: number, t: [number, number, number]) =>
    new TransformN(4, MatN.rotationInPlane(4, i, j, angle), new VecN([...t, 0]));

  const toObject3D = (transform: TransformN): Object3D => {
    const m = rotationMatrix(transform.rotation).data;
    const object = new Object3D();
    // Column-major Matrix4 from the spatial 3×3 block of the row-major MatN.
    const mat = new Matrix4().set(
      m[0]!, m[1]!, m[2]!, transform.position.data[0]!,
      m[4]!, m[5]!, m[6]!, transform.position.data[1]!,
      m[8]!, m[9]!, m[10]!, transform.position.data[2]!,
      0, 0, 0, 1
    );
    mat.decompose(object.position, object.quaternion, object.scale);
    return object;
  };

  it('three-deep hierarchy world transforms coincide', () => {
    const locals = [
      spatialTransform(0, 1, 0.7, [1, -2, 0.5]),
      spatialTransform(1, 2, -0.4, [0, 3, -1]),
      spatialTransform(0, 2, 1.2, [2, 0.5, 0])
    ];

    const scene = new SceneN(4);
    const nodes = locals.map((local) => new ObjectN(4, local));
    scene.add(nodes[0]!);
    nodes[0]!.add(nodes[1]!);
    nodes[1]!.add(nodes[2]!);
    scene.updateWorld();

    const threeNodes = locals.map(toObject3D);
    threeNodes[0]!.add(threeNodes[1]!);
    threeNodes[1]!.add(threeNodes[2]!);
    threeNodes[0]!.updateMatrixWorld(true);

    for (const [node, threeNode] of nodes.map((n, i) => [n, threeNodes[i]!] as const)) {
      for (let trial = 0; trial < 5; trial++) {
        const p = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1];
        const ours = node.world.applyToPoint(new VecN([...p, 0]));
        expect(ours.data[3]).toBeCloseTo(0, 12); // stays spatial
        const theirs = new Vector3(...p).applyMatrix4(threeNode.matrixWorld);
        expect(ours.data[0]).toBeCloseTo(theirs.x, 11);
        expect(ours.data[1]).toBeCloseTo(theirs.y, 11);
        expect(ours.data[2]).toBeCloseTo(theirs.z, 11);
      }
    }
  });
});
