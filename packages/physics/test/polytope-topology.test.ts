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
  TransformedSupportShapeN,
  compileConvexPolytopeTopologyN,
  instantiateConvexPolytopeTopologyN,
  polytopeContactPatch4,
  supportShapeVerticesN,
  type ConvexPolytopeTopologyN
} from '../src/index.js';

function cube4(): ConvexHullSupportShapeN {
  return ConvexHullSupportShapeN.fromCellComplex(
    createHypercube({ dim: 4, size: 2 })
  );
}

function expectPointSetsClose(
  actual: readonly VecN[],
  expected: readonly VecN[]
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
    expect(nearest.distance).toBeLessThan(2e-7);
    unused.delete(nearest.index);
  }
}

describe('compiled convex-polytope topology', () => {
  it('compiles simplex facet incidence from R1 through R5', () => {
    for (let dim = 1; dim <= 5; dim++) {
      const source = ConvexHullSupportShapeN.fromCellComplex(
        createSimplex({ dim, edgeLength: 2 })
      );
      const result = compileConvexPolytopeTopologyN(source);
      expect(result.status).toBe('complete');
      expect(result.topology).toMatchObject({
        schema: 'holotope-convex-polytope-topology-v1',
        dim,
        diagnostics: {
          sourceVertices: dim + 1,
          facetCandidates: dim + 1,
          facets: dim + 1
        }
      });
      expect(result.topology!.facets.every(
        ({ vertexFeatureIds }) => vertexFeatureIds.length === dim
      )).toBe(true);
    }
  });

  it('recovers the 2n facets of n-cubes without dimension-specific tables', () => {
    for (const dim of [2, 3, 4]) {
      const source = ConvexHullSupportShapeN.fromCellComplex(
        createHypercube({ dim, size: 2 })
      );
      const result = compileConvexPolytopeTopologyN(source);
      expect(result.status).toBe('complete');
      expect(result.topology?.facets).toHaveLength(2 * dim);
      expect(result.topology?.facets.every(
        ({ vertexFeatureIds }) => vertexFeatureIds.length === 2 ** (dim - 1)
      )).toBe(true);
    }
  });

  it('reinstantiates validated facet planes after a full rigid pose change', () => {
    const source = cube4();
    const topology = compileConvexPolytopeTopologyN(source).topology!;
    const attached = new CompiledPolytopeSupportShapeN(source, topology);
    const transformed = new TransformedSupportShapeN(
      attached,
      new TransformN(
        4,
        Rotor4.fromPlanes([
          { i: 0, j: 3, angle: 0.47 },
          { i: 1, j: 2, angle: -0.31 }
        ]),
        new VecN([1.2, -0.4, 0.7, 0.2])
      )
    );
    const vertices = supportShapeVerticesN(transformed)!;
    const instance = instantiateConvexPolytopeTopologyN(topology, vertices);
    expect(instance.status).toBe('complete');
    expect(instance.facets).toHaveLength(8);
    for (const facet of instance.facets!) {
      expect(facet.normal.length()).toBeCloseTo(1, 12);
      for (const { point } of vertices) {
        expect(facet.normal.dot(point)).toBeLessThanOrEqual(facet.offset + 1e-9);
      }
    }

    const serialized = JSON.parse(JSON.stringify(topology)) as ConvexPolytopeTopologyN;
    expect(instantiateConvexPolytopeTopologyN(serialized, vertices).status).toBe(
      'complete'
    );
    const malformed = JSON.parse(JSON.stringify(topology)) as {
      diagnostics: { facets: number };
    };
    malformed.diagnostics.facets--;
    expect(instantiateConvexPolytopeTopologyN(
      malformed as ConvexPolytopeTopologyN,
      vertices
    )).toMatchObject({ status: 'invalid', reason: 'invalid-schema' });
  });

  it('matches the exhaustive contact oracle while doing no query-time candidate search', () => {
    const sourceA = cube4();
    const sourceB = cube4();
    const transformA = new TransformN(
      4,
      Rotor4.fromPlanes([{ i: 0, j: 3, angle: 0.23 }]),
      new VecN([0, 0, 0, 0])
    );
    const transformB = new TransformN(
      4,
      Rotor4.fromPlanes([
        { i: 0, j: 3, angle: 0.23 },
        { i: 1, j: 2, angle: -0.19 }
      ]),
      new VecN([1.35, 0.1, -0.05, 0.08])
    );
    const exhaustive = polytopeContactPatch4(
      new TransformedSupportShapeN(sourceA, transformA),
      new TransformedSupportShapeN(sourceB, transformB)
    );
    const compiledA = new CompiledPolytopeSupportShapeN(
      sourceA,
      compileConvexPolytopeTopologyN(sourceA).topology!
    );
    const compiledB = new CompiledPolytopeSupportShapeN(
      sourceB,
      compileConvexPolytopeTopologyN(sourceB).topology!
    );
    const cached = polytopeContactPatch4(
      new TransformedSupportShapeN(compiledA, transformA),
      new TransformedSupportShapeN(compiledB, transformB),
      { maxFacetCandidates: 5 }
    );

    expect(exhaustive.status).toBe('penetrating');
    expect(cached.status).toBe('penetrating');
    expect(cached.patch?.penetrationDepth).toBeCloseTo(
      exhaustive.patch!.penetrationDepth,
      8
    );
    expect(Math.abs(cached.patch!.normal.dot(exhaustive.patch!.normal))).toBeCloseTo(
      1,
      8
    );
    expectPointSetsClose(
      cached.patch!.vertices.map(({ point }) => point),
      exhaustive.patch!.vertices.map(({ point }) => point)
    );
    expect(exhaustive.patch?.diagnostics.hullA).toMatchObject({
      topologySource: 'enumerated',
      queryFacetCandidates: 1820
    });
    expect(cached.patch?.diagnostics.hullA).toMatchObject({
      topologySource: 'compiled',
      facetCandidates: 1820,
      queryFacetCandidates: 0
    });
  });

  it('rejects incompatible topology and preserves typed compilation failures', () => {
    const cube = cube4();
    const topology = compileConvexPolytopeTopologyN(cube).topology!;
    const simplex = ConvexHullSupportShapeN.fromCellComplex(
      createSimplex({ dim: 4, edgeLength: 2 })
    );
    expect(() => new CompiledPolytopeSupportShapeN(simplex, topology)).toThrow(
      /vertex-feature-mismatch/
    );

    const deformed = cube4();
    deformed.positions[0] = 0;
    expect(() => new CompiledPolytopeSupportShapeN(deformed, topology)).toThrow(
      /facet-geometry-mismatch/
    );

    expect(compileConvexPolytopeTopologyN(cube, {
      maxFacetCandidates: 100
    })).toMatchObject({
      status: 'indeterminate',
      reason: 'facet-candidate-limit',
      topology: null,
      facetCandidates: 1820
    });
    expect(compileConvexPolytopeTopologyN(
      new GlomeSupportShapeN([0, 0, 0, 0], 1)
    )).toMatchObject({
      status: 'unsupported',
      reason: 'shape-not-vertex-enumerable',
      topology: null
    });
  });
});
