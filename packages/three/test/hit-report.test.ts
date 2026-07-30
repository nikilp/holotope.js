import { describe, expect, it } from 'vitest';
import { Raycaster, Vector2, PerspectiveCamera, type Intersection, type Object3D } from 'three';
import {
  HyperplaneSlice4,
  PerspectiveProjection,
  TransformN,
  createHypercube,
  describeRepresentationHitN,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  ProjectedSurface3D,
  SlicedComplex3D,
  representationHitFromProjectedSurface,
  representationHitFromSlicedComplex
} from '@holotope/three';

/**
 * The report exists to stop one specific mistake.
 *
 * A projected pick reports `ambientPointStatus: 'exact'` while `ambiguity` is
 * `'projection-overlap'`: the lift is exact on the triangle the ray met, and
 * the projection as a whole is many-to-one. A caller reading precision alone
 * presents a conditional lift as the source point. These tests pin that the
 * report separates the two cases even though the underlying status is the same
 * string in both.
 */
function scene(): {
  surface: ProjectedSurface3D;
  section: SlicedComplex3D;
  raycaster: Raycaster;
} {
  const complex = tetrahedralizeCuboidCells(createHypercube({ dim: 4, size: 2 }));
  const pose = TransformN.identity(4);
  const surface = new ProjectedSurface3D(
    complex,
    new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
  );
  const section = new SlicedComplex3D(
    complex,
    new HyperplaneSlice4({ normal: [0, 0, 0, 1], offset: 0 })
  );
  surface.update(pose);
  section.update(pose);

  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 8);
  camera.lookAt(0, 0, 0);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0, 0), camera);
  return { surface, section, raycaster };
}

describe('describeRepresentationHitN', () => {
  it('refuses a unique claim for a projected pick that reports exact', () => {
    const { surface, raycaster } = scene();
    const hits: Intersection<Object3D>[] = raycaster.intersectObject(
      surface.object,
      false
    );
    expect(hits.length).toBeGreaterThan(0);

    const hit = representationHitFromProjectedSurface(surface, hits[0]!);
    // The trap, present in the raw hit.
    expect(hit.ambientPointStatus).toBe('exact');
    expect(hit.ambiguity).toBe('projection-overlap');

    const report = describeRepresentationHitN(hit);
    expect(report.ambient.claim).toBe('on-selected-primitive');
    if (report.ambient.claim === 'on-selected-primitive') {
      // The point is still available, but only through a branch that says so.
      expect(report.ambient.ambiguity).toBe('projection-overlap');
      expect(report.ambient.point.dim).toBe(4);
    }
    // Identity survives regardless.
    expect(report.source.kind).toBe('cell');
    surface.dispose();
  });

  it('licenses a unique claim for an unambiguous section pick', () => {
    const { section, raycaster } = scene();
    const hits: Intersection<Object3D>[] = raycaster.intersectObject(
      section.object,
      false
    );
    expect(hits.length).toBeGreaterThan(0);

    const hit = representationHitFromSlicedComplex(section, hits[0]!);
    expect(hit.ambiguity).toBe('none');

    const report = describeRepresentationHitN(hit);
    expect(report.ambient.claim).toBe('unique');
    if (report.ambient.claim === 'unique') {
      // An exact section point lies on the cutting hyperplane.
      expect(report.ambient.point.data[3]).toBeCloseTo(0, 12);
    }
    section.dispose();
  });

  it('reports the lineage that makes the claim explicable', () => {
    const { surface, section, raycaster } = scene();
    const projected = describeRepresentationHitN(
      representationHitFromProjectedSurface(
        surface,
        raycaster.intersectObject(surface.object, false)[0]!
      )
    );
    const sectioned = describeRepresentationHitN(
      representationHitFromSlicedComplex(
        section,
        raycaster.intersectObject(section.object, false)[0]!
      )
    );
    expect(projected.lineageKinds.length).toBeGreaterThan(0);
    expect(sectioned.lineageKinds).toContain('affine-section');
    expect(projected.lineageKinds).not.toEqual(sectioned.lineageKinds);
    surface.dispose();
    section.dispose();
  });
});
