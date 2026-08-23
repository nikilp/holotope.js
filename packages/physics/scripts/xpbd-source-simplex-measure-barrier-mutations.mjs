/**
 * The measure-weighted normal-contact law's standing mutation matrix, with
 * four verdicts per mutation:
 *
 *   applied   the anchor matched and the file changed on disk;
 *   reached   the gate run executed at least one test file;
 *   killed    at least one test failed while the mutation was in place;
 *   restored  the file is byte-identical (sha256) to what it was before.
 *
 * Every mutation is a defect a reader could plausibly write: a measure weight
 * taken from the wrong configuration, a rule collapsed to its centroid, a
 * gradient that disagrees with the position it differentiates, a refusal arm
 * quietly dropped, and a step filter that trusts the ends of a segment. A
 * mutation that SURVIVES is reported as a survivor, not hidden — it names a
 * property the gates do not yet resolve.
 *
 * Run from the repository root:
 *   node packages/physics/scripts/xpbd-source-simplex-measure-barrier-mutations.mjs
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');
const PHYSICS = resolve(ROOT, 'packages/physics');

const GATE_FILES = [
  'packages/physics/test/xpbd-source-simplex-measure-barrier.test.ts',
  'packages/physics/test/xpbd-source-simplex-measure-barrier-surface.test.ts'
];

const LAW = 'src/xpbd-source-simplex-measure-barrier.ts';
/** Claim sites outside the law's own module, relative to the repository. */
const GUIDE = '../../docs/learn/physics/deformable.md';
const CONSUMER = '../../fixtures/packed-consumer/src/checks.ts';

const sha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const MUTATIONS = [
  {
    id: '1 drop the reference-measure weight',
    find: 'const reduced = ledger.reduce(referenceMeasure);',
    replace: 'const reduced = ledger.reduce(1);'
  },
  {
    id: '2 weight by the live measure, not the rest measure',
    find: 'const reduced = ledger.reduce(referenceMeasure);',
    replace: `const reduced = ledger.reduce(evaluateSimplexSquaredMeasureN(
      cellParticles.map((_, slot) => new VecN(Array.from(
        { length: dimension },
        (__, axis) => cell[slot * dimension + axis]
      )))
    ).measure);`
  },
  {
    id: '3 square the measure weight',
    find: 'const reduced = ledger.reduce(referenceMeasure);',
    replace:
      'const reduced = ledger.reduce(referenceMeasure * referenceMeasure);'
  },
  {
    id: '4 collapse the rule to its centroid',
    find: `  return Object.freeze(Array.from({ length: slots }, (_, ownSlot) =>
    Object.freeze({
      ownSlot,
      coefficients: Object.freeze(Array.from(
        { length: slots }, (__, slot) => slot === ownSlot ? own : beta
      )),
      weight
    })
  ));`,
    replace: `  return Object.freeze([Object.freeze({
    ownSlot: 0,
    coefficients: Object.freeze(Array.from({ length: slots }, () => weight)),
    weight: 1
  })]);`
  },
  {
    id: '5 place every node at its own vertex',
    find: `        value += node.coefficients[slot]! *
          (cell[slot * dimension + axis]! - cell[anchor + axis]!);`,
    replace: '        value += 0;'
  },
  {
    id: '6 raw weighted sum instead of the anchored affine form',
    find: `    const anchor = node.ownSlot * dimension;
    for (let axis = 0; axis < dimension; axis++) {
      let value = cell[anchor + axis]!;
      for (let slot = 0; slot < node.coefficients.length; slot++) {
        if (slot === node.ownSlot) continue;
        value += node.coefficients[slot]! *
          (cell[slot * dimension + axis]! - cell[anchor + axis]!);
      }
      point[axis] = value;
    }`,
    replace: `    for (let axis = 0; axis < dimension; axis++) {
      let value = 0;
      for (let slot = 0; slot < node.coefficients.length; slot++) {
        value += node.coefficients[slot]! * cell[slot * dimension + axis]!;
      }
      point[axis] = value;
    }`
  },
  {
    id: '7 omit the obstacle reaction',
    find: `      if (obstacleParticles !== undefined) {
        const offset = cellParticles.length;
        for (let slot = 0; slot < obstacleParticles.length; slot++) {
          ledger.accumulate(
            offset + slot, -share * projected.witness.weights[slot]!, direction
          );
        }
      }`,
    replace: ''
  },
  {
    id: '8 flip the sign of the obstacle reaction',
    find: '            offset + slot, -share * projected.witness.weights[slot]!, direction',
    replace: '            offset + slot, share * projected.witness.weights[slot]!, direction'
  },
  {
    id: '9 publish the gradient itself as the force',
    find: '        force.data[axis] = -referenceMeasure * this.gradient[base + axis]!;',
    replace: '        force.data[axis] = referenceMeasure * this.gradient[base + axis]!;'
  },
  {
    id: '10 use the barrier energy where its derivative belongs',
    find: '      const share = quadrature.weight * barrier.firstDerivative.value;',
    replace: '      const share = quadrature.weight * barrier.energy.value;'
  },
  {
    id: '11 request a curvature the term does not use',
    find: `        stiffness
      }, 1);`,
    replace: `        stiffness
      }, 2);`
  },
  {
    id: '12 drop the rule weight from the energy',
    find: '      ledger.recordEnergy(node, quadrature.weight * barrier.energy.value);',
    replace: '      ledger.recordEnergy(node, barrier.energy.value);'
  },
  {
    id: '13 drop the certified-distance gate',
    find: `      if (!(certifiedDistanceLowerBound(
        projected.witness.squaredDistance,
        projected.error.squaredDistanceErrorBound
      ) > minimumDistance)) {
        throw refuse('minimum-distance-not-certified',
          \`\${caller}: node \${node}'s distance error bound reaches minimumDistance\`);
      }`,
    replace: ''
  },
  {
    id: '14 drop the direction-policy gate',
    find: `      if (projected.error.directionErrorBound > maximumDirectionError) {
        throw refuse('direction-error-exceeds-policy',`,
    replace: `      if (false && projected.error.directionErrorBound > maximumDirectionError) {
        throw refuse('direction-error-exceeds-policy',`
  },
  {
    id: '15 check only the energy component, not the derivative',
    find: '      if (!barrier.energy.available || !barrier.firstDerivative.available) {',
    replace: '      if (!barrier.energy.available) {'
  },
  {
    id: '16 make a candidate-time rank deficiency permanent',
    find: `      throw refuse('obstacle-rank-deficient',
        \`\${caller}: the obstacle simplex is exactly rank-deficient \` +
        \`(rank \${result.exactRank}) at this candidate\`);`,
    replace: `      throw new Error(
        \`\${caller}: the obstacle simplex is exactly rank-deficient \` +
        \`(rank \${result.exactRank}) at this candidate\`);`
  },
  {
    id: '17 accept an obstacle binding that is not kinematic',
    find: `      if (particle.inverseMass !== 0) {
        throw new Error(
          \`\${caller}: obstacle particle \${slot} has inverseMass \` +
          \`\${particle.inverseMass}; a bound obstacle must be kinematic \` +
          '(inverseMass 0) because this law weights only the cell'
        );
      }`,
    replace: ''
  },
  {
    id: '18 certify the whole segment from its two endpoints',
    find: '    if (total === 0 || total < start.margin) {',
    replace: '    if (true) {'
  },
  {
    id: '19 drop the conservative scale from the certified prefix',
    find: '      (conservativeScale * start.margin / total);',
    replace: '      (start.margin / total);'
  },
  {
    id: '20 certify against the largest node margin',
    find: `    let smallest = Number.POSITIVE_INFINITY;`,
    replace: `    let smallest = 0;`,
    also: {
      find: `      smallest = Math.min(smallest, certifiedDistanceLowerBound(`,
      replace: `      smallest = Math.max(smallest, certifiedDistanceLowerBound(`
    }
  },
  {
    id: '21 skip the unknown-option check',
    find: `  if (unknown.length > 0) {
    throw new Error(
      \`\${caller}: unknown option\${unknown.length === 1 ? '' : 's'} \` +
      unknown.sort().map((key) => \`"\${key}"\`).join(', ')
    );
  }`,
    replace: ''
  },
  {
    id: '22 give the direction policy a default',
    find: `  if (options.maximumDirectionError === undefined) {
    throw new Error(
      \`\${caller}: maximumDirectionError is required (the exact \` +
      'point--simplex query publishes a direction enclosure; author the ' +
      'policy explicitly)'
    );
  }`,
    replace: `  if (options.maximumDirectionError === undefined) {
    options = { ...options, maximumDirectionError: 1e-6 };
  }`
  },
  {
    id: '23 expose the fixed rule as a writable property',
    find: `  const provider: XpbdConservativeForceProviderN = Object.freeze({
    id,
    dimension,
    particles,`,
    replace: `  const provider = Object.freeze({
    id,
    dimension,
    particles,
    rule,`
  },
  {
    id: '24 expose the reference measure',
    find: `  const provider: XpbdConservativeForceProviderN = Object.freeze({
    id,
    dimension,
    particles,`,
    replace: `  const provider = Object.freeze({
    id,
    dimension,
    particles,
    referenceMeasure,`
  },
  {
    id: '25 expose the static-obstacle typed buffer',
    find: `  const provider: XpbdConservativeForceProviderN = Object.freeze({
    id,
    dimension,
    particles,`,
    replace: `  const provider = Object.freeze({
    id,
    dimension,
    particles,
    staticObstacle,`
  },
  {
    id: '26 expose the conservative scale',
    find: `  const stepFilter: XpbdIncrementalPotentialStepFilterN = Object.freeze({
    id: \`\${id}-filter\`,`,
    replace: `  const stepFilter = Object.freeze({
    conservativeScale,
    id: \`\${id}-filter\`,`
  },
  {
    id: '27 expose the provider through the filter',
    find: `  const stepFilter: XpbdIncrementalPotentialStepFilterN = Object.freeze({
    id: \`\${id}-filter\`,`,
    replace: `  const stepFilter = Object.freeze({
    provider,
    id: \`\${id}-filter\`,`
  },
  {
    id: '28 stop freezing the exposed instances',
    find: `  const provider: XpbdConservativeForceProviderN = Object.freeze({`,
    replace: `  const provider: XpbdConservativeForceProviderN = ({`,
    also: {
      find: `    evaluateAt
  });`,
      replace: `    evaluateAt
  } as XpbdConservativeForceProviderN);`
    }
  },
  {
    id: '29 restore the general refinement-invariance wording',
    file: GUIDE,
    find: `Splitting a cell splits \`mu0\` between the halves, so two cells do not answer
twice for one contact.`,
    replace: `Subdividing a cell splits \`mu0\` between the halves, so the same contact
publishes the same energy however finely it is meshed.`
  },
  {
    id: '30 restore the packed-consumer general-invariance assertion',
    file: CONSUMER,
    find: `    'a CONSTANT-distance cell must be exactly additive under subdivision');`,
    replace: `    'subdividing a cell must not change a measure-weighted contact energy');`
  }
];

function runGates() {
  const output = resolve(PHYSICS, 'test/.measure-mutation-run.json');
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
  const file = mutation.file ?? LAW;
  const path = resolve(PHYSICS, file);
  const original = readFileSync(path, 'utf8');
  const originalHash = sha256(path);

  let mutated = original.replace(mutation.find, mutation.replace);
  let applied = mutated !== original;
  if (applied && mutation.also !== undefined) {
    const second = mutated.replace(mutation.also.find, mutation.also.replace);
    applied = second !== mutated;
    mutated = second;
  }
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
    file,
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
    `${row.id.padEnd(56)}applied=${row.applied} reached=${row.reached} `
    + `killed=${row.killed} restored=${row.restored} `
    + `(${row.testsFailed}/${row.testsRun} failed)\n`);
}

writeFileSync(
  resolve(PHYSICS, 'test/xpbd-source-simplex-measure-barrier-mutations.json'),
  `${JSON.stringify({ gateFiles: GATE_FILES, results }, null, 2)}\n`);
process.stdout.write('\nwritten: packages/physics/test/'
  + 'xpbd-source-simplex-measure-barrier-mutations.json\n');
