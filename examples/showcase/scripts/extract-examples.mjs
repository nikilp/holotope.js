/**
 * Collect the `@example` blocks out of the packages' JSDoc so the playground
 * can start from them.
 *
 * The examples are documentation first: they are what a reader sees on the
 * reference page. Reading them from the same comments rather than restating
 * them here keeps one source of truth, so a snippet cannot be improved on the
 * page and left stale in the playground.
 *
 *   node scripts/extract-examples.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOWCASE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(path.dirname(SHOWCASE));
const OUT = path.join(SHOWCASE, 'src/generated-examples.json');

const sources = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.ts')) sources.push(full);
  }
};
for (const pkg of ['core', 'three', 'physics']) {
  const dir = path.join(REPO, 'packages', pkg, 'src');
  if (fs.existsSync(dir)) walk(dir);
}

/** The declaration a doc comment sits above, which is the symbol it documents. */
const declaredName = (after) =>
  after.match(
    /^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|function|interface|const|type)\s+([A-Za-z0-9_]+)/
  )?.[1] ?? null;

const examples = {};

for (const file of sources) {
  const text = fs.readFileSync(file, 'utf8');
  // Every doc comment, with whatever follows it.
  for (const match of text.matchAll(/\/\*\*([\s\S]*?)\*\/\s*([^\n]*)/g)) {
    const [, comment, following] = match;
    if (!comment.includes('@example')) continue;

    let symbol = declaredName(following);
    if (!symbol && /^\s*constructor\s*\(/.test(following)) {
      // Walk back to the enclosing class declaration.
      const before = text.slice(0, match.index);
      symbol = [...before.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g)].pop()?.[1] ?? null;
    }
    if (!symbol) continue;

    const body = comment.replace(/^[ \t]*\*[ \t]?/gm, '');
    const blocks = [...body.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd());
    if (!blocks.length) continue;

    // Several @example blocks on one symbol are alternatives; the first is the
    // one a reader meets, so it seeds the playground.
    examples[symbol] = { code: blocks[0], alternatives: blocks.slice(1) };
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(examples, null, 2) + '\n');
console.log(
  `extract-examples: ${Object.keys(examples).length} symbols with examples -> ${path.relative(SHOWCASE, OUT)}`
);
