/**
 * Fixed draw order for the solid view, and why it has to be fixed.
 *
 * The first build of this scene drew a translucent cube and a translucent
 * cutting plane with no explicit order. three.js sorts transparent objects
 * back-to-front by the view depth of each object's ORIGIN. The cube's origin is
 * pinned at the centre and the plane's rides along the normal, so at offset
 * zero the two coincided and the painter's order flipped:
 *
 *   offset <= -0.001   plane, cube
 *   offset >=  0       cube, plane
 *
 * The blend changed with it, so the shading jumped at exactly the offset where
 * nothing geometric happens — the section is a hexagon on both sides of zero
 * and its side count changes only at ±1/√3. Measured: mean frame colour moved
 * 0.37 across −0.001 → 0 while every neighbouring step moved 0.01–0.05.
 *
 * The correction was not to sort more carefully but to stop having a
 * transparent pair. The cutting plane is drawn as opaque lines — an outline and
 * a sparse grid — and the cut itself as an opaque mesh of the section's own
 * triangles, leaving exactly one transparent object in the scene. These
 * constants are therefore constants: nothing about the order depends on where
 * the plane is.
 */
export const DRAW_ORDER = {
  /** The cut, opaque, drawn with the rest of the opaque pass. */
  section: 0,
  /** The plane's outline and grid, opaque lines. */
  planeFrame: 0,
  /** The cube's wireframe, opaque lines. */
  cubeEdges: 0,
  /** The only transparent object in the scene, and therefore drawn last. */
  cubeFaces: 10
} as const;

/** How many transparent objects the solid view is allowed to contain. */
export const TRANSPARENT_OBJECT_BUDGET = 1;
