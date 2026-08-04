import { Points, PointsMaterial, BufferAttribute, BufferGeometry, Color } from 'three';
import type { CellComplex, Projection } from '@holotope/core';
import type { SheetContactForce } from './scene.js';

/**
 * What contact actually constrains, drawn on top of what contact does not.
 *
 * The sheet is rendered as a continuous surface because it *is* one — its
 * triangles share edges and vertices in the source. The contact model is not
 * continuous: it is a particle–source-simplex barrier, so the only things it
 * ever holds are the **vertices**. Triangle interiors and edges carry no
 * contact term at all.
 *
 * Nothing in a shaded surface says that. This overlay puts a dot on each thing
 * the barrier can actually push, and colours it by what the barrier is doing to
 * it — which is how a reader can see that the obstacle is not a floor.
 *
 * The classification is read from the accumulated per-vertex barrier force, so
 * it follows the real physics rather than any assumption about the obstacle's
 * shape:
 *
 * - **held** — the force is essentially along the gravity axis. The vertex is
 *   being supported the way a floor would support it;
 * - **pushed aside** — a large share of the force is lateral. The obstacle is a
 *   sum of per-cell barriers, and away from the middle of a cell that sum does
 *   not point along the surface normal;
 * - **free** — no active barrier. Nothing is holding this vertex at all.
 */

/** Which axis gravity acts along, and therefore which force component supports. */
const SUPPORT_AXIS = 3;

/**
 * Lateral share above which a vertex counts as pushed aside rather than held.
 *
 * A true surface normal would give zero lateral force. This is deliberately
 * generous: a quarter of the force acting sideways is already the obstacle
 * behaving as something other than a support.
 */
const LATERAL_FRACTION = 0.25;

/** How the barrier is treating one vertex. */
export type ContactRole = 'held' | 'pushed-aside' | 'free';

const COLOURS: Record<ContactRole, number> = {
  held: 0x7ce7c0,
  'pushed-aside': 0xff8a5c,
  free: 0x4a5578
};

/** Classifies one accumulated barrier force. */
export function classifyContactForce(entry: SheetContactForce | undefined): {
  role: ContactRole; lateralFraction: number;
} {
  if (entry === undefined) return { role: 'free', lateralFraction: 0 };
  const force = entry.data;
  let lateralSquared = 0;
  for (let axis = 0; axis < 4; axis++) {
    if (axis === SUPPORT_AXIS) continue;
    const component = force[axis] ?? 0;
    lateralSquared += component * component;
  }
  const support = Math.abs(force[SUPPORT_AXIS] ?? 0);
  const lateral = Math.sqrt(lateralSquared);
  // A vertex with no force at all is free, not perfectly supported.
  if (support < 1e-12 && lateral < 1e-12) return { role: 'free', lateralFraction: 0 };
  const fraction = support < 1e-12 ? Infinity : lateral / support;
  return {
    role: fraction > LATERAL_FRACTION ? 'pushed-aside' : 'held',
    lateralFraction: fraction
  };
}

/** A points overlay bound to one view's projection. */
export interface ContactOverlay {
  readonly object: Points;
  /**
   * Reprojects and recolours from the current source and forces.
   *
   * Counting is the inspector's job, not this one's — it reads the same forces
   * and would otherwise be told the answer by a renderer.
   */
  update(forces: readonly SheetContactForce[]): void;
  visible: boolean;
  dispose(): void;
}

/**
 * Builds the contact-primitive overlay for one view.
 *
 * @param sheet - The source complex whose vertices contact constrains.
 * @param projection - The same R4 → R3 map the view's surfaces use.
 * @returns A points product to add to the view's scene.
 *
 * @example
 * ```ts
 * const overlay = createContactOverlay(scene.sheet, projection);
 * view.scene.add(overlay.object);
 * overlay.update(scene.contact.evaluate().forces);
 * ```
 */
export function createContactOverlay(
  sheet: CellComplex,
  projection: Projection
): ContactOverlay {
  const count = sheet.vertexCount;
  const positions = new BufferAttribute(new Float32Array(count * 3), 3);
  const colours = new BufferAttribute(new Float32Array(count * 3), 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setAttribute('color', colours);

  const object = new Points(geometry, new PointsMaterial({
    size: 6, sizeAttenuation: false, vertexColors: true,
    // Contact primitives are the point of the overlay, so they are drawn
    // through the surface they belong to rather than hidden inside its folds.
    depthTest: false, transparent: true, opacity: 0.95
  }));
  object.renderOrder = 4;
  object.visible = false;
  // The source moves every step, so a sphere from construction would cull it.
  object.frustumCulled = false;

  const scratch = new Color();

  return {
    object,
    get visible() { return object.visible; },
    set visible(value: boolean) { object.visible = value; },
    update(forces) {
      projection.projectPositions(
        sheet.positions, count, positions.array as Float32Array
      );
      positions.needsUpdate = true;

      for (let vertex = 0; vertex < count; vertex++) {
        const { role } = classifyContactForce(forces[vertex]);
        scratch.setHex(COLOURS[role]);
        colours.setXYZ(vertex, scratch.r, scratch.g, scratch.b);
      }
      colours.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      object.material.dispose();
    }
  };
}
