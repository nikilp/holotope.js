import { CellComplex, MatN, VecN } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  HyperplaneColliderN,
  XpbdConstraintSolverN,
  XpbdParticleHyperplaneConstraintN,
  XpbdParticleN,
  XpbdWorldN,
  compileXpbdParticleBindingN,
  compileXpbdParticleHyperplaneFamilyN
} from '../src/index.js';

function pointSource(dimension: number): CellComplex {
  const positions = new Float64Array(3 * dimension);
  positions[1] = 0.5;
  positions[dimension + 1] = -0.4;
  positions[2 * dimension] = 1;
  positions[2 * dimension + 1] = 0.2;
  return new CellComplex(dimension, positions);
}

function expectArrayClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  digits = 12
): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < actual.length; index++) {
    expect(actual[index]!).toBeCloseTo(expected[index]!, digits);
  }
}

describe('dimension-generic XPBD particle-hyperplane contact', () => {
  it('specializes one exact half-space relation in R1, R2, R4, and R7', () => {
    for (const dimension of [1, 2, 4, 7]) {
      const axis = dimension - 1;
      const position = new Float64Array(dimension);
      position[axis] = -0.35;
      const point = new XpbdParticleN({ id: `r${dimension}`, position });
      const constraint = new XpbdParticleHyperplaneConstraintN({
        id: `floor-r${dimension}`,
        point,
        plane: new HyperplaneColliderN(VecN.basis(dimension, axis), 0),
        clearance: 0.05
      });
      const before = constraint.evaluate();
      expect(before.signedDistance).toBeCloseTo(-0.35, 14);
      expect(before.gap).toBeCloseTo(-0.4, 14);
      expect(before.value).toBe(before.gap);
      expectArrayClose(before.gradients[0]!.data, VecN.basis(dimension, axis).data);

      const result = new XpbdConstraintSolverN({ dimension, iterations: 1 })
        .solve([constraint], 0.1)
        .constraints[0]!;
      expect(point.position.data[axis]).toBeCloseTo(0.05, 14);
      expect(result).toMatchObject({
        relation: 'greater-than-or-equal',
        status: 'solved',
        active: true
      });
      expect(result.projectedKktResidual).toBeCloseTo(0, 14);
      expect(point.position.toArray().filter((_value, index) => index !== axis))
        .toEqual(new Array<number>(dimension - 1).fill(0));
    }
  });

  it('is equivariant under common R4 rotation and translation', () => {
    const normal = new VecN([1, 2, -1, 0.5]).normalize();
    const offset = 0.3;
    const tangent = new VecN([0.2, -0.1, 0, 0]);
    tangent.sub(normal.clone().multiplyScalar(tangent.dot(normal)));
    const originalPosition = normal.clone().multiplyScalar(offset - 0.4).add(tangent);
    const rotation = MatN.rotationInPlane(4, 0, 3, 0.73)
      .multiply(MatN.rotationInPlane(4, 1, 2, -0.41));
    const shift = new VecN([2, -1, 0.5, 3]);
    const transformedNormal = rotation.applyTo(normal);
    const transformedPosition = rotation.applyTo(originalPosition).add(shift);
    const transformedOffset = offset + transformedNormal.dot(shift);

    const solve = (
      position: VecN,
      plane: HyperplaneColliderN,
      id: string
    ): { correction: VecN; multiplier: number } => {
      const point = new XpbdParticleN({ id, position, inverseMass: 0.7 });
      const before = point.position.clone();
      const result = new XpbdConstraintSolverN({ dimension: 4, iterations: 1 })
        .solve([new XpbdParticleHyperplaneConstraintN({
          id: `${id}-contact`, point, plane, compliance: 1e-3
        })], 0.1)
        .constraints[0]!;
      return {
        correction: point.position.clone().sub(before),
        multiplier: result.totalMultiplier
      };
    };

    const original = solve(
      originalPosition,
      new HyperplaneColliderN(normal, offset),
      'original'
    );
    const transformed = solve(
      transformedPosition,
      new HyperplaneColliderN(transformedNormal, transformedOffset),
      'transformed'
    );
    expect(transformed.multiplier).toBeCloseTo(original.multiplier, 14);
    expectArrayClose(
      transformed.correction.data,
      rotation.applyTo(original.correction).data,
      13
    );
  });

  it('compiles source-ordinal contacts over one authoritative binding', () => {
    const source = pointSource(4);
    const sourceBefore = source.positions.slice();
    const binding = compileXpbdParticleBindingN({ id: 'points', source, mass: 2 });
    const family = compileXpbdParticleHyperplaneFamilyN({
      id: 'floor',
      source,
      particles: binding.particles,
      plane: new HyperplaneColliderN([0, 1, 0, 0], 0),
      clearance: (vertex) => {
        vertex.sourcePosition.data.fill(99);
        return vertex.sourceVertexIndex === 2 ? 0.1 : 0;
      },
      compliance: (vertex) => vertex.sourceVertexIndex * 1e-5
    });
    expect(source.positions).toEqual(sourceBefore);
    expect(family.dimension).toBe(4);
    expect(family.contacts).toHaveLength(3);
    expect(family.contacts.map((contact) => contact.sourceVertexIndex)).toEqual([0, 1, 2]);
    expect(family.contacts.map((contact) => contact.sourceSignedDistance)).toEqual([
      0.5, -0.4, 0.2
    ]);
    expect(family.contacts.map((contact) => contact.sourceGap)).toEqual([
      0.5, -0.4, 0.1
    ]);
    expect(family.constraints.map((constraint) => constraint.id)).toEqual([
      'floor/vertex/0', 'floor/vertex/1', 'floor/vertex/2'
    ]);
    for (let vertex = 0; vertex < 3; vertex++) {
      expect(family.contacts[vertex]!.particle).toBe(binding.particles[vertex]);
      expect(family.constraints[vertex]!.points[0]).toBe(binding.particles[vertex]);
    }

    const world = binding.addToWorld(new XpbdWorldN({ dimension: 4 }));
    family.addToWorld(world);
    family.addToWorld(world);
    const result = world.step(0.1);
    expect(world.constraints).toEqual(family.constraints);
    expect(binding.particles[1]!.position.data[1]).toBeCloseTo(-4e-4 / (0.5 + 1e-3), 12);
    expect(result.constraintSolves[0]!.solve.constraints.map(
      (constraint) => constraint.status
    )).toEqual(['inactive', 'solved', 'inactive']);
  });

  it('preflights particle and constraint ownership atomically', () => {
    const source = pointSource(4);
    const binding = compileXpbdParticleBindingN({ id: 'owned', source });
    const family = compileXpbdParticleHyperplaneFamilyN({
      id: 'contact',
      source,
      particles: binding.particles,
      plane: new HyperplaneColliderN([0, 1, 0, 0])
    });
    const empty = new XpbdWorldN({ dimension: 4 });
    expect(() => family.addToWorld(empty)).toThrow(/not registered/);
    expect(empty.constraints).toHaveLength(0);
    expect(() => family.addToWorld(new XpbdWorldN({ dimension: 3 }))).toThrow(
      /world is R3/
    );

    const foreign = new XpbdWorldN({ dimension: 4 });
    for (const particle of binding.particles) {
      foreign.addParticle(new XpbdParticleN({
        id: particle.id,
        position: particle.position
      }));
    }
    expect(() => family.addToWorld(foreign)).toThrow(/owned by another object/);
    expect(foreign.constraints).toHaveLength(0);

    const collisionWorld = binding.addToWorld(new XpbdWorldN({ dimension: 4 }));
    collisionWorld.addConstraint(new XpbdParticleHyperplaneConstraintN({
      id: family.constraints[0]!.id,
      point: binding.particles[0]!,
      plane: family.plane
    }));
    expect(() => family.addToWorld(collisionWorld)).toThrow(/already owned/);
    expect(collisionWorld.constraints).toHaveLength(1);
  });

  it('refuses changed layouts and malformed contact policies', () => {
    const source = pointSource(4);
    const binding = compileXpbdParticleBindingN({ id: 'layout', source });
    const plane = new HyperplaneColliderN([0, 1, 0, 0]);
    const family = compileXpbdParticleHyperplaneFamilyN({
      id: 'layout-contact', source, particles: binding.particles, plane
    });
    const world = binding.addToWorld(new XpbdWorldN({ dimension: 4 }));
    source.positions = new Float64Array(8);
    expect(() => family.addToWorld(world)).toThrow(/layout changed/);
    expect(world.constraints).toHaveLength(0);

    const validSource = pointSource(4);
    const validBinding = compileXpbdParticleBindingN({ id: 'valid', source: validSource });
    expect(() => new XpbdParticleHyperplaneConstraintN({
      id: '', point: validBinding.particles[0]!, plane
    })).toThrow(/non-empty/);
    expect(() => new XpbdParticleHyperplaneConstraintN({
      id: 'dimension',
      point: validBinding.particles[0]!,
      plane: new HyperplaneColliderN([0, 1, 0])
    })).toThrow(/plane is R3/);
    expect(() => new XpbdParticleHyperplaneConstraintN({
      id: 'clearance', point: validBinding.particles[0]!, plane, clearance: -1
    })).toThrow(/clearance/);
    expect(() => compileXpbdParticleHyperplaneFamilyN({
      id: '', source: validSource, particles: validBinding.particles, plane
    })).toThrow(/non-empty/);
    expect(() => compileXpbdParticleHyperplaneFamilyN({
      id: 'short',
      source: validSource,
      particles: validBinding.particles.slice(1),
      plane
    })).toThrow(/vertex count/);
    expect(() => compileXpbdParticleHyperplaneFamilyN({
      id: 'repeat',
      source: validSource,
      particles: [
        validBinding.particles[0]!,
        validBinding.particles[0]!,
        validBinding.particles[2]!
      ],
      plane
    })).toThrow(/identities must be unique/);
    expect(() => compileXpbdParticleHyperplaneFamilyN({
      id: 'policy',
      source: validSource,
      particles: validBinding.particles,
      plane,
      compliance: () => Number.NaN
    })).toThrow(/compliance must be finite/);
  });
});
