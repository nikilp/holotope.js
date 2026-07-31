/**
 * Conditions that must hold before a tag is pushed, separated from the
 * commands that observe them.
 *
 * Everything here is pure: it takes manifests, git output, and parsed workflow
 * runs, and returns violations. The preflight script supplies those by running
 * `git` and `gh`.
 *
 * ## The check that matters most
 *
 * A green CI badge says a workflow passed for *some* commit. It does not say
 * which one. During this repository's own release preparation, CI was green
 * for `49893e4` while four later commits sat unverified, and the badge read as
 * "we are green" — so {@link checkCiSucceededForCommit} matches on the exact
 * SHA about to be tagged rather than on the newest run.
 *
 * The rest are cheaper: a split version publishes a set whose members
 * reference a sibling release that does not exist, an unpushed commit means
 * the tag points at something the tag job cannot fetch, and a CDN page pinned
 * to the previous release keeps advertising it after the new one ships.
 */

/** `v0.0.10` and `0.0.10` are the same release; the tag carries the prefix. */
export const versionOfTag = (tag) => tag.replace(/^v/, '');

/**
 * The tag must name the version the packages declare.
 *
 * The release workflow already refuses a mismatch, but it refuses *after* a
 * tag exists, and a pushed tag is the awkward thing to undo.
 *
 * @param tag - Tag about to be created, with or without a leading `v`.
 * @param version - Version the five packages agree on.
 * @returns Violation strings; empty when they match.
 */
export function checkTagMatchesVersion(tag, version) {
  const wanted = versionOfTag(tag);
  if (wanted === version) return [];
  return [
    `tag ${tag} names version ${wanted}, but the packages declare ${version}`
  ];
}

/**
 * The tag must not already exist.
 *
 * @param tag - Tag about to be created.
 * @param existing - Tag names already present locally or on the remote.
 * @returns Violation strings; empty when the tag is free.
 */
export function checkTagAbsent(tag, existing) {
  if (!existing.includes(tag)) return [];
  return [`tag ${tag} already exists; releasing it again needs a deliberate decision`];
}

/**
 * Nothing may be uncommitted or unpushed.
 *
 * A tag points at a commit the release job fetches from the remote. Anything
 * local is invisible to it, so the artifacts would be built from a different
 * tree than the one that was verified.
 *
 * @param status - Output of `git status --porcelain`.
 * @param ahead - Commits on HEAD that the upstream does not have.
 * @param behind - Commits the upstream has that HEAD does not.
 * @returns Violation strings; empty when local and remote agree.
 */
export function checkTreeSynchronized(status, ahead, behind) {
  const violations = [];
  const dirty = status
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (dirty.length > 0) {
    violations.push(
      `${dirty.length} uncommitted change(s); the tag would not contain them`
    );
  }
  if (ahead > 0) {
    violations.push(
      `${ahead} commit(s) not pushed; the release job fetches from the remote and would not see them`
    );
  }
  if (behind > 0) {
    violations.push(
      `${behind} commit(s) on the remote are not local; tagging here would skip them`
    );
  }
  return violations;
}

/**
 * Every required workflow must have succeeded for **this** commit.
 *
 * Matching on the newest run instead would accept a green result belonging to
 * an earlier commit, which is exactly the mistake this exists to prevent.
 *
 * @param runs - `{ workflowName, headSha, status, conclusion }` records.
 * @param sha - The commit about to be tagged.
 * @param required - Workflow names that must have succeeded.
 * @returns Violation strings; empty when each required workflow is green here.
 */
export function checkCiSucceededForCommit(runs, sha, required) {
  const violations = [];
  for (const workflow of required) {
    const forCommit = runs.filter(
      (run) => run.workflowName === workflow && run.headSha === sha
    );
    if (forCommit.length === 0) {
      violations.push(
        `${workflow} has no run for ${sha.slice(0, 7)}; a green run for another commit does not certify this one`
      );
      continue;
    }
    const succeeded = forCommit.some(
      (run) => run.status === 'completed' && run.conclusion === 'success'
    );
    if (!succeeded) {
      const latest = forCommit[0];
      const outcome =
        latest.conclusion === null ||
        latest.conclusion === undefined ||
        latest.conclusion === ''
          ? latest.status
          : `${latest.status}/${latest.conclusion}`;
      violations.push(`${workflow} for ${sha.slice(0, 7)} is ${outcome}`);
    }
  }
  return violations;
}

/**
 * Anything advertising a version must advertise the one being released.
 *
 * The CDN example is the case here: it pins `@holotope/*@<version>` in a page
 * readers copy from, so a stale pin keeps sending them to the previous
 * release after the new one ships.
 *
 * @param pins - `{ file, name, version }` for each advertised pin.
 * @param version - Version being released.
 * @returns Violation strings; empty when every pin matches.
 */
export function checkAdvertisedVersions(pins, version) {
  return pins
    .filter((pin) => pin.version !== version)
    .map(
      (pin) =>
        `${pin.file} advertises ${pin.name}@${pin.version}, but this release is ${version}`
    );
}
