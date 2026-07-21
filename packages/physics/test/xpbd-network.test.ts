import {
  CellComplex,
  VecN,
  createHypercube,
  graphLaplacian,
  resolveSourceCellIdN,
  type CellGroup
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdDistanceConstraintN,
  XpbdParticleN,
  XpbdWorldN,
  compileXpbdDistanceNetworkN
} from '../src/index.js';

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

function chainComplex(dimension: number): CellComplex {
  const positions = new Float64Array(3 * dimension);
  positions[dimension + 1] = -1;
  positions[2 * dimension + 1] = -2;
  return new CellComplex(dimension, positions, [{
    key: 'chain-edges',
    dim: 1,
    verticesPerCell: 2,
    kind: 'simplex',
    indices: new Uint32Array([0, 1, 1, 2])
  }]);
}

describe('CellComplex XPBD distance networks', () => {
  it('compiles exact hypercube 1-skeletons in R3, R4, and R6', () => {
    for (const dimension of [3, 4, 6]) {
      const source = createHypercube({ dim: dimension, size: 1 });
      const edgeGroup = source.cellsOfDim(1)[0]!;
      edgeGroup.key = `cube-r${dimension}-edges`;
      const network = compileXpbdDistanceNetworkN({
        id: `cube-r${dimension}`,
        source,
        edgeGroup
      });
      expect(network.dimension).toBe(dimension);
      expect(network.particles).toHaveLength(2 ** dimension);
      expect(network.edges).toHaveLength(dimension * 2 ** (dimension - 1));
      expect(network.constraints).toHaveLength(network.edges.length);
      expect(network.edges.every((edge) => edge.restLength === 1)).toBe(true);
      expect(network.edges.every((edge) => edge.constraint.restLength === 1)).toBe(true);
      for (let vertex = 0; vertex < network.particles.length; vertex++) {
        expect(network.particleForSourceVertex(vertex)).toBe(network.particles[vertex]);
      }
    }
  });

  it('retains resolvable structural edge identity across position and group order changes', () => {
    const source = createHypercube({ dim: 4 });
    const edgeGroup = source.cellsOfDim(1)[0]!;
    edgeGroup.key = 'tesseract-edges';
    const network = compileXpbdDistanceNetworkN({ id: 'identified', source, edgeGroup });

    for (const edge of network.edges) {
      expect(edge.sourceId.groupKey).toBe('tesseract-edges');
      expect(edge.sourceId.groupKeyKind).toBe('explicit');
      expect(resolveSourceCellIdN(source, edge.sourceId).kind).toBe('resolved');
    }
    source.groups.splice(source.groups.indexOf(edgeGroup), 1);
    source.groups.push(edgeGroup);
    network.particles[0]!.position.data[3]! += 0.25;
    network.writeSourcePositions();
    expect(source.positions[3]).toBeCloseTo(-0.25, 14);
    for (const edge of network.edges) {
      expect(resolveSourceCellIdN(source, edge.sourceId).kind).toBe('resolved');
    }
  });

  it('keeps topology and material policies separate from copied live state', () => {
    const source = chainComplex(4);
    const positionsBefore = source.positions.slice();
    const seenEdges: number[] = [];
    const network = compileXpbdDistanceNetworkN({
      id: 'material',
      source,
      edgeGroup: source.groups[0]!,
      inverseMass: (vertex) => {
        vertex.sourcePosition.data.fill(99);
        return vertex.sourceVertexIndex === 0 ? 0 : 0.5;
      },
      gravityScale: (vertex) => vertex.sourcePosition.data[1] === 0 ? 0 : 1.5,
      velocity: (vertex) => new VecN(
        Array.from({ length: 4 }, (_, axis) => axis === 3
          ? vertex.sourceVertexIndex * 0.1
          : 0)
      ),
      compliance: (edge) => {
        expect(Object.isFrozen(edge)).toBe(true);
        expect(Object.isFrozen(edge.sourceId)).toBe(true);
        expect(Object.isFrozen(edge.sourceVertexIndices)).toBe(true);
        seenEdges.push(edge.sourceEdgeIndex);
        return (edge.sourceEdgeIndex + 1) * 1e-4;
      }
    });

    expect(source.positions).toEqual(positionsBefore);
    expect(network.particles.map((particle) => particle.inverseMass)).toEqual([0, 0.5, 0.5]);
    expect(network.particles.map((particle) => particle.gravityScale)).toEqual([0, 1.5, 1.5]);
    expect(network.particles.map((particle) => particle.velocity.data[3])).toEqual([0, 0.1, 0.2]);
    expect(network.particles[0]!.position.data[0]).toBe(0);
    expect(network.constraints.map((constraint) => constraint.compliance)).toEqual([1e-4, 2e-4]);
    expect(seenEdges).toEqual([0, 1]);
  });

  it('evolves equivalent embedded chains and writes one live state back to source', () => {
    const trajectories: number[][] = [];
    for (const dimension of [3, 4, 7]) {
      const source = chainComplex(dimension);
      const topologyBefore = graphLaplacian(source).edges.slice();
      const network = compileXpbdDistanceNetworkN({
        id: `embedded-r${dimension}`,
        source,
        edgeGroup: source.groups[0]!,
        inverseMass: (vertex) => vertex.sourceVertexIndex === 0 ? 0 : 1,
        compliance: 1e-5
      });
      const sourceBeforeStep = source.positions.slice();
      const world = network.addToWorld(new XpbdWorldN({
        dimension,
        gravity: Array.from({ length: dimension }, (_, axis) => axis === 1 ? -2 : 0),
        solverIterations: 12
      }));
      for (let step = 0; step < 120; step++) world.step(1 / 120);

      expect(source.positions).toEqual(sourceBeforeStep);
      network.writeSourcePositions();
      for (let vertex = 0; vertex < network.particles.length; vertex++) {
        expectArrayClose(
          source.positions.subarray(vertex * dimension, (vertex + 1) * dimension),
          network.particles[vertex]!.position.data,
          14
        );
      }
      expect(graphLaplacian(source).edges).toEqual(topologyBefore);
      expect(network.edges.every((edge) =>
        resolveSourceCellIdN(source, edge.sourceId).kind === 'resolved'
      )).toBe(true);
      const packed = network.particles.flatMap((particle) => particle.position.toArray());
      trajectories.push(packed);
      for (const particle of network.particles) {
        expect(particle.position.toArray().slice(2).every((value) => value === 0)).toBe(true);
      }
    }
    for (const trajectory of trajectories.slice(1)) {
      for (let vertex = 0; vertex < 3; vertex++) {
        expect(trajectory[vertex * (trajectory.length / 3)]).toBeCloseTo(
          trajectories[0]![vertex * 3]!,
          12
        );
        expect(trajectory[vertex * (trajectory.length / 3) + 1]).toBeCloseTo(
          trajectories[0]![vertex * 3 + 1]!,
          12
        );
      }
    }
  });

  it('refuses retired topology before changing any source position', () => {
    const cases: Array<(source: CellComplex, edgeGroup: CellGroup) => void> = [
      (source, edgeGroup) => source.groups.splice(source.groups.indexOf(edgeGroup), 1),
      (_source, edgeGroup) => {
        edgeGroup.indices = new Uint32Array([0, 2, 1, 2]);
      },
      (_source, edgeGroup) => {
        edgeGroup.kind = 'cuboid';
      },
      (_source, edgeGroup) => {
        edgeGroup.key = 'replacement-key';
      }
    ];
    for (const mutate of cases) {
      const source = chainComplex(4);
      const edgeGroup = source.groups[0]!;
      const network = compileXpbdDistanceNetworkN({
        id: 'retirement', source, edgeGroup
      });
      network.particles[0]!.position.data[0] = 12;
      const sourcePositions = source.positions.slice();
      mutate(source, edgeGroup);
      expect(() => network.writeSourcePositions()).toThrow(/source edge/);
      expect(source.positions).toEqual(sourcePositions);
    }
  });

  it('attaches idempotently and preflights world identity atomically', () => {
    const source = chainComplex(4);
    const network = compileXpbdDistanceNetworkN({
      id: 'attach', source, edgeGroup: source.groups[0]!
    });
    const world = new XpbdWorldN({ dimension: 4 });
    network.addToWorld(world);
    network.addToWorld(world);
    expect(world.particles).toHaveLength(3);
    expect(world.constraints).toHaveLength(2);
    expect(() => network.addToWorld(new XpbdWorldN({ dimension: 4 }))).toThrow(
      /another world/
    );
    expect(() => compileXpbdDistanceNetworkN({
      id: 'wrong', source, edgeGroup: source.groups[0]!
    }).addToWorld(new XpbdWorldN({ dimension: 3 }))).toThrow(/world is R3/);

    const collisionWorld = new XpbdWorldN({ dimension: 4 }).addParticle(
      new XpbdParticleN({ id: 'collision/vertex/0', position: [0, 0, 0, 0] })
    );
    const collision = compileXpbdDistanceNetworkN({
      id: 'collision', source, edgeGroup: source.groups[0]!
    });
    expect(() => collision.addToWorld(collisionWorld)).toThrow(/already owned/);
    expect(collisionWorld.particles).toHaveLength(1);
    expect(collisionWorld.constraints).toHaveLength(0);

    const constraintCollision = compileXpbdDistanceNetworkN({
      id: 'constraint-collision', source, edgeGroup: source.groups[0]!
    });
    const constraintCollisionWorld = new XpbdWorldN({ dimension: 4 });
    for (const particle of constraintCollision.particles) {
      constraintCollisionWorld.addParticle(particle);
    }
    constraintCollisionWorld.addConstraint(new XpbdDistanceConstraintN({
      id: constraintCollision.constraints[0]!.id,
      pointA: constraintCollision.particles[0]!,
      pointB: constraintCollision.particles[1]!,
      restLength: 1
    }));
    expect(() => constraintCollision.addToWorld(constraintCollisionWorld)).toThrow(
      /constraint id .* already owned/
    );
    expect(constraintCollisionWorld.particles).toHaveLength(3);
    expect(constraintCollisionWorld.constraints).toHaveLength(1);
  });

  it('rejects malformed source and material policies without mutating geometry', () => {
    const source = chainComplex(4);
    const edgeGroup = source.groups[0]!;
    const positions = source.positions.slice();
    expect(() => compileXpbdDistanceNetworkN({
      id: '', source, edgeGroup
    })).toThrow(/non-empty/);
    expect(() => compileXpbdDistanceNetworkN({
      id: 'foreign', source, edgeGroup: chainComplex(4).groups[0]!
    })).toThrow(/belong/);
    const faceGroup: CellGroup = {
      dim: 2,
      verticesPerCell: 3,
      kind: 'simplex',
      indices: new Uint32Array([0, 1, 2])
    };
    source.addGroup(faceGroup);
    expect(() => compileXpbdDistanceNetworkN({
      id: 'face', source, edgeGroup: faceGroup
    })).toThrow(/two-vertex 1-cells/);
    expect(() => compileXpbdDistanceNetworkN({
      id: 'mass', source, edgeGroup, inverseMass: -1
    })).toThrow(/inverseMass/);
    expect(() => compileXpbdDistanceNetworkN({
      id: 'compliance', source, edgeGroup, compliance: Number.NaN
    })).toThrow(/compliance/);
    expect(() => compileXpbdDistanceNetworkN({
      id: 'velocity', source, edgeGroup, velocity: () => [0, 0, 0]
    })).toThrow(/dimension 4/);
    expect(source.positions).toEqual(positions);

    const incomplete = chainComplex(4);
    incomplete.groups[0]!.indices = new Uint32Array([0, 1, 2]);
    expect(() => compileXpbdDistanceNetworkN({
      id: 'incomplete', source: incomplete, edgeGroup: incomplete.groups[0]!
    })).toThrow(/complete edges/);
    const outOfRange = chainComplex(4);
    outOfRange.groups[0]!.indices[0] = 9;
    expect(() => compileXpbdDistanceNetworkN({
      id: 'out-of-range', source: outOfRange, edgeGroup: outOfRange.groups[0]!
    })).toThrow(/out of range/);
    const ambiguous = chainComplex(4);
    ambiguous.groups.push({
      key: 'chain-edges',
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 2])
    });
    expect(() => compileXpbdDistanceNetworkN({
      id: 'ambiguous', source: ambiguous, edgeGroup: ambiguous.groups[0]!
    })).toThrow(/ambiguous/);

    const zeroEdge = new CellComplex(4, new Float64Array(8), [{
      key: 'zero',
      dim: 1,
      verticesPerCell: 2,
      kind: 'simplex',
      indices: new Uint32Array([0, 1])
    }]);
    expect(() => compileXpbdDistanceNetworkN({
      id: 'zero', source: zeroEdge, edgeGroup: zeroEdge.groups[0]!
    })).toThrow(/zero or non-finite length/);
  });
});
