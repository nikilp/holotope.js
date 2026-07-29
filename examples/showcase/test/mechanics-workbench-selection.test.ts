import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneSlice4,
  PerspectiveProjection,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  ProjectedSurface3D,
  SlicedComplex3D,
  representationHitFromProjectedSurface,
  representationHitFromSlicedComplex
} from '@holotope/three';
import { resolveMechanicsWorkbenchSourceSelection } from '../src/mechanics-workbench-selection.js';

const createSource = () => {
  const source = tetrahedralizeCuboidCells(
    createHypercube({ dim: 4, size: 2, maxCellDimension: 4 })
  );
  const tetrahedra = source.cellsOfDim(3).find(
    (group) => group.kind === 'simplex'
  )!;
  return { source, tetrahedra };
};

const faceCentroid = (
  positions: ArrayLike<number>,
  faceIndex: number
): Vector3 => {
  const offset = faceIndex * 9;
  return new Vector3(
    (positions[offset]! + positions[offset + 3]! + positions[offset + 6]!) / 3,
    (positions[offset + 1]! + positions[offset + 4]! + positions[offset + 7]!) / 3,
    (positions[offset + 2]! + positions[offset + 5]! + positions[offset + 8]!) / 3
  );
};

describe('mechanics-workbench source selection', () => {
  it('relates a projected triangle to its exact incident source tetrahedra', () => {
    const { source, tetrahedra } = createSource();
    const surface = new ProjectedSurface3D(
      source,
      new PerspectiveProjection({ fromDim: 4, viewDistance: 5.8 })
    );
    const point = faceCentroid(
      surface.geometry.getAttribute('position').array,
      0
    );
    const hit = representationHitFromProjectedSurface(surface, {
      point,
      faceIndex: 0
    });

    const selection = resolveMechanicsWorkbenchSourceSelection(hit, tetrahedra);

    expect(hit.source.kind).toBe('cell');
    expect(selection.vertexIndices).toHaveLength(3);
    expect(Array.from(selection.tetrahedronIndices)).toHaveLength(2);
    for (const tetIndex of selection.tetrahedronIndices) {
      const start = tetIndex * 4;
      const vertices = new Set(tetrahedra.indices.subarray(start, start + 4));
      expect(selection.vertexIndices.every((vertex) => vertices.has(vertex))).toBe(true);
    }
    surface.dispose();
  });

  it('relates an exact section triangle back to its one source tetrahedron', () => {
    const { source, tetrahedra } = createSource();
    const section = new SlicedComplex3D(
      source,
      HyperplaneSlice4.axisAligned(3, 0.15)
    );
    expect(section.triangleCount).toBeGreaterThan(0);
    const point = faceCentroid(
      section.geometry.getAttribute('position').array,
      0
    );
    const hit = representationHitFromSlicedComplex(section, {
      point,
      faceIndex: 0
    });

    const selection = resolveMechanicsWorkbenchSourceSelection(hit, tetrahedra);

    expect(hit.ambientPointStatus).toBe('exact');
    expect(hit.ambiguity).toBe('none');
    expect(Array.from(selection.tetrahedronIndices)).toEqual([
      section.sourceTetOfFace(0)
    ]);
    section.dispose();
  });

  it('refuses a tetrahedron group from another source', () => {
    const first = createSource();
    const second = createSource();
    const surface = new ProjectedSurface3D(
      first.source,
      new PerspectiveProjection({ fromDim: 4, viewDistance: 5.8 })
    );
    const hit = representationHitFromProjectedSurface(surface, {
      point: faceCentroid(surface.geometry.getAttribute('position').array, 0),
      faceIndex: 0
    });

    expect(() =>
      resolveMechanicsWorkbenchSourceSelection(hit, second.tetrahedra)
    ).toThrow(/another source/);
    surface.dispose();
  });
});
