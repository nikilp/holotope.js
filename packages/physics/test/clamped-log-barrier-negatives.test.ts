import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * The five compile-time negatives. Each names a misuse the SIGNATURE must
 * reject — most importantly the implicit order — and each is calibrated by a
 * REPAIR that silences it alone, so a signature change that quietly starts
 * accepting the misuse fails here rather than in a consumer.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BARRIER = resolve(HERE, '../src/clamped-log-barrier.ts');

const PRELUDE = `import {
  evaluateClampedLogBarrierAtOrderN
} from '${BARRIER.replace(/\\/g, '/')}';
const inputs = { coordinate: 0.5, activation: 1, stiffness: 1 };
`;

interface Negative {
  readonly name: string;
  /** Must NOT compile. */
  readonly broken: string;
  /** The one repair that silences it; must compile clean. */
  readonly repaired: string;
}

const NEGATIVES: readonly Negative[] = [
  {
    name: 'calling without an order is rejected — there is no default',
    broken: `const r = (evaluateClampedLogBarrierAtOrderN as any as
      (i: typeof inputs) => unknown); evaluateClampedLogBarrierAtOrderN(
      inputs);`,
    repaired: `evaluateClampedLogBarrierAtOrderN(inputs, 0);`
  },
  {
    name: 'reading value off an un-narrowed component is rejected',
    broken: `const r = evaluateClampedLogBarrierAtOrderN(inputs, 0);
      const v: number = r.energy.value;`,
    repaired: `const r = evaluateClampedLogBarrierAtOrderN(inputs, 0);
      const v: number = r.energy.available ? r.energy.value : 0; void v;`
  },
  {
    name: 'reading a derivative that was not requested is rejected',
    broken: `const r = evaluateClampedLogBarrierAtOrderN(inputs, 1);
      const c = r.secondDerivative;`,
    repaired: `const r = evaluateClampedLogBarrierAtOrderN(inputs, 2);
      const c = r.secondDerivative; void c;`
  },
  {
    name: 'writing a result field is rejected — results are readonly',
    broken: `const r = evaluateClampedLogBarrierAtOrderN(inputs, 0);
      r.active = false;`,
    repaired: `const r = evaluateClampedLogBarrierAtOrderN(inputs, 0);
      const active = r.active; void active;`
  },
  {
    name: 'an out-of-range order is rejected',
    broken: `evaluateClampedLogBarrierAtOrderN(inputs, 3);`,
    repaired: `evaluateClampedLogBarrierAtOrderN(inputs, 2);`
  }
];

/** Compiles one virtual snippet against the real source tree. */
function diagnose(source: string): readonly ts.Diagnostic[] {
  const virtualName = resolve(HERE, '__negative__.ts');
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    skipLibCheck: true
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (name) =>
    resolve(name) === virtualName ? source : readFile(name);
  host.fileExists = (name) =>
    resolve(name) === virtualName ? true : fileExists(name);
  const program = ts.createProgram([virtualName], options, host);
  return ts.getPreEmitDiagnostics(program).filter((diagnostic) =>
    diagnostic.file !== undefined
    && resolve(diagnostic.file.fileName) === virtualName);
}

describe('clamped-log barrier: compile-time negatives, calibrated', () => {
  for (const negative of NEGATIVES) {
    it(negative.name, () => {
      const broken = diagnose(PRELUDE + negative.broken);
      expect(broken.length,
        `expected the broken form to fail: ${negative.broken}`)
        .toBeGreaterThan(0);
      const repaired = diagnose(PRELUDE + negative.repaired);
      expect(repaired.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')))
        .toEqual([]);
    });
  }
});
