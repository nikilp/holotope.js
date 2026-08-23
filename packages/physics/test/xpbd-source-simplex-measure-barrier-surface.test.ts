import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CellComplex, VecN, createSourceCellReferenceN, createSourceSimplexReferenceN } from '@holotope/core';
import {
  compileXpbdParticleBindingN,
  compileXpbdSourceSimplexMeasureBarrierN
} from '../src/index.js';

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
