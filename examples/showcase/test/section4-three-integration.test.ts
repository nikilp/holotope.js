import { describe, expect, it } from 'vitest';
import {
  type CellComplex,
  HyperplaneSliceN,
  Rotor4,
  TransformN,
  VecN,
  createHyperrectangle,
  rotationFromPlanes,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import {
  RigidBody4,
  massPropertiesFromCellComplex4,
  massPropertiesOfHyperbox4,
  sectionOfComplex4,
  sectionOfHyperbox4
} from '@holotope/physics';
import { SectionChart3D } from '@holotope/three';

/**
 * P70 Part E — the derived section reaching an existing sliced representation.
 *
 * `@holotope/three` depends on `@holotope/core` and not on `@holotope/physics`,
 * which is why this lives here rather than in either package: the showcase is
 * the workspace that already composes all three.
 *
 * No rendering machinery is added. `SectionChart3D.update(transform)` already
 * re-sections a complex under a pose into a product-private buffer, and what
 * the composition path supplies is exactly the transform that update needs —
 * the authored source's frame reconciled against the body's, composed with the
 * body pose. The renderer keeps its materials, camera and lighting; it gains
 * only the map. `src/section4-bridge.ts` is the consumer-side half of that
 * handshake, and is exercised at the bottom of this file.
 */

const OBLIQUE = { normal: [0.3, -0.5, 0.2, 0.78], offset: 0.35 } as const;

const boxComplex = (edgeLengths: readonly number[]): CellComplex =>
  tetrahedralizeCuboidCells(
    createHyperrectangle({ dim: 4, edgeLengths: [...edgeLengths], maxCellDimension: 3 })
  );

const tetraGroup = (complex: CellComplex) =>
  complex.groups.find((group) => group.dim === 3 && group.verticesPerCell === 4)!;

const spin = (planes: { i: number; j: number; angle: number }[]): Rotor4 =>
  Rotor4.fromMatrix(rotationFromPlanes(4, planes));

describe('a composed R4 section driving SectionChart3D', () => {
  const authored = boxComplex([1, 2.5, 4, 7]);
  const properties = massPropertiesFromCellComplex4(authored);

  it('reproduces the composed section in the render product', () => {
    const slice = new HyperplaneSliceN(OBLIQUE);
    const body = RigidBody4.fromMassProperties(properties, { position: [0.3, -0.2, 0.5, 0.2] });
    const section = sectionOfComplex4(
      { kind: 'complex', complex: authored, massProperties: properties },
      { body, slice }
    );
    expect(section.status).toBe('polyhedral');
    if (section.status !== 'polyhedral') return;

    const chart = new SectionChart3D(authored, tetraGroup(authored), slice);
    // The one thing the renderer needs, and the one thing it could not derive
    // on its own: where the authored source sits, given the body carrying it.
    chart.update(section.provenance.worldFromSource);

    expect(chart.section.vertexCount).toBe(section.section.vertexCount);
    expect(chart.section.cellCount).toBe(section.section.cellCount);
    for (let i = 0; i < section.section.vertexCount * 3; i += 1) {
      expect(chart.section.chartPositions[i]!).toBeCloseTo(
        section.section.chartPositions[i]!, 12);
    }
    chart.dispose();
  });

  it('keeps provenance answerable through the render product', () => {
    const slice = HyperplaneSliceN.axisAligned(4, 3, 0.1);
    const body = RigidBody4.fromMassProperties(properties);
    const section = sectionOfComplex4(
      { kind: 'complex', complex: authored, massProperties: properties },
      { body, slice }
    );
    if (section.status !== 'polyhedral') throw new Error('expected a polyhedral section');

    const chart = new SectionChart3D(authored, tetraGroup(authored), slice);
    chart.update(section.provenance.worldFromSource);

    // A picked primitive still names an authored cell, and the composition
    // path's provenance names the authored source that cell belongs to.
    const primitive = 0;
    const sourceCell = chart.sourceCellOfPrimitive(primitive);
    expect(sourceCell).toBe(section.section.parentCells[primitive]!);
    expect(sourceCell).toBeLessThan(tetraGroup(authored).indices.length / 4);
    const ancestry = chart.vertexAncestry(chart.primitiveVertices(primitive)[0]!);
    for (const vertex of ancestry.sourceVertices) {
      expect(vertex).toBeLessThan(authored.vertexCount);
    }
    // The section's own provenance answers "which authored source is this?"
    // without any renderer-side identifier standing in for it.
    expect(section.provenance.source.kind).toBe('complex');
    if (section.provenance.source.kind === 'complex') {
      expect(section.provenance.source.complex).toBe(authored);
    }
    chart.dispose();
  });

  it('tracks a moving body across repeated updates', () => {
    const slice = new HyperplaneSliceN(OBLIQUE);
    const body = RigidBody4.fromMassProperties(properties);
    const chart = new SectionChart3D(authored, tetraGroup(authored), slice);
    for (let step = 0; step < 12; step += 1) {
      body.position.data[0] = Math.sin(step * 0.4) * 1.5;
      body.position.data[3] = Math.cos(step * 0.3) * 0.8;
      body.rotation = spin([{ i: 0, j: 3, angle: step * 0.25 }]);
      const section = sectionOfComplex4(
        { kind: 'complex', complex: authored, massProperties: properties },
        { body, slice }
      );
      if (section.status !== 'polyhedral') continue;
      chart.update(section.provenance.worldFromSource);
      expect(chart.section.vertexCount).toBe(section.section.vertexCount);
      for (let i = 0; i < section.section.vertexCount * 3; i += 1) {
        expect(chart.section.chartPositions[i]!).toBeCloseTo(
          section.section.chartPositions[i]!, 12);
      }
    }
    // The authored complex is still the authority after every update.
    expect(chart.complex).toBe(authored);
    chart.dispose();
  });

  it('renders an analytic hyperbox through the same product', () => {
    // The analytic families reach the renderer the same way: the composition
    // path hands back the map, and the box's own complex is what it sections.
    const half = [3.5, 2, 1.25, 0.5];
    const slice = new HyperplaneSliceN(OBLIQUE);
    const body = RigidBody4.fromMassProperties(massPropertiesOfHyperbox4(half),
      { position: [0.2, 0, 0.3, 0.1] });
    const section = sectionOfHyperbox4({ kind: 'hyperbox', halfExtents: half },
      { body, slice });
    expect(section.status).toBe('polyhedral');
    if (section.status !== 'polyhedral') return;

    const boxSource = boxComplex(half.map((h) => h * 2));
    const chart = new SectionChart3D(boxSource, tetraGroup(boxSource), slice);
    chart.update(section.provenance.worldFromSource);
    expect(chart.section.vertexCount).toBe(section.section.vertexCount);
    for (let i = 0; i < section.section.vertexCount * 3; i += 1) {
      expect(chart.section.chartPositions[i]!).toBeCloseTo(
        section.section.chartPositions[i]!, 12);
    }
    chart.dispose();
  });
});

describe('the consumer-side bridge', () => {
  const authored = boxComplex([1, 2.5, 4, 7]);
  const properties = massPropertiesFromCellComplex4(authored);

  it('hands a renderer geometry and provenance for every section shape', async () => {
    const { chartForComplexSource, displaySection } =
      await import('../src/section4-bridge.js');
    const slice = new HyperplaneSliceN(OBLIQUE);
    const source = { kind: 'complex', complex: authored, massProperties: properties } as const;
    const chart = chartForComplexSource(source, slice);
    const body = RigidBody4.fromMassProperties(properties);

    const drawn = displaySection(source, { body, slice }, chart);
    expect(drawn.kind).toBe('surface');
    if (drawn.kind === 'surface') {
      expect(drawn.chart.section.cellCount).toBeGreaterThan(0);
      expect(drawn.provenance.source).toBe(source);
    }

    // A ball needs no chart, and reports the two numbers a sphere is drawn from.
    const ballSource = { kind: 'glome', radius: 1.3 } as const;
    const ball = displaySection(ballSource, {
      pose: new TransformN(4, Rotor4.identity(), new VecN([0.2, -0.1, 0.4, 0.15])),
      slice
    });
    expect(ball.kind).toBe('ball');
    if (ball.kind === 'ball') {
      expect(ball.radius).toBeGreaterThan(0);
      expect(ball.center).toHaveLength(3);
      expect(ball.center.every(Number.isFinite)).toBe(true);
    }

    // Far away, there is nothing to draw and the bridge says so rather than
    // handing back a stale surface.
    const gone = displaySection(ballSource, {
      pose: new TransformN(4, Rotor4.identity(), new VecN([0, 0, 0, 40])),
      slice
    });
    expect(gone.kind).toBe('absent');
    expect(gone.provenance.source).toBe(ballSource);
    chart.dispose();
  });

  it('refuses to draw a surface without the product that holds its buffers', async () => {
    const { displaySection } = await import('../src/section4-bridge.js');
    const slice = new HyperplaneSliceN(OBLIQUE);
    const body = RigidBody4.fromMassProperties(properties);
    expect(() => displaySection(
      { kind: 'complex', complex: authored, massProperties: properties },
      { body, slice }
    )).toThrow(/needs the SectionChart3D/);
  });
});

describe('the bridge refuses a chart over the wrong box', () => {
  it('rejects the sorted box a collider would have wanted', async () => {
    const { chartForBoxSource } = await import('../src/section4-bridge.js');
    const slice = new HyperplaneSliceN(OBLIQUE);
    const authoredHalf = [3.5, 2, 1.25, 0.5];
    const source = { kind: 'hyperbox', halfExtents: authoredHalf } as const;
    // `worldFromSource` maps authored coordinates, so a chart over the sorted
    // box would render a plausible, wrong solid.
    const sorted = boxComplex([...authoredHalf].sort((a, b) => a - b).map((h) => h * 2));
    expect(() => chartForBoxSource(sorted, source, slice))
      .toThrow(/must be built over the authored box/);
    const authoredBox = boxComplex(authoredHalf.map((h) => h * 2));
    const chart = chartForBoxSource(authoredBox, source, slice);
    expect(chart.complex).toBe(authoredBox);
    chart.dispose();
  });
});
