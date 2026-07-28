import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  WebGLRenderer
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Projection } from '@holotope/core';
import { FLOOR_AXIS, type NdContactScene } from './scene.js';
import { sampleBarrierCurve } from './instruments.js';

/** A rendered view of one scene; `draw` is called once per animation frame. */
export interface NdContactPane {
  draw(): void;
  resize(): void;
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* R² — plain 2D canvas                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The R² pane is a plain canvas rather than an orthographic three.js view.
 *
 * Its job is to make the shared code path obvious and to be the easiest place to
 * read the contact gap, not to look like the R³ pane. A 2D context draws the
 * activation band `d̂` at true scale, which is the number the barrier actually
 * sees — and which no camera projection would preserve.
 */
export function createPane2D(host: HTMLElement, scene: NdContactScene): NdContactPane {
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  const context = canvas.getContext('2d')!;

  // World window chosen so the floor, the near wall and the fall are all visible.
  const world = { minX: -1.15, maxX: 0.65, minY: -0.12, maxY: 0.9 };

  let scaleX = 1;
  let scaleY = 1;
  let lastWidth = -1;
  let lastHeight = -1;

  const resize = (): void => {
    const ratio = Math.min(devicePixelRatio, 2);
    const width = host.clientWidth;
    const height = host.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    scaleX = width / (world.maxX - world.minX);
    scaleY = height / (world.maxY - world.minY);
    lastWidth = width;
    lastHeight = height;
  };

  const draw = (): void => {
    if (host.clientWidth !== lastWidth || host.clientHeight !== lastHeight) resize();
    const width = host.clientWidth;
    const height = host.clientHeight;
    context.clearRect(0, 0, width, height);

    const floorY = height - (0 - world.minY) * scaleY;
    const bandY = height - (scene.activationDistance - world.minY) * scaleY;

    // Activation band: where the barrier is nonzero, at true scale.
    context.fillStyle = 'rgba(127, 212, 255, 0.13)';
    context.fillRect(0, bandY, width, floorY - bandY);

    // Floor and the wall at x = -1.
    context.strokeStyle = '#39476b';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, floorY);
    context.lineTo(width, floorY);
    const wallX = (-1 - world.minX) * scaleX;
    context.moveTo(wallX, 0);
    context.lineTo(wallX, floorY);
    context.stroke();

    for (const particle of scene.particles) {
      const x = (particle.position.data[0]! - world.minX) * scaleX;
      const y = height - (particle.position.data[FLOOR_AXIS]! - world.minY) * scaleY;
      context.beginPath();
      context.arc(x, y, 7, 0, Math.PI * 2);
      context.fillStyle = '#7fd4ff';
      context.fill();
    }
  };

  resize();
  return { draw, resize, dispose: () => canvas.remove() };
}

/* -------------------------------------------------------------------------- */
/* R³ — three.js                                                               */
/* -------------------------------------------------------------------------- */

export function createPane3D(host: HTMLElement, scene: NdContactScene): NdContactPane {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const three = new Scene();
  three.background = new Color(0x080a11);
  const camera = new PerspectiveCamera(42, 1, 0.05, 100);
  camera.position.set(1.6, 1.1, 2.0);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(-0.25, 0.25, -0.25);

  three.add(new AmbientLight(0x8aa0cf, 1.5));
  const key = new DirectionalLight(0xffffff, 1.4);
  key.position.set(2, 3, 2);
  three.add(key);

  const floor = new Mesh(
    new PlaneGeometry(3, 3),
    new MeshStandardMaterial({ color: 0x1b2438, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-0.25, 0, -0.25);
  three.add(floor);

  // The activation band, drawn as a translucent slab just above the floor.
  const band = new Mesh(
    new PlaneGeometry(3, 3),
    new MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.1 })
  );
  band.rotation.x = -Math.PI / 2;
  band.position.set(-0.25, scene.activationDistance, -0.25);
  three.add(band);

  const spheres = scene.particles.map(() => {
    const mesh = new Mesh(
      new SphereGeometry(0.045, 24, 16),
      new MeshStandardMaterial({ color: 0x7fd4ff, roughness: 0.35 })
    );
    three.add(mesh);
    return mesh;
  });

  let lastWidth = -1;
  let lastHeight = -1;

  const resize = (): void => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    lastWidth = width;
    lastHeight = height;
  };

  const draw = (): void => {
    if (host.clientWidth !== lastWidth || host.clientHeight !== lastHeight) resize();
    for (const [index, particle] of scene.particles.entries()) {
      spheres[index]!.position.set(
        particle.position.data[0]!,
        particle.position.data[FLOOR_AXIS]!,
        particle.position.data[2]!
      );
    }
    controls.update();
    renderer.render(three, camera);
  };

  resize();
  return {
    draw,
    resize,
    dispose: () => {
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}

/* -------------------------------------------------------------------------- */
/* The barrier plot — IPC figure 3, from the shipping kernel                    */
/* -------------------------------------------------------------------------- */

export interface BarrierPlot {
  draw(activationDistance: number, stiffness: number, currentGap: number | null): void;
  resize(): void;
}

export function createBarrierPlot(host: HTMLElement): BarrierPlot {
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  const context = canvas.getContext('2d')!;

  const resize = (): void => {
    const ratio = Math.min(devicePixelRatio, 2);
    canvas.width = host.clientWidth * ratio;
    canvas.height = 96 * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const draw = (
    activationDistance: number,
    stiffness: number,
    currentGap: number | null
  ): void => {
    const width = host.clientWidth;
    const height = 96;
    context.clearRect(0, 0, width, height);

    const curve = sampleBarrierCurve({ activationDistance, stiffness, samples: 240 });
    const maxDistance = curve[curve.length - 1]!.distance;
    const maxEnergy = Math.max(...curve.map((sample) => sample.energy)) || 1;
    const x = (distance: number): number => 12 + (distance / maxDistance) * (width - 24);
    const y = (energy: number): number => height - 16 - (energy / maxEnergy) * (height - 30);

    // The clamp, marked: at and beyond d-hat the energy is exactly zero.
    const clampX = x(activationDistance);
    context.fillStyle = 'rgba(127, 212, 255, 0.08)';
    context.fillRect(clampX, 0, width - 24 - clampX + 12, height - 16);
    context.strokeStyle = '#39476b';
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(clampX, 4);
    context.lineTo(clampX, height - 16);
    context.stroke();
    context.setLineDash([]);

    context.strokeStyle = '#7fd4ff';
    context.lineWidth = 1.6;
    context.beginPath();
    curve.forEach((sample, index) => {
      const px = x(sample.distance);
      const py = y(sample.energy);
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.stroke();

    if (currentGap !== null && currentGap > 0 && currentGap < maxDistance) {
      context.fillStyle = '#ffd479';
      context.beginPath();
      context.arc(x(currentGap), y(
        curve.reduce((best, sample) =>
          Math.abs(sample.distance - currentGap) < Math.abs(best.distance - currentGap)
            ? sample
            : best
        ).energy
      ), 3.5, 0, Math.PI * 2);
      context.fill();
    }

    context.fillStyle = '#56658a';
    context.font = '10px ui-monospace, Menlo, monospace';
    context.fillText('barrier energy  b(d) = −κ (d − d̂)² ln(d / d̂)', 12, 12);
    context.fillText('d̂', clampX + 4, height - 4);
    context.fillText('0', 12, height - 4);
  };

  resize();
  return { draw, resize };
}

/* -------------------------------------------------------------------------- */
/* R⁴ — one source, two representations                                        */
/* -------------------------------------------------------------------------- */

/** Shared three.js scaffolding for the two R⁴ views. */
const createR4Stage = (host: HTMLElement, floorAxisHeight: number) => {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);

  const three = new Scene();
  three.background = new Color(0x080a11);
  const camera = new PerspectiveCamera(42, 1, 0.05, 100);
  camera.position.set(1.7, 1.2, 2.1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(-0.25, 0.25, -0.25);

  three.add(new AmbientLight(0x8aa0cf, 1.5));
  const key = new DirectionalLight(0xffffff, 1.3);
  key.position.set(2, 3, 2);
  three.add(key);

  const floor = new Mesh(
    new PlaneGeometry(3, 3),
    new MeshStandardMaterial({ color: 0x1b2438, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-0.25, floorAxisHeight, -0.25);
  three.add(floor);

  let lastWidth = -1;
  let lastHeight = -1;
  const resize = (): void => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    lastWidth = width;
    lastHeight = height;
  };
  const syncSize = (): void => {
    if (host.clientWidth !== lastWidth || host.clientHeight !== lastHeight) resize();
  };
  const dispose = (): void => {
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  const render = (): void => {
    controls.update();
    renderer.render(three, camera);
  };
  return { three, resize, syncSize, dispose, render };
};

/**
 * The R⁴ source projected into R³.
 *
 * The particles here are not the source; they are one map of it. The barrier
 * that produced these positions was evaluated on the R⁴ coordinates, and the
 * distance a viewer reads off this image is not the distance the solver used —
 * see the provenance readout, which prints both.
 */
export function createPane4DProjection(
  host: HTMLElement,
  scene: NdContactScene,
  projection: Projection
): NdContactPane {
  const stage = createR4Stage(host, 0);
  const spheres = scene.particles.map(() => {
    const mesh = new Mesh(
      new SphereGeometry(0.045, 24, 16),
      new MeshStandardMaterial({ color: 0x7fd4ff, roughness: 0.35 })
    );
    stage.three.add(mesh);
    return mesh;
  });

  const draw = (): void => {
    stage.syncSize();
    for (const [index, particle] of scene.particles.entries()) {
      const [x, y, z] = projection.projectPoint(particle.position.data);
      spheres[index]!.position.set(x, y, z);
    }
    stage.render();
  };

  stage.resize();
  return { draw, resize: stage.resize, dispose: stage.dispose };
}

/** Live state the section view reads each frame. */
export interface SectionView {
  readonly pane: NdContactPane;
  /** Sets the hyperplane offset along the last axis. */
  setOffset(offset: number): void;
  /** Authored 4-ball radius; a representation choice, not physics. */
  readonly ballRadius: number;
}

/**
 * An exact section of the R⁴ source by the hyperplane `w = offset`.
 *
 * A particle is a point, and a hyperplane section of a point set is empty
 * almost everywhere — so sectioning the source literally would show nothing.
 * Each particle is therefore given an authored 4-ball of radius `ballRadius`
 * for the purpose of *being seen*: the section of that ball is a 3-ball of
 * radius `sqrt(r² − Δw²)`, which shrinks to nothing as the hyperplane sweeps
 * past it.
 *
 * The radius is a representation choice and carries no physics. That is the
 * point worth taking from this view: a particle that has vanished from the
 * section has not left the simulation, and the solver is still resolving its
 * contacts on coordinates this picture cannot show.
 */
export function createPane4DSection(
  host: HTMLElement,
  scene: NdContactScene,
  ballRadius = 0.22
): SectionView {
  const stage = createR4Stage(host, 0);
  let offset = 0;

  const spheres = scene.particles.map(() => {
    const mesh = new Mesh(
      new SphereGeometry(1, 24, 16),
      new MeshStandardMaterial({ color: 0xffd479, roughness: 0.4 })
    );
    stage.three.add(mesh);
    return mesh;
  });

  const draw = (): void => {
    stage.syncSize();
    const last = scene.dimension - 1;
    for (const [index, particle] of scene.particles.entries()) {
      const delta = particle.position.data[last]! - offset;
      const squared = ballRadius * ballRadius - delta * delta;
      const mesh = spheres[index]!;
      if (squared <= 0) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      const radius = Math.sqrt(squared);
      mesh.scale.setScalar(radius);
      mesh.position.set(
        particle.position.data[0]!,
        particle.position.data[FLOOR_AXIS]!,
        particle.position.data[2]!
      );
    }
    stage.render();
  };

  stage.resize();
  return {
    pane: { draw, resize: stage.resize, dispose: stage.dispose },
    setOffset: (next: number) => {
      offset = next;
    },
    ballRadius
  };
}
