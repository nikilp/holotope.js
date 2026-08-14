import { CellComplex, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdWorldN,
  compileSimplexConstitutiveFamilyN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  compileXpbdSourceSimplexAabbHierarchyN,
  compileXpbdSourceSimplexCosineBendingFamilyN,
  simplexStVenantKirchhoffLawN,
  stepXpbdIncrementalPotentialWorldN
} from '../src/index.js';

/**
 * The permanent regression for the composition P49 left open: intrinsic
 * stretch, extrinsic cosine bending, and finite static contact advancing
 * together through one world-scoped step, once with exhaustive candidates and
 * once with a P47 hierarchy.
 *
 * P49's outcome argued the gap was coverage rather than incompatibility,
 * "because both are ordinary conservative providers in one registry". Its
 * independent reviewer built the scene externally, confirmed the claim, and
 * deliberately left the in-repo fixture here rather than duplicating it.
 *
 * Every equivalence assertion below is guarded by liveness first. Two paths
 * agree trivially when nothing is folded, nothing is touching, and nothing
 * moved — which is exactly the fixture that would pass while proving nothing.
 */

/** A triangulated R4 membrane strip, creased along its middle row. */
function membrane(rows: number, columns: number, crease: number): {
  complex: CellComplex;
  group: CellGroup;
} {
  const positions: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      // Anisotropic in x so a frozen or uniformly-scaled path cannot satisfy
      // the evidence, and lifted on w so the sheet has somewhere to fall from.
      positions.push(column * 0.6, row * 0.45, row === 1 ? crease : 0, 0.9);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const at = row * columns + column;
      indices.push(at, at + 1, at + columns);
      indices.push(at + 1, at + columns + 1, at + columns);
    }
  }
  return {
    complex: new CellComplex(4, Float64Array.from(positions), [{
      key: 'membrane', dim: 2, verticesPerCell: 3, kind: 'simplex',
      indices: Uint32Array.from(indices)
    }]),
    group: { key: 'membrane', dim: 2, verticesPerCell: 3, kind: 'simplex',
      indices: Uint32Array.from(indices) }
  };
}

/** A finite static tetrahedral floor in the w = 0 hyperplane. */
function floor(tiles: number, spacing: number): {
  complex: CellComplex;
  group: CellGroup;
} {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let tile = 0; tile < tiles; tile++) {
    const originX = (tile % 4) * spacing;
    const originY = Math.floor(tile / 4) * spacing;
    // One tetrahedron spanning x, y, z at w = 0.
    positions.push(
      originX, originY, 0, 0,
      originX + 0.9, originY, 0, 0,
      originX, originY + 0.9, 0, 0,
      originX, originY, 0.9, 0
    );
    for (let vertex = 0; vertex < 4; vertex++) indices.push(tile * 4 + vertex);
  }
  return {
    complex: new CellComplex(4, Float64Array.from(positions), [{
      key: 'floor', dim: 3, verticesPerCell: 4, kind: 'simplex',
      indices: Uint32Array.from(indices)
    }]),
    group: { key: 'floor', dim: 3, verticesPerCell: 4, kind: 'simplex',
      indices: Uint32Array.from(indices) }
  };
}

interface Scene {
  world: XpbdWorldN;
  binding: ReturnType<typeof compileXpbdParticleBindingN>;
  material: ReturnType<typeof compileSimplexConstitutiveFamilyN>;
  bending: ReturnType<typeof compileXpbdSourceSimplexCosineBendingFamilyN>;
  contact: ReturnType<typeof compileXpbdParticleSourceSimplexBarrierFamilyN>;
  membraneComplex: CellComplex;
}

/**
 * One complete scene. `accelerated` selects a P47 hierarchy and changes
 * nothing else — same source coordinates, same provider order, same filters.
 */
function scene(id: string, accelerated: boolean): Scene {
  const sheet = membrane(3, 4, 0.35);
  // The group object identity matters to every family, so read back the one
  // the complex actually holds rather than the literal used to build it.
  const [membraneGroup] = sheet.complex.cellsOfDim(2);
  if (membraneGroup === undefined) throw new Error('membrane has no 2-cells');

  const binding = compileXpbdParticleBindingN({
    id: `${id}-points`,
    source: sheet.complex,
    // Pin the two far-row corners: the smallest set that stops the sheet
    // translating away instead of deforming.
    fixed: ({ sourceVertexIndex }) => sourceVertexIndex === 0 ||
      sourceVertexIndex === 3
  });
  for (const particle of binding.particles) particle.velocity.data[3] = -1.6;

  const material = compileSimplexConstitutiveFamilyN({
    id: `${id}-stretch`,
    source: sheet.complex,
    simplexGroup: membraneGroup,
    particles: binding.particles,
    law: simplexStVenantKirchhoffLawN,
    material: { firstLameParameter: 1.5, shearModulus: 2 }
  });

  const bending = compileXpbdSourceSimplexCosineBendingFamilyN({
    id: `${id}-bend`,
    binding,
    simplexGroup: membraneGroup,
    stiffness: 8,
    restCoordinate: 1,
    minimumMeasureRatio: 0.05
  });

  const obstacle = floor(8, 1.1);
  const [floorGroup] = obstacle.complex.cellsOfDim(3);
  if (floorGroup === undefined) throw new Error('floor has no 3-cells');

  const contact = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: `${id}-floor-contact`,
    binding,
    obstacle: obstacle.complex,
    simplexGroup: floorGroup,
    minimumDistance: 0.04,
    activationDistance: 1.2,
    stiffness: 3,
    maximumDirectionError: 2 ** -12,
    ...(accelerated
      ? {
        candidateHierarchy: compileXpbdSourceSimplexAabbHierarchyN({
          obstacle: obstacle.complex, simplexGroup: floorGroup, leafSize: 2
        })
      }
      : {})
  });

  const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
  binding.addToWorld(world);
  // Authored provider order, identical in both scenes.
  material.addToWorld(world);
  bending.addToWorld(world);
  contact.addToWorld(world);
  return { world, binding, material, bending, contact, membraneComplex: sheet.complex };
}

/** Everything a step decision can turn on, at full Float64 precision. */
function digest(target: Scene, id: string): string {
  const exact = (value: number): string => value.toExponential(17);
  const strip = (text: string): string => text.split(id).join('scene');
  const lines: string[] = [];
  for (const particle of target.binding.particles) {
    lines.push(
      `p=${strip(particle.id)}` +
      ` x=[${particle.position.toArray().map(exact).join(',')}]` +
      ` v=[${particle.velocity.toArray().map(exact).join(',')}]`
    );
  }
  lines.push(`source=[${Array.from(target.membraneComplex.positions)
    .map(exact).join(',')}]`);
  return lines.join('\n');
}

describe('membrane composition — stretch + bending + static contact', () => {
  it('advances identically with exhaustive and hierarchy candidates', { timeout: 120_000 }, () => {
    const plain = scene('plain', false);
    const fast = scene('fast', true);

    // --- 1. no mutation sharing -------------------------------------------
    expect(plain.binding.particles[0]).not.toBe(fast.binding.particles[0]);
    expect(plain.membraneComplex).not.toBe(fast.membraneComplex);
    expect(plain.world).not.toBe(fast.world);

    // --- 2. topology and fixed-vertex policy ------------------------------
    expect(plain.binding.particles.length).toBe(12);
    expect(plain.bending.hinges.length).toBeGreaterThan(0);
    expect(plain.bending.hinges.length).toBe(fast.bending.hinges.length);
    expect(plain.material.elements.length).toBe(12);
    const fixed = plain.binding.vertices
      .filter((vertex) => vertex.fixed)
      .map((vertex) => vertex.sourceVertexIndex);
    expect(fixed).toEqual([0, 3]);

    // --- 3. both terms are live before anything is compared ---------------
    const bendingStart = plain.bending.evaluate();
    const materialStart = plain.material.evaluate();
    // Bending starts genuinely loaded: the sheet is creased and rest is flat.
    expect(bendingStart.potentialEnergy).toBeGreaterThan(1);
    expect(bendingStart.hingeCount).toBeGreaterThan(0);
    // Stretch starts at its own rest, so its initial energy is roundoff — an
    // `> 0` assertion here would pass on 3.8e-32 and prove nothing. What must
    // be true is that it becomes materially loaded once the sheet deforms,
    // which is asserted after the run below.
    expect(materialStart.potentialEnergy).toBeLessThan(1e-20);
    expect(plain.material.elements.length).toBeGreaterThan(0);

    // --- 4. the world holds one registry with both filters explicit -------
    expect(plain.world.forceProviders.map((provider) => provider.id))
      .toEqual(['plain-stretch', 'plain-bend', 'plain-floor-contact']);
    const filters = (target: Scene) =>
      [target.bending.stepFilter, target.contact.stepFilter];

    // --- 5. advance both, and require contact to actually engage ----------
    const options = {
      deltaTime: 1 / 240,
      warmStart: 'feasible-inertial-prediction' as const,
      minimization: { directionPolicy: 'steepest-descent' as const }
    };
    let contactActivated = 0;
    let retainedSeen = 0;
    let appliedAfterContact = 0;
    const steps = 24;

    for (let step = 0; step < steps; step++) {
      const a = stepXpbdIncrementalPotentialWorldN({
        world: plain.world, stepFilters: filters(plain), ...options
      });
      const b = stepXpbdIncrementalPotentialWorldN({
        world: fast.world, stepFilters: filters(fast), ...options
      });

      // Terminal and diagnosis agree at every step, not only at the end.
      expect(b.step.status, `step ${step} status`).toBe(a.step.status);
      expect(b.diagnosis.condition, `step ${step} condition`)
        .toBe(a.diagnosis.condition);
      expect(b.step.minimization.status).toBe(a.step.minimization.status);
      expect(b.step.progress.acceptedIterations)
        .toBe(a.step.progress.acceptedIterations);

      // Ordered candidate identity, compared with the scene prefix removed.
      const plainContact = plain.contact.evaluate();
      const fastContact = fast.contact.evaluate();
      expect(fastContact.candidateQuery.candidates.map(
        (candidate) => candidate.id.split('fast').join('scene')
      )).toEqual(plainContact.candidateQuery.candidates.map(
        (candidate) => candidate.id.split('plain').join('scene')
      ));
      expect(fastContact.activeCandidates.map(
        (active) => active.candidate.id.split('fast').join('scene')
      )).toEqual(plainContact.activeCandidates.map(
        (active) => active.candidate.id.split('plain').join('scene')
      ));
      expect(fastContact.potentialEnergy).toBe(plainContact.potentialEnergy);

      // Bending identity and energy agree too.
      const plainBend = plain.bending.evaluate();
      const fastBend = fast.bending.evaluate();
      expect(fastBend.potentialEnergy).toBe(plainBend.potentialEnergy);
      expect(fastBend.hinges.map((record) =>
        record.hinge.id.split('fast').join('scene')
      )).toEqual(plainBend.hinges.map((record) =>
        record.hinge.id.split('plain').join('scene')
      ));

      retainedSeen = Math.max(
        retainedSeen, plainContact.candidateQuery.candidates.length
      );
      if (plainContact.activeCandidates.length > 0) {
        contactActivated++;
        if (a.step.status === 'applied') appliedAfterContact++;
      }

      plain.binding.writeSourcePositions();
      fast.binding.writeSourcePositions();
    }

    // --- 6. the liveness sequence the plan requires -----------------------
    expect(retainedSeen, 'no candidate was ever retained').toBeGreaterThan(0);
    expect(contactActivated, 'no exact barrier ever activated').toBeGreaterThan(0);
    expect(appliedAfterContact, 'no step applied after contact activated')
      .toBeGreaterThan(0);

    // The stretch provider is not a passenger: deformation loaded it well
    // above the roundoff it started at.
    const materialEnd = plain.material.evaluate();
    expect(materialEnd.potentialEnergy).toBeGreaterThan(1e-6);
    expect(plain.contact.evaluate().potentialEnergy).toBeGreaterThan(1);

    // A free vertex moved, and the source buffer followed it.
    const free = plain.binding.particles[6]!;
    expect(Math.abs(free.position.data[3]! - 0.9)).toBeGreaterThan(1e-6);
    expect(plain.membraneComplex.positions[6 * 4 + 3]).toBe(free.position.data[3]);
    // The pinned vertices did not move.
    expect(plain.binding.particles[0]!.position.data[3]).toBe(0.9);

    // --- 7. and only now, the differential --------------------------------
    expect(digest(fast, 'fast')).toBe(digest(plain, 'plain'));
  });

  it('exercises both paired filters rather than only registering them', { timeout: 120_000 }, () => {
    const target = scene('filters', false);
    const particles = target.binding.particles;

    // The bending filter certifies a stationary segment and limits one that
    // reflects a vertex through its opposite edge.
    const before = particles.map((particle) => particle.position.clone());
    const still = target.bending.stepFilter.evaluateSegment({
      dimension: 4,
      requestedStepLength: 1,
      positionBefore: (particle) => before[particles.indexOf(particle)]!.clone(),
      positionAfter: (particle) => before[particles.indexOf(particle)]!.clone()
    });
    expect(still.status).toBe('safe');
    expect(still.cells.length).toBe(12);

    const reflected = before.map((point) => point.clone());
    const moving = 6;
    const anchor = before[5]!;
    for (let axis = 0; axis < 4; axis++) {
      reflected[moving]!.data[axis] =
        2 * anchor.data[axis]! - before[moving]!.data[axis]!;
    }
    const crossing = target.bending.stepFilter.evaluateSegment({
      dimension: 4,
      requestedStepLength: 1,
      positionBefore: (particle) => before[particles.indexOf(particle)]!.clone(),
      positionAfter: (particle) => reflected[particles.indexOf(particle)]!.clone()
    });
    expect(crossing.status).not.toBe('safe');
    expect(crossing.blockingCellIndex).not.toBe(null);

    // The contact filter reaches a real candidate on a segment aimed at the
    // floor, rather than reporting an empty query.
    const dropped = before.map((point) => {
      const next = point.clone();
      next.data[3] = 0.02;
      return next;
    });
    const contactSegment = target.contact.stepFilter.evaluate({
      dimension: 4,
      requestedStepLength: 1,
      positionBefore: (particle) => before[particles.indexOf(particle)]!.clone(),
      positionAfter: (particle) => dropped[particles.indexOf(particle)]!.clone()
    });
    expect(contactSegment.candidates.length).toBeGreaterThan(0);
    expect(['safe', 'limited', 'indeterminate']).toContain(contactSegment.status);
  });
});
