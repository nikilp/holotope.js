import { describe, expect, it } from 'vitest';
import { MatN, Rotor4, TransformN, VecN } from '@holotope/core';
import {
  HyperboxSupportShape4,
  hyperboxContactPatch4,
  type HyperboxContactPatch4
} from '../src/index.js';

function unitBox(position: ArrayLike<number>): HyperboxSupportShape4 {
  return new HyperboxSupportShape4(
    [1, 1, 1, 1],
    new TransformN(4, undefined, new VecN(position))
  );
}

function expectVectorClose(
  actual: VecN,
  expected: ArrayLike<number>,
  digits = 11
): void {
  for (let axis = 0; axis < actual.dim; axis++) {
    expect(actual.data[axis]!).toBeCloseTo(expected[axis]!, digits);
  }
}

function expectInsideResolvedBoxes(
  patch: HyperboxContactPatch4,
  boxA: HyperboxSupportShape4,
  boxB: HyperboxSupportShape4
): void {
  const centerA = boxA.center.add(patch.translationA);
  for (const vertex of patch.vertices) {
    expect(vertex.point.dot(patch.normal)).toBeCloseTo(patch.planeOffset, 9);
    for (const [box, center] of [[boxA, centerA], [boxB, boxB.center]] as const) {
      const local = vertex.point.clone().sub(center);
      box.worldAxes().forEach((axis, index) => {
        expect(Math.abs(axis.dot(local))).toBeLessThanOrEqual(
          box.halfExtents[index]! + 1e-8
        );
      });
    }
  }
}

describe('R4 hyperbox contact patches', () => {
  it('resolves an aligned overlap into its complete cubical 3D patch', () => {
    const boxA = unitBox([0, 0, 0, 0]);
    const boxB = unitBox([1.5, 0, 0, 0]);
    const result = hyperboxContactPatch4(boxA, boxB);
    const patch = result.patch!;

    expect(result.sat.status).toBe('overlapping');
    expect(patch.kind).toBe('polyhedron');
    expect(patch.intrinsicDim).toBe(3);
    expect(patch.penetrationDepth).toBeCloseTo(0.5, 13);
    expect(patch.alignmentShift).toBeCloseTo(0.5, 13);
    expectVectorClose(patch.translationA, [-0.5, 0, 0, 0], 13);
    expect(patch.planeOffset).toBeCloseTo(-0.5, 13);
    expect(patch.referenceBox).toBe('a');
    expect(patch.vertices).toHaveLength(8);
    expect(patch.solverPoints).toHaveLength(8);
    expect(patch.diagnostics).toMatchObject({
      constraints: 16,
      uniqueVertices: 8,
      solverPoints: 8
    });

    for (const vertex of patch.vertices) {
      expect(vertex.point.data[0]!).toBeCloseTo(0.5, 11);
      for (let axis = 1; axis < 4; axis++) {
        expect(Math.abs(vertex.point.data[axis]!)).toBeCloseTo(1, 11);
      }
      expect(vertex.featureA.positiveMask & 1).toBe(1);
      expect(vertex.featureB.negativeMask & 1).toBe(1);
    }
    expectInsideResolvedBoxes(patch, boxA, boxB);
  });

  it('retains the full point-to-polyhedron dimensionality ladder', () => {
    const cases = [
      { center: [2, 0, 0, 0], kind: 'polyhedron', dimension: 3, vertices: 8, mask: 0b0001 },
      { center: [2, 2, 0, 0], kind: 'polygon', dimension: 2, vertices: 4, mask: 0b0011 },
      { center: [2, 2, 2, 0], kind: 'segment', dimension: 1, vertices: 2, mask: 0b0111 },
      { center: [2, 2, 2, 2], kind: 'point', dimension: 0, vertices: 1, mask: 0b1111 }
    ] as const;
    const boxA = unitBox([0, 0, 0, 0]);

    for (const testCase of cases) {
      const boxB = unitBox(testCase.center);
      const result = hyperboxContactPatch4(boxA, boxB);
      const patch = result.patch!;
      expect(result.sat.status).toBe('touching');
      expect(patch.kind).toBe(testCase.kind);
      expect(patch.intrinsicDim).toBe(testCase.dimension);
      expect(patch.vertices).toHaveLength(testCase.vertices);
      for (const vertex of patch.vertices) {
        expect(vertex.featureA.positiveMask & testCase.mask).toBe(testCase.mask);
        expect(vertex.featureB.negativeMask & testCase.mask).toBe(testCase.mask);
      }
      expectInsideResolvedBoxes(patch, boxA, boxB);
    }
  });

  it('returns no patch for a separated pair', () => {
    const result = hyperboxContactPatch4(
      unitBox([0, 0, 0, 0]),
      unitBox([3, 0, 0, 0])
    );
    expect(result.sat.status).toBe('separated');
    expect(result.patch).toBeNull();
  });

  it('keeps skew contact vertices on the plane and inside both resolved boxes', () => {
    const boxA = new HyperboxSupportShape4([1, 1.2, 0.8, 0.7]);
    const boxB = new HyperboxSupportShape4(
      [0.9, 0.7, 1.1, 0.6],
      new TransformN(
        4,
        Rotor4.fromPlanes([
          { i: 0, j: 1, angle: 0.31 },
          { i: 0, j: 3, angle: -0.47 },
          { i: 1, j: 2, angle: 0.63 },
          { i: 2, j: 3, angle: -0.28 }
        ]),
        new VecN([1.1, 0.15, -0.2, 0.3])
      )
    );
    const result = hyperboxContactPatch4(boxA, boxB);
    expect(result.sat.status).toBe('overlapping');
    expect(result.patch).not.toBeNull();
    expectInsideResolvedBoxes(result.patch!, boxA, boxB);
    expect(result.patch!.solverPoints.length).toBeLessThanOrEqual(8);
  });

  it('reduces a many-vertex facet patch without losing its affine span', () => {
    const boxA = new HyperboxSupportShape4([1, 1.2, 0.8, 0.7]);
    const boxB = new HyperboxSupportShape4(
      [0.9, 0.7, 1.1, 0.6],
      new TransformN(
        4,
        Rotor4.fromPlanes([
          { i: 1, j: 2, angle: -0.899726302629064 },
          { i: 1, j: 3, angle: 0.6268973517395783 },
          { i: 2, j: 3, angle: 1.514587983023192 }
        ]),
        new VecN([
          1.5,
          -0.06495272982865573,
          -0.0537636648863554,
          -0.375440582446754
        ])
      )
    );
    const patch = hyperboxContactPatch4(boxA, boxB).patch!;
    expect(patch.kind).toBe('polyhedron');
    expect(patch.vertices).toHaveLength(20);
    expect(patch.solverPoints).toHaveLength(8);
    expect(patch.diagnostics).toMatchObject({
      effectiveConstraints: 12,
      triplesTested: 220,
      uniqueVertices: 20,
      solverPoints: 8
    });
    expect(affineRank(patch.solverPoints.map((vertex) => vertex.point))).toBe(3);
    expectInsideResolvedBoxes(patch, boxA, boxB);

    const minimal = hyperboxContactPatch4(boxA, boxB, { maxSolverPoints: 4 }).patch!;
    expect(minimal.solverPoints).toHaveLength(4);
    expect(affineRank(minimal.solverPoints.map((vertex) => vertex.point))).toBe(3);
  });

  it('does not merge a distinct near-parallel cross axis needed by contact geometry', () => {
    const planePairs = [
      [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]
    ] as const;
    const angles = [
      2.633884420886865,
      0.0026272852998355566,
      1.5683487302598194,
      0.4725116481781924,
      -1.3527541948649011,
      0.8592146529162434
    ];
    const boxA = new HyperboxSupportShape4([1, 1.2, 0.8, 0.7]);
    const boxB = new HyperboxSupportShape4(
      [0.9, 0.7, 1.1, 0.6],
      new TransformN(
        4,
        Rotor4.fromPlanes(
          planePairs.map(([i, j], index) => ({ i, j, angle: angles[index]! }))
        ),
        new VecN([
          0.7643877789378166,
          1.0398724148981273,
          0.10354425106197596,
          0.46663488121703267
        ])
      )
    );
    const result = hyperboxContactPatch4(boxA, boxB);
    expect(result.sat.source.featureClass).toBe('face-a-edge-b');
    expect(result.sat.diagnostics.axesTested).toBe(56);
    expect(result.patch).not.toBeNull();
    expectInsideResolvedBoxes(result.patch!, boxA, boxB);
  });

  it('preserves patch dimensionality and vertex count when the pair is swapped', () => {
    const boxA = new HyperboxSupportShape4([1, 1.2, 0.8, 0.7]);
    const boxB = new HyperboxSupportShape4(
      [0.9, 0.7, 1.1, 0.6],
      new TransformN(
        4,
        Rotor4.fromPlanes([
          { i: 0, j: 2, angle: 0.7 },
          { i: 1, j: 3, angle: -0.45 }
        ]),
        new VecN([1.1, -0.4, 0.3, 0.2])
      )
    );
    const forward = hyperboxContactPatch4(boxA, boxB).patch!;
    const reverse = hyperboxContactPatch4(boxB, boxA).patch!;
    expect(forward.intrinsicDim).toBe(reverse.intrinsicDim);
    expect(forward.vertices.length).toBe(reverse.vertices.length);
    expect(forward.penetrationDepth).toBeCloseTo(reverse.penetrationDepth, 11);
  });

  it('collapses near-parallel triple solves carrying one boundary witness', () => {
    const boxA = new HyperboxSupportShape4(
      [0.5, 0.5, 0.5, 0.5],
      new TransformN(
        4,
        new MatN(4, [
          0.9999958692364421, 0.0028742791211123705, -0.0000033033195038661457, -0.000004321392704243257,
          -0.0028742773457766197, 0.9999876378576404, -0.0028606487462322335, -0.002877386033654994,
          -0.000004919024481383466, 0.0028606435640489243, 0.9999959083256762, -0.000005109631610644303,
          -0.000003949072120397977, 0.002877389412269484, -0.000003121607243382991, 0.9999958602938466
        ]),
        new VecN([-2.3983161085920037, 1.352523818675245, -2.3983140524943023, 0.0016833451528154718])
      )
    );
    const boxB = new HyperboxSupportShape4(
      [0.5, 0.5, 0.5, 0.5],
      new TransformN(
        4,
        new MatN(4, [
          0.9999999999876056, 0.000004775307564892472, 0.000001375632625141748, -3.051967725942484e-7,
          -0.0000047752947303389165, 0.9999999999305921, -0.000010137266765140156, -0.0000036398602285919157,
          -0.0000013756815465846586, 0.000010137254077910866, 0.9999999999462593, -0.000001680862144508676,
          3.051770788565292e-7, 0.0000036398787251037885, 0.0000016808256660364444, 0.9999999999919166
        ]),
        new VecN([-2.40462036601452, 2.303047395683621, -2.4046218449743324, -0.00462003961354193])
      )
    );

    const patch = hyperboxContactPatch4(boxA, boxB).patch!;
    expect(patch.kind).toBe('point');
    expect(patch.intrinsicDim).toBe(0);
    expect(patch.diagnostics).toMatchObject({
      feasibleCandidates: 4,
      uniqueVertices: 1,
      solverPoints: 1
    });
    expect(patch.vertices).toHaveLength(1);
    expect(new Set(patch.solverPoints.map(({ id }) => id)).size).toBe(1);
  });

  it('validates contact-patch numerical policies', () => {
    const box = unitBox([0, 0, 0, 0]);
    expect(() => hyperboxContactPatch4(box, box, { clipTolerance: -1 })).toThrow(
      /clipTolerance/
    );
    expect(() => hyperboxContactPatch4(box, box, { vertexTolerance: Number.NaN })).toThrow(
      /vertexTolerance/
    );
    expect(() => hyperboxContactPatch4(box, box, { maxSolverPoints: 3 })).toThrow(
      /maxSolverPoints/
    );
    expect(() => hyperboxContactPatch4(box, box, { maxSolverPoints: 33 })).toThrow(
      /maxSolverPoints/
    );
  });
});

function affineRank(points: readonly VecN[], tolerance = 1e-8): number {
  if (points.length <= 1) return 0;
  const origin = points[0]!;
  const basis: VecN[] = [];
  for (let index = 1; index < points.length; index++) {
    const candidate = points[index]!.clone().sub(origin);
    for (const direction of basis) {
      candidate.sub(direction.clone().multiplyScalar(candidate.dot(direction)));
    }
    if (candidate.length() > tolerance) basis.push(candidate.normalize());
  }
  return basis.length;
}
