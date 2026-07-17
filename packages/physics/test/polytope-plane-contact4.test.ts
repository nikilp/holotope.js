import {
  Rotor4,
  TransformN,
  VecN,
  createHypercube,
  createSimplex
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  CompiledPolytopeSupportShapeN,
  ConvexHullSupportShapeN,
  GlomeSupportShapeN,
  HyperboxSupportShape4,
  HyperplaneColliderN,
  TransformedSupportShapeN,
  compileConvexPolytopeTopologyN,
  hyperboxHyperplaneContact4,
  instantiateConvexPolytopeTopologyN,
  polytopeHyperplaneContact4,
  supportShapeVerticesN
} from '../src/index.js';

function localCube(): ConvexHullSupportShapeN {
  return ConvexHullSupportShapeN.fromCellComplex(
    createHypercube({ dim: 4, size: 2 })
  );
}

function compiledCube(): CompiledPolytopeSupportShapeN {
  const source = localCube();
  return new CompiledPolytopeSupportShapeN(
    source,
    compileConvexPolytopeTopologyN(source).topology!
  );
}

function expectPointSetsClose(
  actual: readonly VecN[],
  expected: readonly VecN[],
  tolerance = 2e-7
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
    expect(nearest.distance).toBeLessThan(tolerance);
    unused.delete(nearest.index);
  }
}

describe('general R4 polytope/hyperplane contact', () => {
  it('matches the exact hyperbox support facet including margin and ordering', () => {
    const transform = new TransformN(4, undefined, new VecN([0, 0.5, 0, 0]));
    const box = new HyperboxSupportShape4([1, 1, 1, 1], transform);
    const polytope = new TransformedSupportShapeN(compiledCube(), transform);
    const plane = new HyperplaneColliderN([0, 1, 0, 0], 0);
    const exact = hyperboxHyperplaneContact4(box, plane, { hyperboxMargin: 0.2 });
    const general = polytopeHyperplaneContact4(polytope, plane, {
      polytopeMargin: 0.2
    });

    expect(general).toMatchObject({
      status: 'overlapping',
      reason: 'complete',
      signedDistance: -0.7,
      penetrationDepth: 0.7,
      shapeAType: 'polytope',
      shapeBType: 'hyperplane',
      polytopeFeature: { dimension: 3 }
    });
    expect(general.patch).toMatchObject({
      kind: 'polyhedron',
      intrinsicDim: 3,
      polytopeRole: 'a',
      diagnostics: {
        topologySource: 'compiled',
        queryFacetCandidates: 0,
        supportVertices: 8,
        solverPoints: 8
      }
    });
    expectPointSetsClose(
      general.patch!.vertices.map(({ resolvedPoint }) => resolvedPoint),
      exact.patch!.vertices.map(({ resolvedPoint }) => resolvedPoint)
    );
    for (const vertex of general.patch!.vertices) {
      expect(vertex.pointA.clone().add(general.patch!.translationA).data)
        .toEqual(vertex.pointB.data);
    }

    const reverse = polytopeHyperplaneContact4(plane, polytope, {
      polytopeMargin: 0.2
    });
    expect(reverse.patch?.polytopeRole).toBe('b');
    expect(reverse.normal.dot(general.normal)).toBeCloseTo(-1, 14);
    expect(reverse.patch?.vertices.map(({ id }) => id)).toEqual(
      general.patch?.vertices.map(({ id }) => id)
    );
  });

  it('retains the complete point-through-polyhedron support-face ladder', () => {
    const polytope = new TransformedSupportShapeN(compiledCube());
    const cases = [
      { normal: [1, 0, 0, 0], offset: -1, kind: 'polyhedron', dim: 3, count: 8 },
      { normal: [1, 1, 0, 0], offset: -2, kind: 'polygon', dim: 2, count: 4 },
      { normal: [1, 1, 1, 0], offset: -3, kind: 'segment', dim: 1, count: 2 },
      { normal: [1, 1, 1, 1], offset: -4, kind: 'point', dim: 0, count: 1 }
    ] as const;
    for (const testCase of cases) {
      const result = polytopeHyperplaneContact4(
        polytope,
        new HyperplaneColliderN(testCase.normal, testCase.offset)
      );
      expect(result.status).toBe('touching');
      expect(result.patch).toMatchObject({
        kind: testCase.kind,
        intrinsicDim: testCase.dim,
        polytopeFeature: { dimension: testCase.dim }
      });
      expect(result.patch?.vertices).toHaveLength(testCase.count);
    }
  });

  it('differentially matches exact boxes over full-SO(4) support faces', () => {
    let state = 0xb047_12a5;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const source = compiledCube();
    let compared = 0;
    for (let sample = 0; sample < 25; sample++) {
      const transform = new TransformN(
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
      );
      const box = new HyperboxSupportShape4([1, 1, 1, 1], transform);
      const polytope = new TransformedSupportShapeN(source, transform);
      const axes = box.worldAxes();
      for (let constrainedAxes = 1; constrainedAxes <= 4; constrainedAxes++) {
        const normal = new VecN(4);
        for (let axis = 0; axis < constrainedAxes; axis++) {
          normal.add(axes[axis]!.clone().multiplyScalar((axis & 1) === 0 ? 1 : -1));
        }
        normal.normalize();
        const minimum = normal.dot(box.support(normal.clone().multiplyScalar(-1)).point);
        const plane = new HyperplaneColliderN(normal, minimum + 0.25);
        const exact = hyperboxHyperplaneContact4(box, plane);
        const general = polytopeHyperplaneContact4(polytope, plane);
        expect(general.status).toBe('overlapping');
        expect(general.penetrationDepth).toBeCloseTo(exact.penetrationDepth, 8);
        expect(general.patch?.intrinsicDim).toBe(exact.patch?.intrinsicDim);
        expectPointSetsClose(
          general.patch!.vertices.map(({ resolvedPoint }) => resolvedPoint),
          exact.patch!.vertices.map(({ resolvedPoint }) => resolvedPoint),
          4e-7
        );
        compared++;
      }
    }
    expect(compared).toBe(100);
  });

  it('extracts a transformed simplex facet from compiled incidence', () => {
    const source = ConvexHullSupportShapeN.fromCellComplex(
      createSimplex({ dim: 4, edgeLength: 2 })
    );
    const topology = compileConvexPolytopeTopologyN(source).topology!;
    const transformed = new TransformedSupportShapeN(
      new CompiledPolytopeSupportShapeN(source, topology),
      new TransformN(
        4,
        Rotor4.fromPlanes([
          { i: 0, j: 3, angle: 0.41 },
          { i: 1, j: 2, angle: -0.28 }
        ]),
        new VecN([0.3, -0.2, 0.1, 0.4])
      )
    );
    const live = instantiateConvexPolytopeTopologyN(
      topology,
      supportShapeVerticesN(transformed)!
    );
    const facet = live.facets![0]!;
    const planeNormal = facet.normal.clone().multiplyScalar(-1);
    const minimum = planeNormal.dot(
      transformed.support(planeNormal.clone().multiplyScalar(-1)).point
    );
    const result = polytopeHyperplaneContact4(
      transformed,
      new HyperplaneColliderN(planeNormal, minimum + 0.2)
    );
    expect(result).toMatchObject({
      status: 'overlapping',
      polytopeFeature: {
        key: facet.key,
        dimension: 3
      }
    });
    expect(result.penetrationDepth).toBeCloseTo(0.2, 12);
    expect(result.patch?.vertices).toHaveLength(4);
  });

  it('reduces a many-vertex support facet while preserving its 3D span', () => {
    const positions: number[] = [];
    for (const z of [-1, 1]) {
      for (let step = 0; step < 6; step++) {
        const angle = step * Math.PI / 3;
        positions.push(Math.cos(angle), Math.sin(angle), z, 0);
      }
    }
    positions.push(0, 0, 0, 2);
    const source = new ConvexHullSupportShapeN(4, positions);
    const topology = compileConvexPolytopeTopologyN(source).topology!;
    const result = polytopeHyperplaneContact4(
      new CompiledPolytopeSupportShapeN(source, topology),
      new HyperplaneColliderN([0, 0, 0, 1], 0.2)
    );
    expect(result.patch).toMatchObject({
      kind: 'polyhedron',
      intrinsicDim: 3,
      diagnostics: { supportVertices: 12, solverPoints: 8 }
    });
    expect(result.patch?.vertices).toHaveLength(12);
    expect(result.patch?.solverPoints).toHaveLength(8);
  });

  it('keeps smooth, budget-exhausted, and invalid options explicit', () => {
    const plane = new HyperplaneColliderN([0, 1, 0, 0], 0);
    expect(polytopeHyperplaneContact4(
      new GlomeSupportShapeN([0, 0, 0, 0], 1),
      plane
    )).toMatchObject({
      status: 'unsupported',
      reason: 'polytope-not-vertex-enumerable',
      patch: null
    });
    expect(polytopeHyperplaneContact4(localCube(), plane, {
      maxFacetCandidates: 100
    })).toMatchObject({
      status: 'indeterminate',
      reason: 'facet-candidate-limit',
      patch: null
    });
    expect(() => polytopeHyperplaneContact4(localCube(), plane, {
      manifoldTolerance: Number.NaN
    })).toThrow(/manifoldTolerance/);
    expect(() => polytopeHyperplaneContact4(plane, plane)).toThrow(/exactly one/);
  });
});
