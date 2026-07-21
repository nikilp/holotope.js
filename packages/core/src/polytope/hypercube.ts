import { CellComplex } from '../geometry/cell-complex.js';

export interface HypercubeOptions {
  /** Ambient (and intrinsic) dimension; 4 gives a tesseract. */
  dim: number;
  /** Edge length. Default 1. */
  size?: number;
  /** Highest authored cuboid-cell dimension. Default `min(dim, 3)`. */
  maxCellDimension?: number;
}

/**
 * Builds an n-cube centered at the origin with vertices at ±size/2.
 *
 * Vertex `v` (0 … 2^n − 1) has coordinate `+h` on axis `a` iff bit `a` of
 * `v` is set. Cell counts: 2^n vertices, n·2^(n−1) edges,
 * C(n,2)·2^(n−2) square faces.
 */
export function createHypercube({
  dim,
  size = 1,
  maxCellDimension = Math.min(dim, 3)
}: HypercubeOptions): CellComplex {
  if (dim < 1 || dim > 30) throw new Error(`createHypercube: unsupported dimension ${dim}`);
  if (
    !Number.isSafeInteger(maxCellDimension) ||
    maxCellDimension < 1 ||
    maxCellDimension > dim
  ) {
    throw new Error(
      `createHypercube: maxCellDimension must be an integer from 1 through ${dim}`
    );
  }
  const h = size / 2;
  const vertexCount = 1 << dim;

  const positions = new Float64Array(vertexCount * dim);
  for (let v = 0; v < vertexCount; v++) {
    for (let a = 0; a < dim; a++) {
      positions[v * dim + a] = (v >> a) & 1 ? h : -h;
    }
  }

  // Edges: one per vertex per unset bit, connecting v to v with that bit set.
  const edgeCount = dim * (1 << (dim - 1));
  const edges = new Uint32Array(edgeCount * 2);
  let e = 0;
  for (let v = 0; v < vertexCount; v++) {
    for (let a = 0; a < dim; a++) {
      if (((v >> a) & 1) === 0) {
        edges[e++] = v;
        edges[e++] = v | (1 << a);
      }
    }
  }

  const complex = new CellComplex(dim, positions, [
    { dim: 1, verticesPerCell: 2, kind: 'cuboid', indices: edges }
  ]);

  // Square faces: for each axis pair (a < b), one face per vertex with both
  // bits clear. Wound as a quad loop v → v+2^a → v+2^a+2^b → v+2^b.
  if (dim >= 2 && maxCellDimension >= 2) {
    const faceCount = ((dim * (dim - 1)) / 2) * (1 << (dim - 2));
    const faces = new Uint32Array(faceCount * 4);
    let f = 0;
    for (let a = 0; a < dim; a++) {
      for (let b = a + 1; b < dim; b++) {
        for (let v = 0; v < vertexCount; v++) {
          if (((v >> a) & 1) === 0 && ((v >> b) & 1) === 0) {
            faces[f++] = v;
            faces[f++] = v | (1 << a);
            faces[f++] = v | (1 << a) | (1 << b);
            faces[f++] = v | (1 << b);
          }
        }
      }
    }
    complex.addGroup({ dim: 2, verticesPerCell: 4, kind: 'cuboid', indices: faces });
  }

  // Cubic 3-cells: for each axis triple (a < b < c), one cube per vertex with
  // all three bits clear — C(n,3)·2^(n−3) cells (the tesseract's 8 cubes).
  // Local vertex order: bit 0 → axis a, bit 1 → axis b, bit 2 → axis c.
  if (dim >= 3 && maxCellDimension >= 3) {
    const cubeCount = ((dim * (dim - 1) * (dim - 2)) / 6) * (1 << (dim - 3));
    const cubes = new Uint32Array(cubeCount * 8);
    let k = 0;
    for (let a = 0; a < dim; a++) {
      for (let b = a + 1; b < dim; b++) {
        for (let c = b + 1; c < dim; c++) {
          for (let v = 0; v < vertexCount; v++) {
            if (((v >> a) & 1) === 0 && ((v >> b) & 1) === 0 && ((v >> c) & 1) === 0) {
              for (let local = 0; local < 8; local++) {
                cubes[k++] =
                  v |
                  ((local & 1) !== 0 ? 1 << a : 0) |
                  ((local & 2) !== 0 ? 1 << b : 0) |
                  ((local & 4) !== 0 ? 1 << c : 0);
              }
            }
          }
        }
      }
    }
    complex.addGroup({ dim: 3, verticesPerCell: 8, kind: 'cuboid', indices: cubes });
  }

  // Higher cuboid cells are opt-in so established group order and default
  // topology remain unchanged. Local bit j selects the j-th chosen axis.
  for (let cellDimension = 4; cellDimension <= maxCellDimension; cellDimension++) {
    const localVertexCount = 2 ** cellDimension;
    const axesChoices = combinations(dim, cellDimension);
    const cellCount = axesChoices.length * 2 ** (dim - cellDimension);
    const indexCount = cellCount * localVertexCount;
    if (!Number.isSafeInteger(indexCount) || indexCount > 0xffff_ffff) {
      throw new Error(
        `createHypercube: R${dim} ${cellDimension}-cell group exceeds typed-array capacity`
      );
    }
    const cells = new Uint32Array(indexCount);
    let offset = 0;
    for (const axes of axesChoices) {
      let selectedMask = 0;
      for (const axis of axes) selectedMask |= 1 << axis;
      for (let base = 0; base < vertexCount; base++) {
        if ((base & selectedMask) !== 0) continue;
        for (let local = 0; local < localVertexCount; local++) {
          let vertex = base;
          for (let localAxis = 0; localAxis < cellDimension; localAxis++) {
            if ((local & (1 << localAxis)) !== 0) {
              vertex |= 1 << axes[localAxis]!;
            }
          }
          cells[offset++] = vertex;
        }
      }
    }
    complex.addGroup({
      dim: cellDimension,
      verticesPerCell: localVertexCount,
      kind: 'cuboid',
      indices: cells
    });
  }

  return complex;
}

function combinations(dimension: number, choose: number): number[][] {
  const result: number[][] = [];
  const current: number[] = [];
  const visit = (next: number): void => {
    if (current.length === choose) {
      result.push([...current]);
      return;
    }
    const remaining = choose - current.length;
    for (let axis = next; axis <= dimension - remaining; axis++) {
      current.push(axis);
      visit(axis + 1);
      current.pop();
    }
  };
  visit(0);
  return result;
}
