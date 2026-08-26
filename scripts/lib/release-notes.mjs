/**
 * The body of a GitHub Release, derived from the section already committed in
 * `CHANGELOG.md`.
 *
 * Everything here is pure: it takes changelog text, a tag, and a repository
 * slug, and returns the body or throws. It reads no files, makes no network
 * call, and touches no release metadata. The command in
 * `scripts/release-notes.mjs` supplies the inputs.
 *
 * The failure class this addresses is a release whose notes say less than the
 * changelog does. `gh release create --generate-notes` derives a body from
 * merged pull requests; this repository releases from commits, so for the last
 * two releases it produced the same 83-byte body — a compare link and nothing
 * else — against the 5,859 and 10,432 bytes their changelog sections already
 * held. Both releases were then corrected by hand afterwards. A hand-edit is
 * not a step that can fail loudly: skip it and the release simply reads as
 * though nothing shipped.
 *
 * ## The transformation
 *
 * Reconstructed from the `v0.0.21` and `v0.0.22` bodies rather than invented:
 *
 * 1. Find the level-two heading matching the tag exactly.
 * 2. Drop that heading line.
 * 3. Keep everything after it, byte for byte, until the next level-two release
 *    heading.
 * 4. Trim trailing newlines from that content and join with a blank line.
 * 5. Append the compare link against the immediately preceding release.
 *
 * The leading blank line that follows a heading is **kept**, because both
 * published bodies begin with one. Step 4 is the only place bytes are removed,
 * and it removes nothing but newlines at the very end.
 *
 * ## Newline convention
 *
 * LF throughout, and the body ends with exactly one LF. Both published bodies
 * are stored that way — no CRLF appears in either, and each ends in a single
 * newline. A body assembled with a different trailing convention would still
 * render identically, which is exactly why it is fixed here rather than left to
 * whatever the caller's file happened to end with.
 */

/** A level-two heading that names a release, and nothing else. */
const RELEASE_HEADING = /^## (v\d+\.\d+\.\d+)$/;

/**
 * A level-two heading that *looks* like it names a release but does not match
 * {@link RELEASE_HEADING}: `## v1.2`, `## v0.0.22 — fixed`, `##  v0.0.22`.
 *
 * These are rejected rather than skipped. Skipping one silently changes which
 * release the compare link points at, and a version-shaped heading that this
 * file declines to parse is far more likely to be a typo in a release than a
 * deliberate non-release section.
 *
 * The digit is load-bearing. Matching a bare `v` refused every ordinary
 * section whose title begins with one — `## Versioning`, `## Validation`,
 * `## Vertices` — which turns a changelog that merely has prose in it into a
 * release the workflow cannot build notes for.
 */
const NEARLY_RELEASE_HEADING = /^##\s+v\d/i;

/** The separator between the changelog section and the compare link. */
const LINK_SEPARATOR = '\n\n\n';

/**
 * Every level-two heading in the document, with its line index.
 *
 * Fenced blocks are skipped: a changelog that quotes a diff or a terminal
 * transcript can legitimately contain a line beginning `## `, and treating one
 * as a release boundary would truncate the notes at it.
 */
function headings(lines) {
  const found = [];
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (line.startsWith('## ') || NEARLY_RELEASE_HEADING.test(line)) {
      found.push({ index, line });
    }
  }
  return found;
}

/**
 * Release headings in document order, rejecting anything version-shaped that
 * does not parse.
 *
 * @param lines - The changelog split on LF.
 * @returns `{ tag, index }` per release heading, newest first by convention.
 */
export function releaseHeadings(lines) {
  const releases = [];
  for (const { index, line } of headings(lines)) {
    const match = RELEASE_HEADING.exec(line);
    if (match !== null) {
      releases.push({ tag: match[1], index });
      continue;
    }
    if (NEARLY_RELEASE_HEADING.test(line)) {
      throw new Error(
        `CHANGELOG.md:${index + 1}: malformed release heading ${JSON.stringify(line)}; ` +
        'a release heading is exactly "## vMAJOR.MINOR.PATCH"'
      );
    }
  }
  return releases;
}

/**
 * The committed release notes for `tag`.
 *
 * @param changelog - The full text of `CHANGELOG.md`.
 * @param tag - The release tag, `vMAJOR.MINOR.PATCH`.
 * @param repository - `owner/name`, used only to build the compare link.
 * @returns The body, ending in exactly one LF.
 *
 * Throws rather than guessing. There is no arm in which this returns a body it
 * is unsure of: a release whose notes are wrong is worse than a release the
 * workflow refused to create, because the second one is visible.
 */
export function releaseNotes(changelog, tag, repository) {
  if (!RELEASE_HEADING.test(`## ${tag}`)) {
    throw new Error(
      `release notes: ${JSON.stringify(tag)} is not a release tag; ` +
      'expected vMAJOR.MINOR.PATCH'
    );
  }

  const lines = changelog.split('\n');
  const releases = releaseHeadings(lines);

  const matches = releases.filter((entry) => entry.tag === tag);
  if (matches.length === 0) {
    const documented = releases.length === 0
      ? 'no releases'
      : releases.map((entry) => entry.tag).slice(0, 3).join(', ') +
        (releases.length > 3 ? ', …' : '');
    throw new Error(
      `release notes: CHANGELOG.md has no "## ${tag}" section. It documents ${documented}`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `release notes: CHANGELOG.md has ${matches.length} "## ${tag}" sections, at lines ` +
      `${matches.map((entry) => entry.index + 1).join(' and ')}; ` +
      'which one describes the release is not something this can decide'
    );
  }

  const current = matches[0];
  const previous = releases[releases.indexOf(current) + 1];
  if (previous === undefined) {
    throw new Error(
      `release notes: "## ${tag}" is the oldest release in CHANGELOG.md, so there is ` +
      'no previous release to compare against. The first release needs its compare ' +
      'link written by hand.'
    );
  }

  // Byte-for-byte from the line after the heading to the line before the next
  // release heading. `slice` on the split array cannot reorder or reflow.
  const content = lines.slice(current.index + 1, previous.index).join('\n');
  if (content.trim() === '') {
    throw new Error(
      `release notes: the "## ${tag}" section is empty. A release with nothing to ` +
      'say about it is a changelog that was not written, not a release to announce.'
    );
  }

  const link =
    `**Full Changelog**: https://github.com/${repository}/compare/${previous.tag}...${tag}`;
  return `${content.replace(/\n+$/, '')}${LINK_SEPARATOR}${link}\n`;
}
