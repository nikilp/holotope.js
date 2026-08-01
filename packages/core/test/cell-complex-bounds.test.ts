import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  MatN,
  TransformN,
  VecN,
  cellComplexBoundsAlongAxisN,
  cellComplexBoundsAlongDirectionN,
  createHyperrectangle
} from '@holotope/core';

describe('CellComplex directional bounds', () => {
  it('matches analytic axis bounds for an anisotropic R4 box', () => {
    const box = createHyperrectangle({ dim: 4, edgeLengths: [2, 4, 6, 8] });
    expect(cellComplexBoundsAlongAxisN(box, 0)).toEqual({ min: -1, max: 1 });
    expect(cellComplexBoundsAlongAxisN(box, 3)).toEqual({ min: -4, max: 4 });
  });

  it('normalizes arbitrary directions and matches a vertex oracle in R1, R4, and R7', () => {
    for (const dim of [1, 4, 7]) {
      const complex = createHyperrectangle({
        dim,
        edgeLengths: Array.from({ length: dim }, (_, axis) => axis + 1)
      });
      const direction = new VecN(Array.from({ length: dim }, (_, axis) => axis + 0.5));
      const unit = direction.clone().normalize();
      const values = Array.from({ length: complex.vertexCount }, (_, vertex) => {
        let value = 0;
        for (let axis = 0; axis < dim; axis += 1) {
          value += complex.positions[vertex * dim + axis]! * unit.data[axis]!;
        }
        return value;
      });

      expect(cellComplexBoundsAlongDirectionN(complex, direction)).toEqual({
        min: Math.min(...values),
        max: Math.max(...values)
      });
    }
  });

  it('measures the transformed world-space interval when requested', () => {
    const box = createHyperrectangle({ dim: 4, edgeLengths: [2, 4, 6, 8] });
    const transform = new TransformN(
      4,
      MatN.rotationInPlane(4, 0, 3, Math.PI / 2),
      new VecN([0, 0, 0, 10])
    );

    const bounds = cellComplexBoundsAlongAxisN(box, 3, transform);
    expect(bounds.min).toBeCloseTo(9, 13);
    expect(bounds.max).toBeCloseTo(11, 13);
  });

  it('rejects empty, mismatched, zero, non-finite, and invalid-axis inputs', () => {
    const box = createHyperrectangle({ dim: 4, edgeLengths: [1, 1, 1, 1] });
    expect(() => cellComplexBoundsAlongDirectionN(
      new CellComplex(4, new Float64Array()),
      [1, 0, 0, 0]
    )).toThrow(/no vertices/);
    expect(() => cellComplexBoundsAlongDirectionN(box, [1, 0, 0])).toThrow(/direction is R3/);
    expect(() => cellComplexBoundsAlongDirectionN(box, [0, 0, 0, 0])).toThrow(/non-zero/);
    expect(() => cellComplexBoundsAlongDirectionN(box, [1, 0, Number.NaN, 0])).toThrow(/finite/);
    expect(() => cellComplexBoundsAlongAxisN(box, 4)).toThrow(/out of range/);
    expect(() => cellComplexBoundsAlongAxisN(box, 0, new TransformN(3))).toThrow(/transform is R3/);
  });
});
