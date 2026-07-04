import { describe, expect, it } from 'vitest';
import {
  HyperplaneSlice4,
  MatN,
  TransformN,
  VecN,
  createHypercube,
  rotationFromPlanes,
  sliceTetrahedra,
  tetrahedralizeCuboidCells
} from '@holotope/core';

function tesseractTets() {
  const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
  const tetGroup = complex.groups.find((g) => g.dim === 3 && g.kind === 'simplex')!;
  return { complex, tets: tetGroup.indices };
}

/** 3-volume of a tetra embedded in R^4 via the Gram determinant. */
function tetraVolume4(positions: Float64Array, a: number, b: number, c: number, d: number): number {
  const e = [b, c, d].map((v) => {
    const edge = new Float64Array(4);
    for (let k = 0; k < 4; k++) edge[k] = positions[v * 4 + k]! - positions[a * 4 + k]!;
    return edge;
  });
  const g = (i: number, j: number) => {
    let acc = 0;
    for (let k = 0; k < 4; k++) acc += e[i]![k]! * e[j]![k]!;
    return acc;
  };
  const det =
    g(0, 0) * (g(1, 1) * g(2, 2) - g(1, 2) * g(2, 1)) -
    g(0, 1) * (g(1, 0) * g(2, 2) - g(1, 2) * g(2, 0)) +
    g(0, 2) * (g(1, 0) * g(2, 1) - g(1, 1) * g(2, 0));
  return Math.sqrt(Math.max(0, det)) / 6;
}

function triangleSoupArea(positions: Float32Array, vertexCount: number): number {
  let area = 0;
  for (let t = 0; t < vertexCount; t += 3) {
    const ax = positions[t * 3]!, ay = positions[t * 3 + 1]!, az = positions[t * 3 + 2]!;
    const bx = positions[t * 3 + 3]!, by = positions[t * 3 + 4]!, bz = positions[t * 3 + 5]!;
    const cx = positions[t * 3 + 6]!, cy = positions[t * 3 + 7]!, cz = positions[t * 3 + 8]!;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const crx = uy * vz - uz * vy;
    const cry = uz * vx - ux * vz;
    const crz = ux * vy - uy * vx;
    area += Math.sqrt(crx * crx + cry * cry + crz * crz) / 2;
  }
  return area;
}

describe('tetrahedralizeCuboidCells', () => {
  it('tesseract: 8 cubes → 48 tetrahedra', () => {
    const { complex } = tesseractTets();
    expect(complex.cellsOfDim(3).find((g) => g.kind === 'cuboid')!.indices.length / 8).toBe(8);
    expect(complex.cellsOfDim(3).find((g) => g.kind === 'simplex')!.indices.length / 4).toBe(48);
  });

  it('conserves the boundary 3-volume of the tesseract (8 cubes × 2³ = 64)', () => {
    const { complex, tets } = tesseractTets();
    let volume = 0;
    for (let t = 0; t < tets.length; t += 4) {
      volume += tetraVolume4(complex.positions, tets[t]!, tets[t + 1]!, tets[t + 2]!, tets[t + 3]!);
    }
    expect(volume).toBeCloseTo(64, 10);
  });

  it('throws when the complex has no cuboid 3-cells', () => {
    expect(() => tetrahedralizeCuboidCells(createHypercube({ dim: 2 }))).toThrow(/no cuboid/);
  });
});

describe('HyperplaneSlice4', () => {
  it('axis-aligned w slice uses the identity display frame', () => {
    const slice = HyperplaneSlice4.axisAligned(3, 0.25);
    expect(Array.from(slice.basis[0])).toEqual([1, 0, 0, 0]);
    expect(Array.from(slice.basis[1])).toEqual([0, 1, 0, 0]);
    expect(Array.from(slice.basis[2])).toEqual([0, 0, 1, 0]);
    expect(slice.signedDistance(9, 9, 9, 0.25)).toBeCloseTo(0, 15);
  });

  it('builds an orthonormal frame for arbitrary normals', () => {
    const slice = new HyperplaneSlice4({ normal: new VecN([1, 1, 1, 1]) });
    const vecs = [slice.normal.data, ...slice.basis];
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        let dot = 0;
        for (let c = 0; c < 4; c++) dot += vecs[a]![c]! * vecs[b]![c]!;
        expect(dot).toBeCloseTo(a === b ? 1 : 0, 12);
      }
    }
  });
});

describe('sliceTetrahedra', () => {
  it('tesseract sliced at w=0 yields the surface of a 2×2×2 cube (area 24)', () => {
    const { complex, tets } = tesseractTets();
    const slice = HyperplaneSlice4.axisAligned(3, 0);
    const out = new Float32Array((tets.length / 4) * 18);
    const vertexCount = sliceTetrahedra(complex.positions, tets, slice, out);

    expect(vertexCount).toBeGreaterThan(0);
    expect(vertexCount % 3).toBe(0);
    // Every section vertex lies on the cube surface: max |coordinate| = 1.
    for (let v = 0; v < vertexCount; v++) {
      const m = Math.max(
        Math.abs(out[v * 3]!),
        Math.abs(out[v * 3 + 1]!),
        Math.abs(out[v * 3 + 2]!)
      );
      expect(m).toBeCloseTo(1, 6);
    }
    expect(triangleSoupArea(out, vertexCount)).toBeCloseTo(24, 6);
  });

  it('section area is invariant while |w| < 1 and empty beyond the tesseract', () => {
    const { complex, tets } = tesseractTets();
    const out = new Float32Array((tets.length / 4) * 18);
    for (const offset of [-0.75, -0.3, 0.5, 0.99]) {
      const slice = HyperplaneSlice4.axisAligned(3, offset);
      const count = sliceTetrahedra(complex.positions, tets, slice, out);
      expect(triangleSoupArea(out, count)).toBeCloseTo(24, 4);
    }
    const outside = HyperplaneSlice4.axisAligned(3, 1.5);
    expect(sliceTetrahedra(complex.positions, tets, outside, out)).toBe(0);
  });

  it('boundary-coincident slice at w=1 is the continuous limit, emitted once', () => {
    const { complex, tets } = tesseractTets();
    const slice = HyperplaneSlice4.axisAligned(3, 1);
    const out = new Float32Array((tets.length / 4) * 18);
    const count = sliceTetrahedra(complex.positions, tets, slice, out);
    // Degeneracy policy: the fully coincident cap cube (all distances snap
    // to 0, counted non-negative) is suppressed; lateral-cube tetrahedra
    // with a face exactly in the hyperplane emit that face once. Net result:
    // the section approaches area 24 as w→1 and equals 24 at w=1 — no
    // duplicate faces, no discontinuity.
    expect(triangleSoupArea(out, count)).toBeCloseTo(24, 4);
  });

  it('a 90° xw rotation maps the tesseract to itself: section area preserved', () => {
    const { complex, tets } = tesseractTets();
    const transform = new TransformN(4, MatN.rotationInPlane(4, 0, 3, Math.PI / 2));
    const world = new Float64Array(complex.positions.length);
    transform.applyToPositions(complex.positions, world, complex.vertexCount);

    const slice = HyperplaneSlice4.axisAligned(3, 0.25);
    const out = new Float32Array((tets.length / 4) * 18);
    const count = sliceTetrahedra(world, tets, slice, out);
    expect(triangleSoupArea(out, count)).toBeCloseTo(24, 4);
  });

  it('rotated 45° in xw, the w=0 section is still bounded by the circumradius', () => {
    const { complex, tets } = tesseractTets();
    const transform = new TransformN(4, rotationFromPlanes(4, [{ i: 0, j: 3, angle: Math.PI / 4 }]));
    const world = new Float64Array(complex.positions.length);
    transform.applyToPositions(complex.positions, world, complex.vertexCount);

    const slice = HyperplaneSlice4.axisAligned(3, 0);
    const out = new Float32Array((tets.length / 4) * 18);
    const count = sliceTetrahedra(world, tets, slice, out);
    expect(count).toBeGreaterThan(0);
    for (let v = 0; v < count * 3; v++) {
      expect(Number.isFinite(out[v]!)).toBe(true);
    }
    for (let v = 0; v < count; v++) {
      const r = Math.hypot(out[v * 3]!, out[v * 3 + 1]!, out[v * 3 + 2]!);
      expect(r).toBeLessThanOrEqual(2 + 1e-6); // tesseract circumradius
    }
  });
});

describe('sliceTetrahedraAmbient', () => {
  it('emits 4D points lying exactly on the hyperplane', async () => {
    const { sliceTetrahedraAmbient, VecN } = await import('@holotope/core');
    const { complex, tets } = tesseractTets();
    const transform = new TransformN(4, rotationFromPlanes(4, [{ i: 0, j: 3, angle: 0.6 }]));
    const world = new Float64Array(complex.positions.length);
    transform.applyToPositions(complex.positions, world, complex.vertexCount);

    const slice = new HyperplaneSlice4({ normal: new VecN([1, 1, 0, 2]), offset: 0.3 });
    const out = new Float64Array((tets.length / 4) * 24);
    const count = sliceTetrahedraAmbient(world, tets, slice, out);
    expect(count).toBeGreaterThan(0);
    for (let v = 0; v < count; v++) {
      const d = slice.signedDistance(out[v * 4]!, out[v * 4 + 1]!, out[v * 4 + 2]!, out[v * 4 + 3]!);
      expect(Math.abs(d)).toBeLessThan(1e-9);
    }
  });

  it('axis-aligned slice pins the hidden coordinate to the offset', async () => {
    const { sliceTetrahedraAmbient } = await import('@holotope/core');
    const { complex, tets } = tesseractTets();
    const slice = HyperplaneSlice4.axisAligned(3, 0.4);
    const out = new Float64Array((tets.length / 4) * 24);
    const count = sliceTetrahedraAmbient(complex.positions, tets, slice, out);
    for (let v = 0; v < count; v++) {
      expect(out[v * 4 + 3]!).toBeCloseTo(0.4, 12);
    }
  });

  it('slice-frame output equals basis-mapped ambient output', async () => {
    const { sliceTetrahedraAmbient, VecN } = await import('@holotope/core');
    const { complex, tets } = tesseractTets();
    const slice = new HyperplaneSlice4({ normal: new VecN([0, 1, 1, 1]), offset: -0.2 });
    const ambient = new Float64Array((tets.length / 4) * 24);
    const framed = new Float32Array((tets.length / 4) * 18);
    const countA = sliceTetrahedraAmbient(complex.positions, tets, slice, ambient);
    const countF = sliceTetrahedra(complex.positions, tets, slice, framed);
    expect(countA).toBe(countF);
    for (let v = 0; v < countA; v++) {
      for (let k = 0; k < 3; k++) {
        const bk = slice.basis[k]!;
        const expected =
          bk[0]! * ambient[v * 4]! +
          bk[1]! * ambient[v * 4 + 1]! +
          bk[2]! * ambient[v * 4 + 2]! +
          bk[3]! * ambient[v * 4 + 3]!;
        expect(framed[v * 3 + k]!).toBeCloseTo(expected, 5);
      }
    }
  });
});
