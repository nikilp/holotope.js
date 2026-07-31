import { describe, expect, it } from 'vitest';
import {
  checkAdvertisedVersions,
  checkCiSucceededForCommit,
  checkTagAbsent,
  checkTagMatchesVersion,
  checkTreeSynchronized,
  versionOfTag
  // @ts-expect-error -- a plain .mjs module with no declarations; the rules it
  // holds are the subject, and typing it would duplicate them.
} from '../lib/release-readiness.mjs';

/**
 * Negative controls for the release preflight.
 *
 * Each case is a way a release goes out describing something other than what
 * was verified. The CI cases carry the most weight: this repository once read
 * a green badge for an earlier commit as evidence for four later ones, which
 * is the mistake `checkCiSucceededForCommit` exists to make impossible.
 */

const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const OTHER = '0123456789abcdef0123456789abcdef01234567';
const WORKFLOWS = ['CI', 'Deploy showcase and docs'];

const green = (workflowName: string, headSha: string) => ({
  workflowName,
  headSha,
  status: 'completed',
  conclusion: 'success'
});

describe('versionOfTag', () => {
  it('treats v0.0.10 and 0.0.10 as the same release', () => {
    expect(versionOfTag('v0.0.10')).toBe('0.0.10');
    expect(versionOfTag('0.0.10')).toBe('0.0.10');
  });
});

describe('checkTagMatchesVersion', () => {
  it('accepts a tag naming the declared version', () => {
    expect(checkTagMatchesVersion('v0.0.10', '0.0.10')).toEqual([]);
  });

  it('rejects tagging a version the packages do not declare', () => {
    const violations = checkTagMatchesVersion('v0.0.10', '0.0.9');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('declare 0.0.9');
  });
});

describe('checkTagAbsent', () => {
  it('accepts an unused tag', () => {
    expect(checkTagAbsent('v0.0.10', ['v0.0.8', 'v0.0.9'])).toEqual([]);
  });

  it('rejects re-releasing an existing tag', () => {
    expect(checkTagAbsent('v0.0.9', ['v0.0.8', 'v0.0.9']).join(' ')).toContain(
      'already exists'
    );
  });
});

describe('checkTreeSynchronized', () => {
  it('accepts a clean tree level with its upstream', () => {
    expect(checkTreeSynchronized('', 0, 0)).toEqual([]);
  });

  it('rejects uncommitted changes, which a tag would not contain', () => {
    const violations = checkTreeSynchronized(' M README.md\n?? scratch.ts', 0, 0);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('2 uncommitted');
  });

  it('rejects unpushed commits, which the release job cannot fetch', () => {
    expect(checkTreeSynchronized('', 4, 0).join(' ')).toContain('4 commit(s) not pushed');
  });

  it('rejects a stale local branch', () => {
    expect(checkTreeSynchronized('', 0, 2).join(' ')).toContain('are not local');
  });
});

describe('checkCiSucceededForCommit', () => {
  it('accepts every required workflow green for this commit', () => {
    const runs = WORKFLOWS.map((workflow) => green(workflow, SHA));
    expect(checkCiSucceededForCommit(runs, SHA, WORKFLOWS)).toEqual([]);
  });

  it('rejects a green run that belongs to an earlier commit', () => {
    // The real failure: the badge is green, for something else.
    const runs = WORKFLOWS.map((workflow) => green(workflow, OTHER));
    const violations = checkCiSucceededForCommit(runs, SHA, WORKFLOWS);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('has no run for a1b2c3d');
    expect(violations[0]).toContain('does not certify this one');
  });

  it('rejects a run still in progress for this commit', () => {
    const runs = [
      { workflowName: 'CI', headSha: SHA, status: 'in_progress', conclusion: null },
      green('Deploy showcase and docs', SHA)
    ];
    const violations = checkCiSucceededForCommit(runs, SHA, WORKFLOWS);
    expect(violations).toEqual(['CI for a1b2c3d is in_progress']);
  });

  it('rejects a failed run without a trailing separator when there is no conclusion', () => {
    const runs = [
      { workflowName: 'CI', headSha: SHA, status: 'completed', conclusion: 'failure' },
      green('Deploy showcase and docs', SHA)
    ];
    expect(checkCiSucceededForCommit(runs, SHA, WORKFLOWS)).toEqual([
      'CI for a1b2c3d is completed/failure'
    ]);
  });

  it('rejects when one required workflow is missing entirely', () => {
    const runs = [green('CI', SHA)];
    const violations = checkCiSucceededForCommit(runs, SHA, WORKFLOWS);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('Deploy showcase and docs');
  });

  it('accepts a re-run: one failure and one success for the same commit', () => {
    const runs = [
      green('CI', SHA),
      { workflowName: 'CI', headSha: SHA, status: 'completed', conclusion: 'failure' },
      green('Deploy showcase and docs', SHA)
    ];
    expect(checkCiSucceededForCommit(runs, SHA, WORKFLOWS)).toEqual([]);
  });
});

describe('checkAdvertisedVersions', () => {
  const pin = (name: string, version: string) => ({
    file: 'examples/showcase/public/cdn.html',
    name,
    version
  });

  it('accepts pins at the released version', () => {
    expect(
      checkAdvertisedVersions(
        [pin('@holotope/core', '0.0.10'), pin('@holotope/three', '0.0.10')],
        '0.0.10'
      )
    ).toEqual([]);
  });

  it('rejects a page still advertising the previous release', () => {
    const violations = checkAdvertisedVersions(
      [pin('@holotope/core', '0.0.9'), pin('@holotope/three', '0.0.10')],
      '0.0.10'
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('@holotope/core@0.0.9');
  });
});
