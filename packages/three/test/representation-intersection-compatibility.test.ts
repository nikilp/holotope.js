import { describe, expect, it } from 'vitest';
import { Raycaster, Vector2, Vector3, PerspectiveCamera, type Intersection, type Object3D } from 'three';
import {
  HyperplaneSlice4,
  PerspectiveProjection,
  TransformN,
  createHypercube,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  ProjectedSurface3D,
  SlicedComplex3D,
  representationHitFromProjectedSurface,
  representationHitFromSlicedComplex,
  type RepresentationIntersection3D
} from '@holotope/three';

/**
 * A Three `Intersection` must be usable as a `RepresentationIntersection3D`
 * without a hand-written converter.
 *
 * Three declares `faceIndex?: number`, and this repository compiles with
 * `exactOptionalPropertyTypes`, under which an optional property that omits
 * `| undefined` does not accept a present-`undefined` value. Callers used to
 * rebuild the literal to get past it. These are compile-time assertions first:
 * the file failing to typecheck is the real failure signal.
 */
describe('RepresentationIntersection3D accepts a Three intersection', () => {
  it('is structurally assignable from Intersection<Object3D>', () => {
    const intersection = {
      distance: 1,
      point: new Vector3(0, 0, 0),
      object: undefined as unknown as Object3D,
      faceIndex: undefined,
      index: undefined
    } as Intersection<Object3D>;

    const adapted: RepresentationIntersection3D = intersection;
    expect(adapted.point).toBeInstanceOf(Vector3);
  });

  it('passes a real raycast intersection straight to both adapters', () => {
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

    const surfaceHits: Intersection<Object3D>[] = raycaster.intersectObject(
      surface.object,
      false
    );
    const sectionHits: Intersection<Object3D>[] = raycaster.intersectObject(
      section.object,
      false
    );

    expect(surfaceHits.length).toBeGreaterThan(0);
    expect(sectionHits.length).toBeGreaterThan(0);

    // No literal is rebuilt here; that is the point of the test.
    const surfaceHit = representationHitFromProjectedSurface(surface, surfaceHits[0]!);
    const sectionHit = representationHitFromSlicedComplex(section, sectionHits[0]!);

    expect(surfaceHit.source.kind).toBe('cell');
    expect(sectionHit.source.kind).toBe('cell');

    // The three axes stay independent, which is what the concise rule now says.
    expect(surfaceHit.ambiguity).toBe('projection-overlap');
    expect(sectionHit.ambiguity).toBe('none');

    surface.dispose();
    section.dispose();
  });
});
