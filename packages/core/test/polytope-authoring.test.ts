import { describe, expect, it } from 'vitest';
import { createCrossPolytope, createSimplex } from '../src/index.js';
import type { CellComplex } from '../src/index.js';

/**
 * P55B Part B gates: `maxCellDimension`, held to the frozen contract.
 *
 * The oracle for byte-identity is the pre-change implementation's nested
 * loops, reimplemented here verbatim — not the new enumerator calling itself.
 */

function legacySimplexGroups(dim: number): number[][] {
  const m = dim + 1;
  const edges: number[] = [];
  const triangles: number[] = [];
  const tets: number[] = [];
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      edges.push(a, b);
      for (let c = b + 1; c < m; c++) {
        triangles.push(a, b, c);
        for (let d = c + 1; d < m; d++) tets.push(a, b, c, d);
      }
    }
  }
  const groups = [edges];
  if (dim >= 2) groups.push(triangles);
  if (dim >= 3) groups.push(tets);
  return groups;
}

function legacyCrossGroups(dim: number): number[][] {
  const vertexCount = 2 * dim;
  const edges: number[] = [];
  for (let a = 0; a < vertexCount; a++) {
    for (let b = a + 1; b < vertexCount; b++) {
      if (b - a === dim && a < dim) continue;
      edges.push(a, b);
    }
  }
  const groups = [edges];
  if (dim >= 3) {
    const triangles: number[] = [];
    for (let a = 0; a < dim; a++) {
      for (let b = a + 1; b < dim; b++) {
        for (let c = b + 1; c < dim; c++) {
          for (let signs = 0; signs < 8; signs++) {
            triangles.push(
              (signs & 1) !== 0 ? a + dim : a,
              (signs & 2) !== 0 ? b + dim : b,
              (signs & 4) !== 0 ? c + dim : c
            );
          }
        }
      }
    }
    groups.push(triangles);
  }
  if (dim >= 4) {
    const tets: number[] = [];
    for (let a = 0; a < dim; a++) {
      for (let b = a + 1; b < dim; b++) {
        for (let c = b + 1; c < dim; c++) {
          for (let d = c + 1; d < dim; d++) {
            for (let signs = 0; signs < 16; signs++) {
              tets.push(
                (signs & 1) !== 0 ? a + dim : a,
                (signs & 2) !== 0 ? b + dim : b,
                (signs & 4) !== 0 ? c + dim : c,
                (signs & 8) !== 0 ? d + dim : d
              );
            }
          }
        }
      }
    }
    groups.push(tets);
  }
  return groups;
}

function binomialOracle(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let step = 0; step < k; step++) result = (result * (n - step)) / (step + 1);
  return Math.round(result);
}

function groupOfDim(complex: CellComplex, dim: number) {
  const group = complex.groups.find((candidate) => candidate.dim === dim);
  expect(group, `expected a ${dim}-group`).toBeDefined();
  return group!;
}

describe('defaults are byte-identical to the pre-change builders', () => {
  it('createSimplex, R1 through R8', () => {
    for (let dim = 1; dim <= 8; dim++) {
      const complex = createSimplex({ dim });
      const legacy = legacySimplexGroups(dim);
      expect(complex.groups.length).toBe(legacy.length);
      for (let at = 0; at < legacy.length; at++) {
        const group = complex.groups[at]!;
        expect(group.dim).toBe(at + 1);
        expect(group.kind).toBe('simplex');
        expect(Array.from(group.indices)).toEqual(legacy[at]);
      }
    }
  });

  it('createCrossPolytope, R1 through R8', () => {
    for (let dim = 1; dim <= 8; dim++) {
      const complex = createCrossPolytope({ dim });
      const legacy = legacyCrossGroups(dim);
      expect(complex.groups.length).toBe(legacy.length);
      for (let at = 0; at < legacy.length; at++) {
        expect(Array.from(complex.groups[at]!.indices)).toEqual(legacy[at]);
      }
    }
  });

  it('an explicit maxCellDimension equal to the default changes nothing', () => {
    for (const dim of [2, 4, 6]) {
      const bySilence = createSimplex({ dim });
      const byRequest = createSimplex({ dim, maxCellDimension: Math.min(dim, 3) });
      expect(byRequest.groups.length).toBe(bySilence.groups.length);
      for (let at = 0; at < bySilence.groups.length; at++) {
        expect(Array.from(byRequest.groups[at]!.indices))
          .toEqual(Array.from(bySilence.groups[at]!.indices));
      }
      const crossSilence = createCrossPolytope({ dim });
      const crossRequest = createCrossPolytope({ dim, maxCellDimension: Math.min(dim - 1, 3) });
      for (let at = 0; at < crossSilence.groups.length; at++) {
        expect(Array.from(crossRequest.groups[at]!.indices))
          .toEqual(Array.from(crossSilence.groups[at]!.indices));
      }
    }
  });
});

describe('analytic cell counts, R2 through R8', () => {
  it('simplex groups count C(dim+1, k+1) for every k through dim', () => {
    for (let dim = 2; dim <= 8; dim++) {
      const complex = createSimplex({ dim, maxCellDimension: dim });
      expect(complex.groups.length).toBe(dim); // k = 1…dim
      for (let k = 1; k <= dim; k++) {
        const group = groupOfDim(complex, k);
        expect(group.indices.length / group.verticesPerCell)
          .toBe(binomialOracle(dim + 1, k + 1));
      }
      // The top cell is one cell naming every vertex, in ascending order.
      const top = groupOfDim(complex, dim);
      expect(Array.from(top.indices)).toEqual(
        Array.from({ length: dim + 1 }, (_, vertex) => vertex)
      );
    }
  });

  it('cross-polytope groups count C(dim, k+1)·2^(k+1) for every k through dim-1', () => {
    for (let dim = 2; dim <= 8; dim++) {
      const complex = createCrossPolytope({ dim, maxCellDimension: dim - 1 });
      expect(complex.groups.length).toBe(dim - 1);
      for (let k = 1; k <= dim - 1; k++) {
        const group = groupOfDim(complex, k);
        expect(group.indices.length / group.verticesPerCell)
          .toBe(binomialOracle(dim, k + 1) * 2 ** (k + 1));
      }
    }
  });

  it('authors the commissioned R5 populations', () => {
    const simplex = createSimplex({ dim: 5, maxCellDimension: 4 });
    const simplexFacets = groupOfDim(simplex, 4);
    expect(simplexFacets.indices.length / 5).toBe(6); // C(6,5)

    const cross = createCrossPolytope({ dim: 5, maxCellDimension: 4 });
    const crossFacets = groupOfDim(cross, 4);
    expect(crossFacets.indices.length / 5).toBe(32); // C(5,5)·2^5
  });
});

describe('well-formedness of every authored cell', () => {
  it('indices in range, no duplicate cells, no antipodal cross-polytope pair', () => {
    for (const dim of [3, 5, 6]) {
      const simplex = createSimplex({ dim, maxCellDimension: dim });
      for (const group of simplex.groups) {
        const seen = new Set<string>();
        for (let cell = 0; cell < group.indices.length / group.verticesPerCell; cell++) {
          const vertices = Array.from(group.indices.subarray(
            cell * group.verticesPerCell, (cell + 1) * group.verticesPerCell
          ));
          for (const vertex of vertices) {
            expect(vertex).toBeGreaterThanOrEqual(0);
            expect(vertex).toBeLessThan(dim + 1);
          }
          expect(new Set(vertices).size).toBe(group.verticesPerCell);
          const key = [...vertices].sort((a, b) => a - b).join(',');
          expect(seen.has(key), `duplicate ${key} in simplex ${group.dim}-group`).toBe(false);
          seen.add(key);
        }
      }

      const cross = createCrossPolytope({ dim, maxCellDimension: dim - 1 });
      for (const group of cross.groups) {
        const seen = new Set<string>();
        for (let cell = 0; cell < group.indices.length / group.verticesPerCell; cell++) {
          const vertices = Array.from(group.indices.subarray(
            cell * group.verticesPerCell, (cell + 1) * group.verticesPerCell
          ));
          const axes = vertices.map((vertex) => vertex % dim);
          // One vertex per distinct axis is exactly "no antipodal pair".
          expect(new Set(axes).size).toBe(group.verticesPerCell);
          for (const vertex of vertices) {
            expect(vertex).toBeGreaterThanOrEqual(0);
            expect(vertex).toBeLessThan(2 * dim);
          }
          const key = [...vertices].sort((a, b) => a - b).join(',');
          expect(seen.has(key), `duplicate ${key} in cross ${group.dim}-group`).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it('every tet face of every new R5 4-facet is present, shared by exactly two', () => {
    for (const build of [
      () => createSimplex({ dim: 5, maxCellDimension: 4 }),
      () => createCrossPolytope({ dim: 5, maxCellDimension: 4 })
    ]) {
      const complex = build();
      const tets = groupOfDim(complex, 3);
      const tetKeys = new Set<string>();
      for (let cell = 0; cell < tets.indices.length / 4; cell++) {
        tetKeys.add(Array.from(tets.indices.subarray(cell * 4, cell * 4 + 4))
          .sort((a, b) => a - b).join(','));
      }
      const facets = groupOfDim(complex, 4);
      const facetCount = facets.indices.length / 5;
      const incidence = new Map<string, number>();
      for (let cell = 0; cell < facetCount; cell++) {
        const vertices = Array.from(facets.indices.subarray(cell * 5, cell * 5 + 5));
        for (let omit = 0; omit < 5; omit++) {
          const face = vertices.filter((_, at) => at !== omit)
            .sort((a, b) => a - b).join(',');
          // Complete boundary incidence: the (k-1)-group contains the face.
          expect(tetKeys.has(face), `facet face ${face} missing from the 3-group`).toBe(true);
          incidence.set(face, (incidence.get(face) ?? 0) + 1);
        }
      }
      // A boundary-sphere face is shared by exactly two facets.
      for (const [face, count] of incidence) {
        expect(count, `face ${face} shared ${count}×`).toBe(2);
      }
    }
  });
});

describe('determinism and invariances', () => {
  it('replays bitwise, and indices are independent of size', () => {
    const first = createSimplex({ dim: 5, maxCellDimension: 5, edgeLength: 1 });
    const second = createSimplex({ dim: 5, maxCellDimension: 5, edgeLength: 1 });
    expect(Array.from(second.positions)).toEqual(Array.from(first.positions));
    const scaled = createSimplex({ dim: 5, maxCellDimension: 5, edgeLength: 3.5 });
    for (let at = 0; at < first.groups.length; at++) {
      expect(Array.from(second.groups[at]!.indices)).toEqual(Array.from(first.groups[at]!.indices));
      expect(Array.from(scaled.groups[at]!.indices)).toEqual(Array.from(first.groups[at]!.indices));
    }
  });

  it('scales cross-polytope geometry exactly linearly, indices untouched', () => {
    const unit = createCrossPolytope({ dim: 5, maxCellDimension: 4, radius: 1 });
    const scaled = createCrossPolytope({ dim: 5, maxCellDimension: 4, radius: 2.5 });
    for (let at = 0; at < unit.positions.length; at++) {
      expect(scaled.positions[at]).toBe(unit.positions[at]! * 2.5);
    }
    for (let at = 0; at < unit.groups.length; at++) {
      expect(Array.from(scaled.groups[at]!.indices)).toEqual(Array.from(unit.groups[at]!.indices));
    }
  });

  it('measures every simplex edge at the requested edge length', () => {
    const edgeLength = 1.75;
    const complex = createSimplex({ dim: 6, maxCellDimension: 6, edgeLength });
    const edges = groupOfDim(complex, 1);
    for (let cell = 0; cell < edges.indices.length / 2; cell++) {
      const a = edges.indices[cell * 2]!;
      const b = edges.indices[cell * 2 + 1]!;
      let distanceSq = 0;
      for (let axis = 0; axis < 6; axis++) {
        const delta = complex.positions[a * 6 + axis]! - complex.positions[b * 6 + axis]!;
        distanceSq += delta * delta;
      }
      expect(Math.sqrt(distanceSq)).toBeCloseTo(edgeLength, 10);
    }
  });

  it('maps the cross-polytope cell set onto itself under an axis permutation', () => {
    const dim = 5;
    const complex = createCrossPolytope({ dim, maxCellDimension: 4 });
    // A cyclic axis permutation, lifted to vertices (+e_i and −e_i together).
    const permuteVertex = (vertex: number): number => {
      const axis = vertex % dim;
      const negative = vertex >= dim;
      const image = (axis + 1) % dim;
      return negative ? image + dim : image;
    };
    for (const group of complex.groups) {
      const cells = new Set<string>();
      const cellCount = group.indices.length / group.verticesPerCell;
      for (let cell = 0; cell < cellCount; cell++) {
        cells.add(Array.from(group.indices.subarray(
          cell * group.verticesPerCell, (cell + 1) * group.verticesPerCell
        )).sort((a, b) => a - b).join(','));
      }
      for (const key of cells) {
        const image = key.split(',').map((v) => permuteVertex(Number(v)))
          .sort((a, b) => a - b).join(',');
        expect(cells.has(image), `permuted ${key} → ${image} left the set`).toBe(true);
      }
    }
  });
});

describe('typed refusals, before any allocation', () => {
  it('refuses bad dimensions, sizes, and ranges by name', () => {
    expect(() => createSimplex({ dim: 0 })).toThrow(/dim must be a safe integer >= 1/);
    expect(() => createSimplex({ dim: 2.5 })).toThrow(/safe integer/);
    expect(() => createSimplex({ dim: 3, edgeLength: 0 })).toThrow(/finite and positive/);
    expect(() => createSimplex({ dim: 3, edgeLength: Number.NaN })).toThrow(/finite and positive/);
    expect(() => createSimplex({ dim: 3, maxCellDimension: 0 })).toThrow(/safe integer >= 1/);
    expect(() => createSimplex({ dim: 3, maxCellDimension: 4 }))
      .toThrow(/exceeds 3, the top cell of a 3-simplex/);

    expect(() => createCrossPolytope({ dim: 0 })).toThrow(/safe integer >= 1/);
    expect(() => createCrossPolytope({ dim: 4, radius: -1 })).toThrow(/finite and positive/);
    // The commissioned refusal: no simplicial top cell exists.
    expect(() => createCrossPolytope({ dim: 4, maxCellDimension: 4 }))
      .toThrow(/its top cell is the whole body, not a simplex/);
    expect(() => createCrossPolytope({ dim: 4, maxCellDimension: 5 }))
      .toThrow(/exceeds 3/);
  });

  it('refuses a combinatorial explosion arithmetically, fast', () => {
    const beganAt = Date.now();
    expect(() => createSimplex({ dim: 60, maxCellDimension: 30 }))
      .toThrow(/needs (Infinity|\d+) indices, above the \d+ per-group limit/);
    expect(() => createCrossPolytope({ dim: 40, maxCellDimension: 30 }))
      .toThrow(/above the \d+ per-group limit/);
    // Arithmetic, not allocation: an explosion that took seconds would mean
    // something was being built before the refusal.
    expect(Date.now() - beganAt).toBeLessThan(250);
  });
});

describe('the orientation decision, measured rather than assumed', () => {
  it('ascending-index facets double their shared faces instead of cancelling', () => {
    // The documented limitation, pinned as a fact: under the emitted order the
    // boundary chain of the R5 simplex's facets does not cancel, so authored
    // groups are combinatorial rather than oriented — the oriented path is
    // sectionSimplexGroupN, which derives orientation from geometry.
    //
    // The failure is partial, not uniform, and the assertions below are
    // deliberately bounded because of it. Facet `i` omits vertex `i`; for
    // i < j their shared tet carries (-1)^(j-1) from facet i and (-1)^i from
    // facet j, so it cancels exactly when i + j is even. That is 6 of the 15
    // interior tets; the other 9 double. Accidental partial coherence is
    // precisely what the `cancelled < size` assertion guards against.
    const complex = createSimplex({ dim: 5, maxCellDimension: 4 });
    const facets = groupOfDim(complex, 4);
    const oriented = new Map<string, number>();
    for (let cell = 0; cell < facets.indices.length / 5; cell++) {
      const vertices = Array.from(facets.indices.subarray(cell * 5, cell * 5 + 5));
      for (let omit = 0; omit < 5; omit++) {
        const face = vertices.filter((_, at) => at !== omit);
        const sign = omit % 2 === 0 ? 1 : -1; // boundary sign of the ordered cell
        // Orientation class of the ordered face vs its sorted form: parity of
        // the sort permutation. Ascending emission makes every face sorted
        // already, so the class is always +1 and only the boundary sign
        // varies — which is why some pairs cancel and most do not.
        const key = [...face].sort((a, b) => a - b).join(',');
        oriented.set(key, (oriented.get(key) ?? 0) + sign);
      }
    }
    let cancelled = 0;
    let doubled = 0;
    for (const total of oriented.values()) {
      if (total === 0) cancelled++;
      else doubled++;
    }
    // Liveness first: the boundary has faces at all.
    expect(oriented.size).toBe(15);
    expect(doubled).toBeGreaterThan(0); // the limitation is real…
    expect(cancelled).toBeLessThan(oriented.size); // …and not accidental coherence
  });
});
