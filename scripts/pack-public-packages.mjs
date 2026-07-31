/**
 * Packs the public packages and validates the artifacts a consumer receives.
 *
 *   node scripts/pack-public-packages.mjs --out <dir>
 *
 * Writes one tarball per package plus `manifest.json` describing them, and
 * fails if any tarball would be unusable outside this workspace. The judgements
 * live in `lib/packed-packages.mjs`; this file supplies them with real inputs.
 *
 * Packing is separated from conformance so the release workflow can pack once
 * and then publish the exact bytes conformance tested. Repacking after a green
 * check publishes artifacts nothing verified, and "same source state" is not
 * the same claim.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_PACKAGES,
  checkExportTargetsPresent,
  checkPackedManifestSpecifiers,
  checkRepositoryMetadata,
  checkTarballContents,
  checkThreePeerRange,
  checkVersionsAgree
} from './lib/packed-packages.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const argument = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? fallback : process.argv[at + 1];
};

/** Runs a command with an argument array; never through a shell. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    cwd: options.cwd ?? REPO,
    env: options.env ?? process.env
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout ?? ''}${result.stderr ?? ''}`
    );
  }
  return result.stdout ?? '';
}

const readManifest = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Member paths inside a tarball, without extracting it. */
const tarballEntries = (tarball) =>
  run('tar', ['-tzf', tarball])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** The packed `package.json`, which is the rewritten one a consumer sees. */
const packedManifest = (tarball) =>
  JSON.parse(run('tar', ['-xzOf', tarball, 'package/package.json']));

export function packPublicPackages(outDirectory) {
  fs.rmSync(outDirectory, { recursive: true, force: true });
  fs.mkdirSync(outDirectory, { recursive: true });

  const sources = PUBLIC_PACKAGES.map((directory) => ({
    directory,
    manifest: readManifest(path.join(REPO, 'packages', directory, 'package.json'))
  }));

  const violations = [...checkVersionsAgree(sources)];
  for (const { directory, manifest } of sources) {
    violations.push(...checkRepositoryMetadata(directory, manifest));
    const dist = path.join(REPO, 'packages', directory, 'dist');
    if (!fs.existsSync(dist)) {
      violations.push(`${manifest.name}: no build output at packages/${directory}/dist`);
    }
  }
  if (violations.length > 0) fail(violations);

  const packed = [];
  for (const { directory, manifest } of sources) {
    const tarball = path.join(outDirectory, `${directory}-${manifest.version}.tgz`);
    run('pnpm', ['--dir', path.join(REPO, 'packages', directory), 'pack', '--out', tarball]);

    const entries = tarballEntries(tarball);
    const inTarball = packedManifest(tarball);
    violations.push(...checkPackedManifestSpecifiers(inTarball, REPO));
    violations.push(...checkExportTargetsPresent(inTarball, entries));
    violations.push(...checkTarballContents(inTarball, entries));
    if (inTarball.name === '@holotope/three') {
      violations.push(...checkThreePeerRange(inTarball));
    }

    packed.push({
      name: inTarball.name,
      version: inTarball.version,
      directory,
      tarball,
      bytes: fs.statSync(tarball).size,
      sha256: createHash('sha256').update(fs.readFileSync(tarball)).digest('hex'),
      dependencies: inTarball.dependencies ?? {},
      peerDependencies: inTarball.peerDependencies ?? {}
    });
  }
  if (violations.length > 0) fail(violations);

  const manifestPath = path.join(outDirectory, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ packages: packed }, null, 2) + '\n');
  return { manifestPath, packed };
}

function fail(violations) {
  console.error('\npack-public-packages: the artifacts are not publishable.\n');
  for (const violation of [...new Set(violations)]) console.error(`  ${violation}`);
  console.error('');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = path.resolve(argument('--out', path.join(REPO, '.packed')));
  const { manifestPath, packed } = packPublicPackages(out);

  const width = Math.max(...packed.map((entry) => entry.name.length));
  console.log(
    `pack-public-packages: ${packed.length} artifact(s) -> ${path.relative(REPO, manifestPath)}\n`
  );
  console.log(
    `  ${'package'.padEnd(width)}  ${'version'.padEnd(8)}  ${'size'.padStart(9)}  digest`
  );
  for (const entry of packed) {
    console.log(
      `  ${entry.name.padEnd(width)}  ${entry.version.padEnd(8)}  ` +
        `${`${(entry.bytes / 1024).toFixed(0)} KiB`.padStart(9)}  ${entry.sha256.slice(0, 12)}`
    );
  }
  console.log('');
}
