import { describe, expect, it } from 'vitest';
import {
  createHyperrectangle,
  tetrahedralizeCuboidCells,
  type CellGroup
} from '@holotope/core';
import { massPropertiesFromCellComplex4 } from '@holotope/physics';
import {
  BRIDGE_EDGE_LENGTHS,
  BRIDGE_IDS,
  DIMENSION_BRIDGE_DOCUMENT,
  compileDimensionBridgeDocument,
  poseForRepresentation
} from '../src/dimension-bridge-document.js';

/**
 * The flagship's scenario, checked without a DOM.
 *
 * The page previously built this privately — a cube scaled by four factors,
 * mass by hand, geometry rebased, body and world constructed directly. These
 * tests exist to prove the migration is a migration: the same body, reached
 * through the public declarative path, with nothing reconstructed alongside.
 *
 * Source parity is the load-bearing one. If the document's positions ever stop
 * matching a direct `createHyperrectangle`, the example has quietly gone back
 * to describing something other than what it renders.
 */

const groupSignature = (groups: readonly CellGroup[]): string[] =>
  groups.map((group) => `${group.dim}:${group.kind}:${group.verticesPerCell}`).sort();

describe('the dimension bridge document', () => {
  it('is a valid ExperimentDocumentV0 without a cast', () => {
    // `satisfies` at the declaration is what proves this; the runtime check
    // here just pins the shape a reader sees.
    expect(DIMENSION_BRIDGE_DOCUMENT.ambientDim).toBe(4);
    expect(DIMENSION_BRIDGE_DOCUMENT.sources.body.kind).toBe(
      'core.source.hyperrectangle'
    );
    expect(DIMENSION_BRIDGE_DOCUMENT.sources.body.edgeLengths).toEqual([
      ...BRIDGE_EDGE_LENGTHS
    ]);
  });

  it('prepares and compiles with the two public capabilities', async () => {
    const bridge = await compileDimensionBridgeDocument();
    expect(bridge.compilation.step).toBe(0);
    expect(bridge.source.category).toBe('source');
    expect(bridge.model.category).toBe('model');
    bridge.compilation.dispose();
  });

  it('registers deterministic ids in a deterministic order', async () => {
    const first = await compileDimensionBridgeDocument();
    const second = await compileDimensionBridgeDocument();
    expect(Array.from(first.compilation.ids)).toEqual(
      Array.from(second.compilation.ids)
    );
    expect(Array.from(first.compilation.ids)).toContain(BRIDGE_IDS.source);
    expect(Array.from(first.compilation.ids)).toContain(BRIDGE_IDS.model);
    first.compilation.dispose();
    second.compilation.dispose();
  });
});

describe('the compiled source is the authored orthotope', () => {
  it('is a hyperrectangle, not a scaled cube', async () => {
    const bridge = await compileDimensionBridgeDocument();
    expect(bridge.source.kind).toBe('core.source.hyperrectangle');
    bridge.compilation.dispose();
  });

  it('has exactly the positions of a direct createHyperrectangle', async () => {
    const bridge = await compileDimensionBridgeDocument();
    const direct = tetrahedralizeCuboidCells(
      createHyperrectangle({
        dim: 4,
        edgeLengths: [...BRIDGE_EDGE_LENGTHS],
        maxCellDimension: 3
      })
    );
    // Byte for byte: no page-side rescale, and no principal-frame rebasing of
    // the compiled source. The model owns its own reference pose.
    expect(Array.from(bridge.source.complex.positions)).toEqual(
      Array.from(direct.positions)
    );
    expect(groupSignature(bridge.source.complex.groups)).toEqual(
      groupSignature(direct.groups)
    );
    bridge.compilation.dispose();
  });

  it('carries the cuboid and simplex groups the former page source had', async () => {
    const bridge = await compileDimensionBridgeDocument();
    expect(groupSignature(bridge.source.complex.groups)).toEqual([
      '1:cuboid:2',
      '2:cuboid:4',
      '3:cuboid:8',
      '3:simplex:4'
    ]);
    bridge.compilation.dispose();
  });

  it('is non-isotropic and finite', async () => {
    const bridge = await compileDimensionBridgeDocument();
    const properties = massPropertiesFromCellComplex4(bridge.source.complex);
    expect(Number.isFinite(properties.mass)).toBe(true);
    expect(properties.mass).toBeGreaterThan(0);
    const inertia = Array.from(properties.inertiaDiagonal);
    expect(inertia).toHaveLength(6);
    expect(inertia.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
    expect(Math.max(...inertia) - Math.min(...inertia)).toBeGreaterThan(0.1);
    bridge.compilation.dispose();
  });
});

describe('the three representations share one source and one model', () => {
  it('all reference the same compiled source and pose model', async () => {
    const bridge = await compileDimensionBridgeDocument();
    for (const representation of [
      bridge.perspective,
      bridge.coordinate,
      bridge.section
    ]) {
      expect(representation.source).toBe(BRIDGE_IDS.source);
      expect(representation.pose.kind).toBe('model');
      if (representation.pose.kind === 'model') {
        expect(representation.pose.model).toBe(BRIDGE_IDS.model);
      }
    }
    bridge.compilation.dispose();
  });

  it('compiles the expected map kinds', async () => {
    const bridge = await compileDimensionBridgeDocument();
    // Both projections compile to the same map kind; the projection object
    // inside is what differs, and its lineage is derived from that object.
    expect(bridge.perspective.map.kind).toBe('projection');
    expect(bridge.coordinate.map.kind).toBe('projection');
    expect(bridge.section.map.kind).toBe('slice4');
    bridge.compilation.dispose();
  });

  it('resolves each representation to the model pose', async () => {
    const bridge = await compileDimensionBridgeDocument();
    for (const representation of [
      bridge.perspective,
      bridge.coordinate,
      bridge.section
    ]) {
      const pose = poseForRepresentation(bridge.compilation, representation);
      expect(pose).toBeDefined();
      expect(pose?.dim).toBe(4);
    }
    bridge.compilation.dispose();
  });
});

describe('time, parameters, and reset run through the compilation', () => {
  it('advances a positive number of steps and turns the body', async () => {
    const bridge = await compileDimensionBridgeDocument();
    const before = Array.from(bridge.runtime.body.rotation.left);

    const advanced = bridge.compilation.advance(120);
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.value.step).toBe(120);
    expect(bridge.compilation.step).toBe(120);

    const after = Array.from(bridge.runtime.body.rotation.left);
    expect(after).not.toEqual(before);
    expect(after.every((value) => Number.isFinite(value))).toBe(true);
    bridge.compilation.dispose();
  });

  it('conserves world angular momentum while it tumbles', async () => {
    const bridge = await compileDimensionBridgeDocument();
    const before = Array.from(bridge.runtime.body.angularMomentumWorld.coeffs);
    const velocityBefore = Array.from(bridge.runtime.body.angularVelocityWorld().coeffs);

    bridge.compilation.advance(240);

    const after = Array.from(bridge.runtime.body.angularMomentumWorld.coeffs);
    for (let plane = 0; plane < 6; plane += 1) {
      expect(after[plane]!).toBeCloseTo(before[plane]!, 9);
    }
    // Distinguishes this body from a cube: for isotropic inertia the angular
    // velocity would be a fixed multiple of the conserved momentum.
    const velocityAfter = Array.from(bridge.runtime.body.angularVelocityWorld().coeffs);
    const change = Math.hypot(
      ...velocityAfter.map((value, index) => value - velocityBefore[index]!)
    );
    expect(change).toBeGreaterThan(1e-6);
    bridge.compilation.dispose();
  });

  it('moves the section through setParameter, bumping the revision once', async () => {
    const bridge = await compileDimensionBridgeDocument();
    const slice = bridge.section.map;
    if (slice.kind !== 'slice4') throw new Error('the section is not a slice');
    const before = slice.slice.offset;
    const revisionBefore = bridge.compilation.revision;

    const applied = bridge.compilation.setParameter(BRIDGE_IDS.sliceOffset, 0.55);
    expect(applied.outcome).toBe('applied');
    expect(applied.parameter).toBe(BRIDGE_IDS.sliceOffset);

    expect(slice.slice.offset).toBeCloseTo(0.55, 12);
    expect(slice.slice.offset).not.toBe(before);
    expect(bridge.compilation.revision).toBe(revisionBefore + 1);
    bridge.compilation.dispose();
  });

  it('restores the initial snapshot exactly', async () => {
    const bridge = await compileDimensionBridgeDocument();
    const rotation = Array.from(bridge.runtime.body.rotation.left);

    bridge.compilation.advance(180);
    bridge.compilation.setParameter(BRIDGE_IDS.sliceOffset, -0.4);
    expect(bridge.compilation.step).toBe(180);

    const restored = bridge.compilation.restore(bridge.initialSnapshot);
    expect(restored.ok).toBe(true);
    expect(bridge.compilation.step).toBe(0);
    expect(Array.from(bridge.runtime.body.rotation.left)).toEqual(rotation);

    const slice = bridge.section.map;
    if (slice.kind !== 'slice4') throw new Error('the section is not a slice');
    expect(slice.slice.offset).toBeCloseTo(0.12, 12);
    bridge.compilation.dispose();
  });

  it('disposes once, and reports the second attempt rather than repeating it', async () => {
    const bridge = await compileDimensionBridgeDocument();
    const first = bridge.compilation.dispose();
    expect(first.ok).toBe(true);
    expect(bridge.compilation.disposed).toBe(true);

    const second = bridge.compilation.dispose();
    // Whichever the contract is, it must be stable and must not dispose twice.
    if (second.ok) {
      expect(second.value.released).toBe(0);
    } else {
      expect(second.failures.length).toBeGreaterThan(0);
    }
  });
});
