import { CellComplex, type CellGroup } from '@holotope/core';
import {
  XpbdWorldN,
  compileSimplexConstitutiveFamilyN,
  compileXpbdParticleBindingN,
  compileXpbdParticleSourceSimplexBarrierFamilyN,
  compileXpbdSourceSimplexAabbHierarchyN,
  compileXpbdSourceSimplexCosineBendingFamilyN,
  simplexStVenantKirchhoffLawN,
  stepXpbdIncrementalPotentialWorldN,
  type XpbdIncrementalPotentialStepAppliedN,
  type XpbdParticleSourceSimplexBarrierFamilyEvaluationN,
  type XpbdSourceSimplexCosineBendingFamilyEvaluationN
} from '@holotope/physics';

/**
 * One R4 triangular sheet, its finite static obstacle, and the mechanics that
 * evolve them.
 *
 * This module owns the physics and the source geometry, and nothing else. It
 * imports no renderer, so the same construction the page draws is the one a
 * headless test advances — a page cannot drift from the system it claims to be
 * showing if there is only one of them.
 *
 * The sheet carries two independent stiffnesses. Intrinsic stretch resists
 * deforming each triangle and is supplied by a shipped RN constitutive family.
 * Extrinsic **discrete cosine-fold bending** resists folding *between* adjacent
 * triangles, which an intrinsic metric cannot see: a sheet creased along an
 * edge has every triangle undeformed.
 *
 * That bending term is a discrete stiffness, **not a shell model**. Its
 * coordinate is the unsigned cosine of the fold from flat, so a quadratic
 * energy in that coordinate is quartic in the fold angle — it does not converge
 * to a continuum bending energy under mesh refinement, and the stiffness below
 * belongs to this mesh rather than to a material.
 */

/** How the contact search is organized. It never changes the physical answer. */
export type CandidateSearch = 'exhaustive' | 'static-hierarchy';

/** Construction parameters for one sheet scene. */
export interface SheetSceneOptions {
  /** Vertices per side of the triangulated sheet. */
  readonly resolution: number;
  /** Static obstacle tetrahedra, laid out on a square lattice. */
  readonly tiles: number;
  /**
   * Broadphase organization. `'static-hierarchy'` compiles an AABB tree over
   * the unmoving obstacle; both settings retain the same ordered candidates and
   * produce the same trajectory.
   */
  readonly search: CandidateSearch;
  /** Distinguishes identifiers when more than one scene exists at once. */
  readonly id: string;
  /** Obstacle construction and which of its triangles are drawn. */
  readonly obstacleShape?: ObstacleShape;
}

/** A compiled scene: one source, one world, and the families acting on it. */
export interface SheetScene {
  readonly options: SheetSceneOptions;
  readonly world: XpbdWorldN;
  readonly binding: ReturnType<typeof compileXpbdParticleBindingN>;
  readonly material: ReturnType<typeof compileSimplexConstitutiveFamilyN>;
  readonly bending: ReturnType<typeof compileXpbdSourceSimplexCosineBendingFamilyN>;
  readonly contact: ReturnType<typeof compileXpbdParticleSourceSimplexBarrierFamilyN>;
  /** The authoritative R4 sheet. Both views are derived from this. */
  readonly sheet: CellComplex;
  readonly sheetGroup: CellGroup;
  /** The separate static R4 obstacle. */
  readonly obstacle: CellComplex;
  /** The obstacle's 3-cell group, which contact indexes. */
  readonly obstacleGroup: CellGroup;
  /** Source vertices held fixed, so the sheet deforms instead of translating. */
  readonly fixedVertices: readonly number[];
}

/** What one advance reveals, curated for display. */
export interface SheetStepReport {
  /** `'applied'` when the step advanced the sheet; otherwise a typed refusal. */
  readonly status: string;
  /** Classified condition behind that status. */
  readonly condition: string;
  /** Refusal reason, or `null` when the step applied. */
  readonly refusalReason: string | null;
  /** Accepted minimizer iterations for this step. */
  readonly acceptedIterations: number;
  /** Energy resisting deformation within triangles. */
  readonly intrinsicEnergy: number;
  /** Energy resisting the fold between adjacent triangles. */
  readonly bendingEnergy: number;
  /** Energy of the exactly active contact barriers. */
  readonly contactEnergy: number;
  readonly totalPotential: number;
  /** Every sheet-vertex/obstacle-cell pair that exists. */
  readonly possiblePairs: number;
  /** Pairs the broadphase kept for exact evaluation. Not contacts. */
  readonly retainedPairs: number;
  /** Pairs whose exact distance is inside the activation distance. */
  readonly activeBarriers: number;
  /** Individual obstacle bounds the tree tested, or `null` when exhaustive. */
  readonly hierarchyBoundTests: number | null;
  readonly hingeCount: number;
  readonly elementCount: number;
  /** Smallest fold height seen; small means an ill-conditioned hinge. */
  readonly minimumConormalHeight: number;
  /** Range of the hidden coordinate across the sheet. */
  readonly wRange: readonly [number, number];
  /**
   * Accumulated barrier force per bound source vertex, in source order.
   *
   * The contact model constrains vertices, not the surface between them, and
   * these are the only forces it produces. Their *direction* is the diagnostic
   * worth reading: a support pushes along the surface normal, while a sum of
   * per-cell barriers generally does not.
   */
  readonly contactForces: readonly SheetContactForce[];
  /**
   * Which state these energies and populations describe.
   *
   * `'applied-iterate'` reuses the evaluations the solver already made at the
   * state it applied. `'unchanged-live-state'` means the step was refused, so
   * nothing was applied and this is the live state the page is still sitting
   * on — not a state anything moved to.
   */
  readonly diagnosticsSource: 'applied-iterate' | 'unchanged-live-state';
}

/** A per-vertex barrier force, as the physics package returns it. */
export interface SheetContactForce {
  readonly data: Float64Array;
}

const CREASE = 0.35;
const START_W = 0.9;
const START_VELOCITY_W = -1.6;
/**
 * The sheet's extent, which does not depend on its resolution.
 *
 * Raising the resolution is mesh *refinement*: more elements over the same
 * patch of R4. Deriving the spacing from a fixed span rather than fixing the
 * spacing is what makes that true — the alternative grows the sheet, so a
 * refined run would be a differently sized scene wandering out of frame and off
 * an obstacle that had not moved.
 */
const SHEET_WIDTH = 2.4;
const SHEET_DEPTH = 1.8;
/**
 * The one authoritative simulated timestep for this page.
 *
 * The physics advances by exactly this much per applied step and the inspector
 * reports simulated time from it. Declaring it twice is how a panel ends up
 * quietly describing a different simulation than the one running.
 */
export const SHEET_TIME_STEP = 1 / 240;

/**
 * A triangulated 2-manifold sheet in R4, creased along one interior row.
 *
 * The spacing is deliberately unequal on the two axes. An anisotropic sheet
 * cannot be satisfied by a frozen path or a uniform rescale, so a differential
 * comparing two runs is comparing something.
 */
function sheetPatch(resolution: number): {
  complex: CellComplex;
  group: CellGroup;
} {
  const positions: number[] = [];
  const creaseRow = Math.floor(resolution / 2);
  // Spacing follows from the span, so every resolution covers the same patch.
  const columnSpacing = SHEET_WIDTH / (resolution - 1);
  const rowSpacing = SHEET_DEPTH / (resolution - 1);
  for (let row = 0; row < resolution; row++) {
    for (let column = 0; column < resolution; column++) {
      positions.push(
        column * columnSpacing,
        row * rowSpacing,
        row === creaseRow ? CREASE : 0,
        START_W
      );
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < resolution - 1; row++) {
    for (let column = 0; column < resolution - 1; column++) {
      const at = row * resolution + column;
      // One fixed diagonal per quad, so the triangulation is deterministic.
      indices.push(at, at + 1, at + resolution);
      indices.push(at + 1, at + resolution + 1, at + resolution);
    }
  }
  const complex = new CellComplex(4, Float64Array.from(positions), [{
    key: 'sheet', dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from(indices)
  }]);
  const [group] = complex.cellsOfDim(2);
  if (group === undefined) throw new Error('sheetPatch: no 2-cells');
  return { complex, group };
}

/**
 * How the static obstacle is built and which of its triangles are drawn.
 *
 * Only the boundary variant draws exactly the faces that bound the solid. A
 * tetrahedralization's interior faces are shared by two cells and are not part
 * of the object's surface; drawing them makes a solid look like a pile of
 * shells.
 */
export type ObstacleShape =
  | 'separate-tetrahedra'
  | 'connected-all-faces'
  | 'connected-boundary';

/** Boxes across and along the slab before Kuhn decomposition. */
const SLAB_COLUMNS = 1;
const SLAB_ROWS = 1;

/** Kuhn decomposition of one axis-aligned box into six tetrahedra. */
const KUHN: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 3, 7], [0, 1, 5, 7], [0, 4, 5, 7],
  [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 6, 7]
];

/** The eight corners of a unit box, as (x, y, z) bit patterns. */
const BOX_CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]
];

/** Faces of one tetrahedron, as vertex-index triples into its own four. */
const TET_FACES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]
];

/**
 * The finite static obstacle the sheet rests on, in the `w = 0` hyperplane.
 *
 * Contact indexes the 3-cell group. The 2-cell group exists only so a surface
 * render product has real triangles to draw, and which triangles those are is
 * the whole legibility question — see {@link ObstacleShape}.
 */
function obstaclePatch(tiles: number, shape: ObstacleShape): {
  complex: CellComplex;
  group: CellGroup;
} {
  const positions: number[] = [];
  const cells: number[][] = [];

  if (shape === 'separate-tetrahedra') {
    // Nine unconnected tetrahedra, each with its own four vertices.
    const perSide = Math.max(1, Math.ceil(Math.sqrt(tiles)));
    const spacing = 1.1;
    for (let tile = 0; tile < tiles; tile++) {
      const originX = (tile % perSide) * spacing;
      const originY = Math.floor(tile / perSide) * spacing;
      const base = tile * 4;
      positions.push(
        originX, originY, 0, 0,
        originX + 0.9, originY, 0, 0,
        originX, originY + 0.9, 0, 0,
        originX, originY, 0.9, 0
      );
      cells.push([base, base + 1, base + 2, base + 3]);
    }
  } else {
    // One connected slab under the sheet's footprint, shallow in z, built from
    // shared vertices so neighbouring cells are genuinely adjacent.
    // Coarse on purpose. Contact cost scales with cell count, and a solid
    // reads as a solid from its silhouette, not from its subdivision — a finer
    // slab would buy nothing visible while multiplying the pair population.
    const nx = SLAB_COLUMNS;
    const ny = SLAB_ROWS;
    const width = 2.9;
    const depth = 2.2;
    // The slab must span the z range the sheet actually occupies, or the
    // creased row has no solid beneath it and falls past the obstacle.
    const zLow = 0;
    const zHigh = 0.9;
    const index = (i: number, j: number, k: number): number =>
      (k * (ny + 1) + j) * (nx + 1) + i;
    for (let k = 0; k <= 1; k++) {
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          positions.push(
            -0.35 + (i / nx) * width,
            -0.3 + (j / ny) * depth,
            zLow + k * (zHigh - zLow),
            0
          );
        }
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const corner = BOX_CORNERS.map(([dx, dy, dz]) =>
          index(i + dx, j + dy, dz));
        for (const tet of KUHN) {
          cells.push(tet.map((slot) => corner[slot]!));
        }
      }
    }
  }

  // Faces: every face of every cell, or only those bounding the solid.
  const faces: number[] = [];
  if (shape === 'connected-boundary') {
    const incidence = new Map<string, number[][]>();
    for (const cell of cells) {
      for (const face of TET_FACES) {
        const vertices = face.map((slot) => cell[slot]!);
        const key = [...vertices].sort((a, b) => a - b).join(',');
        const existing = incidence.get(key);
        if (existing === undefined) incidence.set(key, [vertices]);
        else existing.push(vertices);
      }
    }
    // A face shared by two cells is interior; the surface is what is left.
    for (const [, owners] of incidence) {
      if (owners.length !== 1) continue;
      faces.push(...owners[0]!);
    }
  } else {
    for (const cell of cells) {
      for (const face of TET_FACES) {
        faces.push(...face.map((slot) => cell[slot]!));
      }
    }
  }

  const complex = new CellComplex(4, Float64Array.from(positions), [
    {
      key: 'obstacle', dim: 3, verticesPerCell: 4, kind: 'simplex',
      indices: Uint32Array.from(cells.flat())
    },
    {
      key: 'obstacle-faces', dim: 2, verticesPerCell: 3, kind: 'simplex',
      indices: Uint32Array.from(faces)
    }
  ]);
  const [group] = complex.cellsOfDim(3);
  if (group === undefined) throw new Error('obstaclePatch: no 3-cells');
  return { complex, group };
}

/**
 * Compiles one complete sheet scene.
 *
 * Every rest-state provider is compiled *before* the initial velocity is
 * imposed, so each family's rest shape is the authored geometry rather than
 * whatever the first step happened to produce.
 *
 * @param options - Sheet resolution, obstacle size, broadphase organization,
 * and an identifier prefix.
 * @returns The world, its families, and the source complexes the views read.
 *
 * @example
 * ```ts
 * const scene = buildSheetScene({
 *   resolution: 5, tiles: 9, search: 'exhaustive', id: 'sheet'
 * });
 * const report = stepSheetScene(scene);
 * log(report.status, report.activeBarriers);
 * ```
 */
export function buildSheetScene(options: SheetSceneOptions): SheetScene {
  const sheet = sheetPatch(options.resolution);
  const obstacle = obstaclePatch(
    options.tiles, options.obstacleShape ?? 'connected-boundary'
  );

  // The two far corners of the first row: the smallest set that stops the sheet
  // translating away instead of deforming against the obstacle.
  const fixedVertices = [0, options.resolution - 1];
  const binding = compileXpbdParticleBindingN({
    id: `${options.id}-points`,
    source: sheet.complex,
    fixed: ({ sourceVertexIndex }) => fixedVertices.includes(sourceVertexIndex)
  });

  const material = compileSimplexConstitutiveFamilyN({
    id: `${options.id}-stretch`,
    source: sheet.complex,
    simplexGroup: sheet.group,
    particles: binding.particles,
    law: simplexStVenantKirchhoffLawN,
    material: { firstLameParameter: 1.5, shearModulus: 2 }
  });

  const bending = compileXpbdSourceSimplexCosineBendingFamilyN({
    id: `${options.id}-bend`,
    binding,
    simplexGroup: sheet.group,
    // Discretization-dependent, not a material constant.
    stiffness: 8,
    restCoordinate: 1,
    minimumMeasureRatio: 0.05
  });

  const contact = compileXpbdParticleSourceSimplexBarrierFamilyN({
    id: `${options.id}-contact`,
    binding,
    obstacle: obstacle.complex,
    simplexGroup: obstacle.group,
    minimumDistance: 0.04,
    activationDistance: 1.2,
    stiffness: 3,
    ...(options.search === 'static-hierarchy'
      ? {
        candidateHierarchy: compileXpbdSourceSimplexAabbHierarchyN({
          obstacle: obstacle.complex, simplexGroup: obstacle.group, leafSize: 2
        })
      }
      : {})
  });

  // Only now, after every rest state has been captured.
  for (const particle of binding.particles) {
    particle.velocity.data[3] = START_VELOCITY_W;
  }

  const world = new XpbdWorldN({ dimension: 4, gravity: [0, 0, 0, -9.81] });
  binding.addToWorld(world);
  material.addToWorld(world);
  bending.addToWorld(world);
  contact.addToWorld(world);

  return {
    options,
    world,
    binding,
    material,
    bending,
    contact,
    sheet: sheet.complex,
    sheetGroup: sheet.group,
    obstacle: obstacle.complex,
    obstacleGroup: obstacle.group,
    fixedVertices
  };
}

/**
 * Advances one scene by a single fixed step and reads what it reveals.
 *
 * Both step filters travel with their providers: the fold filter certifies that
 * no triangle collapses mid-search, and the contact filter certifies the
 * admissible prefix of the search segment. Passing either provider without its
 * filter would leave the segment uncertified.
 *
 * After an applied step the particle positions are written back to the sheet
 * source, so both views redraw from the same authoritative R4 state.
 *
 * @param scene - The scene to advance.
 * @returns The curated report for this step.
 */
export function stepSheetScene(scene: SheetScene): SheetStepReport {
  const advance = stepXpbdIncrementalPotentialWorldN({
    world: scene.world,
    deltaTime: SHEET_TIME_STEP,
    stepFilters: [scene.bending.stepFilter, scene.contact.stepFilter],
    warmStart: 'feasible-inertial-prediction',
    minimization: { directionPolicy: 'steepest-descent' }
  });
  scene.binding.writeSourcePositions();

  // An applied step already evaluated every provider at the iterate it
  // applied, and those evaluations are retained on the result. Calling
  // `evaluate()` again here would repeat the most expensive work in the step
  // to learn something the solver just computed.
  //
  // A refused step applied nothing, so its final iterate is a state the sheet
  // never reached. Reporting it would describe motion that did not happen, so
  // the live — unchanged — state is evaluated instead and labelled as such.
  const step = advance.step;
  const reused = step.status === 'applied'
    ? readAppliedProviderEvaluations(scene, step)
    : null;
  const material = reused?.material ?? scene.material.evaluate();
  const bending = reused?.bending ?? scene.bending.evaluate();
  const contact = reused?.contact ?? scene.contact.evaluate();
  const diagnostics = contact.candidateQuery.diagnostics;

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const particle of scene.binding.particles) {
    const w = particle.position.data[3] ?? 0;
    low = Math.min(low, w);
    high = Math.max(high, w);
  }

  return {
    status: advance.step.status,
    condition: advance.diagnosis.condition,
    refusalReason: advance.step.status === 'refused' ? advance.step.reason : null,
    acceptedIterations: advance.step.progress.acceptedIterations,
    intrinsicEnergy: material.potentialEnergy,
    bendingEnergy: bending.potentialEnergy,
    contactEnergy: contact.potentialEnergy,
    totalPotential: material.potentialEnergy + bending.potentialEnergy +
      contact.potentialEnergy,
    possiblePairs: diagnostics.possiblePairs,
    retainedPairs: diagnostics.candidatePairs,
    activeBarriers: contact.activeCandidates.length,
    hierarchyBoundTests: diagnostics.hierarchy?.testedSimplexBounds ?? null,
    hingeCount: bending.hingeCount,
    elementCount: scene.material.elements.length,
    minimumConormalHeight: bending.minimumConormalHeight,
    wRange: [low, high],
    contactForces: contact.forces,
    diagnosticsSource: reused === null ? 'unchanged-live-state' : 'applied-iterate'
  };
}

/**
 * The provider evaluations the applied step already made, by identity.
 *
 * Returns `null` rather than guessing if the retained set does not contain all
 * three: a diagnostic that silently describes two providers out of three would
 * be worse than paying for a fresh evaluation.
 */
function readAppliedProviderEvaluations(
  scene: SheetScene,
  step: XpbdIncrementalPotentialStepAppliedN
): {
  material: { readonly potentialEnergy: number };
  bending: XpbdSourceSimplexCosineBendingFamilyEvaluationN;
  contact: XpbdParticleSourceSimplexBarrierFamilyEvaluationN;
} | null {
  const results = step.minimization.final.evaluation.potential.providers;
  const find = (provider: unknown): unknown => results
    .find((entry: { provider: unknown; evaluation: unknown }) =>
      entry.provider === provider)?.evaluation;
  const material = find(scene.material);
  const bending = find(scene.bending);
  const contact = find(scene.contact);
  if (material === undefined || bending === undefined || contact === undefined) {
    return null;
  }
  // Each family's `evaluateAt` returns its own rich evaluation, which is what
  // the solver retained; the provider seam only narrows it to the common
  // energy-and-forces shape.
  return {
    material: material as { readonly potentialEnergy: number },
    bending: bending as XpbdSourceSimplexCosineBendingFamilyEvaluationN,
    contact: contact as XpbdParticleSourceSimplexBarrierFamilyEvaluationN
  };
}

/**
 * Whether a report is a typed refusal rather than an applied step.
 *
 * A refusal leaves the state exactly as it was, so the next step re-solves the
 * same configuration and refuses again for the same reason. Re-attempting it is
 * therefore not retrying — nothing has changed for a retry to act on — and it
 * is not cheap either: a refused `iteration-limit` step costs several times an
 * applied one, because it exhausts the iteration budget before giving up.
 *
 * The page pauses on this rather than spinning. Exported as a predicate so the
 * rule is testable without a browser.
 */
export function isRefusedReport(report: SheetStepReport): boolean {
  return report.status !== 'applied';
}

/** Ordered contact-candidate identities, for comparing two search settings. */
export function candidateIdentities(scene: SheetScene): readonly string[] {
  const prefix = `${scene.options.id}-contact/`;
  return scene.contact
    .evaluate()
    .candidateQuery.candidates.map((candidate) => candidate.id.slice(prefix.length));
}

/** The sheet's source coordinates, for comparing two runs exactly. */
export function sourceDigest(scene: SheetScene): string {
  return Array.from(scene.sheet.positions)
    .map((value) => value.toExponential(17))
    .join(',');
}
