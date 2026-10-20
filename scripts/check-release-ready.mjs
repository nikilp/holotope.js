/**
 * Release preflight.
 *
 *   node scripts/check-release-ready.mjs --tag v0.0.10
 *   node scripts/check-release-ready.mjs --tag v0.0.10 --no-ci
 *
 * Answers one question: would tagging this commit release what was actually
 * verified? Every judgement lives in `lib/release-readiness.mjs`; this file
 * observes the repository with `git` and `gh` and reports.
 *
 * It changes nothing. Nothing here creates a tag, pushes, or publishes — a
 * release stays an explicit act.
 *
 * ## Why the CI check is per-commit
 *
 * A green badge says a workflow passed for *some* commit. During this
 * repository's own release preparation CI was green for `49893e4` while four
 * later commits sat unverified, and the badge read as "we are green". The
 * check therefore matches the exact SHA about to be tagged.
 *
 * `--no-ci` skips it when `gh` is unavailable. That is a decision to release
 * without remote evidence, so it is a flag rather than a silent fallback, and
 * the report says it was used.
 *
 * ## Why the CDN pins trail the version being tagged
 *
 * The Pages workflow deploys `main`, and it must be green for this exact
 * commit, so the page is already live when this runs and the tag has not yet
 * published anything. The CDN example therefore cannot pin the version about to
 * be tagged: from deployment until publication it would fail for every reader.
 * Each `@holotope/*` pin must instead be the registry's current `latest`, read
 * here; an unreadable registry or a missing release is a violation, not a pass.
 * The order this gives a release:
 *
 *   1. Raise the five packages and write the changelog; leave the page and
 *      `scripts/cdn-published-consumer.json` on the published release.
 *   2. Push, let CI and Pages pass for that commit, run this, tag, push the tag.
 *   3. Once the Release workflow has published every package, move the page
 *      and the record together in a separate commit, confirmed by
 *      `pnpm check:cdn:online`, which reports the page as stale until then.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAdvertisedPublished } from './lib/cdn-example.mjs';
import { PUBLIC_PACKAGES, checkVersionsAgree } from './lib/packed-packages.mjs';
import {
  checkCiSucceededForCommit,
  checkTagAbsent,
  checkTagMatchesVersion,
  checkTreeSynchronized,
  versionOfTag
} from './lib/release-readiness.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CDN_PAGE = path.join(REPO, 'examples/showcase/public/cdn.html');
const REQUIRED_WORKFLOWS = ['CI', 'Deploy showcase and docs'];

const flag = (name) => process.argv.includes(name);
const option = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', cwd: REPO });
  if (result.error !== undefined) return { ok: false, output: String(result.error) };
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  };
}

const manifests = PUBLIC_PACKAGES.map((directory) => ({
  directory,
  manifest: JSON.parse(
    fs.readFileSync(path.join(REPO, 'packages', directory, 'package.json'), 'utf8')
  )
}));

const violations = [...checkVersionsAgree(manifests)];
const version = manifests[0].manifest.version;
const tag = option('--tag') ?? `v${version}`;

violations.push(...checkTagMatchesVersion(tag, version));

// Every `@holotope/*` pin the CDN example advertises, against the registry's
// `latest` for that package: the page is live before this tag publishes.
const page = fs.readFileSync(CDN_PAGE, 'utf8');
const pins = [
  ...page.matchAll(/cdn\.jsdelivr\.net\/npm\/(@holotope\/[^/@]+)@([^/]+)\//g)
].map(([, name, pinned]) => ({
  file: path.relative(REPO, CDN_PAGE),
  name,
  version: pinned
}));
async function latestOf(name) {
  const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return { url, status: response.status, body: await response.text() };
  } catch (error) {
    return { url, error: String(error?.message ?? error) };
  }
}
const latest = new Map(
  await Promise.all(
    [...new Set(pins.map((pin) => pin.name))].map(async (name) => [name, await latestOf(name)])
  )
);
const advertised = checkAdvertisedPublished(pins, latest);
violations.push(...advertised.violations, ...advertised.errors);
const advertisedVersions = [...new Set(pins.map((pin) => pin.version))];

const status = capture('git', ['status', '--porcelain']);
const counts = capture('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
const [ahead = '0', behind = '0'] = counts.ok ? counts.output.split(/\s+/) : [];
if (!counts.ok) {
  violations.push('no upstream is configured, so nothing can be compared to the remote');
}
violations.push(
  ...checkTreeSynchronized(status.output, Number(ahead), Number(behind))
);

const head = capture('git', ['rev-parse', 'HEAD']);
const sha = head.output;

const localTags = capture('git', ['tag', '--list']);
const remoteTags = capture('git', ['ls-remote', '--tags', 'origin']);
const existing = [
  ...localTags.output.split('\n'),
  ...[...remoteTags.output.matchAll(/refs\/tags\/(\S+?)(?:\^\{\})?$/gm)].map((m) => m[1])
]
  .map((entry) => entry.trim())
  .filter((entry) => entry !== '');
violations.push(...checkTagAbsent(tag, existing));

let ciChecked = false;
if (flag('--no-ci')) {
  console.log('check-release-ready: skipping the remote CI check (--no-ci).\n');
} else {
  const runs = capture('gh', [
    'run',
    'list',
    '--limit',
    '40',
    '--json',
    'workflowName,headSha,status,conclusion'
  ]);
  if (!runs.ok) {
    violations.push(
      `could not read workflow runs (${runs.output.split('\n')[0]}); ` +
        'pass --no-ci to release without remote evidence'
    );
  } else {
    violations.push(
      ...checkCiSucceededForCommit(JSON.parse(runs.output), sha, REQUIRED_WORKFLOWS)
    );
    ciChecked = true;
  }
}

if (violations.length > 0) {
  console.error(`\ncheck-release-ready: ${tag} is not ready.\n`);
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('');
  process.exit(1);
}

console.log(
  `check-release-ready: ${tag} is ready.\n\n` +
    `  version        ${version} across ${PUBLIC_PACKAGES.length} packages\n` +
    `  commit         ${sha.slice(0, 7)}, pushed and clean\n` +
    `  advertised     ${pins.length} CDN pin(s) at ${advertisedVersions.join(', ')}, the registry's latest\n` +
    `  workflows      ${ciChecked ? `${REQUIRED_WORKFLOWS.join(', ')} green for this commit` : 'not checked (--no-ci)'}\n\n` +
    `Nothing was changed. To release:\n` +
    `  git tag ${tag} && git push origin ${tag}\n` +
    (advertisedVersions.every((pinned) => pinned === versionOfTag(tag))
      ? ''
      : `\nThen, once every package is published at ${versionOfTag(tag)}, move the CDN ` +
        'page and scripts/cdn-published-consumer.json to it in a separate commit and ' +
        'confirm with pnpm check:cdn:online.\n')
);
