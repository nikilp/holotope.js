import type { CellComplex, CellGroup } from '@holotope/core';

/**
 * Names for the block's eight 3-faces, read off the complex rather than assumed.
 *
 * A hyperbox in R4 is bounded by eight cubes, one at each end of each axis.
 * Every 2-face of a drawn section is the cut of exactly one of them, so a
 * persistent identity for those cubes is what lets a viewer recognise "the +w
 * face" across turns while the cut vertices come and go.
 *
 * The ordinal-to-name map is derived from geometry: for each cube, the one axis
 * on which all eight vertices agree is the axis it bounds, and the sign of that
 * shared coordinate is the side. Reading the constructor's loop order would
 * give the same answer today and a silent wrong one after any reordering.
 */

export const AXIS_NAMES = ['x', 'y', 'z', 'w'] as const;

export interface SourceFace {
  /** Index of the cube within the complex's cuboid 3-cell group. */
  readonly ordinal: number;
  readonly axis: 0 | 1 | 2 | 3;
  readonly sign: -1 | 1;
  /** e.g. "−x", "+w". */
  readonly name: string;
  readonly colour: string;
  readonly rgb: readonly [number, number, number];
}

/**
 * One hue per axis, the sign as light or dark, so "the gold faces have come
 * in" reads without a legend. w is the warm one on purpose: it is the axis the
 * reference section cannot show at all.
 */
const PALETTE: Record<number, readonly [string, string]> = {
  0: ['#a8433a', '#f2806f'],
  1: ['#3c8e58', '#86d99c'],
  2: ['#3a68c8', '#89b0f7'],
  3: ['#b07f22', '#f3c55a']
};

const hexToRgb = (hex: string): readonly [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255
];

export function nameCubes(complex: CellComplex, cubes: CellGroup): SourceFace[] {
  const dim = complex.ambientDim;
  const per = cubes.verticesPerCell;
  const count = cubes.indices.length / per;
  const faces: SourceFace[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    let constantAxis = -1;
    let value = 0;
    for (let axis = 0; axis < dim; axis++) {
      const first = complex.positions[cubes.indices[ordinal * per]! * dim + axis]!;
      let same = true;
      for (let corner = 1; corner < per; corner++) {
        const v = complex.positions[cubes.indices[ordinal * per + corner]! * dim + axis]!;
        if (Math.abs(v - first) > 1e-12) { same = false; break; }
      }
      if (same) {
        if (constantAxis !== -1) throw new Error(`nameCubes: cube ${ordinal} is flat on two axes`);
        constantAxis = axis;
        value = first;
      }
    }
    if (constantAxis === -1 || value === 0) {
      throw new Error(`nameCubes: cube ${ordinal} does not bound one axis`);
    }
    const axis = constantAxis as 0 | 1 | 2 | 3;
    const sign: -1 | 1 = value < 0 ? -1 : 1;
    const colour = PALETTE[axis]![sign < 0 ? 0 : 1];
    faces.push({
      ordinal, axis, sign,
      name: `${sign < 0 ? '−' : '+'}${AXIS_NAMES[axis]}`,
      colour, rgb: hexToRgb(colour)
    });
  }
  return faces;
}
