import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  CoordinateProjection,
  HyperplaneSlice4,
  OrthographicProjection,
  PerspectiveProjection,
  TransformN,
  VecN,
  affineSectionMapRecipe4,
  affineSliceChartMapRecipe4,
  createRepresentationLineageN,
  createSourceCellReferenceN,
  createSourceEdgeCoordinateN,
  createSourceSimplexCoordinateN,
  createSourceSimplexReferenceN,
  evaluateSourceEdgeCoordinateN,
  evaluateSourceSimplexCoordinateN,
  fitSourceEdgeCoordinateToProjectionN,
  fitSourceEdgeCoordinateToObservationsN,
  fitSourceSimplexCoordinateToObservationsN,
  inspectSourceCellReferenceN,
  inspectSourceSimplexReferenceN,
  projectPointToSourceEdgeN,
  projectPointToSourceSimplexN,
  projectionMapRecipeN,
  type CellGroup,
  type Projection
} from '@holotope/core';

function referenceFixture(): {
  complex: CellComplex;
  edgeGroup: CellGroup;
  otherGroup: CellGroup;
} {
  const edgeGroup: CellGroup = {
    dim: 1,
    verticesPerCell: 2,
    kind: 'simplex',
    indices: new Uint32Array([0, 1, 1, 2])
  };
  const otherGroup: CellGroup = {
    dim: 1,
    verticesPerCell: 2,
    kind: 'simplex',
    indices: new Uint32Array([2, 0])
  };
  return {
    complex: new CellComplex(
      3,
      new Float64Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0
      ]),
      [edgeGroup, otherGroup]
    ),
    edgeGroup,
    otherGroup
  };
}

describe('representation map lineage', () => {
  it('records a dimension-checked perspective observation', () => {
    const projection = new PerspectiveProjection({
      fromDim: 6,
      viewDistance: 4,
      epsilon: 1e-5
    });
    const recipe = projectionMapRecipeN(projection);
    const lineage = createRepresentationLineageN(6, [recipe]);
    expect(lineage.sourceDim).toBe(6);
    expect(lineage.representationDim).toBe(3);
    expect(lineage.steps).toEqual([
      {
        kind: 'iterated-perspective-projection',
        fromDim: 6,
        toDim: 3,
        viewDistance: 4,
        epsilon: 1e-5
      }
    ]);
  });

  it('records an explicit coordinate-subspace observation', () => {
    const recipe = projectionMapRecipeN(new CoordinateProjection({
      fromDim: 4,
      axes: [0, 1, 3]
    }));
    expect(recipe).toEqual({
      kind: 'coordinate-subspace-projection',
      fromDim: 4,
      toDim: 3,
      retainedAxes: [0, 1, 3]
    });
  });

  it('separates an affine section from its display chart and snapshots both', () => {
    const slice = new HyperplaneSlice4({ normal: [1, 2, 3, 4], offset: 0.25 });
    const lineage = createRepresentationLineageN(4, [
      affineSectionMapRecipe4(slice),
      affineSliceChartMapRecipe4(slice)
    ]);
    expect(lineage.steps.map((step) => step.kind)).toEqual([
      'affine-section',
      'affine-slice-chart'
    ]);
    expect(lineage.representationDim).toBe(3);
    slice.offset = 9;
    expect(lineage.steps[0]).toMatchObject({ offset: 0.25 });
    expect(lineage.steps[1]).toMatchObject({ offset: 0.25 });
  });

  it('rejects recipes whose dimensions cannot compose', () => {
    expect(() =>
      createRepresentationLineageN(5, [
        affineSectionMapRecipe4(HyperplaneSlice4.axisAligned())
      ])
    ).toThrow(/expects R4, received R5/);
  });

  it('retains an honest custom-projection recipe without inventing capabilities', () => {
    const projection: Projection = {
      fromDim: 4,
      projectPoint: (point) => [point[0]!, point[1]!, point[2]!],
      projectPositions: (source, count, destination) => {
        for (let point = 0; point < count; point++) {
          destination.set(source.subarray(point * 4, point * 4 + 3), point * 3);
        }
      }
    };
    expect(projectionMapRecipeN(projection)).toEqual({
      kind: 'custom-projection',
      fromDim: 4,
      toDim: 3,
      label: 'Object'
    });
  });
});

describe('source cell reference lifecycle', () => {
  it('survives position edits and group reordering within one complex', () => {
    const { complex, edgeGroup, otherGroup } = referenceFixture();
    const reference = createSourceCellReferenceN(complex, edgeGroup, 1);
    expect(reference.vertexIndices).toEqual([1, 2]);
    expect(inspectSourceCellReferenceN(reference)).toEqual({
      kind: 'current',
      groupIndex: 0
    });

    complex.positions[3] = 2;
    complex.groups.splice(0, 2, otherGroup, edgeGroup);
    expect(inspectSourceCellReferenceN(reference)).toEqual({
      kind: 'current',
      groupIndex: 1
    });
  });

  it('retires when the referenced tuple changes or its group is removed', () => {
    const first = referenceFixture();
    const changed = createSourceCellReferenceN(first.complex, first.edgeGroup, 0);
    first.edgeGroup.indices[0] = 2;
    expect(inspectSourceCellReferenceN(changed)).toEqual({
      kind: 'retired',
      reason: 'cell-vertices-changed'
    });

    const second = referenceFixture();
    const removed = createSourceCellReferenceN(second.complex, second.edgeGroup, 0);
    second.complex.groups.splice(second.complex.groups.indexOf(second.edgeGroup), 1);
    expect(inspectSourceCellReferenceN(removed)).toEqual({
      kind: 'retired',
      reason: 'group-removed'
    });
  });

  it('does not pretend equivalent regenerated topology has the same identity', () => {
    const first = referenceFixture();
    const second = referenceFixture();
    const a = createSourceCellReferenceN(first.complex, first.edgeGroup, 0);
    const b = createSourceCellReferenceN(second.complex, second.edgeGroup, 0);
    expect(a.vertexIndices).toEqual(b.vertexIndices);
    expect(a.complex).not.toBe(b.complex);
    expect(a.group).not.toBe(b.group);
  });
});

describe('source edge coordinates', () => {
  it('projects an R5 point onto one explicitly selected source segment', () => {
    const edgeGroup: CellGroup = {
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    const complex = new CellComplex(
      5,
      new Float64Array([
        1, -2, 0, 4, 5,
        5, 2, 0, 0, 1
      ]),
      [edgeGroup]
    );
    const reference = createSourceCellReferenceN(complex, edgeGroup, 0);
    const projected = projectPointToSourceEdgeN(reference, [4, -3, 0, 3, 4]);

    expect(projected.coordinate.parameter).toBeCloseTo(0.25, 14);
    expect(projected.unclampedParameter).toBeCloseTo(0.25, 14);
    expect(projected.point.data).toEqual(new Float64Array([2, -1, 0, 3, 4]));
    expect(projected.squaredDistance).toBeCloseTo(8, 14);
  });

  it('recovers exact source parameters through an R5 perspective map', () => {
    const edgeGroup: CellGroup = {
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    const complex = new CellComplex(
      5,
      new Float64Array([
        -2, 1, 0.5, 1, -0.5,
        3, -1, 2, -1, 1
      ]),
      [edgeGroup]
    );
    const reference = createSourceCellReferenceN(complex, edgeGroup, 0);
    const projection = new PerspectiveProjection({ fromDim: 5, viewDistance: 10 });
    const transform = new TransformN(5, undefined, new VecN([0.3, -0.2, 0.4, 0.1, -0.2]));

    for (let sample = 0; sample <= 100; sample++) {
      const parameter = sample / 100;
      const coordinate = createSourceEdgeCoordinateN(reference, parameter);
      const ambient = transform.applyToPoint(evaluateSourceEdgeCoordinateN(coordinate));
      const target = projection.projectPoint(ambient.data);
      const fit = fitSourceEdgeCoordinateToProjectionN(reference, projection, target, {
        transform
      });
      expect(fit.kind).toBe('exact');
      if (fit.kind === 'unavailable') continue;
      expect(fit.coordinate.parameter).toBeCloseTo(parameter, 12);
      expect(fit.representationResidual).toBeLessThan(1e-12);
      expect(fit.roundTripResidual).toBeLessThan(1e-12);
    }
  });

  it('labels an off-edge target as least-squares and clamps endpoint misses', () => {
    const edgeGroup: CellGroup = {
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    const complex = new CellComplex(
      4,
      new Float64Array([
        0, 0, 0, 2,
        2, 0, 0, -3
      ]),
      [edgeGroup]
    );
    const reference = createSourceCellReferenceN(complex, edgeGroup, 0);
    const projection = new OrthographicProjection({ fromDim: 4 });

    const middle = fitSourceEdgeCoordinateToProjectionN(
      reference,
      projection,
      [1, 3, 0]
    );
    expect(middle.kind).toBe('least-squares');
    if (middle.kind !== 'unavailable') {
      expect(middle.coordinate.parameter).toBeCloseTo(0.5, 14);
      expect(middle.representationPoint).toEqual([1, 0, 0]);
      expect(middle.representationResidual).toBeCloseTo(3, 14);
      expect(middle.endpointClamped).toBe(false);
    }

    const before = fitSourceEdgeCoordinateToProjectionN(
      reference,
      projection,
      [-2, 1, 0]
    );
    expect(before.kind).toBe('least-squares');
    if (before.kind !== 'unavailable') {
      expect(before.coordinate.parameter).toBe(0);
      expect(before.unclampedRepresentationParameter).toBe(-1);
      expect(before.endpointClamped).toBe(true);
      expect(before.representationResidual).toBeCloseTo(Math.sqrt(5), 14);
    }
  });

  it('agrees with a dense source-parameter audit for a perspective miss', () => {
    const edgeGroup: CellGroup = {
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    const complex = new CellComplex(
      4,
      new Float64Array([
        -1.5, -0.4, 0.2, -1,
        2.2, 1.1, -0.8, 2
      ]),
      [edgeGroup]
    );
    const reference = createSourceCellReferenceN(complex, edgeGroup, 0);
    const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 5 });
    const target = [0.2, 1.7, -0.3] as const;
    const fit = fitSourceEdgeCoordinateToProjectionN(reference, projection, target);
    expect(fit.kind).toBe('least-squares');
    if (fit.kind === 'unavailable') return;

    let denseMinimum = Number.POSITIVE_INFINITY;
    for (let sample = 0; sample <= 20_000; sample++) {
      const point = evaluateSourceEdgeCoordinateN(
        createSourceEdgeCoordinateN(reference, sample / 20_000)
      );
      const represented = projection.projectPoint(point.data);
      denseMinimum = Math.min(
        denseMinimum,
        Math.hypot(
          represented[0] - target[0],
          represented[1] - target[1],
          represented[2] - target[2]
        )
      );
    }
    expect(fit.representationResidual).toBeLessThanOrEqual(denseMinimum + 1e-7);
    expect(fit.roundTripResidual).toBeLessThan(1e-12);
  });

  it('refuses invalid or collapsed projected source edges', () => {
    const edgeGroup: CellGroup = {
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    const complex = new CellComplex(
      4,
      new Float64Array([
        0, 0, 0, 4,
        0, 0, 0, -1
      ]),
      [edgeGroup]
    );
    const reference = createSourceCellReferenceN(complex, edgeGroup, 0);
    expect(fitSourceEdgeCoordinateToProjectionN(
      reference,
      new PerspectiveProjection({ fromDim: 4, viewDistance: 4 }),
      [0, 0, 0]
    )).toMatchObject({ kind: 'unavailable', reason: 'invalid-projection-vertex' });

    complex.positions[3] = 1;
    expect(fitSourceEdgeCoordinateToProjectionN(
      reference,
      new OrthographicProjection({ fromDim: 4 }),
      [0, 0, 0]
    )).toMatchObject({ kind: 'unavailable', reason: 'degenerate-projected-edge' });
  });

  it('clamps to the closed segment and preserves the edge tuple orientation', () => {
    const { complex, edgeGroup } = referenceFixture();
    const reference = createSourceCellReferenceN(complex, edgeGroup, 0);

    const before = projectPointToSourceEdgeN(reference, [-3, 1, 0]);
    const after = projectPointToSourceEdgeN(reference, [4, -2, 0]);
    expect(before.unclampedParameter).toBe(-3);
    expect(before.coordinate.parameter).toBe(0);
    expect(before.point.data).toEqual(new Float64Array([0, 0, 0]));
    expect(after.unclampedParameter).toBe(4);
    expect(after.coordinate.parameter).toBe(1);
    expect(after.point.data).toEqual(new Float64Array([1, 0, 0]));
  });

  it('follows live endpoint positions while source identity remains current', () => {
    const { complex, edgeGroup } = referenceFixture();
    const reference = createSourceCellReferenceN(complex, edgeGroup, 0);
    const coordinate = createSourceEdgeCoordinateN(reference, 0.25);
    expect(evaluateSourceEdgeCoordinateN(coordinate).data).toEqual(
      new Float64Array([0.25, 0, 0])
    );

    complex.positions.set([2, 2, 2], 0);
    complex.positions.set([6, 2, 2], 3);
    expect(evaluateSourceEdgeCoordinateN(coordinate).data).toEqual(
      new Float64Array([3, 2, 2])
    );
  });

  it('rejects non-edge, retired, out-of-range, and degenerate policies', () => {
    const { complex, edgeGroup } = referenceFixture();
    const edge = createSourceCellReferenceN(complex, edgeGroup, 0);
    expect(() => createSourceEdgeCoordinateN(edge, 1.2, { clamp: false })).toThrow(
      /outside \[0, 1\]/
    );

    edgeGroup.indices[0] = 2;
    expect(() => evaluateSourceEdgeCoordinateN({
      kind: 'source-edge-coordinate',
      reference: edge,
      parameter: 0.5
    })).toThrow(/retired/);

    const faceGroup: CellGroup = {
      dim: 2,
      verticesPerCell: 3,
      kind: 'simplex',
      indices: new Uint32Array([0, 1, 2])
    };
    complex.addGroup(faceGroup);
    expect(() => createSourceEdgeCoordinateN(
      createSourceCellReferenceN(complex, faceGroup, 0),
      0.5
    )).toThrow(/must name a 1-cell/);

    const degenerateGroup: CellGroup = {
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 0])
    };
    complex.addGroup(degenerateGroup);
    expect(() => projectPointToSourceEdgeN(
      createSourceCellReferenceN(complex, degenerateGroup, 0),
      [2, 2, 2]
    )).toThrow(/geometrically degenerate/);
  });
});

describe('multi-observation source edge coordinates', () => {
  function observationFixture(): {
    reference: ReturnType<typeof createSourceCellReferenceN>;
    perspective: PerspectiveProjection;
    xyw: CoordinateProjection;
  } {
    const edgeGroup: CellGroup = {
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    };
    const complex = new CellComplex(
      4,
      new Float64Array([
        -1.2, 0.4, -0.8, -1.1,
        2.4, -1.6, 1.7, 1.3
      ]),
      [edgeGroup]
    );
    return {
      reference: createSourceCellReferenceN(complex, edgeGroup, 0),
      perspective: new PerspectiveProjection({ fromDim: 4, viewDistance: 6 }),
      xyw: new CoordinateProjection({ fromDim: 4, axes: [0, 1, 3] })
    };
  }

  it('recovers one exact source coordinate from simultaneous perspective and XYW observations', () => {
    const { reference, perspective, xyw } = observationFixture();
    const transform = new TransformN(
      4,
      undefined,
      new VecN([0.2, -0.3, 0.1, 0.4])
    );
    const expected = createSourceEdgeCoordinateN(reference, 0.37);
    const ambient = transform.applyToPoint(evaluateSourceEdgeCoordinateN(expected));
    const fit = fitSourceEdgeCoordinateToObservationsN(
      reference,
      [
        {
          key: 'view:perspective',
          label: 'perspective',
          projection: perspective,
          targetPoint: perspective.projectPoint(ambient.data)
        },
        {
          key: 'view:xyw',
          label: 'XYW',
          projection: xyw,
          targetPoint: xyw.projectPoint(ambient.data)
        }
      ],
      { transform }
    );
    expect(fit.kind).toBe('exact');
    if (fit.kind === 'unavailable') return;
    expect(fit.consistency).toBe('compatible');
    expect(fit.determination).toBe('unique');
    expect(fit.observationRank).toBe(1);
    expect(fit.unresolvedDegreesOfFreedom).toBe(0);
    expect(fit.constraintNormalResidual).toBeLessThan(1e-13);
    expect(fit.coordinate.parameter).toBeCloseTo(0.37, 13);
    expect(fit.sourceParameterSpread).toBeLessThan(1e-13);
    expect(fit.parameterRmsResidual).toBeLessThan(1e-13);
    expect(fit.representationRmsResidual).toBeLessThan(1e-12);
    expect(fit.observations.map((observation) => observation.label)).toEqual([
      'perspective',
      'XYW'
    ]);
    expect(fit.observations.map((observation) => observation.key)).toEqual([
      'view:perspective',
      'view:xyw'
    ]);
  });

  it('reports conflicting observations and returns their weighted source-parameter optimum', () => {
    const { reference, perspective, xyw } = observationFixture();
    const at = (parameter: number, projection: PerspectiveProjection | CoordinateProjection) =>
      projection.projectPoint(evaluateSourceEdgeCoordinateN(
        createSourceEdgeCoordinateN(reference, parameter)
      ).data);
    const fit = fitSourceEdgeCoordinateToObservationsN(reference, [
      {
        projection: perspective,
        targetPoint: at(0.2, perspective),
        weight: 1
      },
      {
        projection: xyw,
        targetPoint: at(0.8, xyw),
        weight: 3
      }
    ]);
    expect(fit.kind).toBe('least-squares');
    if (fit.kind === 'unavailable') return;
    expect(fit.consistency).toBe('conflicting');
    expect(fit.coordinate.parameter).toBeCloseTo(0.65, 14);
    expect(fit.sourceParameterSpread).toBeCloseTo(0.6, 14);
    expect(fit.parameterRmsResidual).toBeCloseTo(Math.sqrt(0.0675), 14);

    let denseBestParameter = 0;
    let denseBestObjective = Number.POSITIVE_INFINITY;
    for (let sample = 0; sample <= 20_000; sample++) {
      const parameter = sample / 20_000;
      const objective = (parameter - 0.2) ** 2 + 3 * (parameter - 0.8) ** 2;
      if (objective < denseBestObjective) {
        denseBestObjective = objective;
        denseBestParameter = parameter;
      }
    }
    expect(fit.coordinate.parameter).toBeCloseTo(denseBestParameter, 4);
  });

  it('distinguishes view agreement from exact representation targets', () => {
    const { reference, perspective, xyw } = observationFixture();
    const parameter = 0.42;
    const source = evaluateSourceEdgeCoordinateN(
      createSourceEdgeCoordinateN(reference, parameter)
    );
    const offsetPerpendicular = (
      projection: PerspectiveProjection | CoordinateProjection,
      amount: number
    ): [number, number, number] => {
      const target = projection.projectPoint(source.data);
      const from = projection.projectPoint(reference.complex.getPosition(0));
      const to = projection.projectPoint(reference.complex.getPosition(1));
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const length = Math.hypot(dx, dy);
      target[0] += amount * -dy / length;
      target[1] += amount * dx / length;
      return target;
    };
    const perspectiveTarget = offsetPerpendicular(perspective, 0.4);
    const xywTarget = offsetPerpendicular(xyw, 0.7);
    const fit = fitSourceEdgeCoordinateToObservationsN(reference, [
      { projection: perspective, targetPoint: perspectiveTarget },
      { projection: xyw, targetPoint: xywTarget }
    ]);
    expect(fit.kind).toBe('least-squares');
    if (fit.kind === 'unavailable') return;
    expect(fit.consistency).toBe('compatible');
    expect(fit.coordinate.parameter).toBeCloseTo(parameter, 13);
    expect(fit.representationRmsResidual).toBeGreaterThan(0.4);
  });

  it('makes absent or unusable evidence explicit', () => {
    const { reference, perspective } = observationFixture();
    expect(fitSourceEdgeCoordinateToObservationsN(reference, [])).toEqual({
      kind: 'unavailable',
      reason: 'no-observations'
    });

    reference.complex.positions[3] = perspective.viewDistance;
    expect(fitSourceEdgeCoordinateToObservationsN(reference, [{
      projection: perspective,
      targetPoint: [0, 0, 0]
    }])).toMatchObject({
      kind: 'unavailable',
      reason: 'observation-unavailable',
      observationIndex: 0,
      observationReason: 'invalid-projection-vertex'
    });
  });
});

describe('source simplex coordinates and multi-view determination', () => {
  function simplex4Fixture(order = [0, 1, 2, 3, 4]): {
    reference: ReturnType<typeof createSourceSimplexReferenceN>;
    complex: CellComplex;
  } {
    const group: CellGroup = {
      dim: 4,
      verticesPerCell: 5,
      kind: 'simplex',
      indices: Uint32Array.from(order)
    };
    const complex = new CellComplex(
      4,
      new Float64Array([
        0, 0, 0, 0,
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ]),
      [group]
    );
    const parent = createSourceCellReferenceN(complex, group, 0);
    return {
      reference: createSourceSimplexReferenceN(parent),
      complex
    };
  }

  it('retains an authored simplex inside a non-simplex parent lifecycle', () => {
    const parentGroup: CellGroup = {
      dim: 2,
      verticesPerCell: 4,
      kind: 'cuboid',
      indices: new Uint32Array([0, 1, 2, 3])
    };
    const complex = new CellComplex(
      4,
      new Float64Array([
        0, 0, 0, 0,
        1, 0, 0, 0,
        1, 1, 0, 0,
        0, 1, 0, 0
      ]),
      [parentGroup]
    );
    const parent = createSourceCellReferenceN(complex, parentGroup, 0);
    const reference = createSourceSimplexReferenceN(parent, [0, 1, 2]);
    const coordinate = createSourceSimplexCoordinateN(reference, [0.2, 0.3, 0.5]);
    expect(evaluateSourceSimplexCoordinateN(coordinate).toArray()).toEqual([
      0.8, 0.5, 0, 0
    ]);
    expect(inspectSourceSimplexReferenceN(reference).kind).toBe('current');

    complex.positions[4] = 2;
    expect(evaluateSourceSimplexCoordinateN(coordinate).data[0]).toBeCloseTo(1.1, 14);
    parentGroup.indices[0] = 3;
    expect(inspectSourceSimplexReferenceN(reference)).toEqual({
      kind: 'retired',
      reason: 'cell-vertices-changed'
    });
    expect(() => evaluateSourceSimplexCoordinateN(coordinate)).toThrow(/retired/);
  });

  it('projects onto the closed simplex and audits the active face against a dense grid', () => {
    const group: CellGroup = {
      dim: 2,
      verticesPerCell: 3,
      kind: 'simplex',
      indices: new Uint32Array([0, 1, 2])
    };
    const complex = new CellComplex(
      4,
      new Float64Array([
        0, 0, 0, 0,
        1, 0, 0, 0,
        0, 1, 0, 0
      ]),
      [group]
    );
    const reference = createSourceSimplexReferenceN(
      createSourceCellReferenceN(complex, group, 0)
    );
    const projected = projectPointToSourceSimplexN(reference, [2, 2, 0, 0]);
    expect(projected.coordinate.weights[0]).toBeCloseTo(0, 13);
    expect(projected.coordinate.weights[1]).toBeCloseTo(0.5, 13);
    expect(projected.coordinate.weights[2]).toBeCloseTo(0.5, 13);
    expect(projected.point.toArray()).toEqual([0.5, 0.5, 0, 0]);
    expect(projected.squaredDistance).toBeCloseTo(4.5, 13);
    expect(projected.affineRank).toBe(2);

    let denseMinimum = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 400; i++) {
      for (let j = 0; j <= 400 - i; j++) {
        const x = i / 400;
        const y = j / 400;
        denseMinimum = Math.min(denseMinimum, (x - 2) ** 2 + (y - 2) ** 2);
      }
    }
    expect(projected.squaredDistance).toBeLessThanOrEqual(denseMinimum + 1e-12);
  });

  it('reports the unavoidable rank loss of one R4-to-R3 observation', () => {
    const { reference } = simplex4Fixture();
    const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 8 });
    const source = createSourceSimplexCoordinateN(
      reference,
      [0.1, 0.2, 0.15, 0.25, 0.3]
    );
    const target = projection.projectPoint(
      evaluateSourceSimplexCoordinateN(source).data
    );
    const fit = fitSourceSimplexCoordinateToObservationsN(reference, [{
      label: 'perspective',
      projection,
      targetPoint: target
    }]);
    expect(fit.kind).toBe('exact');
    if (fit.kind === 'unavailable') return;
    expect(fit.consistency).toBe('compatible');
    expect(fit.determination).toBe('rank-deficient');
    expect(fit.sourceDegreesOfFreedom).toBe(4);
    expect(fit.observationRank).toBe(3);
    expect(fit.unresolvedDegreesOfFreedom).toBe(1);
    expect(fit.observations[0]!.individualRank).toBe(3);
    expect(fit.representationRmsResidual).toBeLessThan(1e-13);
  });

  it('uses an explicit prior only within the unresolved null space', () => {
    const { reference } = simplex4Fixture();
    const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 8 });
    const prior = createSourceSimplexCoordinateN(
      reference,
      [0.1, 0.2, 0.15, 0.25, 0.3]
    );
    const point = evaluateSourceSimplexCoordinateN(prior);
    const fit = fitSourceSimplexCoordinateToObservationsN(
      reference,
      [{ projection, targetPoint: projection.projectPoint(point.data) }],
      { prior }
    );
    expect(fit.kind).toBe('exact');
    if (fit.kind === 'unavailable') return;
    expect(fit.determination).toBe('rank-deficient');
    for (let vertex = 0; vertex < prior.weights.length; vertex++) {
      expect(fit.coordinate.weights[vertex]).toBeCloseTo(prior.weights[vertex]!, 12);
    }
  });

  it('becomes uniquely determined when perspective and XYW constrain complementary directions', () => {
    const { reference } = simplex4Fixture();
    const perspective = new PerspectiveProjection({ fromDim: 4, viewDistance: 8 });
    const xyw = new CoordinateProjection({ fromDim: 4, axes: [0, 1, 3] });
    const expected = createSourceSimplexCoordinateN(
      reference,
      [0.1, 0.2, 0.15, 0.25, 0.3]
    );
    const point = evaluateSourceSimplexCoordinateN(expected);
    const fit = fitSourceSimplexCoordinateToObservationsN(reference, [
      { key: 'view:perspective', label: 'perspective', projection: perspective, targetPoint: perspective.projectPoint(point.data) },
      { key: 'view:xyw', label: 'XYW', projection: xyw, targetPoint: xyw.projectPoint(point.data) }
    ]);
    expect(fit.kind).toBe('exact');
    if (fit.kind === 'unavailable') return;
    expect(fit.determination).toBe('unique');
    expect(fit.observationRank).toBe(4);
    expect(fit.unresolvedDegreesOfFreedom).toBe(0);
    expect(fit.constraintNormalResidual).toBeLessThan(1e-12);
    expect(fit.observations.map((observation) => observation.key)).toEqual([
      'view:perspective',
      'view:xyw'
    ]);
    for (let vertex = 0; vertex < expected.weights.length; vertex++) {
      expect(fit.coordinate.weights[vertex]).toBeCloseTo(expected.weights[vertex]!, 12);
    }
  });

  it('labels incompatible view targets instead of inventing a common source point', () => {
    const { reference } = simplex4Fixture();
    const perspective = new PerspectiveProjection({ fromDim: 4, viewDistance: 8 });
    const xyw = new CoordinateProjection({ fromDim: 4, axes: [0, 1, 3] });
    const a = evaluateSourceSimplexCoordinateN(
      createSourceSimplexCoordinateN(reference, [0.1, 0.6, 0.1, 0.1, 0.1])
    );
    const b = evaluateSourceSimplexCoordinateN(
      createSourceSimplexCoordinateN(reference, [0.1, 0.1, 0.1, 0.1, 0.6])
    );
    const fit = fitSourceSimplexCoordinateToObservationsN(reference, [
      { projection: perspective, targetPoint: perspective.projectPoint(a.data) },
      { projection: xyw, targetPoint: xyw.projectPoint(b.data) }
    ]);
    expect(fit.kind).toBe('least-squares');
    if (fit.kind === 'unavailable') return;
    expect(fit.consistency).toBe('conflicting');
    expect(fit.determination).toBe('unique');
    expect(fit.normalizedEquationRms).toBeGreaterThan(1e-3);
    expect(fit.representationRmsResidual).toBeGreaterThan(0.1);
  });

  it('validates barycentric coordinates, derived vertices, and candidate bounds', () => {
    const { reference } = simplex4Fixture();
    expect(() => createSourceSimplexCoordinateN(
      reference,
      [0.2, 0.2, 0.2, 0.2, 0.3]
    )).toThrow(/sum to one/);
    expect(() => createSourceSimplexCoordinateN(
      reference,
      [0.4, 0.4, 0.4, -0.2, 0]
    )).toThrow(/outside the simplex/);
    expect(() => createSourceSimplexReferenceN(
      reference.parent,
      [0, 1, 7]
    )).toThrow(/does not belong/);

    const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 8 });
    expect(fitSourceSimplexCoordinateToObservationsN(reference, [{
      projection,
      targetPoint: [0, 0, 0]
    }], { maxCandidateFaces: 10 })).toMatchObject({
      kind: 'unavailable',
      reason: 'too-many-simplex-faces'
    });
  });
});
