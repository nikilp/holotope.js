import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  missingIndexedPages,
  missingReExportPages,
  pagesByName,
  parseJsonWithComments,
  reExportsFromPackages
  // @ts-expect-error -- a plain .mjs module with no declarations; the rules it
  // holds are the subject, and typing it would duplicate them.
} from '../lib/api-pages.mjs';

/**
 * Negative controls for the API-reference completeness check.
 *
 * The defect these cases exist for: the clean Pages build, without
 * packages/<name>/dist, omitted eight types @holotope/three re-exports from
 * @holotope/core. Every route still resolved and the page count only fell by
 * eight, because nothing linked to the missing pages.
 */

const ENTRY = `
export { SlicedComplex3D, type SlicedComplex3DOptions } from './sliced-complex.js';
export type {
  RepresentationHitN,
  RepresentationSourceN
} from '@holotope/core';
export { FieldRelief3D } from './field-relief.js';
`;

const BUILT = [
  'index/classes/SlicedComplex3D.html',
  'index/interfaces/SlicedComplex3DOptions.html',
  'index/interfaces/RepresentationHitN.html',
  'index/type-aliases/RepresentationSourceN.html',
  'index/classes/FieldRelief3D.html',
  'index/index.html',
  'index.html'
];
/** The clean Pages build of 818f769: the re-exported pages are simply absent. */
const CLEAN = BUILT.filter((file) => !/Representation/.test(file));

describe('reExportsFromPackages', () => {
  it('reads the names re-exported from another package, and only those', () => {
    expect(reExportsFromPackages(ts, 'index.ts', ENTRY)).toEqual({
      names: [
        { name: 'RepresentationHitN', from: '@holotope/core' },
        { name: 'RepresentationSourceN', from: '@holotope/core' }
      ],
      unenumerable: []
    });
  });

  it('keeps the exported name of an aliased re-export', () => {
    const { names } = reExportsFromPackages(ts, 'index.ts', "export { VecN as Vector } from '@holotope/core';");
    expect(names).toEqual([{ name: 'Vector', from: '@holotope/core' }]);
  });

  it('reports export * from a package instead of passing it unchecked', () => {
    expect(reExportsFromPackages(ts, 'index.ts', "export * from '@holotope/core';")).toEqual({
      names: [],
      unenumerable: ['@holotope/core']
    });
  });

  it('ignores imports, local re-exports and other scopes', () => {
    const text = "import { VecN } from '@holotope/core';\nexport * from './local.js';\nexport { x } from 'three';";
    expect(reExportsFromPackages(ts, 'index.ts', text)).toEqual({ names: [], unenumerable: [] });
  });
});

describe('missingReExportPages', () => {
  const names = reExportsFromPackages(ts, 'index.ts', ENTRY).names;

  it('accepts a reference with a page for every re-exported name', () => {
    expect(missingReExportPages('@holotope/three', names, pagesByName(BUILT))).toEqual([]);
  });

  it('rejects the clean Pages build, naming each missing page', () => {
    expect(missingReExportPages('@holotope/three', names, pagesByName(CLEAN))).toEqual([
      '@holotope/three re-exports RepresentationHitN from @holotope/core, but its built reference has no page for it',
      '@holotope/three re-exports RepresentationSourceN from @holotope/core, but its built reference has no page for it'
    ]);
  });

  it('does not count module index pages as symbol pages', () => {
    expect(pagesByName(['index.html', 'index/index.html']).size).toBe(0);
  });
});

describe('missingIndexedPages', () => {
  const index = {
    externalSymbolLinkMappings: {
      '@holotope/three': {
        RepresentationHitN: '/api/three/index/interfaces/RepresentationHitN',
        SlicedComplex3D: '/api/three/index/classes/SlicedComplex3D'
      },
      '@holotope/core': { VecN: '/api/core/math/classes/VecN' }
    }
  };
  const site = (files: string[]) => (route: string) => files.includes(`${route}.html`);

  it('accepts a site with every indexed page', () => {
    const files = ['/api/three/index/interfaces/RepresentationHitN.html', '/api/three/index/classes/SlicedComplex3D.html', '/api/core/math/classes/VecN.html'];
    expect(missingIndexedPages(index, site(files))).toEqual({ missing: [], unreadable: [] });
  });

  it('rejects a site missing an indexed page, by name, even when every remaining route resolves', () => {
    const files = ['/api/three/index/classes/SlicedComplex3D.html', '/api/core/math/classes/VecN.html'];
    expect(missingIndexedPages(index, site(files)).missing).toEqual([
      '@holotope/three: the committed index names RepresentationHitN at /api/three/index/interfaces/RepresentationHitN, but the built site has no such page'
    ]);
  });

  it('reports an index without mappings as unreadable rather than complete', () => {
    expect(missingIndexedPages({}, () => true)).toEqual({
      missing: [],
      unreadable: ['the committed index has no externalSymbolLinkMappings']
    });
  });
});

describe('parseJsonWithComments', () => {
  it('reads a TypeDoc option file with line comments', () => {
    expect(parseJsonWithComments('{\n  // why\n  "out": "../api/three"\n}')).toEqual({ out: '../api/three' });
  });
});
