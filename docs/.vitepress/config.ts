import { createRequire } from 'node:module';
import { defineConfig, type DefaultTheme } from 'vitepress';

const require = createRequire(import.meta.url);

// The API sidebars are emitted by typedoc-vitepress-theme into docs/api/*.
// They are generated output, so a checkout without a prior `pnpm run api`
// has none — fall back to an empty sidebar rather than failing the config,
// which keeps `vitepress dev` usable while the reference is regenerating.
type Item = DefaultTheme.SidebarItem;

const links = (items: Item[]): string[] =>
  items.flatMap((i) => (i.items?.length ? links(i.items) : i.link ? [i.link] : []));

/** Longest shared directory prefix of a group's links, e.g. `/api/core/math/`. */
const commonDir = (paths: string[]): string => {
  if (!paths.length) return '';
  const split = paths.map((p) => p.split('/').slice(0, -1));
  const head = split[0]!;
  let n = head.length;
  for (const s of split) {
    let i = 0;
    while (i < n && i < s.length && s[i] === head[i]) i++;
    n = i;
  }
  return head.slice(0, n).join('/') + '/';
};

/**
 * Path-scoped API sidebars.
 *
 * VitePress server-renders every sidebar link into the static HTML of every
 * page the sidebar covers. One sidebar spanning a package therefore costs
 * O(symbols) markup on O(symbols) pages — quadratic in the size of the
 * package, which dominates total output well before a thousand symbols.
 * Marking groups collapsed does not change this; collapsed items are rendered
 * and hidden with CSS.
 *
 * Scoping each top-level group to the path its links share makes per-page
 * markup proportional to one section instead of the whole package, and keeps
 * navigation usable: a flat list of several hundred symbols is not browsable
 * in any case. A switcher across sibling groups preserves reachability.
 */
const apiSidebars = (pkg: string): Record<string, Item[]> => {
  let groups: Item[];
  try {
    groups = require(`../api/${pkg}/typedoc-sidebar.json`) as Item[];
  } catch {
    return { [`/api/${pkg}/`]: [{ text: 'Not generated — run `pnpm run api`', link: '/' }] };
  }

  const scoped = groups
    .map((g) => ({ group: g, dir: commonDir(links(g.items ?? [])) }))
    .filter((s) => s.dir.startsWith(`/api/${pkg}/`) && s.dir !== `/api/${pkg}/`);

  const switcher: Item = {
    text: `@holotope/${pkg}`,
    items: scoped.map((s) => ({ text: s.group.text ?? s.dir, link: s.dir }))
  };

  const out: Record<string, Item[]> = {
    // Package landing page: just the switcher.
    [`/api/${pkg}/`]: [switcher]
  };
  for (const s of scoped) out[s.dir] = [switcher, s.group];
  return out;
};

export default defineConfig({
  title: 'Holotope.js',
  description:
    'N-dimensional geometry for TypeScript: authoritative N-dimensional state, explicit projection and slicing, traceable source identity, and source-space simulation.',

  // Served under the showcase site at nikilp.github.io/holotope.js/docs/.
  base: '/holotope.js/docs/',

  cleanUrls: true,
  lastUpdated: true,

  // The guide carries real notation — incremental-potential objectives, the
  // graph Laplacian, so(4) generators. Rendered via MathJax so `$$…$$` blocks
  // and `$…$` spans typeset instead of showing their source.
  markdown: { math: true },

  // By default VitePress inlines a map of every route's content hash into
  // each page, which is again quadratic once the reference contributes on the
  // order of a thousand routes. Emitting it as a shared chunk makes the cost
  // additive and lets the map be cached independently of any page.
  metaChunk: true,

  // The generated reference is large and moves with the source; a dead link
  // there should not block a docs build. Learn pages are checked normally.
  ignoreDeadLinks: [/^\/api\//],

  themeConfig: {
    search: { provider: 'local' },

    nav: [
      { text: 'Learn', link: '/learn/', activeMatch: '/learn/' },
      {
        text: 'Reference',
        activeMatch: '/api/',
        items: [
          { text: '@holotope/core', link: '/api/core/' },
          { text: '@holotope/three', link: '/api/three/' },
          { text: '@holotope/physics', link: '/api/physics/' }
        ]
      },
      { text: 'Showcase', link: 'https://nikilp.github.io/holotope.js/' }
    ],

    sidebar: {
      '/learn/': [
        {
          text: 'Start here',
          items: [
            { text: 'Overview', link: '/learn/' },
            { text: 'The mental model', link: '/learn/mental-model' },
            { text: 'Architecture', link: '/learn/architecture' },
            { text: 'Cookbook', link: '/learn/cookbook' }
          ]
        },
        {
          text: 'Source and representation',
          items: [
            { text: 'Representation provenance', link: '/learn/representation-provenance' },
            { text: 'Provenance-driven decorations', link: '/learn/couplings' }
          ]
        },
        {
          text: 'Mechanics',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/learn/physics/' },
            { text: 'Mass and inertia', link: '/learn/physics/mass-and-inertia' },
            { text: 'Rigid bodies', link: '/learn/physics/rigid-bodies' },
            { text: 'Collision queries', link: '/learn/physics/collision' },
            { text: 'Contact', link: '/learn/physics/contact' },
            { text: 'Joints and constraints', link: '/learn/physics/constraints' },
            { text: 'Deformable and XPBD', link: '/learn/physics/deformable' },
            { text: 'Correctness boundaries', link: '/learn/physics/boundaries' }
          ]
        },
        {
          text: 'Exact constructions',
          collapsed: true,
          items: [
            { text: 'E8 through the H4 folding', link: '/learn/theory/e8-folding' },
            { text: 'Cut-and-project model sets', link: '/learn/theory/model-sets' },
            { text: 'Implicit fields in R4', link: '/learn/theory/implicit-fields' },
            { text: 'Spectral analysis', link: '/learn/theory/spectral-analysis' }
          ]
        },
        {
          text: 'Optimization-based mechanics',
          collapsed: true,
          items: [
            { text: 'Incremental potentials', link: '/learn/theory/incremental-potentials' },
            { text: 'Candidate-state potentials', link: '/learn/theory/candidate-potentials' }
          ]
        },
        {
          text: 'Contributing',
          collapsed: true,
          items: [{ text: 'Documentation gaps', link: '/learn/contributing/api-gaps' }]
        }
      ],

      ...apiSidebars('core'),
      ...apiSidebars('three'),
      ...apiSidebars('physics')
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/nikilp/holotope.js' }],

    editLink: {
      pattern: 'https://github.com/nikilp/holotope.js/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    footer: {
      message:
        'MIT licensed. The API is pre-1.0 and expected to move — the reference is generated from source at build time.',
      copyright: 'Holotope.js'
    },

    outline: { level: [2, 3] }
  }
});
