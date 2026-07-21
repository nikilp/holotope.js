import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  CellComplex,
  HyperplaneSlice4,
  OrthographicProjection,
  PerspectiveProjection,
  evaluateProjectionFibre,
  inspectSourceCellReferenceN,
  isPointInProjectionFibreDomain,
  createHypercube,
  tetrahedralizeCuboidCells,
  type FieldEvaluation4,
  type ImplicitField4
} from '@holotope/core';
import {
  ProjectedEdges3D,
  ProjectedSurface3D,
  SampledSlicedField3D,
  SlicedComplex3D,
  representationHitFromProjectedEdge,
  representationHitFromProjectedSurface,
  representationHitFromSampledSlicedField,
  representationHitFromSlicedComplex
} from '@holotope/three';

function rationalSimplex4(): CellComplex {
  return new CellComplex(
    4,
    new Float64Array([
      1, 1, 1, 1,
      -1, 1, 1, 1,
      1, -1, 1, -1
    ]),
    [
      {
        dim: 1,
        verticesPerCell: 2,
        kind: 'simplex',
        indices: new Uint32Array([0, 2])
      },
      {
        dim: 2,
        verticesPerCell: 3,
        kind: 'simplex',
        indices: new Uint32Array([0, 1, 2])
      }
    ]
  );
}

function sphereField(): ImplicitField4 {
  return {
    id: 'representation-sphere',
    symmetries: [],
    sliceTheorems: [],
    evalCPU(point): FieldEvaluation4 {
      const magnitude = Math.hypot(point[0]!, point[1]!, point[2]!, point[3]!);
      return {
        value: magnitude - 1,
        escaped: magnitude > 1,
        iterations: 1,
        magnitude,
        potential: Math.max(0, magnitude - 1),
        distance: Math.abs(magnitude - 1),
        orbitTrap: magnitude,
        finalPoint: [point[0]!, point[1]!, point[2]!, point[3]!]
      };
    }
  };
}

function expectCoordinatesClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>
): void {
  expect(actual.length).toBe(expected.length);
  for (let coordinate = 0; coordinate < actual.length; coordinate++) {
    expect(actual[coordinate]!).toBeCloseTo(expected[coordinate]!, 13);
  }
}

function expectCoordinatesWithin(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  tolerance: number
): void {
  expect(actual.length).toBe(expected.length);
  for (let coordinate = 0; coordinate < actual.length; coordinate++) {
    expect(Math.abs(actual[coordinate]! - expected[coordinate]!)).toBeLessThan(
      tolerance
    );
  }
}

describe('unified representation provenance', () => {
  it('retains an exact source edge without inventing an inverse projection', () => {
    const complex = createHypercube({ dim: 4 });
    const product = new ProjectedEdges3D(
      complex,
      new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
    );
    const hit = representationHitFromProjectedEdge(product, {
      point: new Vector3(0.1, 0.2, 0.3),
      index: 2
    });

    expect(hit.representation).toBe('projected-edge');
    expect(hit.point3).toEqual([0.1, 0.2, 0.3]);
    expect(hit.ambientPointStatus).toBe('unavailable');
    expect(hit.details?.liftFailure).toBe('point-off-simplex');
    expect(hit.ambiguity).toBe('projection-overlap');
    expect(hit.lineage.steps.map((step) => step.kind)).toEqual([
      'iterated-perspective-projection'
    ]);
    expect(hit.source.kind).toBe('cell');
    if (hit.source.kind === 'cell') {
      expect(hit.source.complex).toBe(complex);
      expect(hit.source.intrinsicDim).toBe(1);
      expect(hit.source.cellIndex).toBe(1);
      expect(hit.source.vertexIndices).toEqual(product.edgeVertices(1));
      expect(inspectSourceCellReferenceN(hit.source.reference).kind).toBe('current');
    }
    product.dispose();
  });

  it('retains a source face and triangle vertices for a projected surface', () => {
    const complex = createHypercube({ dim: 4 });
    const product = new ProjectedSurface3D(
      complex,
      new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
    );
    const hit = representationHitFromProjectedSurface(product, {
      point: new Vector3(-0.4, 0.5, 0.2),
      faceIndex: 3
    });

    expect(hit.ambientPoint).toBeUndefined();
    expect(hit.ambientPointStatus).toBe('unavailable');
    expect(hit.details?.liftFailure).toBeTruthy();
    expect(hit.source.kind).toBe('cell');
    if (hit.source.kind === 'cell') {
      expect(hit.source.cellIndex).toBe(product.sourceFaceOfTriangle(3));
      expect(hit.source.vertexIndices).toEqual(product.faceVertices(3));
    }
    product.dispose();
  });

  it('lifts a projected edge exactly with perspective-correct source weights', () => {
    const projection = new PerspectiveProjection({
      fromDim: 4,
      viewDistance: 2
    });
    const product = new ProjectedEdges3D(rationalSimplex4(), projection);
    product.object.position.set(3, -2, 1);
    product.object.updateWorldMatrix(true, false);
    const pointLocal = [4 / 3, 2 / 3, 4 / 3] as const;
    const hit = representationHitFromProjectedEdge(product, {
      point: new Vector3(
        pointLocal[0] + 3,
        pointLocal[1] - 2,
        pointLocal[2] + 1
      ),
      index: 0
    });

    expect(hit.ambientPointStatus).toBe('exact');
    expect(hit.ambiguity).toBe('projection-overlap');
    expect(hit.lineage.representationDim).toBe(3);
    expectCoordinatesClose(hit.ambientPoint!.data, [1, 0.5, 1, 0.5]);
    expectCoordinatesClose(
      hit.details?.representationWeights as readonly number[],
      [0.5, 0.5]
    );
    expectCoordinatesClose(
      hit.details?.sourceWeights as readonly number[],
      [0.75, 0.25]
    );
    expectCoordinatesClose(
      projection.projectPoint(hit.ambientPoint!.data),
      pointLocal
    );
    const fibre = projection.inverseFibre(pointLocal);
    expect(isPointInProjectionFibreDomain(fibre, hit.ambientPoint!)).toBe(true);
    expect(
      evaluateProjectionFibre(fibre, [hit.ambientPoint!.data[3]!]).equalsApprox(
        hit.ambientPoint!,
        1e-12
      )
    ).toBe(true);
    product.dispose();
  });

  it('lifts a projected triangle through a translated Three.js representation frame', () => {
    const projection = new PerspectiveProjection({
      fromDim: 4,
      viewDistance: 2
    });
    const product = new ProjectedSurface3D(rationalSimplex4(), projection);
    product.object.position.set(-4, 3, 2);
    product.object.updateWorldMatrix(true, false);
    // Source weights (1/4, 1/4, 1/2) become representation weights
    // (1/8, 1/8, 3/4) after perspective division.
    const pointLocal = [0.5, 0, 1] as const;
    const hit = representationHitFromProjectedSurface(product, {
      point: new Vector3(
        pointLocal[0] - 4,
        pointLocal[1] + 3,
        pointLocal[2] + 2
      ),
      faceIndex: 0
    });

    expect(hit.ambientPointStatus).toBe('exact');
    expect(hit.ambiguity).toBe('projection-overlap');
    expectCoordinatesClose(hit.ambientPoint!.data, [0.5, 0, 1, 0]);
    expectCoordinatesClose(
      hit.details?.representationWeights as readonly number[],
      [0.125, 0.125, 0.75]
    );
    expectCoordinatesClose(
      hit.details?.sourceWeights as readonly number[],
      [0.25, 0.25, 0.5]
    );
    expect(hit.details?.minAbsQ).toBe(0.5);
    expectCoordinatesClose(
      projection.projectPoint(hit.ambientPoint!.data),
      pointLocal
    );
    product.dispose();
  });

  it('differentially recovers source points from Float32 triangle hits', () => {
    const projection = new PerspectiveProjection({
      fromDim: 4,
      viewDistance: 2
    });
    const product = new ProjectedSurface3D(rationalSimplex4(), projection);
    const positions = product.geometry.getAttribute('position').array as Float32Array;
    const source = [
      [1, 1, 1, 1],
      [-1, 1, 1, 1],
      [1, -1, 1, -1]
    ] as const;
    const q = [0.5, 0.5, 1.5] as const;
    let state = 0x6d2b79f5;

    for (let sample = 0; sample < 64; sample++) {
      const raw = new Float64Array(3);
      let rawSum = 0;
      for (let vertex = 0; vertex < 3; vertex++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        raw[vertex] = 0.05 + state / 0x100000000;
        rawSum += raw[vertex]!;
      }
      const sourceWeights = Array.from(raw, (weight) => weight / rawSum);
      const weightedQ = sourceWeights.reduce(
        (sum, weight, vertex) => sum + weight * q[vertex]!,
        0
      );
      const representationWeights = sourceWeights.map(
        (weight, vertex) => weight * q[vertex]! / weightedQ
      );
      const point = new Vector3();
      for (let vertex = 0; vertex < 3; vertex++) {
        point.x += representationWeights[vertex]! * positions[vertex * 3]!;
        point.y += representationWeights[vertex]! * positions[vertex * 3 + 1]!;
        point.z += representationWeights[vertex]! * positions[vertex * 3 + 2]!;
      }
      const hit = representationHitFromProjectedSurface(product, {
        point,
        faceIndex: 0
      });
      const expectedAmbient = new Float64Array(4);
      for (let vertex = 0; vertex < 3; vertex++) {
        for (let coordinate = 0; coordinate < 4; coordinate++) {
          expectedAmbient[coordinate]! +=
            sourceWeights[vertex]! * source[vertex]![coordinate]!;
        }
      }

      expect(hit.ambientPointStatus).toBe('exact');
      expectCoordinatesWithin(
        hit.details?.sourceWeights as readonly number[],
        sourceWeights,
        2e-7
      );
      expectCoordinatesWithin(hit.ambientPoint!.data, expectedAmbient, 4e-7);
      expectCoordinatesWithin(
        projection.projectPoint(hit.ambientPoint!.data),
        point.toArray(),
        2e-7
      );
    }
    product.dispose();
  });

  it('lifts an orthographic triangle affinely', () => {
    const product = new ProjectedSurface3D(
      rationalSimplex4(),
      new OrthographicProjection({ fromDim: 4 })
    );
    const hit = representationHitFromProjectedSurface(product, {
      point: new Vector3(0.5, 0, 1),
      faceIndex: 0
    });
    expect(hit.ambientPointStatus).toBe('exact');
    expectCoordinatesClose(hit.ambientPoint!.data, [0.5, 0, 1, 0]);
    expectCoordinatesClose(
      hit.details?.representationWeights as readonly number[],
      hit.details?.sourceWeights as readonly number[]
    );
    product.dispose();
  });

  it('refuses a lift when a projected simplex reaches the perspective guard', () => {
    const complex = new CellComplex(
      4,
      new Float64Array([
        0, 0, 0, 3,
        1, 0, 0, 3,
        0, 1, 0, 3
      ]),
      [{
        dim: 2,
        verticesPerCell: 3,
        kind: 'simplex',
        indices: new Uint32Array([0, 1, 2])
      }]
    );
    const product = new ProjectedSurface3D(
      complex,
      new PerspectiveProjection({ fromDim: 4, viewDistance: 2 })
    );
    const positions = product.geometry.getAttribute('position').array as Float32Array;
    const hit = representationHitFromProjectedSurface(product, {
      point: new Vector3(
        (positions[0]! + positions[3]! + positions[6]!) / 3,
        (positions[1]! + positions[4]! + positions[7]!) / 3,
        (positions[2]! + positions[5]! + positions[8]!) / 3
      ),
      faceIndex: 0
    });
    expect(hit.ambientPointStatus).toBe('unavailable');
    expect(hit.ambientPoint).toBeUndefined();
    expect(hit.details?.liftFailure).toBe('invalid-projection-vertex');
    product.dispose();
  });

  it('refuses a lift through a degenerate projected simplex', () => {
    const complex = new CellComplex(
      4,
      new Float64Array([
        0, 0, 0, 0,
        0, 0, 0, 1,
        0, 0, 0, -1
      ]),
      [{
        dim: 2,
        verticesPerCell: 3,
        kind: 'simplex',
        indices: new Uint32Array([0, 1, 2])
      }]
    );
    const product = new ProjectedSurface3D(
      complex,
      new OrthographicProjection({ fromDim: 4 })
    );
    const hit = representationHitFromProjectedSurface(product, {
      point: new Vector3(),
      faceIndex: 0
    });
    expect(hit.ambientPointStatus).toBe('unavailable');
    expect(hit.details?.liftFailure).toBe('degenerate-simplex');
    product.dispose();
  });

  it('lifts an unprojected slice hit exactly through the object transform', () => {
    const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4 }));
    const slice = HyperplaneSlice4.axisAligned(3, 0.25);
    const product = new SlicedComplex3D(complex, slice);
    product.object.position.set(3, -2, 1);
    product.object.updateWorldMatrix(true, false);
    const hit = representationHitFromSlicedComplex(product, {
      point: new Vector3(3.2, -2.3, 1.4),
      faceIndex: 0
    });

    expect(hit.ambientPointStatus).toBe('exact');
    expect(hit.ambiguity).toBe('none');
    expect(hit.lineage.steps.map((step) => step.kind)).toEqual([
      'affine-section',
      'affine-slice-chart'
    ]);
    expect(hit.details?.sliceConstruction).toBe('edge-interpolation');
    expect((hit.details?.crossingEdgeVertices as readonly number[]).length).toBe(6);
    expect((hit.details?.crossingParameters as readonly number[]).length).toBe(3);
    expectCoordinatesClose(hit.ambientPoint!.data, [0.2, -0.3, 0.4, 0.25]);
    expect(hit.source.kind).toBe('cell');
    if (hit.source.kind === 'cell') {
      expect(hit.source.intrinsicDim).toBe(3);
      expect(hit.source.vertexIndices).toEqual(
        product.sourceTetVertices(product.sourceTetOfFace(0))
      );
    }
    product.dispose();
  });

  it('does not falsely lift a section rendered through perspective projection', () => {
    const product = new SlicedComplex3D(
      tetrahedralizeCuboidCells(createHypercube({ dim: 4 })),
      HyperplaneSlice4.axisAligned(3, 0.25),
      { projection: new PerspectiveProjection({ fromDim: 4, viewDistance: 4 }) }
    );
    const hit = representationHitFromSlicedComplex(product, {
      point: new Vector3(0.2, -0.3, 0.4),
      faceIndex: 0
    });

    expect(hit.ambientPointStatus).toBe('unavailable');
    expect(hit.ambientPoint).toBeUndefined();
    expect(hit.ambiguity).toBe('projection-overlap');
    expect(hit.lineage.steps.map((step) => step.kind)).toEqual([
      'affine-section',
      'iterated-perspective-projection'
    ]);
    expect(hit.source.kind).toBe('cell');
    product.dispose();
  });

  it('declares sampled surface position approximate while retaining its grid cell', () => {
    const field = sphereField();
    const slice = HyperplaneSlice4.axisAligned(3, -0.2);
    const product = new SampledSlicedField3D(field, slice, {
      resolution: 9,
      extent: 1.25
    });
    product.object.position.set(-1, 2, 0.5);
    product.object.updateWorldMatrix(true, false);
    const hit = representationHitFromSampledSlicedField(product, {
      point: new Vector3(-0.9, 1.8, 0.8),
      faceIndex: 0
    });

    expect(hit.ambientPointStatus).toBe('approximate');
    expect(hit.ambiguity).toBe('sampled-surface');
    expect(hit.lineage.steps.map((step) => step.kind)).toEqual([
      'field-restriction',
      'sampled-isosurface'
    ]);
    expectCoordinatesClose(hit.ambientPoint!.data, [0.1, -0.2, 0.3, -0.2]);
    expect(hit.source.kind).toBe('sample-cell');
    if (hit.source.kind === 'sample-cell') {
      expect(hit.source.field).toBe(field);
      expect(hit.source.cellIndex).toBe(product.sourceCellOfFace(0));
    }
    product.dispose();
  });

  it('rejects incomplete renderer intersections at the adapter boundary', () => {
    const product = new ProjectedSurface3D(
      createHypercube({ dim: 4 }),
      new PerspectiveProjection({ fromDim: 4 })
    );
    expect(() => representationHitFromProjectedSurface(product, {
      point: new Vector3()
    })).toThrow(/faceIndex/);
    product.dispose();
  });
});
