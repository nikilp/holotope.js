import {
  AmbientLight, Color, DirectionalLight, Fog, HemisphereLight, NeutralToneMapping, PerspectiveCamera,
  SRGBColorSpace, Scene, Vector3, WebGLRenderer, type Object3D
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * The camera, the lights and the renderer: the Look hand. Nothing here reads
 * or writes a world. Lighting and fog shade the picture; they say nothing
 * about light in the missing direction, which is the shadow's job.
 *
 * ## Framing
 *
 * The home frame is fixed to the scene, never fitted to the cut: a cut that
 * widens is seen to widen. Both rungs share it, so "camera as you left it"
 * holds across chapters. On a narrow screen the field of view opens so the
 * same scene radius fits across, as The Hidden Direction's does.
 */

/**
 * A bound on how far from the centre anything the journey must show can lie. In the plane rung the cut and the
 * shadow lie within √3 of the plane's axis and the plane slides to ±2.1, so within √(3 + 2.1²) ≈ 2.72; the cube's
 * corners within √3. In the space rung the cut and the shadow lie within 2, the tesseract's circumradius. The
 * plane's drawn square reaches farther, and may run off the frame: the plane goes on. `framing.test.ts` checks that
 * every corner, cut corner and shadow point lies inside the home frustum, in every pose, at phone and desktop aspects.
 */
export const SCENE_RADIUS = 2.8;
export const HOME = { x: 5.0, y: 4.4, z: 5.8 } as const;
/** The narrowest horizontal field of view, degrees: SCENE_RADIUS from HOME (8.83 away) needs 2·asin(2.8 / 8.83) ≈ 37°. */
const MIN_HORIZONTAL_FOV = 44;
const BASE_VERTICAL_FOV = 36;

/** The vertical field of view that keeps at least MIN_HORIZONTAL_FOV across at this aspect. Pure. */
export function verticalFovFor(aspect: number): number {
  const needed = 2 * Math.atan(Math.tan((MIN_HORIZONTAL_FOV * Math.PI) / 360) / Math.max(aspect, 0.2));
  return Math.max(BASE_VERTICAL_FOV, (needed * 180) / Math.PI);
}

/** A headless camera placed as the page places it: for framing checks without a renderer. */
export function homeCamera(aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(verticalFovFor(aspect), aspect, 0.1, 100);
  camera.position.set(HOME.x, HOME.y, HOME.z);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

export interface Stage {
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  add(object: Object3D): void;
  render(): void;
  recentre(): void;
  /** Turn the camera about its target, around the vertical, by an angle in radians. Camera only. */
  orbit(radians: number): void;
  /** Bring the camera nearer (factor < 1) or farther (> 1), within its limits. Camera only. */
  zoom(factor: number): void;
  /** Every camera change, from any cause. */
  onCameraMove(listener: () => void): void;
  /** A drag, pinch or wheel on the picture begins: the visitor is looking. */
  onUserLook(listener: () => void): void;
  /** The picture's size in CSS pixels changed. */
  onResize(listener: (width: number, height: number) => void): void;
  dispose(): void;
}

export function createStage(host: HTMLElement, reducedMotion: boolean): Stage {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color('#070a10');
  scene.fog = new Fog('#070a10', 13, 28);

  const camera = homeCamera(1.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3.5;
  controls.maxDistance = 18;
  controls.target.set(0, 0, 0);

  scene.add(new AmbientLight('#ffffff', 0.3));
  scene.add(new HemisphereLight('#d7e4ff', '#161a22', 0.55));
  const key = new DirectionalLight('#fff3e0', 1.1);
  key.position.set(6, 9, 7);
  scene.add(key);
  const rim = new DirectionalLight('#8fb3ff', 0.6);
  rim.position.set(-7, 2, -6);
  scene.add(rim);
  const under = new DirectionalLight('#ffb36b', 0.18);
  under.position.set(2, -6, 3);
  scene.add(under);

  const resizeListeners: ((w: number, h: number) => void)[] = [];
  const resize = (): void => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = verticalFovFor(camera.aspect);
    camera.updateProjectionMatrix();
    for (const l of resizeListeners) l(w, h);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  const moveListeners: (() => void)[] = [];
  const lookListeners: (() => void)[] = [];
  controls.addEventListener('change', () => { for (const l of moveListeners) l(); });
  controls.addEventListener('start', () => { for (const l of lookListeners) l(); });

  return {
    camera,
    canvas: renderer.domElement,
    add: (object) => { scene.add(object); },
    render: () => { controls.update(); renderer.render(scene, camera); },
    recentre: () => {
      camera.position.set(HOME.x, HOME.y, HOME.z);
      controls.target.set(0, 0, 0);
      controls.update();
    },
    orbit: (radians) => {
      const offset = camera.position.clone().sub(controls.target).applyAxisAngle(new Vector3(0, 1, 0), radians);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    },
    zoom: (factor) => {
      const offset = camera.position.clone().sub(controls.target);
      const length = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * factor));
      camera.position.copy(controls.target).add(offset.setLength(length));
      controls.update();
    },
    onCameraMove: (listener) => { moveListeners.push(listener); },
    onUserLook: (listener) => { lookListeners.push(listener); },
    onResize: (listener) => { resizeListeners.push(listener); resize(); },
    dispose: () => { observer.disconnect(); controls.dispose(); renderer.dispose(); }
  };
}
