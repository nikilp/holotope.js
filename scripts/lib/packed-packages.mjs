/**
 * Rules the published artifacts must satisfy, separated from the commands that
 * produce them.
 *
 * Everything here is pure: it takes manifests, tarball entry lists, lockfile
 * text, and fixture sources, and returns violations. The packing and
 * conformance scripts supply those inputs by running `pnpm`, `tar`, and a
 * compiler; the judgements live here so they can be tested against synthetic
 * inputs without installing anything five times.
 *
 * The failure class this addresses is distribution, not correctness. A
 * repository proves its own source tree: aliases resolve, the workspace
 * lockfile is present, and a parent `node_modules` is always in scope. None of
 * that reaches an outside consumer, so a package can be incomplete in exactly
 * the ways an in-repository test cannot observe.
 */

/**
 * The publication set, closed and ordered.
 *
 * Ordered by dependency so a publish loop is auditable, and closed so a newly
 * added `packages/` directory cannot enter a release by being discovered. A
 * glob here would make the publication set a property of the filesystem rather
 * than a decision someone made.
 */
export const PUBLIC_PACKAGES = Object.freeze([
  'core',
  'three',
  'physics',
  'experiment',
  'experiment-physics'
]);

/** `@holotope/<dir>` for each entry of {@link PUBLIC_PACKAGES}. */
export const PUBLIC_PACKAGE_NAMES = Object.freeze(
  PUBLIC_PACKAGES.map((directory) => `@holotope/${directory}`)
);

/** A dependency specifier that cannot survive leaving the workspace. */
const UNRESOLVABLE_SPECIFIER = /^(workspace:|link:|file:)/;

/**
 * Every version across the publication set must agree.
 *
 * The packages depend on one another by exact version after packing, so a
 * split version does not fail loudly — it publishes a set whose members
 * reference a sibling release that does not exist.
 *
 * @param manifests - `{ directory, manifest }` for each public package.
 * @returns Violation strings; empty when every version matches.
 */
export function checkVersionsAgree(manifests) {
  const versions = new Map();
  for (const { directory, manifest } of manifests) {
    const version = manifest.version;
    if (!versions.has(version)) versions.set(version, []);
    versions.get(version).push(directory);
  }
  if (versions.size <= 1) return [];
  const summary = [...versions.entries()]
    .map(([version, directories]) => `${version} (${directories.join(', ')})`)
    .sort()
    .join('; ');
  return [`public packages disagree on version: ${summary}`];
}

/**
 * A packed manifest must carry only specifiers a registry consumer can resolve.
 *
 * `pnpm pack` rewrites `workspace:*` into the real version, so a surviving
 * `workspace:` means the rewrite did not happen and the tarball is unusable
 * outside this checkout. `file:` and `link:` are the same defect wearing a
 * different prefix, and an absolute path is that defect plus a leak of the
 * publishing machine's layout.
 *
 * @param manifest - Parsed `package.json` extracted from a tarball.
 * @param repositoryRoot - Absolute path whose appearance signals a leak.
 * @returns Violation strings; empty when the manifest is publishable.
 */
export function checkPackedManifestSpecifiers(manifest, repositoryRoot) {
  const violations = [];
  const groups = [
    ['dependencies', manifest.dependencies],
    ['peerDependencies', manifest.peerDependencies],
    ['optionalDependencies', manifest.optionalDependencies]
  ];
  for (const [group, entries] of groups) {
    for (const [name, specifier] of Object.entries(entries ?? {})) {
      if (typeof specifier !== 'string') continue;
      if (UNRESOLVABLE_SPECIFIER.test(specifier)) {
        violations.push(
          `${manifest.name}: ${group}.${name} is "${specifier}", which no consumer outside this workspace can resolve`
        );
      }
      if (specifier.includes(repositoryRoot)) {
        violations.push(
          `${manifest.name}: ${group}.${name} embeds the repository path "${repositoryRoot}"`
        );
      }
    }
  }
  if (JSON.stringify(manifest).includes(repositoryRoot)) {
    violations.push(
      `${manifest.name}: package.json embeds the repository path "${repositoryRoot}"`
    );
  }
  return violations;
}

/** Normalizes a tarball entry path: `tar` prefixes every member with `package/`. */
const withoutPrefix = (entry) => entry.replace(/^package\//, '').replace(/\/$/, '');

/**
 * Everything an export declares must actually be inside the tarball.
 *
 * This is the defect an in-repository test structurally cannot see. Every
 * export target resolves here from `dist/`, which the repository always has;
 * whether the *tarball* has it depends on `files`, `.npmignore`, and the build
 * having run. A missing target surfaces to the consumer as an unresolvable
 * subpath, long after publication.
 *
 * @param manifest - Parsed `package.json` extracted from a tarball.
 * @param entries - Tarball member paths, `package/`-prefixed or not.
 * @returns Violation strings; empty when every declared target is present.
 */
export function checkExportTargetsPresent(manifest, entries) {
  const present = new Set(entries.map(withoutPrefix));
  const violations = [];
  const visit = (subpath, target) => {
    if (typeof target === 'string') {
      const relative = target.replace(/^\.\//, '');
      if (!present.has(relative)) {
        violations.push(
          `${manifest.name}: export "${subpath}" targets ${target}, absent from the tarball`
        );
      }
      return;
    }
    if (target === null || typeof target !== 'object') return;
    for (const [condition, nested] of Object.entries(target)) {
      visit(`${subpath}:${condition}`, nested);
    }
  };
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    visit(subpath, target);
  }
  for (const field of ['main', 'module', 'types', 'typings']) {
    const target = manifest[field];
    if (typeof target === 'string') visit(field, target);
  }
  return violations;
}

/** Paths that must never ship, as prefixes under the tarball root. */
const FORBIDDEN_PREFIXES = Object.freeze([
  'src/',
  'test/',
  'tests/',
  'kitchen/',
  'node_modules/',
  '.turbo/',
  '.vite/',
  'coverage/'
]);

/** Files that must never ship, matched exactly under the tarball root. */
const FORBIDDEN_EXACT = Object.freeze([
  'tsconfig.json',
  'tsconfig.tsbuildinfo',
  'vitest.config.ts',
  '.npmrc'
]);

/**
 * A tarball carries the built product and its manifest, and nothing else.
 *
 * Source absence is not aesthetic. It is what makes the packaged surface the
 * thing under test: with `src/` present a consumer's compiler may resolve
 * declarations the published `exports` never promised.
 *
 * @param manifest - Parsed `package.json` extracted from a tarball.
 * @param entries - Tarball member paths, `package/`-prefixed or not.
 * @returns Violation strings; empty when the contents are exactly right.
 */
export function checkTarballContents(manifest, entries) {
  const normalized = entries.map(withoutPrefix).filter((entry) => entry !== '');
  const violations = [];
  if (!normalized.includes('package.json')) {
    violations.push(`${manifest.name}: tarball has no package.json`);
  }
  if (!normalized.some((entry) => entry.startsWith('dist/'))) {
    violations.push(`${manifest.name}: tarball has no dist/ output`);
  }
  for (const entry of normalized) {
    if (FORBIDDEN_PREFIXES.some((prefix) => entry.startsWith(prefix))) {
      violations.push(`${manifest.name}: tarball ships ${entry}`);
    }
    if (FORBIDDEN_EXACT.includes(entry)) {
      violations.push(`${manifest.name}: tarball ships ${entry}`);
    }
    // A `.ts` that is not a declaration is source by another name.
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      violations.push(`${manifest.name}: tarball ships TypeScript source ${entry}`);
    }
  }
  return violations;
}

/**
 * Package metadata must name its own directory.
 *
 * `repository.directory` is what sends a reader from npm to the right source
 * tree. It is copy-paste-prone precisely because it is the one field that
 * differs between otherwise identical manifests.
 *
 * @param directory - Directory under `packages/`.
 * @param manifest - That package's `package.json`.
 * @returns Violation strings; empty when the metadata is right.
 */
export function checkRepositoryMetadata(directory, manifest) {
  const expected = `packages/${directory}`;
  const actual = manifest.repository?.directory;
  if (actual === expected) return [];
  return [
    `${manifest.name}: repository.directory is ${JSON.stringify(actual)}, expected "${expected}"`
  ];
}

/**
 * `@holotope/three` must keep declaring a Three.js peer range.
 *
 * The adapter package is the only one with a peer dependency, and dropping it
 * would let a consumer install an incompatible Three.js and fail at runtime
 * rather than at install time.
 *
 * @param manifest - The `@holotope/three` manifest.
 * @returns Violation strings; empty when the peer range is declared.
 */
export function checkThreePeerRange(manifest) {
  const range = manifest.peerDependencies?.three;
  if (typeof range === 'string' && range.trim() !== '') return [];
  return [`${manifest.name}: peerDependencies.three is missing`];
}

/**
 * No Holotope package anywhere in the isolated install came from the registry.
 *
 * Checking only the root dependencies is not enough, and the gap is not
 * theoretical: a packed `@holotope/three` depends on `@holotope/core` by
 * *version*, which is correct for a real consumer installing a published
 * release, but during pre-publication conformance resolves to whatever npm
 * already has. The first run of this check found exactly that — the new
 * adapter loaded against the previous release's core and failed on a missing
 * export at runtime, after a clean typecheck.
 *
 * So the assertion is over every snapshot in the lockfile, not the importer
 * block. A registry-resolved Holotope package means the run is exercising a
 * mixture of releases and its result means nothing.
 *
 * @param lockfile - Text of the isolated project's lockfile.
 * @param names - Expected package names.
 * @returns Violation strings; empty when every resolution is local.
 */
export function checkIsolatedResolution(lockfile, names = PUBLIC_PACKAGE_NAMES) {
  const violations = [];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const declared = new RegExp(
      `['"]?${escaped}['"]?:[\\s\\S]{0,400}?specifier:\\s*(\\S+)`
    );
    const found = lockfile.match(declared);
    if (found === null) {
      violations.push(`${name}: absent from the isolated lockfile`);
      continue;
    }
    if (!/^['"]?file:/.test(found[1])) {
      violations.push(
        `${name}: isolated lockfile resolves it as ${found[1]}, not from a local tarball`
      );
    }
  }
  // Any snapshot key of the form `@holotope/x@<something>` that is not a
  // `file:` reference is a registry copy, however it got there.
  // A snapshot key ends the line, or carries an inline empty dependency set.
  const snapshots = lockfile.matchAll(/^ {2}'?(@holotope\/[a-z-]+)@(.+?)'?:(?: \{\})?$/gm);
  for (const [, name, reference] of snapshots) {
    if (!reference.startsWith('file:')) {
      violations.push(
        `${name}: the isolated install pulled ${name}@${reference} from the registry`
      );
    }
  }
  return violations;
}

/** Patterns that would let a fixture reach back into the checkout. */
const ESCAPE_HATCHES = Object.freeze([
  [/"paths"\s*:/, 'a TypeScript `paths` mapping'],
  [/\bresolve\s*:\s*\{[\s\S]*?\balias\b/, 'a bundler alias block'],
  [/\bfrom\s+['"][^'"]*\/packages\//, 'an import from packages/'],
  [/\bfrom\s+['"][^'"]*\/(?:dist|kitchen)\//, 'an import from dist/ or kitchen/'],
  [/["']workspace:/, 'a workspace: dependency'],
  [/["']link:/, 'a link: dependency'],
  [/"skipLibCheck"\s*:\s*true/, 'skipLibCheck, which would hide declaration defects']
]);

/**
 * A fixture file must contain no route back to the repository.
 *
 * Isolation is structural — the consumer lives in a temporary directory with
 * no parent `node_modules` — but a fixture can still defeat it by naming an
 * absolute path or aliasing a package name. Those are the shortcuts a failing
 * run invites, so they are rejected mechanically rather than by discipline.
 *
 * @param file - Path of the fixture file, for the message.
 * @param contents - Its text.
 * @param repositoryRoot - Absolute path whose appearance signals an escape.
 * @returns Violation strings; empty when the fixture is self-contained.
 */
export function checkFixtureIsolation(file, contents, repositoryRoot) {
  const violations = [];
  for (const [pattern, description] of ESCAPE_HATCHES) {
    if (pattern.test(contents)) {
      violations.push(`${file}: contains ${description}`);
    }
  }
  if (contents.includes(repositoryRoot)) {
    violations.push(`${file}: embeds the repository path "${repositoryRoot}"`);
  }
  return violations;
}

/**
 * The report a passing run emits.
 *
 * Deliberately free of timestamps, temporary paths, durations, and byte
 * counts: a report that changes between two identical runs cannot be diffed,
 * and diffing it is the only reason to emit one. Human diagnostics print those
 * separately.
 *
 * @param packages - `{ name, version, sha256 }` for each packed artifact.
 * @returns The stable report object.
 */
export function buildReport(packages) {
  return {
    status: 'passed',
    packages: packages.map(({ name, version, sha256 }) => ({
      name,
      version,
      sha256,
      resolvedFromLocalTarball: true
    })),
    checks: {
      tarballExports: 'passed',
      strictTypecheck: 'passed',
      geometryComposition: 'passed',
      representationClaims: 'passed',
      experimentProbe: 'passed',
      physicsComposition: 'passed',
      viteProductionBuild: 'passed'
    }
  };
}
