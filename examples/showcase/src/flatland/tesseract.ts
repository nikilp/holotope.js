import {
  CellComplex,
  HyperplaneSliceN,
  PerspectiveProjection,
  Rotor4,
  createHypercube,
  sectionSimplexGroupN,
  simplexizeCuboidGroupN,
  type CellGroup,
  type SectionSimplexGroupNResultN
} from '@holotope/core';

/**
 * Scene 6 — "Up a rung".
 *
 * The same two maps as scenes 3 and 4, one dimension higher. A tesseract is the
 * authoritative source; the page shows a 3D perspective **projection** of it and
 * an exact 3D **section** through it, and neither is the object.
 *
 * ## What was recovered, and what was deliberately not
 *
 * The Hypersection Ladder was audited before anything was taken from it. Its own
 * note is accurate and worth quoting: *"why only rung 3 uses Holotope:
 * `HyperplaneSlice4`, `sliceTetrahedra` and `SlicedComplex3D` all fix N = 4"* —
 * and `ladder.ts` *"owns the hand-rolled section maths"* for the rungs below.
 *
 * So exactly one part of it is genuinely recoverable: the 4D pipeline
 * `HyperplaneSlice4.axisAligned → SlicedComplex3D` with a `PerspectiveProjection`
 * beside it. That is the same pipeline the showcase's own `tesseract.ts` has run
 * since long before, tested in this package, without kitchen chrome — so it is
 * the better source for the same machinery, and it is what this scene follows.
 *
 * **The hand-rolled low-rung slicing is not copied here**, and could not be:
 * this scene sections in R4, where the library's own maps apply.
 *
 * One correction to that Ladder note, for whoever reads it next. It is right
 * that `SlicedComplex3D` and `HyperplaneSlice4` fix N = 4 — they are the 4D→3D
 * adapter. It does **not** follow that no dimension-generic section exists.
 * `sectionSimplexGroupN` takes any simplicial group in any ambient dimension,
 * which is exactly what scene 3 uses to cut a cube in R3. This scene uses it too,
 * so all three scenes share one section vocabulary and one provenance story
 * rather than three pipelines that have to be kept in agreement.
 */

/** Half-extent of the authored tesseract. */
export const TESSERACT_HALF_EXTENT = 1;

/** Where the w-section of a tesseract stops existing. */
export const W_REACH = TESSERACT_HALF_EXTENT;

/** The authored 4D source and the pieces every view derives from. */
export interface TesseractSource {
  /** The authoritative R4 complex. Never shown directly; it cannot be. */
  readonly complex: CellComplex;
  /** Its 4-cell simplexization, which the section cuts. */
  readonly simplices: CellGroup;
  /** Undeformed vertex positions, so rotation never accumulates drift. */
  readonly restPositions: Float64Array;
}

/**
 * Builds the tesseract and the simplices its section is taken from.
 *
 * The 4-cell branch of `simplexizeCuboidGroupN` is used, which CORE-HC2-R0
 * measured tiling exactly with no gap and no overlap. The 2-cell group — wound
 * cyclically for the renderer — is not involved.
 */
export function buildTesseractSource(): TesseractSource {
  const complex = createHypercube({
    dim: 4,
    size: 2 * TESSERACT_HALF_EXTENT,
    maxCellDimension: 4
  });
  const cell = complex.cellsOfDim(4).find((group) => group.kind === 'cuboid');
  if (cell === undefined) {
    throw new Error('buildTesseractSource: the tesseract has no cuboid 4-cell');
  }
  const simplices = simplexizeCuboidGroupN(cell).simplexGroup;
  complex.addGroup(simplices);
  return {
    complex,
    simplices,
    restPositions: Float64Array.from(complex.positions)
  };
}

/**
 * Turns the source through a plane the camera cannot reach.
 *
 * Applied to the AUTHORED positions every time rather than composed onto the
 * live ones, so holding a rotation and sweeping w cannot drift.
 *
 * @param source - The tesseract to turn.
 * @param xw - Angle in the x–w plane, in radians.
 * @param yw - Angle in the y–w plane, in radians.
 */
export function rotateHiddenPlanes(
  source: TesseractSource,
  xw: number,
  yw: number
): void {
  const rotor = Rotor4.fromPlanes([
    { i: 0, j: 3, angle: xw },
    { i: 1, j: 3, angle: yw }
  ]);
  // `applyToPositions(src, dst, count)` — reading from the authored positions
  // and writing to the live ones in one pass, so a held rotation swept across w
  // never composes onto itself. An earlier version passed the stride where the
  // destination belongs and silently rotated nothing; the test below caught it.
  rotor.applyToPositions(
    source.restPositions,
    source.complex.positions,
    source.complex.vertexCount
  );
}

/** One exact 3D section of the source, in the slice's own 3D chart. */
export interface TesseractSection {
  readonly offset: number;
  readonly result: SectionSimplexGroupNResultN;
  /** Section cells: tetrahedra in the 3D chart. */
  readonly cellCount: number;
  /** Distinct chart vertices after welding. */
  readonly vertexCount: number;
}

/**
 * Cuts the source at one position along the hidden axis.
 *
 * @param source - The tesseract to cut.
 * @param offset - Position along w.
 * @returns The section, in the chart the slice defines.
 *
 * @example
 * ```ts
 * const source = buildTesseractSource();
 * sectionAtW(source, 0).cellCount;      // a solid section
 * sectionAtW(source, 1.4).cellCount;    // 0 — the plane has left the source
 * ```
 */
export function sectionAtW(
  source: TesseractSource,
  offset: number
): TesseractSection {
  const result = sectionSimplexGroupN({
    complex: source.complex,
    group: source.simplices,
    slice: new HyperplaneSliceN({ normal: [0, 0, 0, 1], offset })
  });
  return {
    offset,
    result,
    cellCount: result.cellCount,
    vertexCount: result.vertexCount
  };
}

/**
 * The extent of a section along each chart axis.
 *
 * The number the scene reads to say the w = 0 section is a cube: three equal
 * spans. It is measured from the section, not asserted about it.
 */
export function sectionSpan(section: TesseractSection): [number, number, number] {
  const chart = section.result.chartPositions;
  if (section.vertexCount === 0) return [0, 0, 0];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  // Only vertices some cell names: a welded orphan belongs to nothing.
  const used = new Set<number>(Array.from(section.result.cells));
  for (const vertex of used) {
    for (let axis = 0; axis < 3; axis++) {
      const value = chart[vertex * 3 + axis]!;
      lo[axis] = Math.min(lo[axis]!, value);
      hi[axis] = Math.max(hi[axis]!, value);
    }
  }
  return [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!];
}

/** The 4D→3D perspective the projection view uses. */
export function tesseractProjection(): PerspectiveProjection {
  return new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
}

/**
 * Projected positions of every source vertex, for the projection view.
 *
 * Many-to-one in principle and visibly so here: the near and far cells of a
 * tesseract land inside one another, which is the same overlap scene 4 made in
 * one dimension less.
 */
export function projectedPoints(source: TesseractSource): [number, number, number][] {
  const projection = tesseractProjection();
  const out: [number, number, number][] = [];
  for (let vertex = 0; vertex < source.complex.vertexCount; vertex++) {
    const at = vertex * 4;
    out.push(projection.projectPoint([
      source.complex.positions[at]!,
      source.complex.positions[at + 1]!,
      source.complex.positions[at + 2]!,
      source.complex.positions[at + 3]!
    ]));
  }
  return out;
}

/** The source's 1-skeleton, as vertex-index pairs. */
export function sourceEdges(source: TesseractSource): [number, number][] {
  const group = source.complex.cellsOfDim(1)[0];
  if (group === undefined) throw new Error('sourceEdges: no 1-cells');
  const edges: [number, number][] = [];
  for (let i = 0; i < group.indices.length; i += 2) {
    edges.push([group.indices[i]!, group.indices[i + 1]!]);
  }
  return edges;
}
