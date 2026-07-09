import { CellComplex } from '../geometry/cell-complex.js';

export interface DuoprismOptions {
  /** Vertex count of the first polygon (xy plane), ≥ 3. */
  p: number;
  /** Vertex count of the second polygon (zw plane), ≥ 3. */
  q: number;
  /** Circumradius of the p-gon. Default 1. */
  radius1?: number;
  /** Circumradius of the q-gon. Default 1. */
  radius2?: number;
}

/**
 * Builds the p,q-duoprism: the Cartesian product of two regular polygons,
 * one in the xy plane and one in the zw plane — the simplest uniform (but
 * not regular) polychoron family, and inherently 4D: no lower-dimensional
 * analogue is a product of two polygons.
 *
 * Structure: p·q vertices, 2pq edges, pq square faces (plus the polygon
 * faces of the prisms), and p + q prismatic cells — q p-gonal prisms and
 * p q-gonal prisms. Every vertex lies on the Clifford torus of radii
 * (radius1, radius2). The 4,4-duoprism with equal radii is a tesseract.
 *
 * Cells are decomposed into 6(pq − p − q) tetrahedra without helper
 * vertices (polygon fan × prism staircase), so the complex is sliceable.
 */
export function createDuoprism({ p, q, radius1 = 1, radius2 = 1 }: DuoprismOptions): CellComplex {
  if (p < 3 || q < 3) throw new Error(`createDuoprism: need p, q ≥ 3, got ${p}, ${q}`);

  // Vertex (i, j) = i-th p-gon corner in xy × j-th q-gon corner in zw.
  const vertex = (i: number, j: number): number => ((j % q) + q) % q * p + (((i % p) + p) % p);
  const positions = new Float64Array(p * q * 4);
  for (let j = 0; j < q; j++) {
    const zwAngle = (2 * Math.PI * j) / q;
    for (let i = 0; i < p; i++) {
      const xyAngle = (2 * Math.PI * i) / p;
      const base = vertex(i, j) * 4;
      positions[base] = radius1 * Math.cos(xyAngle);
      positions[base + 1] = radius1 * Math.sin(xyAngle);
      positions[base + 2] = radius2 * Math.cos(zwAngle);
      positions[base + 3] = radius2 * Math.sin(zwAngle);
    }
  }

  // Two edge families: p-gon edges (per zw corner) and q-gon edges (per xy corner).
  const edges: number[] = [];
  for (let j = 0; j < q; j++) {
    for (let i = 0; i < p; i++) {
      edges.push(vertex(i, j), vertex(i + 1, j));
      edges.push(vertex(i, j), vertex(i, j + 1));
    }
  }

  // Square faces: edge of the p-gon × edge of the q-gon.
  const squares: number[] = [];
  for (let j = 0; j < q; j++) {
    for (let i = 0; i < p; i++) {
      squares.push(vertex(i, j), vertex(i + 1, j), vertex(i + 1, j + 1), vertex(i, j + 1));
    }
  }

  // Prismatic cells → tetrahedra: fan the polygon into triangles, then
  // split each triangular prism (A,B,C | A',B',C') into the staircase
  // (A,B,C,A'), (B,C,A',B'), (C,A',B',C').
  const tets: number[] = [];
  const prismTets = (
    bottom: (k: number) => number,
    top: (k: number) => number,
    sides: number
  ): void => {
    for (let k = 1; k < sides - 1; k++) {
      const corners = [0, k, k + 1];
      const [A, B, C] = corners.map(bottom) as [number, number, number];
      const [A2, B2, C2] = corners.map(top) as [number, number, number];
      tets.push(A, B, C, A2, B, C, A2, B2, C, A2, B2, C2);
    }
  };
  for (let j = 0; j < q; j++) {
    // p-gonal prism between zw corners j and j+1.
    prismTets((k) => vertex(k, j), (k) => vertex(k, j + 1), p);
  }
  for (let i = 0; i < p; i++) {
    // q-gonal prism between xy corners i and i+1.
    prismTets((k) => vertex(i, k), (k) => vertex(i + 1, k), q);
  }

  return new CellComplex(4, positions, [
    { dim: 1, verticesPerCell: 2, kind: 'simplex', indices: Uint32Array.from(edges) },
    { dim: 2, verticesPerCell: 4, kind: 'cuboid', indices: Uint32Array.from(squares) },
    { dim: 3, verticesPerCell: 4, kind: 'simplex', indices: Uint32Array.from(tets) }
  ]);
}
