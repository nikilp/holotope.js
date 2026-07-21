import {
  CellComplex,
  VecN,
  createSourceCellIdN,
  createSourceCellReferenceN,
  inspectSourceCellReferenceN,
  resolveSourceCellIdN,
  type CellGroup,
  type SourceCellIdN,
  type SourceCellReferenceN
} from '@holotope/core';
import { XpbdDistanceConstraintN } from './xpbd-constraint.js';
import { XpbdParticleN, XpbdWorldN } from './xpbd-world.js';

export interface XpbdDistanceNetworkVertexContextN {
  readonly sourceVertexIndex: number;
  /** Copied source position; callback mutation cannot edit the complex. */
  readonly sourcePosition: VecN;
}

export interface XpbdDistanceNetworkEdgeContextN {
  readonly sourceEdgeIndex: number;
  readonly sourceVertexIndices: readonly [number, number];
  readonly sourceId: SourceCellIdN;
  readonly restLength: number;
}

export type XpbdDistanceNetworkVertexScalarN =
  | number
  | ((vertex: XpbdDistanceNetworkVertexContextN) => number);

export type XpbdDistanceNetworkEdgeComplianceN =
  | number
  | ((edge: XpbdDistanceNetworkEdgeContextN) => number);

export interface CompileXpbdDistanceNetworkNOptions {
  readonly id: string;
  readonly source: CellComplex;
  readonly edgeGroup: CellGroup;
  readonly inverseMass?: XpbdDistanceNetworkVertexScalarN;
  readonly gravityScale?: XpbdDistanceNetworkVertexScalarN;
  readonly velocity?: (
    vertex: XpbdDistanceNetworkVertexContextN
  ) => VecN | ArrayLike<number>;
  readonly compliance?: XpbdDistanceNetworkEdgeComplianceN;
}

export interface XpbdDistanceNetworkEdgeN
  extends XpbdDistanceNetworkEdgeContextN {
  readonly sourceReference: SourceCellReferenceN;
  readonly constraint: XpbdDistanceConstraintN;
}

/** Compiled live point state plus its immutable source-topology correspondence. */
export class XpbdDistanceNetworkN {
  readonly id: string;
  readonly dimension: number;
  readonly source: CellComplex;
  readonly sourceEdgeGroup: CellGroup;
  readonly particles: readonly XpbdParticleN[];
  readonly edges: readonly XpbdDistanceNetworkEdgeN[];
  readonly constraints: readonly XpbdDistanceConstraintN[];
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    id: string,
    source: CellComplex,
    edgeGroup: CellGroup,
    particles: XpbdParticleN[],
    edges: XpbdDistanceNetworkEdgeN[]
  ) {
    this.id = id;
    this.dimension = source.ambientDim;
    this.source = source;
    this.sourceEdgeGroup = edgeGroup;
    this.particles = Object.freeze(particles);
    this.edges = Object.freeze(edges);
    this.constraints = Object.freeze(edges.map((edge) => edge.constraint));
  }

  static compile(options: CompileXpbdDistanceNetworkNOptions): XpbdDistanceNetworkN {
    validateCompilerSource(options);
    const particles = compileParticles(options);
    const edges = compileEdges(options, particles);
    return new XpbdDistanceNetworkN(
      options.id,
      options.source,
      options.edgeGroup,
      particles,
      edges
    );
  }

  particleForSourceVertex(sourceVertexIndex: number): XpbdParticleN {
    if (
      !Number.isSafeInteger(sourceVertexIndex) ||
      sourceVertexIndex < 0 ||
      sourceVertexIndex >= this.particles.length
    ) {
      throw new Error('XpbdDistanceNetworkN: source vertex index is out of range');
    }
    return this.particles[sourceVertexIndex]!;
  }

  /** Registers this complete product in one RN point world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error('XpbdDistanceNetworkN.addToWorld: expected an XpbdWorldN');
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `XpbdDistanceNetworkN.addToWorld: network is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error('XpbdDistanceNetworkN.addToWorld: network is already attached to another world');
    }
    preflightWorldIdentity(world, this.particles, this.constraints);
    for (const particle of this.particles) world.addParticle(particle);
    for (const constraint of this.constraints) world.addConstraint(constraint);
    this.attachedWorld = world;
    return world;
  }

  /**
   * Copies live particle coordinates into the same source complex.
   *
   * Source topology and every structural edge id are validated before the
   * packed position buffer is changed.
   */
  writeSourcePositions(): CellComplex {
    if (
      this.source.ambientDim !== this.dimension ||
      this.source.vertexCount !== this.particles.length ||
      this.source.positions.length !== this.particles.length * this.dimension
    ) {
      throw new Error('XpbdDistanceNetworkN.writeSourcePositions: source vertex layout changed');
    }
    for (const edge of this.edges) {
      const referenceStatus = inspectSourceCellReferenceN(edge.sourceReference);
      if (referenceStatus.kind !== 'current') {
        throw new Error(
          `XpbdDistanceNetworkN.writeSourcePositions: source edge ${edge.sourceEdgeIndex} retired (${referenceStatus.reason})`
        );
      }
      const idStatus = resolveSourceCellIdN(this.source, edge.sourceId);
      if (idStatus.kind !== 'resolved') {
        throw new Error(
          `XpbdDistanceNetworkN.writeSourcePositions: source edge ${edge.sourceEdgeIndex} id unavailable (${idStatus.reason})`
        );
      }
    }
    for (const particle of this.particles) {
      assertFiniteVector(
        particle.position,
        this.dimension,
        `XpbdDistanceNetworkN.writeSourcePositions: particle "${particle.id}"`
      );
    }
    for (let vertex = 0; vertex < this.particles.length; vertex++) {
      this.source.positions.set(this.particles[vertex]!.position.data, vertex * this.dimension);
    }
    return this.source;
  }
}

/** Compiles one explicitly selected source 1-cell family into an XPBD network. */
export function compileXpbdDistanceNetworkN(
  options: CompileXpbdDistanceNetworkNOptions
): XpbdDistanceNetworkN {
  return XpbdDistanceNetworkN.compile(options);
}

function validateCompilerSource(options: CompileXpbdDistanceNetworkNOptions): void {
  if (typeof options.id !== 'string' || options.id.trim().length === 0) {
    throw new Error('compileXpbdDistanceNetworkN: id must be a non-empty string');
  }
  if (!(options.source instanceof CellComplex)) {
    throw new Error('compileXpbdDistanceNetworkN: source must be a CellComplex');
  }
  if (options.source.vertexCount < 1) {
    throw new Error('compileXpbdDistanceNetworkN: source must contain at least one vertex');
  }
  if (!options.source.groups.includes(options.edgeGroup)) {
    throw new Error('compileXpbdDistanceNetworkN: edgeGroup must belong to source');
  }
  if (options.edgeGroup.dim !== 1 || options.edgeGroup.verticesPerCell !== 2) {
    throw new Error('compileXpbdDistanceNetworkN: edgeGroup must contain two-vertex 1-cells');
  }
  if (options.edgeGroup.indices.length % 2 !== 0) {
    throw new Error('compileXpbdDistanceNetworkN: edgeGroup indices must contain complete edges');
  }
  for (const vertex of options.edgeGroup.indices) {
    if (vertex >= options.source.vertexCount) {
      throw new Error(
        `compileXpbdDistanceNetworkN: source edge vertex ${vertex} is out of range`
      );
    }
  }
  if (
    options.edgeGroup.key !== undefined &&
    options.source.groups.filter((group) => group.key === options.edgeGroup.key).length !== 1
  ) {
    throw new Error(
      `compileXpbdDistanceNetworkN: source group key "${options.edgeGroup.key}" is ambiguous`
    );
  }
}

function compileParticles(
  options: CompileXpbdDistanceNetworkNOptions
): XpbdParticleN[] {
  const particles: XpbdParticleN[] = [];
  for (let vertex = 0; vertex < options.source.vertexCount; vertex++) {
    const sourcePosition = new VecN(
      options.source.positions.subarray(
        vertex * options.source.ambientDim,
        (vertex + 1) * options.source.ambientDim
      )
    );
    const context = (): XpbdDistanceNetworkVertexContextN => Object.freeze({
      sourceVertexIndex: vertex,
      sourcePosition: sourcePosition.clone()
    });
    const inverseMass = vertexScalar(options.inverseMass, context(), 1, 'inverseMass');
    if (inverseMass < 0) {
      throw new Error('compileXpbdDistanceNetworkN: inverseMass must be non-negative');
    }
    const gravityScale = vertexScalar(options.gravityScale, context(), 1, 'gravityScale');
    const velocity = options.velocity?.(context());
    particles.push(new XpbdParticleN({
      id: `${options.id}/vertex/${vertex}`,
      position: sourcePosition,
      ...(velocity === undefined ? {} : { velocity }),
      inverseMass,
      gravityScale
    }));
  }
  return particles;
}

function compileEdges(
  options: CompileXpbdDistanceNetworkNOptions,
  particles: readonly XpbdParticleN[]
): XpbdDistanceNetworkEdgeN[] {
  const edges: XpbdDistanceNetworkEdgeN[] = [];
  const edgeCount = options.edgeGroup.indices.length / 2;
  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex++) {
    const left = options.edgeGroup.indices[edgeIndex * 2]!;
    const right = options.edgeGroup.indices[edgeIndex * 2 + 1]!;
    const sourceReference = createSourceCellReferenceN(
      options.source,
      options.edgeGroup,
      edgeIndex
    );
    const sourceId = frozenSourceId(createSourceCellIdN(sourceReference));
    const restLength = particles[left]!.position.distanceTo(particles[right]!.position);
    if (!(restLength > 1e-15) || !Number.isFinite(restLength)) {
      throw new Error(
        `compileXpbdDistanceNetworkN: source edge ${edgeIndex} has zero or non-finite length`
      );
    }
    const sourceVertexIndices = Object.freeze([left, right]) as readonly [number, number];
    const context: XpbdDistanceNetworkEdgeContextN = Object.freeze({
      sourceEdgeIndex: edgeIndex,
      sourceVertexIndices,
      sourceId,
      restLength
    });
    const compliance = edgeCompliance(options.compliance, context);
    const constraint = new XpbdDistanceConstraintN({
      id: `${options.id}/edge/${sourceId.groupKeyKind}/${encodeURIComponent(sourceId.groupKey)}/${edgeIndex}`,
      pointA: particles[left]!,
      pointB: particles[right]!,
      restLength,
      compliance
    });
    edges.push(Object.freeze({
      ...context,
      sourceReference,
      constraint
    }));
  }
  return edges;
}

function vertexScalar(
  policy: XpbdDistanceNetworkVertexScalarN | undefined,
  context: XpbdDistanceNetworkVertexContextN,
  fallback: number,
  label: string
): number {
  const value = typeof policy === 'function' ? policy(context) : (policy ?? fallback);
  if (!Number.isFinite(value)) {
    throw new Error(`compileXpbdDistanceNetworkN: ${label} must be finite`);
  }
  return value;
}

function edgeCompliance(
  policy: XpbdDistanceNetworkEdgeComplianceN | undefined,
  context: XpbdDistanceNetworkEdgeContextN
): number {
  const value = typeof policy === 'function' ? policy(context) : (policy ?? 0);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('compileXpbdDistanceNetworkN: compliance must be finite and non-negative');
  }
  return value;
}

function frozenSourceId(id: SourceCellIdN): SourceCellIdN {
  return Object.freeze({
    ...id,
    vertexIndices: Object.freeze([...id.vertexIndices])
  });
}

function preflightWorldIdentity(
  world: XpbdWorldN,
  particles: readonly XpbdParticleN[],
  constraints: readonly XpbdDistanceConstraintN[]
): void {
  for (const particle of particles) {
    const existing = world.particles.find((candidate) => candidate.id === particle.id);
    if (existing !== undefined && existing !== particle) {
      throw new Error(
        `XpbdDistanceNetworkN.addToWorld: particle id "${particle.id}" is already owned`
      );
    }
  }
  for (const constraint of constraints) {
    const existing = world.constraints.find((candidate) => candidate.id === constraint.id);
    if (existing !== undefined && existing !== constraint) {
      throw new Error(
        `XpbdDistanceNetworkN.addToWorld: constraint id "${constraint.id}" is already owned`
      );
    }
  }
}

function assertFiniteVector(vector: VecN, dimension: number, caller: string): void {
  if (vector.dim !== dimension) {
    throw new Error(`${caller} must be R${dimension}`);
  }
  for (const coordinate of vector.data) {
    if (!Number.isFinite(coordinate)) throw new Error(`${caller} must be finite`);
  }
}
