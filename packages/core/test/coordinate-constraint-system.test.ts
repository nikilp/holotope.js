import { describe, expect, it } from 'vitest';
import {
  clearLinearCoordinateConstraintSystemN,
  createLinearCoordinateConstraintSystemN,
  getLinearCoordinateConstraintBlockN,
  solveLinearCoordinateConstraintSystemN,
  solveLinearCoordinateConstraintsN,
  withLinearCoordinateConstraintBlockN,
  withoutLinearCoordinateConstraintBlockN
} from '@holotope/core';

describe('immutable named coordinate constraint systems', () => {
  it('owns frozen snapshots rather than caller arrays', () => {
    const coefficients = new Float64Array([1, 2]);
    const targets = [3];
    const system = createLinearCoordinateConstraintSystemN(2, [{
      key: 'view:perspective',
      label: 'perspective',
      coefficients,
      targets,
      rowCount: 1
    }]);

    coefficients[0] = 99;
    targets[0] = -10;
    const block = system.blocks[0]!;
    expect(block.coefficients).toEqual([1, 2]);
    expect(block.targets).toEqual([3]);
    expect(block.weight).toBe(1);
    expect(block.scale).toBe(1);
    expect(Object.isFrozen(system)).toBe(true);
    expect(Object.isFrozen(system.blocks)).toBe(true);
    expect(Object.isFrozen(block)).toBe(true);
    expect(Object.isFrozen(block.coefficients)).toBe(true);
  });

  it('replaces in place, appends new keys, and preserves old snapshots', () => {
    const empty = createLinearCoordinateConstraintSystemN(1);
    const first = withLinearCoordinateConstraintBlockN(empty, 'active', {
      coefficients: [1], targets: [0.25], rowCount: 1
    });
    const two = withLinearCoordinateConstraintBlockN(first, 'held', {
      coefficients: [1], targets: [0.75], rowCount: 1
    });
    const replaced = withLinearCoordinateConstraintBlockN(two, 'active', {
      coefficients: [1], targets: [0.5], rowCount: 1
    });

    expect(first.blocks.map((block) => block.key)).toEqual(['active']);
    expect(two.blocks.map((block) => block.key)).toEqual(['active', 'held']);
    expect(replaced.blocks.map((block) => block.key)).toEqual(['active', 'held']);
    expect(two.blocks[0]!.targets).toEqual([0.25]);
    expect(replaced.blocks[0]!.targets).toEqual([0.5]);

    const removed = withoutLinearCoordinateConstraintBlockN(replaced, 'active');
    expect(removed.blocks.map((block) => block.key)).toEqual(['held']);
    expect(withoutLinearCoordinateConstraintBlockN(removed, 'missing')).toBe(removed);
    const cleared = clearLinearCoordinateConstraintSystemN(removed);
    expect(cleared.blocks).toEqual([]);
    expect(clearLinearCoordinateConstraintSystemN(cleared)).toBe(cleared);
  });

  it('keeps stable machine keys separate from human labels', () => {
    const system = createLinearCoordinateConstraintSystemN(1, [{
      key: 'camera:7',
      label: 'left inspection view',
      coefficients: [1],
      targets: [2],
      rowCount: 1
    }]);
    expect(getLinearCoordinateConstraintBlockN(system, 'camera:7')).toMatchObject({
      key: 'camera:7',
      label: 'left inspection view'
    });
    expect(getLinearCoordinateConstraintBlockN(system, 'camera:8')).toBeUndefined();
  });

  it('carries names into ordered solve diagnostics', () => {
    const system = createLinearCoordinateConstraintSystemN(1, [
      {
        key: 'view:left',
        label: 'left',
        coefficients: [1],
        targets: [0],
        rowCount: 1
      },
      {
        key: 'view:right',
        label: 'right held',
        coefficients: [1],
        targets: [2],
        rowCount: 1,
        weight: 3
      }
    ]);
    const fit = solveLinearCoordinateConstraintSystemN(system);

    expect(fit.solution[0]).toBeCloseTo(1.5, 14);
    expect(fit.blockKeys).toEqual(['view:left', 'view:right']);
    expect(fit.blocks).toMatchObject([
      { key: 'view:left', label: 'left', rank: 1 },
      { key: 'view:right', label: 'right held', rank: 1 }
    ]);
  });

  it('makes rank changes from block removal explicit', () => {
    const full = createLinearCoordinateConstraintSystemN(2, [
      { key: 'x', coefficients: [1, 0], targets: [1], rowCount: 1 },
      { key: 'y', coefficients: [0, 1], targets: [2], rowCount: 1 }
    ]);
    const rankTwo = solveLinearCoordinateConstraintSystemN(full);
    const rankOne = solveLinearCoordinateConstraintSystemN(
      withoutLinearCoordinateConstraintBlockN(full, 'y'),
      { prior: [7, 9] }
    );

    expect(rankTwo).toMatchObject({ rank: 2, determination: 'unique' });
    expect(rankOne).toMatchObject({
      rank: 1,
      determination: 'rank-deficient',
      unresolvedDegreesOfFreedom: 1
    });
    expect(rankOne.solution[0]).toBeCloseTo(1, 14);
    expect(rankOne.solution[1]).toBeCloseTo(9, 14);
  });

  it('is differentially identical to solving the same unnamed blocks', () => {
    const system = createLinearCoordinateConstraintSystemN(3, [
      {
        key: 'primary',
        coefficients: [1, 2, -1, 0, 1, 3],
        targets: [0.5, -2],
        rowCount: 2,
        weight: 0.75,
        scale: 2
      },
      {
        key: 'secondary',
        coefficients: [4, -1, 2, -3, 5, 1],
        targets: [7, -4],
        rowCount: 2,
        weight: 2.25,
        scale: 5
      }
    ]);
    const named = solveLinearCoordinateConstraintSystemN(system);
    const direct = solveLinearCoordinateConstraintsN(3, system.blocks);

    expect(named.solution).toEqual(direct.solution);
    expect(named.singularValues).toEqual(direct.singularValues);
    expect(named.objective).toBe(direct.objective);
    expect(named.normalResidual).toBe(direct.normalResidual);
  });

  it('rejects invalid dimensions, keys, duplicates, and malformed blocks early', () => {
    expect(() => createLinearCoordinateConstraintSystemN(0)).toThrow(/coordinateDim/);
    expect(() => createLinearCoordinateConstraintSystemN(1, [
      { key: 'same', coefficients: [1], targets: [0], rowCount: 1 },
      { key: 'same', coefficients: [1], targets: [1], rowCount: 1 }
    ])).toThrow(/duplicate block key/);
    expect(() => createLinearCoordinateConstraintSystemN(1, [{
      key: ' padded ', coefficients: [1], targets: [0], rowCount: 1
    }])).toThrow(/non-empty trimmed string/);
    expect(() => withLinearCoordinateConstraintBlockN(
      createLinearCoordinateConstraintSystemN(2),
      'bad-shape',
      { coefficients: [1], targets: [0], rowCount: 1 }
    )).toThrow(/coefficients must contain 2/);
  });
});
