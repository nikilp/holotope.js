import {
  CellComplex,
  MatN,
  type CellGroup,
  VecN,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  type SourceSimplexReferenceN
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdParticleSourceSimplexBarrierN,
  XpbdParticleSourceSimplexBarrierStepFilterN,
  XpbdPotentialDomainErrorN,
  compileXpbdIncrementalPotentialAnalyticHessianOperatorN,
  compileXpbdIncrementalPotentialProblemN,
  evaluateExactPointSimplexResult,
  evaluateClampedLogBarrier,
  searchXpbdIncrementalPotentialArmijoN
} from '../src/index.js';

interface SimplexFixture {
  readonly complex: CellComplex;
  readonly group: CellGroup;
  readonly reference: SourceSimplexReferenceN;
}

function simplex(
  ambientDim: number,
  vertices: readonly (readonly number[])[]
): SimplexFixture {
  const group: CellGroup = {
    dim: vertices.length - 1,
    verticesPerCell: vertices.length,
    kind: 'simplex',
    indices: Uint32Array.from(vertices.map((_, index) => index))
  };
  const complex = new CellComplex(
    ambientDim,
    Float64Array.from(vertices.flat()),
    [group]
  );
  return {
    complex,
    group,
    reference: createSourceSimplexReferenceN(
      createSourceCellReferenceN(complex, group, 0)
    )
  };
}

function tetra4(): SimplexFixture {
  return simplex(4, [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0]
  ]);
}

function barrier(
  reference: SourceSimplexReferenceN,
  position: VecN,
  options: { minimumDistance?: number; activationDistance?: number } = {}
): XpbdParticleSourceSimplexBarrierN {
  return new XpbdParticleSourceSimplexBarrierN({
    maximumDirectionError: 2 ** -12,
    id: 'simplex-barrier',
    particle: new XpbdParticleN({ id: 'point', position }),
    simplex: reference,
    minimumDistance: options.minimumDistance ?? 0.05,
    activationDistance: options.activationDistance ?? 0.8,
    stiffness: 1.7
  });
}

function context(before: VecN, after: VecN, requestedStepLength = 1) {
  return {
    dimension: before.dim,
    requestedStepLength,
    positionBefore: () => before,
    positionAfter: () => after
  };
}

function expectVector(actual: VecN, expected: VecN, digits = 11): void {
  expect(actual.dim).toBe(expected.dim);
  for (let axis = 0; axis < actual.dim; axis++) {
    expect(actual.data[axis]!).toBeCloseTo(expected.data[axis]!, digits);
  }
}

describe('RN particle--source-simplex conservative barrier', () => {
  it('retains the closest source coordinate as an R4 point approaches a tetrahedron', () => {
    const { reference } = tetra4();
    const provider = barrier(reference, new VecN([0.2, 0.25, 0.15, 0.3]));
    const evaluated = provider.evaluate();
    const scalar = evaluateClampedLogBarrier({
      coordinate: 0.25,
      activation: 0.75,
      stiffness: 1.7
    });

    expect(evaluated.distance).toBeCloseTo(0.3, 13);
    expect(evaluated.pointSimplex.status).toBe('projected');
    expect(evaluated.pointSimplex.witness.distance).toBe(evaluated.distance);
    expect(evaluated.pointSimplex.witness.direction).toEqual([0, 0, 0, 1]);
    expect(evaluated.projection.coordinate.reference).toBe(reference);
    [0.4, 0.2, 0.25, 0.15].forEach((weight, index) => {
      expect(evaluated.projection.coordinate.weights[index]!)
        .toBeCloseTo(weight, 13);
    });
    expectVector(
      evaluated.projection.point,
      new VecN([0.2, 0.25, 0.15, 0]),
      13
    );
    expect(evaluated.potentialEnergy).toBeCloseTo(scalar.energy, 13);
    expectVector(evaluated.separationNormal, new VecN([0, 0, 0, 1]), 13);
    expectVector(
      evaluated.forces[0],
      new VecN([0, 0, 0, -scalar.firstDerivative]),
      12
    );
  });

  it('matches finite-difference energy gradients across closest-feature regions', () => {
    const { reference } = tetra4();
    const provider = barrier(reference, new VecN([0, 0, 0, 1]));
    const candidates = [
      new VecN([0.2, 0.25, 0.15, 0.3]),
      new VecN([0.65, 0.65, 0.1, 0.3]),
      new VecN([1.4, -0.2, -0.1, 0.3])
    ];
    const h = 2e-6;
    for (const candidate of candidates) {
      const evaluated = provider.evaluateAt(() => candidate);
      for (let axis = 0; axis < 4; axis++) {
        const plus = candidate.clone();
        const minus = candidate.clone();
        plus.data[axis]! += h;
        minus.data[axis]! -= h;
        const numeric = (
          provider.evaluateAt(() => plus).potentialEnergy -
          provider.evaluateAt(() => minus).potentialEnergy
        ) / (2 * h);
        expect(numeric).toBeCloseTo(-evaluated.forces[0].data[axis]!, 6);
      }
    }
  });

  it('is equivariant under a common R4 rotation and translation', () => {
    const baseVertices = [
      [0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]
    ];
    const point = new VecN([0.3, 0.2, 0.1, 0.35]);
    const rotation = MatN.rotationInPlane(4, 0, 3, 0.63)
      .multiply(MatN.rotationInPlane(4, 1, 2, -0.47));
    const translation = new VecN([1, -0.5, 2, 0.3]);
    const movedVertices = baseVertices.map((values) =>
      rotation.applyTo(new VecN(values)).add(translation).toArray()
    );
    const movedPoint = rotation.applyTo(point).add(translation);
    const base = barrier(simplex(4, baseVertices).reference, point).evaluate();
    const moved = barrier(simplex(4, movedVertices).reference, movedPoint).evaluate();

    expect(moved.distance).toBeCloseTo(base.distance, 12);
    expect(moved.potentialEnergy).toBeCloseTo(base.potentialEnergy, 12);
    expectVector(moved.forces[0], rotation.applyTo(base.forces[0]), 11);
  });

  it('specializes identically from R1 through R7', () => {
    const energies: number[] = [];
    const magnitudes: number[] = [];
    for (const dimension of [1, 2, 4, 7]) {
      const zero = new Array<number>(dimension).fill(0);
      const one = zero.slice();
      one[0] = 1;
      const position = zero.slice();
      position[0] = 1.5;
      const evaluated = barrier(
        simplex(dimension, [zero, one]).reference,
        new VecN(position)
      ).evaluate();
      energies.push(evaluated.potentialEnergy);
      magnitudes.push(evaluated.forces[0].length());
      expect(evaluated.distance).toBeCloseTo(0.5, 13);
    }
    expect(new Set(energies).size).toBe(1);
    expect(new Set(magnitudes).size).toBe(1);
  });

  it('uses typed domain refusal and does not mutate candidates or live state', () => {
    const { reference } = tetra4();
    const provider = barrier(reference, new VecN([0.2, 0.2, 0.2, 0.4]));
    const candidate = new VecN([0.2, 0.2, 0.2, 0.04]);
    const live = provider.particle.position.toArray();
    expect(() => provider.evaluateAt(() => candidate))
      .toThrow(XpbdPotentialDomainErrorN);
    try {
      provider.evaluateAt(() => candidate);
    } catch (error) {
      expect(error).toMatchObject({
        lawId: 'simplex-barrier',
        reason: 'at-or-below-minimum-distance'
      });
    }
    expect(provider.particle.position.toArray()).toEqual(live);
    expect(candidate.toArray()).toEqual([0.2, 0.2, 0.2, 0.04]);
  });

  it('distinguishes a crossed error bound from a reported sub-minimum distance', () => {
    const point = [7, 2 ** -40];
    const raw = evaluateExactPointSimplexResult(point, [0, 0, 25, 0], 2);
    expect(raw.status).toBe('projected');
    if (raw.status !== 'projected') return;
    const lower = Math.sqrt(Math.max(
      0,
      raw.witness.squaredDistance - raw.error.squaredDistanceErrorBound
    ));
    expect(lower).toBeLessThan(raw.witness.distance);
    const minimumDistance = (lower + raw.witness.distance) / 2;
    const { reference } = simplex(2, [[0, 0], [25, 0]]);
    const provider = barrier(reference, new VecN(point), {
      minimumDistance,
      activationDistance: 1
    });
    try {
      provider.evaluate();
      throw new Error('expected the distance-bound refusal');
    } catch (error) {
      expect(error).toMatchObject({
        lawId: 'simplex-barrier',
        reason: 'minimum-distance-not-certified'
      });
    }
  });

  it('fails fast on dimension, option, and retired-source violations', () => {
    const fixture = tetra4();
    const particle = new XpbdParticleN({ id: 'bad', position: [0, 0, 0] });
    expect(() => new XpbdParticleSourceSimplexBarrierN({
      maximumDirectionError: 2 ** -12,
      id: 'bad', particle, simplex: fixture.reference,
      activationDistance: 1, stiffness: 1
    })).toThrow(/particle is R3.*R4/);
    expect(() => new XpbdParticleSourceSimplexBarrierN({
      id: 'bad',
      particle: new XpbdParticleN({ id: 'p', position: [0, 0, 0, 1] }),
      simplex: fixture.reference,
      activationDistance: 1,
      stiffness: 1,
      maximumDirectionError: 2 ** -12,
      typo: true
    } as never)).toThrow(/unknown option "typo"/);
    fixture.group.indices[0] = 1;
    expect(() => barrier(fixture.reference, new VecN([0, 0, 0, 1])))
      .toThrow(/retired/);
  });

  it('keeps absent analytic curvature an explicit Newton capability refusal', () => {
    const { reference } = tetra4();
    const provider = barrier(reference, new VecN([0.2, 0.2, 0.2, 0.4]));
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 4,
      particles: [provider.particle],
      predictedPositions: [provider.particle.position.clone()],
      deltaTime: 0.1,
      providers: [provider]
    });
    const compiled = compileXpbdIncrementalPotentialAnalyticHessianOperatorN({
      problem,
      coordinates: [0.2, 0.2, 0.2, 0.4]
    });
    expect(compiled).toMatchObject({
      status: 'unsupported-provider',
      providerIds: ['simplex-barrier']
    });
  });
});

describe('RN particle--source-simplex admissible-step filter', () => {
  it('certifies a strict Lipschitz prefix without claiming an impact time', () => {
    const { reference } = tetra4();
    const provider = barrier(reference, new VecN([0.2, 0.2, 0.2, 0.5]));
    const filter = new XpbdParticleSourceSimplexBarrierStepFilterN({
      id: 'simplex-filter', barrier: provider
    });
    const evaluated = filter.evaluate(context(
      new VecN([0.2, 0.2, 0.2, 0.5]),
      new VecN([0.2, 0.2, 0.2, -0.5]),
      2
    ));

    expect(evaluated).toMatchObject({
      status: 'limited',
      startDistance: 0.5,
      endDistance: 0.5,
      pathLength: 1,
      startDirectionalDerivative: -1,
      certification: 'global-lipschitz'
    });
    expect(evaluated.startMargin).toBeCloseTo(0.45, 14);
    expect(evaluated.endMargin).toBeCloseTo(0.45, 14);
    expect(evaluated.certifiedFraction).toBeCloseTo(0.405, 14);
    expect(evaluated.status === 'limited' && evaluated.maximumStepLength)
      .toBeCloseTo(0.81, 14);
    expect('impactFraction' in evaluated).toBe(false);
  });

  it('proves stationary, tangential, away, and short paths safe', () => {
    const { reference } = tetra4();
    const provider = barrier(reference, new VecN([0.2, 0.2, 0.2, 0.2]));
    const filter = new XpbdParticleSourceSimplexBarrierStepFilterN({
      id: 'branches', barrier: provider
    });
    const start = new VecN([0.2, 0.2, 0.2, 0.2]);
    const safeCases = [
      [start, start, 'stationary'],
      [start, new VecN([1.4, 0.2, 0.2, 0.2]), 'convex-nondecreasing'],
      [start, new VecN([0.2, 0.2, 0.2, 0.8]), 'convex-nondecreasing'],
      [start, new VecN([0.2, 0.2, 0.2, 0.1]), 'global-lipschitz']
    ] as const;
    for (const [before, after, certification] of safeCases) {
      expect(filter.evaluate(context(before, after))).toMatchObject({
        status: 'safe',
        maximumStepLength: 1,
        certifiedFraction: 1,
        certification
      });
    }
  });

  it('refuses an inadmissible start and preserves all caller state', () => {
    const { reference } = tetra4();
    const provider = barrier(reference, new VecN([0.2, 0.2, 0.2, 0.4]));
    const filter = new XpbdParticleSourceSimplexBarrierStepFilterN({
      id: 'refusal', barrier: provider
    });
    const before = new VecN([0.2, 0.2, 0.2, 0.04]);
    const after = new VecN([0.2, 0.2, 0.2, 0.4]);
    const live = provider.particle.position.toArray();
    expect(filter.evaluate(context(before, after))).toMatchObject({
      status: 'indeterminate',
      reason: 'initial-domain-violation',
      certifiedFraction: 0,
      certification: 'initial-domain-violation'
    });
    expect(before.toArray()).toEqual([0.2, 0.2, 0.2, 0.04]);
    expect(after.toArray()).toEqual([0.2, 0.2, 0.2, 0.4]);
    expect(provider.particle.position.toArray()).toEqual(live);
  });

  it('caps Armijo before a segment can pass through an R4 tetrahedron', () => {
    const { reference } = tetra4();
    const provider = barrier(reference, new VecN([0.2, 0.2, 0.2, 0.5]));
    const filter = new XpbdParticleSourceSimplexBarrierStepFilterN({
      id: 'armijo-filter', barrier: provider
    });
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 4,
      particles: [provider.particle],
      predictedPositions: [new VecN([0.2, 0.2, 0.2, -0.5])],
      deltaTime: 0.1,
      providers: [provider],
      stepFilters: [filter]
    });
    const result = searchXpbdIncrementalPotentialArmijoN({
      problem,
      coordinates: [0.2, 0.2, 0.2, 0.5],
      direction: [0, 0, 0, -1]
    });

    expect(result.status).toBe('accepted');
    expect(result.stepFilters[0]).toMatchObject({
      filterId: 'armijo-filter',
      evaluation: {
        status: 'limited',
        certification: 'global-lipschitz'
      }
    });
    if (result.status === 'accepted') {
      expect(result.stepLength).toBeLessThan(0.5);
    }
  });
});
