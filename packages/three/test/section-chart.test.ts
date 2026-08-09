import { Box3, Raycaster, Vector3, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  HyperplaneSliceN,
  TransformN,
  VecN,
  sectionSimplexGroupN,
  HyperplaneSlice4,
  type CellGroup
} from '@holotope/core';
import {
  SectionChart3D,
  SlicedComplex3D,
  representationHitFromSectionChart
} from '../src/index.js';

/**
 * The RN section render adapter, held to the P55 conformance matrix.
 *
 * Liveness before agreement throughout: every differential first proves live
 * emitted primitives, because an empty section agrees with everything.
 */

function tetraComplex(): { complex: CellComplex; group: CellGroup } {
  const complex = new CellComplex(4, Float64Array.from([
    0, 0, 0, -1,
    2, 0, 0, 1,
    0, 2, 0, 1,
    0, 0, 2, 1
  ]), [{
    key: 'solid', dim: 3, verticesPerCell: 4, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 3])
  }]);
  return { complex, group: complex.groups[0]! };
}

function triangleComplexR3(): { complex: CellComplex; group: CellGroup } {
  const complex = new CellComplex(3, Float64Array.from([
    0, 0, -1,
    2, 0, 1,
    0, 2, 1
  ]), [{
    key: 'sheet', dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2])
  }]);
  return { complex, group: complex.groups[0]! };
}

function edgeComplexR2(): { complex: CellComplex; group: CellGroup } {
  const complex = new CellComplex(2, Float64Array.from([
    0.5, -1,
    0.5, 1
  ]), [{
    key: 'wire', dim: 1, verticesPerCell: 2, kind: 'simplex',
    indices: Uint32Array.from([0, 1])
  }]);
  return { complex, group: complex.groups[0]! };
}

describe('SectionChart3D: buffers agree with the section it renders', () => {
  it('writes exactly the core chart coordinates in R2, R3, and R4', () => {
    const cases = [
      { ...edgeComplexR2(), hidden: 1 },
      { ...triangleComplexR3(), hidden: 2 },
      { ...tetraComplex(), hidden: 3 }
    ];
    for (const { complex, group, hidden } of cases) {
      const slice = HyperplaneSliceN.axisAligned(complex.ambientDim, hidden, 0);
      const product = new SectionChart3D(complex, group, slice);
      const reference = sectionSimplexGroupN({ complex, group, slice });
      // Liveness first.
      expect(reference.cellCount).toBeGreaterThan(0);
      expect(product.cellCount).toBe(reference.cellCount);
      expect(product.section.cellCount).toBe(reference.cellCount);

      const drawn = product.geometry.drawRange.count;
      expect(drawn).toBe(reference.cells.length);
      const positions = product.geometry.getAttribute('position');
      for (let slot = 0; slot < drawn; slot++) {
        const vertex = reference.cells[slot]!;
        for (let axis = 0; axis < 3; axis++) {
          const expected = axis < reference.chartDim
            ? Math.fround(reference.chartPositions[vertex * reference.chartDim + axis]!)
            : 0;
          expect(positions.getComponent(slot, axis)).toBe(expected);
        }
      }
      product.dispose();
    }
  });

  it('agrees with SlicedComplex3D on the R4 tetrahedral cut', () => {
    const { complex, group } = tetraComplex();
    const generic = new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(4, 3, 0)
    );
    const legacy = new SlicedComplex3D(complex, HyperplaneSlice4.axisAligned(3, 0));
    // Liveness on both sides.
    expect(generic.cellCount).toBe(1);
    const legacyDrawn = legacy.object; // one triangle expected in the geometry
    expect(legacyDrawn).toBeDefined();

    // Same cut point set (the legacy product draws in the slice's own chart
    // too), and the same parent mapping.
    const key = (x: number, y: number, z: number): string =>
      [x, y, z].map((value) => value.toFixed(5)).join(',');
    const genericPoints = new Set<string>();
    const attribute = generic.geometry.getAttribute('position');
    for (let slot = 0; slot < generic.geometry.drawRange.count; slot++) {
      genericPoints.add(key(
        attribute.getComponent(slot, 0),
        attribute.getComponent(slot, 1),
        attribute.getComponent(slot, 2)
      ));
    }
    const legacyAttribute = legacy.geometry.getAttribute('position');
    const legacyPoints = new Set<string>();
    for (let slot = 0; slot < legacy.geometry.drawRange.count; slot++) {
      legacyPoints.add(key(
        legacyAttribute.getComponent(slot, 0),
        legacyAttribute.getComponent(slot, 1),
        legacyAttribute.getComponent(slot, 2)
      ));
    }
    expect(genericPoints.size).toBe(3);
    expect(legacyPoints).toEqual(genericPoints);
    expect(generic.sourceCellOfPrimitive(0)).toBe(0);
    expect(legacy.sourceTetOfFace(0)).toBe(0);
    generic.dispose();
    legacy.dispose();
  });

  it('renders a chained R5→R4→R3 section whose picks keep R5 ancestry', () => {
    // A 4-simplex in R5 sectioned to R4 cells, then the intermediate complex
    // sectioned again — rendered in R3 with the composed lineage riding along.
    const source = new CellComplex(5, Float64Array.from([
      0, 0, 0, -1, -1,
      4, 0, 0, 1, 1,
      0, 4, 0, 1, -1,
      0, 0, 4, -1, 1,
      1, 1, 1, 1, 1
    ]), [{
      key: 'body', dim: 4, verticesPerCell: 5, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 2, 3, 4])
    }]);
    const first = sectionSimplexGroupN({
      complex: source, group: source.groups[0]!,
      slice: HyperplaneSliceN.axisAligned(5, 4, 0)
    });
    expect(first.cellCount).toBeGreaterThan(0);
    const intermediateGroup: CellGroup = {
      dim: first.cellDim, verticesPerCell: first.verticesPerCell,
      kind: 'simplex', indices: first.cells
    };
    const intermediate = new CellComplex(5, first.ambientPositions, [intermediateGroup]);
    // An R5 hyperplane's chart is R4, which has no display axes: the honest
    // chained render first re-expresses the intermediate section in its own
    // chart (an R4 complex carrying the composed lineage) and then cuts that.
    // Asking the adapter to render the R5 chart directly must refuse by name —
    // the hit-adapter suite below drives the working rebased pattern.
    expect(() => new SectionChart3D(
      intermediate, intermediateGroup, HyperplaneSliceN.axisAligned(5, 3, 0),
      { lineage: first.lineage }
    )).toThrow(/chart dimension 4/);
  });

  it('refuses charts and cells with no display axes, by name', () => {
    const source = new CellComplex(5, Float64Array.from([
      0, 0, 0, 0, -1,
      2, 0, 0, 0, 1,
      0, 2, 0, 0, 1,
      0, 0, 2, 0, 1,
      0, 0, 0, 2, 1
    ]), [{
      key: 'body', dim: 4, verticesPerCell: 5, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 2, 3, 4])
    }]);
    expect(() => new SectionChart3D(
      source, source.groups[0]!, HyperplaneSliceN.axisAligned(5, 4, 0)
    )).toThrow(/chart dimension 4|cells of dimension 3/);

    const { complex, group } = tetraComplex();
    expect(() => new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(4, 3, 0),
      { magic: true } as never
    )).toThrow(/unknown option "magic"/);
    expect(() => new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(3, 2, 0)
    )).toThrow(/slice is 3D but the complex is 4D/);
  });
});

describe('SectionChart3D: streaming, ownership, and determinism', () => {
  it('keeps no stale primitives when the section shrinks or empties', () => {
    const { complex, group } = tetraComplex();
    const slice = HyperplaneSliceN.axisAligned(4, 3, 0);
    const product = new SectionChart3D(complex, group, slice);
    expect(product.geometry.drawRange.count).toBeGreaterThan(0);

    // Move the plane past the body on both sides: empty either way, with the
    // two different reasons observable rather than conflated.
    slice.offset = 5;
    product.update();
    expect(product.cellCount).toBe(0);
    expect(product.geometry.drawRange.count).toBe(0);
    expect(product.section.diagnostics.cellsBelow).toBe(1);
    slice.offset = -5;
    product.update();
    expect(product.cellCount).toBe(0);
    expect(product.geometry.drawRange.count).toBe(0);
    expect(product.section.diagnostics.suppressedOnPlaneCells).toBe(1);

    product.dispose();

    // A tangent-collapse is a different reason, and the adapter reads it: the
    // on-plane vertex is the only non-below one, so the cell straddles yet
    // every candidate cell welds onto that single vertex.
    const tangent = new CellComplex(4, Float64Array.from([
      0, 0, 0, -1,
      2, 0, 0, -1,
      0, 2, 0, -1,
      0.4, 0.4, 0.4, 0
    ]), [{
      key: 'solid', dim: 3, verticesPerCell: 4, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 2, 3])
    }]);
    const collapsed = new SectionChart3D(
      tangent, tangent.groups[0]!, HyperplaneSliceN.axisAligned(4, 3, 0)
    );
    expect(collapsed.cellCount).toBe(0);
    expect(collapsed.geometry.drawRange.count).toBe(0);
    expect(collapsed.section.diagnostics.collapsedSectionCells).toBe(1);
    expect(collapsed.section.diagnostics.suppressedOnPlaneCells).toBe(0);
    collapsed.dispose();
  });

  it('is pickable only at the new position after a moved-geometry update', () => {
    const { complex, group } = tetraComplex();
    const product = new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(4, 3, 0)
    );
    const cast = (x: number, y: number): number => {
      product.object.updateMatrixWorld(true);
      const caster = new Raycaster(new Vector3(x, y, 10), new Vector3(0, 0, -1), 0.01, 100);
      return caster.intersectObject(product.object, true).length;
    };
    expect(cast(0.4, 0.4)).toBeGreaterThan(0);
    for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
      complex.positions[vertex * 4] += 50;
    }
    product.update();
    expect(cast(50.4, 0.4)).toBeGreaterThan(0);
    expect(cast(0.4, 0.4)).toBe(0);
    product.dispose();
  });

  it('recomputes normals so reversing the slice normal flips the facing', () => {
    const { complex, group } = tetraComplex();
    const slice = HyperplaneSliceN.axisAligned(4, 3, 0);
    const product = new SectionChart3D(complex, group, slice);
    const normalOf = (): [number, number, number] => {
      const attribute = product.geometry.getAttribute('normal');
      return [attribute.getComponent(0, 0), attribute.getComponent(0, 1), attribute.getComponent(0, 2)];
    };
    const forward = normalOf();
    expect(Math.hypot(...forward)).toBeGreaterThan(0.9);
    slice.setNormal(VecN.basis(4, 3).multiplyScalar(-1), 'canonical');
    product.update();
    const backward = normalOf();
    // The winding reversed, so the shading normal reversed with it.
    for (let axis = 0; axis < 3; axis++) {
      expect(backward[axis]).toBeCloseTo(-forward[axis]!, 5);
    }
    product.dispose();
  });

  it('never mutates the caller complex and never disposes a caller material', () => {
    const { complex, group } = tetraComplex();
    const before = Float64Array.from(complex.positions);
    const material = new MeshStandardMaterial();
    let disposed = 0;
    material.addEventListener('dispose', () => { disposed++; });
    const product = new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(4, 3, 0), { material }
    );
    product.update(new TransformN(4));
    expect(Array.from(complex.positions)).toEqual(Array.from(before));
    product.dispose();
    expect(disposed).toBe(0);
    material.dispose();
    expect(disposed).toBe(1);

    // And the default-material path does own and dispose its material.
    const owned = new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(4, 3, 0)
    );
    const ownedMaterial = (owned.object as { material?: MeshStandardMaterial }).material;
    let ownedDisposed = 0;
    ownedMaterial?.addEventListener('dispose', () => { ownedDisposed++; });
    owned.dispose();
    expect(ownedDisposed).toBe(1);
  });

  it('replays identical updates bitwise at the CPU result and the buffer', () => {
    const { complex, group } = tetraComplex();
    const slice = HyperplaneSliceN.axisAligned(4, 3, 0.125);
    const product = new SectionChart3D(complex, group, slice);
    const firstCells = Array.from(product.section.cells);
    const firstWeights = Array.from(product.section.lineage.weights);
    const attribute = product.geometry.getAttribute('position');
    const firstBuffer = Array.from(attribute.array as Float32Array);
    product.update();
    product.update();
    expect(Array.from(product.section.cells)).toEqual(firstCells);
    expect(Array.from(product.section.lineage.weights)).toEqual(firstWeights);
    expect(Array.from(product.geometry.getAttribute('position').array as Float32Array))
      .toEqual(firstBuffer);
    product.dispose();
  });
});

describe('SectionChart3D: bounding volumes cover exactly the live draw range', () => {
  // Independent oracle: three.js's own two algorithms — component-wise min/max
  // box, then box-centre + largest vertex distance sphere — applied to the live
  // slots of the immutable section result, never to the product's buffer.
  const oracle = (product: SectionChart3D): { box: Box3; center: Vector3; radius: number } => {
    const section = product.section;
    const box = new Box3();
    const corners: Vector3[] = [];
    for (const vertex of section.cells) {
      const corner = new Vector3(
        Math.fround(section.chartPositions[vertex * section.chartDim]!),
        section.chartDim > 1 ? Math.fround(section.chartPositions[vertex * section.chartDim + 1]!) : 0,
        section.chartDim > 2 ? Math.fround(section.chartPositions[vertex * section.chartDim + 2]!) : 0
      );
      corners.push(corner);
      box.expandByPoint(corner);
    }
    const center = new Vector3();
    box.getCenter(center);
    let radiusSq = 0;
    for (const corner of corners) {
      radiusSq = Math.max(radiusSq, center.distanceToSquared(corner));
    }
    return { box, center, radius: Math.sqrt(radiusSq) };
  };

  const agree = (product: SectionChart3D): void => {
    const expected = oracle(product);
    const box = product.geometry.boundingBox;
    const sphere = product.geometry.boundingSphere;
    expect(box).not.toBeNull();
    expect(sphere).not.toBeNull();
    expect(box!.min.toArray()).toEqual(expected.box.min.toArray());
    expect(box!.max.toArray()).toEqual(expected.box.max.toArray());
    expect(sphere!.center.toArray()).toEqual(expected.center.toArray());
    expect(sphere!.radius).toBe(expected.radius);
  };

  it('reports the reviewed 40…41 fixture at its true size, not 25× over', () => {
    const { complex, group } = tetraComplex();
    for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
      complex.positions[vertex * 4] += 40;
    }
    const product = new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(4, 3, 0)
    );
    expect(product.cellCount).toBe(1); // liveness: 3 slots in a 64-slot buffer
    // The reviewed defect: the 61 padding zeroes pulled the box to the origin
    // (min [0,0,0], max [41,1,1]) and inflated the sphere to radius 20.51
    // against a live extent of x 40…41.
    const box = product.geometry.boundingBox!;
    const sphere = product.geometry.boundingSphere!;
    expect(box.min.x).toBeCloseTo(40, 10);
    expect(box.max.x).toBeCloseTo(41, 10);
    expect(sphere.center.x).toBeCloseTo(40.5, 10);
    expect(sphere.radius).toBeLessThan(0.9);
    agree(product);
    product.dispose();
  });

  it('agrees with the live-range oracle for points, segments, and meshes', () => {
    const cases = [
      { ...edgeComplexR2(), hidden: 1 },
      { ...triangleComplexR3(), hidden: 2 },
      { ...tetraComplex(), hidden: 3 }
    ];
    for (const { complex, group, hidden } of cases) {
      // Shifted off the chart origin so a padded volume cannot pass by luck.
      for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
        complex.positions[vertex * complex.ambientDim] += 10;
      }
      const product = new SectionChart3D(
        complex, group, HyperplaneSliceN.axisAligned(complex.ambientDim, hidden, 0)
      );
      expect(product.cellCount).toBeGreaterThan(0);
      expect(product.geometry.boundingBox!.min.x).toBeGreaterThanOrEqual(10);
      agree(product);
      product.dispose();
    }
  });

  it('cannot retain stale bounds through a shrink or an empty section', () => {
    // Three staggered tetrahedra: the third stops at w = 0.3, so offset 0 cuts
    // all three, offset 0.6 cuts two, offset 5 cuts none.
    const tet = (x0: number, apexW: number): number[] => [
      x0, 0, 0, -1,
      x0 + 2, 0, 0, apexW,
      x0, 2, 0, apexW,
      x0, 0, 2, apexW
    ];
    const complex = new CellComplex(4, Float64Array.from([
      ...tet(0, 1), ...tet(10, 1), ...tet(20, 0.3)
    ]), [{
      key: 'solid', dim: 3, verticesPerCell: 4, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    }]);
    const slice = HyperplaneSliceN.axisAligned(4, 3, 0);
    const product = new SectionChart3D(complex, complex.groups[0]!, slice);
    expect(product.cellCount).toBe(3);
    expect(product.geometry.boundingBox!.max.x).toBeGreaterThan(20);
    agree(product);

    slice.offset = 0.6;
    product.update();
    expect(product.cellCount).toBe(2);
    // The retired tetrahedron's corners at x 20…22 must leave the volume.
    expect(product.geometry.boundingBox!.max.x).toBeLessThan(13);
    agree(product);

    slice.offset = 5;
    product.update();
    expect(product.cellCount).toBe(0);
    expect(product.geometry.drawRange.count).toBe(0);
    expect(product.geometry.boundingBox!.isEmpty()).toBe(true);
    expect(product.geometry.boundingSphere!.isEmpty()).toBe(true);
    product.dispose();
  });

  it('carries its bounds with moved geometry, pickable only at the new place', () => {
    const { complex, group } = tetraComplex();
    const product = new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(4, 3, 0)
    );
    const cast = (x: number, y: number): number => {
      product.object.updateMatrixWorld(true);
      const caster = new Raycaster(new Vector3(x, y, 10), new Vector3(0, 0, -1), 0.01, 100);
      return caster.intersectObject(product.object, true).length;
    };
    expect(cast(0.4, 0.4)).toBeGreaterThan(0);
    for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
      complex.positions[vertex * 4] += 50;
    }
    product.update();
    expect(product.geometry.boundingBox!.min.x).toBeCloseTo(50, 10);
    expect(product.geometry.boundingSphere!.center.x).toBeCloseTo(50.5, 10);
    agree(product);
    expect(cast(50.4, 0.4)).toBeGreaterThan(0);
    expect(cast(0.4, 0.4)).toBe(0);
    product.dispose();
  });

  it('reports the same live volume before and after capacity growth', () => {
    // Twenty-four tetrahedra cut at once need 72 slots, past the initial 64,
    // so the attribute doubles; tetrahedron 0 alone reaches to w = 5, so a
    // second offset isolates the same one-triangle section on both sides of
    // the growth.
    const tet = (x0: number, apexW: number): number[] => [
      x0, 0, 0, -1,
      x0 + 2, 0, 0, apexW,
      x0, 2, 0, apexW,
      x0, 0, 2, apexW
    ];
    const positions: number[] = [];
    const indices: number[] = [];
    for (let body = 0; body < 24; body++) {
      positions.push(...tet(3 * body, body === 0 ? 5 : 1));
      indices.push(4 * body, 4 * body + 1, 4 * body + 2, 4 * body + 3);
    }
    const complex = new CellComplex(4, Float64Array.from(positions), [{
      key: 'solid', dim: 3, verticesPerCell: 4, kind: 'simplex',
      indices: Uint32Array.from(indices)
    }]);
    const slice = HyperplaneSliceN.axisAligned(4, 3, 3);
    const product = new SectionChart3D(complex, complex.groups[0]!, slice);
    expect(product.cellCount).toBe(1);
    const before = {
      min: product.geometry.boundingBox!.min.toArray(),
      max: product.geometry.boundingBox!.max.toArray(),
      center: product.geometry.boundingSphere!.center.toArray(),
      radius: product.geometry.boundingSphere!.radius
    };
    agree(product);

    slice.offset = 0;
    product.update();
    expect(product.cellCount).toBe(24);
    expect(product.geometry.getAttribute('position').array.length).toBeGreaterThanOrEqual(72 * 3);
    agree(product);

    slice.offset = 3;
    product.update();
    expect(product.cellCount).toBe(1);
    expect(product.geometry.boundingBox!.min.toArray()).toEqual(before.min);
    expect(product.geometry.boundingBox!.max.toArray()).toEqual(before.max);
    expect(product.geometry.boundingSphere!.center.toArray()).toEqual(before.center);
    expect(product.geometry.boundingSphere!.radius).toBe(before.radius);
    agree(product);
    product.dispose();
  });
});

describe('representationHitFromSectionChart', () => {
  it('names the parent cell exactly and qualifies the point as approximate', () => {
    const { complex, group } = tetraComplex();
    const product = new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(4, 3, 0)
    );
    expect(product.cellCount).toBe(1);
    const hit = representationHitFromSectionChart(product, {
      point: new Vector3(0.5, 0.5, 0), faceIndex: 0
    });
    expect(hit.representation).toBe('section-chart');
    expect(hit.ambientDim).toBe(4);
    expect(hit.source.kind).toBe('cell');
    expect(hit.source.kind === 'cell' && hit.source.cellIndex).toBe(0);
    // Identity exact; coordinates approximate — never upgraded.
    expect(hit.ambientPointStatus).toBe('approximate');
    expect(hit.ambiguity).toBe('none');
    // The embedded ambient point lies on the hyperplane by construction.
    expect(hit.ambientPoint?.data[3]).toBeCloseTo(0, 6);
    expect(hit.lineage.steps.map((step) => step.kind))
      .toEqual(['affine-section-n', 'affine-slice-chart-n']);
    product.dispose();
  });

  it('keeps original R5 ancestry through a chained render', () => {
    const source = new CellComplex(5, Float64Array.from([
      0, 0, 0, -1, -1,
      4, 0, 0, 1, 1,
      0, 4, 0, 1, -1,
      0, 0, 4, -1, 1,
      1, 1, 1, 1, 1
    ]), [{
      key: 'body', dim: 4, verticesPerCell: 5, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 2, 3, 4])
    }]);
    const first = sectionSimplexGroupN({
      complex: source, group: source.groups[0]!,
      slice: HyperplaneSliceN.axisAligned(5, 4, 0)
    });
    // The second cut renders: 3-cells → 2-cells, chart R4 → refused, so cut
    // along a different axis to land in a renderable chart? A hyperplane chart
    // of R5 is R4 — never renderable. The chained RENDER therefore goes
    // R5 → R4 complex re-expressed in the chart, then cut to R3:
    const rebased = new CellComplex(4, (() => {
      // Express the intermediate section in its own chart coordinates: an R4
      // complex whose vertices still carry R5 ancestry through `lineage`.
      const chart = HyperplaneSliceN.axisAligned(5, 4, 0);
      const out = new Float64Array(first.vertexCount * 4);
      for (let vertex = 0; vertex < first.vertexCount; vertex++) {
        const point: number[] = [];
        for (let axis = 0; axis < 5; axis++) {
          point.push(first.ambientPositions[vertex * 5 + axis]!);
        }
        const projected = chart.projectPointToChart(point);
        for (let axis = 0; axis < 4; axis++) {
          out[vertex * 4 + axis] = projected.coordinates[axis]!;
        }
      }
      return out;
    })(), [{
      key: 'section', dim: first.cellDim, verticesPerCell: first.verticesPerCell,
      kind: 'simplex', indices: first.cells
    }]);
    const product = new SectionChart3D(
      rebased, rebased.groups[0]!, HyperplaneSliceN.axisAligned(4, 3, 0),
      { lineage: first.lineage }
    );
    expect(product.cellCount).toBeGreaterThan(0);
    const hit = representationHitFromSectionChart(product, {
      point: new Vector3(0, 0, 0), faceIndex: 0
    });
    const ancestors = hit.details?.ancestrySourceVertices as number[];
    expect(ancestors.length).toBeGreaterThan(0);
    // Every named ancestor is an ORIGINAL R5 vertex, never the intermediate's.
    for (const ancestor of ancestors) expect(ancestor).toBeLessThan(5);
    const weights = hit.details?.ancestryWeights as number[];
    const offsets = hit.details?.ancestryOffsets as number[];
    for (let row = 0; row + 1 < offsets.length; row++) {
      let sum = 0;
      for (let at = offsets[row]!; at < offsets[row + 1]!; at++) sum += weights[at]!;
      expect(sum).toBeCloseTo(1, 11);
    }
    product.dispose();
  });

  it('reports segment picks through index and refuses out-of-range primitives', () => {
    const { complex, group } = triangleComplexR3();
    const product = new SectionChart3D(
      complex, group, HyperplaneSliceN.axisAligned(3, 2, 0)
    );
    expect(product.cellCount).toBe(1);
    const hit = representationHitFromSectionChart(product, {
      point: new Vector3(0.5, 0.5, 0), index: 0
    });
    expect(hit.source.kind === 'cell' && hit.source.cellIndex).toBe(0);
    expect(() => representationHitFromSectionChart(product, {
      point: new Vector3(0, 0, 0), index: 99
    })).toThrow(/outside 0…0/);
    product.dispose();
  });
});
