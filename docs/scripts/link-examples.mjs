/**
 * Cross-link the generated API reference to the live showcase.
 *
 * Runs after `typedoc`, over `docs/api/`. For every Holotope symbol a showcase
 * page imports, an "Examples" section is appended to that symbol's generated
 * reference page linking to the demos that use it.
 *
 * The mapping is derived from real import statements rather than maintained by
 * hand, so it cannot drift: a demo that stops using a symbol stops linking to
 * it on the next build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(DOCS);
const SRC = path.join(REPO, 'examples/showcase/src');
const API = path.join(DOCS, 'api');
const SHOWCASE = 'https://nikilp.github.io/holotope.js';

const MARKER = '<!-- showcase-links -->';
const IMPORTS = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]@holotope\/[^'"]+['"]/g;

if (!fs.existsSync(API)) {
  console.error('link-examples: docs/api not found — run `pnpm run api` first.');
  process.exit(1);
}

// --- page titles from the showcase HTML -------------------------------------
const titleCache = new Map();
const titleOf = (page) => {
  if (titleCache.has(page)) return titleCache.get(page);
  const html = path.join(REPO, 'examples/showcase', `${page}.html`);
  let title = page;
  if (fs.existsSync(html)) {
    const src = fs.readFileSync(html, 'utf8');
    // Showcase pages are titled "Holotope.js — <page>"; the <h1> is the site
    // header and identical everywhere, so the page name lives after the dash.
    const tag = src.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim();
    const h2 = src.match(/<h2[^>]*>([^<]+)/i)?.[1]?.trim();
    title = (tag?.replace(/^Holotope\.js\s*[—–-]\s*/i, '') || h2 || page).trim();
  }
  titleCache.set(page, title);
  return title;
};

// --- symbol -> showcase pages, from real imports ----------------------------
const used = new Map();
const note = (name, page) => {
  if (!used.has(name)) used.set(name, new Set());
  used.get(name).add(page);
};

for (const file of fs.readdirSync(SRC)) {
  if (!file.endsWith('.ts') || file === 'ui.ts') continue;
  const page = file.replace(/\.ts$/, '');
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  for (const match of src.matchAll(IMPORTS)) {
    for (const raw of match[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) note(name, page);
    }
  }
}

// --- index every generated page by symbol name ------------------------------
const pageOf = new Map();
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.md') && entry.name !== 'index.md') {
      const symbol = entry.name.replace(/\.md$/, '');
      if (!pageOf.has(symbol)) pageOf.set(symbol, []);
      pageOf.get(symbol).push(full);
    }
  }
};
walk(API);

// --- append -----------------------------------------------------------------
let linked = 0;
const missing = [];

for (const [symbol, pages] of used) {
  const targets = pageOf.get(symbol);
  if (!targets) { missing.push(symbol); continue; }

  const sorted = [...pages].sort();
  const list = sorted.map((p) => `- [${titleOf(p)}](${SHOWCASE}/${p}.html)`).join('\n');
  const block = [
    '',
    MARKER,
    '## Examples',
    '',
    `Used by ${sorted.length} showcase ${sorted.length === 1 ? 'demo' : 'demos'}:`,
    '',
    list,
    ''
  ].join('\n');

  for (const target of targets) {
    let md = fs.readFileSync(target, 'utf8');
    const at = md.indexOf(MARKER);
    if (at !== -1) md = md.slice(0, at).trimEnd() + '\n';
    fs.writeFileSync(target, md.trimEnd() + '\n' + block);
    linked++;
  }
}

console.log(
  `link-examples: ${linked} reference pages linked to demos ` +
    `(${used.size} symbols used by the showcase, ${missing.length} not found in the reference).`
);
if (missing.length) console.log('  not in reference:', missing.sort().join(', '));
