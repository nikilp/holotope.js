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

/** Names that must not appear on any object this term publishes. */
const EXCLUDED_MEMBERS: readonly string[] = [
  'kind', 'lawId', 'component', 'level', 'nodes', 'nodeIndex', 'weights',
  'direction', 'directionErrorBound', 'witness', 'activeSlots', 'active',
  'barrier', 'distance', 'restMeasure', 'ruleWeights', 'contribution',
  'truncation', 'replay', 'toRecord', 'fromRecord', 'inflation'
];

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
    for (const published of [compiled, compiled.provider,
      compiled.stepFilter, evaluation]) {
      for (const excluded of EXCLUDED_MEMBERS) {
        expect(excluded in (published as object), excluded).toBe(false);
      }
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
