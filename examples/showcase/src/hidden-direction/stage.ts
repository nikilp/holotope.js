import {
  AmbientLight, Color, DirectionalLight, Fog, HemisphereLight, NeutralToneMapping, PerspectiveCamera,
  SRGBColorSpace, Scene, Vector3, WebGLRenderer, type Object3D
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * The picture. Lighting, tone and fog are presentation: they shade the 3D
 * slice you are shown and say nothing about light in four dimensions.
 *
 * ## Framing
 *
 * The home frame is fixed to the SCENE, never fitted to the section: a slice
 * that widens is seen to widen. What adapts is only the screen's shape — on a
 * narrow screen the field of view opens so that the same scene radius fits
 * across, instead of pinching the sides off (the accepted page's camera
 * clipped the ball at phone width).
 *
 * The home frame holds every section the turning world can draw, and the
 * contact world's around its launch. It cannot hold everything: after the blow
 * the box keeps moving, and once the slice is turned toward w its section is
 * carried along with it, out of any fixed frame. That is "in your slice, but
 * outside the camera's view" — the controller says so, and `frame` turns the
 * camera to it. Only the camera moves; nothing in the world does.
 */

/**
 * A bound on how far from the centre point anything the turning world draws can be: the ball's
 * farthest point, |c| + r = √(3.6² + 1.05² + 0.92²) + 0.72 ≈ 4.58, at every phase. The chart is a
 * projection, so no section lies farther from the chart's origin. The horizontal field of view is
 * sized from it. Vertically the frame is narrower than this sphere (38° from 11.5 away covers about
 * ±3.9), and holds only because the drawn sections stay in a much flatter band; that claim rests on
 * `framing.test.ts`, which samples the turn, the slide and the orbit at phone and desktop aspects and
 * checks every drawn body lies wholly inside the frustum.
 */
export const SCENE_RADIUS = 4.6;
const HOME = { x: 6.6, y: 4.6, z: 8.2 } as const;
/** The narrowest horizontal field of view, degrees: SCENE_RADIUS from HOME needs 2·asin(4.6 / 11.5) ≈ 47°; the rest is room for name tags. */
const MIN_HORIZONTAL_FOV = 52;
const BASE_VERTICAL_FOV = 38;

/** The vertical field of view that keeps at least MIN_HORIZONTAL_FOV across at this aspect. Pure. */
export function verticalFovFor(aspect: number): number {
  const needed = 2 * Math.atan(Math.tan((MIN_HORIZONTAL_FOV * Math.PI) / 360) / Math.max(aspect, 0.2));
  return Math.max(BASE_VERTICAL_FOV, (needed * 180) / Math.PI);
}

/** A headless camera placed as the page places it — for framing checks without a renderer. */
export function homeCamera(aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(verticalFovFor(aspect), aspect, 0.1, 200);
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
  resize(): void;
  recentre(): void;
  /** Turn the camera to look at a sphere in the chart, from the home direction. Camera only. */
  frame(centre: readonly [number, number, number], radius: number): void;
  /** Turn the camera about its target, around the vertical, by an angle in radians. Camera only. */
  orbit(radians: number): void;
  /** Bring the camera nearer (factor < 1) or farther (> 1), within its limits. Camera only. */
  zoom(factor: number): void;
  onCameraMove(listener: () => void): void;
  dispose(): void;
}

export function createStage(host: HTMLElement, reducedMotion: boolean): Stage {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.append(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color('#070a10');
  scene.fog = new Fog('#070a10', 16, 34);

  const camera = homeCamera(1.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.08;
  controls.minDistance = 4;
  controls.maxDistance = 22;
  controls.target.set(0, 0, 0);

  scene.add(new AmbientLight('#ffffff', 0.22));
  scene.add(new HemisphereLight('#d7e4ff', '#161a22', 0.5));
  const key = new DirectionalLight('#fff3e0', 1.05);
  key.position.set(6, 9, 7);
  scene.add(key);
  const rim = new DirectionalLight('#8fb3ff', 0.6);
  rim.position.set(-7, 2, -6);
  scene.add(rim);
  const under = new DirectionalLight('#ffb36b', 0.14);
  under.position.set(2, -6, 3);
  scene.add(under);

  const resize = (): void => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = verticalFovFor(camera.aspect);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const listeners: (() => void)[] = [];
  controls.addEventListener('change', () => { for (const l of listeners) l(); });

  return {
    camera,
    canvas: renderer.domElement,
    add: (object) => { scene.add(object); },
    render: () => { controls.update(); renderer.render(scene, camera); },
    resize,
    recentre: () => {
      camera.position.set(HOME.x, HOME.y, HOME.z);
      controls.target.set(0, 0, 0);
      controls.update();
    },
    frame: (centre, radius) => {
      const target = new Vector3(...centre);
      const home = new Vector3(HOME.x, HOME.y, HOME.z).normalize();
      const half = (Math.min(camera.fov, (2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) * 180) / Math.PI) * Math.PI) / 360;
      const distance = Math.min(controls.maxDistance, Math.max(controls.minDistance, (radius * 1.6) / Math.sin(half)));
      controls.target.copy(target);
      camera.position.copy(target).addScaledVector(home, distance);
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
    onCameraMove: (listener) => { listeners.push(listener); },
    dispose: () => { observer.disconnect(); controls.dispose(); renderer.dispose(); }
  };
}
