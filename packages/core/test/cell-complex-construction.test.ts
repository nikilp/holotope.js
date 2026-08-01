import { describe, expect, it } from 'vitest';
import { CellComplex } from '../src/index.js';

describe('CellComplex construction', () => {
  it('names the positional authoring contract when JavaScript supplies an option object', () => {
    expect(() => Reflect.construct(CellComplex, [{
      dim: 4,
      positions: [[0, 0, 0, 0]],
      cells: []
    }])).toThrow(/expected \(ambientDim, packedPositions, groups\)/);
  });

  it('rejects invalid dimensions and unpacked position storage at the boundary', () => {
    expect(() => new CellComplex(0, new Float64Array())).toThrow(/positive integer/);
    expect(() => new CellComplex(2, [0, 0] as never)).toThrow(/packed Float64Array/);
    expect(() => new CellComplex(2, new Float64Array([0, 0]), {} as never)).toThrow(
      /groups must be an array/
    );
  });
});
