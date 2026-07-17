import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  HyperplaneSlice4,
  PerspectiveProjection,
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
    expect(hit.ambiguity).toBe('projection-overlap');
    expect(hit.source.kind).toBe('cell');
    if (hit.source.kind === 'cell') {
      expect(hit.source.complex).toBe(complex);
      expect(hit.source.intrinsicDim).toBe(1);
      expect(hit.source.cellIndex).toBe(1);
      expect(hit.source.vertexIndices).toEqual(product.edgeVertices(1));
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
    expect(hit.source.kind).toBe('cell');
    if (hit.source.kind === 'cell') {
      expect(hit.source.cellIndex).toBe(product.sourceFaceOfTriangle(3));
      expect(hit.source.vertexIndices).toEqual(product.faceVertices(3));
    }
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
