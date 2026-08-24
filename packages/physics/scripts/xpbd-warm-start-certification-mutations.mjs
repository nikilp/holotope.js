/**
 * The warm-start segment-certification mutation matrix, with four verdicts
 * per mutation:
 *
 *   applied   the anchor matched and the file changed on disk;
 *   reached   the gate run executed at least one test file;
 *   killed    at least one test failed while the mutation was in place;
 *   restored  the file is byte-identical (sha256) to what it was before.
 *
 * Every row is one of the falsifying controls the P67 commission names: a way
 * the composition correction could be written that LOOKS like the correction
 * and is not. A mutation that survives is reported as a survivor, not hidden.
 *
 * One control was considered and deliberately not added: "recompute the safe
 * endpoint arithmetically instead of installing the exact target". On the
 * fixture's axis-aligned numbers `fl(a + (t - a)) === t` holds exactly, so
 * that row can survive honestly rather than by a gate blind spot; the safe
 * path installs `targetCoordinates.slice()` and the behavioral test asserts
 * exact-array equality against `packPositions(prediction)`, which is the
 * strongest in-build statement available.
 *
 * A second considered shape — poking live particle state after certification
 * and before minimization — is structurally unobservable: the step is
 * transactional, so a refusal restores the poke and an application overwrites
 * it. The observable form of "state advanced despite the verdict" is row 7,
 * which installs the uncertified target on the indeterminate path.
 *
 * Run from the repository root:
 *   node packages/physics/scripts/xpbd-warm-start-certification-mutations.mjs
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
const PHYSICS = resolve(ROOT, 'packages/physics');

const GATE_FILES = [
  'packages/physics/test/xpbd-incremental-potential-warm-start.test.ts'
];

const STEP = 'src/xpbd-incremental-potential-step.ts';
const PROBLEM = 'src/xpbd-incremental-potential-problem.ts';

const sha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const MUTATIONS = [
  {
    id: '1 accept an endpoint-feasible target without consulting filters',
    file: STEP,
    find: `      const certified: XpbdCertifiedWarmStartBaseN | undefined =
        certifyXpbdIncrementalPotentialWarmStartN(
          problem,
          anchorCoordinates,
          targetCoordinates,
          caller
        );`,
    replace: `      const certified: XpbdCertifiedWarmStartBaseN | undefined =
        undefined;`
  },
  {
    id: '2 consult filters but ignore maximumStepLength',
    file: PROBLEM,
    find: '    const fraction = certifiedStepLength / requestedStepLength;',
    replace: '    const fraction = 1;'
  },
  {
    id: '3 treat the certified maximum length as a unitless fraction',
    file: PROBLEM,
    find: '    const fraction = certifiedStepLength / requestedStepLength;',
    replace: '    const fraction = certifiedStepLength;'
  },
  {
    id: '4 consult only the first registered filter',
    file: PROBLEM,
    find: `  const resolution = resolveMostRestrictiveStepFilterN(
    stepFilters,
    requestedStepLength
  );`,
    replace: `  const resolution = resolveMostRestrictiveStepFilterN(
    stepFilters.slice(0, 1),
    requestedStepLength
  );`
  },
  {
    id: '5 certify only the final endpoint',
    file: PROBLEM,
    find: `    problem.unpackPositions(anchorCoordinates),
    problem.unpackPositions(targetCoordinates),`,
    replace: `    problem.unpackPositions(targetCoordinates),
    problem.unpackPositions(targetCoordinates),`
  },
  {
    id: '6 omit bound-obstacle particles from the certified geometry',
    file: PROBLEM,
    find: `    problem.unpackPositions(anchorCoordinates),
    problem.unpackPositions(targetCoordinates),`,
    replace: `    problem.unpackPositions(anchorCoordinates).map((position, index) =>
      problem.particles[index]!.inverseMass === 0
        ? new VecN(position.dim)
        : position),
    problem.unpackPositions(targetCoordinates),`
  },
  {
    id: '7 advance the base despite an indeterminate certification',
    file: PROBLEM,
    find: `      baseCoordinates: anchorCoordinates.slice()
    };
  }
  if (resolution.limitingFilter === undefined) {`,
    replace: `      baseCoordinates: targetCoordinates.slice()
    };
  }
  if (resolution.limitingFilter === undefined) {`
  }
];

function runGates() {
  const output = resolve(PHYSICS, 'test/.warm-start-mutation-run.json');
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
  let gates = { total: 0, failed: 0, ranFiles: [], failedTests: [] };

  if (applied) {
    writeFileSync(path, mutated);
    try {
      gates = runGates();
      reached = gates.total > 0 && gates.ranFiles.length > 0;
      killed = gates.failed > 0;
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
    failedTests: gates.failedTests.slice(0, 4),
    restored: sha256(path) === originalHash,
    testsRun: gates.total,
    testsFailed: gates.failed
  });
  const row = results[results.length - 1];
  process.stdout.write(
    `${row.id.padEnd(62)}applied=${row.applied} reached=${row.reached} `
    + `killed=${row.killed} restored=${row.restored} `
    + `(${row.testsFailed}/${row.testsRun} failed)\n`);
}

// Freshness linkage: the recorded verdicts are a claim about THESE sources
// and THIS gate suite. Without the hashes, the gate would keep attesting that
// seven mutants die long after someone edited the certification or weakened
// the suite — including a regression identical to row 1, which is precisely
// what this matrix exists to name.
const subjects = Object.fromEntries(
  [
    STEP,
    PROBLEM,
    ...GATE_FILES.map((file) => file.replace('packages/physics/', ''))
  ].map((file) => [file, sha256(resolve(PHYSICS, file))]));

writeFileSync(
  resolve(PHYSICS, 'test/xpbd-warm-start-certification-mutations.json'),
  `${JSON.stringify({ gateFiles: GATE_FILES, subjects, results }, null, 2)}\n`);
process.stdout.write('\nwritten: packages/physics/test/'
  + 'xpbd-warm-start-certification-mutations.json\n');
