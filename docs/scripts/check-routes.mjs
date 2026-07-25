/**
 * Route gate for the built site.
 *
 * The other documentation checks read markdown sources. Some links exist only
 * in the rendered output — sidebars, navigation, and theme chrome are
 * generated from configuration and appear on every page — so a target that was
 * never emitted is invisible to a source-level check and to a build that
 * succeeds. A sidebar entry is the worst case: one wrong target is wrong on
 * every page the sidebar covers.
 *
 * Every internal href in the built site is resolved against the files the
 * build actually wrote. A directory target counts as resolved only when an
 * index page was emitted for it.
 *
 *   node scripts/check-routes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(DOCS, '.vitepress/dist');

if (!fs.existsSync(DIST)) {
  console.error('check-routes: no build found — run `pnpm run build` first.');
  process.exit(2);
}

// Read the site base from the built output rather than restating it here.
const home = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const base = home.match(/href="(\/[^"]*?\/)assets\//)?.[1] ?? '/';
const prefix = base.replace(/\/$/, '');

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(DIST);

const emitted = new Set();
for (const file of files) {
  const rel = '/' + path.relative(DIST, file).split(path.sep).join('/');
  emitted.add(prefix + rel);
  // VitePress links pages without their extension.
  if (rel.endsWith('.html')) emitted.add(prefix + rel.replace(/\.html$/, ''));
  // A directory is navigable only where an index page exists.
  if (rel.endsWith('/index.html')) {
    emitted.add(prefix + rel.replace(/index\.html$/, ''));
    emitted.add(prefix + rel.replace(/\/index\.html$/, ''));
  }
}

const pages = files.filter((f) => f.endsWith('.html'));
const unresolved = new Map();
let checked = 0;

for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (!href.startsWith(prefix + '/')) continue; // external, anchor, or asset host
    const target = href.split('#')[0].split('?')[0];
    if (!target) continue;
    checked++;
    if (emitted.has(target) || emitted.has(target.replace(/\/$/, ''))) continue;
    if (!unresolved.has(target)) unresolved.set(target, new Set());
    unresolved.get(target).add(path.relative(DIST, page));
  }
}

console.log(
  `check-routes: ${pages.length} pages, ${checked} internal links, ` +
    `${unresolved.size} unresolved target(s).`
);

if (!unresolved.size) {
  console.log('Every internal route resolves.');
  process.exit(0);
}

console.error('');
for (const [target, sources] of [...unresolved].sort((a, b) => b[1].size - a[1].size)) {
  const from = [...sources];
  console.error(`  ${target}`);
  console.error(`    linked from ${from.length} page(s), e.g. ${from.slice(0, 2).join(', ')}`);
}
console.error(
  '\nA target reached from many pages is usually navigation or a sidebar,\n' +
    'where one wrong entry repeats across every page it covers.\n'
);
process.exit(1);
