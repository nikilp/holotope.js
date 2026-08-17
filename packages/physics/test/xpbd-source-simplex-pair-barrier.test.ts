import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  VecN,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  type SourceSimplexReferenceN
} from '@holotope/core';
import {
  XpbdParticleN,
  XpbdPotentialDomainErrorN,
  XpbdSourceSimplexPairBarrierN,
  XpbdSourceSimplexPairBarrierStepFilterN
} from '../src/index.js';

/** Narrows a graded component the fixture knows is representable. */
function availableComponentValue(
  component: { readonly available: boolean } & { readonly value?: number }
): number {
  if (!component.available || component.value === undefined) {
    throw new Error('test fixture: component unexpectedly outside Float64');
  }
  return component.value;
}

/**
 * P56 Part C gates for the feature-pair barrier and its paired filter: the
 * plan's conservation, derivative, covariance, refusal, and stability rows.
 * The heavy pinned sweep (256 seeds × R2–R7 × 65 samples) runs in Kitchen;
 * this suite carries the public contract.
 */

function twoSegments(
  dim: number, aValues: number[], bValues: number[]
): { a: SourceSimplexReferenceN; b: SourceSimplexReferenceN } {
  const positions = new Float64Array(aValues.length + bValues.length);
  positions.set(aValues, 0);
  positions.set(bValues, aValues.length);
  const countA = aValues.length / dim;
  const countB = bValues.length / dim;
  const complex = new CellComplex(dim, positions, [{
    dim: countA - 1, verticesPerCell: countA, kind: 'simplex',
    indices: Uint32Array.from(Array.from({ length: countA }, (_, i) => i))
  }, {
    dim: countB - 1, verticesPerCell: countB, kind: 'simplex',
    indices: Uint32Array.from(Array.from({ length: countB }, (_, i) => countA + i))
  }]);
  return {
    a: createSourceSimplexReferenceN(
      createSourceCellReferenceN(complex, complex.groups[0]!, 0)
    ),
    b: createSourceSimplexReferenceN(
      createSourceCellReferenceN(complex, complex.groups[1]!, 0)
    )
  };
}

function embed(dim: number, layoutDim: number, values: number[]): number[] {
  const count = values.length / layoutDim;
  const out = new Array<number>(count * dim).fill(0);
  for (let vertex = 0; vertex < count; vertex++) {
    for (let axis = 0; axis < layoutDim; axis++) {
      out[vertex * dim + axis] = values[vertex * layoutDim + axis]!;
    }
  }
  return out;
}

function particlesAt(dim: number, values: number[], prefix: string): XpbdParticleN[] {
  const particles: XpbdParticleN[] = [];
  for (let vertex = 0; vertex < values.length / dim; vertex++) {
    particles.push(new XpbdParticleN({
      id: `${prefix}-${vertex}`,
      position: new VecN(values.slice(vertex * dim, (vertex + 1) * dim)),
      inverseMass: 1
    }));
  }
  return particles;
}

function skewBarrier(dim: number, movingB = false): {
  barrier: XpbdSourceSimplexPairBarrierN;
  particlesA: XpbdParticleN[];
  particlesB: XpbdParticleN[];
  aValues: number[];
  bValues: number[];
} {
  const aValues = embed(dim, 3, [-1, 0.35, 0, 1, 0.35, 0]);
  const bValues = embed(dim, 3, [0.1, 0, -1, 0.1, 0, 1]);
  const refs = twoSegments(dim, aValues, bValues);
  const particlesA = particlesAt(dim, aValues, 'a');
  const particlesB = particlesAt(dim, bValues, 'b');
  const barrier = new XpbdSourceSimplexPairBarrierN({
    id: 'pair',
    particlesA,
    featureA: refs.a,
    ...(movingB ? { particlesB } : {}),
    featureB: refs.b,
    activationDistance: 1,
    stiffness: 2
  });
  return { barrier, particlesA, particlesB, aValues, bValues };
}

describe('the pair barrier: energy, forces, and conservation', () => {
  it('matches the energy derivative on every particle coordinate', () => {
    for (const dim of [3, 4, 5]) {
      const { barrier, particlesA } = skewBarrier(dim);
      const base = barrier.evaluate();
      expect(base.barrier.active).toBe(true);
      expect(base.potentialEnergy).toBeGreaterThan(0);
      const step = 1e-6;
      particlesA.forEach((particle, slot) => {
        for (let axis = 0; axis < dim; axis++) {
          const energyAt = (delta: number): number => barrier.evaluateAt((p) => {
            const position = p.position.clone();
            if (p === particle) position.data[axis] += delta;
            return position;
          }).potentialEnergy;
          const numeric = (energyAt(step) - energyAt(-step)) / (2 * step);
          const analytic = -base.forces[slot]!.data[axis]!;
          expect(Math.abs(analytic - numeric) / Math.max(1, Math.abs(analytic)))
            .toBeLessThanOrEqual(1e-7);
        }
      });
    }
  });

  it('conserves net force and the antisymmetric first moment with two moving sides', () => {
    for (const dim of [3, 4, 6]) {
      const { barrier } = skewBarrier(dim, true);
      const evaluation = barrier.evaluate();
      const forceScale = Math.max(
        ...evaluation.forces.map((force) => force.length()), 1e-30
      );
      // Net internal force ~ 0.
      const net = new VecN(dim);
      for (const force of evaluation.forces) net.add(force);
      expect(net.length()).toBeLessThanOrEqual(1e-11 * forceScale);
      // Antisymmetric first moment sum_i (r_i ∧ F_i) ~ 0, component-wise.
      const positions = barrier.particles.map((particle) => particle.position);
      let momentScale = 1e-30;
      const moment: number[] = [];
      for (let i = 0; i < dim; i++) {
        for (let j = i + 1; j < dim; j++) {
          let component = 0;
          positions.forEach((position, at) => {
            const force = evaluation.forces[at]!;
            const term = position.data[i]! * force.data[j]! -
              position.data[j]! * force.data[i]!;
            component += term;
            momentScale = Math.max(momentScale, Math.abs(term));
          });
          moment.push(component);
        }
      }
      for (const component of moment) {
        expect(Math.abs(component)).toBeLessThanOrEqual(1e-10 * momentScale);
      }
      // No NaN/Infinity anywhere in the returned evidence.
      for (const force of evaluation.forces) {
        for (const value of force.data) expect(Number.isFinite(value)).toBe(true);
      }
      expect(Number.isFinite(evaluation.potentialEnergy)).toBe(true);
    }
  });

  it('keeps exact source identity and static-side semantics', () => {
    const dim = 4;
    const { barrier } = skewBarrier(dim);
    const evaluation = barrier.evaluate();
    expect(evaluation.pair.witness.coordinateA.reference).toBe(barrier.featureA);
    expect(evaluation.pair.witness.coordinateB.reference).toBe(barrier.featureB);
    // Static side B: exactly one force per side-A particle, none invented.
    expect(evaluation.forces.length).toBe(barrier.particlesA.length);
    // The one-sided net force equals -b' along the separating direction.
    const net = new VecN(dim);
    for (const force of evaluation.forces) net.add(force);
    const expected = evaluation.separationNormal.clone()
      .multiplyScalar(
        -availableComponentValue(evaluation.barrier.firstDerivative));
    for (let axis = 0; axis < dim; axis++) {
      expect(net.data[axis]!).toBeCloseTo(expected.data[axis]!, 10);
    }
  });

  it('refuses ties, zero distance, uncertified pairs, and bad options by type', () => {
    const dim = 3;
    // Tied witness: exactly parallel segments.
    const parallel = twoSegments(
      dim, embed(dim, 2, [-1, 0.5, 1, 0.5]), embed(dim, 2, [-0.5, 0, 0.5, 0])
    );
    const tiedBarrier = new XpbdSourceSimplexPairBarrierN({
      id: 'tied',
      particlesA: particlesAt(dim, embed(dim, 2, [-1, 0.5, 1, 0.5]), 'a'),
      featureA: parallel.a,
      featureB: parallel.b,
      activationDistance: 1,
      stiffness: 1
    });
    let caught: unknown;
    try {
      tiedBarrier.evaluate();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(XpbdPotentialDomainErrorN);
    expect((caught as XpbdPotentialDomainErrorN<string>).reason)
      .toBe('tied-witness-no-unique-gradient');

    // Zero distance: crossing segments.
    const crossing = twoSegments(
      dim, embed(dim, 2, [-1, -1, 1, 1]), embed(dim, 2, [-1, 1, 1, -1])
    );
    const zeroBarrier = new XpbdSourceSimplexPairBarrierN({
      id: 'zero',
      particlesA: particlesAt(dim, embed(dim, 2, [-1, -1, 1, 1]), 'a'),
      featureA: crossing.a,
      featureB: crossing.b,
      activationDistance: 1,
      stiffness: 1
    });
    expect(() => zeroBarrier.evaluate()).toThrow(/no direction exists/);

    // Below the open minimum.
    const near = twoSegments(
      dim, embed(dim, 2, [-1, 0.05, 1, 0.05]), embed(dim, 2, [-0.5, 0, 0.7, 0.02])
    );
    const minimumBarrier = new XpbdSourceSimplexPairBarrierN({
      id: 'minimum',
      particlesA: particlesAt(dim, embed(dim, 2, [-1, 0.05, 1, 0.05]), 'a'),
      featureA: near.a,
      featureB: near.b,
      minimumDistance: 0.2,
      activationDistance: 1,
      stiffness: 1
    });
    expect(() => minimumBarrier.evaluate())
      .toThrow(/distance must be greater than minimumDistance/);

    // Unknown options and mismatched particle lists refuse by name.
    expect(() => new XpbdSourceSimplexPairBarrierN({
      id: 'bad', particlesA: [], featureA: near.a, featureB: near.b,
      activationDistance: 1, stiffness: 1
    })).toThrow(/particlesA must list exactly 2 particles/);
    expect(() => new XpbdSourceSimplexPairBarrierN({
      id: 'bad',
      particlesA: particlesAt(dim, embed(dim, 2, [-1, 0.05, 1, 0.05]), 'a'),
      featureA: near.a, featureB: near.b,
      activationDistance: 1, stiffness: 1,
      magic: true
    } as never)).toThrow(/unknown option "magic"/);
  });

  it('mutates nothing on refusal or success', () => {
    const dim = 3;
    const { barrier, particlesA } = skewBarrier(dim);
    const before = particlesA.map((particle) => [...particle.position.data]);
    barrier.evaluate();
    // A refusing evaluation (candidate crossing) must also leave state alone.
    try {
      barrier.evaluateAt((particle) =>
        particle === particlesA[0]!
          ? new VecN(embed(dim, 3, [0.1, 0, 0]))
          : particle.position.clone());
    } catch {
      // any refusal is fine here; the gate is non-mutation
    }
    particlesA.forEach((particle, at) => {
      expect([...particle.position.data]).toEqual(before[at]!);
    });
  });

  it('is stable under harmless relabelling near parallel, result or typed refusal', () => {
    const dim = 3;
    const theta = 1e-9; // inside the tie band measured in Part A
    const aValues = embed(dim, 2, [-1, 0.5, 1, 0.5]);
    const bValues = embed(dim, 3, [
      -Math.cos(theta) * 0.5, 0, -Math.sin(theta) * 0.5,
      Math.cos(theta) * 0.5, 0, Math.sin(theta) * 0.5
    ]);
    const build = (reverseB: boolean): (() => unknown) => {
      const refs = twoSegments(dim, aValues, bValues);
      const featureB = reverseB
        ? createSourceSimplexReferenceN(refs.b.parent, [...refs.b.vertexIndices].reverse())
        : refs.b;
      const barrier = new XpbdSourceSimplexPairBarrierN({
        id: 'band',
        particlesA: particlesAt(dim, aValues, 'a'),
        featureA: refs.a,
        featureB,
        activationDistance: 1,
        stiffness: 1
      });
      return () => barrier.evaluate();
    };
    const outcomes = [build(false), build(true)].map((evaluate) => {
      try {
        return { kind: 'value', energy: (evaluate() as { potentialEnergy: number }).potentialEnergy };
      } catch (error) {
        return {
          kind: 'refusal',
          reason: (error as XpbdPotentialDomainErrorN<string>).reason
        };
      }
    });
    // Both orderings agree: same kind, and same reason or same energy.
    expect(outcomes[1]!.kind).toBe(outcomes[0]!.kind);
    expect(JSON.stringify(outcomes[1])).toBe(JSON.stringify(outcomes[0]));
  });
});

describe('the paired step filter: certified prefixes, never impact times', () => {
  it('returns every class with honest evidence', () => {
    const dim = 4;
    const { barrier, particlesA } = skewBarrier(dim);
    const filter = new XpbdSourceSimplexPairBarrierStepFilterN({
      id: 'filter', barrier
    });
    const context = (target: (particle: XpbdParticleN) => VecN) => ({
      dimension: dim,
      requestedStepLength: 1,
      positionBefore: (particle: XpbdParticleN) => particle.position.clone(),
      positionAfter: target
    });

    // stationary
    const still = filter.evaluate(context((particle) => particle.position.clone()));
    expect(still.status).toBe('safe');
    expect(still.certification).toBe('stationary');

    // safe by the Lipschitz bound: tiny displacement against margin 0.35.
    const gentle = filter.evaluate(context((particle) => {
      const position = particle.position.clone();
      position.data[1] += 0.05;
      return position;
    }));
    expect(gentle.status).toBe('safe');
    expect(gentle.certification).toBe('global-lipschitz');
    expect(gentle.startMargin).toBeCloseTo(0.35, 9);

    // limited: a lunge across the margin certifies a strict prefix.
    const lunge = filter.evaluate(context((particle) => {
      const position = particle.position.clone();
      position.data[1] -= 2;
      return position;
    }));
    expect(lunge.status).toBe('limited');
    if (lunge.status === 'limited') {
      expect(lunge.maximumStepLength).toBeLessThan(1);
      expect(lunge.certifiedFraction).toBeCloseTo(0.9 * 0.35 / 2, 6);
      // The certified prefix really is collision-free: walk it densely.
      for (let sample = 0; sample <= 64; sample++) {
        const t = (sample / 64) * lunge.certifiedFraction;
        const probe = barrier.evaluatePairAt((particle) => {
          const position = particle.position.clone();
          if (particlesA.includes(particle)) position.data[1] -= 2 * t;
          return position;
        });
        expect(probe.status).not.toBe('zero-distance');
      }
    }

    // initial refusal: a start at zero distance.
    const crossing = twoSegments(
      dim, embed(dim, 2, [-1, -1, 1, 1]), embed(dim, 2, [-1, 1, 1, -1])
    );
    const zeroBarrier = new XpbdSourceSimplexPairBarrierN({
      id: 'zero',
      particlesA: particlesAt(dim, embed(dim, 2, [-1, -1, 1, 1]), 'a'),
      featureA: crossing.a,
      featureB: crossing.b,
      activationDistance: 1,
      stiffness: 1
    });
    const refusingFilter = new XpbdSourceSimplexPairBarrierStepFilterN({
      id: 'refusing', barrier: zeroBarrier
    });
    const refused = refusingFilter.evaluate({
      dimension: dim,
      requestedStepLength: 1,
      positionBefore: (particle) => particle.position.clone(),
      positionAfter: (particle) => particle.position.clone()
    });
    expect(refused.status).toBe('indeterminate');
    if (refused.status === 'indeterminate') {
      expect(refused.reason).toBe('initial-domain-violation');
    }
  });

  it('accepts a tied start: the Lipschitz bound needs no unique witness', () => {
    const dim = 3;
    const aValues = embed(dim, 2, [-1, 0.5, 1, 0.5]);
    const refs = twoSegments(dim, aValues, embed(dim, 2, [-0.5, 0, 0.5, 0]));
    const barrier = new XpbdSourceSimplexPairBarrierN({
      id: 'tied-start',
      particlesA: particlesAt(dim, aValues, 'a'),
      featureA: refs.a,
      featureB: refs.b,
      activationDistance: 1,
      stiffness: 1
    });
    const filter = new XpbdSourceSimplexPairBarrierStepFilterN({
      id: 'tied-filter', barrier
    });
    const result = filter.evaluate({
      dimension: dim,
      requestedStepLength: 1,
      positionBefore: (particle) => particle.position.clone(),
      positionAfter: (particle) => {
        const position = particle.position.clone();
        position.data[1] += 0.1; // moving away
        return position;
      }
    });
    expect(result.status).toBe('safe');
    expect(result.startDistance).toBeCloseTo(0.5, 12);
  });
});
