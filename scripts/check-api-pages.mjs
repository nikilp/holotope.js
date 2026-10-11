/**
 * Checks that the built API reference is complete, by name.
 *
 *   node scripts/check-api-pages.mjs     after `pnpm --filter @holotope/docs build`
 *
 * Reads the built site in `docs/.vitepress/dist`, the TypeDoc option files in
 * `docs/typedoc`, and the cross-package index as committed at HEAD (the build
 * rewrites the working copy, so the committed one is the reference). The rules
 * and the failure they exist for are described in `scripts/lib/api-pages.mjs`.
 *
 * Exit status: 0 complete; 1 a re-exported name or an indexed page has no built
 * page; 2 the inputs could not be read, so completeness is not established.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  missingIndexedPages,
  missingReExportPages,
  pagesByName,
  parseJsonWithComments,
  reExportsFromPackages
} from './lib/api-pages.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DOCS = path.join(REPO, 'docs');
const TYPEDOC = path.join(DOCS, 'typedoc');
const DIST = path.join(DOCS, '.vitepress', 'dist');
const ts = createRequire(import.meta.url)('typescript');

const violations = [];
const errors = [];

/** Every file under `dir`, relative to it. */
function filesUnder(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

if (!fs.existsSync(path.join(DIST, 'api'))) {
  errors.push(`${path.relative(REPO, DIST)}/api does not exist; build the docs first`);
}

let checkedReExports = 0;
const configs = fs.readdirSync(TYPEDOC).filter((f) => f.endsWith('.json') && f !== 'external-links.json');
for (const file of errors.length > 0 ? [] : configs) {
  let config;
  try {
    config = parseJsonWithComments(fs.readFileSync(path.join(TYPEDOC, file), 'utf8'));
  } catch (error) {
    errors.push(`docs/typedoc/${file}: cannot be read (${error.message})`);
    continue;
  }
  const out = path.resolve(TYPEDOC, config.out);
  const site = path.join(DIST, path.relative(DOCS, out));
  const pkg = `@holotope/${path.basename(out)}`;
  const pages = pagesByName(filesUnder(site).filter((f) => f.endsWith('.html')));
  if (pages.size === 0) errors.push(`${pkg}: no built reference pages under ${path.relative(REPO, site)}`);
  for (const entry of config.entryPoints ?? []) {
    const source = path.resolve(TYPEDOC, entry);
    const { names, unenumerable } = reExportsFromPackages(ts, source, fs.readFileSync(source, 'utf8'));
    checkedReExports += names.length;
    for (const from of unenumerable) {
      errors.push(`${path.relative(REPO, source)}: re-exports everything from ${from}, which cannot be checked name by name`);
    }
    violations.push(...missingReExportPages(pkg, names, pages));
  }
}

let checkedIndexed = 0;
if (errors.length === 0) {
  let index;
  try {
    index = JSON.parse(
      execFileSync('git', ['show', 'HEAD:docs/typedoc/external-links.json'], { cwd: REPO, encoding: 'utf8' })
    );
  } catch (error) {
    errors.push(`the committed docs/typedoc/external-links.json cannot be read (${error.message.split('\n')[0]})`);
  }
  if (index !== undefined) {
    const { missing, unreadable } = missingIndexedPages(index, (route) =>
      fs.existsSync(path.join(DIST, `${route.replace(/^\//, '')}.html`))
    );
    errors.push(...unreadable);
    violations.push(...missing);
    checkedIndexed = Object.values(index.externalSymbolLinkMappings ?? {}).reduce(
      (sum, table) => sum + Object.keys(table ?? {}).length,
      0
    );
  }
}

if (violations.length > 0) {
  console.error('\ncheck-api-pages: the built API reference is missing pages.\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('');
  process.exit(1);
}
if (errors.length > 0) {
  console.error('\ncheck-api-pages: completeness is NOT established.\n');
  for (const error of errors) console.error(`  ${error}`);
  console.error('');
  process.exit(2);
}
console.log(
  `check-api-pages: ${checkedReExports} cross-package re-export(s) and ${checkedIndexed} indexed page(s) all have built pages.`
);
