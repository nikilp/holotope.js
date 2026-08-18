/**
 * The clamped-log barrier's standing mutation matrix, with four verdicts per
 * mutation:
 *
 *   applied   the anchor matched and the file changed on disk;
 *   reached   the gate run executed at least one test file;
 *   killed    at least one test failed while the mutation was in place;
 *   restored  the file is byte-identical (sha256) to what it was before.
 *
 * The set carries the eight G6 contract mutations and the P66F defect
 * shapes, so the gates demonstrably fail for: chunked double rounding,
 * per-term subnormal rounding, the stale ratio-underflow refusal, the
 * all-or-nothing component refusal, an implicit/default order, and the old
 * loose accuracy allowance.
 *
 * Run from the repository root:
 *   node packages/physics/scripts/clamped-log-barrier-mutations.mjs
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
const PHYSICS = resolve(ROOT, 'packages/physics');

const GATE_FILES = [
  'packages/physics/test/clamped-log-barrier.test.ts',
  'packages/physics/test/clamped-log-barrier-referee.test.ts',
  'packages/physics/test/clamped-log-barrier-terms.test.ts',
  'packages/physics/test/clamped-log-barrier-negatives.test.ts'
];

const sha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const CORE = 'src/clamped-log-barrier-core.ts';
const SURFACE = 'src/clamped-log-barrier.ts';
const REFEREE = 'test/support/clamped-log-barrier-referee.ts';

const MUTATIONS = [
  {
    id: '1 chunked double rounding (revert applyExponent)',
    file: CORE,
    find: `  if (exponent >= -1022 && exponent <= 1023) {
    return significand * 2 ** exponent;
  }
  if (exponent > 1023) {
    // |true| ≥ 2^-8 · 2^exponent, so past 2100 the result is Infinity however
    // it is assembled; below that, one exact lift keeps the multiply single.
    if (exponent > 2100) return significand > 0 ? Infinity : -Infinity;
    const lifted = significand * 2 ** 1000;        // exact: |lifted| < 2^1004
    return lifted * 2 ** (exponent - 1000);
  }
  // exponent < -1022. |true| < 16 · 2^exponent, so below −2074 the result is
  // under half of MIN_VALUE and rounds to signed zero.
  if (exponent < -2074) return significand > 0 ? 0 : -0;
  const lowered = significand * 2 ** -1000;        // exact: |lowered| > 2^-1008
  return lowered * 2 ** (exponent + 1000);         // ∈ [-1074, -23]: one rounding
}`,
    replace: `  let value = significand;
  let remaining = exponent;
  while (remaining > 1023) {
    value *= 2 ** 1023; remaining -= 1023;
    if (!Number.isFinite(value)) return value;
  }
  while (remaining < -1074) {
    value *= 2 ** -1074; remaining += 1074;
    if (value === 0) return value;
  }
  return value * 2 ** remaining;
}`
  },
  {
    id: '2 per-term subnormal rounding (emit each term, then add)',
    file: CORE,
    find: `  let sum = 0;
  for (const part of ordered) {
    const gap = part.exponent - maxExponent;       // ≤ 0
    // 2^gap is exact down to -1074 and 0 below, so a term too far below the
    // leader contributes exactly nothing — correct to < 2^-1050 relative.
    sum += part.significand * 2 ** Math.max(gap, -1074);
  }
  return applyExponent(sum, maxExponent);`,
    replace: `  let emitted = 0;
  for (const part of ordered) {
    emitted += applyExponent(part.significand, part.exponent);
  }
  return emitted;`
  },
  {
    id: '3 stale ratio-underflow refusal reinstated',
    file: SURFACE,
    find: `  validateOrder(order);
  const core = evaluateBarrierCore(inputs, order);`,
    replace: `  validateOrder(order);
  const staleRatio = inputs.coordinate / inputs.activation;
  if (!(staleRatio > 0) || !Number.isFinite(staleRatio)) {
    throw new ClampedLogBarrierInputErrorN(
      'normalized coordinate is outside Float64');
  }
  const core = evaluateBarrierCore(inputs, order);`
  },
  {
    id: '4 all-or-nothing component refusal',
    file: SURFACE,
    find: `  return Object.freeze({
    ...force, secondDerivative: componentOf(core.secondDerivative)
  }) as ClampedLogBarrierEvaluationForN<O>;`,
    replace: `  const second = componentOf(core.secondDerivative);
  const unavailable = Object.freeze(
    { available: false, reason: 'outside-float64' });
  const all = second.available && force.energy.available
    && force.firstDerivative.available;
  return Object.freeze({
    inputs: force.inputs, active: force.active,
    energy: all ? force.energy : unavailable,
    firstDerivative: all ? force.firstDerivative : unavailable,
    secondDerivative: all ? second : unavailable
  }) as ClampedLogBarrierEvaluationForN<O>;`
  },
  {
    id: '5 replace unavailable with numeric zero',
    file: SURFACE,
    find: `const componentOf = (value: number | undefined): BarrierComponentN =>
  value === undefined || !Number.isFinite(value)
    ? Object.freeze(
      { available: false as const, reason: 'outside-float64' as const })
    : Object.freeze({ available: true as const, value });`,
    replace: `const componentOf = (value: number | undefined): BarrierComponentN =>
  value === undefined || !Number.isFinite(value)
    ? Object.freeze({ available: true as const, value: 0 })
    : Object.freeze({ available: true as const, value });`
  },
  {
    id: '6 retain the mutable caller inputs',
    file: SURFACE,
    find: `  const record: ClampedLogBarrierInputsN = Object.freeze({
    coordinate: inputs.coordinate,
    activation: inputs.activation,
    stiffness: inputs.stiffness
  });`,
    replace: `  const record: ClampedLogBarrierInputsN = inputs;`
  },
  {
    id: '7 omit the attached inputs',
    file: SURFACE,
    find: `  const value: ClampedLogBarrierValueN = Object.freeze({
    inputs: record, active: core.active, energy: componentOf(core.energy)
  });`,
    replace: `  const value = Object.freeze({
    active: core.active, energy: componentOf(core.energy)
  }) as unknown as ClampedLogBarrierValueN;`
  },
  {
    id: '8 leak internal state on the result',
    file: SURFACE,
    find: `  const value: ClampedLogBarrierValueN = Object.freeze({
    inputs: record, active: core.active, energy: componentOf(core.energy)
  });`,
    replace: `  const value: ClampedLogBarrierValueN = Object.freeze({
    inputs: record, active: core.active, energy: componentOf(core.energy),
    significandTrace: 0.5
  } as ClampedLogBarrierValueN);`
  },
  {
    id: '9 recompute the curvature with the textbook grouping',
    file: CORE,
    find: `  const aMinusX = a - x;
  const negatedLogPart = scaledTermParts([2, k, L], []);
  const secondDerivative = combineSameSigned([
    scaledTermParts([k, aMinusX, aMinusX], [x, x]),
    scaledTermParts([4, k, aMinusX], [x]),
    { significand: -negatedLogPart.significand,
      exponent: negatedLogPart.exponent }
  ]);`,
    replace: `  const ratio = a / x;
  operationCount += 3;
  const secondDerivative = k * (ratio * ratio + 2 * ratio - 2 * L - 3);`
  },
  {
    id: '10 normalize signed zero',
    file: SURFACE,
    find: `    : Object.freeze({ available: true as const, value });`,
    replace: `    : Object.freeze({ available: true as const,
      value: value === 0 ? 0 : value });`
  },
  {
    id: '11 construct an unrequested derivative',
    file: SURFACE,
    find: `  const core = evaluateBarrierCore(inputs, order);`,
    replace: `  const core = evaluateBarrierCore(inputs, 2);`
  },
  {
    id: '12 give order an implicit default',
    file: SURFACE,
    find: `export function evaluateClampedLogBarrierAtOrderN<
  O extends BarrierDerivativeOrder
>(
  inputs: ClampedLogBarrierInputsN,
  order: O
): ClampedLogBarrierEvaluationForN<O> {`,
    replace: `export function evaluateClampedLogBarrierAtOrderN<
  O extends BarrierDerivativeOrder
>(
  inputs: ClampedLogBarrierInputsN,
  order: O = 2 as O
): ClampedLogBarrierEvaluationForN<O> {`
  },
  {
    id: '14 delete the runtime order guard',
    file: SURFACE,
    find: `function validateOrder(order: BarrierDerivativeOrder): void {
  if (order === 0 || order === 1 || order === 2) return;
  throw new ClampedLogBarrierInputErrorN('order must be exactly 0, 1 or 2');
}`,
    replace: `function validateOrder(order: BarrierDerivativeOrder): void {
  void order;
}`,
    expectedReason: 'runtime order guard'
  },
  {
    id: '13 loosen the referee to the old allowance class',
    file: REFEREE,
    find: `  const magnitudeInUlps = Math.abs(toNumber(divide(absolute(exact), MIN_BF)));
  return 0.5 + NORMAL_RELATIVE_BOUND * magnitudeInUlps;`,
    replace: `  const magnitudeInUlps = Math.abs(toNumber(divide(absolute(exact), MIN_BF)));
  return 0.5 + 4.5e15 * NORMAL_RELATIVE_BOUND * magnitudeInUlps;`
  }
];

function runGates() {
  const output = resolve(PHYSICS, 'test/.mutation-run.json');
  let failed = 0;
  let total = 0;
  let ranFiles = [];
  let failedTests = [];
  try {
    execFileSync('pnpm', ['exec', 'vitest', 'run',
      '--reporter=json', `--outputFile=${output}`, ...GATE_FILES],
    { cwd: ROOT, stdio: 'pipe' });
  } catch { /* a non-zero exit is the signal */ }
  try {
    const report = JSON.parse(readFileSync(output, 'utf8'));
    total = report.numTotalTests ?? 0;
    failed = report.numFailedTests ?? 0;
    ranFiles = (report.testResults ?? []).map((entry) =>
      entry.name.split('/').pop());
    failedTests = (report.testResults ?? []).flatMap((entry) =>
      (entry.assertionResults ?? [])
        .filter((assertion) => assertion.status === 'failed')
        .map((assertion) => assertion.fullName));
  } catch { /* treated as zero tests run */ }
  try { execFileSync('rm', ['-f', output]); } catch { /* best effort */ }
  return { total, failed, ranFiles, failedTests };
}

const results = [];
for (const mutation of MUTATIONS) {
  const path = resolve(PHYSICS, mutation.file);
  const original = readFileSync(path, 'utf8');
  const originalHash = sha256(path);

  const mutated = original.replace(mutation.find, mutation.replace);
  const applied = mutated !== original;
  let reached = false;
  let killed = false;
  let killedForIntendedReason;
  let gates = { total: 0, failed: 0, ranFiles: [], failedTests: [] };

  if (applied) {
    writeFileSync(path, mutated);
    try {
      gates = runGates();
      reached = gates.total > 0 && gates.ranFiles.length > 0;
      killed = gates.failed > 0;
      if (mutation.expectedReason !== undefined) {
        killedForIntendedReason = gates.failedTests.some((name) =>
          name.toLowerCase().includes(mutation.expectedReason.toLowerCase()));
      }
    } finally {
      writeFileSync(path, original);
    }
  }

  results.push({
    id: mutation.id,
    file: mutation.file,
    applied,
    reached,
    killed,
    ...(killedForIntendedReason === undefined ? {}
      : { killedForIntendedReason,
        failedTests: gates.failedTests.slice(0, 6) }),
    restored: sha256(path) === originalHash,
    testsRun: gates.total,
    testsFailed: gates.failed
  });
  const row = results[results.length - 1];
  process.stdout.write(
    `${row.id.padEnd(56)}applied=${row.applied} reached=${row.reached} `
    + `killed=${row.killed} restored=${row.restored} `
    + `(${row.testsFailed}/${row.testsRun} failed)\n`);
}

writeFileSync(resolve(PHYSICS, 'test/clamped-log-barrier-mutations.json'),
  `${JSON.stringify({ gateFiles: GATE_FILES, results }, null, 2)}\n`);
process.stdout.write(
  '\nwritten: packages/physics/test/clamped-log-barrier-mutations.json\n');
