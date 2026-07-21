import { describe, expect, it } from 'vitest';
import {
  CoordinateProjection,
  HyperplaneSlice4,
  OrthographicProjection,
  PerspectiveProjection,
  VecN,
  affineSectionMapRecipe4,
  affineSliceChartMapRecipe4,
  createRepresentationLineageN,
  evaluateRepresentationLineagePointN,
  projectionMapRecipeN,
  representationLineageCapabilitiesN,
  representationMapCapabilitiesN
} from '../src/index.js';
import type { RepresentationMapRecipeN } from '../src/index.js';

describe('representation map capabilities', () => {
  it('pins independent capability facts for every landed recipe kind', () => {
    const recipes: RepresentationMapRecipeN[] = [
      {
        kind: 'affine-section', fromDim: 4, toDim: 4,
        normal: [0, 0, 0, 1], offset: 0
      },
      {
        kind: 'affine-slice-chart', fromDim: 4, toDim: 3,
        normal: [0, 0, 0, 1], offset: 0,
        basis: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]
      },
      {
        kind: 'orthographic-projection', fromDim: 5, toDim: 3,
        retainedAxes: [0, 1, 2]
      },
      {
        kind: 'coordinate-subspace-projection', fromDim: 5, toDim: 3,
        retainedAxes: [0, 2, 4]
      },
      {
        kind: 'iterated-perspective-projection', fromDim: 5, toDim: 3,
        viewDistance: 4, epsilon: 1e-6
      },
      {
        kind: 'custom-projection', fromDim: 4, toDim: 3, label: 'consumer map'
      },
      {
        kind: 'field-restriction', fromDim: 4, toDim: 3, fieldId: 'field',
        normal: [0, 0, 0, 1], offset: 0,
        basis: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]
      },
      {
        kind: 'sampled-isosurface', fromDim: 3, toDim: 3,
        shape: [4, 4, 4], min: [-1, -1, -1], max: [1, 1, 1], isoValue: 0
      },
      {
        kind: 'ray-realization', fromDim: 3, toDim: 3,
        maxSteps: 64, surfaceEpsilon: 1e-4, stepSafety: 0.8
      }
    ];

    expect(recipes.map((recipe) => representationMapCapabilitiesN(recipe))).toEqual([
      {
        pointForward: 'conditional', pointLift: 'exact', inverseFibre: 'unavailable',
        attributeTransport: 'exact', sourceIdentity: 'preserved'
      },
      {
        pointForward: 'conditional', pointLift: 'exact', inverseFibre: 'unavailable',
        attributeTransport: 'exact', sourceIdentity: 'preserved'
      },
      {
        pointForward: 'exact', pointLift: 'unavailable', inverseFibre: 'exact',
        attributeTransport: 'exact', sourceIdentity: 'preserved'
      },
      {
        pointForward: 'exact', pointLift: 'unavailable', inverseFibre: 'exact',
        attributeTransport: 'exact', sourceIdentity: 'preserved'
      },
      {
        pointForward: 'conditional', pointLift: 'conditional', inverseFibre: 'exact',
        attributeTransport: 'conditional', sourceIdentity: 'preserved'
      },
      {
        pointForward: 'unavailable', pointLift: 'unavailable', inverseFibre: 'unavailable',
        attributeTransport: 'unavailable', sourceIdentity: 'preserved'
      },
      {
        pointForward: 'record-dependent', pointLift: 'exact', inverseFibre: 'unavailable',
        attributeTransport: 'record-dependent', sourceIdentity: 'recorded'
      },
      {
        pointForward: 'approximate', pointLift: 'approximate', inverseFibre: 'unavailable',
        attributeTransport: 'approximate', sourceIdentity: 'recorded'
      },
      {
        pointForward: 'approximate', pointLift: 'approximate', inverseFibre: 'unavailable',
        attributeTransport: 'record-dependent', sourceIdentity: 'recorded'
      }
    ]);
  });

  it('composes lineage qualities monotonically without inventing one inverse', () => {
    const slice = HyperplaneSlice4.axisAligned(3, 0.25);
    const exactSection = createRepresentationLineageN(4, [
      affineSectionMapRecipe4(slice),
      affineSliceChartMapRecipe4(slice)
    ]);
    expect(representationLineageCapabilitiesN(exactSection)).toEqual({
      pointForward: 'conditional',
      pointLift: 'exact',
      inverseFibre: 'unavailable',
      attributeTransport: 'exact',
      sourceIdentity: 'preserved'
    });

    const perspective = createRepresentationLineageN(4, [
      projectionMapRecipeN(new PerspectiveProjection({ fromDim: 4 }))
    ]);
    expect(representationLineageCapabilitiesN(perspective)).toEqual({
      pointForward: 'conditional',
      pointLift: 'conditional',
      inverseFibre: 'exact',
      attributeTransport: 'conditional',
      sourceIdentity: 'preserved'
    });
  });
});

describe('evaluateRepresentationLineagePointN', () => {
  it('agrees with orthographic and arbitrary coordinate projections', () => {
    const point = new VecN([1.25, -0.5, 3, 8, -2]);
    for (const projection of [
      new OrthographicProjection({ fromDim: 5 }),
      new CoordinateProjection({ fromDim: 5, axes: [4, 0, 2] })
    ]) {
      const lineage = createRepresentationLineageN(5, [projectionMapRecipeN(projection)]);
      const result = evaluateRepresentationLineagePointN(lineage, point);
      expect(result.kind).toBe('exact');
      if (result.kind !== 'exact') continue;
      expect(Array.from(result.point.data)).toEqual(projection.projectPoint(point.data));
    }
  });

  it('matches certified perspective evaluation from R3 through R6', () => {
    for (let dim = 3; dim <= 6; dim++) {
      const projection = new PerspectiveProjection({
        fromDim: dim,
        viewDistance: 4.5,
        epsilon: 1e-8
      });
      const point = new VecN(Array.from({ length: dim }, (_, axis) =>
        axis < 3 ? 0.25 * (axis + 1) : 0.1 * (axis - 2)
      ));
      const lineage = createRepresentationLineageN(dim, [projectionMapRecipeN(projection)]);
      const result = evaluateRepresentationLineagePointN(lineage, point);
      expect(result.kind).toBe('exact');
      if (result.kind !== 'exact') continue;
      const expected = projection.projectPoint(point.data);
      expect(result.point.data[0]).toBeCloseTo(expected[0], 14);
      expect(result.point.data[1]).toBeCloseTo(expected[1], 14);
      expect(result.point.data[2]).toBeCloseTo(expected[2], 14);
    }
  });

  it('charts an on-plane point exactly and refuses an off-plane point', () => {
    const slice = new HyperplaneSlice4({ normal: [1, 1, 0, 0], offset: 0.35 });
    const chartPoint = [0.4, -0.75, 1.2] as const;
    const ambient = slice.embedPoint(chartPoint);
    const lineage = createRepresentationLineageN(4, [
      affineSectionMapRecipe4(slice),
      affineSliceChartMapRecipe4(slice)
    ]);
    const exact = evaluateRepresentationLineagePointN(lineage, ambient);
    expect(exact.kind).toBe('exact');
    if (exact.kind === 'exact') {
      expect(exact.point.data[0]).toBeCloseTo(chartPoint[0], 14);
      expect(exact.point.data[1]).toBeCloseTo(chartPoint[1], 14);
      expect(exact.point.data[2]).toBeCloseTo(chartPoint[2], 14);
    }

    const outside = Float64Array.from(ambient);
    for (let component = 0; component < 4; component++) {
      outside[component]! += 1e-3 * slice.normal.data[component]!;
    }
    expect(evaluateRepresentationLineagePointN(lineage, outside)).toMatchObject({
      kind: 'unavailable',
      reason: 'outside-domain',
      failedStep: 0
    });
  });

  it('refuses the legacy-clamped perspective branch with stage evidence', () => {
    const projection = new PerspectiveProjection({
      fromDim: 4,
      viewDistance: 2,
      epsilon: 1e-6
    });
    const lineage = createRepresentationLineageN(4, [projectionMapRecipeN(projection)]);
    const result = evaluateRepresentationLineagePointN(lineage, [0.1, 0.2, 0.3, 2]);
    expect(result).toMatchObject({
      kind: 'unavailable',
      reason: 'outside-domain',
      failedStep: 0,
      steps: [{
        recipeKind: 'iterated-perspective-projection',
        kind: 'unavailable',
        details: { firstClampedAxis: 3 }
      }]
    });
  });

  it('distinguishes recipes lacking point math from record-producing maps', () => {
    const custom = createRepresentationLineageN(4, [{
      kind: 'custom-projection', fromDim: 4, toDim: 3, label: 'external'
    }]);
    expect(evaluateRepresentationLineagePointN(custom, [0, 0, 0, 0])).toMatchObject({
      kind: 'unavailable', reason: 'recipe-insufficient'
    });

    const sampled = createRepresentationLineageN(3, [{
      kind: 'sampled-isosurface', fromDim: 3, toDim: 3,
      shape: [3, 3, 3], min: [-1, -1, -1], max: [1, 1, 1], isoValue: 0
    }]);
    expect(evaluateRepresentationLineagePointN(sampled, [0, 0, 0])).toMatchObject({
      kind: 'unavailable', reason: 'record-required'
    });
  });
});
