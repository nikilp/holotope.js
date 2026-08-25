import type { CellComplex, CellGroup, HyperplaneSliceN, TransformN } from '@holotope/core';
import {
  type BallSection4,
  type ComplexSectionSource4,
  type EmptySection4,
  type GlomeSectionSource4,
  type HyperboxSectionSource4,
  type PolyhedralSection4,
  type Section4,
  type Section4Options,
  type SectionProvenance4,
  type SectionSource4,
  type TangentSection4,
  sectionOfSource4
} from '@holotope/physics';
import { SectionChart3D } from '@holotope/three';

/**
 * The consumer half of an exact R4 → R3 section: geometry and provenance, and
 * deliberately nothing else.
 *
 * `@holotope/three` depends on `@holotope/core` and not on `@holotope/physics`,
 * so the two halves meet here rather than inside either package. Nothing in
 * this module chooses a material, a light, a camera, a control scheme or a
 * layout — those are the caller's, and a caller that wants a different look
 * changes none of this.
 *
 * The one thing a renderer cannot work out for itself is *where the authored
 * source sits* once a body is carrying it, and that is exactly what a section's
 * `provenance.worldFromSource` is: the authored axes reconciled against the
 * body's principal frame, composed with the body's pose, as a single map.
 */

/**
 * A surface to draw, with the render product that holds its buffers.
 *
 * The primitive count is deliberately not copied out: it lives on
 * `chart.section`, and a second copy could only ever disagree with it.
 */
export interface SurfaceDisplay3 {
  readonly kind: 'surface';
  /** The updated product. Its geometry, materials and disposal stay the caller's. */
  readonly chart: SectionChart3D;
  /** The source, pose and hyperplane this surface was derived from. */
  readonly provenance: SectionProvenance4;
}

/** A ball to draw, as a centre and a radius in the hyperplane's own chart. */
export interface BallDisplay3 {
  readonly kind: 'ball';
  readonly center: readonly [number, number, number];
  readonly radius: number;
  readonly provenance: SectionProvenance4;
}

/** A contact with no volume: points to mark, but no solid. */
export interface PointsDisplay3 {
  readonly kind: 'points';
  readonly points: Float64Array;
  readonly provenance: SectionProvenance4;
}

/** Nothing to draw at this pose. */
export interface AbsentDisplay3 {
  readonly kind: 'absent';
  readonly provenance: SectionProvenance4;
}

/** Everything a renderer can be handed for one section. */
export type SectionDisplay3 =
  | SurfaceDisplay3
  | BallDisplay3
  | PointsDisplay3
  | AbsentDisplay3;

/** Reads a ball section into the two numbers a sphere needs. */
export function ballDisplay(section: BallSection4): BallDisplay3 {
  const [x, y, z] = section.chartCenter;
  return {
    kind: 'ball',
    center: [x ?? 0, y ?? 0, z ?? 0],
    radius: section.radius,
    provenance: section.provenance
  };
}

/** Reads a tangent section into the points it touched. */
export function pointsDisplay(section: TangentSection4): PointsDisplay3 {
  return { kind: 'points', points: section.chartPositions, provenance: section.provenance };
}

/** Reads an empty section into the absence it reports. */
export function absentDisplay(section: EmptySection4): AbsentDisplay3 {
  return { kind: 'absent', provenance: section.provenance };
}

/**
 * Drives an existing {@link SectionChart3D} from a polyhedral section.
 *
 * The chart re-sections the authored complex under the supplied map, so the
 * product's own buffers stay the single copy of the drawn geometry — this
 * never hands it a second, divergent set of positions.
 */
export function surfaceDisplay(
  chart: SectionChart3D,
  section: PolyhedralSection4
): SurfaceDisplay3 {
  chart.update(section.provenance.worldFromSource);
  return { kind: 'surface', chart, provenance: section.provenance };
}

/**
 * Sections a source at a pose and returns what a renderer should draw.
 *
 * Pass the chart a polyhedral source should drive; omit it for a glome, which
 * has no complex to section and needs none.
 */
export function displaySection(
  source: SectionSource4,
  options: Section4Options,
  chart?: SectionChart3D
): SectionDisplay3 {
  const section: Section4 = sectionOfSource4(source, options);
  switch (section.status) {
    case 'ball':
      return ballDisplay(section);
    case 'tangent':
      return pointsDisplay(section);
    case 'empty':
      return absentDisplay(section);
    case 'polyhedral': {
      if (!chart) {
        throw new Error(
          'displaySection: a polyhedral source needs the SectionChart3D that draws it'
        );
      }
      return surfaceDisplay(chart, section);
    }
  }
}

/** The chart a complex source needs, built from that source's own cells. */
export function chartForComplexSource(
  source: ComplexSectionSource4,
  slice: HyperplaneSliceN
): SectionChart3D {
  const group = tetrahedralGroupOf(source.complex, source.groupKey);
  return new SectionChart3D(source.complex, group, slice);
}

/** The chart an analytic box source needs, over a complex of that box. */
export function chartForBoxSource(
  boxComplex: CellComplex,
  source: HyperboxSectionSource4,
  slice: HyperplaneSliceN
): SectionChart3D {
  if (boxComplex.vertexCount !== 16) {
    throw new Error(
      `chartForBoxSource: expected the 16 corners of a 4-box, got ${boxComplex.vertexCount}`
    );
  }
  if (source.halfExtents.length !== 4) {
    throw new Error('chartForBoxSource: a hyperbox source has four half-extents');
  }
  // `worldFromSource` maps *authored* coordinates, so the complex has to be the
  // authored box and not the sorted one a collider would want. Passing the
  // sorted box renders a plausible, wrong solid, so it is refused rather than
  // drawn: compare the complex's own extents against the authored ones.
  for (let axis = 0; axis < 4; axis += 1) {
    let extent = 0;
    for (let vertex = 0; vertex < boxComplex.vertexCount; vertex += 1) {
      extent = Math.max(extent, Math.abs(boxComplex.positions[vertex * 4 + axis]!));
    }
    const authored = source.halfExtents[axis]!;
    if (Math.abs(extent - authored) > 1e-9 * Math.max(1, authored)) {
      throw new Error(
        `chartForBoxSource: complex half-extent ${axis} is ${extent}, but the source ` +
        `authored ${authored} — the chart must be built over the authored box`
      );
    }
  }
  return new SectionChart3D(boxComplex, tetrahedralGroupOf(boxComplex, undefined), slice);
}

/** A glome needs no chart at all: name that rather than leaving it implicit. */
export function chartForGlomeSource(_source: GlomeSectionSource4): undefined {
  return undefined;
}

/** The map the renderer was driven with, for a caller that wants to reuse it. */
export function worldFromSourceOf(section: Section4): TransformN {
  return section.provenance.worldFromSource;
}

function tetrahedralGroupOf(complex: CellComplex, groupKey: string | undefined): CellGroup {
  const candidates = complex.groups.filter(
    (group) => group.dim === 3 && group.verticesPerCell === 4
  );
  const chosen = groupKey === undefined
    ? candidates[0]
    : candidates.find((group) => group.key === groupKey);
  if (!chosen) {
    throw new Error(
      groupKey === undefined
        ? 'section4-bridge: complex has no tetrahedral 3-cell group'
        : `section4-bridge: no tetrahedral 3-group with key ${JSON.stringify(groupKey)}`
    );
  }
  return chosen;
}
