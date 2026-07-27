/**
 * Cross-package reference links.
 *
 * Each package is a separate TypeDoc run, so a type one package borrows from
 * another is outside the run that mentions it and renders as plain text: a
 * reader looking at `SlicedComplex3D` sees the `CellComplex` and
 * `HyperplaneSlice4` it needs and can follow neither. TypeDoc resolves such a
 * symbol through `externalSymbolLinkMappings`, which this writes from the
 * pages a producing package actually emitted — so the mapping cannot name a
 * page that does not exist, and gains new symbols without being edited.
 *
 * Only same-name pages are mapped. A symbol re-declared in two packages is
 * skipped rather than guessed at, since the borrowing package's own
 * declaration is the one its reader means.
 *
 *   node scripts/link-packages.mjs      rewrite typedoc/external-links.json
 *
 * Must run after the producing packages are generated and before the
 * consuming ones, which is the order `pnpm run api` uses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(DOCS, 'typedoc', 'external-links.json');

/** Packages whose emitted pages may be linked to from another package. */
const PRODUCERS = [
  { pkg: '@holotope/core', dir: 'core' },
  { pkg: '@holotope/experiment', dir: 'experiment' },
  { pkg: '@holotope/three', dir: 'three' }
];

/** Every `Name -> route` pair a producing package published. */
const pagesOf = (dir) => {
  const root = path.join(DOCS, 'api', dir);
  const found = new Map();
  const walk = (current) => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.md') || entry.name === 'index.md') continue;
      const name = entry.name.slice(0, -3);
      // A duplicated basename cannot be resolved to one route, so neither is
      // offered: a wrong link is worse than the plain text it replaced.
      found.set(name, found.has(name) ? null : `/${path.relative(DOCS, full).replace(/\\/g, '/').replace(/\.md$/, '')}`);
    }
  };
  walk(root);
  return found;
};

const mappings = {};
let total = 0;
for (const { pkg, dir } of PRODUCERS) {
  const routes = pagesOf(dir);
  const usable = Object.fromEntries(
    [...routes].filter(([, route]) => route !== null).sort(([a], [b]) => a.localeCompare(b))
  );
  const dropped = [...routes.values()].filter((route) => route === null).length;
  mappings[pkg] = usable;
  total += Object.keys(usable).length;
  console.log(
    `link-packages: ${pkg} exposes ${Object.keys(usable).length} linkable page(s)` +
      (dropped ? `, ${dropped} skipped as ambiguous` : '')
  );
}

if (total === 0) {
  console.error('link-packages: no producing pages found — generate them first.');
  process.exit(1);
}

fs.writeFileSync(
  OUT,
  `${JSON.stringify({ externalSymbolLinkMappings: mappings }, null, 2)}\n`
);
console.log(`link-packages: wrote ${total} mapping(s) -> typedoc/external-links.json`);
