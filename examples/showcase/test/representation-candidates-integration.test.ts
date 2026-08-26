import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import {
  CellComplex, CoordinateProjection, HyperplaneSliceN,
  groupRepresentationCandidatesN, type RepresentationHitN
} from '@holotope/core';
import {
  ProjectedSurface3D, SectionChart3D,
  representationHitFromProjectedSurface, representationHitFromSectionChart,
  type RepresentationIntersection3D
} from '@holotope/three';

/**
 * Candidate grouping driven end to end: real Raycaster intersections, each one
 * adapted by the released adapter for the product it came from, then grouped.
 *
 * Nothing here writes an ambiguity, a source identity or a candidate count into
 * an input. `intersections[0]` is never taken before adapting — that is the
 * habit the grouping exists to replace.
 */

const dropW = (): CoordinateProjection =>
  new CoordinateProjection({ fromDim: 4, axes: [0, 1, 2] });

/** One triangle in the z = 0 plane at hidden coordinate `w`. */
const flatTriangle = (w: number): number[][] => [
  [-1, -1, 0, w], [1, -1, 0, w], [0, 1, 0, w]
];

/** A complex of independent triangles; no vertex is shared between cells. */
function trianglesComplex(triangles: readonly (readonly number[][])[]): CellComplex {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const triangle of triangles) {
    for (const vertex of triangle) {
      indices.push(positions.length / 4);
      positions.push(vertex[0]!, vertex[1]!, vertex[2]!, vertex[3]!);
    }
  }
  return new CellComplex(4, Float64Array.from(positions), [
    { key: 'faces', dim: 2, verticesPerCell: 3, kind: 'simplex',
      indices: Uint32Array.from(indices) }
  ]);
}

function castAt(objects: readonly import('three').Object3D[], x: number, y: number) {
  const camera = new PerspectiveCamera(60, 1, 0.01, 100);
  camera.position.set(x, y, 6);
  camera.lookAt(new Vector3(x, y, 0));
  camera.updateMatrixWorld(true);
  for (const object of objects) object.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0, 0), camera);
  return raycaster.intersectObjects([...objects], true);
}

describe('grouping candidates from real renderer evidence', () => {
  it('keeps two sources whose structural ids collide but whose w differs', () => {
    // Two separately authored complexes, identical in structure. Their
    // SourceCellIdN values are byte-identical; only object identity separates
    // them, and their hidden coordinates differ.
    const near = trianglesComplex([flatTriangle(-1.5)]);
    const far = trianglesComplex([flatTriangle(2.25)]);
    const products = [
      new ProjectedSurface3D(near, dropW()),
      new ProjectedSurface3D(far, dropW())
    ];
    for (const product of products) product.update();

    const intersections = castAt(products.map((p) => p.object), 0, 0);
    expect(intersections.length).toBe(2);

    // Every intersection is adapted; none is discarded first.
    const hits: RepresentationHitN[] = intersections.flatMap((intersection) => {
      const product = products.find((p) => p.object === intersection.object);
      if (!product || intersection.faceIndex === undefined ||
          intersection.faceIndex === null) return [];
      const input: RepresentationIntersection3D = {
        point: intersection.point, faceIndex: intersection.faceIndex
      };
      return [representationHitFromProjectedSurface(product, input)];
    });
    expect(hits).toHaveLength(2);

    const idA = hits[0]!.source.kind === 'cell' ? JSON.stringify(hits[0]!.source.id) : 'a';
    const idB = hits[1]!.source.kind === 'cell' ? JSON.stringify(hits[1]!.source.id) : 'b';
    expect(idA).toBe(idB);

    const grouped = groupRepresentationCandidatesN(hits);
    expect(grouped.targetMultiplicity).toBe('multiple');
    expect(grouped.candidateCount).toBe(2);
    expect(grouped.hitCount).toBe(2);
    // Distinct hidden coordinates survive into distinct candidates.
    const hidden = grouped.candidates.map((candidate) =>
      candidate.hits[0]!.ambientPoint?.toArray()[3]);
    expect(new Set(hidden).size).toBe(2);
    // And the point-level reading is untouched and separate.
    expect(new Set(hits.map((h) => h.ambiguity))).toEqual(new Set(['projection-overlap']));

    for (const product of products) product.dispose();
  });

  it('collapses two hits on one live source cell into one candidate', () => {
    // A single triangle, hit from both sides: the product's default material is
    // double-sided, so the front and back faces of one cell both intersect.
    const complex = trianglesComplex([flatTriangle(0)]);
    const surface = new ProjectedSurface3D(complex, dropW());
    surface.update();
    const intersections = castAt([surface.object], 0, 0);
    const hits = intersections.flatMap((intersection) => {
      if (intersection.faceIndex === undefined || intersection.faceIndex === null) return [];
      return [representationHitFromProjectedSurface(surface, {
        point: intersection.point, faceIndex: intersection.faceIndex
      })];
    });
    // Repeat the same observation to give the grouping two hits on one cell,
    // the way a caller raycasting two products over one source would.
    const doubled = [...hits, ...hits];
    const grouped = groupRepresentationCandidatesN(doubled);
    expect(grouped.targetMultiplicity).toBe('unique');
    if (grouped.targetMultiplicity !== 'unique') return;
    expect(grouped.candidateCount).toBe(1);
    expect(grouped.hitCount).toBe(doubled.length);
    expect(grouped.candidate.hitCount).toBe(doubled.length);
    surface.dispose();
  });

  it('reports unique through a lossy projection when only one source is there', () => {
    // Point ambiguity says `projection-overlap`; the target is still unique.
    const complex = trianglesComplex([flatTriangle(0)]);
    const surface = new ProjectedSurface3D(complex, dropW());
    surface.update();
    const hits = castAt([surface.object], 0, 0).flatMap((intersection) =>
      intersection.faceIndex === undefined || intersection.faceIndex === null ? []
        : [representationHitFromProjectedSurface(surface, {
          point: intersection.point, faceIndex: intersection.faceIndex })]);
    const grouped = groupRepresentationCandidatesN(hits);
    expect(hits[0]!.ambiguity).toBe('projection-overlap');
    expect(grouped.targetMultiplicity).toBe('unique');
    surface.dispose();
  });

  it('reports multiple through an injective section when two sources coincide', () => {
    // Point ambiguity says `none` — truthfully — and two source cells are still
    // candidates. This is the combination that costs a caller something.
    const model = [[-1, -1, -1, -1], [1, -1, -1, -1], [0, 1, -1, -1], [0, 0, 1, 1]];
    const positions: number[] = [];
    const indices: number[] = [];
    for (let copy = 0; copy < 2; copy += 1) {
      for (const vertex of model) {
        indices.push(positions.length / 4);
        positions.push(vertex[0]!, vertex[1]!, vertex[2]!, vertex[3]!);
      }
    }
    const complex = new CellComplex(4, Float64Array.from(positions), [
      { key: 'solids', dim: 3, verticesPerCell: 4, kind: 'simplex',
        indices: Uint32Array.from(indices) }
    ]);
    const group = complex.groups[0]!;
    const chart = new SectionChart3D(complex, group, HyperplaneSliceN.axisAligned(4, 3, 0));
    chart.update();
    const hits = castAt([chart.object], 0, 0).flatMap((intersection) =>
      intersection.faceIndex === undefined || intersection.faceIndex === null ? []
        : [representationHitFromSectionChart(chart, {
          point: intersection.point, faceIndex: intersection.faceIndex })]);
    expect(new Set(hits.map((h) => h.ambiguity))).toEqual(new Set(['none']));
    const grouped = groupRepresentationCandidatesN(hits);
    expect(grouped.targetMultiplicity).toBe('multiple');
    expect(grouped.candidateCount).toBe(2);
    chart.dispose();
  });

  it('control: a manufactured faceIndex changes the selected source', () => {
    const complex = trianglesComplex([flatTriangle(-1.5), flatTriangle(2.25)]);
    const surface = new ProjectedSurface3D(complex, dropW());
    surface.update();
    const intersections = castAt([surface.object], 0, 0);
    const real = intersections[0]!;
    const realHit = representationHitFromProjectedSurface(surface, {
      point: real.point, faceIndex: real.faceIndex!
    });
    const fakeHit = representationHitFromProjectedSurface(surface, {
      point: real.point, faceIndex: 1 - real.faceIndex!
    });
    const cellOf = (hit: RepresentationHitN): number =>
      hit.source.kind === 'cell' ? hit.source.reference.cellIndex : -1;
    expect(cellOf(fakeHit)).not.toBe(cellOf(realHit));
    // Grouping follows the evidence it is handed: real and manufactured
    // resolve to different candidates.
    expect(groupRepresentationCandidatesN([realHit, fakeHit]).candidateCount).toBe(2);
    expect(groupRepresentationCandidatesN([realHit, realHit]).candidateCount).toBe(1);
    surface.dispose();
  });

  it('reports none when the ray misses everything', () => {
    const complex = trianglesComplex([flatTriangle(0)]);
    const surface = new ProjectedSurface3D(complex, dropW());
    surface.update();
    const intersections = castAt([surface.object], 9, 9);
    expect(intersections).toHaveLength(0);
    expect(groupRepresentationCandidatesN([]).targetMultiplicity).toBe('none');
    surface.dispose();
  });
});

describe('the example decides all-or-nothing, and chooses none when contested', () => {
  /** Real intersections, each adapted, exactly as the page does it. */
  function adaptAll(surface: ProjectedSurface3D, x: number, y: number) {
    const intersections = castAt([surface.object], x, y);
    const adapted: RepresentationHitN[] = [];
    let refusal = '';
    for (const intersection of intersections) {
      try {
        if (intersection.faceIndex === undefined || intersection.faceIndex === null) {
          throw new Error('rendered surface did not report a triangle index');
        }
        adapted.push(representationHitFromProjectedSurface(surface, {
          point: intersection.point, faceIndex: intersection.faceIndex
        }));
      } catch (error) {
        refusal = String(error instanceof Error ? error.message : error);
        break;
      }
    }
    return { intersections, adapted, refusal };
  }

  it('names and highlights a unique target', async () => {
    const { presentObservation } = await import('../src/provenance-observation.js');
    const surface = new ProjectedSurface3D(
      trianglesComplex([flatTriangle(0)]), dropW());
    surface.update();
    const { intersections, adapted, refusal } = adaptAll(surface, 0, 0);
    const presented = presentObservation(adapted, intersections.length, refusal);
    expect(presented.outcome).toBe('unique');
    expect(presented.highlightHit).not.toBeNull();
    surface.dispose();
  });

  it('FALSIFIER: a partial adaptation grouped nothing and highlighted nothing', () => {
    // One real intersection adapts; the next refuses. The successfully adapted
    // subset must not become a target.
    const surface = new ProjectedSurface3D(
      trianglesComplex([flatTriangle(-1.5), flatTriangle(2.25)]), dropW());
    surface.update();
    const intersections = castAt([surface.object], 0, 0);
    expect(intersections.length).toBe(2);
    const first = representationHitFromProjectedSurface(surface, {
      point: intersections[0]!.point, faceIndex: intersections[0]!.faceIndex!
    });
    return import('../src/provenance-observation.js').then(({ presentObservation }) => {
      const presented = presentObservation([first], intersections.length,
        'ProjectedSurface3D: faceIndex 999 out of range');
      expect(presented.outcome).toBe('incomplete');
      expect(presented.highlightHit).toBeNull();
      // The refusal is surfaced rather than swallowed.
      expect(presented.rows.some(([label]) => label === 'refused')).toBe(true);
      // And no target is named at all.
      expect(presented.rows.some(([label]) => label === 'target')).toBe(false);
      surface.dispose();
    });
  });

  it('FALSIFIER: multiple candidates leave nothing highlighted', async () => {
    const { presentObservation } = await import('../src/provenance-observation.js');
    const surface = new ProjectedSurface3D(
      trianglesComplex([flatTriangle(-1.5), flatTriangle(2.25)]), dropW());
    surface.update();
    const { intersections, adapted, refusal } = adaptAll(surface, 0, 0);
    expect(adapted).toHaveLength(2);
    const presented = presentObservation(adapted, intersections.length, refusal);
    expect(presented.outcome).toBe('multiple');
    expect(presented.highlightHit).toBeNull();
    // Every candidate is listed with an encounter-local label, and the page
    // states that it selected none.
    const labels = presented.rows.filter(([label]) => label.startsWith('candidate #'));
    expect(labels).toHaveLength(2);
    expect(presented.rows.some(([label, value]) =>
      label === 'choice' && value.includes('selects none'))).toBe(true);
    // Point ambiguity is reported separately from target multiplicity.
    expect(presented.rows.some(([label]) => label === 'point ambiguity')).toBe(true);
    surface.dispose();
  });

  it('surfaces a fail-closed refusal instead of naming a target', async () => {
    const { presentObservation } = await import('../src/provenance-observation.js');
    const alien = { source: { kind: 'not-a-real-kind' } } as unknown as RepresentationHitN;
    const presented = presentObservation([alien], 1);
    expect(presented.outcome).toBe('refused');
    expect(presented.highlightHit).toBeNull();
    expect(presented.rows.some(([, value]) => value.includes('unsupported source kind')))
      .toBe(true);
  });
});
