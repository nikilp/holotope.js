/**
 * One authoritative R4 source, built only from published exports.
 *
 * Shared by the headless checks and the browser entry so both exercise the
 * same construction. Everything here imports by package name; there is no
 * alias, no relative path into a checkout, and no `dist/` specifier.
 */
import {
  HyperplaneSlice4,
  PerspectiveProjection,
  TransformN,
  createHypercube,
  simplexizeCuboidGroupN,
  type CellComplex,
  type CellGroup,
  type CuboidSimplexizationN
} from '@holotope/core';
import { ProjectedSurface3D, SlicedComplex3D } from '@holotope/three';

export interface Scenario {
  readonly complex: CellComplex;
  readonly cuboids: CellGroup;
  readonly simplexization: CuboidSimplexizationN;
  readonly pose: TransformN;
}

/** A tesseract with its cuboid facets and the parent map a pick needs. */
export function buildScenario(size = 2): Scenario {
  const complex = createHypercube({ dim: 4, size, maxCellDimension: 3 });
  const cuboids = requireGroup(
    complex.cellsOfDim(3).find((group) => group.kind === 'cuboid'),
    'cuboid 3-cells'
  );
  // Retains sourceCellIndices, which `tetrahedralizeCuboidCells` drops.
  const simplexization = simplexizeCuboidGroupN(cuboids);
  complex.addGroup(simplexization.simplexGroup);
  return { complex, cuboids, simplexization, pose: TransformN.identity(4) };
}

/** An exact affine section through the origin, ready to be picked. */
export function buildSection(scenario: Scenario): SlicedComplex3D {
  const section = new SlicedComplex3D(
    scenario.complex,
    HyperplaneSlice4.axisAligned(3, 0)
  );
  section.update(scenario.pose);
  return section;
}

/** A perspective projection of the same source, which is many-to-one. */
export function buildSurface(scenario: Scenario): ProjectedSurface3D {
  const surface = new ProjectedSurface3D(
    scenario.complex,
    new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
  );
  surface.update(scenario.pose);
  return surface;
}

export function requireGroup(group: CellGroup | undefined, what: string): CellGroup {
  if (group === undefined) throw new Error(`packed consumer: no ${what}`);
  return group;
}

/** A `CellGroup` reports no count of its own. */
export const cellCountOf = (group: CellGroup): number =>
  group.indices.length / group.verticesPerCell;
