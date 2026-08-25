import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  HyperplaneSliceN,
  MatN,
  Rotor4,
  TransformN,
  VecN,
  createHyperrectangle,
  rotationFromPlanes,
  sectionSimplexGroupN,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  HyperboxCollider4,
  type MassProperties4,
  RigidBody4,
  massPropertiesFromCellComplex4,
  massPropertiesOfGlome4,
  massPropertiesOfHyperbox4,
  sectionOfComplex4,
  sectionOfGlome4,
  sectionOfHyperbox4,
  sectionOfSource4
} from '../src/index.js';

/**
 * Exact R4 → R3 sections of moving sources.
 *
 * Each family is checked against an oracle that does not share the
 * implementation's method: the glome against a direct R4 distance calculation,
 * the hyperbox against edge-crossing and half-space tests on the authored box,
 * and the complex against the explicit transform-then-section composition a
 * caller would otherwise write by hand.
 *
 * Half-extents are deliberately unsorted wherever a box appears, because sorted
 * extents hide the permutation the frame reconciliation exists to absorb.
 */

const AUTHORED = [3.5, 2, 1.25, 0.5] as const;
const OBLIQUE = { normal: [0.3, -0.5, 0.2, 0.78], offset: 0.35 } as const;

const relative = (actual: number, expected: number): number =>
  Math.abs(actual - expected) / Math.max(1, Math.abs(expected));

/** The 16 corners of a box centred on the origin, in its authored axes. */
const cornersOf = (half: readonly number[]): number[][] =>
  Array.from({ length: 16 }, (_, mask) =>
    [0, 1, 2, 3].map((axis) => (mask & (1 << axis) ? 1 : -1) * half[axis]!));

/** The 32 edges of a 4-box, as corner index pairs differing in one bit. */
const edgesOf16 = (): [number, number][] => {
  const edges: [number, number][] = [];
  for (let mask = 0; mask < 16; mask += 1) {
    for (let axis = 0; axis < 4; axis += 1) {
      const other = mask | (1 << axis);
      if (other !== mask) edges.push([mask, other]);
    }
  }
  return edges;
};

const spin = (planes: { i: number; j: number; angle: number }[]): Rotor4 =>
  Rotor4.fromMatrix(rotationFromPlanes(4, planes));

const boxComplex = (edgeLengths: readonly number[]): CellComplex =>
  tetrahedralizeCuboidCells(
    createHyperrectangle({ dim: 4, edgeLengths: [...edgeLengths], maxCellDimension: 3 })
  );

const tetraGroup = (complex: CellComplex) =>
  complex.groups.find((group) => group.dim === 3 && group.verticesPerCell === 4)!;

describe('sectionOfGlome4 against an independent R4 distance oracle', () => {
  const radius = 1.3;
  const source = { kind: 'glome', radius } as const;

  it('derives centre offset and section radius', () => {
    const slice = new HyperplaneSliceN(OBLIQUE);
    const position = [0.7, -0.35, 1.1, 0.4];
    const body = RigidBody4.fromMassProperties(massPropertiesOfGlome4(radius), { position });
    const section = sectionOfGlome4(source, { body, slice });
    expect(section.status).toBe('ball');
    if (section.status !== 'ball') return;

    // Oracle: the section is the set of world points at distance <= radius from
    // the centre that also lie in the hyperplane. Its radius is the largest
    // in-plane displacement that still reaches the ball — found here by walking
    // the chart basis rather than by reusing the closed form.
    const centre = body.position.toArray();
    const distance = slice.normal.toArray()
      .reduce((sum, n, axis) => sum + n * centre[axis]!, 0) - slice.offset;
    const footPoint = centre.map((v, axis) => v - distance * slice.normal.data[axis]!);
    let widest = 0;
    for (const basis of slice.basis) {
      // March along one in-plane direction until the point leaves the ball.
      let low = 0;
      let high = radius * 2;
      for (let step = 0; step < 200; step += 1) {
        const mid = (low + high) / 2;
        const probe = footPoint.map((v, axis) => v + mid * basis[axis]!);
        const inside = Math.hypot(...probe.map((v, axis) => v - centre[axis]!)) <= radius;
        if (inside) low = mid; else high = mid;
      }
      widest = Math.max(widest, low);
    }
    expect(relative(section.radius, widest)).toBeLessThan(1e-9);
    expect(relative(section.signedDistance, distance)).toBeLessThan(1e-12);
    // The chart centre is the foot point expressed in the chart.
    const embedded = slice.embedPoint(Array.from(section.chartCenter));
    for (let axis = 0; axis < 4; axis += 1) {
      expect(embedded[axis]!).toBeCloseTo(footPoint[axis]!, 9);
    }
  });

  it('covers empty, tangent and interior', () => {
    const slice = HyperplaneSliceN.axisAligned(4, 3, 0);
    const at = (w: number) =>
      sectionOfGlome4(source, { pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, w])), slice });
    expect(at(0).status).toBe('ball');
    expect(at(radius * 0.5).status).toBe('ball');
    expect(at(radius).status).toBe('tangent');
    expect(at(-radius).status).toBe('tangent');
    expect(at(radius * 1.0001).status).toBe('empty');
    expect(at(-radius * 4).status).toBe('empty');
    const interior = at(0);
    if (interior.status === 'ball') expect(interior.radius).toBeCloseTo(radius, 12);
    // An empty result carries its provenance and no geometry, so how far away
    // the source was stays recoverable from the pose rather than duplicated.
    const empty = at(radius * 2);
    expect(empty).not.toHaveProperty('radius');
    expect(empty.provenance.worldFromSource.position.data[3]).toBeCloseTo(radius * 2, 12);
  });

  it('is invariant under any rotation the body carries', () => {
    // Proved rather than special-cased: the same ball is sectioned under a
    // spread of Spin(4) elements, including double rotations.
    const slice = new HyperplaneSliceN(OBLIQUE);
    const position = [0.2, 0.65, -0.4, 0.15];
    const rotations = [
      Rotor4.identity(),
      spin([{ i: 0, j: 3, angle: 0.9 }]),
      spin([{ i: 1, j: 2, angle: -2.1 }]),
      spin([{ i: 0, j: 1, angle: 1.2 }, { i: 2, j: 3, angle: 0.35 }]),
      spin([{ i: 0, j: 2, angle: 2.7 }, { i: 1, j: 3, angle: -1.9 }])
    ];
    const reference = sectionOfGlome4(source, {
      pose: new TransformN(4, rotations[0]!, new VecN(position)),
      slice
    });
    expect(reference.status).toBe('ball');
    for (const rotation of rotations.slice(1)) {
      const rotated = sectionOfGlome4(source, {
        pose: new TransformN(4, rotation, new VecN(position)),
        slice
      });
      expect(rotated.status).toBe('ball');
      if (rotated.status !== 'ball' || reference.status !== 'ball') continue;
      expect(rotated.radius).toBeCloseTo(reference.radius, 12);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(rotated.chartCenter[axis]!).toBeCloseTo(reference.chartCenter[axis]!, 12);
      }
    }
  });

  it('preserves scale and pose across translation', () => {
    const slice = HyperplaneSliceN.axisAligned(4, 3, 0);
    for (const scale of [0.01, 1, 100]) {
      const scaled = { kind: 'glome', radius: radius * scale } as const;
      const section = sectionOfGlome4(scaled, {
        pose: new TransformN(4, Rotor4.identity(), new VecN([1, 2, 3, 0])),
        slice
      });
      expect(section.status).toBe('ball');
      if (section.status !== 'ball') continue;
      expect(relative(section.radius, radius * scale)).toBeLessThan(1e-12);
      expect(section.chartCenter[0]!).toBeCloseTo(1, 12);
      expect(section.chartCenter[1]!).toBeCloseTo(2, 12);
      expect(section.chartCenter[2]!).toBeCloseTo(3, 12);
    }
  });
});

describe('sectionOfHyperbox4 against an edge-crossing and half-space oracle', () => {
  const source = { kind: 'hyperbox', halfExtents: AUTHORED } as const;

  /**
   * Authored orders whose sort permutation is *not* its own inverse.
   *
   * A reversal like `[3.5, 2, 1.25, 0.5]` gives `Q = Qᵀ`, so it cannot tell the
   * frame from its inverse — every ordering worth testing has to include a
   * genuine cycle. `[2, 3, 1, 4]` sorts by the 3-cycle `0→1→2→0`.
   */
  const ORDERS = [[...AUTHORED], [2, 3, 1, 4], [4, 1, 3, 2], [1, 3, 4, 2]];

  it.each(ORDERS)('reproduces every authored-edge crossing for %j', (...half) => {
    const authoredHalf = half as number[];
    const source = { kind: 'hyperbox', halfExtents: authoredHalf } as const;
    const slice = new HyperplaneSliceN(OBLIQUE);
    const position = [0.7, -0.35, 1.1, 0.4];
    const body = RigidBody4.fromMassProperties(
      massPropertiesOfHyperbox4(authoredHalf),
      { position }
    );
    const section = sectionOfHyperbox4(source, { body, slice });
    expect(section.status).toBe('polyhedral');
    if (section.status !== 'polyhedral') return;

    // Oracle: place the AUTHORED corners in the world with nothing but a
    // translation — the identity rotor means the authored axes are the world
    // axes — then intersect each of the 32 edges with the plane directly.
    const worldCorners = cornersOf(authoredHalf).map((p) =>
      p.map((v, axis) => v + position[axis]!));
    const distances = worldCorners.map((p) =>
      p.reduce((sum, v, axis) => sum + slice.normal.data[axis]! * v, 0) - slice.offset);
    const crossings: number[][] = [];
    for (const [a, b] of edgesOf16()) {
      const da = distances[a]!;
      const db = distances[b]!;
      if ((da > 0) === (db > 0)) continue;
      const t = da / (da - db);
      crossings.push(worldCorners[a]!.map((v, axis) => v + t * (worldCorners[b]![axis]! - v)));
    }
    expect(crossings.length).toBeGreaterThan(0);

    // Every section vertex, embedded back into R4, must lie inside the authored
    // box and on the hyperplane.
    for (let vertex = 0; vertex < section.section.vertexCount; vertex += 1) {
      const chart = Array.from(
        section.section.chartPositions.subarray(vertex * 3, vertex * 3 + 3)
      );
      const world = slice.embedPoint(chart);
      const local = world.map((v, axis) => v - position[axis]!);
      for (let axis = 0; axis < 4; axis += 1) {
        expect(Math.abs(local[axis]!)).toBeLessThanOrEqual(authoredHalf[axis]! + 1e-9);
      }
      const onPlane = world.reduce(
        (sum, v, axis) => sum + slice.normal.data[axis]! * v, 0) - slice.offset;
      expect(Math.abs(onPlane)).toBeLessThan(1e-9);
    }

    // Every authored-edge crossing must appear among the section vertices: the
    // section keeps the whole convex boundary, not a subset of it.
    const chartVertices: number[][] = [];
    for (let vertex = 0; vertex < section.section.vertexCount; vertex += 1) {
      chartVertices.push(slice.embedPoint(Array.from(
        section.section.chartPositions.subarray(vertex * 3, vertex * 3 + 3))));
    }
    for (const crossing of crossings) {
      const nearest = Math.min(...chartVertices.map((v) =>
        Math.hypot(...v.map((c, axis) => c - crossing[axis]!))));
      expect(nearest).toBeLessThan(1e-9);
    }
  });

  it('absorbs the sort a caller would otherwise have to do by hand', () => {
    // The manual workaround, while the principal frame is a permutation, is to
    // build the box in *sorted* extents and pose it straight by the body — the
    // same trick a HyperboxCollider4 needs. This asserts the API reaches that
    // answer from the authored order, which is the step it exists to absorb.
    //
    // Note what is NOT claimed: authoring a descending box and authoring an
    // ascending one describe different world solids, and should. The sort is a
    // detail of the body's frame, not a licence to permute the caller's axes.
    const slice = new HyperplaneSliceN(OBLIQUE);
    const body = RigidBody4.fromMassProperties(massPropertiesOfHyperbox4(AUTHORED),
      { position: [0.7, -0.35, 1.1, 0.4] });
    const fromAuthored = sectionOfHyperbox4(
      { kind: 'hyperbox', halfExtents: AUTHORED }, { body, slice });

    const sorted = [...AUTHORED].sort((a, b) => a - b);
    const manualComplex = boxComplex(sorted.map((h) => h * 2));
    const pose = new TransformN(4, body.rotation.clone(), body.position.clone());
    const moved = new Float64Array(manualComplex.positions.length);
    pose.applyToPositions(manualComplex.positions, moved, manualComplex.vertexCount);
    const manualPosed = new CellComplex(4, moved, manualComplex.groups.map((group) => ({
      dim: group.dim, verticesPerCell: group.verticesPerCell,
      kind: group.kind, indices: group.indices })));
    const manual = sectionSimplexGroupN({
      complex: manualPosed, group: tetraGroup(manualPosed), slice });

    expect(fromAuthored.status).toBe('polyhedral');
    if (fromAuthored.status !== 'polyhedral') return;
    const setOfChart = (positions: Float64Array, count: number): string =>
      Array.from({ length: count }, (_, v) =>
        Array.from(positions.subarray(v * 3, v * 3 + 3))
          .map((c) => c.toFixed(9)).join(',')).sort().join('|');
    expect(setOfChart(fromAuthored.section.chartPositions, fromAuthored.section.vertexCount))
      .toBe(setOfChart(manual.chartPositions, manual.vertexCount));
  });

  it('agrees with the collider that shares the body', () => {
    // The collider must be handed sorted extents; the section must not. Both
    // must describe the same world region, which is what makes the section
    // usable next to collision results.
    const slice = new HyperplaneSliceN(OBLIQUE);
    const body = RigidBody4.fromMassProperties(
      massPropertiesOfHyperbox4(AUTHORED), { position: [0.7, -0.35, 1.1, 0.4] });
    const collider = new HyperboxCollider4({
      id: 'crate',
      halfExtents: [...AUTHORED].sort((a, b) => a - b),
      participant: body
    });
    const colliderCorners = collider.shape.enumerateVertices()
      .map((vertex) => vertex.point.toArray());
    const section = sectionOfHyperbox4({ kind: 'hyperbox', halfExtents: AUTHORED },
      { body, slice });
    expect(section.status).toBe('polyhedral');
    if (section.status !== 'polyhedral') return;
    // Reconstruct the section's own source corners through its recorded map.
    const viaProvenance = cornersOf([...AUTHORED]).map((p) =>
      section.provenance.worldFromSource.applyToPoint(new VecN(p)).toArray());
    const setOf = (points: number[][]): string =>
      points.map((p) => p.map((v) => v.toFixed(9)).join(',')).sort().join('|');
    expect(setOf(viaProvenance)).toBe(setOf(colliderCorners));
  });

  it('covers axis-aligned, rotated, translated, unsorted and tied extents', () => {
    const cases: [string, number[], Rotor4, number[]][] = [
      ['axis-aligned', [...AUTHORED], Rotor4.identity(), [0, 0, 0, 0]],
      ['translated', [...AUTHORED], Rotor4.identity(), [1, -0.5, 0.25, 0.3]],
      ['rotated', [...AUTHORED], spin([{ i: 0, j: 3, angle: 0.7 }]), [0, 0, 0, 0]],
      ['double rotation', [...AUTHORED], spin([{ i: 0, j: 1, angle: 0.6 },
        { i: 2, j: 3, angle: -0.4 }]), [0.2, 0, 0.1, 0]],
      ['tied pair', [1, 1, 2, 3], Rotor4.identity(), [0, 0, 0, 0.1]],
      ['tied, unsorted', [3, 2, 1, 1], spin([{ i: 1, j: 3, angle: 0.5 }]), [0, 0.2, 0, 0]],
      ['cube', [1, 1, 1, 1], spin([{ i: 0, j: 2, angle: 1.1 }]), [0, 0, 0, 0]]
    ];
    for (const [name, half, rotation, position] of cases) {
      const section = sectionOfHyperbox4({ kind: 'hyperbox', halfExtents: half },
        { pose: new TransformN(4, rotation, new VecN(position)),
          slice: HyperplaneSliceN.axisAligned(4, 3, 0) });
      expect(section.status, name).toBe('polyhedral');
      if (section.status !== 'polyhedral') continue;
      expect(section.section.cellCount, name).toBeGreaterThan(0);
      expect(section.section.parentCells.length, name).toBe(section.section.cellCount);
    }
  });

  it('reports empty and tangent as the plane leaves the box', () => {
    const half = [1, 1, 1, 1];
    const at = (offset: number) => sectionOfHyperbox4(
      { kind: 'hyperbox', halfExtents: half },
      { pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 0])),
        slice: HyperplaneSliceN.axisAligned(4, 3, offset) });
    expect(at(0).status).toBe('polyhedral');
    expect(at(0.999).status).toBe('polyhedral');
    expect(at(1.0001).status).toBe('empty');
    expect(at(5).status).toBe('empty');
    // A plane through the far corner touches at exactly one point.
    const corner = sectionOfHyperbox4({ kind: 'hyperbox', halfExtents: half },
      { pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 0])),
        slice: new HyperplaneSliceN({ normal: [0.5, 0.5, 0.5, 0.5], offset: 2 }) });
    expect(corner.status).toBe('tangent');
    if (corner.status === 'tangent') expect(corner.chartPositions.length).toBe(3);
  });
});

describe('sectionOfComplex4 against explicit transform-then-section', () => {
  const authored = boxComplex([1, 2.5, 4, 7]);
  const properties = massPropertiesFromCellComplex4(authored);

  it('matches the composition a caller would write by hand', () => {
    const slice = new HyperplaneSliceN(OBLIQUE);
    const body = RigidBody4.fromMassProperties(properties, { position: [0.3, -0.2, 0.5, 0.2] });
    const section = sectionOfComplex4(
      { kind: 'complex', complex: authored, massProperties: properties },
      { body, slice });
    expect(section.status).toBe('polyhedral');
    if (section.status !== 'polyhedral') return;

    // The hand-written composition: rebase into the principal frame, pose it,
    // rebuild a complex, section it.
    const inverseRotation = properties.principalAxes.transpose();
    const moved = new Float64Array(authored.positions.length);
    const point = new VecN(4);
    for (let vertex = 0; vertex < authored.vertexCount; vertex += 1) {
      for (let axis = 0; axis < 4; axis += 1) {
        point.data[axis] = authored.positions[vertex * 4 + axis]! -
          properties.centerOfMass.data[axis]!;
      }
      const principal = inverseRotation.applyTo(point);
      const world = new TransformN(4, body.rotation.clone(), body.position.clone())
        .applyToPoint(principal);
      moved.set(world.data, vertex * 4);
    }
    const posed = new CellComplex(4, moved, authored.groups.map((group) => ({
      dim: group.dim, verticesPerCell: group.verticesPerCell,
      kind: group.kind, indices: group.indices })));
    const expected = sectionSimplexGroupN({ complex: posed, group: tetraGroup(posed), slice });

    expect(section.section.vertexCount).toBe(expected.vertexCount);
    expect(section.section.cellCount).toBe(expected.cellCount);
    for (let i = 0; i < expected.vertexCount * 3; i += 1) {
      expect(section.section.chartPositions[i]!).toBeCloseTo(expected.chartPositions[i]!, 9);
    }
    expect(Array.from(section.section.parentCells)).toEqual(Array.from(expected.parentCells));
  });

  it('retains source-cell lineage over the authored complex', () => {
    const slice = HyperplaneSliceN.axisAligned(4, 3, 0.1);
    const body = RigidBody4.fromMassProperties(properties);
    const section = sectionOfComplex4(
      { kind: 'complex', complex: authored, massProperties: properties }, { body, slice });
    expect(section.status).toBe('polyhedral');
    if (section.status !== 'polyhedral') return;
    const tetrahedra = tetraGroup(authored).indices.length / 4;
    for (const parent of section.section.parentCells) {
      expect(parent).toBeLessThan(tetrahedra);
    }
    // Every section vertex is an affine combination of authored vertices.
    const { offsets, sourceVertices, weights } = section.section.lineage;
    expect(offsets.length).toBe(section.section.vertexCount + 1);
    for (let vertex = 0; vertex < section.section.vertexCount; vertex += 1) {
      let sum = 0;
      for (let i = offsets[vertex]!; i < offsets[vertex + 1]!; i += 1) {
        expect(sourceVertices[i]!).toBeLessThan(authored.vertexCount);
        sum += weights[i]!;
      }
      expect(sum).toBeCloseTo(1, 9);
    }
  });

  it('centres an off-centre authored complex on the body', () => {
    // Every box `createHyperrectangle` builds is centred on the origin, so a
    // dropped centre-of-mass term would be invisible in the tests above. This
    // authors the same box far from the origin: the body's position is its
    // centre of mass, so the section must sit at the body, not at the offset.
    const shift = [4, -3, 2, 1.5];
    const moved = Float64Array.from(authored.positions);
    for (let vertex = 0; vertex < authored.vertexCount; vertex += 1) {
      for (let axis = 0; axis < 4; axis += 1) moved[vertex * 4 + axis]! += shift[axis]!;
    }
    const offCentre = new CellComplex(4, moved, authored.groups.map((group) => ({
      dim: group.dim, verticesPerCell: group.verticesPerCell,
      kind: group.kind, indices: group.indices })));
    const offProperties = massPropertiesFromCellComplex4(offCentre);
    for (let axis = 0; axis < 4; axis += 1) {
      expect(offProperties.centerOfMass.data[axis]!).toBeCloseTo(shift[axis]!, 9);
    }
    const slice = HyperplaneSliceN.axisAligned(4, 3, 0);
    const chartXRange = (body: RigidBody4): [number, number] => {
      const section = sectionOfComplex4(
        { kind: 'complex', complex: offCentre, massProperties: offProperties },
        { body, slice });
      expect(section.status).toBe('polyhedral');
      if (section.status !== 'polyhedral') return [NaN, NaN];
      let low = Infinity;
      let high = -Infinity;
      for (let vertex = 0; vertex < section.section.vertexCount; vertex += 1) {
        const x = section.section.chartPositions[vertex * 3]!;
        low = Math.min(low, x);
        high = Math.max(high, x);
      }
      return [low, high];
    };

    // `fromMassProperties` puts an unpositioned body at the source's centre of
    // mass, so the authored solid stays exactly where it was authored: the
    // rebase and the pose undo each other.
    const [restLow, restHigh] = chartXRange(RigidBody4.fromMassProperties(offProperties));
    expect(restLow).toBeCloseTo(shift[0]! - 0.5, 9);
    expect(restHigh).toBeCloseTo(shift[0]! + 0.5, 9);

    // Move the body to the origin and the solid must follow it, centred there.
    // Dropping the centre-of-mass term would leave it out at the offset.
    const [movedLow, movedHigh] = chartXRange(
      RigidBody4.fromMassProperties(offProperties, { position: [0, 0, 0, 0] }));
    expect(movedLow).toBeCloseTo(-0.5, 9);
    expect(movedHigh).toBeCloseTo(0.5, 9);
  });

  it('never mutates the authored complex', () => {
    const before = Float64Array.from(authored.positions);
    const slice = new HyperplaneSliceN(OBLIQUE);
    for (const w of [0, 0.3, -0.7, 2]) {
      sectionOfComplex4({ kind: 'complex', complex: authored, massProperties: properties },
        { pose: new TransformN(4, spin([{ i: 0, j: 3, angle: w }]), new VecN([w, 0, 0, w])),
          slice });
    }
    expect(Array.from(authored.positions)).toEqual(Array.from(before));
  });

  it('computes the frame itself when none is supplied', () => {
    const slice = new HyperplaneSliceN(OBLIQUE);
    const body = RigidBody4.fromMassProperties(properties, { position: [0.1, 0, 0.2, 0] });
    const supplied = sectionOfComplex4(
      { kind: 'complex', complex: authored, massProperties: properties }, { body, slice });
    const derived = sectionOfComplex4({ kind: 'complex', complex: authored }, { body, slice });
    expect(derived.status).toBe(supplied.status);
    if (supplied.status !== 'polyhedral' || derived.status !== 'polyhedral') return;
    expect(derived.section.vertexCount).toBe(supplied.section.vertexCount);
    for (let i = 0; i < supplied.section.vertexCount * 3; i += 1) {
      expect(derived.section.chartPositions[i]!).toBeCloseTo(supplied.section.chartPositions[i]!, 9);
    }
  });
});

describe('provenance', () => {
  it('retains the authored source, the pose and the section frame', () => {
    const slice = new HyperplaneSliceN(OBLIQUE);
    const source = { kind: 'hyperbox', halfExtents: AUTHORED } as const;
    const body = RigidBody4.fromMassProperties(massPropertiesOfHyperbox4(AUTHORED),
      { position: [0.4, 0, 0.1, 0.2] });
    const section = sectionOfHyperbox4(source, { body, slice });
    // The source is retained by reference: no invented identifier stands in.
    expect(section.provenance.source).toBe(source);
    expect(section.provenance.slice).toBe(slice);
    expect(section.provenance.pose.position.toArray()).toEqual(body.position.toArray());
    // And the recorded map is the one that was applied.
    const viaMap = section.provenance.worldFromSource
      .applyToPoint(new VecN(cornersOf([...AUTHORED])[0]!)).toArray();
    expect(viaMap.every(Number.isFinite)).toBe(true);
  });

  it('carries provenance on empty and tangent results too', () => {
    const slice = HyperplaneSliceN.axisAligned(4, 3, 9);
    const source = { kind: 'glome', radius: 1 } as const;
    const section = sectionOfGlome4(source, {
      pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 0])), slice });
    expect(section.status).toBe('empty');
    expect(section.provenance.source).toBe(source);
    expect(section.provenance.slice).toBe(slice);
  });
});

describe('dynamic behaviour', () => {
  const slice = new HyperplaneSliceN(OBLIQUE);

  it('depends only on the current pose, with no cumulative drift', () => {
    const source = { kind: 'hyperbox', halfExtents: AUTHORED } as const;
    const body = RigidBody4.fromMassProperties(massPropertiesOfHyperbox4(AUTHORED));
    const homeRotation = body.rotation.clone();
    const homePosition = body.position.toArray();
    const digest = (): string => {
      const section = sectionOfHyperbox4(source, { body, slice });
      return section.status !== 'polyhedral' ? section.status :
        Array.from(section.section.chartPositions.subarray(0, section.section.vertexCount * 3))
          .map((v) => v.toFixed(12)).join(',');
    };
    const first = digest();
    // Walk the body a long way around and come back to exactly where it began.
    for (let step = 0; step < 600; step += 1) {
      body.position.data[0] = Math.sin(step * 0.11) * 2;
      body.position.data[3] = Math.cos(step * 0.07) * 1.5;
      body.rotation = spin([{ i: 0, j: 3, angle: step * 0.03 },
        { i: 1, j: 2, angle: -step * 0.02 }]);
      digest();
    }
    for (let axis = 0; axis < 4; axis += 1) body.position.data[axis] = homePosition[axis]!;
    body.rotation = homeRotation;
    // Returning to the same pose reproduces the same section, bit for bit: the
    // source is never advanced, so there is nothing for error to accumulate in.
    expect(digest()).toBe(first);
  });

  it('moves coherently through empty -> tangent -> interior -> tangent -> empty', () => {
    const source = { kind: 'glome', radius: 1 } as const;
    const axis = HyperplaneSliceN.axisAligned(4, 3, 0);
    const observed: string[] = [];
    for (let step = 0; step <= 40; step += 1) {
      const w = 2 - step * 0.1;
      const section = sectionOfGlome4(source, {
        pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, w])), slice: axis });
      const previous = observed[observed.length - 1];
      if (section.status !== previous) observed.push(section.status);
    }
    expect(observed).toEqual(['empty', 'tangent', 'ball', 'tangent', 'empty']);
  });

  it('leaves no stale topology or provenance behind a transition', () => {
    const source = { kind: 'hyperbox', halfExtents: [1, 1, 1, 1] } as const;
    const axis = HyperplaneSliceN.axisAligned(4, 3, 0);
    let sawPolyhedral = false;
    for (const w of [0, 0.5, 1.5, 0.5, 3, 0]) {
      const section = sectionOfHyperbox4(source, {
        pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, w])), slice: axis });
      if (section.status === 'polyhedral') {
        sawPolyhedral = true;
        expect(section.section.cellCount).toBeGreaterThan(0);
        expect(section.section.parentCells.length).toBe(section.section.cellCount);
      } else {
        // An empty result carries no geometry at all — not a stale buffer.
        expect(section).not.toHaveProperty('section');
        expect(section.provenance.pose.position.data[3]).toBeCloseTo(w, 12);
      }
    }
    expect(sawPolyhedral).toBe(true);
  });

  it('tracks a moving section plane at a fixed pose', () => {
    const source = { kind: 'glome', radius: 1.5 } as const;
    const pose = new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 0]));
    let previous = 0;
    for (const offset of [0, 0.4, 0.8, 1.2]) {
      const section = sectionOfGlome4(source,
        { pose, slice: HyperplaneSliceN.axisAligned(4, 3, offset) });
      expect(section.status).toBe('ball');
      if (section.status !== 'ball') continue;
      expect(relative(section.radius, Math.sqrt(1.5 * 1.5 - offset * offset))).toBeLessThan(1e-12);
      if (offset > 0) expect(section.radius).toBeLessThan(previous);
      previous = section.radius;
    }
  });
});

describe('sectionOfSource4 dispatch and refusals', () => {
  const slice = HyperplaneSliceN.axisAligned(4, 3, 0);
  const pose = new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 0]));

  it('dispatches each family to the same answer as its named entry', () => {
    const glome = { kind: 'glome', radius: 1 } as const;
    const box = { kind: 'hyperbox', halfExtents: AUTHORED } as const;
    expect(sectionOfSource4(glome, { pose, slice }).status)
      .toBe(sectionOfGlome4(glome, { pose, slice }).status);
    expect(sectionOfSource4(box, { pose, slice }).status)
      .toBe(sectionOfHyperbox4(box, { pose, slice }).status);
  });

  it('refuses inputs it cannot section', () => {
    expect(() => sectionOfGlome4({ kind: 'glome', radius: 0 }, { pose, slice }))
      .toThrow(/radius/);
    expect(() => sectionOfHyperbox4({ kind: 'hyperbox', halfExtents: [1, 2, 3] }, { pose, slice }))
      .toThrow(/expected 4 half-extents/);
    expect(() => sectionOfHyperbox4({ kind: 'hyperbox', halfExtents: [1, 2, 3, -1] }, { pose, slice }))
      .toThrow(/finite and positive/);
    const body = RigidBody4.fromMassProperties(massPropertiesOfGlome4(1));
    expect(() => sectionOfGlome4({ kind: 'glome', radius: 1 }, { body, pose, slice }))
      .toThrow(/exactly one of body or pose/);
    expect(() => sectionOfGlome4({ kind: 'glome', radius: 1 }, { slice }))
      .toThrow(/exactly one of body or pose/);
    expect(() => sectionOfGlome4({ kind: 'glome', radius: 1 },
      { pose, slice: HyperplaneSliceN.axisAligned(5, 4, 0) })).toThrow(/expected an R4 hyperplane/);
    expect(() => sectionOfGlome4({ kind: 'glome', radius: 1 }, { pose, slice, epsilon: -1 }))
      .toThrow(/epsilon/);
  });
});

describe('the composition itself, on a fixture that can see it', () => {
  /**
   * Every other complex fixture here is `boxComplex([1, 2.5, 4, 7])`, whose edge
   * lengths already ascend — so its principal frame is the identity and the
   * whole reconciliation reduces to the pose. Three things have to be true at
   * once for the composition to be observable: a *non-involutive* extent order
   * (a reversal is its own inverse and cannot tell `Q` from `Qᵀ`), a centre of
   * mass away from the origin, and a body rotation that is not the identity.
   */
  const EDGES = [4, 6, 2, 8]; // half [2, 3, 1, 4]; sorts by the 3-cycle 0→1→2→0
  const SHIFT = [1.3, 1.5, -2.8, 3.7];

  const offCentre = (): CellComplex => {
    const base = boxComplex(EDGES);
    const moved = Float64Array.from(base.positions);
    for (let vertex = 0; vertex < base.vertexCount; vertex += 1) {
      for (let axis = 0; axis < 4; axis += 1) moved[vertex * 4 + axis]! += SHIFT[axis]!;
    }
    return new CellComplex(4, moved, base.groups.map((group) => ({
      dim: group.dim, verticesPerCell: group.verticesPerCell,
      kind: group.kind, indices: group.indices })));
  };

  it('pins the composed map, not merely its effect on a symmetric fixture', () => {
    const complex = offCentre();
    const properties = massPropertiesFromCellComplex4(complex);
    // The frame must be a genuine permutation, or the fixture proves nothing.
    let identity = true;
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        if (Math.abs(properties.principalAxes.get(row, col) - (row === col ? 1 : 0)) > 1e-12) {
          identity = false;
        }
      }
    }
    expect(identity).toBe(false);
    for (let axis = 0; axis < 4; axis += 1) {
      expect(properties.centerOfMass.data[axis]!).toBeCloseTo(SHIFT[axis]!, 9);
    }

    const rotation = spin([{ i: 0, j: 3, angle: 0.8 }, { i: 1, j: 2, angle: -0.5 }]);
    const position = [0.4, -0.9, 1.1, 0.2];
    const body = RigidBody4.fromMassProperties(properties, { position, rotation });
    const section = sectionOfComplex4(
      { kind: 'complex', complex, massProperties: properties },
      { body, slice: new HyperplaneSliceN(OBLIQUE) });

    // `worldFromSource` must be pose ∘ (Qᵀ, −Qᵀc) — composed in that order, with
    // the centre rotated by Qᵀ before it is negated. Reversing the composition,
    // dropping the rotation of the centre, rotating it by Q instead, or
    // reporting the bare pose each land somewhere else.
    const expected = new TransformN(4, rotation.clone(), new VecN(position))
      .compose(new TransformN(
        4,
        properties.principalAxes.transpose(),
        properties.principalAxes.transpose().applyTo(properties.centerOfMass)
          .multiplyScalar(-1)
      ));
    const actual = section.provenance.worldFromSource;
    for (let axis = 0; axis < 4; axis += 1) {
      expect(actual.position.data[axis]!).toBeCloseTo(expected.position.data[axis]!, 12);
    }
    // And the map itself, not just its translation: the authored corners must
    // land where the composition says.
    for (const corner of [[0, 0, 0, 0], [2, 3, 1, 4], [-2, 3, -1, 4]]) {
      const authoredPoint = new VecN(corner.map((v, axis) => v + SHIFT[axis]!));
      const viaActual = actual.applyToPoint(authoredPoint).toArray();
      const viaExpected = expected.applyToPoint(authoredPoint).toArray();
      for (let axis = 0; axis < 4; axis += 1) {
        expect(viaActual[axis]!).toBeCloseTo(viaExpected[axis]!, 12);
      }
    }
    expect(section.status).toBe('polyhedral');
  });

  it('places the authored solid where the body puts it', () => {
    const complex = offCentre();
    const properties = massPropertiesFromCellComplex4(complex);
    const body = RigidBody4.fromMassProperties(properties);
    const section = sectionOfComplex4(
      { kind: 'complex', complex, massProperties: properties },
      { body, slice: HyperplaneSliceN.axisAligned(4, 3, SHIFT[3]!) });
    expect(section.status).toBe('polyhedral');
    if (section.status !== 'polyhedral') return;
    // At rest the body sits at the centre of mass, so the authored solid must
    // stay exactly where it was authored: chart x spans the authored x extent.
    let low = Infinity;
    let high = -Infinity;
    for (let vertex = 0; vertex < section.section.vertexCount; vertex += 1) {
      const x = section.section.chartPositions[vertex * 3]!;
      low = Math.min(low, x);
      high = Math.max(high, x);
    }
    expect(low).toBeCloseTo(SHIFT[0]! - EDGES[0]! / 2, 9);
    expect(high).toBeCloseTo(SHIFT[0]! + EDGES[0]! / 2, 9);
  });
});

describe('options that were free to regress', () => {
  const slice = new HyperplaneSliceN(OBLIQUE);

  it('honours groupKey, and refuses a key no group carries', () => {
    // Nothing else here has two tetrahedral groups, so both the option and the
    // documented "first group" default were unpinned.
    const base = boxComplex([2, 2, 2, 2]);
    const tetra = tetraGroup(base);
    const halfCells = tetra.indices.slice(0, tetra.indices.length / 2);
    const twoGroups = new CellComplex(4, base.positions, [
      { key: 'whole', dim: 3, verticesPerCell: 4, kind: tetra.kind, indices: tetra.indices },
      { key: 'half', dim: 3, verticesPerCell: 4, kind: tetra.kind, indices: halfCells }
    ]);
    const pose = new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 0]));
    const whole = sectionOfComplex4({ kind: 'complex', complex: twoGroups, groupKey: 'whole' },
      { pose, slice });
    const half = sectionOfComplex4({ kind: 'complex', complex: twoGroups, groupKey: 'half' },
      { pose, slice });
    const fallback = sectionOfComplex4({ kind: 'complex', complex: twoGroups }, { pose, slice });
    if (whole.status !== 'polyhedral' || half.status !== 'polyhedral' ||
        fallback.status !== 'polyhedral') throw new Error('expected polyhedral sections');
    expect(half.section.cellCount).toBeLessThan(whole.section.cellCount);
    // The default is the first group, not any group.
    expect(fallback.section.cellCount).toBe(whole.section.cellCount);
    expect(() => sectionOfComplex4({ kind: 'complex', complex: twoGroups, groupKey: 'nope' },
      { pose, slice })).toThrow(/no tetrahedral 3-group with key/);
  });

  it('forwards epsilon to the section, where it changes the answer', () => {
    // The default happens to match the section machinery's own, which made
    // dropping the argument an equivalent mutation. A coarse tolerance must
    // visibly change both the topology and the empty/non-empty verdict.
    const source = { kind: 'hyperbox', halfExtents: [1, 1, 1, 1] } as const;
    const pose = new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 0]));
    const axis = HyperplaneSliceN.axisAligned(4, 3, 0);
    // Near the face, a coarse tolerance snaps the plane onto it: the section
    // collapses from the interior cut to the face's own triangulation.
    const near = HyperplaneSliceN.axisAligned(4, 3, 0.96);
    const fine = sectionOfHyperbox4(source, { pose, slice: near });
    const coarse = sectionOfHyperbox4(source, { pose, slice: near, epsilon: 0.05 });
    if (fine.status !== 'polyhedral' || coarse.status !== 'polyhedral') {
      throw new Error('expected polyhedral sections');
    }
    expect(fine.section.cellCount).toBe(48);
    expect(coarse.section.cellCount).toBe(12);
    // And past the face it decides empty against non-empty.
    const past = HyperplaneSliceN.axisAligned(4, 3, 1.0001);
    expect(sectionOfHyperbox4(source, { pose, slice: past }).status).toBe('empty');
    expect(sectionOfHyperbox4(source, { pose, slice: past, epsilon: 0.05 }).status)
      .toBe('polyhedral');
    void axis;
  });

  it('snapshots the pose, so a later move cannot rewrite a past section', () => {
    // Both routes in, because they clone in different places: a body's pose is
    // rebuilt from its parts, an explicit one is cloned wholesale.
    const body = RigidBody4.fromMassProperties(massPropertiesOfGlome4(1));
    const fromBody = sectionOfGlome4({ kind: 'glome', radius: 1 }, { body, slice });
    const recordedFromBody = fromBody.provenance.pose.position.toArray();
    body.position.data[0] = 99;
    body.rotation = spin([{ i: 0, j: 1, angle: 1.1 }]);
    expect(fromBody.provenance.pose.position.toArray()).toEqual(recordedFromBody);
    expect(fromBody.provenance.worldFromSource.position.data[0]!).not.toBe(99);

    const pose = new TransformN(4, Rotor4.identity(), new VecN([0.25, 0, 0, 0]));
    const fromPose = sectionOfGlome4({ kind: 'glome', radius: 1 }, { pose, slice });
    const recordedFromPose = fromPose.provenance.pose.position.toArray();
    pose.position.data[0] = 99;
    expect(fromPose.provenance.pose.position.toArray()).toEqual(recordedFromPose);
    expect(fromPose.provenance.pose.position.data[0]!).toBe(0.25);
    expect(fromPose.provenance.worldFromSource.position.data[0]!).toBe(0.25);
  });

  it('puts the glome band edges exactly where they are documented', () => {
    const radius = 1;
    const epsilon = 1e-6;
    const at = (w: number) => sectionOfGlome4({ kind: 'glome', radius }, {
      pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, w])),
      slice: HyperplaneSliceN.axisAligned(4, 3, 0), epsilon });
    // gap = |d| - r. Just inside the band on each side, and just outside.
    expect(at(radius + epsilon * 0.5).status).toBe('tangent');
    expect(at(radius - epsilon * 0.5).status).toBe('tangent');
    expect(at(radius + epsilon * 2).status).toBe('empty');
    expect(at(radius - epsilon * 2).status).toBe('ball');

    // Both edges land *on* tangent, and the band is closed at each end. These
    // need a gap of exactly ±epsilon, so the numbers are chosen to be exact in
    // binary — with a rounded epsilon the comparison would be a coin toss.
    const exact = (w: number) => sectionOfGlome4({ kind: 'glome', radius: 1 }, {
      pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, w])),
      slice: HyperplaneSliceN.axisAligned(4, 3, 0), epsilon: 0.5 });
    expect(exact(1.5).status).toBe('tangent'); // gap = +0.5 exactly
    expect(exact(0.5).status).toBe('tangent'); // gap = -0.5 exactly
    expect(exact(1.5625).status).toBe('empty');
    expect(exact(0.4375).status).toBe('ball');
    // The default band is tight enough that a clearly-interior plane is a ball…
    expect(sectionOfGlome4({ kind: 'glome', radius }, {
      pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, radius - 1e-7])),
      slice: HyperplaneSliceN.axisAligned(4, 3, 0) }).status).toBe('ball');
    // …and wide enough to still be a band: a gap inside the documented 1e-9 is
    // tangent, which a default of zero would call empty.
    expect(sectionOfGlome4({ kind: 'glome', radius }, {
      pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, radius + 5e-10])),
      slice: HyperplaneSliceN.axisAligned(4, 3, 0) }).status).toBe('tangent');
  });

  it('keeps the leading digits of a very thin glome section', () => {
    // The factored difference of squares is not decoration: squaring first
    // cancels away the answer when the plane nearly grazes the ball.
    const radius = 1.3;
    const distance = 1.299999998;
    const section = sectionOfGlome4({ kind: 'glome', radius }, {
      pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, distance])),
      slice: HyperplaneSliceN.axisAligned(4, 3, 0), epsilon: 1e-12 });
    expect(section.status).toBe('ball');
    if (section.status !== 'ball') return;
    const factored = Math.sqrt((radius - distance) * (radius + distance));
    const naive = Math.sqrt(radius * radius - distance * distance);
    // The two disagree, and the shipped value is the accurate one.
    expect(naive).not.toBe(factored);
    expect(section.radius).toBe(factored);
    expect(Math.abs(naive - factored) / factored).toBeGreaterThan(1e-9);
  });

  it('refuses a pose or a complex of the wrong dimension', () => {
    const pose4 = new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 0]));
    expect(() => sectionOfGlome4({ kind: 'glome', radius: 1 },
      { pose: new TransformN(5), slice })).toThrow(/pose is R5, expected R4/);
    const flat = new CellComplex(3, Float64Array.from([0, 0, 0]), []);
    expect(() => sectionOfComplex4({ kind: 'complex', complex: flat }, { pose: pose4, slice }))
      .toThrow(/source complex is in R3, expected R4/);
    expect(() => sectionOfHyperbox4({ kind: 'hyperbox', halfExtents: [1, 0, 1, 1] },
      { pose: pose4, slice })).toThrow(/half-extent 1 must be finite and positive/);
    // A frame has to be supplied here, or the integration refuses first — which
    // is itself the right order, but not the refusal under test.
    const noTetrahedra = new CellComplex(4, boxComplex([2, 2, 2, 2]).positions, []);
    const anyFrame = massPropertiesFromCellComplex4(boxComplex([2, 2, 2, 2]));
    expect(() => sectionOfComplex4(
      { kind: 'complex', complex: noTetrahedra, massProperties: anyFrame },
      { pose: pose4, slice })).toThrow(/no tetrahedral 3-cell group/);
  });
});

/** `principalAxes` with columns `i` and `j` turned by `angle` inside their span. */
function turnColumns(axes: MatN, i: number, j: number, angle: number): MatN {
  const out = axes.clone();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let row = 0; row < 4; row += 1) {
    const a = axes.get(row, i);
    const b = axes.get(row, j);
    out.set(row, i, c * a + s * b);
    out.set(row, j, -s * a + c * b);
  }
  return out;
}

/**
 * A mass-property record wearing a different principal frame.
 *
 * The rotor is only rebuilt when the matrix is one `Rotor4` will accept: the
 * invalid frames under test here are invalid precisely because they are not
 * rotations, and the accept check has to be the thing that refuses them rather
 * than a constructor throwing first.
 */
function withFrame(base: MassProperties4, axes: MatN): MassProperties4 {
  let rotor = base.principalRotor;
  try {
    rotor = Rotor4.fromMatrix(axes);
  } catch {
    // Left as the canonical rotor; only `principalAxes` is under test.
  }
  return { ...base, principalAxes: axes, principalRotor: rotor };
}

describe('a supplied hyperbox frame must be a symmetry of the box', () => {
  const slice = new HyperplaneSliceN(OBLIQUE);
  const pose = new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 0]));
  const sectionWith = (half: readonly number[], properties: MassProperties4) =>
    sectionOfHyperbox4(
      { kind: 'hyperbox', halfExtents: [...half], massProperties: properties },
      { pose, slice });

  it('refuses a record whose centre of mass is not the authored origin', () => {
    // Inertia is blind to translation, so every moment ratio survives intact
    // while the box is placed somewhere it was never authored.
    const half = [3.5, 2, 1.25, 0.5];
    const canonical = massPropertiesOfHyperbox4(half);
    const translated: MassProperties4 = {
      ...canonical, centerOfMass: new VecN([2.5, -1.75, 0.5, 3])
    };
    expect(() => sectionWith(half, translated)).toThrow(/centerOfMass must be zero/);
    // The tolerance is scale-aware, not absolute: a millimetre box and a
    // kilometre box are held to the same *relative* standard.
    for (const scale of [1e-4, 1, 1e4]) {
      const scaled = half.map((h) => h * scale);
      const base = massPropertiesOfHyperbox4(scaled);
      const nudged: MassProperties4 = {
        ...base, centerOfMass: new VecN([1e-6 * scale, 0, 0, 0])
      };
      expect(() => sectionWith(scaled, nudged), `scale ${scale}`)
        .toThrow(/centerOfMass must be zero/);
      expect(() => sectionWith(scaled, base), `scale ${scale} canonical`).not.toThrow();
    }
  });

  it('refuses a tied-eigenspace rotation that is not a box symmetry', () => {
    // These are valid inertia bases — orthonormal, determinant +1, and they
    // reconstruct the same covariance exactly. They are not symmetries of the
    // axis-aligned box, and HyperboxCollider4 cannot follow them.
    const half = [1, 1, 2, 3];
    const canonical = massPropertiesOfHyperbox4(half);
    for (const degrees of [17, 45, 30, 60]) {
      const turned = turnColumns(canonical.principalAxes, 0, 1, (degrees * Math.PI) / 180);
      // Confirm it really is a valid inertia basis before asserting the refusal,
      // or the test would be refusing something already broken.
      let worst = 0;
      for (let row = 0; row < 4; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          let sum = 0;
          for (let k = 0; k < 4; k += 1) {
            sum += turned.get(row, k) * canonical.principalSecondMoments[k]! *
              turned.get(col, k);
          }
          worst = Math.max(worst, Math.abs(sum - canonical.covarianceAtCenter.get(row, col)));
        }
      }
      expect(worst, `${degrees}deg reconstructs C`).toBeLessThan(1e-9);
      expect(turned.determinant()).toBeCloseTo(1, 12);
      expect(() => sectionWith(half, withFrame(canonical, turned)), `${degrees}deg`)
        .toThrow(/symmetry of the axis-aligned box/);
    }
  });

  it('accepts a 90 degree turn of a tied pair, which is a box symmetry', () => {
    const half = [1, 1, 2, 3];
    const canonical = massPropertiesOfHyperbox4(half);
    const quarter = turnColumns(canonical.principalAxes, 0, 1, Math.PI / 2);
    expect(() => sectionWith(half, withFrame(canonical, quarter))).not.toThrow();
  });

  it('accepts sign changes that keep the determinant positive', () => {
    const half = [3.5, 2, 1.25, 0.5];
    const canonical = massPropertiesOfHyperbox4(half);
    const flipped = canonical.principalAxes.clone();
    for (const column of [0, 2]) {
      for (let row = 0; row < 4; row += 1) {
        flipped.set(row, column, -flipped.get(row, column));
      }
    }
    expect(flipped.determinant()).toBeCloseTo(1, 12);
    expect(() => sectionWith(half, withFrame(canonical, flipped))).not.toThrow();
  });

  it('accepts canonical frames at any density, and refuses a different box', () => {
    const half = [1, 2.5, 4, 7];
    expect(() => sectionWith(half, massPropertiesOfHyperbox4(half))).not.toThrow();
    expect(() => sectionWith(half, massPropertiesOfHyperbox4(half, { density: 37 })))
      .not.toThrow();
    expect(() => sectionWith(half, massPropertiesOfHyperbox4([10, 0.1, 3, 0.7])))
      .toThrow(/different box/);
  });

  it('refuses shears and reflections', () => {
    const half = [3.5, 2, 1.25, 0.5];
    const canonical = massPropertiesOfHyperbox4(half);
    const sheared = canonical.principalAxes.clone();
    sheared.set(0, 1, 0.5);
    expect(() => sectionWith(half, withFrame(canonical, sheared))).toThrow(/not orthonormal/);
    const reflected = canonical.principalAxes.clone();
    for (let row = 0; row < 4; row += 1) {
      reflected.set(row, 0, -reflected.get(row, 0));
    }
    expect(() => sectionWith(half, withFrame(canonical, reflected)))
      .toThrow(/determinant \+1/);
  });

  it('refuses a self-consistent record whose moments are not ascending', () => {
    // The subtlest of the family: identity axes, zero centre, and every ratio
    // internally consistent — slot k really does hold axis k's moment. It is
    // still wrong, because a collider sharing the body is given the extents
    // sorted ascending, so slot k must hold the k-th *smallest*. Accepting this
    // put the section and the collider in different places.
    const half = [2, 1, 4, 8];
    const canonical = massPropertiesOfHyperbox4(half);
    const identityAxes = canonical.principalAxes.clone();
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        identityAxes.set(row, col, row === col ? 1 : 0);
      }
    }
    const selfConsistent: MassProperties4 = {
      ...withFrame(canonical, identityAxes),
      principalSecondMoments: Float64Array.from(
        half.map((extent) => (canonical.mass * extent * extent) / 3))
    };
    expect(() => sectionWith(half, selfConsistent)).toThrow(/must be ascending/);
  });

  it('refuses a permutation that is not the one sorting these extents', () => {
    // Every individual property holds: zero centre, orthonormal, determinant +1,
    // a clean signed permutation, ascending moments. What fails is the
    // association — slot 0's column points at the extent-2 axis while slot 0
    // carries the smallest moment, so a collider handed the ascending extents
    // would put half-extent 1 where the source has 2.
    //
    // Referencing the ratios against min(extents) instead of the extent slot 0
    // actually points at would accept exactly this record.
    const half = [1, 2, 4, 8];
    const canonical = massPropertiesOfHyperbox4(half);
    const swappedAxes = canonical.principalAxes.clone();
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) swappedAxes.set(row, col, 0);
    }
    swappedAxes.set(1, 0, 1);   // slot 0 -> source axis 1 (extent 2)
    swappedAxes.set(0, 1, -1);  // slot 1 -> source axis 0 (extent 1), sign keeps det +1
    swappedAxes.set(2, 2, 1);
    swappedAxes.set(3, 3, 1);
    expect(swappedAxes.determinant()).toBeCloseTo(1, 12);
    const misassociated: MassProperties4 = {
      ...withFrame(canonical, swappedAxes),
      principalSecondMoments: Float64Array.from(
        [1, 1, 16, 64].map((ratio) => (canonical.mass * ratio) / 3))
    };
    expect(() => sectionWith(half, misassociated))
      .toThrow(/different box|orders its principal moments/);
  });

  it('refuses a frame whose moment order contradicts its own axes', () => {
    // A signed permutation, a zero centre, correct ratios — but the permutation
    // is not the one that sorts these extents, so slot k does not hold the
    // moment of the axis its column points at.
    const half = [3.5, 2, 1.25, 0.5];
    const canonical = massPropertiesOfHyperbox4(half);
    const swapped = canonical.principalAxes.clone();
    for (let row = 0; row < 4; row += 1) {
      const a = canonical.principalAxes.get(row, 0);
      const b = canonical.principalAxes.get(row, 1);
      swapped.set(row, 0, b);
      swapped.set(row, 1, a);
    }
    // Swapping two columns flips the determinant, so restore it with a sign.
    for (let row = 0; row < 4; row += 1) swapped.set(row, 1, -swapped.get(row, 1));
    expect(swapped.determinant()).toBeCloseTo(1, 12);
    expect(() => sectionWith(half, withFrame(canonical, swapped)))
      .toThrow(/different box|orders its principal moments/);
  });
});

describe('the hyperbox frame tolerances, at the magnitudes that defeat them', () => {
  /**
   * The five conditions were pinned by presence and not by threshold, and every
   * tolerance in them turned out to be reachable. A second moment carries
   * length⁶, so an ordering tolerance keyed to a floor of 1 is larger than every
   * moment in a centimetre-scale record; one keyed to the largest moment is
   * larger than the gap between an adjacent pair on a high aspect ratio. A
   * centre tolerance keyed to the largest extent is enormous next to a thin one.
   */
  const slice = new HyperplaneSliceN(OBLIQUE);
  const pose = new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 0]));
  const sectionWith = (half: readonly number[], properties: MassProperties4) =>
    sectionOfHyperbox4(
      { kind: 'hyperbox', halfExtents: [...half], massProperties: properties },
      { pose, slice });

  /** Identity axes, each moment matching its own axis: self-consistent, and
   *  non-ascending exactly when the authored extents are. */
  const selfConsistent = (half: readonly number[]): MassProperties4 => {
    const canonical = massPropertiesOfHyperbox4([...half]);
    const axes = canonical.principalAxes.clone();
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) axes.set(row, col, row === col ? 1 : 0);
    }
    return {
      ...withFrame(canonical, axes),
      principalSecondMoments: Float64Array.from(
        Array.from(half, (extent) => (canonical.mass * extent * extent) / 3))
    };
  };

  it('holds the moment order at every absolute scale', () => {
    // The same record shape at four scales. Keyed to a floor of 1, the check
    // stops firing once the largest moment falls below it — around a
    // centimetre — and the section parts company with its collider by more than
    // a half-extent.
    for (const scale of [1, 0.1, 0.01, 0.001, 1e-5]) {
      const half = [2, 1, 4, 8].map((extent) => extent * scale);
      expect(() => sectionWith(half, selfConsistent(half)), `scale ${scale}`)
        .toThrow(/must be ascending/);
    }
  });

  it('holds the moment order at extreme aspect ratios', () => {
    // Keyed to the largest moment, a swap of the two smallest slips through
    // once the largest extent dwarfs them — a thin panel is enough.
    for (const half of [[1.5, 1, 2, 32000], [1.5, 1, 2, 1e5], [0.015, 0.01, 500, 500],
      [1e-6, 2e-6, 1, 1e6]]) {
      const ordered = [...half];
      // Make the first two descending so the ordering is what is under test.
      if (ordered[0]! < ordered[1]!) [ordered[0], ordered[1]] = [ordered[1]!, ordered[0]!];
      expect(() => sectionWith(ordered, selfConsistent(ordered)), `${ordered}`)
        .toThrow(/must be ascending/);
    }
  });

  it('holds the moment order at the last slot as well as the first', () => {
    const half = [1, 2, 8, 4];
    expect(() => sectionWith(half, selfConsistent(half))).toThrow(/must be ascending/);
  });

  it('measures the centre of mass against the axis it sits on', () => {
    // An offset that is nothing beside the largest extent can be a million
    // times a thin one. Keyed to the largest, this is accepted and displaces
    // the solid by 900 times the thin axis's own half-extent.
    const half = [1e-6, 1, 1, 1e6];
    const canonical = massPropertiesOfHyperbox4(half);
    expect(() => sectionWith(half, { ...canonical, centerOfMass: new VecN([9e-4, 0, 0, 0]) }))
      .toThrow(/centerOfMass must be zero/);
    // Every axis is checked, not just the first or the largest.
    for (let axis = 0; axis < 4; axis += 1) {
      const offset = [0, 0, 0, 0];
      offset[axis] = half[axis]! * 1e-6;
      expect(() => sectionWith(half, { ...canonical, centerOfMass: new VecN(offset) }),
        `axis ${axis}`).toThrow(/centerOfMass must be zero/);
    }
  });

  it('holds the association tolerance at 1e-6, however large the moments are', () => {
    // Slot 0 carries the smallest moment, so every expected ratio is at least 1
    // and the tolerance is genuinely relative. What it must not become is
    // slack: a moment wrong by one part in ten thousand is wrong, whether the
    // moment itself is 1e-24 or 1e24.
    for (const half of [[1e-6, 1, 1, 1e6], [1, 2, 3, 4], [0.002, 0.001, 0.004, 0.008]]) {
      const ascending = [...half].sort((a, b) => a - b);
      const canonical = massPropertiesOfHyperbox4(half);
      const moments = Float64Array.from(canonical.principalSecondMoments);
      moments[3] = moments[3]! * (1 + 1e-4);
      expect(() => sectionWith(half, { ...canonical, principalSecondMoments: moments }),
        `${half}`).toThrow(/different box|orders its principal moments/);
      // …and the untouched record is still accepted, so the tolerance is not
      // simply refusing everything at these magnitudes.
      expect(() => sectionWith(half, canonical), `${half} canonical`).not.toThrow();
      void ascending;
    }
  });

  it('holds the permutation thresholds', () => {
    const half = [3.5, 2, 1.25, 0.5];
    const canonical = massPropertiesOfHyperbox4(half);
    // A column that is nearly, but not, a unit axis.
    const nearlyUnit = canonical.principalAxes.clone();
    for (let row = 0; row < 4; row += 1) {
      nearlyUnit.set(row, 0, nearlyUnit.get(row, 0) * (1 - 1e-5));
    }
    expect(() => sectionWith(half, withFrame(canonical, nearlyUnit)))
      .toThrow(/not orthonormal|signed permutation|symmetry of the axis-aligned box/);
    // A column with a small but real component off its axis.
    const leaning = canonical.principalAxes.clone();
    const source = [0, 1, 2, 3].find((row) =>
      Math.abs(canonical.principalAxes.get(row, 0)) > 0.5)!;
    const other = (source + 1) % 4;
    leaning.set(other, 0, 1e-7);
    expect(() => sectionWith(half, withFrame(canonical, leaning)))
      .toThrow(/not orthonormal|signed permutation|symmetry of the axis-aligned box/);
  });

  it('refuses a record that is not finite, or not four moments long', () => {
    // Every comparison here is a `>` against a tolerance, and `NaN > x` is
    // false — so without explicit checks these pass every condition and compose
    // into a transform that reports an empty section instead of refusing.
    const half = [1, 2, 3, 4];
    const canonical = massPropertiesOfHyperbox4(half);
    expect(() => sectionWith(half, { ...canonical,
      principalSecondMoments: canonical.principalSecondMoments.slice(0, 3) }))
      .toThrow(/must have 4 entries/);
    const withNaN = Float64Array.from(canonical.principalSecondMoments);
    withNaN[3] = Number.NaN;
    expect(() => sectionWith(half, { ...canonical, principalSecondMoments: withNaN }))
      .toThrow(/must be finite/);
    const nanAxes = canonical.principalAxes.clone();
    nanAxes.set(0, 0, Number.NaN);
    expect(() => sectionWith(half, withFrame(canonical, nanAxes)))
      .toThrow(/principalAxes must be finite/);
    expect(() => sectionWith(half, { ...canonical,
      centerOfMass: new VecN([Number.NaN, 0, 0, 0]) })).toThrow(/centerOfMass/);
  });

  it('refuses none of the frames a released producer actually makes', () => {
    // The tightening above is only sound if it lets every real frame through.
    const spreads = [
      [1, 2, 3, 4], [4, 3, 2, 1], [3.5, 2, 1.25, 0.5], [2, 3, 1, 4],
      [1, 1, 1, 1], [1, 1, 2, 3], [3, 2, 1, 1], [2, 2, 2, 5],
      [1, 1 + 1e-12, 2, 3],
      [1e-6, 1e-6, 1e-5, 1e-4], [1e6, 2e6, 3e6, 4e6],
      [1e-6, 1, 1, 1e6], [0.01, 0.015, 500, 500], [0.002, 0.001, 0.004, 0.008]
    ];
    for (const half of spreads) {
      for (const density of [1, 1e-6, 37, 1e6]) {
        expect(() => sectionWith(half, massPropertiesOfHyperbox4(half, { density })),
          `analytic ${half} at density ${density}`).not.toThrow();
      }
      // And the integrated frame of the same box, which is floating point
      // rather than exact and is the tightening's real test.
      const complex = boxComplex(half.map((extent) => extent * 2));
      expect(() => sectionWith(half, massPropertiesFromCellComplex4(complex)),
        `integrated ${half}`).not.toThrow();
    }
  });
});

describe('every accepted hyperbox frame keeps section, collider and box together', () => {
  /**
   * The invariant the frame check exists to protect, asserted directly rather
   * than inferred from moment ratios: for any frame the source accepts, three
   * independently-derived descriptions of the solid must name one world region.
   *
   * The collider is the binding constraint. It is axis-aligned in its body's
   * frame and carries no local orientation, so it can only follow a frame that
   * is a symmetry of the box — which is why arbitrary tied-eigenspace bases are
   * refused rather than accommodated.
   */
  const slice = new HyperplaneSliceN(OBLIQUE);
  const setOf = (points: readonly number[][]): string =>
    points.map((p) => p.map((v) => v.toFixed(9)).join(',')).sort().join('|');

  const cases: [string, number[], (axes: MatN) => MatN][] = [
    ['distinct, unsorted', [3.5, 2, 1.25, 0.5], (axes) => axes],
    ['distinct, sorted', [0.5, 1.25, 2, 3.5], (axes) => axes],
    ['distinct, 3-cycle', [2, 3, 1, 4], (axes) => axes],
    ['tied, sorted', [1, 1, 2, 3], (axes) => axes],
    ['tied, unsorted', [3, 2, 1, 1], (axes) => axes],
    ['tied pair turned 90 degrees', [1, 1, 2, 3],
      (axes) => turnColumns(axes, 0, 1, Math.PI / 2)],
    ['two columns sign-flipped', [3.5, 2, 1.25, 0.5], (axes) => {
      const out = axes.clone();
      for (const column of [1, 3]) {
        for (let row = 0; row < 4; row += 1) out.set(row, column, -out.get(row, column));
      }
      return out;
    }]
  ];

  it.each(cases)('%s', (_name, half, reframe) => {
    const authoredHalf = half as number[];
    const canonical = massPropertiesOfHyperbox4(authoredHalf);
    const frame = withFrame(canonical, reframe(canonical.principalAxes));

    // A body that has moved: a translation and a rotation unrelated to the
    // frame, which is what a simulated body actually carries.
    const body = RigidBody4.fromMassProperties(frame, { position: [0.7, -0.35, 1.1, 0.4] });
    body.rotation = spin([{ i: 0, j: 3, angle: 0.9 }, { i: 1, j: 2, angle: -0.4 }])
      .multiply(body.rotation);

    const section = sectionOfHyperbox4(
      { kind: 'hyperbox', halfExtents: authoredHalf, massProperties: frame },
      { body, slice });

    // (1) the section's reconstructed source corners
    const viaSection = cornersOf(authoredHalf).map((corner) =>
      section.provenance.worldFromSource.applyToPoint(new VecN(corner)).toArray());

    // (2) the attached collider's world corners. Its half-extents are the
    //     authored ones in the frame's own slot order, which the accept check
    //     guarantees is the ascending sort.
    const collider = new HyperboxCollider4({
      id: 'crate',
      halfExtents: [...authoredHalf].sort((a, b) => a - b),
      participant: body
    });
    const viaCollider = collider.shape.enumerateVertices()
      .map((vertex) => vertex.point.toArray());

    // (3) the authored box transformed by hand, without the composition path.
    const pose = new TransformN(4, body.rotation.clone(), body.position.clone());
    const inverse = frame.principalAxes.transpose();
    const viaHand = cornersOf(authoredHalf).map((corner) =>
      pose.applyToPoint(inverse.applyTo(new VecN(corner))).toArray());

    expect(setOf(viaSection)).toBe(setOf(viaCollider));
    expect(setOf(viaHand)).toBe(setOf(viaCollider));
  });
});
