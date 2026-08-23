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

/** Blank-line-delimited paragraphs, in document order. */
const paragraphsOf = (document: string): string[] =>
  document.split(/\n[ \t]*\n/u).map((block) => block.trim())
    .filter((block) => block.length > 0);

/** The opening sentence of a paragraph, normalized, as its key. */
const openingSentenceOf = (paragraph: string): string => {
  const normalized = normalizeClaimText(paragraph);
  const end = /[.:]\s/u.exec(normalized);
  return end === null ? normalized : normalized.slice(0, end.index + 1);
};

/** Top-level Markdown bullets: a `- ` line plus its indented continuations. */
const topLevelBulletsOf = (document: string): string[] => {
  const bullets: string[] = [];
  let current: string[] | null = null;
  for (const line of document.split('\n')) {
    if (/^- /u.test(line)) {
      if (current !== null) bullets.push(current.join('\n'));
      current = [line];
    } else if (current !== null && /^\s+\S/u.test(line)) {
      current.push(line);
    } else if (current !== null) {
      bullets.push(current.join('\n'));
      current = null;
    }
  }
  if (current !== null) bullets.push(current.join('\n'));
  return bullets;
};

/** The bold lead-in of a bullet, normalized, as its key. */
const boldLeadInOf = (bullet: string): string => {
  const normalized = normalizeClaimText(bullet).replace(/^- /u, '');
  const bold = /^\*\*([\s\S]*?)\*\*/u.exec(normalized);
  return bold === null ? normalized.slice(0, 60) : bold[1]!.trim();
};

/** Markdown table rows, excluding the header separator. */
const tableRowsOf = (document: string): string[] =>
  document.split('\n')
    .filter((line) => line.trimStart().startsWith('|')
      && !/^\|[\s:|-]+\|$/u.test(line.trim()));

/** The first cell of a table row, normalized, as its key. */
const firstCellOf = (row: string): string =>
  normalizeClaimText(row.trim().replace(/^\|/u, '').split('|')[0] ?? '');

/**
 * The documentation comment TypeScript attaches to an exported declaration.
 *
 * Read from the AST, so it follows the declaration when the file is edited and
 * cannot silently become the comment of some other symbol.
 */
const attachedJsDocOf = (source: string, symbol: string): string | null => {
  const parsed = ts.createSourceFile(
    'claim.ts', source, ts.ScriptTarget.ES2022, true
  );
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    const named = (ts.isFunctionDeclaration(node)
      || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
      || ts.isClassDeclaration(node)) && node.name?.text === symbol;
    if (named) {
      const ranges = ts.getLeadingCommentRanges(source, node.getFullStart());
      const doc = (ranges ?? []).filter((range) =>
        source.slice(range.pos, range.pos + 3) === '/**');
      if (doc.length > 0) {
        const last = doc[doc.length - 1]!;
        found = source.slice(last.pos, last.end);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(parsed, visit);
  return found;
};

/**
 * The reviewed content of one block, or `null` when the structure no longer
 * holds it — a deleted block and a block whose key was rewritten both land
 * here, and both must fail.
 */
export function findReviewedBlock(
  kind: ReviewedBlockKind, document: string, key: string
): { readonly raw: string; readonly normalized: string } | null {
  if (kind === 'jsdoc') {
    const doc = attachedJsDocOf(document, key);
    return doc === null
      ? null : { raw: doc, normalized: normalizeJsDocText(doc) };
  }
  const candidates = kind === 'changelog-bullet' ? topLevelBulletsOf(document)
    : kind === 'guide-table-row' ? tableRowsOf(document)
      : paragraphsOf(document);
  const keyOf = kind === 'changelog-bullet' ? boldLeadInOf
    : kind === 'guide-table-row' ? firstCellOf : openingSentenceOf;
  const matches = candidates.filter((block) => keyOf(block) === key);
  // Exactly one, so duplicating a reviewed block is a failure rather than a
  // way to keep the gate green while editing the original.
  if (matches.length !== 1) return null;
  return { raw: matches[0]!, normalized: normalizeClaimText(matches[0]!) };
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
  const where = `${block.file} :: ${block.id}`;
  const found = extractReviewedBlock(block.kind, document, block.key);
  if (found === null) {
    return `${where} :: missing :: no unique ${block.kind} keyed`
      + ` "${block.key.slice(0, 60)}" — the block was removed, duplicated,`
      + ' or its opening was rewritten';
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
    positions.push({ block, at: document.indexOf(found.raw) });
  }
  for (let index = 1; index < positions.length; index++) {
    const previous = positions[index - 1]!;
    const current = positions[index]!;
    if (current.at <= previous.at) {
      return `${current.block.file} :: ${current.block.id} :: altered ::`
        + ` reviewed order broken, it now precedes "${previous.block.id}"`;
    }
  }
  return null;
}
