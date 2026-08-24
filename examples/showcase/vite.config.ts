import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const local = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Relative base so the built site works at any mount path (GitHub Pages
  // serves it under /holotope.js/).
  base: './',
  resolve: {
    // Point at package sources so the showcase runs without a prior build
    // step. Order matters: subpath entries must precede their parents.
    alias: [
      { find: '@holotope/three/webgpu', replacement: local('../../packages/three/src/webgpu/index.ts') },
      { find: '@holotope/three', replacement: local('../../packages/three/src/index.ts') },
      { find: '@holotope/physics', replacement: local('../../packages/physics/src/index.ts') },
      { find: '@holotope/experiment-physics', replacement: local('../../packages/experiment-physics/src/index.ts') },
      { find: '@holotope/experiment', replacement: local('../../packages/experiment/src/index.ts') },
      { find: '@holotope/core', replacement: local('../../packages/core/src/index.ts') }
    ]
  },
  build: {
    // The GPU page uses top-level await (renderer.init()); every
    // WebGPU-capable browser supports it.
    target: 'esnext',
    rollupOptions: {
      // Multi-page app: the gallery landing page plus one page per example.
      //
      // `source-linked-sheet.html` is deliberately absent, and its omission is
      // not an oversight to be repaired by adding it back. The page's contact
      // model constrains sheet *vertices* against the support, which is what
      // the barrier family provides; a certified triangle-to-hull audit of its
      // complete run shows the sheet *surface* passing through the support
      // once the sheet drapes past that support's finite edge, with every
      // vertex still legally outside it. Publishing a demonstration that shows
      // material crossing its own support is a correctness-of-communication
      // failure whatever the vertices do, so the page stays out of the built
      // site until surface contact — edge- and face-level candidates — exists
      // to constrain it. It is still served by `vite dev` for that work.
      input: {
        index: local('./index.html'),
        // Scene 3 of the guided ladder, built as an experimental route while its
        // taste gate is open. Deliberately absent from the gallery in
        // `index.html` until that review says it belongs there.
        flatland: local('./flatland.html'),
        polytopeBrowser: local('./polytope-browser.html'),
        productBrowser: local('./product-browser.html'),
        provenanceBrowser: local('./provenance-browser.html'),
        physicsBrowser: local('./physics-browser.html'),
        ndContact: local('./nd-contact.html'),
        playground: local('./playground.html'),
        dimensionBridge: local('./dimension-bridge.html'),
        mechanicsWorkbench: local('./mechanics-workbench.html'),
        tesseract: local('./tesseract.html'),
        polychora: local('./polychora.html'),
        duoprisms: local('./duoprisms.html'),
        gpu: local('./gpu.html'),
        compute: local('./compute.html'),
        knots: local('./knots.html'),
        wythoff: local('./wythoff.html'),
        hopf: local('./hopf.html'),
        scene: local('./scene.html'),
        e8: local('./e8.html'),
        elserSloane: local('./elser-sloane.html'),
        ammannBeenker: local('./ammann-beenker.html'),
        penrose: local('./penrose.html'),
        quaternionJulia: local('./quaternion-julia.html'),
        bicomplexJulia: local('./bicomplex-julia.html'),
        platonicBrots: local('./platonic-brots.html'),
        rigidBody4: local('./rigid-body4.html'),
        akn: local('./akn.html')
      }
    }
  }
});
