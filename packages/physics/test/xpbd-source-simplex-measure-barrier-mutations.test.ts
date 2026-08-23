import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The standing mutation matrix, read back as a gate. The harness
 * (`packages/physics/scripts/xpbd-source-simplex-measure-barrier-mutations.mjs`)
 * patches the law, runs its two gate suites, and restores; it cannot run
 * inside Vitest because it runs Vitest. This file gates its recorded result.
 *
 * The matrix is the answer to "would these tests notice?". Each row is a
 * defect a reader could plausibly write, and each verdict is kept separate:
 * a mutation that never applied proves nothing about the gates, and one that
 * applied but was never reached proves nothing either.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

interface MutationResult {
  readonly id: string;
  readonly file: string;
  readonly applied: boolean;
  readonly reached: boolean;
  readonly killed: boolean;
  readonly failedTests: readonly string[];
  readonly restored: boolean;
  readonly testsRun: number;
  readonly testsFailed: number;
}

const MATRIX = JSON.parse(readFileSync(
  resolve(HERE, 'xpbd-source-simplex-measure-barrier-mutations.json'),
  'utf8'
)) as {
  readonly gateFiles: readonly string[];
  readonly results: readonly MutationResult[];
};

describe('the measure barrier: the standing mutation matrix', () => {
  it('prints the matrix with the four verdicts kept apart', () => {
    console.log('\nmeasure-barrier mutation matrix\n'
      + `  gate suites: ${MATRIX.gateFiles.length} files\n`
      + MATRIX.results.map((row) =>
        `  ${row.id.padEnd(56)}`
        + `applied=${row.applied} reached=${row.reached} `
        + `killed=${row.killed} restored=${row.restored} `
        + `(${row.testsFailed}/${row.testsRun})`).join('\n'));
    expect(MATRIX.results.length).toBe(30);
    expect(MATRIX.gateFiles).toEqual([
      'packages/physics/test/xpbd-source-simplex-measure-barrier.test.ts',
      'packages/physics/test/xpbd-source-simplex-measure-barrier-surface.test.ts'
    ]);
  });

  it('every mutation was applied, reached, killed and restored', () => {
    for (const row of MATRIX.results) {
      expect(row.applied, `${row.id}: anchor did not match`).toBe(true);
      expect(row.reached, `${row.id}: gates executed nothing`).toBe(true);
      expect(row.killed, `${row.id}: SURVIVED`).toBe(true);
      expect(row.restored, `${row.id}: not byte-identical after`).toBe(true);
      expect(row.testsFailed, row.id).toBeGreaterThan(0);
      expect([
        'src/xpbd-source-simplex-measure-barrier.ts',
        '../../docs/learn/physics/deformable.md',
        '../../fixtures/packed-consumer/src/checks.ts'
      ], row.id).toContain(row.file);
    }
  });

  it('covers every claim the law makes, not only the arithmetic', () => {
    const ids = MATRIX.results.map((row) => row.id);
    // Each phrase names a DIFFERENT claim: the measure weight and where it is
    // read from, the rule's node set and placement, the gradient's agreement
    // with the energy, each refusal arm, the kinematic-obstacle rule, and the
    // filter's bound. A matrix that only mutated arithmetic would leave the
    // configuration and refusal boundaries untested.
    for (const required of [
      'reference-measure weight',
      'live measure',
      'collapse the rule',
      'anchored affine form',
      'obstacle reaction',
      'curvature the term does not use',
      'certified-distance gate',
      'direction-policy gate',
      'rank deficiency permanent',
      'not kinematic',
      'two endpoints',
      'conservative scale',
      'largest node margin',
      'unknown-option check',
      // The runtime-privacy and claim-language shapes. An earlier matrix was
      // 22 of 22 green and missed every one of these, which is why a matrix
      // is only ever evidence about the defects it contains: the packed
      // objects were fully mutable, and the documentation asserted an
      // invariance the law does not have.
      'expose the fixed rule',
      'expose the reference measure',
      'expose the static-obstacle',
      'expose the conservative scale',
      'expose the provider through the filter',
      'stop freezing',
      'restore the general refinement-invariance wording',
      'restore the packed-consumer general-invariance assertion'
    ]) {
      expect(ids.some((id) => id.includes(required)),
        `missing mutation: ${required}`).toBe(true);
    }
  });
});
