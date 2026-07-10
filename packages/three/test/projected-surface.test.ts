import { describe, expect, it } from 'vitest';
import {
  MatN,
  OrthographicProjection,
  PerspectiveProjection,
  TransformN,
  create24Cell,
  createHypercube
} from '@holotope/core';
import { ProjectedSurface3D } from '@holotope/three';

function surfaceArea(surface: ProjectedSurface3D): number {
  const positions = surface.geometry.getAttribute('position').array as Float32Array;
  let area = 0;
  for (let t = 0; t < surface.triangleCount; t++) {
    const o = t * 9;
    const ux = positions[o + 3]! - positions[o]!;
    const uy = positions[o + 4]! - positions[o + 1]!;
    const uz = positions[o + 5]! - positions[o + 2]!;
    const vx = positions[o + 6]! - positions[o]!;
    const vy = positions[o + 7]! - positions[o + 1]!;
    const vz = positions[o + 8]! - positions[o + 2]!;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

describe('ProjectedSurface3D', () => {
  it('n=3 invariant: a 3D cube renders its own surface, area 6·a²', () => {
    const cube = createHypercube({ dim: 3, size: 2 });
    const surface = new ProjectedSurface3D(cube, new PerspectiveProjection({ fromDim: 3 }));
    expect(surface.triangleCount).toBe(12); // 6 quads → 12 triangles
    expect(surfaceArea(surface)).toBeCloseTo(24, 5);
    surface.dispose();
  });

  it('tesseract: 24 square faces → 48 triangles', () => {
    const tesseract = createHypercube({ dim: 4, size: 2 });
    const surface = new ProjectedSurface3D(
      tesseract,
      new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
    );
    expect(surface.triangleCount).toBe(48);
    surface.dispose();
  });

  it('24-cell: 96 triangular faces map one-to-one', () => {
    const surface = new ProjectedSurface3D(
      create24Cell(),
      new OrthographicProjection({ fromDim: 4 })
    );
    expect(surface.triangleCount).toBe(96);
    // Simplex faces are not split: distinct provenance per triangle.
    const faces = new Set<number>();
    for (let t = 0; t < surface.triangleCount; t++) faces.add(surface.sourceFaceOfTriangle(t));
    expect(faces.size).toBe(96);
    surface.dispose();
  });

  it('quads split into two triangles sharing provenance', () => {
    const tesseract = createHypercube({ dim: 4, size: 2 });
    const surface = new ProjectedSurface3D(
      tesseract,
      new OrthographicProjection({ fromDim: 4 })
    );
    for (let t = 0; t < surface.triangleCount; t += 2) {
      expect(surface.sourceFaceOfTriangle(t)).toBe(surface.sourceFaceOfTriangle(t + 1));
    }
    const [a, b, c] = surface.faceVertices(0);
    expect(new Set([a, b, c]).size).toBe(3);
    surface.dispose();
  });

  it('normals stay unit length after a 4D rotation update', () => {
    const tesseract = createHypercube({ dim: 4, size: 2 });
    const surface = new ProjectedSurface3D(
      tesseract,
      new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
    );
    surface.update(new TransformN(4, MatN.rotationInPlane(4, 0, 3, 0.7)));
    const normals = surface.geometry.getAttribute('normal').array as Float32Array;
    for (let v = 0; v < surface.triangleCount * 3; v++) {
      expect(Math.hypot(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!)).toBeCloseTo(
        1,
        5
      );
    }
    surface.dispose();
  });

  it('rejects complexes without 2-cells', async () => {
    const { create120Cell } = await import('@holotope/core');
    expect(
      () =>
        new ProjectedSurface3D(create120Cell(), new PerspectiveProjection({ fromDim: 4 }))
    ).toThrow(/no faces/);
  });
});
