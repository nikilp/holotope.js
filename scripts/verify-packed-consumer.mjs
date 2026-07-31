/**
 * Packed-consumer conformance.
 *
 *   node scripts/verify-packed-consumer.mjs [--keep]
 *
 * Packs the five public artifacts, installs them into a project created under
 * the OS temporary directory, and exercises them exactly as an outside caller
 * would: strict typecheck, headless composition, and a browser production
 * build.
 *
 * ## Why the consumer is isolated structurally
 *
 * Instructing a check not to use repository source does not prevent it. A
 * project inside the checkout inherits the workspace lockfile, a parent
 * `node_modules`, and every alias the build tooling defines, so an incomplete
 * package can pass. The consumer is therefore created outside the repository,
 * outside every pnpm workspace root, and with `--ignore-workspace`, and the
 * fixture it runs is scanned for escape hatches before installation.
 *
 * The strongest single assertion is the isolated lockfile: every `@holotope/*`
 * dependency must resolve from one of the tarballs just built. A consumer that
 * silently resolved them from the registry would exercise the *previous*
 * release and report success for artifacts nobody built.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packPublicPackages } from './pack-public-packages.mjs';
import {
  PUBLIC_PACKAGE_NAMES,
  buildReport,
  checkFixtureIsolation,
  checkIsolatedResolution
} from './lib/packed-packages.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE = path.join(REPO, 'fixtures', 'packed-consumer');
const KEEP = process.argv.includes('--keep');
/** Where the tarballs and their manifest land; the release job pins this. */
const OUT = (() => {
  const at = process.argv.indexOf('--out');
  return at === -1 ? path.join(REPO, '.packed') : path.resolve(process.argv[at + 1]);
})();

/**
 * Versions the repository already locks.
 *
 * Reused rather than resolved fresh so conformance tests the combination this
 * repository develops against, and so a consumer install cannot quietly drift
 * to a newer Three.js than the adapter's peer range admits.
 */
const CONSUMER_DEPENDENCIES = {
  three: '0.185.1',
  '@types/three': '^0.185.0',
  '@types/node': '^22.15.0',
  typescript: '^5.8.3',
  vite: '^6.3.5'
};

let consumer;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    cwd: options.cwd ?? REPO,
    // A stale NODE_PATH would reintroduce exactly the ambient resolution this
    // check exists to remove.
    env: { ...process.env, NODE_PATH: '' }
  });
  if (result.error !== undefined) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0 && options.allowFailure !== true) {
    fail(`${command} ${args.join(' ')} exited ${result.status}`, output);
  }
  return { status: result.status, output };
}

function fail(reason, detail = '') {
  console.error(`\nverify-packed-consumer: ${reason}\n`);
  if (detail.trim() !== '') console.error(detail.trimEnd() + '\n');
  if (consumer !== undefined) {
    console.error(`The isolated consumer is retained at:\n  ${consumer}\n`);
  }
  process.exit(1);
}

/** Copies the fixture, rejecting any file that could reach back into the repo. */
function stageFixture(destination) {
  const violations = [];
  const copy = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name);
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) {
        copy(source, target);
        continue;
      }
      const contents = fs.readFileSync(source, 'utf8');
      violations.push(
        ...checkFixtureIsolation(path.relative(FIXTURE, source), contents, REPO)
      );
      fs.writeFileSync(target, contents);
    }
  };
  copy(FIXTURE, destination);
  if (violations.length > 0) {
    fail('the fixture contains a route back into the repository', violations.join('\n'));
  }
}

const packed = packPublicPackages(OUT);
console.log(`verify-packed-consumer: packed ${packed.packed.length} artifact(s).`);

consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'holotope-packed-consumer-'));
stageFixture(consumer);

// Tarballs are copied in so the consumer's manifest names no repository path.
const vendored = path.join(consumer, 'vendor');
fs.mkdirSync(vendored, { recursive: true });
const dependencies = { ...CONSUMER_DEPENDENCIES };
for (const entry of packed.packed) {
  const local = path.join(vendored, path.basename(entry.tarball));
  fs.copyFileSync(entry.tarball, local);
  dependencies[entry.name] = `file:./vendor/${path.basename(local)}`;
}

// Holotope packages depend on one another by version, which is right for a
// consumer installing a published release and wrong here: none of these
// versions exist on the registry yet, so a transitive dependency would resolve
// to whatever npm already has. The first run of this check did exactly that --
// the new adapter loaded against the previous release's core and failed at
// runtime on a missing export, after a clean typecheck. Overriding pins the
// whole Holotope graph to the artifacts under test.
const overrides = Object.fromEntries(
  packed.packed.map((entry) => [entry.name, dependencies[entry.name]])
);

fs.writeFileSync(
  path.join(consumer, 'package.json'),
  JSON.stringify(
    {
      name: 'holotope-packed-consumer',
      private: true,
      type: 'module',
      scripts: {
        typecheck: 'tsc -p tsconfig.json',
        checks: 'node dist/main.js',
        build: 'vite build'
      },
      dependencies,
      pnpm: { overrides }
    },
    null,
    2
  ) + '\n'
);

console.log('verify-packed-consumer: installing into the isolated project…');
run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], { cwd: consumer });

// The acceptance assertion: every Holotope package came from a local tarball.
const lockfilePath = path.join(consumer, 'pnpm-lock.yaml');
if (!fs.existsSync(lockfilePath)) fail('the isolated install produced no lockfile');
const resolution = checkIsolatedResolution(
  fs.readFileSync(lockfilePath, 'utf8'),
  PUBLIC_PACKAGE_NAMES
);
if (resolution.length > 0) {
  fail('the isolated project did not resolve every package locally', resolution.join('\n'));
}
console.log('verify-packed-consumer: all five packages resolved from local tarballs.');

console.log('verify-packed-consumer: strict typecheck…');
run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: consumer });

console.log('verify-packed-consumer: headless checks…');
// Emit alongside the sources so relative `./scenario.js` specifiers resolve.
run(
  'pnpm',
  ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit', 'false', '--outDir', 'dist'],
  { cwd: consumer }
);
const checks = run('node', [path.join(consumer, 'dist', 'main.js')], { cwd: consumer });
console.log(checks.output.trimEnd());

console.log('verify-packed-consumer: browser production build…');
const build = run('pnpm', ['exec', 'vite', 'build'], { cwd: consumer });
const bundled = path.join(consumer, 'dist-browser');
void bundled;
if (/externalized|could not be resolved/i.test(build.output)) {
  fail('the browser build externalized or failed to resolve a dependency', build.output);
}

const report = buildReport(packed.packed);
console.log(`\n${JSON.stringify(report, null, 2)}\n`);

console.log(`Packed manifest: ${path.join(OUT, 'manifest.json')}`);
if (KEEP) {
  console.log(`Isolated consumer retained at:\n  ${consumer}\n`);
} else {
  fs.rmSync(consumer, { recursive: true, force: true });
}
