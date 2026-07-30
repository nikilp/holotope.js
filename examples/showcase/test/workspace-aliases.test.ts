import { describe, expect, it } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import config from '../vite.config';

/**
 * The showcase resolves workspace packages to their sources so the site builds
 * without a prior `pnpm build`. The Pages workflow relies on that: it installs
 * and then runs the showcase build directly, with no package build step.
 *
 * A workspace dependency added without a matching alias therefore falls back to
 * node resolution, reaches for `packages/<name>/dist`, and fails only in CI —
 * `dist` is gitignored, so a developer with a built tree never sees it. That is
 * exactly how `@holotope/experiment` and `@holotope/experiment-physics` broke
 * the deploy while the CI job, which runs `pnpm verify` and therefore builds
 * first, stayed green.
 */
function aliasEntries(): { find: string; replacement: string }[] {
  const alias = config.resolve?.alias;
  if (!Array.isArray(alias)) {
    throw new Error('showcase vite config must declare resolve.alias as an array');
  }
  return alias.flatMap((entry) =>
    typeof entry.find === 'string' && typeof entry.replacement === 'string'
      ? [{ find: entry.find, replacement: entry.replacement }]
      : []
  );
}

async function workspaceDependencies(): Promise<string[]> {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  ) as { dependencies?: Record<string, string> };
  return Object.entries(manifest.dependencies ?? {})
    .filter(([name, range]) => name.startsWith('@holotope/') && range.startsWith('workspace:'))
    .map(([name]) => name);
}

describe('showcase workspace aliases', () => {
  it('aliases every @holotope workspace dependency to a source entry', async () => {
    const aliased = new Set(aliasEntries().map((entry) => entry.find));
    const missing = (await workspaceDependencies()).filter((name) => !aliased.has(name));

    expect(
      missing,
      `these workspace dependencies have no source alias, so the showcase build `
        + `would resolve them through packages/*/dist and fail wherever that is `
        + `not built: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('points every alias at a file that exists', async () => {
    for (const { find, replacement } of aliasEntries()) {
      await expect(
        access(replacement),
        `alias ${find} points at a missing file: ${replacement}`
      ).resolves.toBeUndefined();
    }
  });

  it('orders a subpath alias before the package it lives under', () => {
    const entries = aliasEntries();
    for (let parent = 0; parent < entries.length; parent += 1) {
      for (let child = parent + 1; child < entries.length; child += 1) {
        expect(
          entries[child]!.find.startsWith(`${entries[parent]!.find}/`),
          `alias ${entries[child]!.find} is a subpath of ${entries[parent]!.find} `
            + 'but is listed after it, so the parent would match first'
        ).toBe(false);
      }
    }
  });
});
