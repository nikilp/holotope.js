/**
 * Put a runnable copy of each symbol's example on its reference page.
 *
 * The playground starts from the same `@example` block the page renders, so a
 * reader can run what they have just read without retyping it, and the two
 * cannot disagree. Only symbols that actually have an example get one.
 *
 *   node scripts/embed-playground.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(DOCS);
const API = path.join(DOCS, 'api');
const CATALOGUE = path.join(REPO, 'examples/showcase/src/generated-examples.json');
const SHOWCASE = 'https://nikilp.github.io/holotope.js';

const MARKER = '<!-- playground -->';

if (!fs.existsSync(API)) {
  console.error('embed-playground: docs/api not found — run `pnpm run api` first.');
  process.exit(1);
}
if (!fs.existsSync(CATALOGUE)) {
  console.error(
    'embed-playground: no example catalogue. Build the showcase once so\n' +
      '  examples/showcase/scripts/extract-examples.mjs has run.'
  );
  process.exit(1);
}

const symbols = Object.keys(JSON.parse(fs.readFileSync(CATALOGUE, 'utf8')));

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

for (const symbol of symbols) {
  const targets = pageOf.get(symbol);
  if (!targets) { missing.push(symbol); continue; }

  const block = [
    '',
    MARKER,
    '## Run it',
    '',
    'The example above, running. Edit and re-run in place.',
    '',
    '<iframe',
    `  src="${SHOWCASE}/playground.html#${symbol}"`,
    `  title="Playground for ${symbol}"`,
    '  loading="lazy"',
    '  style="width:100%;aspect-ratio:16/9;min-height:380px;border:1px solid var(--vp-c-divider);border-radius:8px;margin:1rem 0;"',
    '></iframe>',
    ''
  ].join('\n');

  for (const target of targets) {
    let md = fs.readFileSync(target, 'utf8');
    const at = md.indexOf(MARKER);
    if (at !== -1) md = md.slice(0, at).trimEnd() + '\n';
    fs.writeFileSync(target, md.trimEnd() + '\n' + block);
    embedded++;
  }
}

// The Learn page lists every runnable example. Written from the same catalogue
// rather than maintained by hand, so registering an example lists it.
const LEARN = path.join(DOCS, 'learn/playground.md');
if (fs.existsSync(LEARN)) {
  const rows = symbols
    .filter((s) => pageOf.has(s))
    .sort()
    .map((s) => {
      const page = path.relative(DOCS, pageOf.get(s)[0]).replace(/\.md$/, '');
      return `| [\`${s}\`](/${page}) | [open](${SHOWCASE}/playground.html#${s}) |`;
    });
  const table = ['| symbol | |', '| --- | --- |', ...rows].join('\n');
  const learn = fs.readFileSync(LEARN, 'utf8');
  const marker = '<!-- runnable-examples -->';
  const at = learn.indexOf(marker);
  if (at !== -1) {
    const after = learn.indexOf('\n## ', at);
    const tail = after === -1 ? '' : learn.slice(after);
    fs.writeFileSync(LEARN, learn.slice(0, at + marker.length) + '\n\n' + table + '\n' + tail);
  }
}

console.log(
  `embed-playground: ${embedded} reference page(s) carry a playground ` +
    `(${symbols.length} symbols with examples${missing.length ? `, ${missing.length} not in the reference` : ''}).`
);
if (missing.length) console.log('  not in reference:', missing.join(', '));
