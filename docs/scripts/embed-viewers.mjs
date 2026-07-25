/**
 * Embed the live polytope viewer into the reference pages it covers.
 *
 * The viewer is one page in the showcase, selected by URL fragment, so the
 * set of builders it serves is exactly the set of keys in its `SPECS` table.
 * That table is read here rather than restated, so a builder gains or loses
 * its embed by being registered in the viewer and nowhere else.
 *
 * The iframe is placed after a symbol's description and before its first
 * section, where a reader meets the shape before the signature.
 *
 *   node scripts/embed-viewers.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(DOCS);
const API = path.join(DOCS, 'api');
const VIEWER_SRC = path.join(REPO, 'examples/showcase/src/polytope-browser.ts');
const VIEWER_URL = 'https://nikilp.github.io/holotope.js/polytope-browser.html';

const MARKER = '<!-- live-viewer -->';

if (!fs.existsSync(API)) {
  console.error('embed-viewers: docs/api not found — run `pnpm run api` first.');
  process.exit(1);
}

// Keys of the SPECS record, in source order.
const source = fs.readFileSync(VIEWER_SRC, 'utf8');
const specsBlock = source.slice(source.indexOf('const SPECS'));
const builders = [...specsBlock.matchAll(/^ {2}(create[A-Za-z0-9]+):\s*\{/gm)].map((m) => m[1]);

if (!builders.length) {
  console.error('embed-viewers: no builders found in the viewer SPECS table.');
  process.exit(1);
}

// Index generated pages by symbol name.
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

let embedded = 0;
const missing = [];

for (const builder of builders) {
  const targets = pageOf.get(builder);
  if (!targets) { missing.push(builder); continue; }

  const block = [
    MARKER,
    '<iframe',
    `  src="${VIEWER_URL}#${builder}"`,
    `  title="Live ${builder} viewer"`,
    '  loading="lazy"',
    '  style="width:100%;aspect-ratio:16/10;border:1px solid var(--vp-c-divider);border-radius:8px;margin:1.25rem 0;"',
    '></iframe>',
    ''
  ].join('\n');

  for (const target of targets) {
    const lines = fs.readFileSync(target, 'utf8').split('\n');

    // Drop a previous embed so the step is idempotent across rebuilds.
    const existing = lines.findIndex((l) => l.includes(MARKER));
    if (existing !== -1) {
      const end = lines.findIndex((l, i) => i > existing && l.startsWith('></iframe>'));
      if (end !== -1) lines.splice(existing, end - existing + 2);
    }

    const firstSection = lines.findIndex((l, i) => i > 0 && /^## /.test(l));
    const at = firstSection === -1 ? lines.length : firstSection;
    lines.splice(at, 0, ...block.split('\n'));

    fs.writeFileSync(target, lines.join('\n'));
    embedded++;
  }
}

console.log(
  `embed-viewers: ${embedded} reference page(s) carry a live viewer ` +
    `(${builders.length} builders registered${missing.length ? `, ${missing.length} not in the reference` : ''}).`
);
if (missing.length) console.log('  not in reference:', missing.join(', '));
