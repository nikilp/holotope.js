import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The warm-start certification's standing mutation matrix, read back as a
 * gate. The harness
 * (`packages/physics/scripts/xpbd-warm-start-certification-mutations.mjs`)
 * patches the solver composition, runs the focused warm-start suite, and
 * restores; it cannot run inside Vitest because it runs Vitest. This file
 * gates its recorded result.
 *
 * Each row is one of the falsifying controls the P67 commission names — a way
 * of writing the composition that looks like the correction and is not:
 * skipping certification for an endpoint-feasible target, ignoring the
 * certified maximum length, treating that length as a unitless fraction,
 * consulting only the first filter, certifying only the final endpoint,
 * dropping bound-obstacle particles from the certified geometry, and advancing
 * the base despite an indeterminate verdict.
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
  resolve(HERE, 'xpbd-warm-start-certification-mutations.json'), 'utf8'
)) as {
  readonly gateFiles: readonly string[];
  readonly subjects: Readonly<Record<string, string>>;
  readonly results: readonly MutationResult[];
};

describe('warm-start certification: the standing mutation matrix', () => {
  it('prints the matrix with the four verdicts kept apart', () => {
    console.log('\nwarm-start certification mutation matrix\n'
      + `  gate suites: ${MATRIX.gateFiles.length} file(s)\n`
      + MATRIX.results.map((row) =>
        `  ${row.id.padEnd(62)}`
        + `applied=${row.applied} reached=${row.reached} `
        + `killed=${row.killed} restored=${row.restored} `
        + `(${row.testsFailed}/${row.testsRun})`).join('\n'));
    expect(MATRIX.results.length).toBe(7);
    expect(MATRIX.gateFiles).toEqual([
      'packages/physics/test/xpbd-incremental-potential-warm-start.test.ts'
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
        'src/xpbd-incremental-potential-step.ts',
        'src/xpbd-incremental-potential-problem.ts'
      ], row.id).toContain(row.file);
    }
  });

  it('is fresh: the recorded verdicts are about the current sources and the '
    + 'current gate suite', () => {
    // A matrix without this check keeps attesting that seven mutants die long
    // after the certification was edited or the suite weakened — silently
    // stale in exactly the case it exists to catch.
    const physics = resolve(HERE, '..');
    const entries = Object.entries(MATRIX.subjects);
    expect(entries.length).toBe(3);
    for (const [file, recorded] of entries) {
      const actual = createHash('sha256')
        .update(readFileSync(resolve(physics, file))).digest('hex');
      expect(actual, `${file} changed since the matrix was recorded; re-run`
        + ' packages/physics/scripts/xpbd-warm-start-certification-mutations.mjs')
        .toBe(recorded);
    }
    expect(Object.keys(MATRIX.subjects).sort()).toEqual([
      'src/xpbd-incremental-potential-problem.ts',
      'src/xpbd-incremental-potential-step.ts',
      'test/xpbd-incremental-potential-warm-start.test.ts'
    ]);
  });

  it('covers every commissioned falsifying control', () => {
    const ids = MATRIX.results.map((row) => row.id);
    for (const required of [
      'without consulting filters',
      'ignore maximumStepLength',
      'unitless fraction',
      'only the first registered filter',
      'only the final endpoint',
      'omit bound-obstacle',
      'despite an indeterminate'
    ]) {
      expect(ids.some((id) => id.includes(required)),
        `missing mutation: ${required}`).toBe(true);
    }
  });
});
