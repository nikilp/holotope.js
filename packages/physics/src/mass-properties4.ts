import {
  type CellComplex,
  MatN,
  Rotor4,
  symmetricEigenDecomposition,
  type Tetrahedralization,
  VecN
} from '@holotope/core';

export interface ConvexBoundary4 {
  /** Packed R4 positions. */
  readonly positions: Float64Array;
  /** Four indices per boundary tetrahedron. */
  readonly indices: Uint32Array;
  /** Optional count excluding derived centroid/helper vertices. */
  readonly sourceVertexCount?: number;
}

export interface MassProperties4Options {
  /** Uniform density. Default 1. */
  density?: number;
  /** Override the vertices used to choose the numerical reference point. */
  sourceVertexCount?: number;
  /** Relative convergence threshold for the symmetric Jacobi solve. */
  jacobiTolerance?: number;
}

export interface MassProperties4 {
  readonly volume: number;
  readonly mass: number;
  /** Center of mass in the source coordinate frame. */
  readonly centerOfMass: VecN;
  /** Integral of (x-COM)(x-COM)ᵀ dm in the source coordinate frame. */
  readonly covarianceAtCenter: MatN;
  /** Columns map principal-frame vectors into the source coordinate frame. */
  readonly principalAxes: MatN;
  /** The same principal→source frame on the Spin(4) fast path. */
  readonly principalRotor: Rotor4;
  /** Diagonal of Qᵀ C Q, ordered ascending. */
  readonly principalSecondMoments: Float64Array;
  /** Six diagonal inertias in planes 01,02,03,12,13,23. */
  readonly inertiaDiagonal: Float64Array;
}

/**
 * Integrates uniform 4-volume and second moments from a tetrahedralized
 * convex boundary. Each boundary tetrahedron is coned to an interior
 * numerical reference point, producing one 4-simplex.
 *
 * Convexity is part of this contract: absolute cone volumes are used, so a
 * non-convex or self-intersecting boundary must first provide a consistently
 * oriented signed-volume decomposition through a future, separate API.
 */
export function massPropertiesFromConvexBoundary4(
  boundary: ConvexBoundary4,
  options: MassProperties4Options = {}
): MassProperties4 {
  const { positions, indices } = boundary;
  if (positions.length === 0 || positions.length % 4 !== 0) {
    throw new Error('massPropertiesFromConvexBoundary4: positions must contain packed R4 points');
  }
  if (indices.length === 0 || indices.length % 4 !== 0) {
    throw new Error('massPropertiesFromConvexBoundary4: indices must contain boundary tetrahedra');
  }
  const vertexCount = positions.length / 4;
  for (const index of indices) {
    if (index >= vertexCount) {
      throw new Error(
        `massPropertiesFromConvexBoundary4: vertex index ${index} out of range (${vertexCount})`
      );
    }
  }

  const density = options.density ?? 1;
  if (!Number.isFinite(density) || density <= 0) {
    throw new Error('massPropertiesFromConvexBoundary4: density must be finite and positive');
  }
  const referenceCount =
    options.sourceVertexCount ?? boundary.sourceVertexCount ?? vertexCount;
  if (!Number.isSafeInteger(referenceCount) || referenceCount < 1 || referenceCount > vertexCount) {
    throw new Error(
      'massPropertiesFromConvexBoundary4: sourceVertexCount must select existing vertices'
    );
  }

  // Translating near the vertex centroid bounds intermediate products and
  // materially reduces cancellation for thin tetrahedra.
  const reference = new Float64Array(4);
  for (let vertex = 0; vertex < referenceCount; vertex++) {
    for (let axis = 0; axis < 4; axis++) {
      reference[axis]! += positions[vertex * 4 + axis]! / referenceCount;
    }
  }

  const volumeSum = new NeumaierSum();
  const first = Array.from({ length: 4 }, () => new NeumaierSum());
  const second = Array.from({ length: 16 }, () => new NeumaierSum());
  const vertices = Array.from({ length: 4 }, () => new Float64Array(4));
  const coordinateSum = new Float64Array(4);

  for (let tetra = 0; tetra < indices.length; tetra += 4) {
    coordinateSum.fill(0);
    for (let corner = 0; corner < 4; corner++) {
      const vertex = indices[tetra + corner]!;
      const point = vertices[corner]!;
      for (let axis = 0; axis < 4; axis++) {
        point[axis] = positions[vertex * 4 + axis]! - reference[axis]!;
        coordinateSum[axis]! += point[axis]!;
      }
    }

    const determinant = determinant4Columns(vertices);
    const simplexVolume = Math.abs(determinant) / 24;
    if (!(simplexVolume > 0) || !Number.isFinite(simplexVolume)) {
      throw new Error(
        `massPropertiesFromConvexBoundary4: tetrahedron ${tetra / 4} forms a degenerate cone`
      );
    }
    volumeSum.add(simplexVolume);

    // A 4-simplex has the reference origin as its fifth vertex.
    for (let axis = 0; axis < 4; axis++) {
      first[axis]!.add((simplexVolume * coordinateSum[axis]!) / 5);
    }
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        let diagonalSum = 0;
        for (let corner = 0; corner < 4; corner++) {
          diagonalSum += vertices[corner]![row]! * vertices[corner]![col]!;
        }
        second[row * 4 + col]!.add(
          (simplexVolume *
            (diagonalSum + coordinateSum[row]! * coordinateSum[col]!)) /
            30
        );
      }
    }
  }

  const volume = volumeSum.value;
  if (!(volume > 0) || !Number.isFinite(volume)) {
    throw new Error('massPropertiesFromConvexBoundary4: boundary has no positive 4-volume');
  }
  const mass = density * volume;
  const centerRelative = new Float64Array(4);
  const centerOfMass = new VecN(4);
  for (let axis = 0; axis < 4; axis++) {
    centerRelative[axis] = first[axis]!.value / volume;
    centerOfMass.data[axis] = reference[axis]! + centerRelative[axis]!;
  }

  const covarianceAtCenter = new MatN(4);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      covarianceAtCenter.set(
        row,
        col,
        density * second[row * 4 + col]!.value -
          mass * centerRelative[row]! * centerRelative[col]!
      );
    }
  }
  // Restore exact symmetry after independently compensated sums.
  for (let row = 0; row < 4; row++) {
    for (let col = row + 1; col < 4; col++) {
      const average = 0.5 *
        (covarianceAtCenter.get(row, col) + covarianceAtCenter.get(col, row));
      covarianceAtCenter.set(row, col, average);
      covarianceAtCenter.set(col, row, average);
    }
  }

  return finalizeMassProperties4(
    { volume, mass, centerOfMass, covarianceAtCenter },
    options,
    'massPropertiesFromConvexBoundary4'
  );
}

/**
 * Turns an integrated source-frame covariance into the canonical result.
 *
 * Shared by every producer of {@link MassProperties4} so that eigenvalue
 * ordering, orientation repair, rotor construction and the degenerate-axis
 * policy are decided in exactly one place. An analytic shape and the same shape
 * integrated from its boundary must not be able to disagree about which frame
 * they call principal, and the only way to guarantee that is for both to arrive
 * here.
 */
function finalizeMassProperties4(
  integrated: {
    readonly volume: number;
    readonly mass: number;
    readonly centerOfMass: VecN;
    readonly covarianceAtCenter: MatN;
  },
  options: MassProperties4Options,
  caller: string
): MassProperties4 {
  const { volume, mass, centerOfMass, covarianceAtCenter } = integrated;
  // Extreme but individually finite inputs can still overflow a second moment,
  // which carries two more powers of length than the volume does. The
  // eigensolver already rejects a non-finite covariance, so this adds no
  // refusal — it names the caller and separates the two diagnoses, since a box
  // whose volume overflowed is a different mistake from one whose volume is
  // fine and whose inertia is not.
  if (!Number.isFinite(volume) || !Number.isFinite(mass)) {
    throw new Error(`${caller}: inputs overflow to a non-finite mass`);
  }
  for (const entry of covarianceAtCenter.data) {
    if (!Number.isFinite(entry)) {
      throw new Error(`${caller}: inputs overflow to a non-finite second moment`);
    }
  }
  const jacobiTolerance = options.jacobiTolerance ?? 1e-14;
  if (!Number.isFinite(jacobiTolerance) || jacobiTolerance <= 0) {
    throw new Error(`${caller}: jacobiTolerance must be positive`);
  }
  const eigensystem = symmetricEigenDecomposition(covarianceAtCenter, {
    tolerance: jacobiTolerance
  });
  const principalSecondMoments = eigensystem.values.slice();
  const eigenvalueScale = Math.max(1, ...Array.from(principalSecondMoments, Math.abs));
  for (let index = 0; index < principalSecondMoments.length; index++) {
    const value = principalSecondMoments[index]!;
    if (value < -jacobiTolerance * eigenvalueScale * 10) {
      throw new Error(`${caller}: covariance is not positive semidefinite`);
    }
    principalSecondMoments[index] = Math.max(0, value);
  }
  const principalAxes = eigensystem.vectors.clone();
  // Rotor4 represents SO(4), while a symmetric eigensystem may choose an
  // orthonormal frame with determinant -1. Repair only that orientation.
  if (principalAxes.determinant() < 0) {
    for (let row = 0; row < 4; row++) {
      principalAxes.set(row, 3, -principalAxes.get(row, 3));
    }
  }
  const inertiaDiagonal = new Float64Array(6);
  let component = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      inertiaDiagonal[component++] =
        principalSecondMoments[i]! + principalSecondMoments[j]!;
    }
  }

  return {
    volume,
    mass,
    centerOfMass,
    covarianceAtCenter,
    principalAxes,
    principalRotor: Rotor4.fromMatrix(principalAxes),
    principalSecondMoments,
    inertiaDiagonal
  };
}

/**
 * Changes packed source-frame points into the centered principal frame.
 * Applying `properties.principalRotor` and then adding the center of mass
 * reconstructs the original points.
 */
export function rebasePositionsToPrincipalFrame4(
  positions: ArrayLike<number>,
  properties: MassProperties4
): Float64Array {
  if (positions.length % 4 !== 0) {
    throw new Error('rebasePositionsToPrincipalFrame4: positions must contain packed R4 points');
  }
  const sourceToPrincipal = properties.principalAxes.transpose();
  const output = new Float64Array(positions.length);
  const centered = new VecN(4);
  for (let offset = 0; offset < positions.length; offset += 4) {
    for (let axis = 0; axis < 4; axis++) {
      const value = positions[offset + axis];
      if (value === undefined || !Number.isFinite(value)) {
        throw new Error('rebasePositionsToPrincipalFrame4: coordinates must be finite');
      }
      centered.data[axis] = value - properties.centerOfMass.data[axis]!;
    }
    const transformed = sourceToPrincipal.applyTo(centered);
    output.set(transformed.data, offset);
  }
  return output;
}

export function massPropertiesFromTetrahedralization4(
  tetrahedralization: Tetrahedralization,
  options: MassProperties4Options = {}
): MassProperties4 {
  return massPropertiesFromConvexBoundary4(tetrahedralization, options);
}

/**
 * Uses all simplex 3-cell groups as a tetrahedralized convex boundary.
 *
 * @example
 * An orthotope's mass properties are closed-form, which makes it a good way to
 * read what each field means. With edge lengths `a` and density `ρ`, the
 * volume is `∏aᵢ`, the principal second moments are `m aᵢ²/12`, and the six
 * plane inertias are their pair sums `m(aᵢ² + aⱼ²)/12`:
 * ```ts
 * const body = tetrahedralizeCuboidCells(
 *   createHyperrectangle({ dim: 4, edgeLengths: [2, 3, 5, 7], maxCellDimension: 3 })
 * );
 * // MassProperties4.
 * const properties = massPropertiesFromCellComplex4(body);
 *
 * log(properties.volume); // 210
 * // One per principal axis, ordered by the eigensolver.
 * log(Array.from(properties.principalSecondMoments).length); // 4
 * // One per plane, in bivector order 01, 02, 03, 12, 13, 23.
 * log(Array.from(properties.inertiaDiagonal).length); // 6
 * ```
 */
export function massPropertiesFromCellComplex4(
  complex: CellComplex,
  options: MassProperties4Options = {}
): MassProperties4 {
  if (complex.ambientDim !== 4) {
    throw new Error(
      `massPropertiesFromCellComplex4: expected ambient dimension 4, got ${complex.ambientDim}`
    );
  }
  const groups = complex
    .cellsOfDim(3)
    .filter((group) => group.kind === 'simplex' && group.verticesPerCell === 4);
  if (groups.length === 0) {
    throw new Error(
      'massPropertiesFromCellComplex4: complex needs tetrahedral 3-cell groups'
    );
  }
  const length = groups.reduce((sum, group) => sum + group.indices.length, 0);
  const indices = new Uint32Array(length);
  let offset = 0;
  for (const group of groups) {
    indices.set(group.indices, offset);
    offset += group.indices.length;
  }
  const boundary: ConvexBoundary4 = { positions: complex.positions, indices };
  return massPropertiesFromConvexBoundary4(boundary, options);
}

class NeumaierSum {
  private sum = 0;
  private correction = 0;

  add(value: number): void {
    const next = this.sum + value;
    if (Math.abs(this.sum) >= Math.abs(value)) {
      this.correction += this.sum - next + value;
    } else {
      this.correction += value - next + this.sum;
    }
    this.sum = next;
  }

  get value(): number {
    return this.sum + this.correction;
  }
}

function determinant4Columns(columns: Float64Array[]): number {
  const a00 = columns[0]![0]!, a01 = columns[1]![0]!;
  const a02 = columns[2]![0]!, a03 = columns[3]![0]!;
  const a10 = columns[0]![1]!, a11 = columns[1]![1]!;
  const a12 = columns[2]![1]!, a13 = columns[3]![1]!;
  const a20 = columns[0]![2]!, a21 = columns[1]![2]!;
  const a22 = columns[2]![2]!, a23 = columns[3]![2]!;
  const a30 = columns[0]![3]!, a31 = columns[1]![3]!;
  const a32 = columns[2]![3]!, a33 = columns[3]![3]!;

  const minor0 =
    a11 * (a22 * a33 - a23 * a32) -
    a12 * (a21 * a33 - a23 * a31) +
    a13 * (a21 * a32 - a22 * a31);
  const minor1 =
    a10 * (a22 * a33 - a23 * a32) -
    a12 * (a20 * a33 - a23 * a30) +
    a13 * (a20 * a32 - a22 * a30);
  const minor2 =
    a10 * (a21 * a33 - a23 * a31) -
    a11 * (a20 * a33 - a23 * a30) +
    a13 * (a20 * a31 - a21 * a30);
  const minor3 =
    a10 * (a21 * a32 - a22 * a31) -
    a11 * (a20 * a32 - a22 * a30) +
    a12 * (a20 * a31 - a21 * a30);
  return a00 * minor0 - a01 * minor1 + a02 * minor2 - a03 * minor3;
}

/**
 * Exact mass properties of a uniform solid R4 hyperbox about its own centre.
 *
 * The box is the axis-aligned region `|xᵢ| ≤ halfExtents[i]`, so its centre of
 * mass is the origin of the frame the half-extents are written in. Volume is
 * `16 h₀h₁h₂h₃` and the source-frame covariance is diagonal with entries
 * `m hᵢ² / 3`, from which the six plane inertias `m (hᵢ² + hⱼ²) / 3` follow.
 *
 * **Frame.** Half-extents are read in the caller's authored axes; the result is
 * the canonical principal representation, exactly as
 * {@link massPropertiesFromConvexBoundary4} returns for the same solid. Because
 * `principalSecondMoments` is ordered ascending and a box's second moment grows
 * with its extent, the principal frame is the authored axes **permuted so the
 * half-extents ascend**. For extents that already ascend the permutation is the
 * identity and `principalRotor` is the identity rotor.
 *
 * That matters when pairing this with a collider. `RigidBody4.fromMassProperties`
 * adopts `principalRotor` as the body's rotation, so a `HyperboxCollider4`
 * sharing that body must be given its half-extents **in the same principal
 * order** — sorted ascending — or the collision shape and the mass distribution
 * will describe two differently oriented boxes. This is the analytic
 * counterpart of rebasing a complex with `rebasePositionsToPrincipalFrame4`.
 *
 * **Uniform solid only.** This describes a box of homogeneous material. A
 * collider is frequently a proxy for something whose mass is distributed
 * otherwise — a hull around a dense core, a shell, an avatar whose handling is
 * authored rather than physical — and for those the authored inertia is the
 * right answer and this function is not.
 */
export function massPropertiesOfHyperbox4(
  halfExtents: ArrayLike<number>,
  options: MassProperties4Options = {}
): MassProperties4 {
  const caller = 'massPropertiesOfHyperbox4';
  if (halfExtents.length !== 4) {
    throw new Error(`${caller}: expected 4 half-extents, got ${halfExtents.length}`);
  }
  const half = new Float64Array(4);
  for (let axis = 0; axis < 4; axis++) {
    const value = halfExtents[axis]!;
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${caller}: half-extent ${axis} must be finite and positive`);
    }
    half[axis] = value;
  }
  const density = options.density ?? 1;
  if (!Number.isFinite(density) || density <= 0) {
    throw new Error(`${caller}: density must be finite and positive`);
  }

  const volume = 16 * half[0]! * half[1]! * half[2]! * half[3]!;
  const mass = density * volume;
  const covarianceAtCenter = new MatN(4);
  for (let axis = 0; axis < 4; axis++) {
    covarianceAtCenter.set(axis, axis, (mass * half[axis]! * half[axis]!) / 3);
  }
  return finalizeMassProperties4(
    { volume, mass, centerOfMass: VecN.zero(4), covarianceAtCenter },
    options,
    caller
  );
}

/**
 * Exact mass properties of a uniform solid R4 glome about its own centre.
 *
 * Volume is `π² r⁴ / 2`. The covariance is isotropic: integrating `|x|²` over
 * the ball gives `∫₀ʳ 2π² s⁵ ds = π² r⁶ / 3`, so `∫|x|² dm = m · 2r² / 3` and,
 * by symmetry, each `∫xᵢ² dm = m r² / 6`. Every plane inertia is therefore
 * `m r² / 3` — the same value in all six planes.
 *
 * **Frame.** A ball has no preferred axes, so the covariance is a multiple of
 * the identity, the principal frame is the identity frame, and `principalRotor`
 * is the identity rotor. Pairing this with a `GlomeCollider4` needs no
 * reorientation.
 *
 * **Uniform solid only**, on the same terms as
 * {@link massPropertiesOfHyperbox4}.
 */
export function massPropertiesOfGlome4(
  radius: number,
  options: MassProperties4Options = {}
): MassProperties4 {
  const caller = 'massPropertiesOfGlome4';
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error(`${caller}: radius must be finite and positive`);
  }
  const density = options.density ?? 1;
  if (!Number.isFinite(density) || density <= 0) {
    throw new Error(`${caller}: density must be finite and positive`);
  }

  const volume = (Math.PI * Math.PI * radius ** 4) / 2;
  const mass = density * volume;
  const secondMoment = (mass * radius * radius) / 6;
  const covarianceAtCenter = new MatN(4);
  for (let axis = 0; axis < 4; axis++) {
    covarianceAtCenter.set(axis, axis, secondMoment);
  }
  return finalizeMassProperties4(
    { volume, mass, centerOfMass: VecN.zero(4), covarianceAtCenter },
    options,
    caller
  );
}
