import { describe, expect, it } from 'vitest';
import {
  CellComplex,
  VecN,
  createSourceCellReferenceN,
  createSourceSimplexReferenceN,
  type SourceSimplexReferenceN
} from '@holotope/core';
import {
  XpbdParticleBindingN,
  XpbdParticleN,
  XpbdPotentialDomainErrorN,
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexMeasureBarrierN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdConservativeForceProviderN,
  type XpbdIncrementalPotentialStepFilterContextN,
  type XpbdIncrementalPotentialStepFilterN,
  type XpbdSourceSimplexMeasureBarrierDomainReasonN
} from '../src/index.js';

/**
 * The public contract of the measure-weighted normal-contact law: that the
 * published forces are the exact gradient of the published energy, that the
 * energy is weighted by the cell's REFERENCE measure and is therefore
 * invariant under refining the mesh, that every reachable refusal is typed and
 * carries the term's identity, and that the paired filter's certificate is a
 * bound on the whole segment rather than a check of its ends.
 */

/** One simplex per complex, so the static obstacle is read from its own rest. */
function simplexComplex(
  dimension: number, values: readonly number[]
): { complex: CellComplex; simplex: SourceSimplexReferenceN } {
  const count = values.length / dimension;
  const complex = new CellComplex(
    dimension, Float64Array.from(values), [{
      dim: count - 1, verticesPerCell: count, kind: 'simplex',
      indices: Uint32Array.from(Array.from({ length: count }, (_, i) => i))
    }]
  );
  return {
    complex,
    simplex: createSourceSimplexReferenceN(
      createSourceCellReferenceN(complex, complex.groups[0]!, 0)
    )
  };
}

/** Lifts a layout-dim vertex list into RN by zero-padding the trailing axes. */
function embed(
  dimension: number, layoutDimension: number, values: readonly number[]
): number[] {
  const count = values.length / layoutDimension;
  const out = new Array<number>(count * dimension).fill(0);
  for (let vertex = 0; vertex < count; vertex++) {
    for (let axis = 0; axis < layoutDimension; axis++) {
      out[vertex * dimension + axis] = values[vertex * layoutDimension + axis]!;
    }
  }
  return out;
}

interface TermFixture {
  readonly provider: XpbdConservativeForceProviderN;
  readonly stepFilter: XpbdIncrementalPotentialStepFilterN;
  readonly binding: XpbdParticleBindingN;
  readonly obstacleBinding: XpbdParticleBindingN | undefined;
  readonly particles: readonly XpbdParticleN[];
}

/**
 * A cell of the requested dimension above a large obstacle triangle.
 *
 * The obstacle spans far enough that every node projects to its interior, so
 * the configuration exercises the interior-facet arm rather than an edge or a
 * vertex, and the per-node distances are the perpendicular ones.
 */
function fixture(options: {
  readonly dimension: number;
  readonly cellDimension: 1 | 2 | 3;
  readonly height?: number;
  readonly boundObstacle?: boolean;
  readonly activationDistance?: number;
  readonly stiffness?: number;
  readonly minimumDistance?: number;
  readonly maximumDirectionError?: number;
  readonly scale?: number;
}): TermFixture {
  const dimension = options.dimension;
  const height = options.height ?? 0.4;
  const scale = options.scale ?? 1;
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]
  ].slice(0, options.cellDimension + 1)
    .map((corner) => corner.map((value) => value * scale));
  const cellValues = embed(dimension, 3, corners.flatMap(
    ([x, y, z]) => [x!, y! + height, z!]
  ));
  const obstacleValues = embed(dimension, 3, [
    -40, 0, -40, 60, 0, -40, -40, 0, 60
  ]);
  const cellSide = simplexComplex(dimension, cellValues);
  const obstacleSide = simplexComplex(dimension, obstacleValues);
  const binding = compileXpbdParticleBindingN({
    id: 'cell', source: cellSide.complex
  });
  const obstacleBinding = options.boundObstacle === true
    ? compileXpbdParticleBindingN({
      id: 'obstacle', source: obstacleSide.complex, fixed: true
    })
    : undefined;
  const terms = compileXpbdSourceSimplexMeasureBarrierN({
    id: 'measure-contact',
    binding,
    cell: cellSide.simplex,
    obstacle: obstacleSide.simplex,
    ...(obstacleBinding === undefined ? {} : { obstacleBinding }),
    activationDistance: options.activationDistance ?? 1,
    stiffness: options.stiffness ?? 2,
    ...(options.minimumDistance === undefined
      ? {} : { minimumDistance: options.minimumDistance }),
    maximumDirectionError: options.maximumDirectionError ?? 1e-6
  });
  return {
    ...terms,
    binding,
    obstacleBinding,
    particles: terms.provider.particles
  };
}

/** Central difference of the published energy in one particle coordinate. */
function energyDerivative(
  provider: XpbdConservativeForceProviderN,
  particle: XpbdParticleN,
  axis: number,
  step: number
): number {
  const measure = (offset: number): number => provider.evaluateAt((query) => {
    const position = query.position.clone();
    if (query === particle) position.data[axis] += offset;
    return position;
  }).potentialEnergy;
  return (measure(step) - measure(-step)) / (2 * step);
}

describe('the measure barrier: energy, forces, and the reference weight', () => {
  it('publishes forces that are the exact gradient of the published energy, '
    + 'for every supported cell dimension, static and bound', () => {
    for (const cellDimension of [1, 2, 3] as const) {
      for (const boundObstacle of [false, true]) {
        const term = fixture({ dimension: 3, cellDimension, boundObstacle });
        const base = term.provider.evaluate();
        expect(base.potentialEnergy).toBeGreaterThan(0);
        expect(base.forces).toHaveLength(term.particles.length);
        let worst = 0;
        term.particles.forEach((particle, slot) => {
          for (let axis = 0; axis < 3; axis++) {
            const numeric = energyDerivative(
              term.provider, particle, axis, 1e-6
            );
            const published = -base.forces[slot]!.data[axis]!;
            worst = Math.max(worst, Math.abs(numeric - published));
          }
        });
        expect(worst).toBeLessThan(1e-6);
      }
    }
  });

  it('sums to zero force when both sides are bound, because the energy '
    + 'depends only on the relative placement', () => {
    const term = fixture({ dimension: 3, cellDimension: 2, boundObstacle: true });
    const total = new VecN(3);
    for (const force of term.provider.evaluate().forces) total.add(force);
    expect(total.length()).toBeLessThan(1e-12);
  });

  it('weights by the REFERENCE measure: two rest cells differing only in size '
    + 'give energies in exactly that ratio at identical placements', () => {
    const small = fixture({ dimension: 3, cellDimension: 2, scale: 1 });
    const large = fixture({ dimension: 3, cellDimension: 2, scale: 3 });
    // Same live geometry for both, so only the rest measure can differ.
    const placement = [[0, 0.4, 0], [1, 0.4, 0], [0, 1.4, 0]];
    const at = (term: TermFixture): number => term.provider.evaluateAt(
      (particle) => new VecN(
        placement[term.particles.indexOf(particle)]!
      )
    ).potentialEnergy;
    // The rest triangles are similar with ratio 3, so the 2-measures are 9:1.
    expect(at(large) / at(small)).toBeCloseTo(9, 9);
  });

  it('is invariant under refining the cell: one segment and the two halves '
    + 'covering it publish the same energy', () => {
    const dimension = 3;
    const obstacle = simplexComplex(dimension, embed(dimension, 3, [
      -40, 0, -40, 60, 0, -40, -40, 0, 60
    ]));
    const segment = (from: number, to: number): number => {
      const side = simplexComplex(dimension, embed(dimension, 3, [
        from, 0.5, 0, to, 0.5, 0
      ]));
      const binding = compileXpbdParticleBindingN({
        id: `seg-${from}`, source: side.complex
      });
      return compileXpbdSourceSimplexMeasureBarrierN({
        id: `seg-${from}`, binding, cell: side.simplex,
        obstacle: obstacle.simplex, activationDistance: 1, stiffness: 2,
        maximumDirectionError: 1e-6
      }).provider.evaluate().potentialEnergy;
    };
    // The segment is parallel to the obstacle, so every node sits at the same
    // distance and the barrier is constant along it: the energy is exactly
    // `length * psi(d)` and refinement cannot change it. A per-vertex law
    // would answer 2*psi against 3*psi for the same contact.
    const whole = segment(0, 1);
    const halves = segment(0, 0.5) + segment(0.5, 1);
    expect(whole).toBeGreaterThan(0);
    expect(Math.abs(halves - whole) / whole).toBeLessThan(1e-15);
  });

  it('is exactly zero, with exactly zero forces, beyond the activation '
    + 'distance', () => {
    const term = fixture({
      dimension: 3, cellDimension: 2, height: 5, activationDistance: 1
    });
    const evaluation = term.provider.evaluate();
    expect(evaluation.potentialEnergy).toBe(0);
    for (const force of evaluation.forces) expect(force.length()).toBe(0);
  });

  it('publishes a successful evaluation carrying exactly the energy and the '
    + 'forces', () => {
    const term = fixture({ dimension: 4, cellDimension: 2 });
    const evaluation = term.provider.evaluate();
    expect(Object.keys(evaluation).sort()).toEqual(['forces', 'potentialEnergy']);
    expect(Object.isFrozen(evaluation)).toBe(true);
    expect(evaluation.forces.every((force) => force.dim === 4)).toBe(true);
  });
});

/** Greatest Float64 strictly below a positive input; used to sit one ulp in. */
function nextDown(value: number): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) - 1n);
  return view.getFloat64(0);
}

/** A flat cell parallel to the obstacle plane, so every node shares a distance. */
function parallelTerm(options: {
  readonly height: number;
  readonly side?: number;
  readonly stiffness?: number;
  readonly minimumDistance?: number;
  readonly activationDistance?: number;
  readonly maximumDirectionError?: number;
  readonly obstacleScale?: number;
}): TermFixture {
  const side = options.side ?? 1;
  const obstacleScale = options.obstacleScale ?? 1;
  const cellSide = simplexComplex(3, [
    0, options.height, 0,
    side, options.height, 0,
    0, options.height, side
  ]);
  const obstacleSide = simplexComplex(3, [
    -40 * obstacleScale, 0, -40 * obstacleScale,
    60 * obstacleScale, 0, -40 * obstacleScale,
    -40 * obstacleScale, 0, 60 * obstacleScale
  ]);
  const binding = compileXpbdParticleBindingN({
    id: 'cell', source: cellSide.complex
  });
  const terms = compileXpbdSourceSimplexMeasureBarrierN({
    id: 'measure-contact',
    binding,
    cell: cellSide.simplex,
    obstacle: obstacleSide.simplex,
    activationDistance: options.activationDistance ?? 1,
    stiffness: options.stiffness ?? 2,
    ...(options.minimumDistance === undefined
      ? {} : { minimumDistance: options.minimumDistance }),
    maximumDirectionError: options.maximumDirectionError ?? 1e-6
  });
  return {
    ...terms, binding, obstacleBinding: undefined,
    particles: terms.provider.particles
  };
}

/** Runs an evaluation expected to refuse and returns its typed reason. */
function refusalOf(evaluate: () => unknown): {
  readonly lawId: string;
  readonly reason: XpbdSourceSimplexMeasureBarrierDomainReasonN;
} {
  try {
    evaluate();
  } catch (error) {
    if (error instanceof XpbdPotentialDomainErrorN) {
      return {
        lawId: error.lawId,
        reason: error.reason as XpbdSourceSimplexMeasureBarrierDomainReasonN
      };
    }
    throw error;
  }
  throw new Error('test fixture: the evaluation was expected to refuse');
}

const MAX = Number.MAX_VALUE;
const MIN = Number.MIN_VALUE;

/**
 * A cell whose live vertices are collapsed onto one point, so every node sits
 * exactly on it. It is the only way to steer the query to a chosen point in a
 * public test: the rest cell must stay non-degenerate, and the candidate
 * placement is free.
 */
function collapsedTerms(obstacleValues: readonly number[]): TermFixture {
  const cellSide = simplexComplex(2, [0, 5, 1, 5]);
  const obstacleSide = simplexComplex(2, [...obstacleValues]);
  const binding = compileXpbdParticleBindingN({
    id: 'cell', source: cellSide.complex
  });
  const terms = compileXpbdSourceSimplexMeasureBarrierN({
    id: 'measure-contact', binding,
    cell: cellSide.simplex, obstacle: obstacleSide.simplex,
    activationDistance: 1e300, stiffness: 1, maximumDirectionError: 1e-6
  });
  return {
    ...terms, binding, obstacleBinding: undefined,
    particles: terms.provider.particles
  };
}

function collapsedOnto(
  obstacleValues: readonly number[], point: readonly number[]
): () => unknown {
  const { provider } = collapsedTerms(obstacleValues);
  return () => provider.evaluateAt(() => new VecN([...point]));
}

describe('the measure barrier: refusal and configuration semantics', () => {
  it('reaches every reason in its published domain vocabulary, each as a '
    + 'recoverable refusal carrying the term identity', () => {
    const reached: XpbdSourceSimplexMeasureBarrierDomainReasonN[] = [];
    const record = (evaluate: () => unknown): void => {
      const refusal = refusalOf(evaluate);
      expect(refusal.lawId).toBe('measure-contact');
      reached.push(refusal.reason);
    };
    // The distance is measured and inadmissible.
    record(() => parallelTerm({ height: 0.05, minimumDistance: 0.1 })
      .provider.evaluate());
    // One ulp of margin: the distance clears the boundary, its certificate
    // does not. The gap is real and narrow — two ulps down succeeds.
    record(() => parallelTerm({
      height: 1, minimumDistance: nextDown(1), activationDistance: 2
    }).provider.evaluate());
    expect(parallelTerm({
      height: 1, minimumDistance: nextDown(nextDown(nextDown(1))),
      activationDistance: 2
    }).provider.evaluate().potentialEnergy).toBeGreaterThan(0);
    // The cell lies in the obstacle's own plane, inside its extent.
    record(() => parallelTerm({ height: 0 }).provider.evaluate());
    // Every publication failure of the exact query, forwarded one to one.
    record(collapsedOnto([0, 0, 2 ** 14, 0], [MIN, MIN]));
    record(collapsedOnto([0, 0, 1, 0], [0, 2 ** -540]));
    record(collapsedOnto([-MAX, -MAX, MAX, MAX / 2], [MAX, MAX]));
    record(collapsedOnto([0, 0, 25, 0], [7, MIN]));
    // A published direction less accurate than the authored policy admits.
    const skew = simplexComplex(3, [0.1, 0, -3.3, 7.7, 0.2, -3.1, -2.9, 5.1, 4.3]);
    const skewCell = simplexComplex(3, [
      0.11, 0.37, 0.53, 1.07, 0.41, 0.29, 0.19, 1.31, 0.61
    ]);
    const skewBinding = compileXpbdParticleBindingN({
      id: 'cell', source: skewCell.complex
    });
    record(() => compileXpbdSourceSimplexMeasureBarrierN({
      id: 'measure-contact', binding: skewBinding, cell: skewCell.simplex,
      obstacle: skew.simplex, activationDistance: 100, stiffness: 2,
      maximumDirectionError: 1e-16
    }).provider.evaluate());
    // A single node's barrier component leaves Float64...
    record(() => parallelTerm({ height: 1e-100, stiffness: 1e220 })
      .provider.evaluate());
    // ...and the measure-weighted reduction of available ones leaves it too.
    record(() => parallelTerm({
      height: 0.4, side: 1e3, obstacleScale: 1e3, stiffness: 1e305
    }).provider.evaluate());
    // A bound obstacle can degenerate at a candidate; a static one cannot,
    // because its rank is settled once, at construction.
    const term = fixture({ dimension: 3, cellDimension: 2, boundObstacle: true });
    const collinear = new Map(term.obstacleBinding!.particles.map(
      (particle, slot) => [particle, new VecN([slot, 0, 0])]
    ));
    record(() => term.provider.evaluateAt(
      (particle) => collinear.get(particle) ?? particle.position.clone()
    ));

    expect(reached).toEqual([
      'at-or-below-minimum-distance',
      'minimum-distance-not-certified',
      'zero-or-intersecting',
      'point-simplex-weight-underflow',
      'point-simplex-value-underflow',
      'point-simplex-value-overflow',
      'point-simplex-accuracy-bound-overflow',
      'direction-error-exceeds-policy',
      'barrier-component-outside-float64',
      'accumulated-value-outside-float64',
      'obstacle-rank-deficient'
    ]);
  });

  it('rejects authored configuration as a permanent error, never as a '
    + 'recoverable refusal', () => {
    const cellSide = simplexComplex(3, [0, 0.4, 0, 1, 0.4, 0, 0, 0.4, 1]);
    const obstacleSide = simplexComplex(3, [
      -40, 0, -40, 60, 0, -40, -40, 0, 60
    ]);
    const binding = compileXpbdParticleBindingN({
      id: 'cell', source: cellSide.complex
    });
    const base = {
      id: 'measure-contact', binding, cell: cellSide.simplex,
      obstacle: obstacleSide.simplex, activationDistance: 1, stiffness: 2,
      maximumDirectionError: 1e-6
    };
    const cases: Record<string, () => unknown> = {
      'unknown option': () => compileXpbdSourceSimplexMeasureBarrierN(
        { ...base, rule: 'gauss' } as never),
      'empty id': () => compileXpbdSourceSimplexMeasureBarrierN(
        { ...base, id: '  ' }),
      'missing direction policy': () => compileXpbdSourceSimplexMeasureBarrierN(
        { ...base, maximumDirectionError: undefined as never }),
      'meaningless direction policy':
        () => compileXpbdSourceSimplexMeasureBarrierN(
          { ...base, maximumDirectionError: 2 }),
      'activation below minimum': () =>
        compileXpbdSourceSimplexMeasureBarrierN(
          { ...base, minimumDistance: 2, activationDistance: 1 }),
      'non-positive stiffness': () => compileXpbdSourceSimplexMeasureBarrierN(
        { ...base, stiffness: 0 }),
      'conservativeScale above one':
        () => compileXpbdSourceSimplexMeasureBarrierN(
          { ...base, conservativeScale: 1.5 }),
      'cell outside the binding': () => compileXpbdSourceSimplexMeasureBarrierN(
        { ...base, cell: obstacleSide.simplex }),
      'rest-degenerate cell': () => {
        const degenerate = simplexComplex(3, [0, 1, 0, 1, 1, 0, 2, 1, 0]);
        return compileXpbdSourceSimplexMeasureBarrierN({
          ...base, cell: degenerate.simplex,
          binding: compileXpbdParticleBindingN({
            id: 'flat', source: degenerate.complex
          })
        });
      },
      'rank-deficient static obstacle': () =>
        compileXpbdSourceSimplexMeasureBarrierN({
          ...base,
          obstacle: simplexComplex(3, [0, 0, 0, 1, 0, 0, 2, 0, 0]).simplex
        }),
      'obstacle binding that is not kinematic': () => {
        const moving = compileXpbdParticleBindingN({
          id: 'obstacle', source: obstacleSide.complex
        });
        return compileXpbdSourceSimplexMeasureBarrierN(
          { ...base, obstacleBinding: moving });
      }
    };
    for (const [label, run] of Object.entries(cases)) {
      let thrown: unknown;
      try { run(); } catch (error) { thrown = error; }
      expect(thrown, label).toBeInstanceOf(Error);
      expect(thrown, label).not.toBeInstanceOf(XpbdPotentialDomainErrorN);
    }
  });
});

/** A cell segment parallel to the obstacle plane, swept straight through it. */
function sweepFixture(): {
  readonly term: TermFixture;
  /** Places the cell at sweep parameter `t`: height `0.5 - t`. */
  readonly at: (t: number) => (particle: XpbdParticleN) => VecN;
} {
  const cellSide = simplexComplex(3, [0, 0.5, 0, 1, 0.5, 0]);
  const obstacleSide = simplexComplex(3, [
    -40, 0, -40, 60, 0, -40, -40, 0, 60
  ]);
  const binding = compileXpbdParticleBindingN({
    id: 'cell', source: cellSide.complex
  });
  const terms = compileXpbdSourceSimplexMeasureBarrierN({
    id: 'measure-contact', binding, cell: cellSide.simplex,
    obstacle: obstacleSide.simplex, minimumDistance: 0.05,
    activationDistance: 1, stiffness: 2, maximumDirectionError: 1e-6
  });
  const term: TermFixture = {
    ...terms, binding, obstacleBinding: undefined,
    particles: terms.provider.particles
  };
  return {
    term,
    at: (t) => (particle) => {
      const position = particle.position.clone();
      position.data[1] = 0.5 - t;
      return position;
    }
  };
}

function contextFor(
  requestedStepLength: number,
  before: (particle: XpbdParticleN) => VecN,
  after: (particle: XpbdParticleN) => VecN
): XpbdIncrementalPotentialStepFilterContextN {
  return {
    dimension: 3, requestedStepLength,
    positionBefore: before, positionAfter: after
  };
}

/** True when the provider certifies every sampled placement in `[0, limit]`. */
function admissibleThroughout(
  term: TermFixture,
  at: (t: number) => (particle: XpbdParticleN) => VecN,
  limit: number,
  samples = 401
): boolean {
  for (let sample = 0; sample <= samples; sample++) {
    try {
      term.provider.evaluateAt(at(limit * sample / samples));
    } catch (error) {
      if (error instanceof XpbdPotentialDomainErrorN) return false;
      throw error;
    }
  }
  return true;
}

describe('the measure barrier: the paired step filter', () => {
  it('certifies a stationary segment and a segment that cannot reach the '
    + 'boundary', () => {
    const { term, at } = sweepFixture();
    expect(term.stepFilter.id).toBe('measure-contact-filter');
    expect(term.stepFilter.dimension).toBe(3);
    expect(term.stepFilter.particles).toEqual(term.provider.particles);
    expect(term.stepFilter.evaluate(contextFor(1, at(0), at(0))))
      .toEqual({ status: 'safe', maximumStepLength: 1 });
    expect(term.stepFilter.evaluate(contextFor(1, at(0), at(0.1))))
      .toEqual({ status: 'safe', maximumStepLength: 1 });
  });

  it('refuses to certify a segment whose start is already inadmissible, and '
    + 'says which of the two ways it failed', () => {
    const { term, at } = sweepFixture();
    expect(term.stepFilter.evaluate(contextFor(1, at(0.5), at(0.6))))
      .toEqual({ status: 'indeterminate', reason: 'initial-domain-violation' });
    const collapsed = collapsedTerms([0, 0, 25, 0]);
    const pathological = (): VecN => new VecN([7, MIN]);
    expect(collapsed.stepFilter.evaluate({
      dimension: 2, requestedStepLength: 1,
      positionBefore: pathological, positionAfter: pathological
    })).toEqual({
      status: 'indeterminate', reason: 'initial-uncertified-distance'
    });
  });

  /**
   * The reason the filter reads geometry only at the segment START.
   *
   * The swept segment begins 0.5 above the obstacle and ends 0.5 below it.
   * Both ends are admissible — the law measures UNSIGNED distance and has no
   * notion of side — so a filter that inspected the two endpoints would
   * certify the whole sweep and let the cell tunnel through. The Lipschitz
   * bound taken from the start cannot: it certifies a strict prefix that stops
   * short of the boundary.
   */
  it('certifies a prefix of a segment whose two ends are clear and whose '
    + 'interior is not', () => {
    const { term, at } = sweepFixture();
    // Both endpoints are admissible, so an endpoint check learns nothing.
    expect(term.provider.evaluateAt(at(0)).potentialEnergy).toBeGreaterThan(0);
    expect(term.provider.evaluateAt(at(1)).potentialEnergy).toBeGreaterThan(0);
    // The interior is not: the sweep crosses the obstacle at t = 0.5.
    expect(refusalOf(() => term.provider.evaluateAt(at(0.5))).reason)
      .toBe('zero-or-intersecting');

    const certificate = term.stepFilter.evaluate(contextFor(1, at(0), at(1)));
    expect(certificate.status).toBe('limited');
    if (certificate.status !== 'limited') return;
    // 0.9 * (0.5 - 0.05) / 1.0 — a prefix, and it stops before the breach.
    expect(certificate.maximumStepLength).toBeCloseTo(0.405, 12);
    expect(admissibleThroughout(term, at, certificate.maximumStepLength))
      .toBe(true);

    // CALIBRATION. The assertion above is only worth making if a certificate
    // that claimed more would be caught. Inflating this one by a fifth reaches
    // past the open boundary at t = 0.45, and the sampling sees it.
    const inflated = certificate.maximumStepLength * 1.2;
    expect(inflated).toBeGreaterThan(0.45);
    expect(admissibleThroughout(term, at, inflated)).toBe(false);
  });

  it('rejects a context it cannot honour', () => {
    const { term, at } = sweepFixture();
    expect(() => term.stepFilter.evaluate(contextFor(0, at(0), at(1))))
      .toThrow(/requestedStepLength/);
    expect(() => term.stepFilter.evaluate({
      ...contextFor(1, at(0), at(1)), dimension: 4
    })).toThrow(/R4/);
    expect(() => term.stepFilter.evaluate(null as never))
      .toThrow(/context must be an object/);
  });
});

/** A cell falling toward the obstacle inside a world that owns its particles. */
function worldFixture(height: number): {
  readonly world: XpbdWorldN;
  readonly term: TermFixture;
} {
  const term = parallelTerm({
    height, minimumDistance: 0.05, activationDistance: 0.6, stiffness: 4
  });
  const world = new XpbdWorldN({ dimension: 3, gravity: [0, -9.81, 0] });
  term.binding.addToWorld(world);
  return { world, term };
}

describe('the measure barrier: inside the released world', () => {
  it('registers as an ordinary force provider and its forces reach the '
    + 'particles', () => {
    const withContact = worldFixture(0.3);
    withContact.world.addForceProvider(withContact.term.provider);
    const without = worldFixture(0.3);
    const heightAfter = (world: XpbdWorldN, term: TermFixture): number => {
      world.step(1 / 120, 1);
      return term.particles[0]!.position.data[1]!;
    };
    const resisted = heightAfter(withContact.world, withContact.term);
    const free = heightAfter(without.world, without.term);
    // The contact pushes up: the same fall, resisted, ends higher.
    expect(resisted).toBeGreaterThan(free);
  });

  it('drives a complete incremental-potential world step with its own filter '
    + 'registered', () => {
    const { world, term } = worldFixture(0.3);
    world.addForceProvider(term.provider);
    const before = term.particles.map(
      (particle) => particle.position.clone()
    );
    const advance = stepXpbdIncrementalPotentialWorldN({
      world, deltaTime: 1 / 120, stepFilters: [term.stepFilter],
      warmStart: 'feasible-inertial-prediction'
    });
    expect(advance.selection.providerIds).toEqual(['measure-contact']);
    expect(advance.step.status).toBe('applied');
    const moved = term.particles.some((particle, slot) =>
      particle.position.clone().sub(before[slot]!).length() > 0);
    expect(moved).toBe(true);
    // Whatever the search did, it left every node strictly admissible.
    expect(term.provider.evaluate().potentialEnergy).toBeGreaterThan(0);
  });

  it('keeps the filter honest inside the search: a step large enough to '
    + 'tunnel is not applied whole', () => {
    const { world, term } = worldFixture(0.3);
    world.addForceProvider(term.provider);
    // A tenth of a second of free fall is roughly 0.05 — enough to reach the
    // open boundary at 0.05 from a start of 0.3 within a few steps.
    for (let step = 0; step < 40; step++) {
      const advance = stepXpbdIncrementalPotentialWorldN({
        world, deltaTime: 1 / 60, stepFilters: [term.stepFilter],
        warmStart: 'feasible-inertial-prediction'
      });
      expect(advance.step.status).toBe('applied');
      // The invariant the filter exists to protect: never through the wall.
      expect(term.provider.evaluate().potentialEnergy).toBeGreaterThan(0);
      expect(term.particles.every(
        (particle) => particle.position.data[1]! > 0.05
      )).toBe(true);
    }
    // Not a vacuous invariant: the cell really fell most of the way to the
    // boundary and was caught by the barrier, rather than never moving.
    const settled = term.particles[0]!.position.data[1]!;
    expect(settled).toBeLessThan(0.15);
    expect(settled).toBeGreaterThan(0.05);
  });
});
