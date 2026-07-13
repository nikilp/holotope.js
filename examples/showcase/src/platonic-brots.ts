import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  evaluateTricomplexMandelbrotSlice3,
  tricomplexPlatonicSlice3,
  type TricomplexPlatonicSlice3Id,
  type TricomplexPlatonicSlice3Spec
} from '@holotope/core';
import { setupShowcaseUI } from './ui';

const container = document.getElementById('app')!;
const scene = new Scene();
scene.background = new Color(0x080910);
scene.fog = new Fog(0x080910, 5, 10);
const camera = new PerspectiveCamera(44, innerWidth / innerHeight, 0.1, 50);
camera.position.set(2.5, 1.7, 3.5);
const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
container.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.65;
scene.add(new AmbientLight(0x9e9bd8, 1.35));
const key = new DirectionalLight(0xffffff, 3.2);
key.position.set(4, 5, 6);
scene.add(key);
const rim = new DirectionalLight(0xff4f9a, 2.2);
rim.position.set(-4, -2, -3);
scene.add(rim);

const product = new Group();
scene.add(product);
const palette: Record<TricomplexPlatonicSlice3Id, number> = {
  airbrot: 0x6bdcff,
  firebrot: 0xff835f,
  earthbrot: 0x72e1a6
};
let shape: TricomplexPlatonicSlice3Id = 'firebrot';
let dwell = 5;
let resolution = 40;
let showSolid = true;

function disposeProduct(): void {
  for (const child of [...product.children]) {
    product.remove(child);
    if (child instanceof Mesh || child instanceof LineSegments || child instanceof Points) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    }
  }
}

function edgePairs(spec: TricomplexPlatonicSlice3Spec): readonly [number, number][] {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const face of spec.faces) {
    for (let index = 0; index < face.length; index++) {
      const a = face[index]!;
      const b = face[(index + 1) % face.length]!;
      const pair: [number, number] = a < b ? [a, b] : [b, a];
      const key = `${pair[0]},${pair[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(pair);
      }
    }
  }
  return edges;
}

function localVertex(spec: TricomplexPlatonicSlice3Spec, index: number): readonly number[] {
  const vertex = spec.vertices[index]!;
  return vertex.map((coordinate, axis) => coordinate - spec.center[axis]!);
}

function exactGeometry(spec: TricomplexPlatonicSlice3Spec): BufferGeometry {
  const positions: number[] = [];
  for (const face of spec.faces) {
    for (let index = 1; index < face.length - 1; index++) {
      for (const vertex of [face[0]!, face[index]!, face[index + 1]!]) {
        positions.push(...localVertex(spec, vertex));
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function exactEdges(spec: TricomplexPlatonicSlice3Spec): BufferGeometry {
  const positions: number[] = [];
  for (const [a, b] of edgePairs(spec)) {
    positions.push(...localVertex(spec, a), ...localVertex(spec, b));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

function rebuild(): void {
  const started = performance.now();
  disposeProduct();
  const spec = tricomplexPlatonicSlice3(shape);
  const edges = edgePairs(spec);
  const maximumRadius = Math.max(...spec.vertices.map((vertex) => Math.hypot(
    vertex[0] - spec.center[0],
    vertex[1] - spec.center[1],
    vertex[2] - spec.center[2]
  )));
  product.scale.setScalar(1.35 / maximumRadius);

  const solid = new Mesh(
    exactGeometry(spec),
    new MeshPhysicalMaterial({
      color: palette[shape],
      emissive: new Color(palette[shape]).multiplyScalar(0.08),
      roughness: 0.28,
      metalness: 0.06,
      transparent: true,
      opacity: showSolid ? 0.46 : 0,
      depthWrite: false,
      side: DoubleSide
    })
  );
  product.add(solid);
  product.add(new LineSegments(
    exactEdges(spec),
    new LineBasicMaterial({ color: 0xe9f2ff, transparent: true, opacity: 0.88 })
  ));

  const extent = maximumRadius * 1.5;
  const step = (extent * 2) / (resolution - 1);
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new Color();
  let exactBounded = 0;
  let unresolvedOutside = 0;
  let falseEscapes = 0;
  for (let k = 0; k < resolution; k++) {
    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        const local = [-extent + i * step, -extent + j * step, -extent + k * step] as const;
        const point = [
          local[0] + spec.center[0],
          local[1] + spec.center[1],
          local[2] + spec.center[2]
        ] as const;
        const evaluation = evaluateTricomplexMandelbrotSlice3(shape, point, {
          maxIterations: 32,
          escapeRadius: 2
        });
        if (evaluation.analyticallyBounded) {
          exactBounded++;
          if (evaluation.escaped) falseEscapes++;
          continue;
        }
        if (!evaluation.escaped) {
          unresolvedOutside++;
          continue;
        }
        if (evaluation.iterations < dwell) continue;
        positions.push(...local);
        color.setHSL(
          0.54 + Math.min(0.46, (evaluation.iterations - dwell) * 0.06),
          0.9,
          0.58
        );
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  const layerGeometry = new BufferGeometry();
  layerGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  layerGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  product.add(new Points(
    layerGeometry,
    new PointsMaterial({
      size: step * 0.62,
      vertexColors: true,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      sizeAttenuation: true
    })
  ));

  const elapsed = performance.now() - started;
  document.getElementById('shapeValue')!.textContent =
    `${spec.label} · basis (${spec.basis.join(', ')})`;
  document.getElementById('theorem')!.textContent =
    `${spec.vertices.length} exact vertices · ${edges.length} edges · ${spec.faces.length} faces · edge ${spec.edgeLength.toFixed(6)}`;
  document.getElementById('sample')!.textContent =
    `${resolution ** 3} probes · ${exactBounded.toLocaleString()} theorem-bounded · ${falseEscapes} false escapes · ${elapsed.toFixed(0)} ms`;
  document.getElementById('layer')!.textContent =
    `${(positions.length / 3).toLocaleString()} exterior points with dwell ≥ ${dwell} · ${unresolvedOutside.toLocaleString()} finite-iteration undecided`;
}

const shapeInput = document.getElementById('shape') as HTMLSelectElement;
shapeInput.addEventListener('change', () => { shape = shapeInput.value as TricomplexPlatonicSlice3Id; rebuild(); });
shape = shapeInput.value as TricomplexPlatonicSlice3Id;
const dwellInput = document.getElementById('dwell') as HTMLInputElement;
const dwellValue = document.getElementById('dwellValue')!;
dwellInput.addEventListener('input', () => { dwell = Number(dwellInput.value); dwellValue.textContent = String(dwell); rebuild(); });
dwell = Number(dwellInput.value);
dwellValue.textContent = String(dwell);
const resolutionInput = document.getElementById('resolution') as HTMLSelectElement;
resolutionInput.addEventListener('change', () => { resolution = Number(resolutionInput.value); rebuild(); });
resolution = Number(resolutionInput.value);
const solidInput = document.getElementById('solid') as HTMLInputElement;
solidInput.addEventListener('change', () => { showSolid = solidInput.checked; rebuild(); });
showSolid = solidInput.checked;
const rotateInput = document.getElementById('rotate') as HTMLInputElement;
rotateInput.addEventListener('change', () => { controls.autoRotate = rotateInput.checked; });
controls.autoRotate = rotateInput.checked;

setupShowcaseUI();
rebuild();
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
