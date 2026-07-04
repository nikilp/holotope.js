import { describe, expect, it } from 'vitest';
import {
  HyperplaneSlice4,
  MatN,
  TransformN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { SlicedComplex3D } from '@holotope/three';

function makeTesseract() {
  return tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
}

function drawnArea(sliced: SlicedComplex3D): number {
  const positions = sliced.geometry.getAttribute('position').array as Float32Array;
  const vertexCount = sliced.geometry.drawRange.count;
  let area = 0;
  for (let t = 0; t < vertexCount; t += 3) {
    const o = t * 3;
    const ux = positions[o + 3]! - positions[o]!;
    const uy = positions[o + 4]! - positions[o + 1]!;
    const uz = positions[o + 5]! - positions[o + 2]!;
    const vx = positions[o + 6]! - positions[o]!;
    const vy = positions[o + 7]! - positions[o + 1]!;
    const vz = positions[o + 8]! - positions[o + 2]!;
    area +=
      Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

describe('SlicedComplex3D', () => {
  it('renders the w=0 tesseract section as a cube surface (area 24)', () => {
    const sliced = new SlicedComplex3D(makeTesseract(), HyperplaneSlice4.axisAligned(3, 0));
    expect(sliced.geometry.drawRange.count).toBeGreaterThan(0);
    expect(drawnArea(sliced)).toBeCloseTo(24, 4);
    sliced.dispose();
  });

  it('draws nothing when the hyperplane misses the object', () => {
    const sliced = new SlicedComplex3D(makeTesseract(), HyperplaneSlice4.axisAligned(3, 1.5));
    expect(sliced.geometry.drawRange.count).toBe(0);
    sliced.dispose();
  });

  it('mutating slice offset and calling update() moves the section', () => {
    const slice = HyperplaneSlice4.axisAligned(3, 0);
    const sliced = new SlicedComplex3D(makeTesseract(), slice);
    expect(drawnArea(sliced)).toBeCloseTo(24, 4);
    slice.offset = 1.5;
    sliced.update();
    expect(sliced.geometry.drawRange.count).toBe(0);
    slice.offset = -0.5;
    sliced.update();
    expect(drawnArea(sliced)).toBeCloseTo(24, 4);
    sliced.dispose();
  });

  it('a 90° xw rotation (self-symmetry of the tesseract) preserves the section', () => {
    const sliced = new SlicedComplex3D(makeTesseract(), HyperplaneSlice4.axisAligned(3, 0.25));
    const transform = new TransformN(4, MatN.rotationInPlane(4, 0, 3, Math.PI / 2));
    sliced.update(transform);
    expect(drawnArea(sliced)).toBeCloseTo(24, 4);
    sliced.dispose();
  });

  it('normals over the draw range are unit length', () => {
    const sliced = new SlicedComplex3D(makeTesseract(), HyperplaneSlice4.axisAligned(3, 0.3));
    const normals = sliced.geometry.getAttribute('normal').array as Float32Array;
    const count = sliced.geometry.drawRange.count;
    expect(count).toBeGreaterThan(0);
    for (let v = 0; v < count; v++) {
      const len = Math.hypot(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!);
      expect(len).toBeCloseTo(1, 5);
    }
    sliced.dispose();
  });

  it('rejects complexes without tetrahedral cells', () => {
    const raw = createHypercube({ dim: 4, size: 2 }); // cuboid cells only
    expect(() => new SlicedComplex3D(raw, HyperplaneSlice4.axisAligned())).toThrow(
      /tetrahedralizeCuboidCells/
    );
  });
});

describe('SlicedComplex3D with projection (section-in-projection overlay)', () => {
  it('projected section scales by V/(V−w) relative to the slice frame', async () => {
    const { PerspectiveProjection } = await import('@holotope/core');
    const viewDistance = 4;
    for (const offset of [0, 0.5, -0.75]) {
      const slice = HyperplaneSlice4.axisAligned(3, offset);
      const inFrame = new SlicedComplex3D(makeTesseract(), slice);
      const projected = new SlicedComplex3D(makeTesseract(), slice, {
        projection: new PerspectiveProjection({ fromDim: 4, viewDistance })
      });
      const expectedScale = viewDistance / (viewDistance - offset);
      const a = inFrame.geometry.getAttribute('position');
      const b = projected.geometry.getAttribute('position');
      const count = inFrame.geometry.drawRange.count;
      expect(projected.geometry.drawRange.count).toBe(count);
      expect(count).toBeGreaterThan(0);
      for (let v = 0; v < count; v++) {
        expect(b.getX(v)).toBeCloseTo(a.getX(v) * expectedScale, 4);
        expect(b.getY(v)).toBeCloseTo(a.getY(v) * expectedScale, 4);
        expect(b.getZ(v)).toBeCloseTo(a.getZ(v) * expectedScale, 4);
      }
      inFrame.dispose();
      projected.dispose();
    }
  });

  it('rejects projections with the wrong dimension', async () => {
    const { PerspectiveProjection } = await import('@holotope/core');
    expect(
      () =>
        new SlicedComplex3D(makeTesseract(), HyperplaneSlice4.axisAligned(), {
          projection: new PerspectiveProjection({ fromDim: 5 })
        })
    ).toThrow(/fromDim/);
  });
});
