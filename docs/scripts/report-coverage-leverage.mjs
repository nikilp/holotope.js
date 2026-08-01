/**
 * Where documenting one declaration clears many undocumented symbols.
 *
 * The coverage baseline is a flat list, so it says how much is undocumented
 * but not where the work is cheapest. An inherited member is not a separate
 * authoring decision: it is the same declaration seen from a descendant, and
 * documenting the source resolves every inheritor at once. This ranks those
 * sources so the highest-leverage edits are visible before any are made.
 *
 * It also reports coverage as documented-against-total per package, which the
 * regression gate deliberately does not: that gate answers "did this change
 * make things worse", and a project also needs "how much is covered".
 *
 *   node scripts/report-coverage-leverage.mjs             ranked summary
 *   node scripts/report-coverage-leverage.mjs --inherited only the sources
 *   node scripts/report-coverage-leverage.mjs --json      machine-readable
 *
 * Reads the same emitted models as the coverage gate, so the two cannot
 * disagree about what is documented.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODELS = path.join(DOCS, '.doc-model');
const PACKAGES = ['core', 'experiment', 'experiment-physics', 'three', 'physics'];
const INHERITED_ONLY = process.argv.includes('--inherited');
const AS_JSON = process.argv.includes('--json');

// Mirrors check-coverage.mjs: the same kinds must carry a description.
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
const MODULE = 2;
const TYPE_LITERAL = 65536;
const REFERENCE = 4194304;

const described = (node) =>
  Boolean(node.comment?.summary?.length) ||
  Boolean(node.signatures?.some((s) => s.comment?.summary?.length)) ||
  Boolean(node.getSignature?.comment?.summary?.length) ||
  Boolean(node.setSignature?.comment?.summary?.length);

/** Undocumented members grouped by the declaration they were inherited from. */
const sources = new Map();
const perPackage = new Map();

const walk = (node, pkg, owner) => {
  for (const child of node.children ?? []) {
    if (child.kind === MODULE) {
      walk(child, pkg, '');
      continue;
    }
    if (child.kind === REFERENCE) continue;

    if (KIND[child.kind]) {
      const stats = perPackage.get(pkg) ?? { documented: 0, undocumented: 0 };
      if (described(child)) stats.documented++;
      else {
        stats.undocumented++;
        // `inheritedFrom` names the declaration the member really belongs to;
        // `implementationOf` does the same across an interface boundary.
        const from = child.inheritedFrom ?? child.implementationOf;
        if (from?.name) {
          const [declaration] = from.name.split('.');
          const entry = sources.get(declaration) ?? {
            declaration,
            package: pkg,
            members: new Set(),
            inheritors: new Set()
          };
          entry.members.add(child.name);
          entry.inheritors.add(owner || '(module)');
          sources.set(declaration, entry);
        }
      }
      perPackage.set(pkg, stats);
    }

    if (child.kind !== TYPE_LITERAL) {
      const nextOwner = child.kind === 256 || child.kind === 128
        ? child.name
        : owner;
      walk(child, pkg, nextOwner);
    }
  }
};

for (const pkg of PACKAGES) {
  const file = path.join(MODELS, `${pkg}.json`);
  if (!fs.existsSync(file)) continue;
  walk(JSON.parse(fs.readFileSync(file, 'utf8')), pkg, '');
}

const ranked = [...sources.values()]
  .map((entry) => ({
    declaration: entry.declaration,
    package: entry.package,
    members: [...entry.members].sort(),
    inheritors: entry.inheritors.size,
    // One undocumented member seen from each inheritor is one entry cleared.
    clears: entry.members.size * entry.inheritors.size
  }))
  .sort((a, b) => b.clears - a.clears || a.declaration.localeCompare(b.declaration));

if (AS_JSON) {
  console.log(JSON.stringify({ perPackage: Object.fromEntries(perPackage), ranked }, null, 2));
  process.exit(0);
}

if (!INHERITED_ONLY) {
  console.log('Coverage by package (documented / total):\n');
  let documented = 0;
  let total = 0;
  for (const pkg of PACKAGES) {
    const stats = perPackage.get(pkg);
    if (!stats) continue;
    const packageTotal = stats.documented + stats.undocumented;
    documented += stats.documented;
    total += packageTotal;
    const share = ((100 * stats.documented) / packageTotal).toFixed(0);
    console.log(
      `  ${pkg.padEnd(11)} ${String(stats.documented).padStart(5)} / ${String(packageTotal).padEnd(6)} ${share.padStart(3)}%`
    );
  }
  console.log(
    `  ${'all'.padEnd(11)} ${String(documented).padStart(5)} / ${String(total).padEnd(6)} ` +
      `${((100 * documented) / total).toFixed(0).padStart(3)}%\n`
  );
}

const clearable = ranked.reduce((sum, entry) => sum + entry.clears, 0);
console.log(
  `Inherited undocumented members: ${clearable} across ${ranked.length} source declaration(s).`
);
console.log('Documenting the source resolves every inheritor at once.\n');

for (const entry of ranked.slice(0, INHERITED_ONLY ? ranked.length : 20)) {
  console.log(
    `  ${String(entry.clears).padStart(4)}  ${entry.declaration}  ` +
      `(${entry.package}, ${entry.members.length} member(s) x ${entry.inheritors} inheritor(s))`
  );
  if (INHERITED_ONLY) console.log(`        ${entry.members.join(', ')}`);
}
