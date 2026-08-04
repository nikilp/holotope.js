import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
  type Intersection
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CellComplex,
  CoordinateProjection,
  PerspectiveProjection,
  type Projection
} from '@holotope/core';
import { ProjectedSurface3D } from '@holotope/three';

/**
 * The two explicit R4 → R3 representations, and everything three.js.
 *
 * Neither view is the model. Both read the same authoritative R4 source and
 * lose something different on the way to three coordinates, which is the point
 * of showing two:
 *
 * - the **perspective** view uses the hidden W coordinate in its map. Distance
 *   along W scales what you see, so W is not discarded — it is spent on
 *   apparent size and depth, and cannot be read back off the picture;
 * - the **X/W/Y coordinate** view keeps W as a visible screen axis and drops Z
 *   instead. W becomes directly legible, at the cost of a coordinate the
 *   perspective view was showing.
 *
 * The sheet is tinted by a continuous W ramp in both views, so the hidden
 * coordinate has an immediate visual cue even where a projection spends it.
 */

/** Which coordinate the sheet's colour encodes. Nothing here encodes stress. */
export const SHEET_COLOUR_ENCODING = 'w-coordinate' as const;

/** Low and high ends of the W ramp, as CSS-ish hex for the legend. */
export const W_RAMP = { low: 0x2a4a8f, high: 0x7ce7ff } as const;

const OBSTACLE_COLOUR = 0x2f7a5f;
const SELECTION_COLOUR = 0xffc247;

/** One named representation of the same source. */
export interface SheetView {
  readonly key: 'perspective' | 'coordinate';
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly sheet: ProjectedSurface3D;
  readonly obstacle: ProjectedSurface3D;
  /** Outline of the selected source triangle, drawn in this view's frame. */
  readonly selectionOutline: LineSegments;
  /** Filled overlay of the same triangle, so the selection reads at a glance. */
  readonly selectionFill: Mesh;
  render(): void;
  resize(): void;
  resetCamera(): void;
  dispose(): void;
}

/** A pick, before it is interpreted. */
export interface SheetPick {
  readonly surface: ProjectedSurface3D;
  readonly intersection: Intersection;
}

const rampLow = new Color(W_RAMP.low);
const rampHigh = new Color(W_RAMP.high);
const scratch = new Color();

/**
 * Attaches a per-vertex W colour attribute to a surface's public geometry.
 *
 * The product's `update()` mutates position and normal in place and never
 * replaces attributes, so an externally attached `color` attribute survives
 * every frame and only needs its values refreshed.
 *
 * This reads W from the *source* complex rather than any posed copy, so the
 * ramp is meaningful only while the product is drawn without a transform —
 * which is how this page draws it.
 */
function attachWColour(surface: ProjectedSurface3D): BufferAttribute {
  const triangles = surface.geometry.getAttribute('position').count / 3;
  const colour = new BufferAttribute(new Float32Array(triangles * 3 * 3), 3);
  surface.geometry.setAttribute('color', colour);
  return colour;
}

/** Refreshes the W ramp from the current source coordinates. */
function refreshWColour(
  surface: ProjectedSurface3D,
  colour: BufferAttribute,
  complex: CellComplex,
  low: number,
  high: number
): void {
  const span = high - low;
  const triangles = colour.count / 3;
  for (let triangle = 0; triangle < triangles; triangle++) {
    const vertices = surface.faceVertices(triangle);
    for (let corner = 0; corner < 3; corner++) {
      const vertex = vertices[corner]!;
      const w = complex.positions[vertex * complex.ambientDim + 3] ?? 0;
      const t = span > 1e-12 ? Math.min(1, Math.max(0, (w - low) / span)) : 0.5;
      scratch.copy(rampLow).lerp(rampHigh, t);
      colour.setXYZ(triangle * 3 + corner, scratch.r, scratch.g, scratch.b);
    }
  }
  colour.needsUpdate = true;
}

interface ViewSpec {
  readonly key: 'perspective' | 'coordinate';
  readonly host: HTMLElement;
  readonly projection: Projection;
  readonly distance: number;
}

function createView(
  spec: ViewSpec,
  sheetComplex: CellComplex,
  obstacleComplex: CellComplex
): { view: SheetView; colour: BufferAttribute } {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  spec.host.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.01, 200);
  const home = { x: spec.distance, y: spec.distance * 0.75, z: spec.distance };
  camera.position.set(home.x, home.y, home.z);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(1.2, 0.4, 0);

  scene.add(new AmbientLight(0x93a6cc, 1.9));
  const key = new DirectionalLight(0xffffff, 0.9);
  key.position.set(4, 7, 5);
  scene.add(key);

  const sheet = new ProjectedSurface3D(sheetComplex, spec.projection, {
    material: new MeshStandardMaterial({
      // Lighting only shapes the surface; the colour attribute carries W.
      vertexColors: true, side: DoubleSide, roughness: 1, metalness: 0
    })
  });
  const obstacle = new ProjectedSurface3D(obstacleComplex, spec.projection, {
    material: new MeshStandardMaterial({
      color: OBSTACLE_COLOUR, side: DoubleSide, roughness: 1, metalness: 0,
      transparent: true, opacity: 0.34
    })
  });
  const colour = attachWColour(sheet);
  scene.add(sheet.object, obstacle.object);

  // A filled overlay plus its outline. Line width is not portable in WebGL, so
  // the fill is what makes the selected triangle legible; depth testing is off
  // on both so a selection behind a fold still reads.
  const outlineGeometry = new BufferGeometry();
  outlineGeometry.setAttribute(
    'position', new BufferAttribute(new Float32Array(6 * 3), 3)
  );
  const selectionOutline = new LineSegments(
    outlineGeometry,
    new LineBasicMaterial({ color: SELECTION_COLOUR, depthTest: false })
  );
  selectionOutline.visible = false;
  selectionOutline.renderOrder = 3;
  scene.add(selectionOutline);

  const fillGeometry = new BufferGeometry();
  fillGeometry.setAttribute(
    'position', new BufferAttribute(new Float32Array(3 * 3), 3)
  );
  const selectionFill = new Mesh(
    fillGeometry,
    new MeshBasicMaterial({
      color: SELECTION_COLOUR, side: DoubleSide, transparent: true,
      opacity: 0.55, depthTest: false
    })
  );
  selectionFill.visible = false;
  selectionFill.renderOrder = 2;
  scene.add(selectionFill);

  const resize = (): void => {
    const width = spec.host.clientWidth;
    const height = spec.host.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  return {
    colour,
    view: {
      key: spec.key,
      renderer,
      camera,
      controls,
      sheet,
      obstacle,
      selectionOutline,
      selectionFill,
      render: () => { controls.update(); renderer.render(scene, camera); },
      resize,
      resetCamera: () => {
        camera.position.set(home.x, home.y, home.z);
        controls.target.set(1.2, 0.4, 0);
        controls.update();
      },
      dispose: () => {
        controls.dispose();
        sheet.dispose();
        obstacle.dispose();
        outlineGeometry.dispose();
        selectionOutline.material.dispose();
        fillGeometry.dispose();
        selectionFill.material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      }
    }
  };
}

/** Both representations of one source, kept in step with each other. */
export interface SheetViews {
  readonly perspective: SheetView;
  readonly coordinate: SheetView;
  /** Redraws both products from the current source, including the W ramp. */
  refresh(): void;
  /** Outlines one source triangle in both views, or clears when `null`. */
  showSelection(vertices: readonly number[] | null): void;
  render(): void;
  resize(): void;
  resetCameras(): void;
  pick(view: SheetView, event: MouseEvent): SheetPick | null;
  dispose(): void;
}

/**
 * Builds both views over one sheet source and one obstacle source.
 *
 * @param hosts - The elements each renderer's canvas is appended to.
 * @param sheetComplex - The authoritative R4 sheet both views represent.
 * @param obstacleComplex - The static obstacle, drawn from its face group.
 * @returns Both views plus the operations that keep them coordinated.
 */
export function createSheetViews(
  hosts: { perspective: HTMLElement; coordinate: HTMLElement },
  sheetComplex: CellComplex,
  obstacleComplex: CellComplex
): SheetViews {
  const perspective = createView({
    key: 'perspective',
    host: hosts.perspective,
    projection: new PerspectiveProjection({ fromDim: 4, viewDistance: 7 }),
    distance: 5.5
  }, sheetComplex, obstacleComplex);

  const coordinate = createView({
    key: 'coordinate',
    host: hosts.coordinate,
    // X, W, Y: the axis the perspective map spends is the one this shows.
    projection: new CoordinateProjection({ fromDim: 4, axes: [0, 3, 1] }),
    distance: 5.5
  }, sheetComplex, obstacleComplex);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const all = [perspective, coordinate];

  const refresh = (): void => {
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let vertex = 0; vertex < sheetComplex.vertexCount; vertex++) {
      const w = sheetComplex.positions[vertex * sheetComplex.ambientDim + 3] ?? 0;
      low = Math.min(low, w);
      high = Math.max(high, w);
    }
    for (const entry of all) {
      entry.view.sheet.update();
      entry.view.obstacle.update();
      refreshWColour(entry.view.sheet, entry.colour, sheetComplex, low, high);
    }
  };

  const showSelection = (vertices: readonly number[] | null): void => {
    for (const entry of all) {
      const outline = entry.view.selectionOutline;
      const fill = entry.view.selectionFill;
      if (vertices === null || vertices.length !== 3) {
        outline.visible = false;
        fill.visible = false;
        continue;
      }
      const attribute = outline.geometry.getAttribute('position') as BufferAttribute;
      // Three edges of the source triangle, projected through this view's map.
      const projected = vertices.map((vertex) => {
        const point: number[] = [];
        for (let axis = 0; axis < sheetComplex.ambientDim; axis++) {
          point.push(sheetComplex.positions[vertex * sheetComplex.ambientDim + axis] ?? 0);
        }
        return entry.view.sheet.projection.projectPoint(point);
      });
      const edges: [number, number][] = [[0, 1], [1, 2], [2, 0]];
      edges.forEach(([from, to], index) => {
        const a = projected[from]!;
        const b = projected[to]!;
        attribute.setXYZ(index * 2, a[0], a[1], a[2]);
        attribute.setXYZ(index * 2 + 1, b[0], b[1], b[2]);
      });
      attribute.needsUpdate = true;
      outline.geometry.computeBoundingSphere();
      outline.visible = true;

      const fillAttribute = fill.geometry.getAttribute('position') as BufferAttribute;
      projected.forEach((corner, index) => {
        fillAttribute.setXYZ(index, corner[0], corner[1], corner[2]);
      });
      fillAttribute.needsUpdate = true;
      fill.geometry.computeBoundingSphere();
      fill.visible = true;
    }
  };

  refresh();

  return {
    perspective: perspective.view,
    coordinate: coordinate.view,
    refresh,
    showSelection,
    render: () => { for (const entry of all) entry.view.render(); },
    resize: () => { for (const entry of all) entry.view.resize(); },
    resetCameras: () => { for (const entry of all) entry.view.resetCamera(); },
    pick: (view, event) => {
      const bounds = view.renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, view.camera);
      const hits = raycaster.intersectObject(view.sheet.object as Mesh, false);
      const first = hits[0];
      return first === undefined
        ? null
        : { surface: view.sheet, intersection: first };
    },
    dispose: () => { for (const entry of all) entry.view.dispose(); }
  };
}
