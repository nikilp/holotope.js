import { CellComplex, MatN, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdPotentialDomainErrorN,
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexCosineBendingFamilyN,
  evaluateSimplexHingeCosineN,
  minimizeXpbdIncrementalPotentialN,
  compileXpbdIncrementalPotentialProblemN,
  stepXpbdIncrementalPotentialWorldN,
  xpbdNewtonDirectionPolicyN,
  type SimplexHingeCosineEvaluationN,
  type XpbdSourceSimplexCosineBendingFamilyN
} from '../src/index.js';

/**
 * The P48 measurement is the oracle for this slice, so these tests port its
 * assertions at its tolerances rather than restating the derivation.
 *
 * Every differential asserts liveness first. A hinge count of zero, an energy
 * of zero, or a world step that never moved would let an agreement assertion
 * pass while comparing nothing.
 */

/** Seeded 32-bit generator; unseeded randomness is forbidden here. */
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

function orthogonal(dim: number, random: () => number): MatN {
  const columns: Float64Array[] = [];
  while (columns.length < dim) {
    const candidate = Float64Array.from({ length: dim }, () => random() * 2 - 1);
    for (const q of columns) {
      let dot = 0;
      for (let axis = 0; axis < dim; axis++) dot += q[axis]! * candidate[axis]!;
      for (let axis = 0; axis < dim; axis++) candidate[axis]! -= dot * q[axis]!;
    }
    const norm = Math.hypot(...candidate);
    if (norm < 1e-6) continue;
    for (let axis = 0; axis < dim; axis++) candidate[axis]! /= norm;
    columns.push(candidate);
  }
  const matrix = new MatN(dim);
  for (let row = 0; row < dim; row++) {
    for (let column = 0; column < dim; column++) {
      matrix.data[row * dim + column] = columns[column]![row]!;
    }
  }
  return matrix;
}

function turn(matrix: MatN, point: VecN): VecN {
  const dim = point.dim;
  const out = new VecN(dim);
  for (let row = 0; row < dim; row++) {
    let total = 0;
    for (let column = 0; column < dim; column++) {
      total += matrix.data[row * dim + column]! * point.data[column]!;
    }
    out.data[row] = total;
  }
  return out;
}

function vec(dim: number, ...values: number[]): VecN {
  const out = new VecN(dim);
  values.forEach((value, axis) => { out.data[axis] = value; });
  return out;
}

/** A `d`-simplex hinge in R^dim, folded by `angle` from flat. */
function foldedHinge(dim: number, simplexDim: number, angle: number): {
  sharedFace: VecN[];
  oppositeA: VecN;
  oppositeB: VecN;
} {
  const sharedFace: VecN[] = [vec(dim)];
  for (let index = 1; index < simplexDim; index++) {
    const point = new VecN(dim);
    point.data[index] = 1;
    sharedFace.push(point);
  }
  const oppositeA = vec(dim, -1);
  const oppositeB = new VecN(dim);
  oppositeB.data[0] = Math.cos(angle);
  oppositeB.data[simplexDim] = Math.sin(angle);
  return { sharedFace, oppositeA, oppositeB };
}

function evaluated(
  result: ReturnType<typeof evaluateSimplexHingeCosineN>
): SimplexHingeCosineEvaluationN {
  if (result.status === 'refused') {
    throw new Error(`unexpected refusal: ${result.reason}`);
  }
  return result;
}

describe('evaluateSimplexHingeCosineN — coordinate', () => {
  it('is the cosine of the fold and matches the R3 dihedral', () => {
    let worst = 0;
    for (const degrees of [0, 15, 30, 45, 60, 90, 120, 150]) {
      const angle = (degrees * Math.PI) / 180;
      const scene = foldedHinge(3, 2, angle);
      const geometry = evaluated(evaluateSimplexHingeCosineN(scene));
      // c = cos(fold), and the conventional interior dihedral is pi - fold.
      worst = Math.max(
        worst,
        Math.abs(geometry.coordinate - Math.cos(angle)),
        Math.abs(-geometry.coordinate - Math.cos(Math.PI - angle))
      );
    }
    expect(worst).toBeLessThan(1e-14);
  });

  it('is invariant across R2–R7 under every symmetry the docs claim', () => {
    const random = seeded(0xb00c);
    for (const [dim, simplexDim] of [[2, 1], [3, 2], [4, 3], [5, 3], [7, 4]] as const) {
      const base = foldedHinge(dim, simplexDim, 0.7);
      const reference = evaluated(evaluateSimplexHingeCosineN(base)).coordinate;
      expect(Math.abs(reference), `R${dim} is not folded`).toBeLessThan(1);

      // Face permutation, including the origin choice f0.
      for (let rotation = 0; rotation < base.sharedFace.length; rotation++) {
        const permuted = base.sharedFace.map((_, index) =>
          base.sharedFace[(index + rotation) % base.sharedFace.length]!);
        expect(evaluated(evaluateSimplexHingeCosineN({
          ...base, sharedFace: permuted
        })).coordinate, `R${dim} permutation ${rotation}`)
          .toBeCloseTo(reference, 12);
      }

      // Apex swap: the coordinate is unsigned.
      expect(evaluated(evaluateSimplexHingeCosineN({
        sharedFace: base.sharedFace,
        oppositeA: base.oppositeB,
        oppositeB: base.oppositeA
      })).coordinate).toBeCloseTo(reference, 12);

      const shift = Float64Array.from({ length: dim }, () => random() * 4 - 2);
      const move = (p: VecN): VecN =>
        new VecN(Float64Array.from(p.data, (v, axis) => v + shift[axis]!));
      const rotation = orthogonal(dim, random);
      const scale = (p: VecN): VecN =>
        new VecN(Float64Array.from(p.data, (v) => v * 3.75));
      for (const [label, map] of [
        ['translation', move],
        ['rotation', (p: VecN) => turn(rotation, p)],
        ['scale', scale]
      ] as const) {
        expect(evaluated(evaluateSimplexHingeCosineN({
          sharedFace: base.sharedFace.map(map),
          oppositeA: map(base.oppositeA),
          oppositeB: map(base.oppositeB)
        })).coordinate, `R${dim} ${label}`).toBeCloseTo(reference, 12);
      }
    }
  });

  it('is unchanged by embedding the same hinge in a higher ambient dimension', () => {
    const random = seeded(0x11ded);
    const intrinsic = foldedHinge(3, 2, 1.1);
    const reference = evaluated(evaluateSimplexHingeCosineN(intrinsic)).coordinate;
    for (let dim = 4; dim <= 7; dim++) {
      const rotation = orthogonal(dim, random);
      const lift = (p: VecN): VecN => turn(rotation,
        new VecN(Float64Array.from({ length: dim }, (_, axis) => p.data[axis] ?? 0)));
      expect(evaluated(evaluateSimplexHingeCosineN({
        sharedFace: intrinsic.sharedFace.map(lift),
        oppositeA: lift(intrinsic.oppositeA),
        oppositeB: lift(intrinsic.oppositeB)
      })).coordinate, `R3 -> R${dim}`).toBeCloseTo(reference, 12);
    }
  });
});

describe('evaluateSimplexHingeCosineN — gradient', () => {
  it('agrees with central differences over every vertex coordinate', () => {
    let worst = 0;
    let compared = 0;
    for (const [dim, simplexDim] of [[2, 1], [3, 2], [4, 3], [7, 4]] as const) {
      for (const angle of [0.15, 0.6, 1.2, 2.0]) {
        const scene = foldedHinge(dim, simplexDim, angle);
        const geometry = evaluated(evaluateSimplexHingeCosineN(scene));
        const vertices = [...scene.sharedFace, scene.oppositeA, scene.oppositeB]
          .map((v) => v.clone());
        const read = (): number => evaluated(evaluateSimplexHingeCosineN({
          sharedFace: vertices.slice(0, scene.sharedFace.length),
          oppositeA: vertices[scene.sharedFace.length]!,
          oppositeB: vertices[scene.sharedFace.length + 1]!
        })).coordinate;
        for (let index = 0; index < vertices.length; index++) {
          for (let axis = 0; axis < dim; axis++) {
            const original = vertices[index]!.data[axis]!;
            vertices[index]!.data[axis] = original + 1e-6;
            const plus = read();
            vertices[index]!.data[axis] = original - 1e-6;
            const minus = read();
            vertices[index]!.data[axis] = original;
            compared++;
            worst = Math.max(worst, Math.abs(
              geometry.gradient[index]!.data[axis]! - (plus - minus) / 2e-6
            ));
          }
        }
      }
    }
    expect(compared).toBe(320); // the P48 count, so coverage cannot silently shrink
    expect(worst).toBeLessThan(1e-7);
  });

  it('has exact translation and rotation null modes', () => {
    for (const [dim, simplexDim] of [[2, 1], [3, 2], [4, 3], [7, 4]] as const) {
      const scene = foldedHinge(dim, simplexDim, 0.8);
      const geometry = evaluated(evaluateSimplexHingeCosineN(scene));
      const vertices = [...scene.sharedFace, scene.oppositeA, scene.oppositeB];

      const net = new Float64Array(dim);
      for (const gradient of geometry.gradient) {
        for (let axis = 0; axis < dim; axis++) net[axis]! += gradient.data[axis]!;
      }
      expect(Math.hypot(...net), `R${dim} net`).toBeLessThan(1e-14);

      let moment = 0;
      for (let row = 0; row < dim; row++) {
        for (let column = row + 1; column < dim; column++) {
          let skew = 0;
          for (let index = 0; index < vertices.length; index++) {
            skew += vertices[index]!.data[row]! * geometry.gradient[index]!.data[column]! -
              vertices[index]!.data[column]! * geometry.gradient[index]!.data[row]!;
          }
          moment = Math.max(moment, Math.abs(skew));
        }
      }
      expect(moment, `R${dim} first moment`).toBeLessThan(1e-13);
    }
  });

  it('returns gradient slots in the caller\'s input order', () => {
    const scene = foldedHinge(3, 2, 0.9);
    const straight = evaluated(evaluateSimplexHingeCosineN(scene));
    const swappedFace = evaluated(evaluateSimplexHingeCosineN({
      ...scene, sharedFace: [scene.sharedFace[1]!, scene.sharedFace[0]!]
    }));
    // Slot 0 follows whichever vertex the caller put first.
    // Normalize -0 to 0: they are the same number but distinct to toEqual.
    const slot = (v: VecN): number[] => v.toArray().map((value) => value + 0);
    expect(slot(swappedFace.gradient[0]!)).toEqual(slot(straight.gradient[1]!));
    expect(slot(swappedFace.gradient[1]!)).toEqual(slot(straight.gradient[0]!));
  });
});

describe('evaluateSimplexHingeCosineN — refusal and validation', () => {
  it('refuses a rank-deficient face and a vanishing height without NaN', () => {
    // Collinear shared face, in R4 so `d < N` holds and this is a geometric
    // refusal rather than an options error.
    const rank = evaluateSimplexHingeCosineN({
      sharedFace: [vec(4, 0, 0, 0, 0), vec(4, 1, 0, 0, 0), vec(4, 2, 0, 0, 0)],
      oppositeA: vec(4, 0, 1, 0, 0),
      oppositeB: vec(4, 0, -1, 0, 0)
    });
    expect(rank.status).toBe('refused');
    if (rank.status !== 'refused') throw new Error('unreachable');
    expect(rank.reason).toBe('rank-deficient-shared-face');
    expect(rank.rank).toBe(1);
    expect(rank.requiredRank).toBe(2);
    expect(Number.isFinite(rank.conditioning)).toBe(true);
    expect(Number.isFinite(rank.scale)).toBe(true);

    // Liveness: a folded apex works, then collapses onto the face.
    const face = [vec(3, 0, 0, 0), vec(3, 1, 0, 0)];
    const live = evaluateSimplexHingeCosineN({
      sharedFace: face, oppositeA: vec(3, 0.5, -1, 0), oppositeB: vec(3, 0.5, 0.6, 0.8)
    });
    expect(live.status).toBe('evaluated');

    const collapsed = evaluateSimplexHingeCosineN({
      sharedFace: face, oppositeA: vec(3, 0.5, -1, 0), oppositeB: vec(3, 0.5, 0, 0)
    });
    expect(collapsed.status).toBe('refused');
    if (collapsed.status !== 'refused') throw new Error('unreachable');
    expect(collapsed.reason).toBe('vanishing-conormal-height');
    expect(collapsed.heightB).toBe(0);
    expect(Number.isFinite(collapsed.heightA!)).toBe(true);
  });

  it('rejects malformed options rather than refusing', () => {
    const scene = foldedHinge(3, 2, 0.5);
    expect(() => evaluateSimplexHingeCosineN({ ...scene, nope: 1 } as never))
      .toThrow(/unknown option "nope"/);
    expect(() => evaluateSimplexHingeCosineN({ ...scene, tolerance: 0 }))
      .toThrow(/tolerance must be finite and positive/);
    expect(() => evaluateSimplexHingeCosineN({
      ...scene, oppositeB: vec(4, 0, 0, 0, 0)
    })).toThrow(/oppositeB is R4, expected R3/);
    expect(() => evaluateSimplexHingeCosineN({
      ...scene, oppositeA: vec(3, Number.NaN, 0, 0)
    })).toThrow(/finite coordinates/);
    // d must stay below N: an R2 hinge of 2-simplices has no conormal.
    expect(() => evaluateSimplexHingeCosineN({
      sharedFace: [vec(2, 0, 0), vec(2, 1, 0)],
      oppositeA: vec(2, 0, 1),
      oppositeB: vec(2, 0, -1)
    })).toThrow(/needs ambient dimension above 2, got R2/);
  });

  it('freezes its results', () => {
    const geometry = evaluated(evaluateSimplexHingeCosineN(foldedHinge(3, 2, 0.5)));
    expect(Object.isFrozen(geometry)).toBe(true);
    expect(Object.isFrozen(geometry.gradient)).toBe(true);
    expect(() => (geometry.gradient as VecN[]).push(new VecN(3))).toThrow();
  });
});

// --- family ------------------------------------------------------------------

/** A triangulated `rows × columns` R4 sheet, optionally creased. */
function sheet(rows: number, columns: number, crease: number): {
  complex: CellComplex;
  group: CellGroup;
} {
  const positions: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      positions.push(column, row, row === 1 ? crease : 0, 0);
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
  const group: CellGroup = {
    key: 'sheet',
    dim: 2,
    verticesPerCell: 3,
    kind: 'simplex',
    indices: Uint32Array.from(indices)
  };
  return {
    complex: new CellComplex(4, Float64Array.from(positions), [group]),
    group
  };
}

function bendingScene(id: string, crease: number, restFlat = true): {
  world: XpbdWorldN;
  family: XpbdSourceSimplexCosineBendingFamilyN;
  binding: ReturnType<typeof compileXpbdParticleBindingN>;
  complex: CellComplex;
  group: CellGroup;
} {
  const { complex, group } = sheet(3, 3, crease);
  const binding = compileXpbdParticleBindingN({ id: `${id}-points`, source: complex });
  const family = compileXpbdSourceSimplexCosineBendingFamilyN({
    id: `${id}-bending`,
    binding,
    simplexGroup: group,
    stiffness: 25,
    minimumMeasureRatio: 0.05,
    ...(restFlat ? { restCoordinate: 1 } : {})
  });
  const world = new XpbdWorldN({ dimension: 4 });
  binding.addToWorld(world);
  family.addToWorld(world);
  return { world, family, binding, complex, group };
}

describe('compileXpbdSourceSimplexCosineBendingFamilyN — topology', () => {
  it('orders hinges by numeric shared tuple then incident cell', () => {
    const scene = bendingScene('order', 0);
    const keys = scene.family.hinges.map((hinge) => hinge.sharedVertices);
    expect(keys.length).toBeGreaterThan(0); // liveness
    const flat = keys.map((tuple) => tuple.join('-'));
    expect(new Set(flat).size).toBe(flat.length);
    // Numerically ascending, not string-ascending.
    for (let index = 1; index < keys.length; index++) {
      const previous = keys[index - 1]!;
      const current = keys[index]!;
      let ordered = false;
      for (let slot = 0; slot < Math.min(previous.length, current.length); slot++) {
        if (previous[slot] !== current[slot]) {
          ordered = previous[slot]! < current[slot]!;
          break;
        }
      }
      expect(ordered, `${previous} then ${current}`).toBe(true);
    }
    for (const hinge of scene.family.hinges) {
      expect(hinge.cellA.cellIndex).toBeLessThan(hinge.cellB.cellIndex);
      expect(hinge.id).toContain('order-bending/hinge/');
    }
  });

  it('counts boundary faces and refuses a non-manifold face outright', () => {
    const scene = bendingScene('counts', 0);
    // A 3x3 triangulated sheet: 8 triangles, 8 interior edges, 8 boundary.
    expect(scene.family.hinges.length).toBe(8);
    expect(scene.family.boundaryFaceCount).toBe(8);

    const positions = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0];
    const group: CellGroup = {
      key: 'fan', dim: 2, verticesPerCell: 3, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 2, 0, 1, 3, 0, 1, 4])
    };
    const complex = new CellComplex(4, Float64Array.from(positions), [group]);
    const binding = compileXpbdParticleBindingN({ id: 'fan', source: complex });
    expect(() => compileXpbdSourceSimplexCosineBendingFamilyN({
      id: 'fan-bending', binding, simplexGroup: group,
      stiffness: 1, minimumMeasureRatio: 0.05
    })).toThrow(/face \[0, 1\] has 3 incident cells/);
  });

  it('validates its options strictly', () => {
    const { complex, group } = sheet(3, 3, 0);
    const binding = compileXpbdParticleBindingN({ id: 'v', source: complex });
    const base = {
      id: 'v-bending', binding, simplexGroup: group,
      stiffness: 1, minimumMeasureRatio: 0.05
    };
    const build = (patch: Record<string, unknown>): unknown =>
      compileXpbdSourceSimplexCosineBendingFamilyN({ ...base, ...patch } as never);

    expect(() => build({ nope: 1 })).toThrow(/unknown option "nope"/);
    expect(() => build({ id: '  ' })).toThrow(/id must be a non-empty string/);
    expect(() => build({ stiffness: 0 })).toThrow(/stiffness must be finite and positive/);
    expect(() => build({ minimumMeasureRatio: 0 }))
      .toThrow(/minimumMeasureRatio must be finite and positive/);
    expect(() => build({ restCoordinate: 1.5 })).toThrow(/finite number in \[-1, 1\]/);
    expect(() => build({ restCoordinate: 'flat' })).toThrow(/'source' or a finite number/);
    expect(() => build({ conservativeScale: 1 })).toThrow(/conservativeScale must be in \(0, 1\)/);
    expect(() => build({ tolerance: -1 })).toThrow(/tolerance must be finite and positive/);
    expect(() => build({ simplexGroup: { ...group } }))
      .toThrow(/simplexGroup must belong to the binding's source/);
  });

  it('captures rest from the source by default and honours an explicit rest', () => {
    const creased = bendingScene('creased', 0.4, false);
    // Default 'source': the creased shape is its own rest, so zero energy.
    const atRest = creased.family.evaluate();
    expect(creased.family.hinges.length).toBeGreaterThan(0);
    expect(atRest.potentialEnergy).toBeLessThan(1e-20);
    expect(atRest.maximumCoordinateError).toBeLessThan(1e-12);
    // And the captured rest is genuinely folded, not silently flattened.
    expect(creased.family.hinges.some((hinge) => hinge.restCoordinate < 0.999))
      .toBe(true);

    const flatRest = bendingScene('flat', 0.4, true);
    expect(flatRest.family.hinges.every((hinge) => hinge.restCoordinate === 1)).toBe(true);
    expect(flatRest.family.evaluate().potentialEnergy).toBeGreaterThan(0);
  });

  it('does not retarget rest when source coordinates are written', () => {
    const scene = bendingScene('rest', 0.4, false);
    const before = scene.family.hinges.map((hinge) => hinge.restCoordinate);
    expect(scene.family.evaluate().potentialEnergy).toBeLessThan(1e-20);

    // Move the particles and write them back to the source.
    for (const particle of scene.binding.particles) particle.position.data[2]! += 0.3;
    scene.binding.writeSourcePositions();

    expect(scene.family.hinges.map((hinge) => hinge.restCoordinate)).toEqual(before);
    // The family is still usable and now measures a deformation.
    const after = scene.family.evaluate();
    expect(Number.isFinite(after.potentialEnergy)).toBe(true);
  });

  it('refuses a retired source group before evaluating', () => {
    const scene = bendingScene('retire', 0.2, false);
    expect(scene.family.evaluate().hingeCount).toBeGreaterThan(0); // liveness
    scene.complex.groups.length = 0;
    expect(() => scene.family.evaluate()).toThrow(/simplex group was removed/);
    expect(() => scene.family.evaluateAt((p) => p.position.clone()))
      .toThrow(/simplex group was removed/);

    // An unattached family over a retired group refuses at registration too,
    // before it can reach a world. Built inline because the scene helper
    // attaches, and an attached family would refuse for that reason first.
    const fresh = sheet(3, 3, 0.2);
    const freshBinding = compileXpbdParticleBindingN({
      id: 'detached-points', source: fresh.complex
    });
    const detached = compileXpbdSourceSimplexCosineBendingFamilyN({
      id: 'detached-bending', binding: freshBinding,
      simplexGroup: fresh.group, stiffness: 25, minimumMeasureRatio: 0.05
    });
    expect(detached.evaluate().hingeCount).toBeGreaterThan(0);
    fresh.complex.groups.length = 0;
    const world = new XpbdWorldN({ dimension: 4 });
    freshBinding.addToWorld(world);
    expect(() => detached.addToWorld(world)).toThrow(/simplex group was removed/);
  });
});

describe('XpbdSourceSimplexCosineBendingFamilyN — evaluation', () => {
  it('agrees per hinge with the pure evaluator and sums independently', () => {
    const scene = bendingScene('agree', 0.35, true);
    const evaluation = scene.family.evaluate();
    expect(evaluation.hingeCount).toBe(8);
    expect(evaluation.potentialEnergy).toBeGreaterThan(0); // liveness

    let energy = 0;
    const forces = scene.binding.particles.map(() => new VecN(4));
    for (const record of evaluation.hinges) {
      const direct = evaluateSimplexHingeCosineN({
        sharedFace: record.hinge.sharedVertices.map((vertex) =>
          scene.binding.particles[vertex]!.position.clone()),
        oppositeA: scene.binding.particles[record.hinge.oppositeVertexA]!.position.clone(),
        oppositeB: scene.binding.particles[record.hinge.oppositeVertexB]!.position.clone()
      });
      expect(direct.status).toBe('evaluated');
      if (direct.status !== 'evaluated') throw new Error('unreachable');
      expect(direct.coordinate).toBe(record.geometry.coordinate);

      const delta = direct.coordinate - record.hinge.restCoordinate;
      energy += 0.5 * scene.family.stiffness * delta * delta;
      [...record.hinge.sharedVertices, record.hinge.oppositeVertexA,
        record.hinge.oppositeVertexB].forEach((vertex, slot) => {
        for (let axis = 0; axis < 4; axis++) {
          forces[vertex]!.data[axis]! -=
            scene.family.stiffness * delta * direct.gradient[slot]!.data[axis]!;
        }
      });
    }
    expect(evaluation.potentialEnergy).toBeCloseTo(energy, 15);
    expect(evaluation.forces.map((f) => f.toArray()))
      .toEqual(forces.map((f) => f.toArray()));
    expect(evaluation.weighting).toBe('unit-discrete');
    expect(evaluation.weight).toBe(1);
  });

  it('reports near-zero net force and rotational first moment', () => {
    const scene = bendingScene('residual', 0.45, true);
    const evaluation = scene.family.evaluate();
    expect(evaluation.potentialEnergy).toBeGreaterThan(0); // liveness
    expect(evaluation.netForceResidual).toBeLessThan(1e-12);
    expect(evaluation.rotationalFirstMomentResidual).toBeLessThan(1e-12);
    expect(evaluation.minimumConormalHeight).toBeGreaterThan(0);
  });

  it('raises a typed domain error when a current hinge degenerates', () => {
    const scene = bendingScene('domain', 0.3, true);
    expect(scene.family.evaluate().hingeCount).toBe(8); // liveness
    // Collapse one triangle onto its shared edge.
    const collapsed = scene.binding.particles.map((p) => p.position.clone());
    collapsed[4]!.data[0] = collapsed[3]!.data[0]!;
    collapsed[4]!.data[1] = collapsed[3]!.data[1]!;
    collapsed[4]!.data[2] = collapsed[3]!.data[2]!;
    let caught: unknown;
    try {
      scene.family.evaluateAt((particle) =>
        collapsed[scene.binding.particles.indexOf(particle)]!);
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(XpbdPotentialDomainErrorN);
    expect((caught as XpbdPotentialDomainErrorN).lawId).toBe('domain-bending');
    expect(['rank-deficient-shared-face', 'vanishing-conormal-height'])
      .toContain((caught as XpbdPotentialDomainErrorN).reason);
  });

  it('freezes returned evidence', () => {
    const evaluation = bendingScene('frozen', 0.2, true).family.evaluate();
    expect(Object.isFrozen(evaluation)).toBe(true);
    expect(Object.isFrozen(evaluation.hinges)).toBe(true);
    expect(Object.isFrozen(evaluation.forces)).toBe(true);
    expect(() => (evaluation.forces as VecN[]).push(new VecN(4))).toThrow();
  });
});

describe('XpbdSourceSimplexCosineBendingFamilyN — solver composition', () => {
  it('pairs its filter with the provider through incrementalPotentialTerms', () => {
    const scene = bendingScene('terms', 0.3, true);
    const alone = scene.family.incrementalPotentialTerms();
    expect(alone.providers).toEqual([scene.family]);
    expect(alone.stepFilters).toEqual([scene.family.stepFilter]);

    const base = {
      providers: [] as never[], stepFilters: [] as never[]
    };
    const appended = scene.family.incrementalPotentialTerms(base);
    expect(appended.providers[appended.providers.length - 1]).toBe(scene.family);
    expect(appended.stepFilters[appended.stepFilters.length - 1])
      .toBe(scene.family.stepFilter);
    expect(Object.isFrozen(appended.providers)).toBe(true);
  });

  it('limits a chord whose endpoints are valid but which crosses zero measure', () => {
    const scene = bendingScene('filter', 0.3, true);
    const particles = scene.binding.particles;
    // Reflect one vertex through its opposite edge: both endpoints have
    // positive measure, but the triangle passes through collapse in between.
    const before = particles.map((p) => p.position.clone());
    const after = particles.map((p) => p.position.clone());
    const moving = 4;
    const anchor = before[1]!;
    for (let axis = 0; axis < 4; axis++) {
      after[moving]!.data[axis] =
        2 * anchor.data[axis]! - before[moving]!.data[axis]!;
    }

    const context = {
      dimension: 4,
      requestedStepLength: 1,
      positionBefore: (p: XpbdParticleN) => before[particles.indexOf(p)]!.clone(),
      positionAfter: (p: XpbdParticleN) => after[particles.indexOf(p)]!.clone()
    };
    const result = scene.family.stepFilter.evaluateSegment(context);

    // Liveness: the unmoved segment is certified, so a limit below means the
    // crossing was detected rather than the filter refusing everything.
    const still = scene.family.stepFilter.evaluateSegment({
      ...context, positionAfter: context.positionBefore
    });
    expect(still.status).toBe('safe');

    expect(result.status).not.toBe('safe');
    expect(result.blockingCellIndex).not.toBe(null);
    expect(result.cells.length).toBe(8); // each distinct cell inspected once
    if (result.status === 'limited') {
      expect(result.maximumStepLength).toBeGreaterThan(0);
      expect(result.maximumStepLength).toBeLessThan(1);
    }
  });

  it('lowers a live bending energy under first-order minimization', () => {
    const scene = bendingScene('minimize', 0.5, true);
    const particles = scene.binding.particles;
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 4,
      particles,
      predictedPositions: particles.map((p) => p.position.clone()),
      deltaTime: 1 / 60,
      ...scene.family.incrementalPotentialTerms()
    });
    const start = problem.evaluate(
      problem.packPositions(particles.map((p) => p.position.clone()))
    );
    expect(scene.family.evaluate().potentialEnergy).toBeGreaterThan(0); // liveness

    const result = minimizeXpbdIncrementalPotentialN({
      problem,
      initialCoordinates: problem.packPositions(
        particles.map((p) => p.position.clone())
      ),
      maximumIterations: 24
    });
    expect(result.status).toBe('converged');
    if (result.status !== 'converged') throw new Error('unreachable');
    expect(result.final.objective).toBeLessThan(start.objective);
  });

  it('advances an R4 membrane through the P46 world step', () => {
    const scene = bendingScene('world', 0.5, true);
    const before = scene.binding.particles.map((p) => p.position.toArray());
    const advance = stepXpbdIncrementalPotentialWorldN({
      world: scene.world,
      deltaTime: 1 / 120,
      stepFilters: [scene.family.stepFilter],
      warmStart: 'feasible-inertial-prediction',
      minimization: { directionPolicy: 'steepest-descent' }
    });
    expect(advance.step.status).toBe('applied');
    expect(advance.diagnosis.condition).toBe('progressed');
    const after = scene.binding.particles.map((p) => p.position.toArray());
    // Liveness: it actually moved, rather than merely not failing.
    let displacement = 0;
    for (let index = 0; index < after.length; index++) {
      for (let axis = 0; axis < 4; axis++) {
        displacement = Math.max(displacement,
          Math.abs(after[index]![axis]! - before[index]![axis]!));
      }
    }
    expect(displacement).toBeGreaterThan(1e-9);
  });

  it('refuses Newton-CG with explicit unsupported-provider evidence', () => {
    const scene = bendingScene('newton', 0.3, true);
    const particles = scene.binding.particles;
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 4,
      particles,
      predictedPositions: particles.map((p) => p.position.clone()),
      deltaTime: 1 / 60,
      ...scene.family.incrementalPotentialTerms()
    });
    const policy = xpbdNewtonDirectionPolicyN({ problem });
    const coordinates = problem.packPositions(
      particles.map((p) => p.position.clone())
    );
    const base = problem.evaluate(coordinates);
    const direction = policy.evaluate({
      problem, coordinates, evaluation: base,
      gradient: base.gradient, iteration: 0
    });
    // The bending provider exposes no analytic curvature, so the Newton policy
    // must say so rather than silently dropping the bending block.
    expect(direction.status).toBe('refused');
    if (direction.status !== 'refused') throw new Error('unreachable');
    // Named evidence, not a generic failure: the bending provider is the one
    // that cannot supply curvature.
    expect(direction.reason).toBe('unsupported-provider');
    expect(direction.evidence.newton.status).toBe('unsupported-provider');
  });
});
