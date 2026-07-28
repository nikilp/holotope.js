/**
 * Reachability gate.
 *
 * Counts exported symbols that nothing outside their own file reaches, baselines
 * today's debt, and fails when it grows. The sibling of `check-coverage.mjs`, and
 * the same bargain: the backlog does not block, but new work has to carry its own
 * weight.
 *
 *   node scripts/check-reachability.mjs            check; exit 1 on regression
 *   node scripts/check-reachability.mjs --shrink   bank symbols now reached
 *   node scripts/check-reachability.mjs --update   rewrite the baseline
 *   node scripts/check-reachability.mjs --list     per-package detail
 *
 * ## What the number is, and what it is not
 *
 * It is **not** a dead-code count. A library exists to be called from outside its
 * own repository, so an export with no in-repo caller may be exactly right.
 *
 * It is a measure of how much capability has never been driven by a second party.
 * Two outside-caller exercises found roughly a dozen defects that every test
 * passed over, and each one lived in code no other code called. When
 * `representation/` was first counted by hand, 57 of its 105 exports had never
 * been referenced outside the module. Nobody knew that until somebody counted,
 * and by then the cost had been paid — twice, by two callers, in an afternoon
 * each.
 *
 * So the gate does not demand that number be zero. It demands that adding to it
 * be deliberate: ship eleven exports and reach none of them, and CI says so on
 * the commit rather than a stranger saying so a year later.
 *
 * ## What counts as reaching
 *
 * A reference from any non-test, non-barrel source file other than the one that
 * declares the symbol — including `examples/`, because the showcase is a real
 * caller and the most honest one available.
 *
 * Tests deliberately do **not** count. A symbol exercised only by tests written
 * by its own author is the exact population both exercises drew their findings
 * from: correct, covered, and never composed with anything.
 *
 * Barrels do not count either. `index.ts` re-exports everything, so honouring it
 * would mark the whole library reached and measure nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(DOCS);
const BASELINE = path.join(DOCS, 'reachability-baseline.json');
const UPDATE = process.argv.includes('--update');
const SHRINK = process.argv.includes('--shrink');
const LIST = process.argv.includes('--list');

/** Exported declarations. Re-exports are not declarations; the target is. */
const DECLARATION =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/gm;

/** A file that only forwards other files' exports measures nothing. */
const isBarrel = (text) => {
  const lines = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'));
  if (lines.length === 0) return false;
  let sawForward = false;
  let depth = 0;
  for (const line of lines) {
    if (/^export\s+(?:type\s+)?\*/.test(line) || /\bfrom\s+['"]/.test(line)) {
      if (/^export\b/.test(line) || depth > 0) sawForward = true;
    }
    // `export { A, B } from './x.js'` may wrap across several lines.
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth < 0) depth = 0;
    if (!/^(export|import)\b/.test(line) && depth === 0 && !/\bfrom\s+['"]/.test(line)) {
      return false;
    }
  }
  return sawForward;
};

const sources = [];
const walk = (dir, kind, pkg) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(full, kind, pkg);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      sources.push({ file: full, kind, pkg });
    }
  }
};

const packagesDir = path.join(REPO, 'packages');
for (const pkg of fs.readdirSync(packagesDir)) {
  if (!fs.statSync(path.join(packagesDir, pkg)).isDirectory()) continue;
  walk(path.join(packagesDir, pkg, 'src'), 'source', pkg);
  walk(path.join(packagesDir, pkg, 'test'), 'test', pkg);
}
const examplesDir = path.join(REPO, 'examples');
if (fs.existsSync(examplesDir)) {
  for (const example of fs.readdirSync(examplesDir)) {
    if (!fs.statSync(path.join(examplesDir, example)).isDirectory()) continue;
    walk(path.join(examplesDir, example, 'src'), 'example', example);
    walk(path.join(examplesDir, example, 'test'), 'test', example);
  }
}

// --- collect ----------------------------------------------------------------
/** name -> { pkg, file } for every exported declaration in a package source. */
const declarations = new Map();
/** file -> Set of identifiers appearing in it, for files that can reach. */
const identifiersByFile = new Map();

for (const entry of sources) {
  const text = fs.readFileSync(entry.file, 'utf8');
  const barrel = isBarrel(text);
  entry.barrel = barrel;

  if (entry.kind === 'source' && !barrel) {
    for (const match of text.matchAll(DECLARATION)) {
      const name = match[1];
      if (!declarations.has(name)) {
        declarations.set(name, { pkg: entry.pkg, file: entry.file });
      }
    }
  }
  // Tests and barrels are read for nothing; they cannot confer reachability.
  if (entry.kind === 'test' || barrel) continue;
  identifiersByFile.set(entry.file, new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []));
}

const unreached = [];
for (const [name, origin] of declarations) {
  let reached = false;
  for (const [file, identifiers] of identifiersByFile) {
    if (file === origin.file) continue;
    if (identifiers.has(name)) { reached = true; break; }
  }
  if (!reached) unreached.push(`${origin.pkg}:${name}`);
}

const current = new Set(unreached);
const unique = [...current].sort();

// --- baseline ---------------------------------------------------------------
if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify({ unreached: unique }, null, 1) + '\n');
  console.log(`check-reachability: baseline updated — ${unique.length} grandfathered symbols.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error('check-reachability: no baseline. Create one with `--update`.');
  process.exit(2);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).unreached);
const added = unique.filter((symbol) => !baseline.has(symbol));
const fixed = [...baseline].filter((symbol) => !current.has(symbol));

if (SHRINK) {
  const kept = [...baseline].filter((symbol) => current.has(symbol)).sort();
  fs.writeFileSync(BASELINE, JSON.stringify({ unreached: kept }, null, 1) + '\n');
  console.log(
    `check-reachability: baseline shrunk by ${fixed.length} — ${kept.length} grandfathered.`
  );
  if (added.length) {
    console.log(`  ${added.length} new unreached export(s) left reported rather than absorbed.`);
  }
  process.exit(0);
}

// --- report -----------------------------------------------------------------
console.log(
  `check-reachability: ${unique.length} unreached of ${declarations.size} exported ` +
    `(${baseline.size} baselined), ${added.length} new, ${fixed.length} now reached.`
);

if (LIST) {
  const byPackage = new Map();
  for (const symbol of unique) {
    const pkg = symbol.split(':')[0];
    byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + 1);
  }
  const totals = new Map();
  for (const { pkg } of declarations.values()) {
    totals.set(pkg, (totals.get(pkg) ?? 0) + 1);
  }
  console.log('');
  for (const [pkg, total] of [...totals].sort((a, b) => b[1] - a[1])) {
    const count = byPackage.get(pkg) ?? 0;
    const percent = total === 0 ? 0 : Math.round((count / total) * 100);
    console.log(
      `  ${pkg.padEnd(20)} ${String(count).padStart(4)} / ${String(total).padEnd(4)} ` +
        `unreached  ${String(percent).padStart(3)}%`
    );
  }
}

if (fixed.length) {
  console.log(
    `\n  ${fixed.length} baselined ${fixed.length === 1 ? 'symbol is' : 'symbols are'} ` +
      'now reached. Run `--shrink` to bank them so they stay reached.'
  );
}

if (!added.length) {
  console.log('\nNo reachability regression.');
  process.exit(0);
}

console.error(`\n${added.length} export(s) added that nothing outside their own file reaches:\n`);
for (const symbol of added.slice(0, 20)) {
  const origin = declarations.get(symbol.split(':').slice(1).join(':'));
  console.error(`  ${symbol}${origin ? `  (${path.relative(REPO, origin.file)})` : ''}`);
}
if (added.length > 20) console.error(`  … and ${added.length - 20} more`);

console.error(
  '\nAn export nothing composes with has never been shown to compose.\n' +
    'Reach it from another module, an example, or a caller that is not its own test —\n' +
    'that is the step both outside-caller exercises found things in.\n' +
    'If it is genuinely leaf public API with no in-repo caller, accept it with:\n' +
    '  pnpm --filter @holotope/docs reachability:update\n' +
    'That grandfathers every symbol above, including any that are not yours.\n' +
    'To bank symbols you reached without accepting these, use:\n' +
    '  pnpm --filter @holotope/docs reachability:shrink\n'
);
process.exit(1);
