import { describe, expect, it } from 'vitest';
import { MatN, ObjectN, Rotor4, SceneN, TransformN, VecN } from '@holotope/core';

describe('TransformN.compose', () => {
  it.each(['rotor', 'matrix', 'mixed'] as const)(
    'composed transform equals sequential application (%s backends)',
    (mode) => {
      const rotA =
        mode === 'matrix'
          ? MatN.rotationInPlane(4, 0, 3, 0.7)
          : Rotor4.fromPlanes([{ i: 0, j: 3, angle: 0.7 }]);
      const rotB =
        mode === 'rotor'
          ? Rotor4.fromPlanes([{ i: 1, j: 2, angle: -0.4 }])
          : MatN.rotationInPlane(4, 1, 2, -0.4);
      const parent = new TransformN(4, rotA, new VecN([1, -2, 0.5, 3]));
      const child = new TransformN(4, rotB, new VecN([-0.5, 1, 2, -1]));
      const composed = parent.compose(child);

      for (let trial = 0; trial < 10; trial++) {
        const p = new VecN([0, 0, 0, 0].map(() => Math.random() * 4 - 2));
        const sequential = parent.applyToPoint(child.applyToPoint(p.clone()));
        const direct = composed.applyToPoint(p.clone());
        for (let c = 0; c < 4; c++) {
          expect(direct.data[c]).toBeCloseTo(sequential.data[c]!, 11);
        }
      }
    }
  );

  it('rotor · rotor composition stays on the rotor fast path', () => {
    const a = new TransformN(4, Rotor4.fromPlane(0, 3, 1.1));
    const b = new TransformN(4, Rotor4.fromPlane(1, 2, 0.3));
    expect(a.compose(b).rotation).toBeInstanceOf(Rotor4);
  });
});

describe('ObjectN hierarchy', () => {
  it('world transform of a chain equals the flat composition', () => {
    const scene = new SceneN(4);
    const a = new ObjectN(4, new TransformN(4, Rotor4.fromPlane(0, 3, 0.6), new VecN([2, 0, 0, 0])));
    const b = new ObjectN(4, new TransformN(4, Rotor4.fromPlane(1, 2, -0.9), new VecN([0, 1, 0, -1])));
    const c = new ObjectN(4, new TransformN(4, Rotor4.fromPlane(0, 1, 0.25), new VecN([0, 0, 3, 0])));
    scene.add(a);
    a.add(b);
    b.add(c);
    scene.updateWorld();

    const flat = a.local.compose(b.local).compose(c.local);
    const p = new VecN([0.3, -1.2, 0.8, 2]);
    const viaWorld = c.world.applyToPoint(p.clone());
    const viaFlat = flat.applyToPoint(p.clone());
    for (let k = 0; k < 4; k++) expect(viaWorld.data[k]).toBeCloseTo(viaFlat.data[k]!, 11);
  });

  it('re-parenting detaches from the previous parent', () => {
    const scene = new SceneN(4);
    const a = new ObjectN(4);
    const b = new ObjectN(4);
    const child = new ObjectN(4);
    scene.add(a).add(b);
    a.add(child);
    b.add(child);
    expect(a.children).not.toContain(child);
    expect(b.children).toContain(child);
    expect(child.parent).toBe(b);
  });

  it('traverse visits every descendant exactly once', () => {
    const scene = new SceneN(4);
    const nodes = Array.from({ length: 5 }, () => new ObjectN(4));
    scene.add(nodes[0]!).add(nodes[1]!);
    nodes[0]!.add(nodes[2]!);
    nodes[2]!.add(nodes[3]!);
    nodes[1]!.add(nodes[4]!);
    const seen: ObjectN[] = [];
    scene.traverse((n) => seen.push(n));
    expect(seen.length).toBe(6);
    expect(new Set(seen).size).toBe(6);
  });

  it('rejects dimension mixing and self-parenting', () => {
    const a = new ObjectN(4);
    expect(() => a.add(new ObjectN(5))).toThrow(/dim/);
    expect(() => a.add(a)).toThrow(/itself/);
  });
});
