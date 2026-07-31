import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  createHypercube,
  createHyperrectangle,
  cuboidCellFacetN,
  type CellGroup
} from '../src/index.js';

/**
 * The orthotope is defined by its agreement with the hypercube.
 *
 * Only positions differ; topology, cell ordering, local vertex ordering, and
 * group ordering are identical. That is what lets every existing consumer take
 * the new shape without a second code path, so the differential below is the
 * central test rather than a nicety. A separately written combinatorial loop
 * describing the same shape in a different order would be wrong here even
 * though it is geometrically correct.
 */

const facetNames = (complex: CellComplex): string => {
  const cubes = complex
    .cellsOfDim(complex.ambientDim - 1)
    .find((group) => group.kind === 'cuboid')!;
  const count = cubes.indices.length / cubes.verticesPerCell;
  const names: string[] = [];
  for (let cell = 0; cell < count; cell += 1) {
    const facet = cuboidCellFacetN(complex, cubes, cell);
    names.push(facet === null ? 'none' : `${facet.axis}:${facet.sign > 0 ? '+' : '-'}`);
  }
  return names.join(' ');
};

const translated = (source: CellComplex, by: number): CellComplex =>
  new CellComplex(
    source.ambientDim,
    source.positions.map((value) => value + by),
    [...source.groups]
  );

describe('createHyperrectangle coordinates', () => {
  it('places vertices at plus and minus half of each edge length', () => {
    const body = createHyperrectangle({
      dim: 4,
      edgeLengths: [2, 3, 5, 7],
      maxCellDimension: 3
    });
    expect(body.ambientDim).toBe(4);
    expect(body.vertexCount).toBe(16);

    const half = [1, 1.5, 2.5, 3.5];
    for (let vertex = 0; vertex < body.vertexCount; vertex += 1) {
      const position = body.getPosition(vertex);
      for (let axis = 0; axis < 4; axis += 1) {
        // Binary and half-integer fixtures, so exact equality is right.
        expect(Math.abs(position[axis]!)).toBe(half[axis]!);
      }
    }
  });

  it('numbers vertices by the hypercube bit convention', () => {
    const body = createHyperrectangle({ dim: 4, edgeLengths: [2, 3, 5, 7] });
    expect(Array.from(body.getPosition(0))).toEqual([-1, -1.5, -2.5, -3.5]);
    expect(Array.from(body.getPosition(15))).toEqual([1, 1.5, 2.5, 3.5]);
    // Bit i set means the positive side of axis i.
    expect(Array.from(body.getPosition(1))).toEqual([1, -1.5, -2.5, -3.5]);
    expect(Array.from(body.getPosition(8))).toEqual([-1, -1.5, -2.5, 3.5]);
  });

  it('constructs in one, two, and more than four dimensions', () => {
    const segment = createHyperrectangle({ dim: 1, edgeLengths: [4] });
    expect(segment.vertexCount).toBe(2);
    expect(Array.from(segment.positions)).toEqual([-2, 2]);

    const rectangle = createHyperrectangle({ dim: 2, edgeLengths: [2, 6] });
    expect(rectangle.vertexCount).toBe(4);
    expect(Array.from(rectangle.getPosition(3))).toEqual([1, 3]);

    const fiveCell = createHyperrectangle({ dim: 5, edgeLengths: [1, 2, 3, 4, 5] });
    expect(fiveCell.vertexCount).toBe(32);
    expect(Array.from(fiveCell.getPosition(31))).toEqual([0.5, 1, 1.5, 2, 2.5]);
  });
});

describe('createHyperrectangle is a hypercube in everything but positions', () => {
  const sameTopology = (box: CellComplex, cube: CellComplex): void => {
    expect(box.ambientDim).toBe(cube.ambientDim);
    expect(box.vertexCount).toBe(cube.vertexCount);
    expect(box.groups.length).toBe(cube.groups.length);
    for (let index = 0; index < box.groups.length; index += 1) {
      const left = box.groups[index] as CellGroup;
      const right = cube.groups[index] as CellGroup;
      expect(left.dim).toBe(right.dim);
      expect(left.kind).toBe(right.kind);
      expect(left.verticesPerCell).toBe(right.verticesPerCell);
      // Byte-for-byte, so cell emission order is pinned and not merely the
      // same set of cells in some order.
      expect(Array.from(left.indices)).toEqual(Array.from(right.indices));
    }
  };

  it('matches hypercube topology across dimensions and cell dimensions', () => {
    for (const dim of [1, 2, 3, 4, 5]) {
      for (let maxCellDimension = 1; maxCellDimension <= dim; maxCellDimension += 1) {
        const lengths = Array.from({ length: dim }, (_, axis) => axis + 2);
        sameTopology(
          createHyperrectangle({ dim, edgeLengths: lengths, maxCellDimension }),
          createHypercube({ dim, size: 1, maxCellDimension })
        );
      }
    }
  });

  it('reproduces the hypercube position buffer when every length is equal', () => {
    for (const dim of [1, 2, 3, 4, 5]) {
      for (const size of [1, 2, 3, 0.5]) {
        const box = createHyperrectangle({
          dim,
          edgeLengths: Array.from({ length: dim }, () => size)
        });
        const cube = createHypercube({ dim, size });
        expect(Array.from(box.positions), `dim ${dim}, size ${size}`).toEqual(
          Array.from(cube.positions)
        );
      }
    }
  });
});

describe('createHyperrectangle composes with the facet classifier', () => {
  const expected = '3:- 3:+ 2:- 2:+ 1:- 1:+ 0:- 0:+';

  it('names the established facet order for unequal edges', () => {
    const body = createHyperrectangle({
      dim: 4,
      edgeLengths: [2, 3, 5, 7],
      maxCellDimension: 3
    });
    expect(facetNames(body)).toBe(expected);
  });

  it('still names it once translated clear of the origin', () => {
    // Would fail against an origin/sign heuristic: every coordinate is
    // positive after the shift.
    const body = createHyperrectangle({
      dim: 4,
      edgeLengths: [2, 3, 5, 7],
      maxCellDimension: 3
    });
    expect(facetNames(translated(body, 20))).toBe(expected);
  });
});

describe('createHyperrectangle input ownership and refusals', () => {
  it('does not retain the caller-owned array', () => {
    const lengths = [2, 3, 5, 7];
    const body = createHyperrectangle({ dim: 4, edgeLengths: lengths });
    lengths[0] = 1000;
    expect(Array.from(body.getPosition(15))).toEqual([1, 1.5, 2.5, 3.5]);
  });

  it('accepts a typed array', () => {
    const body = createHyperrectangle({
      dim: 4,
      edgeLengths: Float64Array.of(2, 3, 5, 7)
    });
    expect(Array.from(body.getPosition(15))).toEqual([1, 1.5, 2.5, 3.5]);
  });

  it('refuses a length that does not match the dimension', () => {
    expect(() => createHyperrectangle({ dim: 4, edgeLengths: [2, 3, 5] })).toThrow(
      /createHyperrectangle: edgeLengths must have one entry per axis \(4\), received 3/
    );
  });

  it('refuses a non-finite or non-positive component, naming its axis', () => {
    for (const [axis, value] of [
      [0, Number.NaN],
      [1, Number.POSITIVE_INFINITY],
      [2, 0],
      [3, -1]
    ] as const) {
      const lengths = [2, 3, 5, 7];
      lengths[axis] = value;
      expect(() => createHyperrectangle({ dim: 4, edgeLengths: lengths })).toThrow(
        new RegExp(`edgeLengths\\[${axis}\\]`)
      );
    }
  });

  it('refuses an out-of-range dimension before allocating', () => {
    expect(() => createHyperrectangle({ dim: 0, edgeLengths: [] })).toThrow(
      /createHyperrectangle: dim/
    );
    expect(() =>
      createHyperrectangle({ dim: 31, edgeLengths: new Float64Array(31).fill(1) })
    ).toThrow(/createHyperrectangle: dim/);
    expect(() => createHyperrectangle({ dim: 2.5, edgeLengths: [1, 2] })).toThrow(
      /createHyperrectangle: dim/
    );
  });

  it('refuses an invalid maxCellDimension', () => {
    for (const maxCellDimension of [0, 5, 1.5]) {
      expect(() =>
        createHyperrectangle({ dim: 4, edgeLengths: [2, 3, 5, 7], maxCellDimension })
      ).toThrow(/createHyperrectangle: maxCellDimension/);
    }
  });

  it('never reports a refusal as coming from createHypercube', () => {
    // The wrapper validates first, so invalid input cannot fall through to the
    // constructor underneath and name the wrong function to the caller.
    for (const call of [
      () => createHyperrectangle({ dim: 4, edgeLengths: [2, 3, 5] }),
      () => createHyperrectangle({ dim: 0, edgeLengths: [] }),
      () => createHyperrectangle({ dim: 4, edgeLengths: [2, 3, 5, -7] })
    ]) {
      expect(call).toThrow(/createHyperrectangle/);
      expect(call).not.toThrow(/createHypercube/);
    }
  });
});
