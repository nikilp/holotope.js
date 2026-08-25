import { BufferAttribute, BufferGeometry } from 'three';
import type { TesseractSection } from './tesseract.js';

/**
 * Geometry helpers shared by the three scenes, kept out of the page.
 *
 * Each scene draws the same two things — a solid and the flat thing derived
 * from it — so the derivations live here and the page only positions them.
 */

/** The three scenes, in the order they teach. */
export const SCENES = [
  { id: 'section', label: 'Section forgets' },
  { id: 'projection', label: 'Projection overlaps' },
  { id: 'tesseract', label: 'One rung up' }
] as const;

export type SceneId = (typeof SCENES)[number]['id'];

/** Reads a scene id out of the location hash, defaulting to the first. */
export function sceneFromHash(hash: string): SceneId {
  const wanted = hash.replace('#', '');
  const found = SCENES.find((scene) => scene.id === wanted);
  return found?.id ?? 'section';
}

/**
 * Boundary faces of a solid section: the triangles exactly one cell claims.
 *
 * A tesseract's 3D section arrives as tetrahedra, and drawing all of their
 * faces would fill the view with interior walls the section does not have.
 * Only faces bounding the region are its surface — the same rule scene 3 uses
 * to find a polygon's outline, one dimension up.
 */
export function sectionBoundaryFaces(section: TesseractSection): BufferGeometry {
  const cells = section.result.cells;
  const chart = section.result.chartPositions;
  const uses = new Map<string, { face: number[]; count: number }>();
  const FACES = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];
  for (let cell = 0; cell < section.cellCount; cell++) {
    for (const face of FACES) {
      const vertices = face.map((slot) => cells[cell * 4 + slot]!);
      const key = [...vertices].sort((a, b) => a - b).join(',');
      const entry = uses.get(key);
      if (entry === undefined) uses.set(key, { face: vertices, count: 1 });
      else entry.count += 1;
    }
  }
  const points: number[] = [];
  for (const { face, count } of uses.values()) {
    if (count !== 1) continue;
    for (const vertex of face) {
      points.push(
        chart[vertex * 3]!, chart[vertex * 3 + 1]!, chart[vertex * 3 + 2]!
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(points), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Line geometry for a set of positions joined by index pairs. */
export function edgeGeometry(
  points: readonly (readonly number[])[],
  edges: readonly (readonly [number, number])[]
): BufferGeometry {
  const data = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], index) => {
    for (let axis = 0; axis < 3; axis++) {
      data[index * 6 + axis] = points[a]![axis] ?? 0;
      data[index * 6 + 3 + axis] = points[b]![axis] ?? 0;
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data, 3));
  return geometry;
}

/** Lifts 2D chart points into the plane's own 3D frame, for the solid view. */
export function chartToAmbient(
  points: readonly (readonly [number, number])[],
  u: readonly number[],
  v: readonly number[]
): number[][] {
  return points.map(([a, b]) => [
    a * u[0]! + b * v[0]!, a * u[1]! + b * v[1]!, a * u[2]! + b * v[2]!
  ]);
}

/**
 * What the stage must look like in each scene, as data rather than as prose.
 *
 * The defect this exists to prevent: `showScene` used to install a destination
 * without fully clearing the one before, so arriving at scene 4 or 6 straight
 * from the opening quiz left the quiz's layout in place and the stage rendered
 * wrongly or not at all. A transition is only correct if the resulting stage
 * matches this table no matter which state it came from, so the table is the
 * test's oracle and the page's contract at once.
 */
export interface StageExpectation {
  /** Panes visible: both, or only the solid one. */
  readonly panes: 'both';
  /** What occupies the right pane. */
  readonly right: 'svg' | 'view3d';
  readonly scrubVisible: boolean;
  readonly hiddenVisible: boolean;
  /** Layout classes that must NOT be left set. */
  readonly forbiddenClasses: readonly string[];
}

export const STAGE: Record<SceneId, StageExpectation> = {
  section: {
    panes: 'both', right: 'svg', scrubVisible: true, hiddenVisible: false,
    forbiddenClasses: ['guessing', 'solo']
  },
  projection: {
    panes: 'both', right: 'svg', scrubVisible: false, hiddenVisible: false,
    forbiddenClasses: ['guessing', 'solo']
  },
  tesseract: {
    panes: 'both', right: 'view3d', scrubVisible: true, hiddenVisible: true,
    forbiddenClasses: ['guessing', 'solo']
  }
};

/** Every ordered scene-to-scene transition, plus each scene entered cold. */
export function allTransitions(): { from: SceneId | 'quiz'; to: SceneId }[] {
  const ids = SCENES.map((scene) => scene.id);
  const out: { from: SceneId | 'quiz'; to: SceneId }[] = [];
  for (const to of ids) out.push({ from: 'quiz', to });
  for (const from of ids) for (const to of ids) out.push({ from, to });
  return out;
}
