/**
 * Rules the built API reference must satisfy, separated from the script that
 * reads the built site.
 *
 * Each package's reference is a separate TypeDoc run over TypeScript source,
 * but a name one package re-exports from another resolves through that other
 * package's `exports`, which point at its built declarations. Without
 * `packages/<name>/dist` TypeDoc cannot resolve such a name, and with
 * `skipErrorChecking` it omits the page silently: the clean Pages build once
 * shipped `@holotope/three` without eight types it re-exports from
 * `@holotope/core`, and nothing linked to the missing pages, so no route check
 * could notice. Cross-package type references degrade the same way, to plain
 * unlinked text.
 *
 * These checks name pages, not counts:
 * - every name a documented entry point re-exports from another `@holotope`
 *   package must have its own page in the built reference;
 * - every page the committed cross-package index
 *   (`docs/typedoc/external-links.json`) names must exist in the built site.
 *
 * Everything here is pure; the checker supplies source text, the committed
 * index and the built file list.
 */

/**
 * Names an entry point re-exports from another `@holotope` package, read from
 * its syntax tree. `ts` is the TypeScript module, passed in so the rule has no
 * import of its own. `export *` from a package cannot be enumerated without
 * resolving that package, which is the very thing that fails, so it is
 * reported rather than skipped.
 */
export function reExportsFromPackages(ts, fileName, sourceText) {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const names = [];
  const unenumerable = [];
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) continue;
    const from = statement.moduleSpecifier.text;
    if (!from.startsWith('@holotope/')) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) {
      unenumerable.push(from);
      continue;
    }
    for (const element of clause.elements) names.push({ name: element.name.text, from });
  }
  return { names, unenumerable };
}

/**
 * The built pages of one package's reference, by basename. `files` are paths
 * relative to the site's `api/<out>/` directory.
 */
export function pagesByName(files) {
  const pages = new Map();
  for (const file of files) {
    const match = /(?:^|\/)([^/]+)\.html$/.exec(file);
    if (match === null || match[1] === 'index') continue;
    if (!pages.has(match[1])) pages.set(match[1], []);
    pages.get(match[1]).push(file);
  }
  return pages;
}

/** A re-exported name with no page in its package's built reference. */
export function missingReExportPages(pkg, reExports, pages) {
  return reExports
    .filter(({ name }) => !pages.has(name))
    .map(({ name, from }) => `${pkg} re-exports ${name} from ${from}, but its built reference has no page for it`);
}

/**
 * A page the committed cross-package index names that the built site lacks.
 * `exists(route)` answers whether `<route>.html` was built.
 */
export function missingIndexedPages(index, exists) {
  const mappings = index?.externalSymbolLinkMappings;
  if (mappings === undefined || typeof mappings !== 'object') {
    return { missing: [], unreadable: ['the committed index has no externalSymbolLinkMappings'] };
  }
  const missing = [];
  for (const [pkg, table] of Object.entries(mappings)) {
    for (const [name, route] of Object.entries(table ?? {})) {
      if (typeof route !== 'string' || !exists(route)) {
        missing.push(`${pkg}: the committed index names ${name} at ${route}, but the built site has no such page`);
      }
    }
  }
  return { missing, unreadable: [] };
}

/** JSON with the `//` line comments the TypeDoc option files use. */
export function parseJsonWithComments(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}
