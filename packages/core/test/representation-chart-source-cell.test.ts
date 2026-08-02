import {
  HyperplaneSlice4,
  TransformN,
  VecN,
  createAffineSectionCellChart4N,
  createHypercube,
  evaluateSourceSimplexCoordinateN,
  resolveRepresentationChartPointToSourceCellN,
  tetrahedralizeCuboidCells,
  type RepresentationCellChartN
} from '@holotope/core';
import { describe, expect, it } from 'vitest';

function fixture(transform?: TransformN): {
  readonly chart: RepresentationCellChartN;
  readonly point: [number, number, number];
} {
  const complex = tetrahedralizeCuboidCells(
    createHypercube({ dim: 4, size: 2, maxCellDimension: 3 })
  );
  const slice = new HyperplaneSlice4({
    normal: [0.2, -0.3, 0.4, 1],
    offset: 0.137
  });
  const chart = createAffineSectionCellChart4N(
    complex,
    slice,
    transform === undefined ? {} : { transform }
  );
  expect(chart.triangleCount).toBeGreaterThan(0);
  const positions = chart.trianglePositions;
  const point: [number, number, number] = [
    (positions[0]! + positions[3]! + positions[6]!) / 3,
    (positions[1]! + positions[4]! + positions[7]!) / 3,
    (positions[2]! + positions[5]! + positions[8]!) / 3
  ];
  return { chart, point };
}

describe('representation chart source-cell resolution', () => {
  it('resolves an interior section point to one source tetrahedron and coordinate', () => {
    const { chart, point } = fixture();
    expect(chart.defaultTolerances).toEqual({ chart: 1e-6, source: 1e-9 });
    const result = resolveRepresentationChartPointToSourceCellN(
      chart,
      point,
      { triangleIndex: 0 }
    );

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.reference.intrinsicDim).toBe(3);
    expect(result.triangleIndex).toBe(0);
    expect(result.sourceCoordinate.kind).toBe('exact');
    if (result.sourceCoordinate.kind !== 'exact') return;
    expect(result.sourceCoordinate.sourceResidual).toBeLessThan(1e-9);
    const local = evaluateSourceSimplexCoordinateN(
      result.sourceCoordinate.coordinate
    );
    expect(local.data).toHaveLength(4);
    expect(
      result.sourceCoordinate.coordinate.weights.reduce(
        (sum, weight) => sum + weight,
        0
      )
    ).toBeCloseTo(1, 14);
  });

  it('validates chart-owned default tolerances', () => {
    const { chart, point } = fixture();
    const malformed: RepresentationCellChartN = {
      ...chart,
      defaultTolerances: { chart: 1e-6, source: 0 }
    };
    expect(() => resolveRepresentationChartPointToSourceCellN(
      malformed,
      point,
      { triangleIndex: 0 }
    )).toThrow(/chart default source tolerance/);
  });

  it('inverts the authored source pose before constructing local coordinates', () => {
    const transform = new TransformN(
      4,
      undefined,
      new VecN([0.2, -0.1, 0.3, 0.05])
    );
    const { chart, point } = fixture(transform);
    const result = resolveRepresentationChartPointToSourceCellN(
      chart,
      point,
      { triangleIndex: 0 }
    );

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved' || result.sourceCoordinate.kind !== 'exact') return;
    const local = evaluateSourceSimplexCoordinateN(
      result.sourceCoordinate.coordinate
    );
    const posed = transform.applyToPoint(local);
    for (let axis = 0; axis < 4; axis++) {
      expect(posed.data[axis]).toBeCloseTo(
        result.sourceCoordinate.ambientPoint.data[axis]!,
        11
      );
    }
  });

  it('returns typed misses for a point outside the chart', () => {
    const { chart } = fixture();
    expect(resolveRepresentationChartPointToSourceCellN(
      chart,
      [1e6, -1e6, 1e6]
    )).toEqual({
      kind: 'unavailable',
      reason: 'outside-representation',
      matchingTriangles: 0,
      matchingSourceCells: 0
    });
  });

  it('retains source identity but refuses to invent a lift through projection', () => {
    const { chart, point } = fixture();
    const projected: RepresentationCellChartN = {
      ...chart,
      pointLift: {
        kind: 'unavailable',
        reason: 'projection-ambiguous'
      }
    };
    const result = resolveRepresentationChartPointToSourceCellN(
      projected,
      point,
      { triangleIndex: 0 }
    );

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.sourceCoordinate).toEqual({
      kind: 'unavailable',
      reason: 'projection-ambiguous'
    });
  });
});
