import { describe, expect, it } from 'vitest';
import {
  BivectorN,
  VecN,
  createHyperrectangle,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { massPropertiesFromCellComplex4, rebasePositionsToPrincipalFrame4 } from '../src/index.js';

/**
 * The R4 orthotope has closed-form mass properties, so the integrator can be
 * checked against arithmetic rather than against itself.
 *
 * For a centered uniform orthotope with edge lengths `a` and density `ρ`:
 *
 *   V   = a₀a₁a₂a₃
 *   m   = ρV
 *   COM = 0
 *   Cᵢᵢ = m aᵢ²/12,  Cᵢⱼ = 0 for i ≠ j
 *   Iᵢⱼ = Cᵢᵢ + Cⱼⱼ = m(aᵢ² + aⱼ²)/12
 *
 * The expectations below are derived from those formulas directly. Calling
 * another mass-properties helper to produce them would make this a consistency
 * check between two implementations rather than evidence about either.
 *
 * Edge lengths are strictly increasing and chosen so all six pair sums differ.
 * A cube's second moments are degenerate, which hides both ordering mistakes
 * and any accidental isotropy in the result.
 */

const EDGES = [2, 3, 5, 7] as const;
const DENSITY = 1;

/** Plane order the library uses for bivectors: 01, 02, 03, 12, 13, 23. */
const PLANES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3]
] as const;

function orthotope() {
  return tetrahedralizeCuboidCells(
    createHyperrectangle({ dim: 4, edgeLengths: [...EDGES], maxCellDimension: 3 })
  );
}

describe('R4 orthotope mass properties against the product-domain oracle', () => {
  const properties = massPropertiesFromCellComplex4(orthotope(), { density: DENSITY });

  const volume = EDGES[0] * EDGES[1] * EDGES[2] * EDGES[3];
  const mass = DENSITY * volume;
  const secondMoment = (axis: number): number => (mass * EDGES[axis]! ** 2) / 12;

  it('integrates the product volume and its mass', () => {
    expect(properties.volume).toBeCloseTo(volume, 9);
    expect(properties.mass).toBeCloseTo(mass, 9);
  });

  it('centres the body on the origin', () => {
    for (const component of properties.centerOfMass.data) {
      expect(component).toBeCloseTo(0, 9);
    }
  });

  it('produces a diagonal covariance matching m·aᵢ²/12', () => {
    const covariance = properties.covarianceAtCenter.data;
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const actual = covariance[row * 4 + column]!;
        if (row === column) {
          expect(actual).toBeCloseTo(secondMoment(row), 8);
        } else {
          expect(actual).toBeCloseTo(0, 8);
        }
      }
    }
  });

  it('matches the pair-sum inertia oracle in the established plane order', () => {
    // The principal axes are the coordinate axes here, so the reported
    // principal second moments are the diagonal ones up to ordering.
    const expectedMoments = [0, 1, 2, 3].map(secondMoment).sort((a, b) => a - b);
    const reportedMoments = Array.from(properties.principalSecondMoments).sort(
      (a, b) => a - b
    );
    for (let index = 0; index < 4; index += 1) {
      expect(reportedMoments[index]!).toBeCloseTo(expectedMoments[index]!, 8);
    }

    const expectedInertia = PLANES.map(
      ([i, j]) => secondMoment(i) + secondMoment(j)
    ).sort((a, b) => a - b);
    const reportedInertia = Array.from(properties.inertiaDiagonal).sort((a, b) => a - b);
    expect(reportedInertia).toHaveLength(6);
    for (let index = 0; index < 6; index += 1) {
      expect(reportedInertia[index]!).toBeCloseTo(expectedInertia[index]!, 8);
    }
  });

  it('is genuinely non-isotropic, which a cube cannot be', () => {
    const inertia = Array.from(properties.inertiaDiagonal);
    const spread = Math.max(...inertia) - Math.min(...inertia);
    expect(spread).toBeGreaterThan(1);
    // All six differ, so no pair of planes is accidentally degenerate.
    expect(new Set(inertia.map((value) => value.toFixed(6))).size).toBe(6);
  });

  it('reconstructs the original positions through the principal frame', () => {
    const complex = orthotope();
    const rebased = rebasePositionsToPrincipalFrame4(complex.positions, properties);
    expect(rebased.length).toBe(complex.positions.length);
    // The principal frame is a rotation of the coordinate frame, so rotating
    // back by the reported rotor returns the authored coordinates.
    for (let vertex = 0; vertex < complex.vertexCount; vertex += 1) {
      const restored = properties.principalRotor.applyToPoint(
        new VecN(Array.from(rebased.slice(vertex * 4, vertex * 4 + 4)))
      );
      for (let axis = 0; axis < 4; axis += 1) {
        // Plus the centre of mass, which is zero for this centred body.
        expect(restored.data[axis]! + properties.centerOfMass.data[axis]!).toBeCloseTo(
          complex.positions[vertex * 4 + axis]!,
          8
        );
      }
    }
  });

  it('a cube of the same volume has six equal inertias, unlike this body', () => {
    const side = volume ** (1 / 4);
    const cube = massPropertiesFromCellComplex4(
      tetrahedralizeCuboidCells(
        createHyperrectangle({
          dim: 4,
          edgeLengths: [side, side, side, side],
          maxCellDimension: 3
        })
      ),
      { density: DENSITY }
    );
    const cubeInertia = Array.from(cube.inertiaDiagonal);
    const spread = Math.max(...cubeInertia) - Math.min(...cubeInertia);
    expect(spread).toBeLessThan(1e-8);
    expect(cube.volume).toBeCloseTo(volume, 8);
  });
});

describe('an orthotope carries a well-formed angular state', () => {
  it('accepts a multi-plane angular velocity without degeneracy', () => {
    const spin = BivectorN.fromPlanes(4, [
      { i: 0, j: 3, angle: 0.7 },
      { i: 1, j: 2, angle: -0.4 },
      { i: 0, j: 1, angle: 0.2 }
    ]);
    expect(spin.coeffs).toHaveLength(6);
    expect(Array.from(spin.coeffs).filter((value) => value !== 0)).toHaveLength(3);
  });
});
