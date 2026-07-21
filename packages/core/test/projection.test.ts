import { describe, expect, it } from 'vitest';
import {
  CoordinateProjection,
  OrthographicProjection,
  PerspectiveProjection,
  VecN,
  evaluateProjectionFibre,
  isPointInProjectionFibreDomain,
  liftHomogeneousSimplexPointN,
  projectionDomainMargin
} from '@holotope/core';

describe('CoordinateProjection', () => {
  it('retains any named three-axis coordinate subspace without copying source data', () => {
    const projection = new CoordinateProjection({
      fromDim: 5,
      axes: [0, 2, 4]
    });
    const source = [1, 2, 3, 4, 5];
    expect(projection.projectPoint(source)).toEqual([1, 3, 5]);
    expect(
      applyHomogeneousMatrix(projection.homogeneousMatrix(), 5, source)
    ).toEqual([1, 3, 5, 1]);

    const packed = new Float64Array(8);
    const validity = new Uint8Array(2);
    projection.projectHomogeneousPositions(
      new Float64Array([...source, -1, -2, -3, -4, -5]),
      2,
      packed,
      validity
    );
    expect(Array.from(packed)).toEqual([1, 3, 5, 1, -1, -3, -5, 1]);
    expect(Array.from(validity)).toEqual([1, 1]);
  });

  it('exposes the omitted-coordinate fibre in source-axis order', () => {
    const projection = new CoordinateProjection({
      fromDim: 5,
      axes: [0, 2, 4]
    });
    const fibre = projection.inverseFibre([1, 3, 5]);
    expect(fibre.directions.map((direction) => direction.toArray())).toEqual([
      [0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0]
    ]);
    const source = evaluateProjectionFibre(fibre, [2, 4]);
    expect(source.toArray()).toEqual([1, 2, 3, 4, 5]);
    expect(projection.projectPoint(source.data)).toEqual([1, 3, 5]);
  });

  it('rejects repeated or out-of-range retained axes', () => {
    expect(() => new CoordinateProjection({
      fromDim: 4,
      axes: [0, 0, 3]
    })).toThrow(/distinct/);
    expect(() => new CoordinateProjection({
      fromDim: 4,
      axes: [0, 2, 4]
    })).toThrow(/outside R4/);
  });
});

describe('OrthographicProjection', () => {
  it('keeps the first three coordinates', () => {
    const proj = new OrthographicProjection({ fromDim: 5 });
    expect(proj.projectPoint([1, 2, 3, 4, 5])).toEqual([1, 2, 3]);
  });

  it('projects packed positions', () => {
    const proj = new OrthographicProjection({ fromDim: 4 });
    const src = new Float64Array([1, 2, 3, 9, 4, 5, 6, -9]);
    const dst = new Float32Array(6);
    proj.projectPositions(src, 2, dst);
    expect(Array.from(dst)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('exposes an exact homogeneous matrix and unbounded inverse fibre', () => {
    const projection = new OrthographicProjection({ fromDim: 5 });
    const source = [1, 2, 3, 4, 5];
    const result = projection.projectHomogeneousPoint(source);
    expect(result.coordinates).toEqual([1, 2, 3, 1]);
    expect(result.validity).toEqual({ kind: 'unconditional', valid: true });
    expect(applyHomogeneousMatrix(projection.homogeneousMatrix(), 5, source)).toEqual(
      result.coordinates
    );

    const fibre = projection.inverseFibre([1, 2, 3]);
    expect(fibre.directions).toHaveLength(2);
    expect(fibre.domain.kind).toBe('unbounded');
    const lifted = evaluateProjectionFibre(fibre, [4, 5]);
    expect(lifted.toArray()).toEqual(source);
    expect(projection.projectPoint(lifted.data)).toEqual([1, 2, 3]);
    expect(isPointInProjectionFibreDomain(fibre, lifted)).toBe(true);
  });

  it('writes packed Float64 homogeneous coordinates and validity', () => {
    const projection = new OrthographicProjection({ fromDim: 4 });
    const src = new Float64Array([1, 2, 3, 9, 4, 5, 6, -9]);
    const dst = new Float64Array(8);
    const validity = new Uint8Array(2);
    projection.projectHomogeneousPositions(src, 2, dst, validity);
    expect(Array.from(dst)).toEqual([1, 2, 3, 1, 4, 5, 6, 1]);
    expect(Array.from(validity)).toEqual([1, 1]);
  });
});

describe('PerspectiveProjection', () => {
  it('is the identity for fromDim = 3 (n=3 invariant)', () => {
    const proj = new PerspectiveProjection({ fromDim: 3, viewDistance: 5 });
    expect(proj.projectPoint([1.5, -2.5, 3.5])).toEqual([1.5, -2.5, 3.5]);
    const homogeneous = proj.projectHomogeneousPoint([1.5, -2.5, 3.5]);
    expect(homogeneous.coordinates).toEqual([1.5, -2.5, 3.5, 1]);
    expect(homogeneous.validity).toEqual({
      kind: 'iterated-perspective',
      valid: true,
      firstClampedAxis: null,
      stages: []
    });
    const fibre = proj.inverseFibre([1.5, -2.5, 3.5]);
    expect(fibre.point.toArray()).toEqual([1.5, -2.5, 3.5]);
    expect(fibre.directions).toEqual([]);
  });

  it('leaves points on the w=0 hyperplane unscaled', () => {
    const proj = new PerspectiveProjection({ fromDim: 4, viewDistance: 3 });
    const [x, y, z] = proj.projectPoint([1, 2, -1, 0]);
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(2, 12);
    expect(z).toBeCloseTo(-1, 12);
  });

  it('enlarges points nearer the viewpoint and shrinks farther ones', () => {
    const proj = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
    const [near] = proj.projectPoint([1, 0, 0, 1]); // scale 4/3 > 1
    const [far] = proj.projectPoint([1, 0, 0, -1]); // scale 4/5 < 1
    expect(near).toBeCloseTo(4 / 3, 12);
    expect(far).toBeCloseTo(4 / 5, 12);
  });

  it('projectPositions matches projectPoint', () => {
    const proj = new PerspectiveProjection({ fromDim: 6, viewDistance: 3 });
    const count = 5;
    const src = new Float64Array(count * 6).map(() => Math.random() * 2 - 1);
    const dst = new Float32Array(count * 3);
    proj.projectPositions(src, count, dst);
    for (let p = 0; p < count; p++) {
      const expected = proj.projectPoint(Array.from(src.subarray(p * 6, p * 6 + 6)));
      for (let c = 0; c < 3; c++) {
        expect(dst[p * 3 + c]).toBeCloseTo(expected[c]!, 5); // Float32 precision
      }
    }
  });

  it('clamps rather than exploding at the viewpoint', () => {
    const proj = new PerspectiveProjection({ fromDim: 4, viewDistance: 2 });
    const [x] = proj.projectPoint([1, 0, 0, 2]); // exactly at the viewpoint
    expect(Number.isFinite(x)).toBe(true);
  });

  it('matches one homogeneous matrix throughout the valid projective domain', () => {
    const random = seededRandom(0x51a9e);
    for (let dimension = 3; dimension <= 8; dimension++) {
      const projection = new PerspectiveProjection({
        fromDim: dimension,
        viewDistance: 4
      });
      for (let trial = 0; trial < 40; trial++) {
        const source = Array.from(
          { length: dimension },
          (_, axis) => (random() * 2 - 1) * (axis < 3 ? 2 : 0.15)
        );
        const result = projection.projectHomogeneousPoint(source);
        expect(result.validity.valid).toBe(true);
        const matrixImage = applyHomogeneousMatrix(
          projection.homogeneousMatrix(),
          dimension,
          source
        );
        expectTupleClose(matrixImage, result.coordinates, 14);
        const q = result.coordinates[3];
        const projected = projection.projectPoint(source);
        for (let axis = 0; axis < 3; axis++) {
          expect(result.coordinates[axis]! / q).toBeCloseTo(projected[axis]!, 13);
        }
      }
    }
  });

  it('records every divide and rejects an intermediate clamp even when final q is positive', () => {
    const projection = new PerspectiveProjection({
      fromDim: 5,
      viewDistance: 2,
      epsilon: 1e-6
    });
    const source = [1, 0, 0, -3, 3];
    const result = projection.projectHomogeneousPoint(source);
    expect(result.coordinates).toEqual([1, 0, 0, 1]);
    expect(result.validity.kind).toBe('iterated-perspective');
    if (result.validity.kind !== 'iterated-perspective') return;
    expect(result.validity.valid).toBe(false);
    expect(result.validity.firstClampedAxis).toBe(4);
    expect(result.validity.stages.map((stage) => stage.hiddenAxis)).toEqual([4, 3]);
    expect(result.validity.stages[0]!.legacyClampApplied).toBe(true);
    expect(result.validity.stages[0]!.domainMargin).toBeLessThan(0);
    expect(result.validity.stages[1]!.homogeneousDenominatorAfter).toBeCloseTo(1, 14);
    expect(projection.projectPoint(source)[0]).not.toBeCloseTo(1, 8);

    const packed = new Float64Array(4);
    const validity = new Uint8Array(1);
    projection.projectHomogeneousPositions(
      new Float64Array(source),
      1,
      packed,
      validity
    );
    expect(Array.from(packed)).toEqual([1, 0, 0, 1]);
    expect(validity[0]).toBe(0);

    const fibre = projection.inverseFibre([1, 0, 0]);
    const lifted = evaluateProjectionFibre(fibre, [-3, 3]);
    expect(lifted.toArray()).toEqual(source);
    expect(isPointInProjectionFibreDomain(fibre, lifted)).toBe(false);
  });

  it('returns an affine fibre whose valid points project to the requested R3 point', () => {
    const projection = new PerspectiveProjection({
      fromDim: 6,
      viewDistance: 4,
      epsilon: 1e-6
    });
    const requested = [1.25, -0.5, 2] as const;
    const fibre = projection.inverseFibre(requested);
    expect(fibre.directions).toHaveLength(3);
    expect(fibre.domain.kind).toBe('open-half-spaces');

    const lifted = evaluateProjectionFibre(fibre, [0.25, -0.4, 0.1]);
    expect(isPointInProjectionFibreDomain(fibre, lifted)).toBe(true);
    expectTupleClose(projection.projectPoint(lifted.data), requested, 13);

    const result = projection.projectHomogeneousPoint(lifted.data);
    expect(result.validity.kind).toBe('iterated-perspective');
    if (
      result.validity.kind !== 'iterated-perspective' ||
      fibre.domain.kind !== 'open-half-spaces'
    ) return;
    for (const stage of result.validity.stages) {
      const halfSpace = fibre.domain.halfSpaces.find(
        (candidate) => candidate.stageAxis === stage.hiddenAxis
      );
      expect(halfSpace).toBeDefined();
      expect(projectionDomainMargin(halfSpace!, lifted)).toBeCloseTo(
        stage.domainMargin,
        13
      );
    }
  });

  it('makes the fibre half-spaces exactly match packed and point validity', () => {
    const random = seededRandom(0x4f1b3);
    for (let dimension = 4; dimension <= 8; dimension++) {
      const projection = new PerspectiveProjection({
        fromDim: dimension,
        viewDistance: 2.5,
        epsilon: 0.01
      });
      const requested = [0.75, -1.25, 0.5] as const;
      const fibre = projection.inverseFibre(requested);
      for (let trial = 0; trial < 100; trial++) {
        const parameters = Array.from(
          { length: dimension - 3 },
          () => (random() * 2 - 1) * 4
        );
        const source = evaluateProjectionFibre(fibre, parameters);
        const pointResult = projection.projectHomogeneousPoint(source.data);
        const packed = new Float64Array(4);
        const packedValidity = new Uint8Array(1);
        projection.projectHomogeneousPositions(
          source.data,
          1,
          packed,
          packedValidity
        );
        const domainValid = isPointInProjectionFibreDomain(fibre, source);
        expect(pointResult.validity.valid).toBe(domainValid);
        expect(packedValidity[0] === 1).toBe(domainValid);
        expectTupleClose(packed, pointResult.coordinates, 14);
        if (domainValid) {
          expectTupleClose(projection.projectPoint(source.data), requested, 12);
        }
      }
    }
  });

  it('pins the rational perspective-lift fixture used by representation picking', () => {
    const projection = new PerspectiveProjection({
      fromDim: 4,
      viewDistance: 2
    });
    const a = [1, 1, 1, 1];
    const c = [1, -1, 1, -1];
    const ha = projection.projectHomogeneousPoint(a).coordinates;
    const hc = projection.projectHomogeneousPoint(c).coordinates;
    expect(ha).toEqual([1, 1, 1, 0.5]);
    expect(hc).toEqual([1, -1, 1, 1.5]);

    const screenMidpoint = [4 / 3, 2 / 3, 4 / 3] as const;
    const perspectiveCorrectSource = new VecN([1, 0.5, 1, 0.5]);
    expectTupleClose(
      projection.projectPoint(perspectiveCorrectSource.data),
      screenMidpoint,
      14
    );
    const fibreLift = evaluateProjectionFibre(
      projection.inverseFibre(screenMidpoint),
      [0.5]
    );
    expect(fibreLift.equalsApprox(perspectiveCorrectSource, 1e-14)).toBe(true);

    const naiveSourceMidpoint = new VecN([1, 0, 1, 0]);
    expect(projection.projectPoint(naiveSourceMidpoint.data)[1]).not.toBeCloseTo(
      screenMidpoint[1],
      10
    );
  });

  it('recovers perspective-correct source weights on a named triangle', () => {
    const projection = new PerspectiveProjection({
      fromDim: 4,
      viewDistance: 2
    });
    const sourceVertices = [
      new VecN([1, 1, 1, 1]),
      new VecN([-1, 1, 1, 1]),
      new VecN([1, -1, 1, -1])
    ];
    const vertices = sourceVertices.map((sourcePoint) => {
      const sample = projection.projectHomogeneousPoint(sourcePoint.data);
      return {
        sourcePoint,
        coordinates: sample.coordinates,
        valid: sample.validity.valid
      };
    });
    const expectedSourceWeights = [0.25, 0.25, 0.5];
    const representationWeights = [0.125, 0.125, 0.75];
    const projectedVertices = vertices.map((vertex) => [
      vertex.coordinates[0]! / vertex.coordinates[3]!,
      vertex.coordinates[1]! / vertex.coordinates[3]!,
      vertex.coordinates[2]! / vertex.coordinates[3]!
    ]);
    const point3 = [0, 0, 0];
    for (let vertex = 0; vertex < 3; vertex++) {
      for (let coordinate = 0; coordinate < 3; coordinate++) {
        point3[coordinate]! +=
          representationWeights[vertex]! * projectedVertices[vertex]![coordinate]!;
      }
    }

    const lift = liftHomogeneousSimplexPointN(vertices, point3);
    expect(lift.kind).toBe('exact');
    if (lift.kind !== 'exact') return;
    expectTupleClose(lift.representationWeights, representationWeights, 14);
    expectTupleClose(lift.sourceWeights, expectedSourceWeights, 14);
    expectTupleClose(lift.point.data, [0.5, 0, 1, 0], 14);
    expectTupleClose(projection.projectPoint(lift.point.data), point3, 13);

    const scaledLift = liftHomogeneousSimplexPointN(
      vertices.map((vertex) => ({
        ...vertex,
        coordinates: vertex.coordinates.map((coordinate) => coordinate * 1e-12)
      })),
      point3
    );
    expect(scaledLift.kind).toBe('exact');
    if (scaledLift.kind === 'exact') {
      expectTupleClose(scaledLift.sourceWeights, expectedSourceWeights, 14);
      expectTupleClose(scaledLift.point.data, lift.point.data, 14);
    }
  });

  it('refuses invalid, degenerate, and off-simplex homogeneous lifts', () => {
    const sourceA = new VecN([0, 0, 0, 0]);
    const sourceB = new VecN([1, 0, 0, 0]);
    const validVertices = [
      { sourcePoint: sourceA, coordinates: [0, 0, 0, 1], valid: true },
      { sourcePoint: sourceB, coordinates: [1, 0, 0, 1], valid: true }
    ];
    expect(liftHomogeneousSimplexPointN(validVertices, [0.5, 0.1, 0])).toMatchObject({
      kind: 'unavailable',
      reason: 'point-off-simplex'
    });
    expect(
      liftHomogeneousSimplexPointN(
        [validVertices[0]!, { ...validVertices[1]!, valid: false }],
        [0.5, 0, 0]
      )
    ).toMatchObject({
      kind: 'unavailable',
      reason: 'invalid-projection-vertex'
    });
    expect(
      liftHomogeneousSimplexPointN(
        [
          validVertices[0]!,
          { sourcePoint: sourceB, coordinates: [0, 0, 0, 1], valid: true }
        ],
        [0, 0, 0]
      )
    ).toMatchObject({
      kind: 'unavailable',
      reason: 'degenerate-simplex'
    });
  });
});

function applyHomogeneousMatrix(
  matrix: Float64Array,
  fromDim: number,
  point: ArrayLike<number>
): [number, number, number, number] {
  const columns = fromDim + 1;
  const homogeneous = [...Array.from(point), 1];
  const result: [number, number, number, number] = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < columns; column++) {
      result[row]! += matrix[row * columns + column]! * homogeneous[column]!;
    }
  }
  return result;
}

function expectTupleClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits: number
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]).toBeCloseTo(expected[index]!, digits);
  }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
