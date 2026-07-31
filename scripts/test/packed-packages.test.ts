import { describe, expect, it } from 'vitest';
import {
  PUBLIC_PACKAGES,
  buildReport,
  checkExportTargetsPresent,
  checkFixtureIsolation,
  checkIsolatedResolution,
  checkPackedManifestSpecifiers,
  checkRepositoryMetadata,
  checkTarballContents,
  checkThreePeerRange,
  checkVersionsAgree
  // @ts-expect-error -- a plain .mjs module with no declarations; the rules it
  // holds are the subject, and typing it would duplicate them.
} from '../lib/packed-packages.mjs';

/**
 * Negative controls for the release verifier.
 *
 * Each case is a defect that would otherwise reach npm, expressed as the
 * smallest synthetic input that exhibits it. They exist because the verifier
 * is the only thing standing between a broken tarball and a publication, and
 * a check nobody has watched fail is not known to work.
 */

const REPO = '/Users/someone/checkout';

describe('the publication set is closed', () => {
  it('names five packages in dependency order', () => {
    expect([...PUBLIC_PACKAGES]).toEqual([
      'core',
      'three',
      'physics',
      'experiment',
      'experiment-physics'
    ]);
  });
});

describe('checkVersionsAgree', () => {
  it('accepts one shared version', () => {
    expect(
      checkVersionsAgree([
        { directory: 'core', manifest: { version: '0.0.9' } },
        { directory: 'three', manifest: { version: '0.0.9' } }
      ])
    ).toEqual([]);
  });

  it('rejects a split version, which would publish a broken set', () => {
    const violations = checkVersionsAgree([
      { directory: 'core', manifest: { version: '0.0.9' } },
      { directory: 'three', manifest: { version: '0.0.8' } }
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('disagree on version');
  });
});

describe('checkPackedManifestSpecifiers', () => {
  it('rejects a surviving workspace: dependency', () => {
    const violations = checkPackedManifestSpecifiers(
      {
        name: '@holotope/three',
        dependencies: { '@holotope/core': 'workspace:*' }
      },
      REPO
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('workspace:*');
  });

  it('rejects a file: dependency pointing into the repository', () => {
    const violations = checkPackedManifestSpecifiers(
      {
        name: '@holotope/three',
        dependencies: { '@holotope/core': `file:${REPO}/packages/core` }
      },
      REPO
    );
    // Both the unresolvable prefix and the embedded path are reported.
    expect(violations.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts ordinary release versions', () => {
    expect(
      checkPackedManifestSpecifiers(
        {
          name: '@holotope/three',
          dependencies: { '@holotope/core': '0.0.9' },
          peerDependencies: { three: '>=0.185.0 <0.186.0' }
        },
        REPO
      )
    ).toEqual([]);
  });
});

describe('checkExportTargetsPresent', () => {
  const manifest = {
    name: '@holotope/core',
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './math': { types: './dist/math/index.d.ts', import: './dist/math/index.js' }
    }
  };

  it('accepts a tarball containing every declared target', () => {
    expect(
      checkExportTargetsPresent(manifest, [
        'package/package.json',
        'package/dist/index.d.ts',
        'package/dist/index.js',
        'package/dist/math/index.d.ts',
        'package/dist/math/index.js'
      ])
    ).toEqual([]);
  });

  it('rejects a missing export target', () => {
    const violations = checkExportTargetsPresent(manifest, [
      'package/package.json',
      'package/dist/index.d.ts',
      'package/dist/index.js',
      'package/dist/math/index.js'
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('./dist/math/index.d.ts');
  });

  it('rejects a missing declaration even when the JavaScript is present', () => {
    const violations = checkExportTargetsPresent(
      { name: '@holotope/core', types: './dist/index.d.ts' },
      ['package/dist/index.js']
    );
    expect(violations).toHaveLength(1);
  });
});

describe('checkTarballContents', () => {
  const manifest = { name: '@holotope/core' };

  it('accepts a manifest and dist output', () => {
    expect(
      checkTarballContents(manifest, [
        'package/package.json',
        'package/dist/index.js',
        'package/dist/index.d.ts',
        'package/README.md'
      ])
    ).toEqual([]);
  });

  it('rejects shipped source, which would let a consumer resolve past exports', () => {
    const violations = checkTarballContents(manifest, [
      'package/package.json',
      'package/dist/index.js',
      'package/src/index.ts'
    ]);
    expect(violations.join(' ')).toContain('src/index.ts');
  });

  it('rejects a tarball with no build output', () => {
    const violations = checkTarballContents(manifest, ['package/package.json']);
    expect(violations).toEqual(['@holotope/core: tarball has no dist/ output']);
  });
});

describe('checkRepositoryMetadata', () => {
  it('rejects a manifest naming a sibling directory', () => {
    const violations = checkRepositoryMetadata('experiment-physics', {
      name: '@holotope/experiment-physics',
      repository: { directory: 'packages/experiment' }
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('packages/experiment-physics');
  });

  it('accepts a manifest naming its own directory', () => {
    expect(
      checkRepositoryMetadata('core', {
        name: '@holotope/core',
        repository: { directory: 'packages/core' }
      })
    ).toEqual([]);
  });
});

describe('checkThreePeerRange', () => {
  it('rejects a dropped peer range', () => {
    expect(checkThreePeerRange({ name: '@holotope/three' })).toHaveLength(1);
  });

  it('accepts a declared range', () => {
    expect(
      checkThreePeerRange({
        name: '@holotope/three',
        peerDependencies: { three: '>=0.185.0 <0.186.0' }
      })
    ).toEqual([]);
  });
});

describe('checkIsolatedResolution', () => {
  const local = (name: string) => `
      '${name}':
        specifier: file:./vendor/x.tgz
        version: file:vendor/x.tgz
`;

  it('accepts an install whose packages all came from local tarballs', () => {
    const lockfile = `importers:\n  .:\n    dependencies:${local('@holotope/core')}
snapshots:

  '@holotope/core@file:vendor/core.tgz': {}
`;
    expect(checkIsolatedResolution(lockfile, ['@holotope/core'])).toEqual([]);
  });

  it('rejects a root dependency resolved from the registry', () => {
    const lockfile = `importers:
  .:
    dependencies:
      '@holotope/core':
        specifier: ^0.0.8
        version: 0.0.8
`;
    const violations = checkIsolatedResolution(lockfile, ['@holotope/core']);
    expect(violations.join(' ')).toContain('not from a local tarball');
  });

  it('rejects a transitive registry copy beside the local one', () => {
    // The defect the first real run exhibited: a packed adapter depends on its
    // sibling by version, so the isolated install fetched the *previous*
    // release alongside the artifact under test.
    const lockfile = `importers:\n  .:\n    dependencies:${local('@holotope/core')}
snapshots:

  '@holotope/core@0.0.8': {}

  '@holotope/core@file:vendor/core.tgz': {}
`;
    const violations = checkIsolatedResolution(lockfile, ['@holotope/core']);
    expect(violations.join(' ')).toContain('from the registry');
  });

  it('rejects a package absent from the lockfile entirely', () => {
    expect(
      checkIsolatedResolution('importers:\n  .:\n', ['@holotope/core']).join(' ')
    ).toContain('absent from the isolated lockfile');
  });
});

describe('checkFixtureIsolation', () => {
  it('rejects a TypeScript paths mapping', () => {
    const violations = checkFixtureIsolation(
      'tsconfig.json',
      '{ "compilerOptions": { "paths": { "@holotope/core": ["../../packages/core/src/index.ts"] } } }',
      REPO
    );
    expect(violations.join(' ')).toContain('paths');
  });

  it('rejects a bundler alias', () => {
    const violations = checkFixtureIsolation(
      'vite.config.ts',
      'export default { resolve: { alias: { "@holotope/core": "/src" } } };',
      REPO
    );
    expect(violations.join(' ')).toContain('alias');
  });

  it('rejects an absolute path into the checkout', () => {
    const violations = checkFixtureIsolation(
      'src/main.ts',
      `import { createHypercube } from '${REPO}/packages/core/dist/index.js';`,
      REPO
    );
    expect(violations.join(' ')).toContain('embeds the repository path');
  });

  it('rejects skipLibCheck, which would hide declaration defects', () => {
    const violations = checkFixtureIsolation(
      'tsconfig.json',
      '{ "compilerOptions": { "skipLibCheck": true } }',
      REPO
    );
    expect(violations.join(' ')).toContain('skipLibCheck');
  });

  it('accepts a fixture that imports by package name', () => {
    expect(
      checkFixtureIsolation(
        'src/main.ts',
        "import { createHypercube } from '@holotope/core';",
        REPO
      )
    ).toEqual([]);
  });
});

describe('buildReport', () => {
  it('is stable: no timestamps, paths, durations, or byte counts', () => {
    const report = buildReport([
      { name: '@holotope/core', version: '0.0.9', sha256: 'abc', bytes: 1234, tarball: '/tmp/x' }
    ]);
    expect(report.status).toBe('passed');
    expect(report.packages).toEqual([
      { name: '@holotope/core', version: '0.0.9', sha256: 'abc', resolvedFromLocalTarball: true }
    ]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('/tmp/');
    expect(serialized).not.toContain('1234');
    expect(JSON.stringify(buildReport([]))).toBe(JSON.stringify(buildReport([])));
  });
});
