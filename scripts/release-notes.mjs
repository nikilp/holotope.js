/**
 * Write the GitHub Release body for a tag, from the committed changelog.
 *
 *   node scripts/release-notes.mjs --tag v0.0.22
 *   node scripts/release-notes.mjs --tag v0.0.22 --out "$RUNNER_TEMP/notes.md"
 *
 * With `--out` it writes the file and prints its path and size; without, it
 * prints the body. The judgement lives in `lib/release-notes.mjs`; this file
 * only locates the inputs.
 *
 * It reads `CHANGELOG.md` and one `package.json`. It writes nothing else — no
 * changelog edit, no tag, no release, no network call — so running it is always
 * safe, including on a tag that does not exist yet.
 *
 * The release workflow passes the written file to `gh release create
 * --notes-file`. Release prose reaches `gh` as a file rather than as an
 * environment variable or an inline argument, so markup in the changelog stays
 * inert text on its way to the API.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseNotes } from './lib/release-notes.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHANGELOG = path.join(REPO, 'CHANGELOG.md');
/** Any published manifest carries the repository; `core` is always published. */
const MANIFEST = path.join(REPO, 'packages/core/package.json');

function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

/**
 * `owner/name` from the manifest's repository URL.
 *
 * Read rather than hardcoded so a fork's release links point at the fork, and
 * required rather than defaulted so a missing field is a loud failure instead
 * of a compare link to somebody else's repository.
 */
function repositorySlug(manifestPath) {
  const url = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).repository?.url;
  const slug = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url ?? '');
  if (slug === null) {
    throw new Error(
      `release notes: ${path.relative(REPO, manifestPath)} has no GitHub repository URL ` +
      `to build a compare link from (found ${JSON.stringify(url ?? null)})`
    );
  }
  return slug[1];
}

const tag = option('tag');
if (tag === undefined) {
  console.error('usage: node scripts/release-notes.mjs --tag vMAJOR.MINOR.PATCH [--out FILE]');
  process.exit(2);
}

let body;
try {
  body = releaseNotes(fs.readFileSync(CHANGELOG, 'utf8'), tag, repositorySlug(MANIFEST));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const out = option('out');
if (out === undefined) {
  process.stdout.write(body);
} else {
  fs.writeFileSync(out, body, 'utf8');
  console.log(`release-notes: wrote ${Buffer.byteLength(body, 'utf8')} bytes for ${tag} to ${out}`);
}
