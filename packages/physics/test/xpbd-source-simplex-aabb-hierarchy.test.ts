import { CellComplex, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdSourceSimplexAabbHierarchyN,
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  compileXpbdSourceSimplexAabbHierarchyN,
  diagnoseXpbdIncrementalPotentialStepN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdParticleSourceSimplexBarrierFamilyN
} from '../src/index.js';

/**
 * The hierarchy is a search change, never a semantics change, so almost every
 * test here is a differential: build the same scene twice, accelerate one, and
 * require the two to agree on identity, order, and every downstream decision.
 *
 * An agreement assertion is only worth as much as the work it compares, so each
 * differential also asserts that candidates were actually retained. Two paths
 * agree trivially on the empty set.
 */

/** Deterministic 32-bit generator; unseeded randomness is forbidden here. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return ((z ^ (z >>> 15)) >>> 0) / 0x100000000;
  };
}

function simplexMesh(
  ambientDim: number,
  origins: readonly (readonly number[])[]
): { complex: CellComplex; group: CellGroup } {
  const simplexDim = ambientDim - 1;
  const positions: number[] = [];
  const indices: number[] = [];
  origins.forEach((origin, cell) => {
    for (let vertex = 0; vertex <= simplexDim; vertex++) {
      const point = new Array<number>(ambientDim).fill(0);
      for (let axis = 0; axis < ambientDim; axis++) point[axis] = origin[axis] ?? 0;
      if (vertex > 0) point[(vertex - 1) % ambientDim]! += 0.7;
      positions.push(...point);
      indices.push(cell * (simplexDim + 1) + vertex);
    }
  });
  const group: CellGroup = {
    key: 'obstacle-simplices',
    dim: simplexDim,
    verticesPerCell: simplexDim + 1,
    kind: 'simplex',
    indices: Uint32Array.from(indices)
  };
  return {
    complex: new CellComplex(ambientDim, Float64Array.from(positions), [group]),
    group
  };
}

/** A lattice of separated simplices; large enough for pruning to be visible. */
function lattice(ambientDim: number, perAxis: number, spacing: number): {
  complex: CellComplex;
  group: CellGroup;
} {
  const origins: number[][] = [];
  const walk = (prefix: number[]): void => {
    if (prefix.length === ambientDim) { origins.push(prefix.slice()); return; }
    for (let step = 0; step < perAxis; step++) walk([...prefix, step * spacing]);
  };
  walk([]);
  return simplexMesh(ambientDim, origins);
}

interface Scene {
  world: XpbdWorldN;
  family: XpbdParticleSourceSimplexBarrierFamilyN;
  particles: readonly XpbdParticleN[];
}

/** The same scene twice, differing only in whether a hierarchy is selected. */
function scene(
  id: string,
  ambientDim: number,
  origins: readonly (readonly number[])[],
  dynamicPoints: readonly (readonly number[])[],
  accelerated: boolean,
  leafSize?: number
): Scene {
  const { complex, group } = simplexMesh(ambientDim, origins);
  const source = new CellComplex(
    ambientDim,
    Float64Array.from(dynamicPoints.flatMap((point) => {
      const filled = new Array<number>(ambientDim).fill(0);
      point.forEach((value, axis) => { filled[axis] = value; });
      return filled;
    })),
    []
  );
  const binding = compileXpbdParticleBindingN({ id: `${id}-dynamic`, source });
  const family = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: `${id}-contact`,
    binding,
    obstacle: complex,
    simplexGroup: group,
    minimumDistance: 0.05,
    activationDistance: 0.8,
    stiffness: 1.7,
    // This helper sweeps R2..R7, so the obstacle simplex dimension crosses
    // the exact/legacy boundary. The direction policy is required on the
    // exact 1..3 arm and rejected on the 4..17 fallback, so a
    // dimension-generic caller must branch — the visible cost of the
    // arm-dependent rule, and the reason the option is not silently ignored.
    ...(group.dim <= 3 ? { maximumDirectionError: 2 ** -12 } : {}),
    ...(accelerated
      ? {
        candidateHierarchy: compileXpbdSourceSimplexAabbHierarchyN({
          obstacle: complex,
          simplexGroup: group,
          ...(leafSize === undefined ? {} : { leafSize })
        })
      }
      : {})
  });
  const world = new XpbdWorldN({
    dimension: ambientDim,
    gravity: new Array<number>(ambientDim).fill(0).map((_, a) =>
      a === ambientDim - 1 ? -9.81 : 0)
  });
  binding.addToWorld(world);
  family.addToWorld(world);
  return { world, family, particles: world.particles };
}

const READ = (p: XpbdParticleN): VecN => p.position.clone();

describe('XpbdSourceSimplexAabbHierarchyN — construction', () => {
  it('is deterministic for equivalent sources', () => {
    const build = (): string => {
      const { complex, group } = lattice(4, 3, 4);
      const hierarchy = compileXpbdSourceSimplexAabbHierarchyN({
        obstacle: complex, simplexGroup: group, leafSize: 4
      });
      // A digest of the traversal shape: what each query box reaches.
      const random = seeded(0xabcdef);
      return Array.from({ length: 12 }, () => {
        const at = Array.from({ length: 4 }, () => random() * 10);
        const q = hierarchy.query({
          min: at.map((v) => v - 1), max: at.map((v) => v + 1)
        });
        return `${q.cellIndices.join(',')}|${q.diagnostics.visitedNodes}` +
          `|${q.diagnostics.visitedLeaves}|${q.diagnostics.testedSimplexBounds}`;
      }).join(';');
    };
    expect(build()).toBe(build());
  });

  it('returns source references in ascending obstacle-cell order', () => {
    const { complex, group } = lattice(4, 3, 4);
    const hierarchy = compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: complex, simplexGroup: group, leafSize: 2
    });
    const all = hierarchy.query({
      min: [-100, -100, -100, -100], max: [100, 100, 100, 100]
    });
    expect(all.cellIndices).toEqual(
      Array.from({ length: hierarchy.simplices.length }, (_, i) => i)
    );
    // Source references, not tree ordinals.
    all.simplices.forEach((simplex, at) => {
      expect(simplex).toBe(hierarchy.simplices[all.cellIndices[at]!]);
      expect(simplex.parent.cellIndex).toBe(all.cellIndices[at]);
    });
  });

  it('retains a simplex whose bound exactly touches the query', () => {
    const { complex, group } = simplexMesh(4, [[0, 0, 0, 0]]);
    const hierarchy = compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: complex, simplexGroup: group
    });
    // The simplex spans [0, 0.7] on axis 0; a box ending exactly at 0 touches.
    const touching = hierarchy.query({
      min: [-1, -1, -1, -1], max: [0, 1, 1, 1]
    });
    expect(touching.cellIndices).toEqual([0]);
    // Moving strictly clear of the padded bound separates it.
    const clear = hierarchy.query({
      min: [-1, -1, -1, -1], max: [-0.001, 1, 1, 1]
    });
    expect(clear.cellIndices).toEqual([]);
  });

  it('rejects a whole node on one separated axis', () => {
    const { complex, group } = simplexMesh(4, [
      [0, 0, 0, 0], [1, 0, 0, 0], [2, 0, 0, 0], [3, 0, 0, 0],
      [40, 0, 0, 0], [41, 0, 0, 0], [42, 0, 0, 0], [43, 0, 0, 0]
    ]);
    const hierarchy = compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: complex, simplexGroup: group, leafSize: 4
    });
    const near = hierarchy.query({
      min: [-1, -1, -1, -1], max: [4, 1, 1, 1]
    });
    expect(near.cellIndices).toEqual([0, 1, 2, 3]);
    // The far leaf's four bounds were never individually tested.
    expect(near.diagnostics.testedSimplexBounds).toBe(4);
    expect(near.diagnostics.totalSimplices).toBe(8);
  });

  it('builds a finite balanced tree when every centroid ties', () => {
    const { complex, group } = simplexMesh(
      4, Array.from({ length: 16 }, () => [0, 0, 0, 0])
    );
    const hierarchy = compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: complex, simplexGroup: group, leafSize: 2
    });
    const all = hierarchy.query({
      min: [-1, -1, -1, -1], max: [1, 1, 1, 1]
    });
    expect(all.cellIndices.length).toBe(16);
    // Nothing can be pruned, and the counts say so rather than hiding it.
    expect(all.diagnostics.testedSimplexBounds).toBe(16);
    expect(all.diagnostics.retainedSimplices).toBe(16);
  });

  it('accepts leaf sizes of one, the default, and more than the mesh', () => {
    const { complex, group } = lattice(4, 2, 5);
    const total = group.indices.length / group.verticesPerCell;
    for (const leafSize of [1, undefined, total * 4]) {
      const hierarchy = compileXpbdSourceSimplexAabbHierarchyN({
        obstacle: complex,
        simplexGroup: group,
        ...(leafSize === undefined ? {} : { leafSize })
      });
      expect(hierarchy.leafSize).toBe(leafSize ?? 8);
      const all = hierarchy.query({
        min: [-99, -99, -99, -99], max: [99, 99, 99, 99]
      });
      expect(all.cellIndices.length, `leafSize ${leafSize}`).toBe(total);
    }
  });

  it('rejects invalid construction and query input', () => {
    const { complex, group } = simplexMesh(4, [[0, 0, 0, 0]]);
    const ok = { obstacle: complex, simplexGroup: group };

    expect(() => compileXpbdSourceSimplexAabbHierarchyN(
      { ...ok, leafSize: 0 }
    )).toThrow(/leafSize must be a positive safe integer/);
    expect(() => compileXpbdSourceSimplexAabbHierarchyN(
      { ...ok, leafSize: 2.5 }
    )).toThrow(/leafSize/);
    expect(() => compileXpbdSourceSimplexAabbHierarchyN(
      { ...ok, unknown: 1 } as never
    )).toThrow(/unknown option "unknown"/);
    expect(() => compileXpbdSourceSimplexAabbHierarchyN(
      { obstacle: complex, simplexGroup: { ...group } }
    )).toThrow(/simplexGroup must belong to obstacle/);
    expect(() => compileXpbdSourceSimplexAabbHierarchyN(
      { obstacle: {} as never, simplexGroup: group }
    )).toThrow(/obstacle must be a CellComplex/);

    const hierarchy = compileXpbdSourceSimplexAabbHierarchyN(ok);
    expect(() => hierarchy.query({ min: [0, 0, 0], max: [1, 1, 1] }))
      .toThrow(/bounds must be R4/);
    expect(() => hierarchy.query({
      min: [0, 0, 0, Number.NaN], max: [1, 1, 1, 1]
    })).toThrow(/bounds must be finite/);
    expect(() => hierarchy.query({
      min: [2, 0, 0, 0], max: [1, 1, 1, 1]
    })).toThrow(/min exceeds max on axis 0/);
  });

  it('freezes returned evidence', () => {
    const { complex, group } = lattice(4, 2, 5);
    const hierarchy = compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: complex, simplexGroup: group
    });
    const query = hierarchy.query({
      min: [-99, -99, -99, -99], max: [99, 99, 99, 99]
    });
    expect(Object.isFrozen(query)).toBe(true);
    expect(Object.isFrozen(query.simplices)).toBe(true);
    expect(Object.isFrozen(query.cellIndices)).toBe(true);
    expect(Object.isFrozen(query.diagnostics)).toBe(true);
    expect(() => (query.cellIndices as number[]).push(99)).toThrow();
  });
});

describe('XpbdSourceSimplexAabbHierarchyN — static-source lifetime', () => {
  it('refuses a moved obstacle instead of answering from stale bounds', () => {
    const { complex, group } = simplexMesh(4, [[0, 0, 0, 0], [9, 0, 0, 0]]);
    const hierarchy = compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: complex, simplexGroup: group
    });
    const box = { min: [-1, -1, -1, -1], max: [1, 1, 1, 1] };

    // Liveness: the query works before the mutation, so the refusal below is
    // the mutation being caught and not a scene that never worked.
    expect(hierarchy.query(box).cellIndices).toEqual([0]);

    // Global vertex 4 is cell 1's first vertex; flat offset 4 * ambientDim.
    complex.positions[16] = 0.5; // drag the far simplex into the query box
    expect(() => hierarchy.query(box))
      .toThrow(/indexed obstacle moved — vertex 4 axis 0/);
    expect(() => hierarchy.query(box)).toThrow(/not rebuilt\s+automatically/);

    complex.positions[16] = 9;
    expect(hierarchy.query(box).cellIndices).toEqual([0]);
  });

  it('refuses a removed or relaid-out simplex group', () => {
    const { complex, group } = simplexMesh(4, [[0, 0, 0, 0], [9, 0, 0, 0]]);
    const hierarchy = compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: complex, simplexGroup: group
    });
    const box = { min: [-1, -1, -1, -1], max: [1, 1, 1, 1] };
    expect(hierarchy.query(box).cellIndices).toEqual([0]);

    const layout = group.indices;
    (group as { indices: Uint32Array }).indices = layout.slice(0, 4);
    expect(() => hierarchy.query(box)).toThrow(/simplex layout changed/);
    (group as { indices: Uint32Array }).indices = layout;

    complex.groups.length = 0;
    expect(() => hierarchy.query(box)).toThrow(/simplex group was removed/);
  });
});

describe('hierarchy-backed family — differential against exhaustive', () => {
  const ORIGINS = [
    [0, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [6, 0, 0, 0],
    [0, 3, 0, 0], [2, 3, 0, 0], [4, 3, 0, 0], [6, 3, 0, 0],
    [0, 0, 3, 0], [2, 0, 3, 0], [4, 0, 3, 0], [6, 0, 3, 0]
  ];
  // Each simplex lies in the hyperplane w = origin[3], spanning 0.7 on axes
  // 0..2. Standing off on w keeps every distance strictly inside
  // (minimumDistance, activationDistance) so `evaluate()` has a live barrier
  // rather than a domain refusal.
  const POINTS = [
    [0.2, 0.2, 0.2, 0.3], [4.2, 0.1, 0.1, 0.3], [2.1, 3.1, 0.1, 0.3]
  ];

  it('produces identical candidate identity and order at a point', () => {
    const plain = scene('plain', 4, ORIGINS, POINTS, false);
    const fast = scene('fast', 4, ORIGINS, POINTS, true, 2);

    const a = plain.family.queryAt(READ);
    const b = fast.family.queryAt(READ);
    const ids = (q: typeof a, from: string): string[] =>
      q.candidates.map((c) => c.id.replace(from, 'scene'));

    expect(ids(b, 'fast')).toEqual(ids(a, 'plain'));
    expect(a.candidates.length).toBeGreaterThan(0); // liveness
    expect(b.diagnostics.strategy).toBe('static-aabb-hierarchy');
    expect(a.diagnostics.strategy).toBe('exhaustive');
    expect(b.diagnostics.candidatePairs).toBe(a.diagnostics.candidatePairs);
    // The acceleration is real: fewer individual bounds reached.
    expect(b.diagnostics.hierarchy!.testedSimplexBounds)
      .toBeLessThan(a.diagnostics.possiblePairs);
    expect(a.diagnostics.hierarchy).toBeUndefined();
  });

  it('agrees on seeded random points and segments from R2 to R7', () => {
    for (let dim = 2; dim <= 7; dim++) {
      const origins = Array.from({ length: 24 }, (_, cell) => {
        const point = new Array<number>(dim).fill(0);
        point[cell % dim] = Math.floor(cell / dim) * 3;
        return point;
      });
      const random = seeded(0x51ce + dim);
      // Anchored on real simplex origins with a standoff on the last axis, so
      // every scene has candidates to disagree about.
      const points = Array.from({ length: 4 }, (_, index) => {
        const origin = origins[(index * 5) % origins.length]!;
        return origin.map((value, axis) =>
          axis === dim - 1 ? value + 0.3 : value + 0.2);
      });

      const plain = scene(`plain${dim}`, dim, origins, points, false);
      const fast = scene(`fast${dim}`, dim, origins, points, true, 3);

      // The unshifted state is a guaranteed-live query; the shifted trials
      // vary the box without wandering off the mesh, which is how an earlier
      // draft of this test reached R6 with nothing retained and still passed.
      let retained = plain.family.queryAt(READ).candidates.length;
      expect(fast.family.queryAt(READ).candidates.map(
        (c) => c.id.replace(`fast${dim}`, 'scene')
      )).toEqual(plain.family.queryAt(READ).candidates.map(
        (c) => c.id.replace(`plain${dim}`, 'scene')
      ));
      for (let trial = 0; trial < 8; trial++) {
        const shift = Array.from({ length: dim }, () => random() * 0.7 - 0.35);
        const before = (p: XpbdParticleN): VecN => {
          const v = p.position.clone();
          for (let a = 0; a < dim; a++) v.data[a]! += shift[a]!;
          return v;
        };
        const after = (p: XpbdParticleN): VecN => {
          const v = before(p);
          for (let a = 0; a < dim; a++) v.data[a]! += shift[(a + 1) % dim]! * 0.5;
          return v;
        };
        const context = {
          dimension: dim, requestedStepLength: 1,
          positionBefore: before, positionAfter: after
        };
        const a = plain.family.stepFilter.evaluate(context);
        const b = fast.family.stepFilter.evaluate(context);
        const ids = (q: typeof a, from: string): string[] =>
          q.candidates.map((c) => c.candidate.id.replace(from, 'scene'));

        expect(ids(b, `fast${dim}`), `R${dim} segment ${trial}`)
          .toEqual(ids(a, `plain${dim}`));
        expect(b.status).toBe(a.status);
        expect(b.blockingCandidateId?.replace(`fast${dim}`, 'scene'))
          .toBe(a.blockingCandidateId?.replace(`plain${dim}`, 'scene'));
        if (a.status !== 'indeterminate' && b.status !== 'indeterminate') {
          expect(b.maximumStepLength).toBe(a.maximumStepLength);
        }
        retained += a.candidates.length;

        // Point queries too, at the shifted state.
        const pa = plain.family.queryAt(before);
        const pb = fast.family.queryAt(before);
        expect(pb.candidates.map((c) => c.id.replace(`fast${dim}`, 'scene')))
          .toEqual(pa.candidates.map((c) => c.id.replace(`plain${dim}`, 'scene')));
        retained += pa.candidates.length;
      }
      expect(retained, `R${dim} retained nothing`).toBeGreaterThan(0);
    }
  });

  it('never rejects a pair that is active anywhere on the segment', () => {
    // Dense sampling of every pair the hierarchy did not retain: if any sampled
    // point is within the activation distance, the rejection was unsound.
    const plain = scene('plain', 4, ORIGINS, POINTS, false);
    const fast = scene('fast', 4, ORIGINS, POINTS, true, 2);
    const random = seeded(0xd15ea5e);
    let checkedRejections = 0;
    let liveRetentions = 0;

    for (let trial = 0; trial < 6; trial++) {
      const shift = Array.from({ length: 4 }, () => random() * 5 - 1);
      const before = (p: XpbdParticleN): VecN => {
        const v = p.position.clone();
        for (let a = 0; a < 4; a++) v.data[a]! += shift[a]!;
        return v;
      };
      const after = (p: XpbdParticleN): VecN => {
        const v = before(p);
        v.data[1]! += 2.5;
        return v;
      };
      const context = {
        dimension: 4, requestedStepLength: 1,
        positionBefore: before, positionAfter: after
      };
      const accelerated = fast.family.stepFilter.evaluate(context);
      const kept = new Set(accelerated.candidates.map(
        (c) => `${c.candidate.sourceVertexIndex}/${c.candidate.obstacleCellIndex}`
      ));
      liveRetentions += kept.size;

      const simplices = fast.family.simplices;
      for (let vertex = 0; vertex < fast.particles.length; vertex++) {
        const start = before(fast.particles[vertex]!);
        const end = after(fast.particles[vertex]!);
        for (let cell = 0; cell < simplices.length; cell++) {
          if (kept.has(`${vertex}/${cell}`)) continue;
          checkedRejections++;
          const reference = simplices[cell]!;
          for (let sample = 0; sample <= 64; sample++) {
            const t = sample / 64;
            for (const vertexIndex of reference.vertexIndices) {
              const corner = reference.complex.getPosition(vertexIndex);
              let squared = 0;
              for (let axis = 0; axis < 4; axis++) {
                const at = start.data[axis]! +
                  t * (end.data[axis]! - start.data[axis]!);
                const delta = at - corner[axis]!;
                squared += delta * delta;
              }
              // A rejected pair must stay strictly outside activation at every
              // sampled point, measured against the simplex's own vertices.
              expect(Math.sqrt(squared),
                `rejected pair ${vertex}/${cell} was active`)
                .toBeGreaterThan(fast.family.activationDistance);
            }
          }
        }
      }
    }
    // Liveness witnesses: rejections were checked, and retention happened.
    expect(checkedRejections).toBeGreaterThan(0);
    expect(liveRetentions).toBeGreaterThan(0);
  });

  it('agrees on energy, forces, and active-candidate identity', () => {
    const plain = scene('plain', 4, ORIGINS, POINTS, false);
    const fast = scene('fast', 4, ORIGINS, POINTS, true, 2);
    const a = plain.family.evaluate();
    const b = fast.family.evaluate();

    // Bitwise: the same ordered arithmetic over the same ordered candidates.
    expect(b.potentialEnergy).toBe(a.potentialEnergy);
    expect(b.forces.map((f) => Array.from(f.data)))
      .toEqual(a.forces.map((f) => Array.from(f.data)));
    expect(b.activeCandidates.map((c) => c.candidate.id.replace('fast', 'scene')))
      .toEqual(a.activeCandidates.map((c) => c.candidate.id.replace('plain', 'scene')));
    expect(a.activeCandidates.length).toBeGreaterThan(0); // liveness
    expect(b.activeCandidates.map((c) => c.evaluation.distance))
      .toEqual(a.activeCandidates.map((c) => c.evaluation.distance));
  });

  it('reaches the same P46 world-step terminal and final state', () => {
    const points = [[0.25, 0.25, 0.25, 0.06]];
    const plain = scene('plain', 4, ORIGINS, points, false);
    const fast = scene('fast', 4, ORIGINS, points, true, 2);
    for (const target of [plain, fast]) {
      for (const particle of target.particles) particle.velocity.data[3] = -6;
    }
    const options = {
      deltaTime: 1 / 120,
      warmStart: 'feasible-inertial-prediction' as const,
      minimization: { directionPolicy: 'steepest-descent' as const }
    };

    const a = stepXpbdIncrementalPotentialWorldN({
      world: plain.world, stepFilters: [plain.family.stepFilter], ...options
    });
    const b = stepXpbdIncrementalPotentialWorldN({
      world: fast.world, stepFilters: [fast.family.stepFilter], ...options
    });

    expect(b.step.status).toBe(a.step.status);
    expect(a.step.status).toBe('applied'); // liveness
    expect(b.diagnosis.condition).toBe(a.diagnosis.condition);
    expect(b.step.minimization.status).toBe(a.step.minimization.status);
    expect(b.step.progress.acceptedIterations)
      .toBe(a.step.progress.acceptedIterations);
    expect(b.step.progress.displacementNorm)
      .toBe(a.step.progress.displacementNorm);
    expect(b.step.feasibleBaseRecovery?.status)
      .toBe(a.step.feasibleBaseRecovery?.status);
    expect(fast.particles.map((p) => Array.from(p.position.data)))
      .toEqual(plain.particles.map((p) => Array.from(p.position.data)));
    expect(fast.particles.map((p) => Array.from(p.velocity.data)))
      .toEqual(plain.particles.map((p) => Array.from(p.velocity.data)));
    expect(diagnoseXpbdIncrementalPotentialStepN(b.step).condition)
      .toBe(diagnoseXpbdIncrementalPotentialStepN(a.step).condition);
  });

  it('reduces bound tests on a separated mesh and admits its worst case', () => {
    const separated = lattice(4, 4, 6);
    const total = separated.group.indices.length / separated.group.verticesPerCell;
    expect(total).toBe(256);
    const hierarchy = compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: separated.complex, simplexGroup: separated.group
    });
    const local = hierarchy.query({
      min: [-0.5, -0.5, -0.5, -0.5], max: [1.5, 1.5, 1.5, 1.5]
    });
    expect(local.diagnostics.testedSimplexBounds).toBeLessThan(total / 2);
    expect(local.diagnostics.retainedSimplices).toBeGreaterThan(0);

    // The same code on an obstacle it cannot separate reports ratio 1.
    const stacked = simplexMesh(4, Array.from({ length: 32 }, () => [0, 0, 0, 0]));
    const dense = compileXpbdSourceSimplexAabbHierarchyN({
      obstacle: stacked.complex, simplexGroup: stacked.group
    });
    const all = dense.query({ min: [-1, -1, -1, -1], max: [1, 1, 1, 1] });
    expect(all.diagnostics.testedSimplexBounds).toBe(32);
    expect(all.diagnostics.retainedSimplices).toBe(32);
  });
});

describe('hierarchy-backed family — binding refusals', () => {
  it('refuses a hierarchy over a different obstacle or group', () => {
    const a = simplexMesh(4, [[0, 0, 0, 0]]);
    const b = simplexMesh(4, [[0, 0, 0, 0]]);
    const source = new CellComplex(4, Float64Array.from([0.2, 0.2, 0.2, 0.2]), []);
    const binding = compileXpbdParticleBindingN({ id: 'dynamic', source });
    const base = {
      id: 'contact', binding, obstacle: a.complex, simplexGroup: a.group,
      minimumDistance: 0.05, activationDistance: 0.8, stiffness: 1
    };

    // Structurally identical, different source: not interchangeable.
    expect(() => compileXpbdParticleSourceSimplexBarrierFamilyN({
      maximumDirectionError: 2 ** -12,
      ...base,
      candidateHierarchy: compileXpbdSourceSimplexAabbHierarchyN({
        obstacle: b.complex, simplexGroup: b.group
      })
    })).toThrow(/candidateHierarchy indexes a different obstacle/);

    expect(() => compileXpbdParticleSourceSimplexBarrierFamilyN({
      maximumDirectionError: 2 ** -12,
      ...base, candidateHierarchy: {} as never
    })).toThrow(/must be an XpbdSourceSimplexAabbHierarchyN/);

    // And the matching one compiles.
    const family = compileXpbdParticleSourceSimplexBarrierFamilyN({
      maximumDirectionError: 2 ** -12,
      ...base,
      candidateHierarchy: compileXpbdSourceSimplexAabbHierarchyN({
        obstacle: a.complex, simplexGroup: a.group
      })
    });
    expect(family.candidateHierarchy).toBeInstanceOf(XpbdSourceSimplexAabbHierarchyN);
  });

  it('refuses a stale obstacle before returning candidates', () => {
    const { complex, group } = simplexMesh(4, [[0, 0, 0, 0], [9, 0, 0, 0]]);
    const source = new CellComplex(4, Float64Array.from([0.2, 0.2, 0.2, 0.2]), []);
    const binding = compileXpbdParticleBindingN({ id: 'dynamic', source });
    const family = compileXpbdParticleSourceSimplexBarrierFamilyN({
      maximumDirectionError: 2 ** -12,
      id: 'contact', binding, obstacle: complex, simplexGroup: group,
      minimumDistance: 0.05, activationDistance: 0.8, stiffness: 1,
      candidateHierarchy: compileXpbdSourceSimplexAabbHierarchyN({
        obstacle: complex, simplexGroup: group
      })
    });
    // Liveness before the mutation.
    expect(family.queryAt(READ).candidates.length).toBeGreaterThan(0);

    complex.positions[16] = 0.4;
    expect(() => family.queryAt(READ)).toThrow(/indexed obstacle moved/);
    expect(() => family.evaluate()).toThrow(/indexed obstacle moved/);
  });

  it('leaves the exhaustive default byte-identical when none is selected', () => {
    const plain = scene('plain', 4, [[0, 0, 0, 0], [2, 0, 0, 0]],
      [[0.2, 0.2, 0.2, 0.2]], false);
    const query = plain.family.queryAt(READ);
    expect(plain.family.candidateHierarchy).toBe(null);
    expect(query.diagnostics.provider).toBe('exhaustive-swept-aabb');
    expect(query.diagnostics.strategy).toBe('exhaustive');
    expect(query.diagnostics.hierarchy).toBeUndefined();
    expect(query.candidates.length).toBeGreaterThan(0);
  });
});
