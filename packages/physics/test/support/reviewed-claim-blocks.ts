import ts from 'typescript';

/**
 * Structural location of the four independently reviewed privacy claims.
 *
 * ## What this is, and what it deliberately is not
 *
 * This preserves four passages that an independent reviewer read and accepted.
 * It does **not** infer the truth of English prose, here or anywhere else. It
 * makes no claim of synonym completeness and no claim about the absence of any
 * wording elsewhere in the repository.
 *
 * The predecessor tried to police vocabulary and failed in both directions at
 * once, which is why the approach was retired rather than extended: nine of
 * nine false synonyms passed it, four of four true scoped sentences failed it,
 * a required clause was satisfied by an unrelated pre-existing sentence about a
 * convergence residual, and the one semantic rule it carried was suppressed by
 * matching anywhere in the same file. A regex cannot be taught the difference
 * between a false claim and a true one; a hash can be taught the difference
 * between reviewed text and something else.
 *
 * ## How a block is found
 *
 * By the structure of the document it lives in, never by searching for the
 * sentence being protected:
 *
 * - `changelog-bullet` — a top-level Markdown bullet, keyed by its bold
 *   lead-in, the way a definition list is keyed by its term;
 * - `readme-paragraph` — a blank-line-delimited paragraph, keyed by its
 *   opening sentence;
 * - `guide-table-row` — a Markdown table row, keyed by its first cell;
 * - `jsdoc` — the documentation comment the TypeScript parser ATTACHES to an
 *   exported declaration, found through the AST rather than by line offset.
 *
 * Deleting a block, altering a word inside it, moving one of its sentences
 * elsewhere, or swapping two blocks all change what the locator returns and
 * therefore fail. Prose added outside every reviewed block does not.
 */
export type ReviewedBlockKind =
  | 'changelog-bullet'
  | 'readme-paragraph'
  | 'guide-table-row'
  | 'jsdoc';

/** One reviewed passage, as pinned. */
export interface ReviewedClaimBlock {
  /** Stable identity, reported when the block fails. */
  readonly id: string;
  /** Repository-relative path of the document that carries it. */
  readonly file: string;
  readonly kind: ReviewedBlockKind;
  /** Structural key: bold lead-in, opening sentence, first cell, or symbol. */
  readonly key: string;
  /** SHA-256 of `text`, so a mismatch is reported without printing prose. */
  readonly sha256: string;
  /** The reviewed content, normalized. */
  readonly text: string;
}

/**
 * Line wrapping is not content.
 *
 * Every run of whitespace becomes one space, so re-flowing a paragraph is
 * invisible while changing a single word is not.
 */
export const normalizeClaimText = (text: string): string =>
  text.replace(/\s+/gu, ' ').trim();

/**
 * The prose of a documentation comment, without its decoration.
 *
 * The `/**`, the `*\/` and the leading `*` of every continuation line are
 * syntax, not content: keeping them would pin the comment's punctuation and
 * make a failure report unreadable.
 */
const normalizeJsDocText = (comment: string): string => normalizeClaimText(
  comment
    .replace(/^\/\*\*/u, '')
    .replace(/\*\/$/u, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*/u, ''))
    .join('\n')
);

/** A structural candidate, with the offset the scan found it at. */
interface Candidate { readonly raw: string; readonly start: number }

/** Blank-line-delimited paragraphs, in document order, with their offsets. */
const paragraphsOf = (document: string): Candidate[] => {
  const candidates: Candidate[] = [];
  let at = 0;
  for (const piece of document.split(/\n[ \t]*\n/u)) {
    const trimmed = piece.trim();
    if (trimmed.length > 0) {
      candidates.push({ raw: trimmed, start: at + piece.indexOf(trimmed) });
    }
    // +1 for the newline the split consumed; exact enough for ordering, and
    // never used to FIND anything.
    at += piece.length + 2;
  }
  return candidates;
};

/** The opening sentence of a paragraph, normalized, as its key. */
const openingSentenceOf = (paragraph: string): string => {
  const normalized = normalizeClaimText(paragraph);
  const end = /[.:]\s/u.exec(normalized);
  return end === null ? normalized : normalized.slice(0, end.index + 1);
};

/** Top-level Markdown bullets: a `- ` line plus its indented continuations. */
const topLevelBulletsOf = (document: string): Candidate[] => {
  const bullets: Candidate[] = [];
  let current: string[] | null = null;
  let start = 0;
  let at = 0;
  const close = (): void => {
    if (current !== null) bullets.push({ raw: current.join('\n'), start });
    current = null;
  };
  for (const line of document.split('\n')) {
    if (/^- /u.test(line)) {
      close();
      current = [line];
      start = at;
    } else if (current !== null && /^\s+\S/u.test(line)) {
      current.push(line);
    } else {
      close();
    }
    at += line.length + 1;
  }
  close();
  return bullets;
};

/** The bold lead-in of a bullet, normalized, as its key. */
const boldLeadInOf = (bullet: string): string => {
  const normalized = normalizeClaimText(bullet).replace(/^- /u, '');
  const bold = /^\*\*([\s\S]*?)\*\*/u.exec(normalized);
  return bold === null ? normalized.slice(0, 60) : bold[1]!.trim();
};

/** Markdown table rows, excluding the header separator, with their offsets. */
const tableRowsOf = (document: string): Candidate[] => {
  const rows: Candidate[] = [];
  let at = 0;
  for (const line of document.split('\n')) {
    if (line.trimStart().startsWith('|')
      && !/^\|[\s:|-]+\|$/u.test(line.trim())) {
      rows.push({ raw: line, start: at });
    }
    at += line.length + 1;
  }
  return rows;
};

/** The first cell of a table row, normalized, as its key. */
const firstCellOf = (row: string): string =>
  normalizeClaimText(row.trim().replace(/^\|/u, '').split('|')[0] ?? '');

/**
 * The documentation comment attached to the UNIQUE EXPORTED TOP-LEVEL
 * declaration with the configured name.
 *
 * Three requirements, and each one closes a demonstrated hole:
 *
 * - only `sourceFile.statements` is inspected, and `node.parent` must be the
 *   source file, so a declaration nested inside a function body is not a
 *   candidate;
 * - the declaration must carry the `export` modifier, established from the
 *   AST through `ts.getCombinedModifierFlags`;
 * - exactly one declaration may match — zero and more than one both fail.
 *
 * The predecessor returned the first name match anywhere in the tree. It
 * recursed into function bodies and checked neither parentage nor export, so
 * planting an earlier same-named nested declaration carrying the reviewed
 * comment moved the pin onto it: the shipped JSDoc could then be falsified
 * back to "not reachable at runtime", type-check, build, and reach
 * `dist/*.d.ts` with the gate green and the stored hash untouched. The
 * adversarial case is the demonstration; the reason to fix it is that any
 * ordinary refactor introducing a same-named local does the same thing
 * silently.
 *
 * Its comment also claimed the JSDoc "cannot silently become the comment of
 * some other symbol", which is the property described above and was not the
 * property implemented. This comment states what the code does.
 *
 * This is not a symbol analyser. It protects one named exported declaration in
 * one named file.
 */
const attachedJsDocOf = (
  source: string, symbol: string
): { readonly text: string; readonly start: number } | null => {
  const parsed = ts.createSourceFile(
    'claim.ts', source, ts.ScriptTarget.ES2022, true
  );
  const matches = parsed.statements.filter((statement) => {
    const named = (ts.isFunctionDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isClassDeclaration(statement)) && statement.name?.text === symbol;
    if (!named || statement.parent !== parsed) return false;
    return (ts.getCombinedModifierFlags(statement as ts.Declaration)
      & ts.ModifierFlags.Export) !== 0;
  });
  // Zero is a missing target; more than one is an ambiguous pin. Neither may
  // silently resolve to "the first one".
  if (matches.length !== 1) return null;
  const target = matches[0]!;
  const ranges = ts.getLeadingCommentRanges(source, target.getFullStart());
  const doc = (ranges ?? []).filter((range) =>
    source.slice(range.pos, range.pos + 3) === '/**');
  if (doc.length === 0) return null;
  const last = doc[doc.length - 1]!;
  // `last.pos` is the offset the scanner reported; nothing is searched for.
  return { text: source.slice(last.pos, last.end), start: last.pos };
};

/**
 * The reviewed content of one block, or `null` when the structure no longer
 * holds it — a deleted block and a block whose key was rewritten both land
 * here, and both must fail.
 */
/**
 * A block as the structure located it, including where it was found.
 *
 * Deliberately NOT exported. `check-evidence-readership` collects the fields
 * of exported interfaces that appear in return position and reports any read
 * only by tests — and every reader of this module is a test, by construction.
 * The alternative would be baselining four fields in
 * `docs/evidence-baseline.json`, which is both outside this commission's
 * permitted file list and the exact move that gate exists to prevent.
 * Callers destructure the result; none of them needs the name.
 */
interface LocatedReviewedBlock {
  readonly kind: ReviewedBlockKind;
  readonly key: string;
  /** The reviewed content, normalized. */
  readonly normalized: string;
  /** The block exactly as it appears in the document. */
  readonly raw: string;
  /** Offset of the block's first character, from the locator itself. */
  readonly start: number;
  /** Offset one past the block's last character. */
  readonly end: number;
}

/**
 * Locate one block, and keep the position the structure found it at.
 *
 * The offset is returned rather than recoverable by search on purpose. The
 * predecessor returned only the text, so `checkReviewedOrder` recomputed the
 * position with `document.indexOf(raw)` — and a verbatim copy merged into an
 * earlier paragraph by a single newline captured it: `paragraphsOf` folded the
 * copy into a larger paragraph, so it was not a structural candidate and
 * raised no duplicate failure, while `indexOf` matched it and reported a small
 * offset for a block that had been moved to the end. The three README boundary
 * paragraphs could be reordered with the gate green.
 */
export function findReviewedBlock(
  kind: ReviewedBlockKind, document: string, key: string
): LocatedReviewedBlock | null {
  const located = (raw: string, start: number, normalized: string) => ({
    kind, key, raw, start, end: start + raw.length, normalized
  });
  if (kind === 'jsdoc') {
    const doc = attachedJsDocOf(document, key);
    if (doc === null) return null;
    return located(doc.text, doc.start, normalizeJsDocText(doc.text));
  }
  const candidates = kind === 'changelog-bullet' ? topLevelBulletsOf(document)
    : kind === 'guide-table-row' ? tableRowsOf(document)
      : paragraphsOf(document);
  const keyOf = kind === 'changelog-bullet' ? boldLeadInOf
    : kind === 'guide-table-row' ? firstCellOf : openingSentenceOf;
  const matches = candidates.filter((block) => keyOf(block.raw) === key);
  // Exactly one, so duplicating a reviewed block is a failure rather than a
  // way to keep the gate green while editing the original.
  if (matches.length !== 1) return null;
  return located(
    matches[0]!.raw, matches[0]!.start, normalizeClaimText(matches[0]!.raw)
  );
}

/** The reviewed content of one block, or `null` when it is no longer there. */
export function extractReviewedBlock(
  kind: ReviewedBlockKind, document: string, key: string
): string | null {
  return findReviewedBlock(kind, document, key)?.normalized ?? null;
}

/**
 * Why one reviewed block no longer matches what was reviewed, as one line, or
 * `null` when it still does.
 *
 * A formatted line rather than a record: the message always leads with the
 * file and the block id, so a failing run names both, and there is no result
 * shape for a caller to read half of.
 */
export function checkReviewedBlock(
  block: ReviewedClaimBlock, document: string, digest: (text: string) => string
): string | null {
  // file :: block :: LOCATOR :: reason :: detail — the locator is named
  // because two of them exist per file kind and a failure must say which one
  // could not hold the block.
  const where = `${block.file} :: ${block.id} :: ${block.kind}`;
  const found = extractReviewedBlock(block.kind, document, block.key);
  if (found === null) {
    return `${where} :: missing :: no unique ${block.kind} keyed`
      + ` "${block.key.slice(0, 60)}" — the block was removed, duplicated,`
      + ' its opening was rewritten, or (for a jsdoc) there is not exactly one'
      + ' exported top-level declaration of that name';
  }
  const actual = digest(found);
  if (actual !== block.sha256) {
    return `${where} :: altered :: reviewed sha256`
      + ` ${block.sha256.slice(0, 12)}, found ${actual.slice(0, 12)}`
      + ` (${found.length} chars vs ${block.text.length})`;
  }
  return null;
}

/**
 * The reviewed blocks of one file must still appear in the reviewed order.
 *
 * Keying by content alone makes position irrelevant, so two reviewed blocks
 * could be swapped and both would still be found intact. Their order carries
 * meaning — the boundary reads "no public surface, then what can be observed,
 * then what is excluded" — so the sequence is checked as well.
 *
 * RELATIVE order only, among the reviewed blocks themselves. Pinning an
 * absolute ordinal among all siblings would fail whenever an unrelated
 * changelog bullet or table row is added above, which is an ordinary edit this
 * gate has no business refusing.
 */
export function checkReviewedOrder(
  blocks: readonly ReviewedClaimBlock[], document: string
): string | null {
  const positions: { readonly block: ReviewedClaimBlock; readonly at: number }[]
    = [];
  for (const block of blocks) {
    const found = findReviewedBlock(block.kind, document, block.key);
    // A missing block is reported by `checkReviewedBlock`; order says nothing
    // about it.
    if (found === null) return null;
    // The offset the LOCATOR found, never a search for the text. Recovering
    // position by `document.indexOf(raw)` is what a merged verbatim decoy
    // captured.
    positions.push({ block, at: found.start });
  }
  for (let index = 1; index < positions.length; index++) {
    const previous = positions[index - 1]!;
    const current = positions[index]!;
    if (current.at <= previous.at) {
      return `${current.block.file} :: ${current.block.id} ::`
        + ` ${current.block.kind} :: altered :: reviewed order broken, it now`
        + ` precedes "${previous.block.id}"`;
    }
  }
  return null;
}
