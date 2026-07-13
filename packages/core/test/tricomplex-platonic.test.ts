import { describe, expect, it } from 'vitest';
import {
  containsTricomplexPlatonicSlice3,
  evaluateTricomplexMandelbrotSlice3,
  tricomplexMandelbrotComponents3,
  tricomplexPlatonicSlice3,
  tricomplexPlatonicValue3
} from '@holotope/core';

const IDS = ['airbrot', 'firebrot', 'earthbrot'] as const;

function edgesOf(faces: readonly (readonly number[])[]): readonly [number, number][] {
  const keys = new Set<string>();
  const edges: [number, number][] = [];
  for (const face of faces) {
    for (let index = 0; index < face.length; index++) {
      const a = face[index]!;
      const b = face[(index + 1) % face.length]!;
      const ordered: [number, number] = a < b ? [a, b] : [b, a];
      const key = `${ordered[0]},${ordered[1]}`;
      if (!keys.has(key)) {
        keys.add(key);
        edges.push(ordered);
      }
    }
  }
  return edges;
}

describe('Platonic tricomplex Mandelbrot slices', () => {
  it('pins the theorem f-vectors and uniform edge lengths', () => {
    const expected = {
      airbrot: [6, 12, 8],
      firebrot: [4, 6, 4],
      earthbrot: [8, 12, 6]
    } as const;
    for (const id of IDS) {
      const spec = tricomplexPlatonicSlice3(id);
      const edges = edgesOf(spec.faces);
      expect([spec.vertices.length, edges.length, spec.faces.length]).toEqual(expected[id]);
      for (const [a, b] of edges) {
        const first = spec.vertices[a]!;
        const second = spec.vertices[b]!;
        expect(Math.hypot(
          first[0] - second[0],
          first[1] - second[1],
          first[2] - second[2]
        )).toBeCloseTo(spec.edgeLength, 14);
      }
    }
  });

  it('places every theorem vertex and face centroid exactly on its boundary', () => {
    for (const id of IDS) {
      const spec = tricomplexPlatonicSlice3(id);
      for (const vertex of spec.vertices) {
        expect(tricomplexPlatonicValue3(id, vertex)).toBe(0);
        const evaluation = evaluateTricomplexMandelbrotSlice3(id, vertex, {
          maxIterations: 128
        });
        expect(evaluation.analyticallyBounded).toBe(true);
        expect(evaluation.escaped).toBe(false);
      }
      for (const face of spec.faces) {
        const centroid = [0, 0, 0];
        for (const vertex of face) {
          for (let axis = 0; axis < 3; axis++) {
            centroid[axis]! += spec.vertices[vertex]![axis]! / face.length;
          }
        }
        expect(tricomplexPlatonicValue3(id, centroid)).toBeCloseTo(0, 14);
      }
    }
  });

  it('makes analytic membership identical to four real idempotent intervals', () => {
    for (const id of IDS) {
      for (let i = -10; i <= 10; i++) {
        for (let j = -10; j <= 10; j++) {
          for (let k = -10; k <= 10; k++) {
            const point = [i / 6, j / 6, k / 6] as const;
            const factorBounded = tricomplexMandelbrotComponents3(id, point).every(
              (parameter) => parameter >= -2 && parameter <= 1 / 4
            );
            expect(containsTricomplexPlatonicSlice3(id, point)).toBe(factorBounded);
          }
        }
      }
    }
  });

  it('keeps finite escape-time evaluation consistent away from the exact boundary', () => {
    for (const id of IDS) {
      for (let sample = 0; sample < 240; sample++) {
        const point = [
          Math.sin(sample * 0.71) * 2.2 - 0.5,
          Math.cos(sample * 1.13) * 1.8 - 0.4,
          Math.sin(sample * 1.91) * 1.7 - 0.3
        ] as const;
        const exact = tricomplexPlatonicValue3(id, point);
        if (Math.abs(exact) < 0.08) continue;
        const finite = evaluateTricomplexMandelbrotSlice3(id, point, {
          maxIterations: 192
        });
        expect(!finite.escaped).toBe(finite.analyticallyBounded);
      }
    }
  });

  it('validates point and epsilon inputs', () => {
    expect(() => tricomplexPlatonicValue3('airbrot', [0, 0])).toThrow(/3D point/);
    expect(() => containsTricomplexPlatonicSlice3('firebrot', [0, 0, 0], -1)).toThrow(
      /epsilon/
    );
    expect(() => tricomplexMandelbrotComponents3('earthbrot', [0, Number.NaN, 0])).toThrow(
      /finite/
    );
  });
});
