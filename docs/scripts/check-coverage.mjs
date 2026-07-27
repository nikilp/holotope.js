/**
 * Documentation coverage gate.
 *
 * Reads the TypeDoc models emitted alongside the reference and fails when a
 * symbol that is not in the baseline lacks a description. The baseline records
 * what was already undocumented when the gate was introduced, so the rule is
 * "coverage may not regress" rather than "everything must be documented today"
 * — new work is forced to carry documentation without blocking on a backlog.
 *
 *   node scripts/check-coverage.mjs            check; exit 1 on regression
 *   node scripts/check-coverage.mjs --shrink    bank resolved symbols only
 *   node scripts/check-coverage.mjs --update    rewrite the baseline
 *
 * The two write modes differ in what they are allowed to forgive. `--shrink`
 * intersects the baseline with what is still undocumented: symbols that gained
 * documentation stop being grandfathered, and nothing new is absorbed, so it is
 * always safe to run. `--update` additionally grandfathers every current
 * violation, which is how a symbol that genuinely does not warrant a comment is
 * accepted — and also how an unrelated undocumented addition would be swallowed
 * by someone banking their own progress. Prefer `--shrink` unless the intent is
 * specifically to accept the new violations the gate is reporting.
 *
 * The check runs against the same model the reference is rendered from, so it
 * cannot disagree with what the published pages actually show.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODELS = path.join(DOCS, '.doc-model');
const BASELINE = path.join(DOCS, 'doc-baseline.json');
const PACKAGES = ['core', 'experiment', 'three', 'physics'];
const UPDATE = process.argv.includes('--update');
const SHRINK = process.argv.includes('--shrink');

// TypeDoc ReflectionKind values that must carry a description.
const KIND = {
  8: 'Enum',
  32: 'Variable',
  64: 'Function',
  128: 'Class',
  256: 'Interface',
  512: 'Constructor',
  1024: 'Property',
  2048: 'Method',
  262144: 'Accessor',
  2097152: 'TypeAlias'
};

const MODULE = 2; // transparent: a barrel is not itself a documentable symbol
const TYPE_LITERAL = 65536; // anonymous; has nowhere to carry a description
const REFERENCE = 4194304; // a re-export alias; the target carries the docs

// Note 2097152 is TypeAlias and 4194304 is Reference, not the other way round.

const described = (node) =>
  Boolean(node.comment?.summary?.length) ||
  Boolean(node.signatures?.some((s) => s.comment?.summary?.length));

// --- collect ----------------------------------------------------------------
const violations = [];

const walk = (node, pkg, trail) => {
  for (const child of node.children ?? []) {
    // Packages differ in shape: core and three expose one module per subpath
    // export, physics exposes its symbols directly. Modules are walked through
    // without contributing to the id, so both shapes yield the same ids.
    if (child.kind === MODULE) {
      walk(child, pkg, '');
      continue;
    }
    if (child.kind === REFERENCE) continue;

    const kind = KIND[child.kind];
    const next = trail ? `${trail}.${child.name}` : child.name;

    if (kind && !described(child)) violations.push(`${pkg}:${kind}:${next}`);
    if (child.kind !== TYPE_LITERAL) walk(child, pkg, next);
  }
};

for (const pkg of PACKAGES) {
  const file = path.join(MODELS, `${pkg}.json`);
  if (!fs.existsSync(file)) {
    console.error(
      `check-coverage: missing model ${path.relative(DOCS, file)}.\n` +
        '  Run `pnpm run api` first — the models are emitted with the reference.'
    );
    process.exit(2);
  }
  // Module names are the first level; keep them out of the id so a symbol
  // keeps its identity if it moves between barrels.
  const root = JSON.parse(fs.readFileSync(file, 'utf8'));
  walk(root, pkg, "");
}

// A symbol re-exported from more than one module is reached more than once;
// the id deliberately omits the module so those collapse to one entry.
const current = new Set(violations);
const unique = [...current].sort();

// --- baseline ---------------------------------------------------------------
if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify({ undocumented: unique }, null, 1) + '\n');
  console.log(`check-coverage: baseline updated — ${unique.length} grandfathered symbols.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error('check-coverage: no baseline. Create one with `--update`.');
  process.exit(2);
}

const baseline = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).undocumented);

const added = unique.filter((v) => !baseline.has(v));
const fixed = [...baseline].filter((v) => !current.has(v));

// Banking resolved symbols is separate from accepting new ones: the baseline
// keeps only entries that are still undocumented, so what was documented can
// never quietly lapse, and a violation the gate is reporting stays reported.
if (SHRINK) {
  const kept = [...baseline].filter((v) => current.has(v)).sort();
  fs.writeFileSync(BASELINE, JSON.stringify({ undocumented: kept }, null, 1) + '\n');
  console.log(
    `check-coverage: baseline shrunk by ${fixed.length} — ${kept.length} grandfathered symbols.`
  );
  if (added.length) {
    console.log(`  ${added.length} new violation(s) left reported rather than absorbed.`);
  }
  process.exit(0);
}

// --- report -----------------------------------------------------------------
const total = unique.length;
console.log(
  `check-coverage: ${total} undocumented (${baseline.size} baselined), ` +
    `${added.length} new, ${fixed.length} resolved.`
);

if (fixed.length) {
  console.log(
    `\n  ${fixed.length} baselined ${fixed.length === 1 ? 'symbol is' : 'symbols are'} ` +
      'now documented. Run `--shrink` to bank them so they stay documented.'
  );
}

if (!added.length) {
  console.log('\nNo documentation regression.');
  process.exit(0);
}

const byKind = new Map();
for (const v of added) {
  const [, kind] = v.split(':');
  byKind.set(kind, [...(byKind.get(kind) ?? []), v]);
}

console.error(`\n${added.length} symbol(s) added without documentation:\n`);
for (const [kind, items] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
  console.error(`  ${kind}`);
  for (const item of items.slice(0, 12)) console.error(`    ${item.split(':').slice(2).join(':')}`);
  if (items.length > 12) console.error(`    … and ${items.length - 12} more`);
}

console.error(
  '\nAdd a doc comment describing what each one is for.\n' +
    'On parameters, describe what the value means rather than restating its type.\n' +
    'If a symbol genuinely does not warrant one, accept it with:\n' +
    '  pnpm --filter @holotope/docs coverage:update\n' +
    'That grandfathers every violation above, including any that are not yours.\n' +
    'To bank documentation you added without accepting these, use:\n' +
    '  pnpm --filter @holotope/docs coverage:shrink\n'
);
process.exit(1);
