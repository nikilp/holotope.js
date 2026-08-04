import {
  CellComplex, CoordinateProjection, HyperplaneSlice4, type CellGroup
} from '@holotope/core';
import { Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ProjectedEdges3D, ProjectedSurface3D, SlicedComplex3D } from '../src/index.js';

/**
 * Geometry that moves must stay pickable.
 *
 * Three.js rejects a raycast against `geometry.boundingSphere` before it tests
 * a single triangle. A product that streams new positions into its attributes
 * without refreshing that sphere therefore keeps drawing correctly while
 * silently dropping intersections for anything that has left the shape it had
 * when it was constructed — the symptom is a view that still renders and still
 * orbits, but stops responding to clicks in exactly the region that moved.
 */

function sheet(): { complex: CellComplex; group: CellGroup } {
  // Two triangles, initially near the origin.
  const complex = new CellComplex(4, Float64Array.from([
    0, 0, 0, 0,
    1, 0, 0, 0,
    0, 1, 0, 0,
    1, 1, 0, 0
  ]), [{
    key: 'sheet', dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
  }]);
  const [group] = complex.cellsOfDim(2);
  if (group === undefined) throw new Error('sheet: no 2-cells');
  return { complex, group };
}

/** Moves every vertex far along x, well outside the original bounds. */
function translateFar(complex: CellComplex, distance: number): void {
  for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
    complex.positions[vertex * complex.ambientDim] += distance;
  }
}

/** Fires a ray straight down the -z axis at (x, y). */
function rayAt(x: number, y: number): Raycaster {
  return new Raycaster(new Vector3(x, y, 40), new Vector3(0, 0, -1), 0.01, 500);
}

describe('projected products — picking after the source moves', () => {
  it('keeps a surface pickable where it actually is', () => {
    const { complex } = sheet();
    const projection = new CoordinateProjection({ fromDim: 4, axes: [0, 1, 2] });
    const surface = new ProjectedSurface3D(complex, projection);
    surface.object.updateMatrixWorld(true);

    // Liveness: it is pickable where it starts, or the test proves nothing.
    expect(rayAt(0.5, 0.4).intersectObject(surface.object, false).length)
      .toBeGreaterThan(0);

    const distance = 250;
    translateFar(complex, distance);
    surface.update();
    surface.object.updateMatrixWorld(true);

    // It is drawn at the new place, so it must be pickable at the new place.
    const moved = rayAt(0.5 + distance, 0.4).intersectObject(surface.object, false);
    expect(moved.length).toBeGreaterThan(0);
    // And no longer pickable where it used to be.
    expect(rayAt(0.5, 0.4).intersectObject(surface.object, false).length).toBe(0);

    // The provenance path still resolves from the moved hit.
    const faceIndex = moved[0]?.faceIndex;
    expect(faceIndex).toBeDefined();
    expect(surface.faceVertices(faceIndex!).length).toBe(3);
  });

  it('keeps edges pickable where they actually are', () => {
    // The edge product needs 1-cells, which the triangle sheet does not carry.
    const complex = new CellComplex(4, Float64Array.from([
      0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0
    ]), [{
      key: 'wire', dim: 1, verticesPerCell: 2, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 1, 2])
    }]);
    const projection = new CoordinateProjection({ fromDim: 4, axes: [0, 1, 2] });
    const edges = new ProjectedEdges3D(complex, projection);
    edges.object.updateMatrixWorld(true);

    // The first pick is what makes the bug reachable: three.js computes a null
    // bounding sphere lazily on that raycast, and from then on it is whatever
    // shape the geometry had at the moment it was first clicked.
    expect(rayAt(0.5, 0).intersectObject(edges.object, false).length)
      .toBeGreaterThan(0);

    const distance = 250;
    translateFar(complex, distance);
    edges.update();
    edges.object.updateMatrixWorld(true);

    expect(rayAt(0.5 + distance, 0).intersectObject(edges.object, false).length)
      .toBeGreaterThan(0);
    expect(rayAt(0.5, 0).intersectObject(edges.object, false).length).toBe(0);
  });

  it('keeps a moving cross-section pickable', () => {
    // A 4D box whose x extent depends on w, so advancing the slice offset walks
    // the cross-section sideways — what the tesseract page's offset slider does.
    const positions: number[] = [];
    for (let corner = 0; corner < 16; corner++) {
      const w = (corner >> 3) & 1;
      positions.push(
        (corner & 1) * 3 + w * 30, ((corner >> 1) & 1) * 3, ((corner >> 2) & 1) * 3, w * 3
      );
    }
    const cells: number[] = [];
    for (let a = 0; a < 13; a++) cells.push(a, a + 1, a + 2, a + 3);
    const complex = new CellComplex(4, Float64Array.from(positions), [{
      key: 'solid', dim: 3, verticesPerCell: 4, kind: 'simplex',
      indices: Uint32Array.from(cells)
    }]);
    const slice = HyperplaneSlice4.axisAligned(3, 0.3);
    const section = new SlicedComplex3D(complex, slice);

    /** How many of a fixed grid of rays hit the section as it stands. */
    const reachable = (): number => {
      section.object.updateMatrixWorld(true);
      let hits = 0;
      for (let x = -6; x <= 40; x += 0.5) {
        for (let y = -4; y <= 8; y += 0.5) {
          const ray = new Raycaster(new Vector3(x, y, 60), new Vector3(0, 0, -1), 0.01, 400);
          if (ray.intersectObject(section.object, false).length > 0) hits++;
        }
      }
      return hits;
    };

    // Liveness: pickable where the first cut lands, which is also what fixes
    // the lazily-computed sphere in place for every later cut.
    expect(reachable()).toBeGreaterThan(0);

    // Cutting further along w slides the section clear of that first sphere.
    slice.offset = 2.7;
    section.update();
    expect(reachable()).toBeGreaterThan(0);
  });
});
