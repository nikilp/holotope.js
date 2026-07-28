/**
 * Evidence-readership gate.
 *
 * A result type's field is only worth computing if something consumes it. This
 * finds fields on returned types that nothing anywhere reads, baselines today's
 * debt, and fails when it grows.
 *
 *   node scripts/check-evidence-readership.mjs           check; exit 1 on regression
 *   node scripts/check-evidence-readership.mjs --shrink  bank fields now read
 *   node scripts/check-evidence-readership.mjs --update  rewrite the baseline
 *   node scripts/check-evidence-readership.mjs --list    show the current set
 *
 * ## Why this is its own gate
 *
 * `XpbdIncrementalPotentialConvergedN.convergencePoint` separates "converged
 * having made progress" from "converged having done nothing". It is computed,
 * public, documented, and read by nothing in `packages/**`. A caller whose scene
 * had silently stopped moving was told `applied` on every step, while the field
 * that would have said otherwise sat unread in the result they were holding.
 *
 * That is the failure this gate is for: not a wrong answer, but a right answer
 * nobody is listening to. Unread evidence is indistinguishable from evidence
 * that was never computed, except in cost.
 *
 * ## Population and rule
 *
 * Population: exported interfaces and object type aliases that appear in a
 * function's return position somewhere in the repo — "a returned result type",
 * literally rather than by naming convention.
 *
 * A field is **read** if `.field` appears in any file other than the one
 * declaring the type. The construction site does not count, because `field:` in
 * an object literal is writing, not reading — which is exactly the distinction
 * that makes unread evidence invisible to ordinary coverage.
 *
 * Two tiers, because one rule could not hold both cases:
 *
 * - `unread` — nothing anywhere reads it.
 * - `testOnly` — every reader is a test. The library ships evidence that only
 *   its own test suite has an opinion about, which is the state
 *   `convergencePoint` was in before an outside caller arrived and read it.
 *
 * The second tier exists because the first would have missed the case that
 * motivated the gate. Counting a test as a consumer makes "somebody asserted
 * this once" indistinguishable from "something acts on this", and the whole
 * point of the field was that nothing acted on it.
 *
 * Neither tier can see the harder question — whether a field is read at the
 * altitude where the decision is actually made. `convergencePoint` is read
 * today, by a demo, for display. That is not the same as the library acting on
 * it, and no grep can tell the difference. This gate narrows the population; it
 * does not settle the design.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(DOCS);
const BASELINE = path.join(DOCS, 'evidence-baseline.json');
const UPDATE = process.argv.includes('--update');
const SHRINK = process.argv.includes('--shrink');
const LIST = process.argv.includes('--list');

const sources = [];
const walk = (dir, pkg) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(full, pkg);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      sources.push({ file: full, pkg, text: fs.readFileSync(full, 'utf8') });
    }
  }
};
for (const root of ['packages', 'examples']) {
  const dir = path.join(REPO, root);
  if (!fs.existsSync(dir)) continue;
  for (const entry of fs.readdirSync(dir)) {
    if (!fs.statSync(path.join(dir, entry)).isDirectory()) continue;
    walk(path.join(dir, entry, 'src'), entry);
    walk(path.join(dir, entry, 'test'), entry);
  }
}

/** Body of a braced declaration starting at `from`, or undefined. */
const bodyAt = (text, from) => {
  const open = text.indexOf('{', from);
  if (open === -1) return undefined;
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === '{') depth++;
    else if (text[index] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return undefined;
};

/** Depth-1 property names of an interface body. */
const propertiesOf = (body) => {
  const names = [];
  let depth = 0;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (depth === 0) {
      const match = line.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/);
      if (match) names.push(match[1]);
    }
    depth += (line.match(/[{(]/g) ?? []).length - (line.match(/[})]/g) ?? []).length;
    if (depth < 0) depth = 0;
  }
  return names;
};

// --- collect ----------------------------------------------------------------
/** Type names that appear in a function return position anywhere. */
const returned = new Set();
for (const { text } of sources) {
  for (const match of text.matchAll(/\)\s*:\s*([^{;=\n]+)/g)) {
    for (const identifier of match[1].match(/[A-Za-z_$][\w$]*/g) ?? []) {
      returned.add(identifier);
    }
  }
}

/** `Type.field` -> declaring file, for returned exported types. */
const fields = new Map();
for (const { file, text } of sources) {
  const declaration =
    /^export\s+(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)|^export\s+(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*\{/gm;
  for (const match of text.matchAll(declaration)) {
    const name = match[1] ?? match[2];
    if (!returned.has(name)) continue;
    const body = bodyAt(text, match.index);
    if (!body) continue;
    for (const property of propertiesOf(body)) {
      fields.set(`${name}.${property}`, file);
    }
  }
}

/** file -> { test, names } for `.field` reads in it. */
const readsByFile = new Map();
for (const { file, text } of sources) {
  readsByFile.set(file, {
    test: file.endsWith('.test.ts'),
    names: new Set((text.match(/\.([A-Za-z_$][\w$]*)/g) ?? []).map((m) => m.slice(1)))
  });
}

const unread = [];
const testOnly = [];
for (const [key, declaringFile] of fields) {
  const property = key.slice(key.indexOf('.') + 1);
  let readers = 0;
  let nonTestReaders = 0;
  for (const [file, { test, names }] of readsByFile) {
    if (file === declaringFile) continue;
    if (!names.has(property)) continue;
    readers++;
    if (!test) nonTestReaders++;
  }
  if (readers === 0) unread.push(key);
  else if (nonTestReaders === 0) testOnly.push(key);
}

const current = new Set(unread);
const currentTestOnly = new Set(testOnly);
const unique = [...current].sort();
const uniqueTestOnly = [...currentTestOnly].sort();

// --- baseline ---------------------------------------------------------------
const write = (unreadList, testOnlyList) =>
  fs.writeFileSync(
    BASELINE,
    JSON.stringify({ unread: unreadList, testOnly: testOnlyList }, null, 1) + '\n'
  );

if (UPDATE) {
  write(unique, uniqueTestOnly);
  console.log(
    `check-evidence-readership: baseline updated — ${unique.length} unread, ` +
      `${uniqueTestOnly.length} test-only grandfathered.`
  );
  process.exit(0);
}
if (!fs.existsSync(BASELINE)) {
  console.error('check-evidence-readership: no baseline. Create one with `--update`.');
  process.exit(2);
}

const stored = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const baseline = new Set(stored.unread);
const baselineTestOnly = new Set(stored.testOnly ?? []);
const added = unique.filter((entry) => !baseline.has(entry));
const addedTestOnly = uniqueTestOnly.filter((entry) => !baselineTestOnly.has(entry));
const fixed = [...baseline].filter((entry) => !current.has(entry));
const fixedTestOnly = [...baselineTestOnly].filter((entry) => !currentTestOnly.has(entry));

if (SHRINK) {
  const kept = [...baseline].filter((entry) => current.has(entry)).sort();
  const keptTestOnly = [...baselineTestOnly].filter((entry) => currentTestOnly.has(entry)).sort();
  write(kept, keptTestOnly);
  console.log(
    `check-evidence-readership: baseline shrunk by ${fixed.length + fixedTestOnly.length} — ` +
      `${kept.length} unread, ${keptTestOnly.length} test-only grandfathered.`
  );
  if (added.length + addedTestOnly.length) {
    console.log(
      `  ${added.length + addedTestOnly.length} new left reported rather than absorbed.`
    );
  }
  process.exit(0);
}

console.log(
  `check-evidence-readership: ${unique.length} unread, ${uniqueTestOnly.length} read only by ` +
    `tests, of ${fields.size} fields on returned types ` +
    `(${baseline.size}/${baselineTestOnly.size} baselined), ` +
    `${added.length + addedTestOnly.length} new, ${fixed.length + fixedTestOnly.length} resolved.`
);

if (LIST) {
  console.log('\nunread:');
  for (const entry of unique) {
    console.log(`  ${entry}  (${path.relative(REPO, fields.get(entry))})`);
  }
  console.log('\nread only by tests:');
  for (const entry of uniqueTestOnly) {
    console.log(`  ${entry}  (${path.relative(REPO, fields.get(entry))})`);
  }
}

if (fixed.length + fixedTestOnly.length) {
  console.log(
    `\n  ${fixed.length + fixedTestOnly.length} baselined field(s) are now read. ` +
      'Run `--shrink` to bank them.'
  );
}
if (!added.length && !addedTestOnly.length) {
  console.log('\nNo evidence-readership regression.');
  process.exit(0);
}

if (added.length) {
  console.error(`\n${added.length} field(s) added to a returned type that nothing reads:\n`);
  for (const entry of added.slice(0, 20)) {
    console.error(`  ${entry}  (${path.relative(REPO, fields.get(entry))})`);
  }
  if (added.length > 20) console.error(`  … and ${added.length - 20} more`);
}
if (addedTestOnly.length) {
  console.error(`\n${addedTestOnly.length} field(s) added that only a test reads:\n`);
  for (const entry of addedTestOnly.slice(0, 20)) {
    console.error(`  ${entry}  (${path.relative(REPO, fields.get(entry))})`);
  }
  if (addedTestOnly.length > 20) console.error(`  … and ${addedTestOnly.length - 20} more`);
}

console.error(
  '\nA field nothing reads cannot influence a decision, so computing it changes\n' +
    'nothing but cost. Either consume it where the decision is made, assert it in\n' +
    'a test so the expectation is stated, or drop it. If it is deliberately part\n' +
    'of a public shape with no in-repo consumer, accept it with:\n' +
    '  pnpm --filter @holotope/docs evidence:update\n' +
    'To bank fields you wired up without accepting these, use:\n' +
    '  pnpm --filter @holotope/docs evidence:shrink\n'
);
process.exit(1);
