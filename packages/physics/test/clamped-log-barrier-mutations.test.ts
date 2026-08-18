import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The standing mutation matrix, read back as a gate. The harness
 * (`scripts/clamped-log-barrier-mutations.mjs`) patches, runs the barrier
 * gate suites, and restores; it cannot run inside Vitest because it runs
 * Vitest. This file gates its recorded result: thirteen mutations, each
 * applied, reached, KILLED and restored — including the six defect shapes
 * the commission requires the gates to fail for.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

interface MutationResult {
  readonly id: string;
  readonly file: string;
  readonly applied: boolean;
  readonly reached: boolean;
  readonly killed: boolean;
  readonly killedForIntendedReason?: boolean;
  readonly failedTests?: readonly string[];
  readonly restored: boolean;
  readonly testsRun: number;
  readonly testsFailed: number;
}

const MATRIX = JSON.parse(readFileSync(
  resolve(HERE, 'clamped-log-barrier-mutations.json'), 'utf8')) as {
    readonly gateFiles: readonly string[];
    readonly results: readonly MutationResult[];
  };

describe('clamped-log barrier: the standing mutation matrix', () => {
  it('prints the matrix with the four verdicts kept apart', () => {
    console.log('\nbarrier mutation matrix\n'
      + `  gate suites: ${MATRIX.gateFiles.length} files\n`
      + MATRIX.results.map((row) =>
        `  ${row.id.padEnd(56)}`
        + `applied=${row.applied} reached=${row.reached} `
        + `killed=${row.killed} restored=${row.restored} `
        + `(${row.testsFailed}/${row.testsRun})`).join('\n'));
    expect(MATRIX.results.length).toBe(16);
  });

  it('every mutation was applied, reached, killed and restored', () => {
    for (const row of MATRIX.results) {
      expect(row.applied, `${row.id}: anchor did not match`).toBe(true);
      expect(row.reached, `${row.id}: gates executed nothing`).toBe(true);
      expect(row.killed, `${row.id}: SURVIVED`).toBe(true);
      expect(row.restored, `${row.id}: not byte-identical after`).toBe(true);
      expect(row.testsFailed).toBeGreaterThan(0);
    }
  });

  it('the six commission-required defect shapes are all present and killed',
    () => {
      const ids = MATRIX.results.map((row) => row.id);
      for (const required of [
        'chunked double rounding',
        'per-term subnormal rounding',
        'stale ratio-underflow refusal',
        'all-or-nothing component refusal',
        'implicit default',
        'loosen the referee'
      ]) {
        expect(ids.some((id) => id.includes(required)),
          `missing mutation: ${required}`).toBe(true);
      }
    });

  it('the snapshot mutations (15, 16) are killed by the snapshot fixture',
    () => {
      // P66E-PUB-S: reading the caller's object again — either to evaluate
      // it or to rebuild the published evidence from it — reintroduces the
      // three-way disagreement between validated, computed and published
      // values. Both shapes must die, and die for that reason.
      for (const id of ['15 evaluate the caller object',
        '16 rebuild the published evidence']) {
        const row = MATRIX.results.find((entry) => entry.id.startsWith(id));
        expect(row, `missing mutation: ${id}`).toBeDefined();
        if (row === undefined) continue;
        expect(row.applied && row.reached && row.killed && row.restored)
          .toBe(true);
        expect(row.killedForIntendedReason).toBe(true);
        expect(row.failedTests?.some((name) => name.includes('snapshot')))
          .toBe(true);
      }
    });

  it('mutation 14 — deleting the runtime order guard — is killed for the'
    + ' intended reason', () => {
    // NC1's guard is code that EXISTS now, so the matrix can reach it: the
    // deletion must be killed by the order-guard gates themselves, not by an
    // incidental failure elsewhere.
    const guard = MATRIX.results.find((row) =>
      row.id.includes('delete the runtime order guard'));
    expect(guard).toBeDefined();
    if (guard === undefined) return;
    expect(guard.applied && guard.reached && guard.killed && guard.restored)
      .toBe(true);
    expect(guard.killedForIntendedReason).toBe(true);
    expect(guard.failedTests?.some((name) =>
      name.includes('runtime order guard'))).toBe(true);
  });
});
