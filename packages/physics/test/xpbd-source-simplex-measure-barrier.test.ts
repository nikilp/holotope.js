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
  evaluateClampedLogBarrierAtOrderN,
  evaluateExactPointSimplexResult,
  evaluateSimplexSquaredMeasureN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdConservativeForceProviderN,
  type XpbdIncrementalPotentialStepFilterContextN,
  type XpbdIncrementalPotentialStepFilterN,
  type XpbdSourceSimplexMeasureBarrierDomainReasonN
} from '../src/index.js';

/**
 * The public contract of the measure-weighted normal-contact law: that the
 * published forces are the exact gradient of the published energy, that the
 * energy is weighted by the cell's REFERENCE measure, that every reachable
 * refusal is typed and carries the term's identity, that the paired filter's
 * certificate is a bound on the whole segment rather than a check of its ends,
 * and that none of the law's non-authorable state is reachable at runtime.
 *
 * On subdivision the suite keeps three facts apart, because an earlier version
 * of it conflated them and published the first as though it were the second:
 * a CONSTANT integrand is exactly additive under subdivision; a general
 * nonconstant one is not; and the sequence of refinements converges to the
 * continuum integral, which is a measurement against an independent reference
 * rather than a bound.
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

/** The obstacle every refinement fixture measures against. */
const FLOOR_VALUES: readonly number[] = [-40, 0, -40, 60, 0, -40, -40, 0, 60];

let refinementSerial = 0;

/** One k=1 cell between two authored endpoints, as its own compiled term. */
function segmentEnergy(
  from: readonly number[], to: readonly number[], minimumDistance = 0.05
): number {
  const cellSide = simplexComplex(3, [...from, ...to]);
  const obstacleSide = simplexComplex(3, FLOOR_VALUES);
  const id = `refine-${refinementSerial++}`;
  return compileXpbdSourceSimplexMeasureBarrierN({
    id, binding: compileXpbdParticleBindingN({ id, source: cellSide.complex }),
    cell: cellSide.simplex, obstacle: obstacleSide.simplex,
    minimumDistance, activationDistance: 1, stiffness: 2,
    maximumDirectionError: 1e-6
  }).provider.evaluate().potentialEnergy;
}

/** The constant-distance calibration fixture: parallel to the obstacle. */
const parallelSegmentEnergy = (from: number, to: number): number =>
  segmentEnergy([from, 0.5, 0], [to, 0.5, 0], 0);

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

  it('CONSTANT-INTEGRAND CALIBRATION: a cell at constant distance is exactly '
    + 'additive under subdivision', () => {
    // The segment is parallel to the obstacle, so every node sits at the same
    // distance and the barrier is CONSTANT along it. Only then is the energy
    // exactly `length * psi(d)`, and only then is subdivision exactly
    // additive. This fixture is a calibration of that special case; it is not
    // evidence of any general refinement property, and it was published as
    // though it were. A per-vertex law would answer 2*psi against 3*psi here.
    const whole = parallelSegmentEnergy(0, 1);
    const halves = parallelSegmentEnergy(0, 0.5) + parallelSegmentEnergy(0.5, 1);
    expect(whole).toBeGreaterThan(0);
    expect(Math.abs(halves - whole) / whole).toBeLessThan(1e-15);
    // What measure weighting does buy, in this case and in general, is the
    // absence of raw cell-count multiplication: two cells do not answer twice.
    expect(halves / whole).toBeLessThan(1.5);
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

/**
 * A TILTED cell over the obstacle plane, so the nodes sit at different
 * distances and nothing can be confused with anything else: not the node
 * placement with the centroid, not the smallest margin with the largest, not
 * one node's weight with another's.
 */
const TILTED_HEIGHTS = [0.2, 0.45, 0.7] as const;

function tiltedTerm(minimumDistance: number): TermFixture {
  const cellSide = simplexComplex(3, [
    0, TILTED_HEIGHTS[0], 0,
    2, TILTED_HEIGHTS[1], 0,
    0, TILTED_HEIGHTS[2], 3
  ]);
  const obstacleSide = simplexComplex(3, [
    -40, 0, -40, 60, 0, -40, -40, 0, 60
  ]);
  const binding = compileXpbdParticleBindingN({
    id: 'cell', source: cellSide.complex
  });
  const terms = compileXpbdSourceSimplexMeasureBarrierN({
    id: 'measure-contact', binding, cell: cellSide.simplex,
    obstacle: obstacleSide.simplex, minimumDistance,
    activationDistance: 1, stiffness: 3, maximumDirectionError: 1e-6
  });
  return {
    ...terms, binding, obstacleBinding: undefined,
    particles: terms.provider.particles
  };
}

/** Node heights of the tilted cell, from the rule's own anchored form. */
function tiltedNodeHeights(): readonly number[] {
  const beta = (1 - 2 / 4) / 2;
  return TILTED_HEIGHTS.map((own, slot) => {
    let height = own;
    TILTED_HEIGHTS.forEach((other, index) => {
      if (index !== slot) height += beta * (other - own);
    });
    return height;
  });
}

describe('the measure barrier: the rule itself', () => {
  it('is the measure-weighted average of the barrier at k+1 distinct nodes, '
    + 'reproduced from the released measure and barrier alone', () => {
    const minimumDistance = 0.05;
    const term = tiltedTerm(minimumDistance);
    const heights = tiltedNodeHeights();
    // Three DISTINCT node distances, so a rule that sampled one point — the
    // centroid, say — would have to answer differently.
    expect(new Set(heights).size).toBe(3);
    const measure = evaluateSimplexSquaredMeasureN(
      term.binding.vertices.map((vertex) => vertex.sourcePosition)
    ).measure;
    const psi = (coordinate: number): number => {
      const component = evaluateClampedLogBarrierAtOrderN({
        coordinate: coordinate - minimumDistance,
        activation: 1 - minimumDistance,
        stiffness: 3
      }, 1).energy;
      if (!component.available) throw new Error('test fixture: unavailable');
      return component.value;
    };
    const expected = measure * heights.reduce(
      (total, height) => total + psi(height) / 3, 0
    );
    const published = term.provider.evaluate().potentialEnergy;
    expect(Math.abs(published - expected) / expected).toBeLessThan(1e-14);
    // ...and it is NOT the centroid sample, which the same primitives give.
    const centroid = measure * psi(
      TILTED_HEIGHTS.reduce((total, height) => total + height, 0) / 3
    );
    expect(Math.abs(published - centroid) / published).toBeGreaterThan(1e-3);
  });

  it('certifies against the WORST node, not the average one', () => {
    const minimumDistance = 0.05;
    const term = tiltedTerm(minimumDistance);
    const heights = tiltedNodeHeights();
    const smallest = Math.min(...heights);
    expect(smallest).toBeLessThan(
      heights.reduce((total, height) => total + height, 0) / heights.length
    );
    const drop = 0.5;
    const at = (t: number) => (particle: XpbdParticleN): VecN => {
      const position = particle.position.clone();
      position.data[1] -= drop * t;
      return position;
    };
    const certificate = term.stepFilter.evaluate(contextFor(1, at(0), at(1)));
    expect(certificate.status).toBe('limited');
    if (certificate.status !== 'limited') return;
    expect(certificate.maximumStepLength)
      .toBeCloseTo(0.9 * (smallest - minimumDistance) / drop, 9);
    expect(admissibleThroughout(term, at, certificate.maximumStepLength))
      .toBe(true);
    // Had it certified against the largest node instead, the prefix would
    // reach well past the boundary — and the sampling sees that too.
    const largest = Math.max(...heights);
    expect(admissibleThroughout(
      term, at, 0.9 * (largest - minimumDistance) / drop
    )).toBe(false);
  });
});

describe('the measure barrier: exact placement of its nodes', () => {
  /**
   * A cell whose vertices all share one coordinate has nodes that share it
   * EXACTLY, because each node is evaluated as its own vertex plus a weighted
   * sum of differences, and every difference in that coordinate is zero.
   *
   * The distinction is not decorative. Written as a raw weighted sum the same
   * node would land at `(sum of coefficients) * h`, and at `k = 3` that sum is
   * one ulp short of one because `1/5` has no Float64 — so the node would drift
   * off the plane its own cell lies in. Here the whole energy is reproducible
   * bit for bit from the released measure and barrier, which it could not be if
   * two of the four nodes sat at a different distance from the rest.
   */
  it('places a hyperplanar cell\'s nodes exactly in its own hyperplane', () => {
    const height = 1;
    const cellSide = simplexComplex(4, [
      0, height, 0, 0, 1, height, 0, 0,
      0, height, 1, 0, 0, height, 0, 1
    ]);
    const obstacleSide = simplexComplex(4, [
      -1024, 0, -1024, -1024, 3072, 0, -1024, -1024,
      -1024, 0, 3072, -1024, -1024, 0, -1024, 3072
    ]);
    const binding = compileXpbdParticleBindingN({
      id: 'cell', source: cellSide.complex
    });
    const published = compileXpbdSourceSimplexMeasureBarrierN({
      id: 'measure-contact', binding, cell: cellSide.simplex,
      obstacle: obstacleSide.simplex, activationDistance: 2, stiffness: 3,
      maximumDirectionError: 1e-6
    }).provider.evaluate().potentialEnergy;

    const component = evaluateClampedLogBarrierAtOrderN(
      { coordinate: height, activation: 2, stiffness: 3 }, 1
    ).energy;
    if (!component.available) throw new Error('test fixture: unavailable');
    let summed = 0;
    for (let node = 0; node < 4; node++) summed += component.value / 4;
    expect(published).toBe(evaluateSimplexSquaredMeasureN(
      binding.vertices.map((vertex) => vertex.sourcePosition)
    ).measure * summed);
  });
});

/**
 * What subdivision actually does to a fixed finite quadrature.
 *
 * Reference-measure weighting removes direct cell-count multiplication. It
 * does NOT make a fixed finite rule invariant under arbitrary subdivision: the
 * integrand here is a nonlinear barrier of a distance field, subdivision moves
 * the sample locations, and the estimate moves with them. Both fixtures below
 * are legal refinements of the same source region and both change the answer
 * materially.
 *
 * The percentages are properties of THESE fixtures, not constants of the law.
 * They are pinned so that a change in the rule, the node placement or the
 * measure has to move a number somebody chose, and each is also asserted
 * against a decisive floor so the test states the phenomenon and not only the
 * digits.
 */
describe('the measure barrier: subdivision changes a nonconstant estimate',
  () => {
  const TILTED_A = [0, 0.2, 0];
  const TILTED_B = [1, 0.8, 0];

  it('a linearly tilted cell, split into two equal subcells, changes the '
    + 'estimate by about 27%', () => {
    const whole = segmentEnergy(TILTED_A, TILTED_B);
    const halves = segmentEnergy(TILTED_A, [0.5, 0.5, 0])
      + segmentEnergy([0.5, 0.5, 0], TILTED_B);
    const change = (halves - whole) / whole;
    expect(whole).toBeCloseTo(0.5211907392559832, 15);
    expect(halves).toBeCloseTo(0.6619424641712688, 15);
    expect(change).toBeCloseTo(0.27005799281125603, 12);
    // Decisive, not marginal: nothing here is Float64 residue.
    expect(change).toBeGreaterThan(0.2);
  });

  it('an uneven split of a curved arrangement changes it by about 44%', () => {
    const from = [0, 0.24, 0];
    const to = [1, 0.74, 0];
    const split = [0.3, 0.32, 0];
    const whole = segmentEnergy(from, to);
    const uneven = segmentEnergy(from, split) + segmentEnergy(split, to);
    const change = (uneven - whole) / whole;
    expect(whole).toBeCloseTo(0.5069465471168626, 15);
    expect(uneven).toBeCloseTo(0.7293954684794158, 15);
    expect(change).toBeCloseTo(0.43880153169535985, 12);
    expect(change).toBeGreaterThan(0.35);
  });
});

/**
 * The refinement sequence, against an independently defined reference.
 *
 * The reference is a composite 20-point Gauss--Legendre integral of the same
 * physical quantity, built from the released authorities alone — the exact
 * point--simplex query for the distance and the released clamped-log barrier
 * for the integrand. It uses none of this law's rule, ledger or reduction, and
 * its own self-agreement is checked here so it is not merely another coarse
 * estimate.
 *
 * The measured sequence converges at second order on this fixture. That is a
 * MEASUREMENT on a named fixture, not a truncation bound: no error estimate is
 * proved anywhere and none is claimed.
 */
describe('the measure barrier: measured convergence to a continuum reference',
  () => {
  const A = [0, 0.2, 0];
  const B = [1, 0.8, 0];
  const MINIMUM = 0.05;
  const ACTIVATION = 1;
  const STIFFNESS = 2;
  const at = (t: number): number[] =>
    [A[0]! + (B[0]! - A[0]!) * t, A[1]! + (B[1]! - A[1]!) * t, 0];

  /** 20-point Gauss--Legendre abscissae and weights on [-1, 1]. */
  const gauss = (() => {
    const count = 20;
    const abscissae: number[] = [];
    const weights: number[] = [];
    const legendre = (z: number): { value: number; derivative: number } => {
      let previous = 1;
      let older = 0;
      for (let degree = 0; degree < count; degree++) {
        const kept = older;
        older = previous;
        previous = ((2 * degree + 1) * z * older - degree * kept) / (degree + 1);
      }
      return {
        value: previous,
        derivative: count * (z * previous - older) / (z * z - 1)
      };
    };
    for (let index = 1; index <= count; index++) {
      let z = Math.cos(Math.PI * (index - 0.25) / (count + 0.5));
      for (let step = 0; step < 100; step++) {
        const { value, derivative } = legendre(z);
        const shift = value / derivative;
        z -= shift;
        if (Math.abs(shift) < 1e-16) break;
      }
      const { derivative } = legendre(z);
      abscissae.push(z);
      weights.push(2 / ((1 - z * z) * derivative * derivative));
    }
    return { abscissae, weights };
  })();

  /** `psi(d(t))`, from the released query and the released barrier only. */
  const integrand = (t: number): number => {
    const obstacle = Float64Array.from(FLOOR_VALUES);
    const result = evaluateExactPointSimplexResult(at(t), obstacle, 3);
    if (result.status !== 'projected') {
      throw new Error(`test fixture: unexpected ${result.status}`);
    }
    const component = evaluateClampedLogBarrierAtOrderN({
      coordinate: result.witness.distance - MINIMUM,
      activation: ACTIVATION - MINIMUM,
      stiffness: STIFFNESS
    }, 1).energy;
    if (!component.available) throw new Error('test fixture: unavailable');
    return component.value;
  };

  const length = Math.hypot(B[0]! - A[0]!, B[1]! - A[1]!, B[2]! - A[2]!);
  const reference = (panels: number): number => {
    let total = 0;
    for (let panel = 0; panel < panels; panel++) {
      const half = 1 / (2 * panels);
      const middle = (2 * panel + 1) / (2 * panels);
      for (let node = 0; node < gauss.abscissae.length; node++) {
        total += gauss.weights[node]! * half
          * integrand(middle + half * gauss.abscissae[node]!);
      }
    }
    return total * length;
  };
  const refined = (cells: number): number => {
    let total = 0;
    for (let cell = 0; cell < cells; cell++) {
      total += segmentEnergy(at(cell / cells), at((cell + 1) / cells), MINIMUM);
    }
    return total;
  };

  it('converges to the continuum integral at second order, and the coarse '
    + 'single-cell estimate is the one furthest from it', () => {
    const coarse = reference(100);
    const truth = reference(200);
    // The reference is a reference: doubling its panels moves it by nothing.
    expect(Math.abs(truth - coarse) / truth).toBeLessThan(1e-13);

    const errors = [1, 2, 4, 8, 16, 32].map((cells) =>
      Math.abs(refined(cells) - truth) / truth);
    // Every level is strictly better than the one before it.
    for (let level = 1; level < errors.length; level++) {
      expect(errors[level]!, `level ${level}`).toBeLessThan(errors[level - 1]!);
    }
    // ...and the ratios approach 4, which is second order in the cell size.
    const ratios = errors.slice(1).map((error, index) => errors[index]! / error);
    expect(ratios[ratios.length - 1]!).toBeGreaterThan(3.9);
    expect(ratios[ratios.length - 1]!).toBeLessThan(4.1);
    // The published single-cell answer was 27.9% BELOW the continuum value.
    // The false claim did not merely overreach: it presented the coarsest
    // estimate in the sequence as the invariant one.
    expect(errors[0]!).toBeCloseTo(0.27888, 4);
    expect(refined(1)).toBeLessThan(truth);
  });
});

/**
 * Two different failure modes that must not be confused with each other.
 *
 * An INVALID AUTHORED OPTION is caught at construction and is a permanent
 * configuration error: the caller asked for something the law does not offer.
 * POST-CONSTRUCTION TAMPERING is a caller reaching into a compiled term and
 * changing a value it never authored. The first is a rejection; the second
 * must be impossible, because a validated option that can be overwritten
 * afterwards was never really validated.
 *
 * The conservative scale is where the distinction has teeth: authored above
 * one it is refused, and assigned above one after the fact it used to produce
 * a certificate covering a placement the law itself refuses.
 */
describe('the measure barrier: authored options versus tampering', () => {
  it('refuses an inflated conservative scale at construction, permanently',
    () => {
    const cellSide = simplexComplex(3, [0, 0.5, 0, 1, 0.5, 0]);
    const obstacleSide = simplexComplex(3, FLOOR_VALUES);
    const binding = compileXpbdParticleBindingN({
      id: 'cell', source: cellSide.complex
    });
    let thrown: unknown;
    try {
      compileXpbdSourceSimplexMeasureBarrierN({
        id: 'measure-contact', binding, cell: cellSide.simplex,
        obstacle: obstacleSide.simplex, activationDistance: 1, stiffness: 2,
        maximumDirectionError: 1e-6, conservativeScale: 1.2
      });
    } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(XpbdPotentialDomainErrorN);
    expect((thrown as Error).message).toMatch(/conservativeScale/u);
    // The whole open interval is authorable, and one is the honest maximum.
    expect(() => compileXpbdSourceSimplexMeasureBarrierN({
      id: 'unscaled', binding, cell: cellSide.simplex,
      obstacle: obstacleSide.simplex, activationDistance: 1, stiffness: 2,
      maximumDirectionError: 1e-6, conservativeScale: 1
    })).not.toThrow();
  });

  it('SAFETY CALIBRATION: the certified prefix is sound, and a scale of 1.2 '
    + 'applied internally still breaches', () => {
    const { term, at } = sweepFixture();
    const certificate = term.stepFilter.evaluate(contextFor(1, at(0), at(1)));
    expect(certificate.status).toBe('limited');
    if (certificate.status !== 'limited') return;
    expect(certificate.maximumStepLength).toBeCloseTo(0.405, 12);
    expect(admissibleThroughout(term, at, certificate.maximumStepLength))
      .toBe(true);
    // The exploit the review demonstrated, applied here from inside the test
    // rather than through the object: 0.9 -> 1.2 moves 0.405 to 0.54, which
    // reaches past the boundary at 0.45. The assertion above is therefore
    // live — it is not passing because the sampling could never fail.
    const inflated = certificate.maximumStepLength * (1.2 / 0.9);
    expect(inflated).toBeCloseTo(0.54, 12);
    expect(admissibleThroughout(term, at, inflated)).toBe(false);
    // What changed is that no caller can apply that factor to the term.
    expect(() => {
      (term.stepFilter as unknown as Record<string, unknown>)
        .conservativeScale = 1.2;
    }).toThrow(TypeError);
    expect(term.stepFilter.evaluate(contextFor(1, at(0), at(1))))
      .toEqual(certificate);
  });

  it('accepts no rule, so there is no caller rule to mutate', () => {
    const cellSide = simplexComplex(3, [0, 0.4, 0, 1, 0.4, 0, 0, 0.4, 1]);
    const obstacleSide = simplexComplex(3, FLOOR_VALUES);
    const binding = compileXpbdParticleBindingN({
      id: 'cell', source: cellSide.complex
    });
    const authored = {
      id: 'measure-contact', binding, cell: cellSide.simplex,
      obstacle: obstacleSide.simplex, activationDistance: 1, stiffness: 2,
      maximumDirectionError: 1e-6
    };
    for (const rejected of ['rule', 'quadrature', 'nodes', 'referenceMeasure']) {
      expect(() => compileXpbdSourceSimplexMeasureBarrierN(
        { ...authored, [rejected]: {} } as never
      ), rejected).toThrow(new RegExp(`unknown option "${rejected}"`, 'u'));
    }
  });

  it('snapshots a static obstacle and reads a bound one live', () => {
    // Static: the term took its own copy at construction, so editing the
    // caller's complex afterwards cannot reach it.
    const cellSide = simplexComplex(3, [0, 0.4, 0, 1, 0.4, 0, 0, 0.4, 1]);
    const obstacleSide = simplexComplex(3, FLOOR_VALUES);
    const binding = compileXpbdParticleBindingN({
      id: 'cell', source: cellSide.complex
    });
    const { provider } = compileXpbdSourceSimplexMeasureBarrierN({
      id: 'static-contact', binding, cell: cellSide.simplex,
      obstacle: obstacleSide.simplex, activationDistance: 1, stiffness: 2,
      maximumDirectionError: 1e-6
    });
    const before = provider.evaluate().potentialEnergy;
    for (let axis = 1; axis < obstacleSide.complex.positions.length; axis += 3) {
      obstacleSide.complex.positions[axis] = 0.2;
    }
    expect(provider.evaluate().potentialEnergy).toBe(before);

    // Bound: the obstacle is kinematic but genuinely live, read through the
    // binding on every evaluation.
    const bound = fixture({
      dimension: 3, cellDimension: 2, boundObstacle: true
    });
    const restEnergy = bound.provider.evaluate().potentialEnergy;
    const lifted = new Map(bound.obstacleBinding!.particles.map((particle) => {
      const moved = particle.position.clone();
      moved.data[1] += 0.15;
      return [particle, moved] as const;
    }));
    const movedEnergy = bound.provider.evaluateAt(
      (particle) => lifted.get(particle) ?? particle.position.clone()
    ).potentialEnergy;
    expect(movedEnergy).not.toBe(restEnergy);
    expect(movedEnergy).toBeGreaterThan(restEnergy);
  });
});
