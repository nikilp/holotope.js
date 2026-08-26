import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  releaseHeadings,
  releaseNotes
  // @ts-expect-error -- a plain .mjs module with no declarations; the rules it
  // holds are the subject, and typing it would duplicate them.
} from '../lib/release-notes.mjs';

/**
 * The release-notes generator, against the two bodies it has to reproduce and
 * the malformed changelogs it has to refuse.
 *
 * The first two cases are the load-bearing ones. `v0.0.21` and `v0.0.22` are
 * already published, their bodies were written by the ritual this generator
 * replaces, and both are immutable history — so "generates the same bytes" is
 * a claim about an artifact that exists, not a snapshot of whatever the code
 * happens to emit today.
 */

const REPO = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CHANGELOG = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
const SLUG = 'nikilp/holotope.js';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * The published bodies, by size and digest rather than as committed copies.
 *
 * Captured on 2026-08-26 from the live Releases with
 * `gh api repos/nikilp/holotope.js/releases/tags/<tag>` and reading `.body` —
 * not through `--jq`, which appends a newline the stored body does not have.
 * Neither body contains a CR; each ends in exactly one LF.
 *
 * A digest rather than a fixture because a fixture would duplicate 16 KB of
 * changelog prose into the test tree, and a second copy of release notes is a
 * second thing that can drift. Length is asserted first so an edit to a
 * published section fails as a readable size mismatch before it fails as a
 * digest.
 */
const PUBLISHED = {
  'v0.0.21': {
    bytes: 5859,
    sha256: '99111c730654151c8a4b57b123f18f0238e1f873cebb28f055274c2ee1be57b9',
    link: '**Full Changelog**: https://github.com/nikilp/holotope.js/compare/v0.0.20...v0.0.21'
  },
  'v0.0.22': {
    bytes: 10432,
    sha256: '9d4b65d3842f22a68b5f8a519f83e1cffefcc6f4f034451c4f4c0b135af40a60',
    link: '**Full Changelog**: https://github.com/nikilp/holotope.js/compare/v0.0.21...v0.0.22'
  }
} as const;

describe('the published release bodies', () => {
  for (const [tag, expected] of Object.entries(PUBLISHED)) {
    it(`regenerates ${tag} byte for byte from the committed changelog`, () => {
      const body = releaseNotes(CHANGELOG, tag, SLUG);
      expect(Buffer.byteLength(body, 'utf8')).toBe(expected.bytes);
      expect(sha256(body)).toBe(expected.sha256);
      expect(body.endsWith(`${expected.link}\n`)).toBe(true);
      expect(body).not.toContain('\r');
      expect(body.endsWith('\n\n')).toBe(false);
    });
  }
});

/**
 * A section carrying every markdown shape the real changelog uses, including
 * the repeated `###` package headings a release with two packages produces.
 */
const MARKDOWN_SECTION = [
  '',
  'Intro paragraph with a `code span` and an *emphasis*.',
  '',
  '### `@holotope/physics@9.9.9` — added',
  '',
  '- **A bullet.** With a second sentence.',
  '  - a nested bullet',
  '- Another bullet with `inline` code.',
  '',
  '### `@holotope/core@9.9.9` — added',
  '',
  '- One more bullet.',
  '',
  '```md',
  '## v9.9.8',
  '```',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  ''
].join('\n');

const changelogWith = (sections: string) => `# Changelog\n\n${sections}`;

const TWO_RELEASES = changelogWith(
  `## v9.9.9\n${MARKDOWN_SECTION}\n## v9.9.8\n\nOlder release.\n`
);

describe('content preservation', () => {
  it('preserves every markdown shape in the section verbatim', () => {
    const body = releaseNotes(TWO_RELEASES, 'v9.9.9', SLUG);
    // The whole section, minus only its trailing newlines, appears unchanged.
    expect(body.startsWith(MARKDOWN_SECTION.replace(/\n+$/, ''))).toBe(true);
    for (const fragment of [
      '### `@holotope/physics@9.9.9` — added',
      '### `@holotope/core@9.9.9` — added',
      '  - a nested bullet',
      '`code span`',
      '```md',
      '| --- | --- |'
    ]) {
      expect(body).toContain(fragment);
    }
    // Both `###` headings survive; the section is not deduplicated or reflowed.
    expect(body.split('### ').length - 1).toBe(2);
    // Blank lines inside the section are untouched.
    expect(body).toContain('added\n\n- **A bullet.**');
  });

  it('keeps the leading blank line and ends with one newline', () => {
    const body = releaseNotes(TWO_RELEASES, 'v9.9.9', SLUG);
    expect(body.startsWith('\n')).toBe(true);
    expect(body.endsWith('\n')).toBe(true);
    expect(body.endsWith('\n\n')).toBe(false);
  });

  /**
   * A release heading inside a fence is content, not a boundary.
   *
   * The two fence forms are separate cases on purpose. An earlier version of
   * this suite put the `##` mid-line, where `startsWith('## ')` is never true,
   * so removing fence tracking altogether left all 25 tests green. Each case
   * below fails if fence tracking is removed, and the tilde case additionally
   * fails if only `~~~` is recognised as a fence.
   */
  describe.each([
    ['backtick', '```md'],
    ['tilde', '~~~md']
  ])('a %s fence containing a release heading', (_form, open) => {
    const close = open.slice(0, 3);
    const changelog = changelogWith(
      [
        '## v9.9.9',
        '',
        'Before the fence.',
        '',
        open,
        '## v9.9.8',
        close,
        '',
        'After the fence.',
        '',
        '## v9.9.8',
        '',
        'The genuinely older release.',
        ''
      ].join('\n')
    );

    it('keeps the fenced heading as body content', () => {
      const body = releaseNotes(changelog, 'v9.9.9', SLUG);
      expect(body).toContain(`${open}\n## v9.9.8\n${close}`);
    });

    it('keeps the prose that follows the closing fence', () => {
      expect(releaseNotes(changelog, 'v9.9.9', SLUG)).toContain('After the fence.');
    });

    it('ends the section at the next genuine release heading', () => {
      const body = releaseNotes(changelog, 'v9.9.9', SLUG);
      expect(body).not.toContain('The genuinely older release.');
      expect(body).toContain('compare/v9.9.8...v9.9.9');
    });
  });

  /**
   * Only a release heading ends a section.
   *
   * The boundary is the next level-two *release* heading, so an ordinary
   * level-two section between two releases belongs to the newer release's
   * notes. This fails if the implementation stops at the next arbitrary `##`.
   */
  it('carries a non-release level-two heading into the body', () => {
    const changelog = changelogWith(
      [
        '## v9.9.9',
        '',
        'Intro.',
        '',
        '## Notes for maintainers',
        '',
        'Some non-release content.',
        '',
        '## v9.9.8',
        '',
        'Older release.',
        ''
      ].join('\n')
    );
    const body = releaseNotes(changelog, 'v9.9.9', SLUG);
    expect(body).toContain('## Notes for maintainers');
    expect(body).toContain('Some non-release content.');
    expect(body).not.toContain('Older release.');
    expect(body).toContain('compare/v9.9.8...v9.9.9');
  });

  it('compares against the immediately preceding release', () => {
    const three = changelogWith('## v9.9.9\n\nNewest.\n\n## v9.9.8\n\nMiddle.\n\n## v9.9.7\n\nOldest.\n');
    expect(releaseNotes(three, 'v9.9.9', SLUG)).toContain('compare/v9.9.8...v9.9.9');
    expect(releaseNotes(three, 'v9.9.8', SLUG)).toContain('compare/v9.9.7...v9.9.8');
  });

  it('builds the link from the repository it is given', () => {
    expect(releaseNotes(TWO_RELEASES, 'v9.9.9', 'someone/fork')).toContain(
      'https://github.com/someone/fork/compare/v9.9.8...v9.9.9'
    );
  });
});

describe('refusals', () => {
  it('rejects a tag with no section', () => {
    expect(() => releaseNotes(TWO_RELEASES, 'v9.9.7', SLUG)).toThrow(/no "## v9\.9\.7" section/);
  });

  it('rejects a duplicated section rather than picking one', () => {
    const duplicated = changelogWith('## v9.9.9\n\nFirst.\n\n## v9.9.9\n\nSecond.\n\n## v9.9.8\n\nOld.\n');
    expect(() => releaseNotes(duplicated, 'v9.9.9', SLUG)).toThrow(/2 "## v9\.9\.9" sections/);
  });

  it('rejects a version-shaped heading it cannot parse', () => {
    for (const heading of ['## v9.9', '## v9.9.9 — fixed', '##  v9.9.9', '## v1', '## V2.0']) {
      const malformed = changelogWith(`${heading}\n\nBody.\n\n## v9.9.8\n\nOld.\n`);
      expect(() => releaseNotes(malformed, 'v9.9.9', SLUG)).toThrow(/malformed release heading/);
    }
  });

  /**
   * A title that merely starts with V is not version-shaped.
   *
   * The near-release detector once matched a bare `v`, which made every one of
   * these refuse — a changelog with an ordinary `## Versioning` section could
   * not have notes built from it at all.
   */
  it('does not mistake an ordinary V-headed section for a malformed release', () => {
    for (const heading of [
      '## Versioning',
      '## Version policy',
      '## Validation',
      '## Vertices',
      '## Various fixes',
      '## Vector conventions'
    ]) {
      const changelog = changelogWith(
        `## v9.9.9\n\nIntro.\n\n${heading}\n\nProse.\n\n## v9.9.8\n\nOld.\n`
      );
      const body = releaseNotes(changelog, 'v9.9.9', SLUG);
      expect(body).toContain(heading);
      expect(body).toContain('Prose.');
      expect(body).not.toContain('Old.');
    }
  });

  it('rejects a tag that is not a release tag', () => {
    for (const tag of ['0.0.22', 'v0.0', 'latest', 'v0.0.22-rc.1']) {
      expect(() => releaseNotes(TWO_RELEASES, tag, SLUG)).toThrow(/is not a release tag/);
    }
  });

  it('rejects an empty section', () => {
    for (const empty of ['## v9.9.9\n\n## v9.9.8\n\nOld.\n', '## v9.9.9\n\n   \n\n## v9.9.8\n\nOld.\n']) {
      expect(() => releaseNotes(changelogWith(empty), 'v9.9.9', SLUG)).toThrow(/section is empty/);
    }
  });

  it('rejects the oldest release, which has nothing to compare against', () => {
    const only = changelogWith('## v9.9.9\n\nThe first one.\n');
    expect(() => releaseNotes(only, 'v9.9.9', SLUG)).toThrow(/oldest release/);
  });

  it('finds no release headings in a changelog that has none', () => {
    expect(releaseHeadings('# Changelog\n\nNothing yet.\n'.split('\n'))).toEqual([]);
  });
});

describe('the workflow uses the generator', () => {
  const workflow = fs.readFileSync(path.join(REPO, '.github/workflows/release.yml'), 'utf8');

  it('no longer asks GitHub to generate notes', () => {
    expect(workflow).not.toContain('--generate-notes');
  });

  it('creates the Release from the generated file', () => {
    expect(workflow).toContain('--notes-file "$RUNNER_TEMP/release-notes.md"');
    expect(workflow).toContain('node scripts/release-notes.mjs');
    expect(workflow).toContain('--out "$RUNNER_TEMP/release-notes.md"');
  });

  it('keeps the safeguards the Release step already had', () => {
    expect(workflow).toContain('--verify-tag');
    expect(workflow).toContain("if: github.ref_type == 'tag'");
    expect(workflow).toContain('--access public --provenance');
    expect(workflow).toContain('id-token: write');
  });

  it('generates the notes before anything is published', () => {
    expect(workflow.indexOf('node scripts/release-notes.mjs')).toBeLessThan(
      workflow.indexOf('npm publish')
    );
  });

  it('passes the tag as an environment value, not by interpolation', () => {
    expect(workflow).toContain('--tag "$GITHUB_REF_NAME"');
    expect(workflow).not.toMatch(/--tag "\$\{\{/);
  });
});

/**
 * Proof that the two published-body cases discriminate.
 *
 * Each mutant is a plausible way to get the transformation slightly wrong. The
 * generator source is mutated in memory and imported as a `data:` module — the
 * real file is never written to, and nothing is left behind on disk. A mutant
 * that still satisfied the recorded size and digest would mean those
 * assertions accept any output.
 *
 * `data:` works here because the generator imports nothing; a module with
 * relative imports could not be loaded this way.
 */
describe('mutation gate', () => {
  const source = fs.readFileSync(path.join(REPO, 'scripts/lib/release-notes.mjs'), 'utf8');

  const load = (text: string) =>
    import(`data:text/javascript;base64,${Buffer.from(text, 'utf8').toString('base64')}`);

  const MUTANTS: readonly (readonly [string, string, string])[] = [
    ['one blank line before the link', "'\\n\\n\\n'", "'\\n\\n'"],
    ['no trailing newline', '}${LINK_SEPARATOR}${link}\\n`', '}${LINK_SEPARATOR}${link}`'],
    ['trims the leading blank line too', "content.replace(/\\n+$/, '')", 'content.trim()'],
    ['keeps the heading line', 'current.index + 1', 'current.index'],
    ['compares against the wrong neighbour', 'releases.indexOf(current) + 1', 'releases.indexOf(current) + 2']
  ];

  for (const [name, from, to] of MUTANTS) {
    it(`catches: ${name}`, async () => {
      expect(source).toContain(from);
      const mutant = await load(source.replace(from, to));

      let survived = false;
      for (const [tag, expected] of Object.entries(PUBLISHED)) {
        let body: string;
        try {
          body = mutant.releaseNotes(CHANGELOG, tag, SLUG);
        } catch {
          continue; // Throwing is a caught mutant too.
        }
        if (Buffer.byteLength(body, 'utf8') === expected.bytes && sha256(body) === expected.sha256) {
          survived = true;
        }
      }
      expect(survived).toBe(false);
    });
  }

  it('the unmutated source still passes, so the gate is not rejecting everything', async () => {
    const control = await load(source);
    for (const [tag, expected] of Object.entries(PUBLISHED)) {
      expect(sha256(control.releaseNotes(CHANGELOG, tag, SLUG))).toBe(expected.sha256);
    }
  });
});
