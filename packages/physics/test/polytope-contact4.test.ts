import {
  Rotor4,
  TransformN,
  VecN,
  createHypercube,
  createSimplex
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConvexHullSupportShapeN,
  GlomeSupportShapeN,
  HyperboxSupportShape4,
  TransformedSupportShapeN,
  hyperboxContactPatch4,
  polytopeContactPatch4,
  supportShapeVerticesN,
  type PolytopeContactPatch4
} from '../src/index.js';

function cubeSource(): ConvexHullSupportShapeN {
  return ConvexHullSupportShapeN.fromCellComplex(
    createHypercube({ dim: 4, size: 2 })
  );
}

function transformedCube(
  position: ArrayLike<number>,
  rotation: Rotor4 = Rotor4.identity()
): TransformedSupportShapeN {
  return new TransformedSupportShapeN(
    cubeSource(),
    new TransformN(4, rotation, new VecN(position))
  );
}

function hullFromBox(box: HyperboxSupportShape4): ConvexHullSupportShapeN {
  const vertices = box.enumerateVertices();
  return new ConvexHullSupportShapeN(
    4,
    Float64Array.from(vertices.flatMap(({ point }) => Array.from(point.data)))
  );
}

function expectPointsClose(
  actual: readonly VecN[],
  expected: readonly VecN[],
  digits = 7
): void {
  expect(actual).toHaveLength(expected.length);
  const unused = new Set(expected.map((_, index) => index));
  for (const point of actual) {
    const nearest = Array.from(unused)
      .map((index) => ({
        index,
        distance: point.clone().sub(expected[index]!).length()
      }))
      .sort((left, right) => left.distance - right.distance)[0]!;
    expect(nearest.distance).toBeLessThan(10 ** (-digits) * 4);
    unused.delete(nearest.index);
  }
}

function expectInsideResolvedHull(
  patch: PolytopeContactPatch4,
  shape: TransformedSupportShapeN,
  translation: VecN
): void {
  for (const point of patch.vertices.map(({ point }) => point)) {
    expect(point.dot(patch.normal)).toBeCloseTo(patch.planeOffset, 7);
    for (let sample = 0; sample < 32; sample++) {
      const direction = new VecN([
        Math.sin(sample * 1.7 + 0.1),
        Math.sin(sample * 2.3 + 0.7),
        Math.cos(sample * 1.1 + 0.4),
        Math.cos(sample * 2.9 + 0.2)
      ]).normalize();
      const support = shape.support(direction).point.add(translation);
      expect(direction.dot(point)).toBeLessThanOrEqual(
        direction.dot(support) + 2e-7
      );
    }
  }
}

describe('general R4 polytope contact patches', () => {
  it('retains stable source vertices through rigid transformed support shapes', () => {
    const source = cubeSource();
    const shape = transformedCube(
      [0.2, -0.4, 0.6, 0.1],
      Rotor4.fromPlanes([{ i: 0, j: 3, angle: 0.37 }])
    );
    const vertices = supportShapeVerticesN(shape)!;
    expect(vertices).toHaveLength(16);
    expect(vertices.map(({ featureId }) => featureId)).toEqual(
      Array.from({ length: 16 }, (_, index) => index)
    );
    for (const vertex of vertices) {
      expect(shape.resolveFeature(vertex.featureId)?.point.data).toEqual(vertex.point.data);
      expect(source.resolveFeature(vertex.featureId)).toBeDefined();
    }
  });

  it('constructs the complete cubical contact section with persistent IDs', () => {
    const shapeA = transformedCube([0, 0, 0, 0]);
    const shapeB = transformedCube([1.5, 0, 0, 0]);
    const first = polytopeContactPatch4(shapeA, shapeB);
    expect(first.status).toBe('penetrating');
    expect(first.reason).toBe('complete');
    expect(first.patch).toMatchObject({
      kind: 'polyhedron',
      intrinsicDim: 3,
      penetrationDepth: 0.5
    });
    expect(first.patch!.vertices).toHaveLength(8);
    expect(first.patch!.diagnostics.hullA).toMatchObject({
      sourceVertices: 16,
      facetCandidates: 1820,
      facets: 8
    });
    expect(first.patch!.diagnostics.hullB.facets).toBe(8);
    expectInsideResolvedHull(first.patch!, shapeA, first.patch!.translationA);
    expectInsideResolvedHull(first.patch!, shapeB, new VecN(4));

    shapeB.transform.position.data[0] = 1.4;
    const coherent = polytopeContactPatch4(shapeA, shapeB);
    expect(coherent.patch?.vertices.map(({ id }) => id)).toEqual(
      first.patch?.vertices.map(({ id }) => id)
    );
    for (const vertex of coherent.patch!.vertices) {
      expect(vertex.featureA.dimension).toBe(0);
      expect(vertex.featureB.dimension).toBe(0);
    }
  });

  it('retains the complete point-through-polyhedron touching ladder', () => {
    const cases = [
      { center: [2, 0, 0, 0], kind: 'polyhedron', dimension: 3, vertices: 8 },
      { center: [2, 2, 0, 0], kind: 'polygon', dimension: 2, vertices: 4 },
      { center: [2, 2, 2, 0], kind: 'segment', dimension: 1, vertices: 2 },
      { center: [2, 2, 2, 2], kind: 'point', dimension: 0, vertices: 1 }
    ] as const;
    const shapeA = transformedCube([0, 0, 0, 0]);
    for (const testCase of cases) {
      const result = polytopeContactPatch4(
        shapeA,
        transformedCube(testCase.center)
      );
      expect(result.status).toBe('touching');
      expect(result.patch).toMatchObject({
        kind: testCase.kind,
        intrinsicDim: testCase.dimension,
        penetrationDepth: 0
      });
      expect(result.patch?.vertices).toHaveLength(testCase.vertices);
    }
  });

  it('matches the specialized hyperbox patch for a skew pose', () => {
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
    const exact = hyperboxContactPatch4(boxA, boxB).patch!;
    const general = polytopeContactPatch4(hullFromBox(boxA), hullFromBox(boxB));
    expect(general.status).toBe('penetrating');
    expect(general.patch?.penetrationDepth).toBeCloseTo(exact.penetrationDepth, 7);
    expect(Math.abs(general.patch!.normal.dot(exact.normal))).toBeCloseTo(1, 7);
    expectPointsClose(
      general.patch!.vertices.map(({ point }) => point),
      exact.vertices.map(({ point }) => point),
      6
    );
  });

  it('matches complete SAT-derived manifolds over deterministic full-SO(4) poses', () => {
    let state = 0x71c4_9a2d;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const boxA = new HyperboxSupportShape4([1, 0.9, 1.1, 0.8]);
    const hullA = hullFromBox(boxA);
    let compared = 0;
    for (let attempt = 0; attempt < 400 && compared < 100; attempt++) {
      const boxB = new HyperboxSupportShape4(
        [0.85, 1.05, 0.75, 1.15],
        new TransformN(
          4,
          Rotor4.fromPlanes([
            { i: 0, j: 3, angle: random() * 1.4 - 0.7 },
            { i: 1, j: 2, angle: random() * 1.4 - 0.7 },
            { i: 0, j: 2, angle: random() - 0.5 }
          ]),
          new VecN([
            random() * 2 - 1,
            random() * 2 - 1,
            random() * 2 - 1,
            random() * 2 - 1
          ])
        )
      );
      const exact = hyperboxContactPatch4(boxA, boxB);
      if (exact.sat.status === 'separated' || exact.sat.penetrationDepth < 1e-5) {
        continue;
      }
      const general = polytopeContactPatch4(hullA, hullFromBox(boxB));
      expect(general.status).toBe('penetrating');
      expect(general.patch?.penetrationDepth).toBeCloseTo(
        exact.sat.penetrationDepth,
        7
      );
      expect(Math.abs(general.patch!.normal.dot(exact.sat.axis))).toBeCloseTo(1, 6);
      expectPointsClose(
        general.patch!.vertices.map(({ point }) => point),
        exact.patch!.vertices.map(({ point }) => point),
        5
      );
      compared++;
    }
    expect(compared).toBe(100);
  });

  it('builds a manifold for transformed 4-simplices and reverses it coherently', () => {
    const source = ConvexHullSupportShapeN.fromCellComplex(
      createSimplex({ dim: 4, edgeLength: 2 })
    );
    const shapeA = new TransformedSupportShapeN(source);
    const shapeB = new TransformedSupportShapeN(
      source,
      new TransformN(
        4,
        Rotor4.fromPlanes([
          { i: 0, j: 3, angle: 0.31 },
          { i: 1, j: 2, angle: -0.27 }
        ]),
        new VecN([0.15, -0.1, 0.2, 0.05])
      )
    );
    const forward = polytopeContactPatch4(shapeA, shapeB);
    const reverse = polytopeContactPatch4(shapeB, shapeA);
    expect(forward.status).toBe('penetrating');
    expect(forward.patch?.vertices.length).toBeGreaterThan(0);
    expect(forward.patch?.diagnostics.hullA.facets).toBe(5);
    expect(reverse.patch?.penetrationDepth).toBeCloseTo(
      forward.patch!.penetrationDepth,
      7
    );
    expect(reverse.patch!.normal.dot(forward.patch!.normal)).toBeCloseTo(-1, 7);
    expectPointsClose(
      reverse.patch!.vertices.map(({ point }) =>
        point.clone().add(forward.patch!.translationA)
      ),
      forward.patch!.vertices.map(({ point }) => point),
      6
    );
  });

  it('keeps opaque and smooth support shapes outside the manifold contract', () => {
    const unsupported = polytopeContactPatch4(
      new GlomeSupportShapeN([0, 0, 0, 0], 1),
      transformedCube([0, 0, 0, 0])
    );
    expect(unsupported).toMatchObject({
      status: 'unsupported',
      reason: 'shape-a-not-vertex-enumerable',
      epa: null,
      patch: null
    });

    const limited = polytopeContactPatch4(
      transformedCube([0, 0, 0, 0]),
      transformedCube([1.5, 0, 0, 0]),
      { maxFacetCandidates: 100 }
    );
    expect(limited).toMatchObject({
      status: 'indeterminate',
      reason: 'facet-candidate-limit',
      patch: null
    });
  });
});
