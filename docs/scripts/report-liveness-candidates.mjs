/**
 * Tests that assert a bad state is absent without witnessing that anything ran.
 *
 * This library's guarantees are refusals: when something cannot be done safely
 * it is declined rather than approximated. That makes a whole class of
 * assertion quietly worthless — "the bad thing did not happen" is satisfied by
 * a refusal that stopped the test from doing anything at all.
 *
 * The case that prompted this asserted that particles stayed above a floor
 * after 120 steps. Every step past the fortieth was refused, nothing was
 * applied, and a halted simulation trivially satisfies any claim about where it
 * did not go. The test certified a frozen scene as a working one, and would
 * have gone on passing indefinitely, because passing was all it was built to do.
 *
 * This reports candidates rather than failing a build. Whether an assertion
 * needs a liveness companion is a judgement about what the test is for — a unit
 * test of a pure function has nothing to be live about. The point is to make
 * the population visible and finite.
 *
 * ## Why reviewed tests must say so explicitly
 *
 * Syntax cannot classify these. `expect(height).toBeGreaterThan(0)` is the
 * vacuous absence assertion that prompted the whole report;
 * `expect(rotation).toBeGreaterThan(1)` is a liveness witness. They are the same
 * matcher, and only the meaning of the quantity separates them — which is why
 * adding a proper witness to a flagged test used to make its score go *up*.
 *
 * So a reviewed test declares its witness in a comment:
 *
 *     // liveness: the rotor turned ~1.99 of a possible 2, so the body moved
 *
 * Declared tests leave the queue and are counted separately. The declaration is
 * a claim by a reviewer, not a proof — but it is greppable, reviewable in a
 * diff, and turns a one-time triage list into something that can be re-run and
 * shrunk.
 *
 *   node scripts/report-liveness-candidates.mjs          ranked report
 *   node scripts/report-liveness-candidates.mjs --json   machine-readable
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const AS_JSON = process.argv.includes('--json');

/** Assertions that claim a bad state is absent. */
const ABSENCE = [
  /\.toBeGreaterThan\(/, /\.toBeGreaterThanOrEqual\(/,
  /\.toBeLessThan\(/, /\.toBeLessThanOrEqual\(/,
  /\.not\.toBe/, /\.toBeCloseTo\(/,
  /\.toBeNull\(\)/, /\.toBeUndefined\(\)/
];

/**
 * Evidence that the path under test actually ran.
 *
 * Deliberately generous: counting something, comparing against a prior state,
 * or asserting a status all witness execution. A test doing any of these is not
 * a candidate even if it also asserts an absence.
 */
const LIVENESS = [
  /\btoHaveLength\(/, /\.length\)\s*\.toBe/, /status\b[^\n]*\.toBe\(/,
  /\btoBe\(true\)/, /\bapplied\b/, /\biterations\b/,
  /\bbefore\b[\s\S]{0,200}\bafter\b/, /\.not\.toEqual\(/,
  /\btoHaveBeenCalled/, /\bcount\b/
];

/**
 * Paths that can refuse, and so can stop a test doing anything.
 *
 * This is what narrows a population into a queue. A pure geometric assertion
 * has no way to quietly stop running; a loop that steps, applies, minimizes,
 * advances, or invokes does, because each of those may decline and leave the
 * state exactly where it was. Only there is an absence assertion at risk of
 * being satisfied by nothing having happened.
 */
const REFUSABLE = [
  /\bstepXpbd/, /\bapplyXpbd/, /\bminimizeXpbd/, /\bsearchXpbd/,
  /\.advance\(/, /\.invoke\(/, /\.restore\(/, /\.setParameter\(/,
  /\bfor \(let step\b/, /\bfor \(let frame\b/
];

const testFiles = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(full);
    } else if (entry.name.endsWith('.test.ts')) testFiles.push(full);
  }
};
walk(path.join(REPO, 'packages'));
walk(path.join(REPO, 'examples'));

/** Splits a file into individual test bodies by brace depth. */
const testsIn = (text) => {
  const found = [];
  for (const match of text.matchAll(/\bit\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
    const from = match.index + match[0].length;
    let depth = 0;
    let started = false;
    let index = from;
    for (; index < text.length; index++) {
      const character = text[index];
      if (character === '{') { depth++; started = true; }
      else if (character === '}') {
        depth--;
        if (started && depth === 0) break;
      }
    }
    found.push({ name: match[2], body: text.slice(from, index) });
  }
  return found;
};

/**
 * A reviewer's declaration of where this test's liveness witness is.
 *
 * Continuation lines are joined, so a declaration may wrap to the column limit
 * like any other comment. A bare `//` ends it, which is how a declaration is
 * separated from the explanatory comment that usually follows.
 */
const declarationIn = (body) => {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^\s*\/\/\s*liveness:/.test(line));
  if (start === -1) return undefined;
  const parts = [lines[start].replace(/^\s*\/\/\s*liveness:\s*/, '').trim()];
  for (let index = start + 1; index < lines.length; index++) {
    const continuation = lines[index].match(/^\s*\/\/\s?(.*)$/);
    if (!continuation || continuation[1].trim() === '') break;
    parts.push(continuation[1].trim());
  }
  return parts.join(' ');
};

const candidates = [];
const declared = [];
for (const file of testFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const { name, body } of testsIn(text)) {
    const absences = ABSENCE.filter((probe) => probe.test(body)).length;
    if (absences === 0) continue;
    // Only a refusable driver can leave an absence assertion vacuous.
    if (!REFUSABLE.some((probe) => probe.test(body))) continue;
    const declaration = declarationIn(body);
    if (declaration) {
      declared.push({ file: path.relative(REPO, file), name, witness: declaration });
      continue;
    }
    if (LIVENESS.some((probe) => probe.test(body))) continue;
    candidates.push({ file: path.relative(REPO, file), name, absenceAssertions: absences });
  }
}
candidates.sort((a, b) => b.absenceAssertions - a.absenceAssertions);
declared.sort((a, b) => a.file.localeCompare(b.file));

if (AS_JSON) {
  console.log(JSON.stringify({ scanned: testFiles.length, candidates, declared }, null, 2));
  process.exit(0);
}

console.log(
  `liveness: ${candidates.length} candidate(s) across ${testFiles.length} test files, ` +
    `${declared.length} declared.\n` +
    'Each candidate drives a refusable path and asserts a bad state is absent,\n' +
    'without witnessing that anything ran — so a refusal that halted the test\n' +
    'would satisfy it. Review rather than assume: some are legitimately fine,\n' +
    'and a reviewed test records its witness in a `// liveness:` comment.\n'
);
for (const candidate of candidates.slice(0, 20)) {
  console.log(`  ${String(candidate.absenceAssertions).padStart(2)}  ${candidate.file}`);
  console.log(`      ${candidate.name}`);
}
if (candidates.length > 20) {
  console.log(`\n  … and ${candidates.length - 20} more (use --json for all).`);
}
if (declared.length > 0) {
  console.log('\ndeclared witnesses:');
  for (const entry of declared) {
    console.log(`  ${entry.file}`);
    console.log(`      ${entry.name}`);
    console.log(`      → ${entry.witness}`);
  }
}
