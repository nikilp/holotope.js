import {
  CellComplex,
  VecN,
  createSourceCellIdN,
  createSourceCellReferenceN,
  inspectSourceCellReferenceN,
  resolveSourceCellIdN,
  simplexizeCuboidGroupN,
  type CellGroup,
  type CuboidSimplexizationN,
  type SourceCellIdN,
  type SourceCellReferenceN
} from '@holotope/core';
import {
  XpbdOrientedSimplexMeasureConstraintN,
  evaluateOrientedSimplexMeasureN
} from './xpbd-simplex-measure.js';
import { XpbdParticleN, XpbdWorldN } from './xpbd-world.js';

export interface XpbdOrientedCuboidFamilyCellContextN {
  readonly simplexIndex: number;
  readonly sourceCellIndex: number;
  readonly permutationIndex: number;
  readonly permutation: readonly number[];
  readonly sourceCuboidVertexIndices: readonly number[];
  readonly sourceSimplexVertexIndices: readonly number[];
  readonly sourceId: SourceCellIdN;
  readonly sourceOrientedMeasure: number;
}

export type XpbdOrientedCuboidFamilyComplianceN =
  | number
  | ((cell: XpbdOrientedCuboidFamilyCellContextN) => number);

export type XpbdOrientedCuboidFamilyRestN =
  | number
  | ((cell: XpbdOrientedCuboidFamilyCellContextN) => number);

export interface CompileXpbdOrientedCuboidFamilyNOptions {
  readonly id: string;
  readonly source: CellComplex;
  readonly cuboidGroup: CellGroup;
  /** One live particle per source vertex, in source-vertex order. */
  readonly particles: readonly XpbdParticleN[];
  /** Default: signed measure of the generated source simplex at compile time. */
  readonly restOrientedMeasure?: XpbdOrientedCuboidFamilyRestN;
  readonly compliance?: XpbdOrientedCuboidFamilyComplianceN;
  /** Passed to the deterministic cuboid simplexizer. Default 1,000,000. */
  readonly maxOutputCells?: number;
}

export interface XpbdOrientedCuboidFamilyCellN
  extends XpbdOrientedCuboidFamilyCellContextN {
  readonly sourceReference: SourceCellReferenceN;
  readonly restOrientedMeasure: number;
  readonly constraint: XpbdOrientedSimplexMeasureConstraintN;
}

/** Source-identified oriented simplex constraints over full-dimensional cuboids. */
export class XpbdOrientedCuboidFamilyN {
  readonly id: string;
  readonly dimension: number;
  readonly source: CellComplex;
  readonly sourceCuboidGroup: CellGroup;
  readonly simplexization: CuboidSimplexizationN;
  readonly particles: readonly XpbdParticleN[];
  readonly cells: readonly XpbdOrientedCuboidFamilyCellN[];
  readonly constraints: readonly XpbdOrientedSimplexMeasureConstraintN[];
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    id: string,
    source: CellComplex,
    cuboidGroup: CellGroup,
    simplexization: CuboidSimplexizationN,
    particles: readonly XpbdParticleN[],
    cells: XpbdOrientedCuboidFamilyCellN[]
  ) {
    this.id = id;
    this.dimension = source.ambientDim;
    this.source = source;
    this.sourceCuboidGroup = cuboidGroup;
    this.simplexization = simplexization;
    this.particles = Object.freeze([...particles]);
    this.cells = Object.freeze(cells);
    this.constraints = Object.freeze(cells.map((cell) => cell.constraint));
  }

  static compile(
    options: CompileXpbdOrientedCuboidFamilyNOptions
  ): XpbdOrientedCuboidFamilyN {
    validateCompilerInput(options);
    const simplexization = simplexizeCuboidGroupN(options.cuboidGroup, {
      ...(options.maxOutputCells === undefined
        ? {}
        : { maxOutputCells: options.maxOutputCells })
    });
    const cells = compileCells(options, simplexization);
    return new XpbdOrientedCuboidFamilyN(
      options.id,
      options.source,
      options.cuboidGroup,
      simplexization,
      options.particles,
      cells
    );
  }

  /** Adds only this family's constraints; particles must already belong to the world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error('XpbdOrientedCuboidFamilyN.addToWorld: expected an XpbdWorldN');
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `XpbdOrientedCuboidFamilyN.addToWorld: family is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(
        'XpbdOrientedCuboidFamilyN.addToWorld: family is already attached to another world'
      );
    }
    validateCurrentLineage(this.cells);
    preflightWorldIdentity(world, this.particles, this.constraints);
    for (const constraint of this.constraints) world.addConstraint(constraint);
    this.attachedWorld = world;
    return world;
  }
}

/** Compiles one full-dimensional cuboid family over existing RN particles. */
export function compileXpbdOrientedCuboidFamilyN(
  options: CompileXpbdOrientedCuboidFamilyNOptions
): XpbdOrientedCuboidFamilyN {
  return XpbdOrientedCuboidFamilyN.compile(options);
}

function validateCompilerInput(options: CompileXpbdOrientedCuboidFamilyNOptions): void {
  if (typeof options.id !== 'string' || options.id.trim().length === 0) {
    throw new Error(
      'compileXpbdOrientedCuboidFamilyN: id must be a non-empty string'
    );
  }
  if (!(options.source instanceof CellComplex)) {
    throw new Error(
      'compileXpbdOrientedCuboidFamilyN: source must be a CellComplex'
    );
  }
  const group = options.cuboidGroup;
  if (!options.source.groups.includes(group)) {
    throw new Error(
      'compileXpbdOrientedCuboidFamilyN: cuboidGroup must belong to source'
    );
  }
  if (!Number.isSafeInteger(group.dim) || group.dim < 1 || group.dim > 30) {
    throw new Error(
      'compileXpbdOrientedCuboidFamilyN: cuboidGroup dimension must be an integer from 1 through 30'
    );
  }
  if (group.dim !== options.source.ambientDim) {
    throw new Error(
      'compileXpbdOrientedCuboidFamilyN: cuboidGroup must be full-dimensional'
    );
  }
  const expectedArity = 2 ** group.dim;
  if (group.kind !== 'cuboid' || group.verticesPerCell !== expectedArity) {
    throw new Error(
      `compileXpbdOrientedCuboidFamilyN: expected ${expectedArity}-vertex ${group.dim}-cuboids`
    );
  }
  if (group.indices.length === 0 || group.indices.length % expectedArity !== 0) {
    throw new Error(
      'compileXpbdOrientedCuboidFamilyN: indices must contain complete cuboid cells'
    );
  }
  if (
    group.key !== undefined &&
    options.source.groups.filter((candidate) => candidate.key === group.key).length !== 1
  ) {
    throw new Error(
      `compileXpbdOrientedCuboidFamilyN: source group key "${group.key}" is ambiguous`
    );
  }
  if (options.particles.length !== options.source.vertexCount) {
    throw new Error(
      'compileXpbdOrientedCuboidFamilyN: particles must match the source vertex count'
    );
  }
  if (new Set(options.particles).size !== options.particles.length) {
    throw new Error(
      'compileXpbdOrientedCuboidFamilyN: particle identities must be unique'
    );
  }
  const particleIds = new Set<string>();
  for (let index = 0; index < options.particles.length; index++) {
    const particle = options.particles[index];
    if (!(particle instanceof XpbdParticleN)) {
      throw new Error(
        `compileXpbdOrientedCuboidFamilyN: particle ${index} must be an XpbdParticleN`
      );
    }
    if (particle.dimension !== options.source.ambientDim) {
      throw new Error(
        `compileXpbdOrientedCuboidFamilyN: particle ${index} dimension mismatch`
      );
    }
    if (particleIds.has(particle.id)) {
      throw new Error(
        `compileXpbdOrientedCuboidFamilyN: duplicate particle id "${particle.id}"`
      );
    }
    particleIds.add(particle.id);
    assertFiniteParticle(particle, index);
  }
  const cellCount = group.indices.length / expectedArity;
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    const start = cellIndex * expectedArity;
    const vertices = group.indices.subarray(start, start + expectedArity);
    if (new Set(vertices).size !== vertices.length) {
      throw new Error(
        `compileXpbdOrientedCuboidFamilyN: source cell ${cellIndex} repeats a vertex`
      );
    }
    for (const vertex of vertices) {
      if (vertex >= options.source.vertexCount) {
        throw new Error(
          `compileXpbdOrientedCuboidFamilyN: source cell vertex ${vertex} is out of range`
        );
      }
    }
  }
}

function compileCells(
  options: CompileXpbdOrientedCuboidFamilyNOptions,
  simplexization: CuboidSimplexizationN
): XpbdOrientedCuboidFamilyCellN[] {
  const group = options.cuboidGroup;
  const simplexGroup = simplexization.simplexGroup;
  const cells: XpbdOrientedCuboidFamilyCellN[] = [];
  for (let simplexIndex = 0; simplexIndex < simplexization.sourceCellIndices.length; simplexIndex++) {
    const sourceCellIndex = simplexization.sourceCellIndices[simplexIndex]!;
    const permutationIndex = simplexization.permutationIndices[simplexIndex]!;
    const sourceCuboidStart = sourceCellIndex * group.verticesPerCell;
    const sourceSimplexStart = simplexIndex * simplexGroup.verticesPerCell;
    const sourceCuboidVertexIndices = Object.freeze(Array.from(
      group.indices.subarray(
        sourceCuboidStart,
        sourceCuboidStart + group.verticesPerCell
      )
    ));
    const sourceSimplexVertexIndices = Object.freeze(Array.from(
      simplexGroup.indices.subarray(
        sourceSimplexStart,
        sourceSimplexStart + simplexGroup.verticesPerCell
      )
    ));
    const sourceReference = createSourceCellReferenceN(
      options.source,
      group,
      sourceCellIndex
    );
    const sourceId = frozenSourceId(createSourceCellIdN(sourceReference));
    const sourceEvaluation = evaluateOrientedSimplexMeasureN(
      sourceSimplexVertexIndices.map((vertex) => sourcePosition(options.source, vertex))
    );
    if (sourceEvaluation.orientedMeasure === 0) {
      throw new Error(
        `compileXpbdOrientedCuboidFamilyN: source simplex ${simplexIndex} is degenerate`
      );
    }
    const context: XpbdOrientedCuboidFamilyCellContextN = Object.freeze({
      simplexIndex,
      sourceCellIndex,
      permutationIndex,
      permutation: simplexization.permutations[permutationIndex]!,
      sourceCuboidVertexIndices,
      sourceSimplexVertexIndices,
      sourceId,
      sourceOrientedMeasure: sourceEvaluation.orientedMeasure
    });
    const restOrientedMeasure = cellScalar(
      options.restOrientedMeasure,
      context,
      sourceEvaluation.orientedMeasure,
      'restOrientedMeasure'
    );
    const compliance = cellScalar(options.compliance, context, 0, 'compliance');
    if (compliance < 0) {
      throw new Error(
        'compileXpbdOrientedCuboidFamilyN: compliance must be non-negative'
      );
    }
    const constraint = new XpbdOrientedSimplexMeasureConstraintN({
      id: `${options.id}/cuboid/${sourceId.groupKeyKind}/${encodeURIComponent(sourceId.groupKey)}/${sourceCellIndex}/permutation/${permutationIndex}`,
      points: sourceSimplexVertexIndices.map((vertex) => options.particles[vertex]!),
      restOrientedMeasure,
      compliance
    });
    cells.push(Object.freeze({
      ...context,
      sourceReference,
      restOrientedMeasure,
      constraint
    }));
  }
  return cells;
}

function sourcePosition(source: CellComplex, vertex: number): VecN {
  return new VecN(source.positions.subarray(
    vertex * source.ambientDim,
    (vertex + 1) * source.ambientDim
  ));
}

function cellScalar(
  policy: number | ((cell: XpbdOrientedCuboidFamilyCellContextN) => number) | undefined,
  context: XpbdOrientedCuboidFamilyCellContextN,
  fallback: number,
  label: string
): number {
  const value = typeof policy === 'function' ? policy(context) : (policy ?? fallback);
  if (!Number.isFinite(value)) {
    throw new Error(`compileXpbdOrientedCuboidFamilyN: ${label} must be finite`);
  }
  return value;
}

function assertFiniteParticle(particle: XpbdParticleN, index: number): void {
  if (!Number.isFinite(particle.inverseMass) || particle.inverseMass < 0) {
    throw new Error(
      `compileXpbdOrientedCuboidFamilyN: particle ${index} inverseMass is invalid`
    );
  }
  for (const coordinate of particle.position.data) {
    if (!Number.isFinite(coordinate)) {
      throw new Error(
        `compileXpbdOrientedCuboidFamilyN: particle ${index} position is non-finite`
      );
    }
  }
}

function frozenSourceId(id: SourceCellIdN): SourceCellIdN {
  return Object.freeze({
    ...id,
    vertexIndices: Object.freeze([...id.vertexIndices])
  });
}

function validateCurrentLineage(cells: readonly XpbdOrientedCuboidFamilyCellN[]): void {
  for (const cell of cells) {
    const referenceStatus = inspectSourceCellReferenceN(cell.sourceReference);
    if (referenceStatus.kind !== 'current') {
      throw new Error(
        `XpbdOrientedCuboidFamilyN.addToWorld: source cell ${cell.sourceCellIndex} retired (${referenceStatus.reason})`
      );
    }
    const idStatus = resolveSourceCellIdN(cell.sourceReference.complex, cell.sourceId);
    if (idStatus.kind !== 'resolved') {
      throw new Error(
        `XpbdOrientedCuboidFamilyN.addToWorld: source cell ${cell.sourceCellIndex} id unavailable (${idStatus.reason})`
      );
    }
  }
}

function preflightWorldIdentity(
  world: XpbdWorldN,
  particles: readonly XpbdParticleN[],
  constraints: readonly XpbdOrientedSimplexMeasureConstraintN[]
): void {
  for (const particle of particles) {
    const existing = world.particles.find((candidate) => candidate.id === particle.id);
    if (existing === undefined) {
      throw new Error(
        `XpbdOrientedCuboidFamilyN.addToWorld: particle "${particle.id}" is not registered`
      );
    }
    if (existing !== particle) {
      throw new Error(
        `XpbdOrientedCuboidFamilyN.addToWorld: particle id "${particle.id}" is owned by another object`
      );
    }
  }
  for (const constraint of constraints) {
    const existing = world.constraints.find((candidate) => candidate.id === constraint.id);
    if (existing !== undefined && existing !== constraint) {
      throw new Error(
        `XpbdOrientedCuboidFamilyN.addToWorld: constraint id "${constraint.id}" is already owned`
      );
    }
  }
}
