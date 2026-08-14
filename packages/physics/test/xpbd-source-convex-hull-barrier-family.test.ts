import { CellComplex, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdPotentialDomainErrorN,
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceConvexHullBarrierFamilyN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  evaluateClampedLogBarrier
} from '../src/index.js';

/**
 * Point-to-static-convex-hull contact.
 *
 * The property under test throughout is that the represented geometry is one
 * *set*, so the answer cannot depend on how that set was cut into cells. Every
 * fixture therefore describes a flat support whose correct normal force is
 * known in closed form, and places the probe over its relative interior but
 * away from any symmetry of the decomposition — a probe on a symmetry plane
 * would let a per-cell sum look correct by cancellation.
 */

const BARRIER = {
  minimumDistance: 0.04,
  activationDistance: 1.2,
  stiffness: 3
} as const;

/** A flat axis-aligned box support at `x[dim-1] = 0`, spanning `[0,1]^(dim-1)`. */
function flatSupport(dim: number): {
  obstacle: CellComplex;
  group: CellComplex['groups'][number];
} {
  const flatDim = dim - 1;
  const positions: number[] = [];
  for (let corner = 0; corner < 2 ** flatDim; corner++) {
    for (let axis = 0; axis < flatDim; axis++) {
      positions.push((corner >> axis) & 1 ? 1 : 0);
    }
    positions.push(0);
  }
  // A fan of simplices over the corner set. Only the vertex set defines the
  // hull; the cells exist so decomposition can be varied independently.
  const indices: number[] = [];
  const corners = 2 ** flatDim;
  for (let start = 1; start + dim - 2 < corners; start++) {
    const cell = [0];
    for (let offset = 0; offset < dim - 1; offset++) {
      cell.push(((start + offset - 1) % (corners - 1)) + 1);
    }
    if (new Set(cell).size === dim) indices.push(...cell);
  }
  const obstacle = new CellComplex(dim, Float64Array.from(positions), [{
    key: 'support', dim: flatDim, verticesPerCell: dim, kind: 'simplex',
    indices: Uint32Array.from(indices)
  }]);
  return { obstacle, group: obstacle.groups[0]! };
}

/** Binds one probe particle at `position`. */
function probe(dim: number, position: readonly number[], id: string) {
  const body = new CellComplex(dim, Float64Array.from(position), [{
    key: 'probe', dim: 0, verticesPerCell: 1, kind: 'simplex',
    indices: Uint32Array.from([0])
  }]);
  const world = new XpbdWorldN({
    dimension: dim, gravity: new Array<number>(dim).fill(0)
  });
  const binding = compileXpbdParticleBindingN({
    source: body, id: `${id}-probe`, mass: 1
  });
  return { world, binding, body };
}

/** The whole family, compiled over a flat support with one probe above it. */
function scene(dim: number, position: readonly number[], id: string) {
  const { obstacle, group } = flatSupport(dim);
  const { world, binding, body } = probe(dim, position, id);
  const family = compileXpbdParticleSourceConvexHullBarrierFamilyN({
    id: `${id}-hull`, binding, obstacle, sourceGroup: group, ...BARRIER
  });
  return { obstacle, group, world, binding, body, family };
}

/** Analytic normal force for a probe above a flat support's interior. */
function analyticForce(dim: number, height: number): Float64Array {
  const barrier = evaluateClampedLogBarrier({
    coordinate: height - BARRIER.minimumDistance,
    activation: BARRIER.activationDistance - BARRIER.minimumDistance,
    stiffness: BARRIER.stiffness
  });
  const force = new Float64Array(dim);
  force[dim - 1] = -barrier.firstDerivative * Math.sign(height);
  return force;
}

function norm(values: ArrayLike<number>): number {
  let total = 0;
  for (let index = 0; index < values.length; index++) {
    total += values[index]! * values[index]!;
  }
  return Math.sqrt(total);
}

describe('convex-hull barrier: analytic distance, energy, force, and witness', () => {
  it('pushes along the support normal from over a flat support', () => {
    const height = 0.5;
    const { family } = scene(4, [0.37, 0.42, 0.47, height], 'analytic');
    const evaluation = family.evaluate();
    expect(evaluation.activeBarriers.length).toBe(1);

    const record = evaluation.activeBarriers[0]!;
    expect(record.distance).toBeCloseTo(height, 12);
    const expected = analyticForce(4, height);
    const force = evaluation.forces[0]!.data;
    expect(norm(force)).toBeGreaterThan(0);
    for (let axis = 0; axis < 4; axis++) {
      expect(force[axis]!).toBeCloseTo(expected[axis]!, 10);
    }
    // Tangential force over a flat support is exactly the artefact this
    // family exists to remove.
    const tangential = Math.hypot(force[0]!, force[1]!, force[2]!);
    expect(tangential / norm(force)).toBeLessThanOrEqual(1e-12);

    expect(record.witness.sourceVertices.length).toBeGreaterThan(0);
    for (const vertex of record.witness.sourceVertices) {
      expect(family.hullSourceVertices).toContain(vertex);
    }
    expect(record.witness.query.status).toBe('separated');
  });

  it('is exactly zero at and beyond the activation distance', () => {
    const { family } = scene(4, [0.4, 0.4, 0.4, BARRIER.activationDistance + 0.1], 'inactive');
    const evaluation = family.evaluate();
    expect(evaluation.activeBarriers.length).toBe(0);
    expect(evaluation.potentialEnergy).toBe(0);
    expect(norm(evaluation.forces[0]!.data)).toBe(0);
    // The query still ran: inactivity is a measured distance, not a skip.
    expect(evaluation.diagnostics.setQueries).toBe(1);
    expect(evaluation.diagnostics.activeParticles).toBe(0);
  });

  it('is two-sided for a lower-dimensional hull with no ambient interior', () => {
    // A flat support in R4 has no inside. Proximity is unsigned on both sides.
    const above = scene(4, [0.4, 0.4, 0.4, 0.5], 'above').family.evaluate();
    const below = scene(4, [0.4, 0.4, 0.4, -0.5], 'below').family.evaluate();
    expect(above.activeBarriers[0]!.distance).toBeCloseTo(0.5, 12);
    expect(below.activeBarriers[0]!.distance).toBeCloseTo(0.5, 12);
    // Equal magnitude, opposite direction: pushed away, not pulled through.
    expect(above.forces[0]!.data[3]!).toBeCloseTo(-below.forces[0]!.data[3]!, 10);
    expect(above.forces[0]!.data[3]!).toBeGreaterThan(0);
    expect(below.forces[0]!.data[3]!).toBeLessThan(0);
  });
});

describe('convex-hull barrier: dimension-generic behaviour', () => {
  it('meets the analytic oracle in R2 through R7', () => {
    for (let dim = 2; dim <= 7; dim++) {
      const height = 0.4;
      const position = Array.from(
        { length: dim }, (_, axis) => axis === dim - 1 ? height : 0.31 + axis * 0.07
      );
      const { family } = scene(dim, position, `r${dim}`);
      const evaluation = family.evaluate();
      expect(evaluation.activeBarriers.length, `R${dim} active`).toBe(1);

      const force = evaluation.forces[0]!.data;
      const expected = analyticForce(dim, height);
      expect(norm(force), `R${dim} force magnitude`).toBeGreaterThan(0);
      let tangentialSquared = 0;
      for (let axis = 0; axis < dim - 1; axis++) {
        tangentialSquared += force[axis]! * force[axis]!;
      }
      expect(
        Math.sqrt(tangentialSquared) / norm(force), `R${dim} lateral share`
      ).toBeLessThanOrEqual(1e-12);
      expect(force[dim - 1]!, `R${dim} normal force`)
        .toBeCloseTo(expected[dim - 1]!, 10);
      expect(evaluation.activeBarriers[0]!.distance, `R${dim} distance`)
        .toBeCloseTo(height, 12);
      // One query per particle in every dimension, never one per cell.
      expect(evaluation.diagnostics.setQueries, `R${dim} queries`).toBe(1);
    }
  });

  it('agrees with central differences on the energy gradient', () => {
    let compared = 0;
    let worst = 0;
    for (let dim = 2; dim <= 7; dim++) {
      const { obstacle, group } = flatSupport(dim);
      const energyAt = (position: readonly number[]): number => {
        const { binding } = probe(dim, position, `fd-${dim}-${position.join('_')}`);
        return compileXpbdParticleSourceConvexHullBarrierFamilyN({
          id: `fd-${dim}`, binding, obstacle, sourceGroup: group, ...BARRIER
        }).evaluate().potentialEnergy;
      };
      for (const offset of [-0.08, -0.03, 0.02, 0.06, 0.1]) {
        const position = Array.from(
          { length: dim },
          (_, axis) => axis === dim - 1 ? 0.4 + offset * 0.5 : 0.34 + axis * 0.06 + offset
        );
        const { binding } = probe(dim, position, `fda-${dim}-${offset}`);
        const analytic = compileXpbdParticleSourceConvexHullBarrierFamilyN({
          id: `fda-${dim}`, binding, obstacle, sourceGroup: group, ...BARRIER
        }).evaluate().forces[0]!.data;
        const scale = norm(analytic);
        expect(scale).toBeGreaterThan(1e-6);
        const h = 1e-6;
        for (let axis = 0; axis < dim; axis++) {
          const forward = position.slice();
          const backward = position.slice();
          forward[axis]! += h;
          backward[axis]! -= h;
          const numeric = -(energyAt(forward) - energyAt(backward)) / (2 * h);
          worst = Math.max(worst, Math.abs(numeric - analytic[axis]!) / scale);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThanOrEqual(120);
    expect(worst).toBeLessThanOrEqual(1e-7);
  });
});

describe('convex-hull barrier: the answer does not depend on the description', () => {
  const position = [0.37, 0.42, 0.47, 0.5] as const;

  function compiledWith(
    positions: Float64Array,
    cells: readonly (readonly number[])[],
    id: string
  ) {
    const obstacle = new CellComplex(4, positions, [{
      key: 'support', dim: 3, verticesPerCell: 4, kind: 'simplex',
      indices: Uint32Array.from(cells.flat())
    }]);
    const { binding } = probe(4, position, id);
    return compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id, binding, obstacle, sourceGroup: obstacle.groups[0]!, ...BARRIER
    });
  }

  it('agrees under decomposition, cell order, and storage permutation', () => {
    const base = flatSupport(4);
    const baseCells: number[][] = [];
    const perCell = base.group.verticesPerCell;
    for (let cell = 0; cell < base.group.indices.length / perCell; cell++) {
      baseCells.push(Array.from(
        base.group.indices.slice(cell * perCell, (cell + 1) * perCell)
      ));
    }
    const reference = compiledWith(
      base.obstacle.positions, baseCells, 'inv-reference'
    ).evaluate();

    // Reversed cell order.
    const reversed = compiledWith(
      base.obstacle.positions, [...baseCells].reverse(), 'inv-reversed'
    ).evaluate();

    // Permuted source-vertex storage with an explicit identity remap.
    const permutation = [5, 2, 7, 0, 6, 3, 1, 4];
    const permuted = new Float64Array(base.obstacle.positions.length);
    permutation.forEach((source, slot) => {
      for (let axis = 0; axis < 4; axis++) {
        permuted[slot * 4 + axis] = base.obstacle.positions[source * 4 + axis]!;
      }
    });
    const inverse = new Array<number>(permutation.length);
    permutation.forEach((source, slot) => { inverse[source] = slot; });
    const permutedFamily = compiledWith(
      permuted, baseCells.map((cell) => cell.map((vertex) => inverse[vertex]!)),
      'inv-permuted'
    );
    const permutedEvaluation = permutedFamily.evaluate();

    for (const [label, evaluation] of [
      ['reversed', reversed], ['permuted', permutedEvaluation]
    ] as const) {
      expect(evaluation.activeBarriers[0]!.distance, `${label}: distance`)
        .toBeCloseTo(reference.activeBarriers[0]!.distance, 12);
      expect(evaluation.potentialEnergy, `${label}: energy`)
        .toBeCloseTo(reference.potentialEnergy, 12);
      for (let axis = 0; axis < 4; axis++) {
        expect(evaluation.forces[0]!.data[axis]!, `${label}: force ${axis}`)
          .toBeCloseTo(reference.forces[0]!.data[axis]!, 10);
      }
    }

    // Feature IDs may differ under a source permutation, but each must resolve
    // to a genuine vertex of the permuted source.
    const permutedWitness = permutedEvaluation.activeBarriers[0]!.witness;
    expect(permutedWitness.sourceVertices.length).toBeGreaterThan(0);
    for (const vertex of permutedWitness.sourceVertices) {
      expect(permutedFamily.hullSourceVertices).toContain(vertex);
    }
  });

  it('does not let a strictly interior vertex become a hull witness', () => {
    const base = flatSupport(4);
    const perCell = base.group.verticesPerCell;
    const cells: number[][] = [];
    for (let cell = 0; cell < base.group.indices.length / perCell; cell++) {
      cells.push(Array.from(
        base.group.indices.slice(cell * perCell, (cell + 1) * perCell)
      ));
    }
    const extended = new Float64Array(base.obstacle.positions.length + 4);
    extended.set(base.obstacle.positions);
    const interior = base.obstacle.positions.length / 4;
    extended.set([0.5, 0.5, 0.5, 0], interior * 4);
    cells.push([interior, 0, 1, 2]);

    const family = compiledWith(extended, cells, 'inv-interior');
    const evaluation = family.evaluate();
    expect(family.hullSourceVertices).toContain(interior);
    expect(
      evaluation.activeBarriers[0]!.witness.sourceVertices,
      'a strictly interior vertex became a hull witness'
    ).not.toContain(interior);
  });

  it('refuses coincident hull vertices rather than picking one arbitrarily', () => {
    const positions = Float64Array.from([
      0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0,
      // A duplicate of vertex 0: the support tie has no unique source answer.
      0, 0, 0, 0
    ]);
    expect(() => compiledWith(
      positions, [[0, 1, 2, 3], [4, 1, 2, 3]], 'coincident'
    )).toThrow(/coincident/);
  });
});

describe('convex-hull barrier: refusals and rollback', () => {
  it('refuses a candidate at or inside the open boundary', () => {
    const { family } = scene(4, [0.4, 0.4, 0.4, BARRIER.minimumDistance], 'domain');
    let caught: unknown;
    try {
      family.evaluate();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(XpbdPotentialDomainErrorN);
    expect((caught as XpbdPotentialDomainErrorN).reason)
      .toBe('at-or-below-minimum-distance');
  });

  it('reports an undecided query separately from separation', () => {
    const { obstacle, group } = flatSupport(4);
    const { binding } = probe(4, [0.37, 0.42, 0.47, 0.5], 'indeterminate');
    const family = compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id: 'indeterminate', binding, obstacle, sourceGroup: group,
      ...BARRIER,
      // One iteration cannot certify a four-dimensional answer.
      maximumQueryIterations: 1
    });
    let caught: unknown;
    try {
      family.evaluate();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(XpbdPotentialDomainErrorN);
    // Not collapsed into separated, active, or a zero force.
    expect((caught as XpbdPotentialDomainErrorN).reason)
      .toBe('closest-point-indeterminate');
  });

  it('leaves particle state untouched on every refusing path', () => {
    const { family, binding } = scene(
      4, [0.4, 0.4, 0.4, BARRIER.minimumDistance], 'rollback'
    );
    const particle = binding.particles[0]!;
    const before = Array.from(particle.position.data);
    const velocityBefore = Array.from(particle.velocity.data);
    expect(() => family.evaluate()).toThrow(XpbdPotentialDomainErrorN);
    expect(Array.from(particle.position.data)).toEqual(before);
    expect(Array.from(particle.velocity.data)).toEqual(velocityBefore);
  });
});

describe('convex-hull barrier: static-source lifecycle', () => {
  it('refuses after the selected hull coordinates move', () => {
    const { family, obstacle } = scene(4, [0.4, 0.4, 0.4, 0.5], 'stale-coords');
    expect(family.evaluate().activeBarriers.length).toBe(1);
    obstacle.positions[0] = obstacle.positions[0]! - 0.25;
    expect(() => family.evaluate()).toThrow(/static convex set/);
    expect(() => family.queryPoint(new VecN(Float64Array.from([0.4, 0.4, 0.4, 0.5]))))
      .toThrow(/static convex set/);
  });

  it('refuses after the source group is removed', () => {
    const { family, obstacle, group } = scene(4, [0.4, 0.4, 0.4, 0.5], 'stale-group');
    expect(family.evaluate().activeBarriers.length).toBe(1);
    const index = obstacle.groups.indexOf(group);
    (obstacle.groups as unknown as unknown[]).splice(index, 1);
    expect(() => family.evaluate()).toThrow(/source group was removed/);
  });

  it('checks staleness at the filter boundary too', () => {
    const { family, obstacle, binding } = scene(4, [0.4, 0.4, 0.4, 0.5], 'stale-filter');
    const particle = binding.particles[0]!;
    obstacle.positions[1] = obstacle.positions[1]! + 0.3;
    expect(() => family.stepFilter.evaluate({
      dimension: 4,
      requestedStepLength: 1,
      positionBefore: () => particle.position.clone(),
      positionAfter: () => particle.position.clone()
    })).toThrow(/static convex set/);
  });
});

describe('convex-hull barrier: paired step filter', () => {
  function certify(
    dim: number,
    before: readonly number[],
    after: readonly number[],
    id: string
  ) {
    const { obstacle, group } = flatSupport(dim);
    const { binding } = probe(dim, before, id);
    const family = compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id, binding, obstacle, sourceGroup: group, ...BARRIER
    });
    return family.stepFilter.evaluate({
      dimension: dim,
      requestedStepLength: 1,
      positionBefore: () => new VecN(Float64Array.from(before)),
      positionAfter: () => new VecN(Float64Array.from(after))
    });
  }

  it('certifies a stationary segment in full', () => {
    const point = [0.4, 0.4, 0.4, 0.5];
    const result = certify(4, point, point, 'filter-stationary');
    expect(result.status).toBe('safe');
    expect(result.certifications[0]!.certification).toBe('stationary');
  });

  it('certifies a receding segment in full', () => {
    const result = certify(
      4, [0.4, 0.4, 0.4, 0.5], [0.4, 0.4, 0.4, 0.9], 'filter-receding'
    );
    expect(result.status).toBe('safe');
    expect(result.certifications[0]!.certification).toBe('convex-nondecreasing');
  });

  it('limits an approaching segment to a strict prefix', () => {
    const result = certify(
      4, [0.4, 0.4, 0.4, 0.6], [0.4, 0.4, 0.4, -0.6], 'filter-approach'
    );
    expect(result.status).toBe('limited');
    if (result.status !== 'limited') throw new Error('unreachable');
    expect(result.maximumStepLength).toBeLessThan(1);
    expect(result.maximumStepLength).toBeGreaterThan(0);
    expect(result.blockingSourceVertexIndex).toBe(0);
    expect(result.certifications[0]!.certification).toBe('global-lipschitz');
  });

  it('stops short of a crossing whose endpoints are both clear', () => {
    // Endpoint energy alone sees two perfectly legal configurations.
    const before = [0.4, 0.4, 0.4, 0.7];
    const after = [0.4, 0.4, 0.4, -0.7];
    const result = certify(4, before, after, 'filter-crossing');
    expect(result.status).toBe('limited');
    if (result.status !== 'limited') throw new Error('unreachable');

    // Independently sample the certified prefix: it must stay outside the
    // open boundary for its whole length.
    const { obstacle, group } = flatSupport(4);
    const { binding } = probe(4, before, 'filter-crossing-probe');
    const family = compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id: 'filter-crossing-check', binding, obstacle, sourceGroup: group, ...BARRIER
    });
    let least = Number.POSITIVE_INFINITY;
    for (let sample = 0; sample <= 512; sample++) {
      const t = (sample / 512) * result.maximumStepLength;
      const point = before.map((value, axis) => value + t * (after[axis]! - value));
      least = Math.min(least, family.queryPoint(new VecN(Float64Array.from(point))).distance);
    }
    expect(least).toBeGreaterThan(BARRIER.minimumDistance);
  });

  it('refuses when the segment starts inside the open boundary', () => {
    const result = certify(
      4, [0.4, 0.4, 0.4, 0.01], [0.4, 0.4, 0.4, 0.5], 'filter-initial'
    );
    expect(result.status).toBe('indeterminate');
    if (result.status !== 'indeterminate') throw new Error('unreachable');
    expect(result.reason).toBe('initial-domain-violation');
    expect(result.certifications[0]!.certification).toBe('initial-domain-violation');
  });

  it('reports an undecided query as its own refusal', () => {
    const { obstacle, group } = flatSupport(4);
    const before = [0.4, 0.4, 0.4, 0.5];
    const { binding } = probe(4, before, 'filter-undecided');
    const family = compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id: 'filter-undecided', binding, obstacle, sourceGroup: group,
      ...BARRIER, maximumQueryIterations: 1
    });
    const result = family.stepFilter.evaluate({
      dimension: 4,
      requestedStepLength: 1,
      positionBefore: () => new VecN(Float64Array.from(before)),
      positionAfter: () => new VecN(Float64Array.from([0.4, 0.4, 0.4, 0.2]))
    });
    expect(result.status).toBe('indeterminate');
    if (result.status !== 'indeterminate') throw new Error('unreachable');
    expect(result.reason).toBe('closest-point-indeterminate');
  });

  it('never certifies a prefix the segment does not keep clear, R2 through R7', () => {
    let checked = 0;
    let undecidedSamples = 0;
    let sampled = 0;
    for (let dim = 2; dim <= 7; dim++) {
      const { obstacle, group } = flatSupport(dim);
      let state = 91125 + dim * 7717;
      const next = (): number => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
      };
      for (let trial = 0; trial < 16; trial++) {
        const before: number[] = [];
        const after: number[] = [];
        for (let axis = 0; axis < dim; axis++) {
          before.push(axis === dim - 1 ? 0.3 + next() * 1.1 : -0.4 + next() * 1.8);
          after.push(before[axis]! + (next() - 0.5) * 2.2);
        }
        const { binding } = probe(dim, before, `seeded-${dim}-${trial}`);
        const family = compileXpbdParticleSourceConvexHullBarrierFamilyN({
          id: `seeded-${dim}-${trial}`, binding, obstacle,
          sourceGroup: group, ...BARRIER
        });
        const result = family.stepFilter.evaluate({
          dimension: dim,
          requestedStepLength: 1,
          positionBefore: () => new VecN(Float64Array.from(before)),
          positionAfter: () => new VecN(Float64Array.from(after))
        });
        if (result.status === 'indeterminate') continue;
        checked++;
        for (let sample = 0; sample <= 256; sample++) {
          const t = (sample / 256) * result.maximumStepLength;
          const point = before.map(
            (value, axis) => value + t * (after[axis]! - value)
          );
          sampled++;
          let distance: number;
          try {
            distance = family.queryPoint(new VecN(Float64Array.from(point))).distance;
          } catch (error) {
            // A refusal to decide is a legitimate answer and is counted, not
            // swallowed. See the near-tie limitation pinned below: the query
            // still has to refuse rather than guess.
            expect(error).toBeInstanceOf(XpbdPotentialDomainErrorN);
            expect((error as XpbdPotentialDomainErrorN).reason)
              .toBe('closest-point-indeterminate');
            undecidedSamples++;
            continue;
          }
          expect(distance, `R${dim} trial ${trial} sample ${sample}`)
            .toBeGreaterThan(BARRIER.minimumDistance);
        }
      }
    }
    expect(checked).toBeGreaterThan(60);
    // The certified-prefix property is what this test is for, so the sampling
    // has to be overwhelmingly decided or it is checking almost nothing.
    expect(sampled).toBeGreaterThan(10_000);
    expect(undecidedSamples / sampled).toBeLessThan(0.01);
  });
});

describe('convex-hull barrier: construction contract', () => {
  it('rejects unknown options', () => {
    const { obstacle, group } = flatSupport(4);
    const { binding } = probe(4, [0.4, 0.4, 0.4, 0.5], 'unknown');
    expect(() => compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id: 'unknown', binding, obstacle, sourceGroup: group, ...BARRIER,
      simplexGroup: group
    } as never)).toThrow(/unknown option "simplexGroup"/);
  });

  it('rejects a mismatched dimension, a shared source, and a foreign group', () => {
    const { obstacle, group } = flatSupport(4);
    const { binding } = probe(4, [0.4, 0.4, 0.4, 0.5], 'contract');
    const other = flatSupport(4);

    expect(() => compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id: 'foreign', binding, obstacle, sourceGroup: other.group, ...BARRIER
    })).toThrow(/sourceGroup must belong to obstacle/);

    const wrongDim = flatSupport(3);
    expect(() => compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id: 'dim', binding, obstacle: wrongDim.obstacle,
      sourceGroup: wrongDim.group, ...BARRIER
    })).toThrow(/binding is R4, obstacle is R3/);

    const selfBinding = compileXpbdParticleBindingN({
      world: new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, 0] }),
      source: obstacle, id: 'self', mass: 1
    });
    expect(() => compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id: 'self', binding: selfBinding, obstacle, sourceGroup: group, ...BARRIER
    })).toThrow(/must be separate from the dynamic source/);

    expect(() => compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id: 'activation', binding, obstacle, sourceGroup: group,
      minimumDistance: 0.5, activationDistance: 0.5, stiffness: 3
    })).toThrow(/activationDistance must be finite and greater/);
  });

  it('retains sorted unique authoritative source vertices', () => {
    const { family, group } = scene(4, [0.4, 0.4, 0.4, 0.5], 'retain');
    const expected = Array.from(new Set(Array.from(group.indices)))
      .sort((a, b) => a - b);
    expect(Array.from(family.hullSourceVertices)).toEqual(expected);
    // Sorted, unique, and inside the obstacle.
    for (let index = 1; index < family.hullSourceVertices.length; index++) {
      expect(family.hullSourceVertices[index]!)
        .toBeGreaterThan(family.hullSourceVertices[index - 1]!);
    }
  });

  it('produces exactly one barrier contribution per particle', () => {
    // Three probes, all inside the band, over a support cut into many cells.
    const { obstacle, group } = flatSupport(4);
    const positions = [
      0.3, 0.3, 0.3, 0.5,
      0.6, 0.4, 0.5, 0.4,
      0.45, 0.7, 0.35, 0.6
    ];
    const body = new CellComplex(4, Float64Array.from(positions), [{
      key: 'probes', dim: 0, verticesPerCell: 1, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 2])
    }]);
    const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, 0] });
    const binding = compileXpbdParticleBindingN({
    source: body, id: 'many-probes', mass: 1
    });
    const family = compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id: 'many', binding, obstacle, sourceGroup: group, ...BARRIER
    });
    const evaluation = family.evaluate();
    expect(evaluation.diagnostics.sourceVertexCount).toBe(3);
    expect(evaluation.diagnostics.setQueries).toBe(3);
    expect(evaluation.activeBarriers.length).toBe(3);
    // One record per source vertex, each appearing once.
    const seen = evaluation.activeBarriers.map((record) => record.sourceVertexIndex);
    expect(seen).toEqual([0, 1, 2]);
    expect(new Set(seen).size).toBe(3);
    // Cell count is large; contributions are not.
    expect(group.indices.length / group.verticesPerCell).toBeGreaterThan(3);
  });
});

describe('convex-hull barrier: the once-pinned distance-query limitation', () => {
  /**
   * P53 pinned a `gjkDistance` termination failure here: probes whose two
   * coordinates were nearly-but-not-exactly tied stalled at the iteration
   * limit, and this family refused them as `closest-point-indeterminate`.
   * The original test said a slice that repaired the query's termination
   * should delete it — P53b is that slice. The same probes now decide with
   * the support-gap certificate, so the assertions are inverted: the family
   * must evaluate them, at the analytic distance, with one query each.
   */
  function hullFamily(position: readonly number[], id: string) {
    const { obstacle, group } = flatSupport(4);
    const { binding } = probe(4, position, id);
    return compileXpbdParticleSourceConvexHullBarrierFamilyN({
      id, binding, obstacle, sourceGroup: group, ...BARRIER
    });
  }

  it('decides the near-tie band that used to refuse', () => {
    const base = 0.618483421044642045;
    for (const gap of [1e-10, 1e-9, 1e-8, 2.5e-7]) {
      const position = [0.468806433725538929, base, base + gap, 0.9];
      const family = hullFamily(position, `band-${gap}`);
      const witness = family.queryPoint(new VecN(Float64Array.from(position)));
      expect(witness.query.status, `gap ${gap}`).toBe('separated');
      expect(witness.distance, `gap ${gap}`).toBeCloseTo(position[3]!, 11);
      expect(witness.sourceVertices.length).toBeGreaterThan(0);
    }
  });

  it('still decides both sides of the once-stalling band', () => {
    const base = 0.618483421044642045;
    for (const gap of [0, 1e-12, 1e-6, 1e-3]) {
      const position = [0.468806433725538929, base, base + gap, 0.9];
      const family = hullFamily(position, `edge-${gap}`);
      const witness = family.queryPoint(new VecN(Float64Array.from(position)));
      expect(witness.query.status, `gap ${gap}`).toBe('separated');
      expect(witness.distance, `gap ${gap}`).toBeCloseTo(position[3]!, 12);
    }
  });
});

describe('convex-hull barrier: the simplex family is unchanged', () => {
  it('still sums per-cell barriers and still answers as it always did', () => {
    // The old family is correct for cells that are meaningful features. This
    // slice must not alter what it computes.
    const obstacle = new CellComplex(2, Float64Array.from([0, 0, 1, 0, 2, 0]), [{
      key: 'support', dim: 1, verticesPerCell: 2, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 1, 2])
    }]);
    const { binding } = probe(2, [0.5, 0.5], 'unchanged');
    const family = compileXpbdParticleSourceSimplexBarrierFamilyN({
      id: 'unchanged', binding, obstacle,
      simplexGroup: obstacle.groups[0]!, ...BARRIER,
      // The simplex family requires an explicit direction policy; the hull
      // family has no such option, so BARRIER stays shared and this call
      // authors the policy itself.
      maximumDirectionError: 2 ** -12
    });
    const evaluation = family.evaluate();
    // Two cells, two active barriers, and a tangential resultant: exactly the
    // documented sum-over-cells behaviour, pinned so this slice cannot drift it.
    expect(evaluation.activeCandidates.length).toBe(2);
    const force = evaluation.forces[0]!.data;
    expect(Math.abs(force[0]!) / norm(force)).toBeGreaterThan(0.2);
    expect(force[1]!).toBeGreaterThan(0);
  });
});
