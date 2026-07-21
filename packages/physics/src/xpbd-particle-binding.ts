import { CellComplex, VecN } from '@holotope/core';
import { XpbdParticleN, XpbdWorldN } from './xpbd-world.js';

export interface XpbdParticleBindingVertexContextN {
  readonly sourceVertexIndex: number;
  /** Copied source position; callback mutation cannot edit the complex. */
  readonly sourcePosition: VecN;
}

export type XpbdParticleBindingVertexScalarN =
  | number
  | ((vertex: XpbdParticleBindingVertexContextN) => number);

export type XpbdParticleBindingVertexFixedN =
  | boolean
  | ((vertex: XpbdParticleBindingVertexContextN) => boolean);

export interface CompileXpbdParticleBindingNOptions {
  readonly id: string;
  readonly source: CellComplex;
  /** Positive inertial mass. Default one. */
  readonly mass?: XpbdParticleBindingVertexScalarN;
  /** Mobility policy kept separate from mass. Default false. */
  readonly fixed?: XpbdParticleBindingVertexFixedN;
  /** Multiplier on world gravity. Default one. */
  readonly gravityScale?: XpbdParticleBindingVertexScalarN;
  readonly velocity?: (
    vertex: XpbdParticleBindingVertexContextN
  ) => VecN | ArrayLike<number>;
}

export interface XpbdParticleBindingVertexN
  extends XpbdParticleBindingVertexContextN {
  readonly mass: number;
  readonly fixed: boolean;
  readonly particle: XpbdParticleN;
}

/** Topology-neutral one-particle-per-source-vertex state binding. */
export class XpbdParticleBindingN {
  readonly id: string;
  readonly dimension: number;
  readonly source: CellComplex;
  readonly vertices: readonly XpbdParticleBindingVertexN[];
  readonly particles: readonly XpbdParticleN[];
  readonly vertexMasses: Float64Array;
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    id: string,
    source: CellComplex,
    vertices: XpbdParticleBindingVertexN[]
  ) {
    this.id = id;
    this.dimension = source.ambientDim;
    this.source = source;
    this.vertices = Object.freeze(vertices);
    this.particles = Object.freeze(vertices.map((vertex) => vertex.particle));
    this.vertexMasses = new Float64Array(vertices.map((vertex) => vertex.mass));
  }

  static compile(options: CompileXpbdParticleBindingNOptions): XpbdParticleBindingN {
    validateOptions(options);
    const vertices = compileVertices(options);
    return new XpbdParticleBindingN(options.id, options.source, vertices);
  }

  particleForSourceVertex(sourceVertexIndex: number): XpbdParticleN {
    if (
      !Number.isSafeInteger(sourceVertexIndex) ||
      sourceVertexIndex < 0 ||
      sourceVertexIndex >= this.particles.length
    ) {
      throw new Error('XpbdParticleBindingN: source vertex index is out of range');
    }
    return this.particles[sourceVertexIndex]!;
  }

  /** Registers only the bound particles in one RN point world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error('XpbdParticleBindingN.addToWorld: expected an XpbdWorldN');
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `XpbdParticleBindingN.addToWorld: binding is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(
        'XpbdParticleBindingN.addToWorld: binding is already attached to another world'
      );
    }
    for (const particle of this.particles) {
      const existing = world.particles.find((candidate) => candidate.id === particle.id);
      if (existing !== undefined && existing !== particle) {
        throw new Error(
          `XpbdParticleBindingN.addToWorld: particle id "${particle.id}" is already owned`
        );
      }
    }
    for (const particle of this.particles) world.addParticle(particle);
    this.attachedWorld = world;
    return world;
  }

  /** Validates all live positions, then copies them into the source buffer. */
  writeSourcePositions(): CellComplex {
    if (
      this.source.ambientDim !== this.dimension ||
      this.source.vertexCount !== this.particles.length ||
      this.source.positions.length !== this.particles.length * this.dimension
    ) {
      throw new Error('XpbdParticleBindingN.writeSourcePositions: source vertex layout changed');
    }
    for (const particle of this.particles) {
      if (particle.dimension !== this.dimension) {
        throw new Error(
          `XpbdParticleBindingN.writeSourcePositions: particle "${particle.id}" dimension changed`
        );
      }
      for (const coordinate of particle.position.data) {
        if (!Number.isFinite(coordinate)) {
          throw new Error(
            `XpbdParticleBindingN.writeSourcePositions: particle "${particle.id}" must be finite`
          );
        }
      }
    }
    for (let vertex = 0; vertex < this.particles.length; vertex++) {
      this.source.positions.set(
        this.particles[vertex]!.position.data,
        vertex * this.dimension
      );
    }
    return this.source;
  }
}

export function compileXpbdParticleBindingN(
  options: CompileXpbdParticleBindingNOptions
): XpbdParticleBindingN {
  return XpbdParticleBindingN.compile(options);
}

function validateOptions(options: CompileXpbdParticleBindingNOptions): void {
  if (typeof options.id !== 'string' || options.id.trim().length === 0) {
    throw new Error('compileXpbdParticleBindingN: id must be a non-empty string');
  }
  if (!(options.source instanceof CellComplex)) {
    throw new Error('compileXpbdParticleBindingN: source must be a CellComplex');
  }
  if (options.source.vertexCount < 1) {
    throw new Error('compileXpbdParticleBindingN: source must contain at least one vertex');
  }
}

function compileVertices(
  options: CompileXpbdParticleBindingNOptions
): XpbdParticleBindingVertexN[] {
  const vertices: XpbdParticleBindingVertexN[] = [];
  for (let sourceVertexIndex = 0;
    sourceVertexIndex < options.source.vertexCount;
    sourceVertexIndex++) {
    const sourcePosition = new VecN(options.source.positions.subarray(
      sourceVertexIndex * options.source.ambientDim,
      (sourceVertexIndex + 1) * options.source.ambientDim
    ));
    const context = (): XpbdParticleBindingVertexContextN => Object.freeze({
      sourceVertexIndex,
      sourcePosition: sourcePosition.clone()
    });
    const mass = vertexScalar(options.mass, context(), 1, 'mass');
    if (!(mass > 0)) {
      throw new Error('compileXpbdParticleBindingN: mass must be positive');
    }
    const fixed = vertexFixed(options.fixed, context());
    const gravityScale = vertexScalar(
      options.gravityScale,
      context(),
      1,
      'gravityScale'
    );
    const velocity = options.velocity?.(context());
    const particle = new XpbdParticleN({
      id: `${options.id}/vertex/${sourceVertexIndex}`,
      position: sourcePosition,
      ...(velocity === undefined ? {} : { velocity }),
      inverseMass: fixed ? 0 : 1 / mass,
      gravityScale
    });
    vertices.push(Object.freeze({
      sourceVertexIndex,
      sourcePosition: sourcePosition.clone(),
      mass,
      fixed,
      particle
    }));
  }
  return vertices;
}

function vertexScalar(
  policy: XpbdParticleBindingVertexScalarN | undefined,
  context: XpbdParticleBindingVertexContextN,
  fallback: number,
  label: string
): number {
  const value = typeof policy === 'function' ? policy(context) : (policy ?? fallback);
  if (!Number.isFinite(value)) {
    throw new Error(`compileXpbdParticleBindingN: ${label} must be finite`);
  }
  return value;
}

function vertexFixed(
  policy: XpbdParticleBindingVertexFixedN | undefined,
  context: XpbdParticleBindingVertexContextN
): boolean {
  const value = typeof policy === 'function' ? policy(context) : (policy ?? false);
  if (typeof value !== 'boolean') {
    throw new Error('compileXpbdParticleBindingN: fixed must be boolean');
  }
  return value;
}
