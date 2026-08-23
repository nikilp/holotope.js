import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The declaration-negative lane, run as a gate rather than described as one.
 *
 * A negative lane is worth exactly as much as its proof that it is populated
 * and that its failures are the intended ones. This asserts both: the program
 * is in the compiled file list, the compiler exits non-zero, and every
 * diagnostic is a "property does not exist" refusal at a marked access.
 *
 * It deliberately lives outside the mutation matrix's gate suites, because it
 * shells out to `tsc` and the matrix runs its gates thirty times.
 *
 * Declaration privacy is NOT the boundary this stage was corrected for.
 * TypeScript `private` produced a clean negative lane while the packed objects
 * were fully mutable; that is why the runtime half exists separately, and why
 * neither lane may be reported as covering the other.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(
  HERE, 'xpbd-source-simplex-measure-barrier-negatives.tsconfig.json'
);
const ROOT = resolve(HERE, '../../..');

function compile(extra: readonly string[] = []): {
  readonly status: number; readonly output: string;
} {
  try {
    const output = execFileSync(
      'node_modules/.bin/tsc', ['-p', PROJECT, ...extra],
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }
    );
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    return { status: failure.status ?? -1, output: failure.stdout ?? '' };
  }
}

describe('the measure barrier: the declaration-negative lane', () => {
  it('is populated, refuses every private access, and refuses nothing else',
    () => {
    const listed = compile(['--listFiles']);
    expect(listed.output).toContain(
      'test/xpbd-source-simplex-measure-barrier-negatives.ts'
    );

    const { status, output } = compile();
    const diagnostics = output.split('\n').filter((line) =>
      / error TS\d+:/u.test(line));
    console.log('\nmeasure-barrier declaration negatives'
      + `\n  tsc exit status : ${status}`
      + `\n  diagnostics     : ${diagnostics.length}`);
    // Non-zero by design: every line of the program is meant to fail.
    expect(status).toBeGreaterThan(0);
    // Nineteen marked accesses, and nothing else went wrong.
    expect(diagnostics).toHaveLength(19);
    for (const diagnostic of diagnostics) {
      // TS2339 is "property does not exist"; TS2551 is the same refusal with
      // a spelling suggestion, which `cellParticles` attracts from
      // `particles`. Any other code would mean the lane failed for an
      // unintended reason and proves nothing about privacy.
      expect(diagnostic, diagnostic).toMatch(/error TS(2339|2551):/u);
      expect(diagnostic, diagnostic).toMatch(/does not exist on type/u);
    }
  }, 120000);
});
