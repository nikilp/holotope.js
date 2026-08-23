import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CellComplex, VecN, createSourceCellReferenceN, createSourceSimplexReferenceN } from '@holotope/core';
import {
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexMeasureBarrierN
} from '../src/index.js';
import {
  checkReviewedBlock,
  checkReviewedOrder,
  findReviewedBlock,
  type ReviewedClaimBlock
} from './support/reviewed-claim-blocks.js';

/**
 * What the measure-weighted contact term is allowed to BE, as opposed to what
 * it computes.
 *
 * Two of these gates read the module's own source. That is deliberate and it
 * is narrow: the boundaries they hold — that exactly one derivative order is
 * requested, and exactly one exact query runs per node — are statements about
 * what the module ASKS FOR, and a behavioural test cannot see the difference
 * between asking for order 1 and asking for order 2 and ignoring half the
 * answer. Everything else here is checked against live objects.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = resolve(
  HERE, '../src/xpbd-source-simplex-measure-barrier.ts'
);
const SOURCE = readFileSync(MODULE, 'utf8');

/**
 * Names that must not appear on any object this term publishes.
 *
 * The first group is the ACTUAL runtime state of the implementation. An
 * earlier version of this list named only proposed spellings — `ruleWeights`,
 * `restMeasure`, `inflation` — and so passed while the real properties
 * `rule`, `referenceMeasure`, `staticObstacle`, `conservativeScale` and
 * `provider` sat on the packed objects, writable and enumerable. A test that
 * excludes names nobody wrote excludes nothing.
 */
const EXCLUDED_MEMBERS: readonly string[] = [
  // The real internal state, named as the implementation names it.
  'rule', 'referenceMeasure', 'staticObstacle', 'conservativeScale',
  'provider', 'cellParticles', 'obstacleParticles', 'minimumDistance',
  'activationDistance', 'stiffness', 'maximumDirectionError', 'ledger',
  'gradient', 'energies', 'startMarginAt', 'nodePosition', 'packSide',
  'packObstacle',
  // Inspection surfaces the frozen boundary excludes by name.
  'kind', 'lawId', 'component', 'level', 'nodes', 'nodeIndex', 'weights',
  'direction', 'directionErrorBound', 'witness', 'activeSlots', 'active',
  'barrier', 'distance', 'restMeasure', 'ruleWeights', 'contribution',
  'truncation', 'replay', 'toRecord', 'fromRecord', 'inflation'
];

/** Exactly what each released interface requires, and nothing else. */
const PROVIDER_KEYS = ['dimension', 'evaluate', 'evaluateAt', 'id', 'particles'];
const FILTER_KEYS = ['dimension', 'evaluate', 'id', 'particles'];

/** The constant-distance sweep fixture the filter tests drive. */
function sweep(): ReturnType<typeof terms> {
  const cellSide = simplex([0, 0.5, 0, 1, 0.5, 0]);
  const obstacleSide = simplex([-40, 0, -40, 60, 0, -40, -40, 0, 60]);
  const binding = compileXpbdParticleBindingN({
    id: 'sweep-cell', source: cellSide.complex
  });
  return compileXpbdSourceSimplexMeasureBarrierN({
    id: 'sweep-contact', binding, cell: cellSide.simplex,
    obstacle: obstacleSide.simplex, minimumDistance: 0.05,
    activationDistance: 1, stiffness: 2, maximumDirectionError: 1e-6
  });
}

function terms() {
  const cellSide = simplex([0, 0.4, 0, 1, 0.4, 0, 0, 0.4, 1]);
  const obstacleSide = simplex([-40, 0, -40, 60, 0, -40, -40, 0, 60]);
  const binding = compileXpbdParticleBindingN({
    id: 'cell', source: cellSide.complex
  });
  return compileXpbdSourceSimplexMeasureBarrierN({
    id: 'measure-contact', binding, cell: cellSide.simplex,
    obstacle: obstacleSide.simplex, activationDistance: 1, stiffness: 2,
    maximumDirectionError: 1e-6
  });
}

function simplex(values: readonly number[]) {
  const count = values.length / 3;
  const complex = new CellComplex(3, Float64Array.from(values), [{
    dim: count - 1, verticesPerCell: count, kind: 'simplex',
    indices: Uint32Array.from(Array.from({ length: count }, (_, i) => i))
  }]);
  return {
    complex,
    simplex: createSourceSimplexReferenceN(
      createSourceCellReferenceN(complex, complex.groups[0]!, 0)
    )
  };
}

describe('the measure barrier: the shape of its public surface', () => {
  it('publishes the compile function, its options, its result and its two '
    + 'reason vocabularies, and nothing else', () => {
    const exported = [...SOURCE.matchAll(
      /^export (?:function|interface|type|class) (\w+)/gmu
    )].map((match) => match[1]!);
    expect(exported.sort()).toEqual([
      'CompileXpbdSourceSimplexMeasureBarrierNOptions',
      'XpbdSourceSimplexMeasureBarrierDomainReasonN',
      'XpbdSourceSimplexMeasureBarrierPublicationReasonN',
      'XpbdSourceSimplexMeasureBarrierTermsN',
      'compileXpbdSourceSimplexMeasureBarrierN'
    ]);
    // The provider and the filter classes are NOT exported: a caller holds
    // them through the released interfaces, so there is no second surface to
    // keep compatible and no inspection channel to grow fields on.
    const index = readFileSync(resolve(HERE, '../src/index.ts'), 'utf8');
    for (const name of exported) expect(index).toContain(name);
  });

  it('asks the barrier for one derivative order, once, and never asks for a '
    + 'curvature it would not use', () => {
    const calls = [...SOURCE.matchAll(
      /evaluateClampedLogBarrierAtOrderN\([\s\S]*?\}, (\d)\)/gu
    )].map((match) => match[1]!);
    expect(calls).toEqual(['1']);
    expect(SOURCE).not.toContain('BarrierCurvature');
    expect(SOURCE).not.toContain('secondDerivative');
  });

  it('runs exactly one exact point--simplex query per node, from one call '
    + 'site per evaluation path', () => {
    const queries = SOURCE.match(/evaluateExactPointSimplexResult\(/gu) ?? [];
    // One in the energy path, one in the filter's start query, one settling
    // the static obstacle's rank at construction. No fallback arm, no retry.
    expect(queries).toHaveLength(3);
    expect(SOURCE).not.toContain('rankTolerance');
  });

  it('publishes objects carrying no inspection surface', () => {
    const compiled = terms();
    expect(Object.isFrozen(compiled)).toBe(true);
    expect(Object.keys(compiled).sort()).toEqual(['provider', 'stepFilter']);
    const evaluation = compiled.provider.evaluate();
    // `provider` and `stepFilter` are the compiled result's own two members,
    // so the scan below is per object rather than global: the name is
    // legitimate there and forbidden on the filter, where it would be the
    // route back to the provider's internals.
    for (const published of [compiled.provider, compiled.stepFilter,
      evaluation]) {
      for (const excluded of EXCLUDED_MEMBERS) {
        expect(excluded in (published as object), excluded).toBe(false);
      }
    }
    for (const excluded of EXCLUDED_MEMBERS) {
      if (excluded === 'provider') continue;
      expect(excluded in compiled, `terms.${excluded}`).toBe(false);
    }
    expect(Object.keys(evaluation).sort()).toEqual([
      'forces', 'potentialEnergy'
    ]);
  });

  it('presents the released provider and filter surfaces, and orders its '
    + 'particles cell first', () => {
    const compiled = terms();
    expect(compiled.provider.id).toBe('measure-contact');
    expect(compiled.provider.dimension).toBe(3);
    expect(compiled.provider.particles).toHaveLength(3);
    expect(Object.isFrozen(compiled.provider.particles)).toBe(true);
    expect(compiled.provider.particles.map((particle) => particle.id))
      .toEqual(['cell/vertex/0', 'cell/vertex/1', 'cell/vertex/2']);
    expect(compiled.stepFilter.id).toBe('measure-contact-filter');
    // `evaluate` and `evaluateAt` agree at the live placement, which is what
    // makes the provider usable as both a world force and a candidate probe.
    const live = compiled.provider.evaluate();
    const probed = compiled.provider.evaluateAt(
      (particle) => particle.position.clone()
    );
    expect(probed.potentialEnergy).toBe(live.potentialEnergy);
    expect(probed.forces.map((force) => [...force.data]))
      .toEqual(live.forces.map((force) => [...force.data]));
  });

  it('never mutates the particles it reads, or the positions it is handed',
    () => {
    const compiled = terms();
    const before = compiled.provider.particles.map(
      (particle) => [...particle.position.data]
    );
    const handed = compiled.provider.particles.map(
      (particle) => particle.position.clone()
    );
    compiled.provider.evaluateAt(
      (particle) => handed[compiled.provider.particles.indexOf(particle)]!
    );
    expect(compiled.provider.particles.map(
      (particle) => [...particle.position.data]
    )).toEqual(before);
    expect(handed.map((position) => [...position.data])).toEqual(before);
    // The published forces are the term's own vectors, not aliases of state.
    const evaluation = compiled.provider.evaluate();
    evaluation.forces[0]!.data[0] = 1234;
    expect(compiled.provider.particles[0]!.position.data[0]).not.toBe(1234);
    expect(new VecN(3).dim).toBe(3);
  });
});

/**
 * Runtime privacy, checked on live objects rather than on declarations.
 *
 * The declaration lane proves only that TypeScript refuses the access. The
 * annotation erases, and against the first implementation's built artifacts an
 * ordinary consumer could read `provider.rule`, obtain and mutate
 * `provider.staticObstacle`, and assign `filter.conservativeScale = 1.2` —
 * the last of which produced a certificate covering a placement the law
 * refuses. Nothing about that was visible from the `.d.ts`.
 *
 * The same battery runs against freshly packed artifacts in the packed
 * consumer; this copy is the fast one, and neither replaces the other.
 */
describe('the measure barrier: runtime privacy of non-authorable state', () => {
  it('exposes exactly the released interface members, all of them frozen',
    () => {
    const { provider, stepFilter } = terms();
    expect(Object.keys(provider).sort()).toEqual(PROVIDER_KEYS);
    expect(Reflect.ownKeys(provider).map(String).sort()).toEqual(PROVIDER_KEYS);
    expect(Object.keys(stepFilter).sort()).toEqual(FILTER_KEYS);
    expect(Reflect.ownKeys(stepFilter).map(String).sort()).toEqual(FILTER_KEYS);
    for (const exposed of [provider, stepFilter]) {
      expect(Object.isFrozen(exposed)).toBe(true);
      expect(Object.isExtensible(exposed)).toBe(false);
      for (const key of Reflect.ownKeys(exposed)) {
        const descriptor = Object.getOwnPropertyDescriptor(exposed, key)!;
        expect(descriptor.writable, String(key)).toBe(false);
        expect(descriptor.configurable, String(key)).toBe(false);
        // A getter would be a reachable route to internals; there are none.
        expect(descriptor.get, String(key)).toBeUndefined();
      }
      // The prototype is the plain object prototype: no class, no accessors.
      expect(Object.getPrototypeOf(exposed)).toBe(Object.prototype);
    }
    expect(Object.isFrozen(provider.particles)).toBe(true);
    // The particle list is the same frozen container on both terms.
    expect(stepFilter.particles).toBe(provider.particles);
  });

  it('offers no route to internal state through any reflection surface', () => {
    const { provider, stepFilter } = terms();
    for (const exposed of [provider, stepFilter] as unknown as object[]) {
      for (const excluded of EXCLUDED_MEMBERS) {
        expect(excluded in exposed, excluded).toBe(false);
        expect((exposed as Record<string, unknown>)[excluded], excluded)
          .toBeUndefined();
      }
      expect(Object.getOwnPropertySymbols(exposed)).toEqual([]);
      // Copies carry no more than the original.
      expect(Object.keys({ ...exposed }).sort())
        .toEqual(Object.keys(exposed).sort());
      const serialized = JSON.parse(JSON.stringify(exposed)) as object;
      for (const excluded of EXCLUDED_MEMBERS) {
        expect(excluded in serialized, `serialized ${excluded}`).toBe(false);
      }
    }
  });

  it('cannot be tampered with: every property attack throws and changes '
    + 'nothing', () => {
    const control = terms().provider.evaluate().potentialEnergy;
    const attacks: [string, (t: ReturnType<typeof terms>) => void][] = [
      ['provider.rule', (t) => {
        (t.provider as unknown as Record<string, unknown>).rule =
          [{ ownSlot: 0, coefficients: [0.5, 0.5, 0], weight: 1 }];
      }],
      ['provider.referenceMeasure', (t) => {
        (t.provider as unknown as Record<string, unknown>)
          .referenceMeasure = 1e9;
      }],
      ['provider.staticObstacle', (t) => {
        (t.provider as unknown as Record<string, unknown>)
          .staticObstacle = new Float64Array(9);
      }],
      ['stepFilter.conservativeScale', (t) => {
        (t.stepFilter as unknown as Record<string, unknown>)
          .conservativeScale = 1.2;
      }],
      ['stepFilter.provider', (t) => {
        (t.stepFilter as unknown as Record<string, unknown>).provider = {};
      }],
      ['provider.id', (t) => {
        (t.provider as unknown as Record<string, unknown>).id = 'changed';
      }],
      ['provider.dimension', (t) => {
        (t.provider as unknown as Record<string, unknown>).dimension = 999;
      }],
      ['provider.particles', (t) => {
        (t.provider as unknown as Record<string, unknown>).particles = [];
      }],
      ['provider.evaluate', (t) => {
        (t.provider as unknown as Record<string, unknown>).evaluate = () => ({
          potentialEnergy: 0, forces: []
        });
      }]
    ];
    for (const [name, attack] of attacks) {
      const target = terms();
      const before = Reflect.ownKeys(target.provider).length
        + Reflect.ownKeys(target.stepFilter).length;
      // Strict mode: assigning to a frozen object is a TypeError, and adding
      // a property to a non-extensible one is too.
      expect(attack.bind(null, target), name).toThrow(TypeError);
      expect(Reflect.ownKeys(target.provider).length
        + Reflect.ownKeys(target.stepFilter).length, name).toBe(before);
      // And the law is untouched, bit for bit.
      expect(target.provider.evaluate().potentialEnergy, name).toBe(control);
    }
  });
});

/**
 * The public claim sites, checked for the wording that was false.
 *
 * The first implementation told readers the energy is the same "however finely
 * it is meshed" and that "subdividing a cell must not change" it. That is true
 * only for a constant integrand; two legal refinements of one source region
 * move the estimate by 27% and 44%. Prose is where that defect lived, so prose
 * is where a gate has to stand — a numerical test cannot fail because a
 * sentence overstates what it measures.
 *
 * The list is of PHRASES, not of files, so a new claim site inherits the rule
 * by being added below rather than by being remembered.
 */
describe('the measure barrier: the language of its public claims', () => {
  const CLAIM_SITES: readonly string[] = [
    'packages/physics/src/xpbd-source-simplex-measure-barrier.ts',
    'packages/physics/test/xpbd-source-simplex-measure-barrier.test.ts',
    'packages/physics/README.md',
    'fixtures/packed-consumer/src/checks.ts',
    'docs/learn/physics/deformable.md',
    'docs/learn/theory/incremental-potentials.md',
    'CHANGELOG.md'
  ];

  /** Wording that asserts a general invariance the law does not have. */
  const FORBIDDEN: readonly [RegExp, string][] = [
    [/however finely/iu, 'claims invariance under arbitrary refinement'],
    [/mesh[- ]invariant/iu, 'claims mesh invariance'],
    [/subdivision cannot change/iu, 'denies the measured 27% and 44% changes'],
    [/subdividing a cell must not change/iu,
      'denies the measured 27% and 44% changes'],
    [/invariant under refin\w*/iu, 'claims invariance under refinement'],
    [/the same energy however/iu, 'claims invariance under arbitrary meshing']
  ];

  /**
   * The passage of a claim site that is about THIS law.
   *
   * Three of the sites are shared documents covering many subjects, and
   * scanning them whole would fail on unrelated prose — the stationarity
   * section of the incremental-potential page legitimately says "invariant
   * under refinement" about a completely different quantity. The window is
   * taken around every mention of the law, which is where its claims are.
   */
  const claimPassages = (site: string, text: string): string => {
    if (site.endsWith('xpbd-source-simplex-measure-barrier.ts')) return text;
    const lines = text.split('\n');
    const mentions = lines.flatMap((line, index) =>
      /MeasureBarrier|measure-weighted|measure barrier/u.test(line)
        ? [index] : []);
    expect(mentions.length, `${site}: mentions the law`).toBeGreaterThan(0);
    const kept = new Set<number>();
    for (const mention of mentions) {
      for (let line = mention - 40; line <= mention + 60; line++) {
        if (line >= 0 && line < lines.length) kept.add(line);
      }
    }
    return [...kept].sort((a, b) => a - b)
      .map((line) => lines[line]!).join('\n');
  };

  it('states no general refinement invariance anywhere it makes a claim',
    () => {
    const repository = resolve(HERE, '../../..');
    for (const site of CLAIM_SITES) {
      const passage = claimPassages(
        site, readFileSync(resolve(repository, site), 'utf8')
      );
      for (const [phrase, why] of FORBIDDEN) {
        const hit = phrase.exec(passage);
        expect(hit === null, `${site}: "${hit?.[0] ?? ''}" ${why}`).toBe(true);
      }
    }
  });

  it('keeps the three subdivision facts distinct where it explains them',
    () => {
    const repository = resolve(HERE, '../../..');
    for (const site of [
      'packages/physics/src/xpbd-source-simplex-measure-barrier.ts',
      'packages/physics/README.md',
      'docs/learn/physics/deformable.md',
      'CHANGELOG.md'
    ]) {
      const text = readFileSync(resolve(repository, site), 'utf8');
      // The constant-integrand case is named as the special case it is.
      expect(/constant/iu.test(text), `${site}: constant-integrand case`)
        .toBe(true);
      // The general case is stated with its measured magnitude.
      expect(/27%/u.test(text), `${site}: measured tilted change`).toBe(true);
      expect(/44%/u.test(text), `${site}: measured uneven change`).toBe(true);
      // Convergence is offered as a measurement and explicitly not a bound.
      expect(/second order/iu.test(text), `${site}: measured order`).toBe(true);
      expect(/no truncation bound|not a bound|never a bound/iu.test(text),
        `${site}: truncation disclaimer`).toBe(true);
    }
  });
});

/**
 * Inherited operations, and what they are allowed to receive.
 *
 * Own-property privacy is only half the boundary. A closure variable has no
 * key and no descriptor — but hand it to an inherited operation and it arrives
 * at a caller-replaceable function as `this`. Against the previous
 * implementation that was a permanent handle on the law: intercept
 * `Float64Array.prototype.subarray` at construction or the inherited
 * `%TypedArray%.prototype.length` accessor during evaluation, receive the
 * persistent static-obstacle buffer, restore the intrinsic, then mutate the
 * retained reference — and a later clean evaluation moved from
 * `0.5211907392559832` to `1.7968655070577886`.
 *
 * The contract asserted here is not that nothing can be observed. The
 * ephemeral per-call geometry below IS observed, deliberately. It is that no
 * captured object can change a future evaluation.
 *
 * The same battery runs against freshly packed tarballs in the packed
 * consumer. This copy is the fast one, and neither replaces the other.
 */
describe('the measure barrier: inherited-operation receivers', () => {
  const TILTED_CONTROL = 0.5211907392559832;
  const OBSTACLE_BYTES = 9 * 8;
  const typedArrayPrototype = Object.getPrototypeOf(
    Float64Array.prototype
  ) as object;

  /** The review's tilted fixture, as its own compiled term. */
  let serial = 0;
  const tilted = (): ReturnType<typeof terms> => {
    const cellSide = simplex([0, 0.2, 0, 1, 0.8, 0]);
    const obstacleSide = simplex([-40, 0, -40, 60, 0, -40, -40, 0, 60]);
    const id = `receiver-${serial++}`;
    return compileXpbdSourceSimplexMeasureBarrierN({
      id, binding: compileXpbdParticleBindingN({ id, source: cellSide.complex }),
      cell: cellSide.simplex, obstacle: obstacleSide.simplex,
      minimumDistance: 0.05, activationDistance: 1, stiffness: 2,
      maximumDirectionError: 1e-6
    });
  };
  const raiseObstacle = (buffers: readonly Float64Array[]): void => {
    for (const buffer of buffers) {
      for (let entry = 1; entry < 9; entry += 3) buffer[entry] = 0.2;
    }
  };

  it('takes no inherited typed-array method on obstacle geometry while '
    + 'compiling', () => {
    const seen = new Set<Float64Array>();
    const original = Float64Array.prototype.subarray;
    let compiled: ReturnType<typeof terms>;
    try {
      Float64Array.prototype.subarray = function (
        this: Float64Array, ...rest: number[]
      ): Float64Array {
        if (this.byteLength === OBSTACLE_BYTES) seen.add(this);
        return original.apply(this, rest as [number, number]);
      };
      compiled = tilted();
    } finally {
      Float64Array.prototype.subarray = original;
    }
    expect(Float64Array.prototype.subarray).toBe(original);
    expect([...seen]).toHaveLength(0);
    raiseObstacle([...seen]);
    expect(compiled.provider.evaluate().potentialEnergy).toBe(TILTED_CONTROL);
  });

  it('hands the query fresh geometry every call, so nothing retained through '
    + 'the inherited length accessor can change a later evaluation', () => {
    const compiled = tilted();
    expect(compiled.provider.evaluate().potentialEnergy).toBe(TILTED_CONTROL);
    const descriptor = Object.getOwnPropertyDescriptor(
      typedArrayPrototype, 'length'
    )!;
    const capture = (): Float64Array[] => {
      const seen = new Set<Float64Array>();
      try {
        Object.defineProperty(typedArrayPrototype, 'length', {
          configurable: true,
          get(this: Float64Array): number {
            if (this instanceof Float64Array
              && this.byteLength === OBSTACLE_BYTES) seen.add(this);
            return (descriptor.get as () => number).call(this);
          }
        });
        compiled.provider.evaluate();
      } finally {
        Object.defineProperty(typedArrayPrototype, 'length', descriptor);
      }
      return [...seen];
    };
    const first = capture();
    const second = capture();
    expect(Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get)
      .toBe(descriptor.get);
    // Observed on purpose: the released query does measure its argument.
    expect(first.length).toBeGreaterThan(0);
    // EPHEMERAL — no captured buffer survives into the next call.
    expect(first.filter((buffer) => second.includes(buffer))).toHaveLength(0);
    // Mutable in itself, which is exactly why identity is what matters.
    const probe = first[0]!;
    probe[1] = 99;
    expect(probe[1]).toBe(99);
    // The consequence, measured under restored intrinsics.
    raiseObstacle([...first, ...second]);
    expect(compiled.provider.evaluate().potentialEnergy).toBe(TILTED_CONTROL);
    expect(compiled.provider.evaluate().potentialEnergy).toBe(TILTED_CONTROL);
  });

  it('never supplies a private partition or the fixed rule to an inherited '
    + 'array operation', () => {
    const compiled = tilted();
    const sweepTerm = sweep();
    const captured: unknown[] = [];
    const originalForEach = Array.prototype.forEach;
    const originalIterator = Array.prototype[Symbol.iterator];
    try {
      Array.prototype.forEach = function (
        this: unknown[], ...rest: unknown[]
      ): void {
        captured.push(this);
        return originalForEach.apply(
          this, rest as [(value: unknown) => void]
        );
      };
      Array.prototype[Symbol.iterator] = function (
        this: unknown[]
      ): IterableIterator<unknown> {
        captured.push(this);
        return originalIterator.call(this);
      };
      compiled.provider.evaluate();
      sweepTerm.stepFilter.evaluate({
        dimension: 3, requestedStepLength: 1,
        positionBefore: (particle) => particle.position.clone(),
        positionAfter: (particle) => particle.position.clone()
      });
    } finally {
      Array.prototype.forEach = originalForEach;
      Array.prototype[Symbol.iterator] = originalIterator;
    }
    expect(Array.prototype.forEach).toBe(originalForEach);
    expect(Array.prototype[Symbol.iterator]).toBe(originalIterator);
    const arrays = captured.filter((value): value is unknown[] =>
      Array.isArray(value) && value.length > 0);
    const record = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null;
    // The PUBLIC particle list may be a receiver: it is published API.
    const partitions = arrays.filter((value) =>
      record(value[0]) && 'inverseMass' in value[0]
      && value !== compiled.provider.particles
      && value !== sweepTerm.provider.particles);
    expect(partitions).toHaveLength(0);
    const rules = arrays.filter((value) =>
      record(value[0]) && 'ownSlot' in value[0]);
    expect(rules).toHaveLength(0);
    expect(compiled.provider.evaluate().potentialEnergy).toBe(TILTED_CONTROL);
  });
});

/**
 * The four independently reviewed privacy claims, preserved as text.
 *
 * ## Scope, stated plainly
 *
 * This gate preserves **four passages an independent reviewer read and
 * accepted**. It does not infer the truth of English prose, here or anywhere
 * else in the repository; it claims no synonym completeness, and it makes no
 * statement about wording outside these blocks.
 *
 * Its predecessor tried to police vocabulary and failed in both directions at
 * once. Measured against the real gate before it was replaced: nine of nine
 * false synonyms passed ("unreachable at runtime", "invisible to a consumer",
 * "structurally inaccessible", …); four of four TRUE scoped sentences failed,
 * including "a closure variable has no descriptor, so it cannot be observed by
 * `Reflect.ownKeys`"; the README's required exclusion clause was satisfied by
 * an unrelated pre-existing sentence about a convergence residual, so deleting
 * the real paragraph left the gate green; and the single semantic rule it
 * carried was suppressed by matching anywhere in the same file, so the false
 * shorthand could be injected into all four sites unnoticed.
 *
 * A regular expression cannot be taught the difference between a false claim
 * and a true one. A hash can be taught the difference between reviewed text
 * and something else. So a failure here means **"this differs from what was
 * reviewed"** — never "this is false". Changing a reviewed claim is legitimate;
 * it just has to go past a reviewer and re-pin, which is the point.
 */
describe('the measure barrier: the reviewed privacy claims', () => {
  const PIN = JSON.parse(readFileSync(
    resolve(HERE, 'fixtures/measure-barrier-reviewed-claims.json'), 'utf8')
  ) as { readonly blocks: readonly ReviewedClaimBlock[] };
  const REPOSITORY = resolve(HERE, '../../..');
  const digest = (text: string): string =>
    createHash('sha256').update(text).digest('hex');
  const documentOf = (file: string): string =>
    readFileSync(resolve(REPOSITORY, file), 'utf8');
  const check = (
    block: ReviewedClaimBlock, document: string
  ): string | null => checkReviewedBlock(block, document, digest);
  /** Content, and then the reviewed order among that file's blocks. */
  const checkFile = (
    block: ReviewedClaimBlock, document: string
  ): string | null => check(block, document) ?? checkReviewedOrder(
    PIN.blocks.filter((entry) => entry.file === block.file), document
  );

  it('still carries every reviewed block, unchanged', () => {
    console.log('\nmeasure-barrier reviewed claim blocks');
    const failures: string[] = [];
    for (const block of PIN.blocks) {
      const failure = checkFile(block, documentOf(block.file));
      console.log(`  ${failure === null ? 'intact ' : 'FAILED '}`
        + `${block.id.padEnd(38)} ${block.kind.padEnd(18)}`
        + `${block.sha256.slice(0, 12)}`);
      if (failure !== null) failures.push(failure);
    }
    expect(failures).toEqual([]);
    // Ten blocks: three statements at each of the three documents, and the
    // exported JSDoc, which carries all three itself so the packed
    // declaration does too.
    expect(PIN.blocks).toHaveLength(10);
    expect(new Set(PIN.blocks.map((block) => block.file)).size).toBe(4);
  });

  it('the exported JSDoc carries all three statements itself, so the packed '
    + 'declaration does too', () => {
    const block = PIN.blocks.find((entry) => entry.kind === 'jsdoc')!;
    // Stated in the reviewed text rather than delegated to an internal note:
    // a declaration file does not carry the documentation of a function it
    // does not declare, so a pointer would ship as a pointer to nothing.
    expect(block.text).toMatch(/not authorable through the public API/u);
    expect(block.text).toMatch(
      /cannot be modified after the intrinsic is restored/u);
    expect(block.text).toMatch(/particles[^.]{0,160}excluded/u);
    expect(block.text).not.toMatch(/note on the assembled term/u);
    // And no direction word to get wrong, because nothing is pointed at.
    expect(block.text).not.toMatch(/see the note[^.]*\b(?:above|below)\b/iu);
  });

  /**
   * CALIBRATION.
   *
   * Every edit below is applied to an in-memory copy, so nothing on disk is
   * touched. Each asserts only that the gate distinguishes reviewed text from
   * something else — **not** that the edited prose is false. Several of the
   * rejected passages are perfectly true sentences in the wrong place, and
   * that is the intended behaviour of a preservation gate.
   */
  it('CALIBRATION: any change inside a reviewed block fails and names it, '
    + 'while prose outside them does not', () => {
    const byId = (id: string) =>
      PIN.blocks.find((block) => block.id === id)!;
    /** The block exactly as it appears on disk, wrapping and all. */
    const raw = (block: ReviewedClaimBlock): string =>
      findReviewedBlock(block.kind, documentOf(block.file), block.key)!.raw;
    const rejected: [string, ReviewedClaimBlock, (text: string) => string][] = [
      ...PIN.blocks.map((block) => [
        `delete the block: ${block.id}`, block,
        (text: string) => text.replace(raw(block), '')
      ] as [string, ReviewedClaimBlock, (text: string) => string]),
      ['delete only the README particle exclusion',
        byId('readme/particle-exclusion'),
        (text) => text.replace(raw(byId('readme/particle-exclusion')), '')],
      ...(['changelog', 'readme', 'guide'] as const).map((site) => [
        `insert the former false shorthand into ${site}`,
        byId(`${site}/observation-and-consequence`),
        (text: string) => text.replace(
          raw(byId(`${site}/observation-and-consequence`)),
          `${raw(byId(`${site}/observation-and-consequence`))} The claim is`
          + ' that nothing a consumer captures can change a later evaluation.'
        )
      ] as [string, ReviewedClaimBlock, (text: string) => string]),
      ['insert the former false shorthand into the exported JSDoc',
        byId('jsdoc/compile-function'),
        (text) => text.replace(
          ' * A successful evaluation carries exactly `potentialEnergy`',
          ' * The claim is that nothing a consumer captures can change a later'
          + '\n * evaluation.\n *\n'
          + ' * A successful evaluation carries exactly `potentialEnergy`'
        )],
      // A SENTENCE lifted out of a block and re-homed elsewhere in the same
      // file. The block is mutilated where it stands, which is the thing that
      // matters; the sentence still being present somewhere does not repair
      // it. See the bound noted after this table about relocating a block
      // whole.
      ['move a required sentence elsewhere in the same file',
        byId('readme/particle-exclusion'),
        (text) => {
          const block = raw(byId('readme/particle-exclusion'));
          const sentence = 'they are the caller\'s own live inputs, and'
            + ' moving them changes later\nevaluations, which is the point of'
            + ' a contact term that reads live state.';
          if (!block.includes(sentence)) {
            throw new Error('calibration: the moved sentence is not in the block');
          }
          return `${text.replace(block, block.replace(sentence, ''))}`
            + `\n\n${sentence}\n`;
        }],
      ['swap two claim blocks', byId('guide/no-public-surface'),
        (text) => {
          const first = raw(byId('guide/no-public-surface'));
          const second = raw(byId('guide/particle-exclusion'));
          return text.replace(first, '@@SWAP@@').replace(second, first)
            .replace('@@SWAP@@', second);
        }],
      ['alter one material word', byId('readme/observation-and-consequence'),
        (text) => text.replace('are **frozen**', 'are **mutable**')]
    ];
    console.log('\nreviewed-claim-block calibration');
    for (const [label, block, edit] of rejected) {
      const edited = edit(documentOf(block.file));
      expect(edited, `${label}: the edit did not apply`)
        .not.toBe(documentOf(block.file));
      const failure = checkFile(block, edited);
      console.log(`  FAIL   ${label.slice(0, 62).padEnd(62)}`
        + ` ${failure === null ? '(NOT CAUGHT)'
          : failure.split(' :: ')[2] ?? ''}`);
      expect(failure, label).not.toBeNull();
      // The report leads with the file and a block, not just "something
      // changed". A content failure names the block that was edited; an ORDER
      // failure names the block that now sits out of sequence, which for a
      // swap is its partner — either way the reviewer is pointed at the right
      // file and at a block by name.
      expect(failure!, label).toContain(block.file);
      expect(
        PIN.blocks.filter((entry) => entry.file === block.file)
          .map((entry) => entry.id)
          .some((id) => failure!.includes(id)), label
      ).toBe(true);
    }

    const accepted: [string, (text: string) => string][] = [
      ['retain the approved true `Reflect.ownKeys` sentence', (text) => text],
      ['add unrelated true prose after every reviewed block',
        (text) => `${text}\n\nA closure variable has no descriptor, so it`
          + ' cannot be observed by `Reflect.ownKeys`. The rule is'
          + ' unobservable through property reflection alone.\n'],
      ['re-wrap a reviewed block without changing a word',
        (text) => text.replace(/\n/gu, '\n')]
    ];
    for (const [label, edit] of accepted) {
      const failures = PIN.blocks.filter((block) =>
        checkFile(block, edit(documentOf(block.file))) !== null);
      console.log(`  ACCEPT ${label.slice(0, 62).padEnd(62)}`
        + ` ${failures.length} block(s) disturbed`);
      expect(failures.map((block) => block.id), label).toEqual([]);
    }
    // The sentence the predecessor rejected is true, is in the source, and is
    // outside every reviewed block — so it survives, which it must.
    const law = documentOf(
      'packages/physics/src/xpbd-source-simplex-measure-barrier.ts');
    expect(law).toMatch(/`Reflect\.ownKeys`[\s\S]{0,80}cannot see it/u);

    // Relocating a reviewed block INTACT is caught by order, not by content.
    const readme = documentOf('packages/physics/README.md');
    const exclusion = raw(byId('readme/particle-exclusion'));
    const relocated = `${exclusion}\n\n${readme.replace(exclusion, '')}`;
    expect(checkFile(byId('readme/particle-exclusion'), relocated))
      .not.toBeNull();

    // A STATED BOUND. Order is checked RELATIVE to the other reviewed blocks,
    // never as an absolute ordinal, so adding an unrelated sibling above them
    // — an ordinary changelog bullet, an ordinary table row — does not fail.
    const changelog = documentOf('CHANGELOG.md');
    const withSibling = changelog.replace(
      raw(byId('changelog/no-public-surface')),
      `- **An unrelated new bullet.** Added above the reviewed run.\n${
        raw(byId('changelog/no-public-surface'))}`
    );
    expect(withSibling).not.toBe(changelog);
    for (const block of PIN.blocks.filter((b) => b.file === 'CHANGELOG.md')) {
      expect(checkFile(block, withSibling), block.id).toBeNull();
    }
  });
});
