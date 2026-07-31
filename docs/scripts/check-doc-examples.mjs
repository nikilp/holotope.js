/**
 * Documentation example gate.
 *
 * Compiles every fenced `ts` block on the learning pages against the real
 * types, baselines the blocks that cannot compile today, and fails when a
 * block that used to compile stops — or when a new uncompilable one appears.
 *
 *   node scripts/check-doc-examples.mjs            check; exit 1 on regression
 *   node scripts/check-doc-examples.mjs --update   rewrite the baseline
 *   node scripts/check-doc-examples.mjs --shrink   bank blocks now compiling
 *   node scripts/check-doc-examples.mjs --list     per-block detail
 *
 * ## Why this exists
 *
 * `@example` blocks in source JSDoc have always been compiled — the showcase
 * extracts them and typechecks them. Prose pages were the hole: their snippets
 * were markdown and nothing more, so a recipe could be wrong on the page while
 * every gate stayed green.
 *
 * One was. `cookbook.md` shipped a facet-recovery recipe comparing coordinates
 * against a literal `±1`, which is the boundary only when `size` is 2. It
 * arrived in the commit that closed eight documentation gaps, and the next cold
 * caller hit it.
 *
 * Compiling is not the same as being correct, and this gate would not have
 * caught that snippet — it compiled fine and computed the wrong thing. That
 * case is answered by making the capability a library function
 * (`cuboidCellFacetN`) with tests, precisely because no gate could. What this
 * catches is the larger, duller population: a renamed export, a changed
 * signature, a snippet that quietly drifted from the API it documents.
 *
 * ## The bargain
 *
 * The same one `check-coverage.mjs` and `check-reachability.mjs` strike. Many
 * snippets are deliberate fragments — three illustrative lines, a shape sketch —
 * and rewriting them all to compile would be a large change that improves
 * nothing for a reader. Today's uncompilable blocks are baselined and do not
 * block; new ones carry their own weight.
 *
 * A block is identified by page and ordinal, so inserting a snippet ahead of a
 * grandfathered one shifts its identity and it is re-examined. That is intended:
 * editing around old debt should surface it.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(DOCS);
const LEARN = path.join(DOCS, 'learn');
const WORK = path.join(DOCS, '.doc-examples');
const BASELINE = path.join(DOCS, 'doc-example-baseline.json');
const UPDATE = process.argv.includes('--update');
const SHRINK = process.argv.includes('--shrink');
const LIST = process.argv.includes('--list');

/** Opt out of a single block, with a reason, invisibly to the reader. */
const SKIP = /<!--\s*doc-check:\s*skip\s*(?:—|-{1,2})?\s*([^>]*?)\s*-->\s*$/;

/**
 * Switches a page into cumulative mode from that point on.
 *
 * Two genres of documentation live on these pages and they want opposite
 * treatment. An independent recipe must run for a reader who lands on it from
 * the sidebar, so it is compiled alone and has to construct everything it uses.
 * A staged procedure — compile a material, bind particles, predict, evaluate,
 * minimize, apply — is consumed top to bottom, and forcing each stage to
 * restate the previous five would make it worse to read, not better.
 *
 * The marker makes the genre explicit in the document rather than inferred from
 * whatever happens to compile. `cookbook.md` is both: independent recipes, then
 * one physics pipeline.
 */
const SEQUENTIAL = /<!--\s*doc-check:\s*sequential\s*-->/;

/**
 * Marks a block whose declarations every block on the page may use.
 *
 * A third genre, distinct from both a recipe and a pipeline stage: an API
 * demonstration, which shows a call and its result against a subject the reader
 * already has. `contact.md` is fourteen of them, each operating on some pair of
 * shapes. Constructing those shapes in every entry would bury the query being
 * demonstrated; leaving them undeclared leaves the reader unable to see what
 * type to pass, which is the complaint cold callers filed most often.
 *
 * So the page declares its subjects once, visibly, with their real types, and
 * the demonstrations stay about the call. Unlike `sequential` this carries no
 * ordering claim — a context block serves blocks above it as readily as below.
 */
const CONTEXT = /<!--\s*doc-check:\s*context\s*-->/;

const markdownFiles = (dir) => {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) found.push(full);
  }
  return found.sort();
};

/** Every fenced `ts` block, with the page-local ordinal that names it. */
function blocksOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const page = path.relative(LEARN, file).replace(/\.md$/, '');
  const fence = /^```([A-Za-z0-9-]*)[^\n]*\n([\s\S]*?)^```/gm;
  const blocks = [];
  let ordinal = 0;
  let lastEnd = 0;
  let match;
  while ((match = fence.exec(text)) !== null) {
    const since = text.slice(lastEnd, match.index);
    lastEnd = fence.lastIndex;
    if (match[1] !== 'ts') continue;
    const before = text.slice(0, match.index);
    const skip = SKIP.exec(before);
    blocks.push({
      id: `${page}#${ordinal}`,
      // Identity is the content, not the position. Inserting a recipe renumbers
      // everything after it, and position-based identity would report each of
      // those as a fresh regression -- false alarms are how a gate gets turned
      // off. A hash changes exactly when the snippet does, which is exactly
      // when it should have to prove itself again.
      key: createHash('sha256').update(match[2]).digest('hex').slice(0, 12),
      ordinal,
      code: match[2],
      sequential: SEQUENTIAL.test(before),
      // Markers bind to the block they immediately precede.
      context: CONTEXT.test(since),
      skip: skip === null ? null : skip[1] || 'no reason given'
    });
    ordinal += 1;
  }
  return blocks;
}

const NAMESPACES = {
  core: 'core',
  three: 'three',
  physics: 'physics',
  experiment: 'experiment',
  experimentPhysics: 'experiment-physics'
};

/**
 * Value exports of each package, read from the built entry points.
 *
 * Pages write bare names, matching the convention the JSDoc examples already
 * use, so each block gets them destructured from the package namespaces.
 */
async function valueExportsByNamespace() {
  const out = {};
  for (const [ns, dir] of Object.entries(NAMESPACES)) {
    const entry = path.join(REPO, 'packages', dir, 'dist/index.js');
    if (!fs.existsSync(entry)) {
      throw new Error(
        `check-doc-examples: @holotope/${dir} is not built. Run \`pnpm build\` first.`
      );
    }
    const module = await import(entry);
    out[ns] = Object.keys(module)
      .filter((name) => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name))
      .sort();
  }
  return out;
}

const HEADER = [
  '// Generated by scripts/check-doc-examples.mjs — do not edit.',
  "import * as core from '@holotope/core';",
  "import * as three from '@holotope/three';",
  "import * as physics from '@holotope/physics';",
  "import * as experiment from '@holotope/experiment';",
  "import * as experimentPhysics from '@holotope/experiment-physics';",
  // Inline import types rather than a type import: a snippet is free to import
  // `PerspectiveCamera` itself, and a binding here would collide with it.
  "declare const scene: import('three').Scene;",
  "declare const camera: import('three').PerspectiveCamera;",
  "declare const renderer: import('three').WebGLRenderer;",
  "declare const raycaster: import('three').Raycaster;",
  "declare const orbitControls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls;",
  'declare function onFrame(callback: (t: number) => void): void;',
  'declare function log(...values: unknown[]): void;',
  'void [scene, camera, renderer, raycaster, orbitControls, onFrame, log];'
].join('\n');

/**
 * Splits a snippet into the imports it declares and everything else.
 *
 * Imports have to be hoisted: the body is wrapped in a function so that local
 * declarations stay scoped and top-level `await` is legal, and an import cannot
 * appear there. Parsing rather than pattern-matching keeps multi-line and
 * type-only forms honest.
 */
function partition(code) {
  const parsed = ts.createSourceFile(
    'snippet.ts',
    code,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS
  );
  const imports = [];
  const importedNames = new Set();
  const ambient = [];
  const body = [];
  for (const statement of parsed.statements) {
    const text = code.slice(statement.getStart(parsed), statement.getEnd());
    // `declare` is an ambient declaration and is legal only at the top level,
    // so it hoists alongside imports. A context block is mostly these.
    const declared = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)
      : false;
    if (declared === true) {
      ambient.push(text);
      if (ts.isVariableStatement(statement)) {
        for (const d of statement.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) importedNames.add(d.name.text);
        }
      }
      continue;
    }
    if (ts.isImportDeclaration(statement)) {
      imports.push(text);
      const clause = statement.importClause;
      if (clause?.name !== undefined) importedNames.add(clause.name.text);
      const named = clause?.namedBindings;
      if (named !== undefined && ts.isNamedImports(named)) {
        for (const element of named.elements) importedNames.add(element.name.text);
      } else if (named !== undefined && ts.isNamespaceImport(named)) {
        importedNames.add(named.name.text);
      }
      continue;
    }
    // `export` is meaningless inside the wrapper; the declaration still counts.
    body.push(text.replace(/^export\s+(?!type\b)/, ''));
  }
  return { imports, ambient, importedNames, body: body.join('\n') };
}

/**
 * Merges the import statements of a cumulative chain into one per module.
 *
 * Stages routinely re-import a name an earlier stage already brought in, and a
 * repeated statement is a duplicate identifier rather than a no-op. Merging by
 * module specifier keeps every name exactly once and preserves type-only form.
 */
function mergeImports(statements) {
  const modules = new Map();
  for (const statement of statements) {
    const parsed = ts.createSourceFile(
      'import.ts', statement, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS
    );
    for (const node of parsed.statements) {
      if (!ts.isImportDeclaration(node)) continue;
      const from = node.moduleSpecifier.getText(parsed).slice(1, -1);
      if (!modules.has(from)) {
        modules.set(from, { named: new Map(), namespace: null, byDefault: null });
      }
      const entry = modules.get(from);
      const clause = node.importClause;
      if (clause === undefined) continue;
      if (clause.name !== undefined) entry.byDefault = clause.name.text;
      const named = clause.namedBindings;
      if (named !== undefined && ts.isNamespaceImport(named)) {
        entry.namespace = named.name.text;
      } else if (named !== undefined && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          const typeOnly = clause.isTypeOnly || element.isTypeOnly;
          const text = element.getText(parsed).replace(/^type\s+/, '');
          // A name imported as a value anywhere wins over a type-only form.
          const existing = entry.named.get(element.name.text);
          if (existing === undefined || (existing.typeOnly && !typeOnly)) {
            entry.named.set(element.name.text, { text, typeOnly });
          }
        }
      }
    }
  }
  const out = [];
  const names = new Set();
  for (const [from, entry] of modules) {
    const clauses = [];
    if (entry.byDefault !== null) { clauses.push(entry.byDefault); names.add(entry.byDefault); }
    if (entry.namespace !== null) { clauses.push(`* as ${entry.namespace}`); names.add(entry.namespace); }
    const named = [...entry.named.entries()];
    for (const [name] of named) names.add(name);
    if (named.length > 0) {
      clauses.push(
        `{ ${named.map(([, v]) => (v.typeOnly ? `type ${v.text}` : v.text)).join(', ')} }`
      );
    }
    out.push(clauses.length === 0
      ? `import '${from}';`
      : `import ${clauses.join(', ')} from '${from}';`);
  }
  return { statements: out, names };
}

function sourceFor(block, valueNames, preceding = []) {
  const parts = [...preceding, block].map((one) => partition(one.code));
  const merged = mergeImports(parts.flatMap((one) => one.imports));
  const imports = merged.statements;
  const importedNames = new Set([
    ...merged.names,
    ...parts.flatMap((one) => [...one.importedNames])
  ]);
  const ambient = [...new Set(parts.flatMap((one) => one.ambient))];
  // Each stage opens a scope the next one nests inside, so a later stage may
  // reuse a name the way a reader re-binds it while following the page. Plain
  // concatenation would make that a redeclaration instead of a shadow.
  const body = parts
    .map((one, depth) => {
      const indented = one.body.replace(/^(?=.)/gm, '  '.repeat(depth));
      const open = depth < parts.length - 1 ? `\n${'  '.repeat(depth)}{` : '';
      return indented + open;
    })
    .join('\n')
    + parts
        .slice(0, -1)
        .map((_, i) => `\n${'  '.repeat(parts.length - 2 - i)}}`)
        .join('');
  const bindings = Object.entries(valueNames)
    .map(([ns, names]) => [ns, names.filter((name) => !importedNames.has(name))])
    .filter(([, names]) => names.length > 0)
    .map(
      ([ns, names]) =>
        `  const { ${names.join(', ')} } = ${ns};\n  void [${names.join(', ')}];`
    )
    .join('\n');
  return [
    HEADER,
    ...imports,
    ...ambient,
    `export async function block(): Promise<void> {`,
    bindings,
    body.replace(/^(?=.)/gm, '  ').replace(/\s+$/, ''),
    '}',
    ''
  ].join('\n');
}

const files = markdownFiles(LEARN);
const all = files.flatMap(blocksOf);
const skipped = all.filter((block) => block.skip !== null);
const candidates = all.filter((block) => block.skip === null);
const valueNames = await valueExportsByNamespace();

const slug = (id) => id.replace(/[^\w]/g, '_');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
const idFor = new Map();
const roots = [];
const byPage = new Map();
for (const block of candidates) {
  const page = block.id.slice(0, block.id.lastIndexOf('#'));
  if (!byPage.has(page)) byPage.set(page, []);
  byPage.get(page).push(block);
}
for (const block of candidates) {
  const page = block.id.slice(0, block.id.lastIndexOf('#'));
  // A sequential block sees every sequential block before it on its page.
  const siblings = byPage.get(page);
  // Page context first, then any earlier stages when the page is sequential.
  const preceding = [
    ...siblings.filter((other) => other.context && other !== block),
    ...(block.sequential
      ? siblings.filter(
          (other) => other.sequential && !other.context && other.ordinal < block.ordinal
        )
      : [])
  ];
  const file = path.join(WORK, `${slug(block.id)}.ts`);
  fs.writeFileSync(file, sourceFor(block, valueNames, preceding));
  idFor.set(path.resolve(file), block.id);
  roots.push(file);
}

const base = JSON.parse(fs.readFileSync(path.join(REPO, 'tsconfig.base.json'), 'utf8'));
const options = ts.convertCompilerOptionsFromJson(
  {
    ...base.compilerOptions,
    noEmit: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    types: [],
    baseUrl: '.',
    paths: {
      ...Object.fromEntries(
        Object.values(NAMESPACES).flatMap((dir) => {
          // Every declared subpath export, mapped to source the same way the
          // root entry point is. Pages import `@holotope/core/lattice` and the
          // like, and a missing mapping would look like a broken snippet.
          const manifest = JSON.parse(
            fs.readFileSync(path.join(REPO, 'packages', dir, 'package.json'), 'utf8')
          );
          return Object.keys(manifest.exports ?? { '.': {} }).map((entry) => {
            const sub = entry === '.' ? '' : entry.slice(1);
            return [
              `@holotope/${dir}${sub}`,
              [path.join(REPO, 'packages', dir, `src${sub}/index.ts`)]
            ];
          });
        })
      ),
      // `three` is a peer dependency installed beside its adapter, not at the
      // repository root, so nothing resolves it from `docs/`.
      three: [path.join(REPO, 'packages/three/node_modules/@types/three/index.d.ts')],
      'three/*': [path.join(REPO, 'packages/three/node_modules/@types/three/*')]
    }
  },
  REPO
).options;

const program = ts.createProgram(roots, options);
const failing = new Map();
for (const diagnostic of [
  ...program.getSemanticDiagnostics(),
  ...program.getSyntacticDiagnostics()
]) {
  const file = diagnostic.file;
  if (file === undefined) continue;
  const id = idFor.get(path.resolve(file.fileName));
  if (id === undefined || failing.has(id)) continue;
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
  failing.set(id, `TS${diagnostic.code}: ${message}`);
}

const keyOf = new Map(candidates.map((block) => [block.id, block.key]));
const baseline = fs.existsSync(BASELINE)
  ? new Set(
      JSON.parse(fs.readFileSync(BASELINE, 'utf8')).uncompilable.map((entry) =>
        typeof entry === 'string' ? entry : entry.key
      )
    )
  : new Set();
const grandfathered = (id) => baseline.has(keyOf.get(id));
const failingIds = [...failing.keys()].sort();
const regressions = failingIds.filter((id) => !grandfathered(id));
const failingKeys = new Set(failingIds.map((id) => keyOf.get(id)));
const banked = [...baseline].filter((key) => !failingKeys.has(key)).sort();

/** Recorded as key plus the id it had when written, so the file stays legible. */
const writeBaseline = (ids) =>
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      { uncompilable: ids.map((id) => ({ key: keyOf.get(id), seenAs: id })) },
      null,
      1
    ) + '\n'
  );

if (UPDATE) {
  writeBaseline(failingIds);
  console.log(
    `check-doc-examples: baseline updated — ${failingIds.length} grandfathered block(s).`
  );
  process.exit(0);
}

if (SHRINK) {
  const kept = failingIds.filter((id) => grandfathered(id));
  writeBaseline(kept);
  console.log(
    `check-doc-examples: banked ${banked.length} block(s) that now compile; ${kept.length} remain.`
  );
  if (regressions.length > 0) {
    console.log(
      `  ${regressions.length} new uncompilable block(s) left reported rather than absorbed.`
    );
  }
  process.exit(regressions.length > 0 ? 1 : 0);
}

console.log(
  `check-doc-examples: ${candidates.length} block(s) across ${files.length} page(s); ` +
    `${skipped.length} skipped, ${failingIds.length} uncompilable ` +
    `(${baseline.size} grandfathered).`
);

if (LIST) {
  console.log('');
  for (const id of failingIds) {
    console.log(`  ${grandfathered(id) ? ' ' : '!'} ${id}  ${failing.get(id)}`);
  }
  for (const block of skipped) console.log(`  - ${block.id}  skipped: ${block.skip}`);
}

if (banked.length > 0) {
  console.log(
    `\n${banked.length} grandfathered block(s) now compile. Run --shrink to bank them.`
  );
}

if (regressions.length > 0) {
  console.log(`\n${regressions.length} block(s) newly fail to compile:\n`);
  for (const id of regressions) console.log(`  ${id}\n    ${failing.get(id)}`);
  console.log(
    '\nFix the snippet, or mark it `<!-- doc-check: skip — why -->` if it is a' +
      ' deliberate fragment.'
  );
  process.exit(1);
}

console.log('\nNo documentation example regression.');
