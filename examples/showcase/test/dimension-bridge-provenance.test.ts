import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2, type Intersection } from 'three';
import { describeRepresentationHitN, type RepresentationHitN } from '@holotope/core';
import {
  ProjectedSurface3D,
  SlicedComplex3D,
  representationHitFromProjectedSurface,
  representationHitFromSlicedComplex
} from '@holotope/three';
import {
  compileDimensionBridgeDocument,
  poseForRepresentation,
  type CompiledDimensionBridge
} from '../src/dimension-bridge-document.js';

/**
 * Render products built from the compiled maps, picked, and traced back.
 *
 * The page could satisfy every other test while quietly constructing a second
 * source or a second projection from the same numbers — the pictures would
 * match and the provenance would be a coincidence. The identity assertions
 * here are what make that impossible to do silently: a hit must point at the
 * *same* `CellComplex` object the registry holds, not an equal one.
 */

interface PositionAttribute {
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

/** A ray aimed at the centroid of the first emitted triangle. */
function rayAtFirstTriangle(geometry: {
  getAttribute(name: string): PositionAttribute;
}): Raycaster {
  const position = geometry.getAttribute('position');
  const x = (position.getX(0) + position.getX(1) + position.getX(2)) / 3;
  const y = (position.getY(0) + position.getY(1) + position.getY(2)) / 3;
  const z = (position.getZ(0) + position.getZ(1) + position.getZ(2)) / 3;
  const camera = new PerspectiveCamera(60, 1, 0.01, 1000);
  camera.position.set(x, y, z + 25);
  camera.lookAt(x, y, z);
  camera.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0, 0), camera);
  return raycaster;
}

function sectionProduct(bridge: CompiledDimensionBridge): SlicedComplex3D {
  const map = bridge.section.map;
  if (map.kind !== 'slice4') throw new Error('the section is not a slice');
  // Built from the compiled slice object, not an equivalent constructed here.
  const product = new SlicedComplex3D(bridge.source.complex, map.slice);
  product.update(poseForRepresentation(bridge.compilation, bridge.section));
  product.object.updateMatrixWorld(true);
  return product;
}

function perspectiveProduct(bridge: CompiledDimensionBridge): ProjectedSurface3D {
  const map = bridge.perspective.map;
  if (map.kind !== 'projection') throw new Error('the perspective view is not a projection');
  const product = new ProjectedSurface3D(bridge.source.complex, map.projection);
  product.update(poseForRepresentation(bridge.compilation, bridge.perspective));
  product.object.updateMatrixWorld(true);
  return product;
}

const firstHit = (product: { object: never; geometry: never }): Intersection => {
  const raycaster = rayAtFirstTriangle(product.geometry);
  const hits: Intersection[] = raycaster.intersectObject(product.object, false);
  if (hits.length === 0) throw new Error('the ray met no emitted triangle');
  return hits[0]!;
};

describe('picks on the compiled maps trace to the compiled source', () => {
  it('a section pick names a unique source point', async () => {
    const bridge = await compileDimensionBridgeDocument();
    const section = sectionProduct(bridge);

    const hit: RepresentationHitN = representationHitFromSlicedComplex(
      section,
      firstHit(section as never)
    );
    const report = describeRepresentationHitN(hit);

    expect(report.ambient.claim).toBe('unique');
    expect(report.source.kind).toBe('cell');
    expect(report.lineageKinds).toContain('affine-section');

    section.dispose();
    bridge.compilation.dispose();
  });

  it('a perspective pick keeps its projection-overlap ambiguity', async () => {
    const bridge = await compileDimensionBridgeDocument();
    const surface = perspectiveProduct(bridge);

    const report = describeRepresentationHitN(
      representationHitFromProjectedSurface(surface, firstHit(surface as never))
    );

    // Exact on the triangle the ray met, and still not unique under the map.
    expect(report.ambient.claim).toBe('on-selected-primitive');
    if (report.ambient.claim === 'on-selected-primitive') {
      expect(report.ambient.ambiguity).toBe('projection-overlap');
    }

    surface.dispose();
    bridge.compilation.dispose();
  });

  it('both hits point at the registry complex itself, not an equal one', async () => {
    // This is the assertion that fails if the page ever rebuilds a source or a
    // map: an equal complex would satisfy every geometric check and fail here.
    const bridge = await compileDimensionBridgeDocument();
    const section = sectionProduct(bridge);
    const surface = perspectiveProduct(bridge);

    for (const [name, hit] of [
      ['section', representationHitFromSlicedComplex(section, firstHit(section as never))],
      [
        'perspective',
        representationHitFromProjectedSurface(surface, firstHit(surface as never))
      ]
    ] as const) {
      expect(hit.source.kind, name).toBe('cell');
      if (hit.source.kind !== 'cell') continue;
      expect(hit.source.complex, name).toBe(bridge.source.complex);
      expect(hit.source.cellIndex, name).toBeGreaterThanOrEqual(0);
    }

    section.dispose();
    surface.dispose();
    bridge.compilation.dispose();
  });

  it('the section follows the parameter, so a later cut differs', async () => {
    const bridge = await compileDimensionBridgeDocument();

    const centroidOf = (product: SlicedComplex3D): [number, number, number] => {
      const position = product.geometry.getAttribute('position') as unknown as PositionAttribute;
      return [
        (position.getX(0) + position.getX(1) + position.getX(2)) / 3,
        (position.getY(0) + position.getY(1) + position.getY(2)) / 3,
        (position.getZ(0) + position.getZ(1) + position.getZ(2)) / 3
      ];
    };

    const before = sectionProduct(bridge);
    expect(before.triangleCount).toBeGreaterThan(0);
    const beforeCentroid = centroidOf(before);
    before.dispose();

    const applied = bridge.compilation.setParameter('sliceOffset', -0.2);
    expect(applied.outcome).toBe('applied');

    const after = sectionProduct(bridge);
    expect(after.triangleCount).toBeGreaterThan(0);
    const afterCentroid = centroidOf(after);

    // A different cut of the same body: the emitted geometry moved.
    const displacement = Math.hypot(
      ...afterCentroid.map((value, index) => value - beforeCentroid[index]!)
    );
    expect(displacement).toBeGreaterThan(1e-6);
    after.dispose();

    // Past the body's w half-extent of 0.43 the cut is empty, which the
    // slider's range admits and the page renders as nothing rather than an
    // error.
    expect(bridge.compilation.setParameter('sliceOffset', 1.4).outcome).toBe('applied');
    const beyond = sectionProduct(bridge);
    expect(beyond.triangleCount).toBe(0);
    beyond.dispose();

    bridge.compilation.dispose();
  });
});
