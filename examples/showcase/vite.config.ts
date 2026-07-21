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
      { find: '@holotope/core', replacement: local('../../packages/core/src/index.ts') }
    ]
  },
  build: {
    // The GPU page uses top-level await (renderer.init()); every
    // WebGPU-capable browser supports it.
    target: 'esnext',
    rollupOptions: {
      // Multi-page app: the gallery landing page plus one page per example.
      input: {
        index: local('./index.html'),
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
