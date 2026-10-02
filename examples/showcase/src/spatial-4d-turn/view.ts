import {
  AmbientLight, Color, DirectionalLight, Group, HemisphereLight, PerspectiveCamera,
  Scene, WebGLRenderer, type Object3D
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * The 3D viewport the section is shown in.
 *
 * ## Lighting is presentation
 *
 * The lights below illuminate the RESULTING 3D SECTION. They are not a claim
 * about illumination in R4, and no shading here carries information about the
 * fourth axis: a face is bright because of where it faces in the chart, which
 * is a fact about this picture, not about the scene.
 *
 * ## Framing is fixed on purpose
 *
 * The camera is placed once and never re-fitted. Sections of a 4D box genuinely
 * change size as the hyperplane turns, and auto-framing would cancel exactly the
 * change worth seeing — the object would appear the same size throughout while
 * its actual extent doubled. So the frame stays put and the size moves.
 */
export interface Viewport {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly contents: Group;
  add(object: Object3D): void;
  render(): void;
  resize(): void;
  resetCamera(): void;
  dispose(): void;
}

const CAMERA_HOME = { x: 6.2, y: 4.4, z: 7.6 } as const;

export function createViewport(host: HTMLElement): Viewport {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.append(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color('#101216');

  const camera = new PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(CAMERA_HOME.x, CAMERA_HOME.y, CAMERA_HOME.z);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  // No zoom-to-fit and no auto-rotate: the camera answers "from where", never
  // "how big", so a section that grows is seen to grow.
  controls.target.set(0, 0, 0);

  scene.add(new AmbientLight('#ffffff', 0.35));
  scene.add(new HemisphereLight('#cfe0ff', '#2a2f3a', 0.55));
  const key = new DirectionalLight('#ffffff', 1.15);
  key.position.set(5, 8, 6);
  scene.add(key);
  const fill = new DirectionalLight('#9fc0ff', 0.4);
  fill.position.set(-6, -3, -4);
  scene.add(fill);

  const contents = new Group();
  scene.add(contents);

  const resize = (): void => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  return {
    scene, camera, contents,
    add: (object) => { contents.add(object); },
    render: () => { controls.update(); renderer.render(scene, camera); },
    resize,
    resetCamera: () => {
      camera.position.set(CAMERA_HOME.x, CAMERA_HOME.y, CAMERA_HOME.z);
      controls.target.set(0, 0, 0);
      controls.update();
    },
    dispose: () => { controls.dispose(); renderer.dispose(); }
  };
}
