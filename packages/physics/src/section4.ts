import {
  CellComplex,
  type CellGroup,
  type HyperplaneSliceN,
  MatN,
  type SectionSimplexGroupNResultN,
  TransformN,
  VecN,
  createHyperrectangle,
  sectionSimplexGroupN,
  tetrahedralizeCuboidCells
} from '@holotope/core';
import { type MassProperties4, massPropertiesFromCellComplex4, massPropertiesOfHyperbox4 } from './mass-properties4.js';
import { RigidBody4 } from './rigid-body4.js';

/**
 * A uniform solid ball in R4, described the way {@link GlomeCollider4} is.
 *
 * A ball has no preferred axes, so nothing about its section depends on the
 * body's rotation; that invariance is a property of the shape rather than a
 * special case in the code.
 */
export interface GlomeSectionSource4 {
  /** Selects the ball family when the source is dispatched on. */
  readonly kind: 'glome';
  /** Radius in the body's own units. */
  readonly radius: number;
}

/**
 * A solid hyperbox in R4, described the way {@link HyperboxCollider4} is —
 * except that the half-extents are read **in the order they were authored**.
 *
 * A collider has to be handed its half-extents in the body's principal order,
 * because `RigidBody4.fromMassProperties` adopts the principal rotor as the
 * body's rotation. Nothing here asks that of a caller: the authored axes are
 * reconciled against the mass-property frame internally.
 */
export interface HyperboxSectionSource4 {
  /** Selects the box family when the source is dispatched on. */
  readonly kind: 'hyperbox';
  /** Positive half-extents in the caller's own axes, in any order. */
  readonly halfExtents: ArrayLike<number>;
  /**
   * The mass properties whose principal frame the body's rotation came from.
   *
   * Omit it and the frame is recomputed from the half-extents. That
   * recomputation is deterministic *and always canonical*: a box's covariance
   * is exactly diagonal, so the eigensolver performs no rotations and returns a
   * signed permutation every time. It therefore reproduces what
   * `RigidBody4.fromMassProperties` used — but only because that body was posed
   * from the same canonical frame.
   *
   * Supply this when the body's rotation came from somewhere else — a different
   * signed permutation of the box's axes, say. Only the frame the body actually
   * carries cancels against the pose.
   *
   * What is accepted is narrower than "any valid principal basis". A rotation
   * inside a degenerate inertia eigenspace is a valid inertia basis and is not
   * something a {@link HyperboxCollider4} at the default identity local
   * transform can follow, so a section taken in one would part company with the
   * collider sharing its body. Accepted frames are the signed permutations that
   * sort these half-extents; where extents tie, 90° turns of the tied pair are
   * among them and 45° turns are not. Express a source that needs an arbitrary
   * frame as a {@link ComplexSectionSource4}, whose authored coordinates carry
   * the geometry this record cannot.
   */
  readonly massProperties?: MassProperties4;
}

/**
 * An authored 4D complex, sectioned through its own tetrahedral cells.
 *
 * The complex is never mutated: the pose is applied into a private buffer, so
 * the authored positions remain the authority across any number of sections.
 */
export interface ComplexSectionSource4 {
  /** Selects the authored-complex family when the source is dispatched on. */
  readonly kind: 'complex';
  /** The authoritative source. Its positions are read, never written. */
  readonly complex: CellComplex;
  /**
   * Which tetrahedral group to section. Defaults to the first 3-dimensional
   * group with four vertices per cell.
   */
  readonly groupKey?: string;
  /**
   * The mass properties whose principal frame the body's rotation came from.
   *
   * Supply the same object that produced the body to skip re-integrating the
   * complex. Omit it and the frame is recomputed, which costs an integration
   * but cannot disagree with itself.
   */
  readonly massProperties?: MassProperties4;
}

/** Any source this composition path can section. */
export type SectionSource4 =
  | GlomeSectionSource4
  | HyperboxSectionSource4
  | ComplexSectionSource4;

/**
 * Where a section came from, in the caller's own terms.
 *
 * The authored source is retained by reference rather than summarized, so a
 * consumer can answer "which object is this?" without an identifier anyone had
 * to invent. Renderer-side ids are a consumer's business and never appear here.
 */
export interface SectionProvenance4 {
  /** The authored source, exactly as it was passed in. */
  readonly source: SectionSource4;
  /** The world pose the section was taken at. */
  readonly pose: TransformN;
  /** The hyperplane and chart the section is expressed in. */
  readonly slice: HyperplaneSliceN;
  /**
   * The composed authored-source-to-world map that was applied, once.
   *
   * For a hyperbox and a complex this is `pose ∘ (source → centred principal)`;
   * for a glome it is the pose itself. Applying it to an authored point
   * reproduces the world point the section was computed from.
   */
  readonly worldFromSource: TransformN;
}

/**
 * The hyperplane misses the source entirely.
 *
 * Nothing but the provenance comes back, because there is no geometry to
 * describe. How far away the source is, and on which side, is recoverable from
 * `provenance.worldFromSource` and the slice.
 */
export interface EmptySection4 {
  /** Narrows a {@link Section4} to the case where nothing was intersected. */
  readonly status: 'empty';
  /** The source, pose and hyperplane that produced this answer. */
  readonly provenance: SectionProvenance4;
}

/**
 * The hyperplane touches the source in a set with no volume in the chart — a
 * single point, or an edge — so there is a contact but no solid to draw.
 */
export interface TangentSection4 {
  /** Narrows a {@link Section4} to the case where contact has no volume. */
  readonly status: 'tangent';
  /** The source, pose and hyperplane that produced this answer. */
  readonly provenance: SectionProvenance4;
  /** Packed R3 chart coordinates of the touched points. */
  readonly chartPositions: Float64Array;
}

/** A glome's section: a 3-ball, exactly. */
export interface BallSection4 {
  /** Narrows a {@link Section4} to a glome's exact 3-ball section. */
  readonly status: 'ball';
  /** The source, pose and hyperplane that produced this answer. */
  readonly provenance: SectionProvenance4;
  /** Centre of the section ball, in R3 chart coordinates. */
  readonly chartCenter: Float64Array;
  /** Radius of the section ball. */
  readonly radius: number;
  /** Signed distance from the hyperplane to the glome's world centre. */
  readonly signedDistance: number;
}

/**
 * A polyhedral section: the triangulated surface of the 3D solid, with the
 * source lineage the released section machinery already carries.
 */
export interface PolyhedralSection4 {
  /** Narrows a {@link Section4} to a section with a drawable surface. */
  readonly status: 'polyhedral';
  /** The source, pose and hyperplane that produced this answer. */
  readonly provenance: SectionProvenance4;
  /**
   * The released section result: chart positions, cells, `parentCells` naming
   * the contributing source cell of each primitive, and `lineage` naming the
   * source vertices and barycentric weights behind each section vertex.
   */
  readonly section: SectionSimplexGroupNResultN;
}

/** Every shape a section of an R4 source can take. */
export type Section4 =
  | EmptySection4
  | TangentSection4
  | BallSection4
  | PolyhedralSection4;

/** How to place a source in the world and where to cut it. */
export interface Section4Options {
  /** The hyperplane and the R3 chart the result is expressed in. */
  readonly slice: HyperplaneSliceN;
  /** The body whose current pose places the source. Mutually exclusive with `pose`. */
  readonly body?: RigidBody4;
  /**
   * An explicit pose, for sources no rigid body carries.
   *
   * This stands in for a body's pose, so it maps the source's **centred
   * principal frame** into the world — not the authored frame. The identity
   * therefore places a box in its principal axes (half-extents ascending) and
   * moves an off-centre complex onto the origin, exactly as an unpositioned
   * body would. To place an authored box in its own axes, pass its
   * `principalRotor` as the rotation — or use a body, which carries it already.
   */
  readonly pose?: TransformN;
  /**
   * Classification tolerance, as an absolute world length. Default `1e-9`.
   *
   * On a box or a complex it is a distance from the hyperplane: a vertex within
   * `epsilon` of the plane counts as lying on it. On a glome it is applied to
   * the grazing depth `|d| − r` instead, which makes the band asymmetric in the
   * section's own radius — a ball is called tangent while its section radius is
   * still up to about `√(2rε)`, so at `r = 1.3` and the default that is a
   * section of radius 1.6e-5 rather than of 1e-9.
   *
   * Because it is absolute rather than relative, a source authored at a very
   * large or very small scale should set it.
   */
  readonly epsilon?: number;
}

function resolvePose(options: Section4Options, caller: string): TransformN {
  const { body, pose } = options;
  if ((body === undefined) === (pose === undefined)) {
    throw new Error(`${caller}: pass exactly one of body or pose`);
  }
  if (pose !== undefined) {
    if (pose.dim !== 4) {
      throw new Error(`${caller}: pose is R${pose.dim}, expected R4`);
    }
    return pose.clone();
  }
  return new TransformN(4, body!.rotation.clone(), body!.position.clone());
}

function resolveSlice(options: Section4Options, caller: string): HyperplaneSliceN {
  const { slice } = options;
  if (slice === undefined) {
    throw new Error(`${caller}: slice is required`);
  }
  if (slice.ambientDim !== 4) {
    throw new Error(
      `${caller}: slice is in R${slice.ambientDim}, expected an R4 hyperplane`
    );
  }
  return slice;
}

function resolveEpsilon(options: Section4Options, caller: string): number {
  const epsilon = options.epsilon ?? 1e-9;
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new Error(`${caller}: epsilon must be finite and non-negative`);
  }
  return epsilon;
}

/**
 * Checks a supplied frame is a rotation at all.
 *
 * A frame that is not orthonormal, or that reflects, cannot be the principal
 * frame of anything, and composing one silently produces a sheared or mirrored
 * solid. Whether it belongs to *this* source is a different question, and one
 * only re-integration could answer — which is what supplying it exists to skip.
 */
function assertPrincipalFrame4(properties: MassProperties4, caller: string): void {
  const axes = properties.principalAxes;
  // Every test below is a `>` against a tolerance, and `NaN > x` is false — so
  // without this a frame of NaN passes each one and composes into a transform
  // that quietly reports an empty section instead of refusing.
  for (const entry of axes.data) {
    if (!Number.isFinite(entry)) {
      throw new Error(`${caller}: massProperties.principalAxes must be finite`);
    }
  }
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let dot = 0;
      for (let k = 0; k < 4; k++) dot += axes.get(k, row) * axes.get(k, col);
      if (Math.abs(dot - (row === col ? 1 : 0)) > 1e-9) {
        throw new Error(`${caller}: massProperties.principalAxes is not orthonormal`);
      }
    }
  }
  if (Math.abs(axes.determinant() - 1) > 1e-9) {
    throw new Error(`${caller}: massProperties.principalAxes must have determinant +1`);
  }
  for (const component of properties.centerOfMass.data) {
    if (!Number.isFinite(component)) {
      throw new Error(`${caller}: massProperties.centerOfMass must be finite`);
    }
  }
}

/**
 * Checks a supplied frame is one this analytic box can actually be posed by.
 *
 * A `MassProperties4` record proves an *inertia* equivalence, and inertia is
 * blind to two things the geometry is not. It is blind to translation: a record
 * carrying a centre of mass elsewhere has identical moments and would silently
 * place the box where it was never authored. And it is blind to any rotation
 * inside a degenerate eigenspace: when two extents tie, spinning that pair by
 * 45° leaves every moment untouched while turning the box into a different
 * solid.
 *
 * Moment ratios alone therefore cannot show a record "describes this box" —
 * they identify the inertia, not the geometry. What the analytic path needs is
 * stronger, and it is set by what a collider sharing the body can follow.
 * {@link HyperboxCollider4} does accept a `localTransform`, but nothing tells
 * this function about one, so the frames it can safely accept are those a
 * collider at the default identity local transform still agrees with: the
 * signed permutations that sort these half-extents.
 *
 * That set is a change of basis, not a symmetry group — for unsorted extents
 * the permutation maps the authored box onto a differently-shaped one. Where
 * extents tie, several such permutations exist, and *those* differ from each
 * other by symmetries of the box: a 90° turn of a tied pair is one, a 45° turn
 * is not and is refused.
 *
 * A caller who genuinely needs an arbitrary frame has authored coordinates to
 * express it in and should pass a {@link ComplexSectionSource4}, which carries
 * the geometry this record cannot.
 */
function assertBoxFrame4(
  properties: MassProperties4,
  half: ArrayLike<number>,
  caller: string
): void {
  assertPrincipalFrame4(properties, caller);
  const extents = Array.from({ length: 4 }, (_, axis) => half[axis]!);

  // A hyperbox source is centred on its authored origin by construction, so a
  // record placing its centre of mass elsewhere is describing something else.
  // The only legitimate non-zero values are integration noise, and that noise
  // is per-axis — so the tolerance is too. Keying it to the *largest* extent
  // would let an offset a million times a thin axis's own half-extent through
  // on a box with an extreme aspect ratio.
  for (let axis = 0; axis < 4; axis++) {
    const component = properties.centerOfMass.data[axis]!;
    if (!Number.isFinite(component) || Math.abs(component) > 1e-9 * extents[axis]!) {
      throw new Error(
        `${caller}: massProperties.centerOfMass must be zero for an analytic hyperbox, ` +
        `got ${component} on axis ${axis}`
      );
    }
  }

  // Columns of principalAxes map principal directions into the source frame, so
  // a box-preserving frame has exactly one unit entry per column and per row.
  const sourceAxisOfSlot = new Array<number>(4).fill(-1);
  const claimed = new Set<number>();
  for (let slot = 0; slot < 4; slot++) {
    let found = -1;
    for (let row = 0; row < 4; row++) {
      const entry = properties.principalAxes.get(row, slot);
      // This threshold is never the sole gate: any column leaning off its axis
      // by more than 1e-9 fails the orthonormality test above, because the
      // column owning that row is no longer orthogonal to it. It is here so the
      // permutation argument reads on its own terms.
      if (Math.abs(entry) <= 1e-9) continue;
      if (found >= 0 || Math.abs(Math.abs(entry) - 1) > 1e-9) {
        throw new Error(
          `${caller}: massProperties.principalAxes must be a symmetry of the axis-aligned ` +
          'box — a signed permutation of its axes. A rotation inside a degenerate inertia ' +
          'eigenspace is a valid inertia basis but not a symmetry of the box; express such ' +
          'a source as a complex instead.'
        );
      }
      found = row;
    }
    // A repeated row cannot survive the orthonormality check above — two
    // columns sharing a unit row have dot product ±1 — so this arm is
    // unreachable today. It stays because the permutation argument should not
    // depend on which check happens to run first.
    if (found < 0 || claimed.has(found)) {
      throw new Error(
        `${caller}: massProperties.principalAxes must be a signed permutation of the box axes`
      );
    }
    claimed.add(found);
    sourceAxisOfSlot[slot] = found;
  }

  // The permutation has to be the one that sorts *these* extents: slot k holds
  // the moment of whichever authored axis its column points at.
  const moments = properties.principalSecondMoments;
  if (moments.length !== 4) {
    throw new Error(
      `${caller}: massProperties.principalSecondMoments must have 4 entries, got ${moments.length}`
    );
  }
  for (const moment of moments) {
    if (!Number.isFinite(moment)) {
      throw new Error(`${caller}: massProperties.principalSecondMoments must be finite`);
    }
  }
  const reference = moments[0]!;
  if (!(reference > 0)) {
    throw new Error(`${caller}: massProperties has no positive second moment`);
  }
  // The type documents these as ascending, and here that ordering is
  // load-bearing rather than cosmetic: a collider sharing the body is handed
  // the authored extents sorted ascending, so slot k has to hold the k-th
  // smallest. A record that orders them otherwise can still be internally
  // consistent — every ratio below matches — while putting the collider
  // somewhere the section is not.
  for (let slot = 1; slot < 4; slot++) {
    // Keyed to the two moments being compared, not to a global magnitude. A
    // second moment carries length⁶, so flooring the scale at 1 made this
    // tolerance larger than every moment in the record for any box below a few
    // centimetres, and keying it to the largest moment let an adjacent pair
    // slip through on a high aspect ratio. Both defeat the ordering entirely.
    const pairScale = Math.max(Math.abs(moments[slot]!), Math.abs(moments[slot - 1]!));
    if (moments[slot]! < moments[slot - 1]! - 1e-9 * pairScale) {
      throw new Error(
        `${caller}: massProperties.principalSecondMoments must be ascending, so that the ` +
        'frame is the one sorting these half-extents'
      );
    }
  }
  const referenceExtent = extents[sourceAxisOfSlot[0]!]!;
  for (let slot = 1; slot < 4; slot++) {
    const extent = extents[sourceAxisOfSlot[slot]!]!;
    const expected = (extent * extent) / (referenceExtent * referenceExtent);
    const actual = moments[slot]! / reference;
    // Both sides are ratios, so the comparison is relative to them rather than
    // to 1: a floor of 1 would turn this into an absolute tolerance wherever
    // `expected` fell below it, and stop constraining the slot at all.
    if (Math.abs(actual - expected) > 1e-6 * Math.max(actual, expected)) {
      throw new Error(
        `${caller}: massProperties describes a different box than these half-extents, or ` +
        'orders its principal moments inconsistently with its own axes'
      );
    }
  }
}

/** Signed distance of a world point from the hyperplane. */
function signedDistance(slice: HyperplaneSliceN, point: ArrayLike<number>): number {
  let sum = -slice.offset;
  for (let axis = 0; axis < 4; axis++) {
    sum += slice.normal.data[axis]! * point[axis]!;
  }
  return sum;
}

/**
 * The rigid map from a source's authored axes into its body's frame.
 *
 * `rebasePositionsToPrincipalFrame4` computes `Qᵀ (x − c)` point by point; the
 * same map as a transform is a rotation of `Qᵀ` and a translation of `−Qᵀc`.
 * Composing it with the body pose means the two are applied together, once,
 * rather than the source being walked twice.
 *
 * The cancellation is what makes the answer independent of *which* principal
 * basis was chosen: a degenerate eigenspace admits many valid frames, and the
 * pose carries `Q` while this carries `Qᵀ`, so the arbitrary part drops out.
 * That independence is a property of the pair, not of either half — it holds
 * exactly when `properties` is the frame the body was posed from. Hand this a
 * *different* valid frame and it will faithfully compose the wrong one.
 */
function sourceToPrincipal4(properties: MassProperties4): TransformN {
  const inverseRotation = properties.principalAxes.transpose();
  const offset = inverseRotation.applyTo(properties.centerOfMass).multiplyScalar(-1);
  return new TransformN(4, inverseRotation, offset);
}

/** The tetrahedral group a complex is sectioned through. */
function resolveTetrahedralGroup(
  complex: CellComplex,
  groupKey: string | undefined,
  caller: string
): CellGroup {
  const candidates = complex.groups.filter(
    (group) => group.dim === 3 && group.verticesPerCell === 4
  );
  if (groupKey !== undefined) {
    const named = candidates.find((group) => group.key === groupKey);
    if (!named) {
      throw new Error(
        `${caller}: no tetrahedral 3-group with key ${JSON.stringify(groupKey)}`
      );
    }
    return named;
  }
  const first = candidates[0];
  if (!first) {
    throw new Error(`${caller}: source complex has no tetrahedral 3-cell group`);
  }
  return first;
}

/**
 * Applies one composed transform to a complex's positions and returns a complex
 * over the moved copy. The authored positions are read and never written.
 */
function poseComplex(complex: CellComplex, worldFromSource: TransformN): CellComplex {
  const moved = new Float64Array(complex.positions.length);
  worldFromSource.applyToPositions(complex.positions, moved, complex.vertexCount);
  return new CellComplex(
    4,
    moved,
    complex.groups.map((group) => {
      // The key is carried over rather than rebuilt: it is what keeps source
      // cell identity stable across regeneration. Assigning it conditionally is
      // what the optional-property type requires, not a runtime distinction.
      const posedGroup: CellGroup = {
        dim: group.dim,
        verticesPerCell: group.verticesPerCell,
        kind: group.kind,
        indices: group.indices
      };
      if (group.key !== undefined) posedGroup.key = group.key;
      return posedGroup;
    })
  );
}

/**
 * Classifies a released section result and wraps it with its provenance.
 *
 * Emptiness and tangency are read from the result rather than re-derived: a
 * section with no vertices never met the hyperplane, and one with vertices but
 * no cells met it in a set with no area.
 */
function classifySection(
  result: SectionSimplexGroupNResultN,
  provenance: SectionProvenance4
): Section4 {
  if (result.vertexCount === 0) {
    return { status: 'empty', provenance };
  }
  if (result.cellCount === 0) {
    return {
      status: 'tangent',
      provenance,
      chartPositions: result.chartPositions.slice(0, result.vertexCount * result.chartDim)
    };
  }
  return { status: 'polyhedral', provenance, section: result };
}

/**
 * Exact 3D section of a moving uniform solid ball in R4.
 *
 * The section of a glome by a hyperplane is a 3-ball whose centre is the
 * orthogonal projection of the glome's centre into the chart, and whose radius
 * is `√(r² − d²)` for `d` the signed distance from the plane to that centre.
 * Only the centre moves, so the result is invariant under any rotation the body
 * carries — a property of the sphere, not a branch in this function.
 *
 * @example
 * ```ts
 * const body = RigidBody4.fromMassProperties(massPropertiesOfGlome4(1.3));
 * const slice = HyperplaneSliceN.axisAligned(4, 3, 0.25);
 * const section = sectionOfGlome4({ kind: 'glome', radius: 1.3 }, { body, slice });
 * if (section.status === 'ball') {
 *   section.radius; // √(1.3² − 0.25²)
 * }
 * ```
 */
export function sectionOfGlome4(
  source: GlomeSectionSource4,
  options: Section4Options
): BallSection4 | TangentSection4 | EmptySection4 {
  const caller = 'sectionOfGlome4';
  if (!Number.isFinite(source.radius) || source.radius <= 0) {
    throw new Error(`${caller}: radius must be finite and positive`);
  }
  const slice = resolveSlice(options, caller);
  const epsilon = resolveEpsilon(options, caller);
  const pose = resolvePose(options, caller);
  // A ball is its own principal frame, so the pose alone carries it into world.
  const provenance: SectionProvenance4 = {
    source,
    pose,
    slice,
    worldFromSource: pose
  };
  const center = pose.position.toArray();
  const distance = signedDistance(slice, center);
  const chart = slice.projectPointToChart(center);
  const chartCenter = Float64Array.from(chart.coordinates);
  const gap = Math.abs(distance) - source.radius;
  if (gap > epsilon) {
    return { status: 'empty', provenance };
  }
  if (gap >= -epsilon) {
    return { status: 'tangent', provenance, chartPositions: chartCenter };
  }
  return {
    status: 'ball',
    provenance,
    chartCenter,
    // Squaring the radius first would lose the leading digits when the section
    // is thin; the factored difference of squares keeps them.
    radius: Math.sqrt((source.radius - distance) * (source.radius + distance)),
    signedDistance: distance
  };
}

/**
 * Exact 3D section of a moving uniform solid hyperbox in R4.
 *
 * Half-extents are read in the axes the caller authored them in. The frame the
 * body actually carries is the principal one, so the authored axes are
 * reconciled through `massPropertiesOfHyperbox4`'s own frame and composed with
 * the pose into a single map, applied once. A caller never sorts extents,
 * rebases vertices or composes a principal rotor to get the right answer.
 *
 * The box is sectioned through its tetrahedralized 3-boundary, so the result is
 * the triangulated surface of the section solid and carries the same lineage
 * any other complex section does.
 *
 * @example
 * ```ts
 * const authored = [3.5, 2, 1.25, 0.5]; // unsorted on purpose
 * const body = RigidBody4.fromMassProperties(massPropertiesOfHyperbox4(authored));
 * const section = sectionOfHyperbox4(
 *   { kind: 'hyperbox', halfExtents: authored },
 *   { body, slice: HyperplaneSliceN.axisAligned(4, 3, 0) }
 * );
 * ```
 */
export function sectionOfHyperbox4(
  source: HyperboxSectionSource4,
  options: Section4Options
): PolyhedralSection4 | TangentSection4 | EmptySection4 {
  const caller = 'sectionOfHyperbox4';
  const { halfExtents } = source;
  if (halfExtents.length !== 4) {
    throw new Error(`${caller}: expected 4 half-extents, got ${halfExtents.length}`);
  }
  const edgeLengths: number[] = [];
  for (let axis = 0; axis < 4; axis++) {
    const value = halfExtents[axis]!;
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${caller}: half-extent ${axis} must be finite and positive`);
    }
    edgeLengths.push(value * 2);
  }
  const slice = resolveSlice(options, caller);
  const epsilon = resolveEpsilon(options, caller);
  const pose = resolvePose(options, caller);
  // A box's covariance is exactly diagonal, so the eigensolver rotates nothing
  // and this recomputation is always the canonical signed permutation — which
  // is the frame `fromMassProperties` posed the body from, and so cancels. It
  // is not, however, whichever frame the body happens to carry: a caller who
  // posed one from an alternative basis has to say so.
  const properties = source.massProperties ?? massPropertiesOfHyperbox4(halfExtents);
  if (source.massProperties !== undefined) {
    assertBoxFrame4(source.massProperties, halfExtents, caller);
  }
  const worldFromSource = pose.compose(sourceToPrincipal4(properties));
  const authored = tetrahedralizeCuboidCells(
    createHyperrectangle({ dim: 4, edgeLengths, maxCellDimension: 3 })
  );
  const posed = poseComplex(authored, worldFromSource);
  const result = sectionSimplexGroupN({
    complex: posed,
    group: resolveTetrahedralGroup(posed, undefined, caller),
    slice,
    epsilon
  });
  return classifySection(
    result,
    { source, pose, slice, worldFromSource }
  ) as PolyhedralSection4 | TangentSection4 | EmptySection4;
}

/**
 * Exact 3D section of a moving authored 4D complex.
 *
 * The complex's own positions stay authoritative: the body pose composed with
 * the source-to-principal frame is applied into a private buffer, once, and the
 * released section machinery does the rest — so `parentCells` and `lineage`
 * name the authored cells and vertices, not intermediate ones.
 *
 * @example
 * ```ts
 * const authoredComplex = tetrahedralizeCuboidCells(
 *   createHyperrectangle({ dim: 4, edgeLengths: [1, 2.5, 4, 7], maxCellDimension: 3 })
 * );
 * const properties = massPropertiesFromCellComplex4(authoredComplex);
 * const complexBody = RigidBody4.fromMassProperties(properties);
 * const complexSection = sectionOfComplex4(
 *   { kind: 'complex', complex: authoredComplex, massProperties: properties },
 *   { body: complexBody, slice: HyperplaneSliceN.axisAligned(4, 3, 0) }
 * );
 * // Every drawn primitive names the authored cell it came from.
 * if (complexSection.status === 'polyhedral') {
 *   complexSection.section.parentCells.length === complexSection.section.cellCount;
 * }
 * ```
 */
export function sectionOfComplex4(
  source: ComplexSectionSource4,
  options: Section4Options
): PolyhedralSection4 | TangentSection4 | EmptySection4 {
  const caller = 'sectionOfComplex4';
  const { complex } = source;
  if (complex.ambientDim !== 4) {
    throw new Error(`${caller}: source complex is in R${complex.ambientDim}, expected R4`);
  }
  const slice = resolveSlice(options, caller);
  const epsilon = resolveEpsilon(options, caller);
  const pose = resolvePose(options, caller);
  const properties = source.massProperties ?? massPropertiesFromCellComplex4(complex);
  if (source.massProperties !== undefined) {
    assertPrincipalFrame4(source.massProperties, caller);
  }
  const worldFromSource = pose.compose(sourceToPrincipal4(properties));
  const posed = poseComplex(complex, worldFromSource);
  const result = sectionSimplexGroupN({
    complex: posed,
    group: resolveTetrahedralGroup(posed, source.groupKey, caller),
    slice,
    epsilon
  });
  return classifySection(
    result,
    { source, pose, slice, worldFromSource }
  ) as PolyhedralSection4 | TangentSection4 | EmptySection4;
}

/**
 * Sections whichever source it is given, dispatching on the source's own kind.
 *
 * Use this where the source family is data rather than something the call site
 * knows; the three named entries are otherwise identical and better typed.
 */
export function sectionOfSource4(
  source: SectionSource4,
  options: Section4Options
): Section4 {
  switch (source.kind) {
    case 'glome':
      return sectionOfGlome4(source, options);
    case 'hyperbox':
      return sectionOfHyperbox4(source, options);
    case 'complex':
      return sectionOfComplex4(source, options);
    default: {
      const unknown = source as { kind?: unknown };
      throw new Error(
        `sectionOfSource4: unknown source kind ${JSON.stringify(unknown.kind)}`
      );
    }
  }
}
