import {
  CellComplex,
  HyperplaneSliceN,
  createHypercube,
  sectionSimplexGroupN,
  simplexizeCuboidGroupN,
  type CellGroup,
  type SectionSimplexGroupNResultN
} from '@holotope/core';

/**
 * The geometry behind "Flatland, honestly", with no DOM and no renderer.
 *
 * A cube is cut by a plane perpendicular to its main diagonal. The section is
 * produced by the library's own `sectionSimplexGroupN`, not by a hand-rolled
 * cut: the page's whole claim is that the flat shape is derived from an
 * authoritative solid, so deriving it any other way would make the page a
 * drawing of the lesson rather than an instance of it.
 *
 * Two facts about the pipeline matter enough to state here.
 *
 * The section arrives **triangulated**, because `sectionSimplexGroupN` emits
 * simplices. Its boundary therefore has more edges than the shape has sides:
 * the six Kuhn tetrahedra subdivide each side. {@link sectionOutline} merges
 * collinear runs, so a triangle is reported as three sides rather than six —
 * counting raw boundary edges would have this page claiming a cube sections
 * into hexagons and dodecagons, which is false.
 *
 * The tetrahedra come from `simplexizeCuboidGroupN` on the cube's **3-cell**
 * group. That branch is exact (CORE-HC2-R0 measured it tiling with no gap and
 * no overlap in R3 and R4). The 2-cell group is wound cyclically for the
 * renderer and is never used here.
 */

/** Half-extent of the authored cube: vertices sit at every ±1 corner. */
export const CUBE_HALF_EXTENT = 1;

/**
 * Where the section changes its number of sides, `±1/√3` of the diagonal.
 *
 * The plane's normal is the unit main diagonal, so a corner's signed distance
 * is `±3/√3 = ±√3`. Between a corner and the first ring of its neighbours the
 * cut meets three edges; past that it meets six. Both figures are pinned in
 * `test/flatland.test.ts` against the section itself rather than against this
 * comment.
 */
export const SIDE_CHANGE_OFFSET = 1 / Math.sqrt(3);

/** Signed distance of the extreme corners from the origin along the diagonal. */
export const DIAGONAL_REACH = Math.sqrt(3);

/** One cut, reduced to what the page draws and what it may claim. */
export interface FlatlandOutline {
  /** Offset along the diagonal this outline was cut at. */
  readonly offset: number;
  /**
   * Boundary ring in chart coordinates, one `[x, y]` per ring vertex.
   *
   * Ring vertices include the subdivision points the tetrahedralization
   * introduces. Draw this; do not count it.
   */
  readonly ring: readonly (readonly [number, number])[];
  /** Geometric sides, after merging collinear runs. Three, six, or zero. */
  readonly sides: number;
  /** `'triangle'`, `'hexagon'`, `'empty'`, or the side count for anything else. */
  readonly shape: string;
  /** Section vertex index for each ring position, for provenance lookups. */
  readonly ringVertices: readonly number[];
  /** The raw result, so a caller can reach lineage and diagnostics. */
  readonly result: SectionSimplexGroupNResultN;
}

/**
 * The key this module gives the tetrahedral group it adds to the cube.
 *
 * The complex is the authority, so the group lives inside it rather than
 * beside it, and this name is how the cut finds it again. Naming it also
 * decides what happens if the complex ever gains a second simplex group:
 * `flatlandTetrahedra` asks for *this* group rather than for the first
 * compatible one, so an unrelated group added earlier cannot capture the cut.
 */
export const FLATLAND_TETRAHEDRA_KEY = 'flatland-tetrahedra';

/** The authored solid and the diagonal it is cut on. */
export interface FlatlandSource {
  readonly complex: CellComplex;
  /** Unit main diagonal, the plane's normal. */
  readonly normal: readonly [number, number, number];
}

/**
 * Builds the cube and the tetrahedralization every cut is taken from.
 *
 * @returns The complex with its named simplex group attached, ready to section.
 */
export function buildFlatlandSource(): FlatlandSource {
  const complex = createHypercube({ dim: 3, size: 2 * CUBE_HALF_EXTENT });
  const cuboid = complex
    .cellsOfDim(3)
    .find((group) => group.kind === 'cuboid');
  if (cuboid === undefined) {
    throw new Error('buildFlatlandSource: the cube has no cuboid 3-cell');
  }
  const tetrahedra = simplexizeCuboidGroupN(cuboid).simplexGroup;
  tetrahedra.key = FLATLAND_TETRAHEDRA_KEY;
  // `addGroup` refuses a duplicate key, so the complex itself guarantees the
  // name resolves to at most one group.
  complex.addGroup(tetrahedra);
  const unit = 1 / Math.sqrt(3);
  return { complex, normal: [unit, unit, unit] };
}

/**
 * The tetrahedral group the cut is taken from, located by name and checked.
 *
 * Every failure here means the complex is not the one this module built, so
 * each is raised rather than worked around: silently sectioning a group of the
 * wrong dimension or arity would produce an outline that looks plausible and
 * describes something else.
 *
 * @param complex - The authored solid, normally `source.complex`.
 */
export function flatlandTetrahedra(complex: CellComplex): CellGroup {
  const named = complex.groups.filter(
    (group) => group.key === FLATLAND_TETRAHEDRA_KEY
  );
  if (named.length === 0) {
    throw new Error(
      `flatlandTetrahedra: no group keyed "${FLATLAND_TETRAHEDRA_KEY}"; ` +
      'this complex did not come from buildFlatlandSource'
    );
  }
  // Unreachable through the released surface: `CellComplex` refuses a duplicate
  // key at construction and at `addGroup`. Kept so this accessor is correct on
  // its own terms rather than because of where it happens to be called.
  if (named.length > 1) {
    throw new Error(
      `flatlandTetrahedra: ${named.length} groups are keyed ` +
      `"${FLATLAND_TETRAHEDRA_KEY}", so the cut has no single source`
    );
  }
  const group = named[0]!;
  if (group.dim !== 3 || group.kind !== 'simplex' || group.verticesPerCell !== 4) {
    throw new Error(
      `flatlandTetrahedra: group "${FLATLAND_TETRAHEDRA_KEY}" is ` +
      `${group.dim}-dimensional ${group.kind} with ${group.verticesPerCell} ` +
      'vertices per cell; the cut needs 3-dimensional simplices with 4'
    );
  }
  return group;
}

/**
 * Cuts the solid at one offset and reduces the result to a drawable outline.
 *
 * @param source - The solid to cut, from {@link buildFlatlandSource}.
 * @param offset - Signed distance of the plane along the diagonal.
 * @returns The boundary ring, its geometric side count, and the raw section.
 *
 * @example
 * ```ts
 * const source = buildFlatlandSource();
 * sectionOutline(source, 0).shape;      // 'hexagon'
 * sectionOutline(source, -1.2).shape;   // 'triangle'
 * ```
 */
export function sectionOutline(
  source: FlatlandSource,
  offset: number
): FlatlandOutline {
  const result = sectionSimplexGroupN({
    complex: source.complex,
    group: flatlandTetrahedra(source.complex),
    slice: new HyperplaneSliceN({ normal: [...source.normal], offset })
  });

  // Boundary edges are the ones a single section triangle claims.
  const seen = new Map<string, { a: number; b: number; uses: number }>();
  for (let cell = 0; cell < result.cellCount; cell++) {
    for (let corner = 0; corner < 3; corner++) {
      const a = result.cells[cell * 3 + corner]!;
      const b = result.cells[cell * 3 + ((corner + 1) % 3)]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const entry = seen.get(key);
      if (entry === undefined) seen.set(key, { a, b, uses: 1 });
      else entry.uses += 1;
    }
  }
  const boundary = [...seen.values()].filter((edge) => edge.uses === 1);
  if (boundary.length === 0) {
    return {
      offset, ring: [], sides: 0, shape: 'empty', ringVertices: [], result
    };
  }

  const neighbours = new Map<number, number[]>();
  const link = (from: number, to: number): void => {
    const list = neighbours.get(from);
    if (list === undefined) neighbours.set(from, [to]);
    else list.push(to);
  };
  for (const edge of boundary) { link(edge.a, edge.b); link(edge.b, edge.a); }

  const start = boundary[0]!.a;
  const ringVertices = [start];
  let previous = -1;
  let current = start;
  for (let guard = 0; guard < boundary.length; guard++) {
    const next = (neighbours.get(current) ?? []).find((v) => v !== previous);
    if (next === undefined || next === start) break;
    ringVertices.push(next);
    previous = current;
    current = next;
  }

  const ring = ringVertices.map((vertex) =>
    [result.chartPositions[vertex * 2]!, result.chartPositions[vertex * 2 + 1]!] as const
  );

  // A side ends where the ring turns. Collinear subdivision points do not.
  let sides = 0;
  for (let i = 0; i < ring.length; i++) {
    const before = ring[(i - 1 + ring.length) % ring.length]!;
    const at = ring[i]!;
    const after = ring[(i + 1) % ring.length]!;
    const inbound = [at[0] - before[0], at[1] - before[1]] as const;
    const outbound = [after[0] - at[0], after[1] - at[1]] as const;
    const cross = inbound[0] * outbound[1] - inbound[1] * outbound[0];
    const scale = Math.hypot(...inbound) * Math.hypot(...outbound);
    if (scale > 1e-12 && Math.abs(cross / scale) > 1e-7) sides += 1;
  }

  const shape = sides === 3 ? 'triangle' : sides === 6 ? 'hexagon' : `${sides}-gon`;
  return { offset, ring, sides, shape, ringVertices, result };
}

/** Where one section vertex came from, in the authored cube's own numbering. */
export interface FlatlandProvenance {
  /** Source vertices this point is an affine combination of. */
  readonly sourceVertices: readonly number[];
  /** Their weights, summing to one. */
  readonly weights: readonly number[];
  /** A short human phrasing, e.g. `corner 3` or `62% along edge 3–7`. */
  readonly summary: string;
}

/**
 * Reads one section vertex's ancestry out of the section's own lineage.
 *
 * This is the page's source-identity claim, and it is the library's answer
 * rather than a recomputation: `sectionSimplexGroupN` records every output
 * vertex as an affine combination of the ORIGINAL cube vertices, so a corner
 * of the flat shape can name the cube edge it was cut from.
 *
 * @param outline - The cut to read from.
 * @param ringIndex - Position in {@link FlatlandOutline.ring}.
 * @returns The ancestry, or `undefined` when the index is out of range.
 */
export function outlineProvenance(
  outline: FlatlandOutline,
  ringIndex: number
): FlatlandProvenance | undefined {
  const vertex = outline.ringVertices[ringIndex];
  if (vertex === undefined) return undefined;
  const { offsets, sourceVertices, weights } = outline.result.lineage;
  const from = offsets[vertex]!;
  const to = offsets[vertex + 1]!;
  const parents = Array.from(sourceVertices.slice(from, to));
  const share = Array.from(weights.slice(from, to));

  let summary: string;
  if (parents.length === 1) {
    summary = `corner ${parents[0]}`;
  } else if (parents.length === 2) {
    const percent = Math.round(share[1]! * 100);
    summary = `${percent}% along edge ${parents[0]}–${parents[1]}`;
  } else {
    summary = `mix of ${parents.length} corners`;
  }
  return { sourceVertices: parents, weights: share, summary };
}
