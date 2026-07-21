import { CellComplex, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  XpbdWorldN,
  compileXpbdParticleBindingN
} from '../src/index.js';

function pointSource(dimension: number): CellComplex {
  const positions = new Float64Array(3 * dimension);
  positions[dimension] = 1;
  positions[2 * dimension + 1] = -2;
  return new CellComplex(dimension, positions);
}

describe('CellComplex XPBD particle bindings', () => {
  it('binds positive mass and separate mobility policies in R2, R4, and R7', () => {
    for (const dimension of [2, 4, 7]) {
      const source = pointSource(dimension);
      const sourceBefore = source.positions.slice();
      const binding = compileXpbdParticleBindingN({
        id: `points-r${dimension}`,
        source,
        mass: (vertex) => {
          vertex.sourcePosition.data.fill(99);
          return vertex.sourceVertexIndex + 1;
        },
        fixed: (vertex) => vertex.sourceVertexIndex === 0,
        gravityScale: (vertex) => vertex.sourceVertexIndex * 0.5,
        velocity: (vertex) => new VecN(Array.from(
          { length: dimension },
          (_, axis) => axis === dimension - 1 ? vertex.sourceVertexIndex : 0
        ))
      });

      expect(source.positions).toEqual(sourceBefore);
      expect(binding.dimension).toBe(dimension);
      expect(binding.vertexMasses).toEqual(new Float64Array([1, 2, 3]));
      expect(binding.vertices.map((vertex) => vertex.fixed)).toEqual([true, false, false]);
      expect(binding.particles.map((particle) => particle.inverseMass)).toEqual([
        0, 0.5, 1 / 3
      ]);
      expect(binding.particles.map((particle) => particle.gravityScale)).toEqual([
        0, 0.5, 1
      ]);
      expect(binding.particles.map(
        (particle) => particle.velocity.data[dimension - 1]
      )).toEqual([0, 1, 2]);
      for (let vertex = 0; vertex < 3; vertex++) {
        expect(binding.particleForSourceVertex(vertex)).toBe(binding.particles[vertex]);
        expect(binding.vertices[vertex]!.sourcePosition.data).not.toBe(
          binding.particles[vertex]!.position.data
        );
      }
    }
  });

  it('attaches atomically, idempotently, and to only one world', () => {
    const source = pointSource(4);
    const binding = compileXpbdParticleBindingN({ id: 'bound', source });
    const world = new XpbdWorldN({ dimension: 4 });
    binding.addToWorld(world);
    binding.addToWorld(world);
    expect(world.particles).toEqual(binding.particles);
    expect(() => binding.addToWorld(new XpbdWorldN({ dimension: 4 }))).toThrow(
      /another world/
    );
    expect(() => compileXpbdParticleBindingN({
      id: 'wrong-world', source
    }).addToWorld(new XpbdWorldN({ dimension: 3 }))).toThrow(/world is R3/);

    const collisionWorld = new XpbdWorldN({ dimension: 4 }).addParticle(
      new XpbdParticleN({ id: 'collision/vertex/2', position: [0, 0, 0, 0] })
    );
    const collision = compileXpbdParticleBindingN({ id: 'collision', source });
    expect(() => collision.addToWorld(collisionWorld)).toThrow(/already owned/);
    expect(collisionWorld.particles).toHaveLength(1);
  });

  it('validates every live coordinate before transactional source writeback', () => {
    const source = pointSource(4);
    const binding = compileXpbdParticleBindingN({ id: 'writeback', source });
    binding.particles[1]!.position.data.set([3, 4, 5, 6]);
    binding.writeSourcePositions();
    expect(source.positions.slice(4, 8)).toEqual(new Float64Array([3, 4, 5, 6]));

    const beforeInvalid = source.positions.slice();
    binding.particles[2]!.position.data[3] = Number.NaN;
    expect(() => binding.writeSourcePositions()).toThrow(/must be finite/);
    expect(source.positions).toEqual(beforeInvalid);
    binding.particles[2]!.position.data[3] = 0;

    source.positions = new Float64Array(8);
    expect(() => binding.writeSourcePositions()).toThrow(/layout changed/);
  });

  it('rejects malformed policy output without changing the source', () => {
    const source = pointSource(4);
    const before = source.positions.slice();
    expect(() => compileXpbdParticleBindingN({ id: '', source })).toThrow(/non-empty/);
    expect(() => compileXpbdParticleBindingN({
      id: 'zero-mass', source, mass: 0
    })).toThrow(/mass must be positive/);
    expect(() => compileXpbdParticleBindingN({
      id: 'nan-mass', source, mass: Number.NaN
    })).toThrow(/mass must be finite/);
    expect(() => compileXpbdParticleBindingN({
      id: 'fixed', source, fixed: (() => 1) as never
    })).toThrow(/fixed must be boolean/);
    expect(() => compileXpbdParticleBindingN({
      id: 'gravity', source, gravityScale: Number.POSITIVE_INFINITY
    })).toThrow(/gravityScale must be finite/);
    expect(() => compileXpbdParticleBindingN({
      id: 'velocity', source, velocity: () => [0, 0, 0]
    })).toThrow(/dimension 4/);
    expect(source.positions).toEqual(before);
  });
});
