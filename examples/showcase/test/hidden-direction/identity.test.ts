import { VecN, type CellComplex, type CellGroup } from '@holotope/core';
import { Vector3, type BufferAttribute, type LineBasicMaterial, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createExperience, kindOf } from '../../src/hidden-direction/experience.js';
import { faceEdges } from '../../src/hidden-direction/identity.js';

/**
 * One source face, followed across the slice and the shadow.
 *
 * The block's eight 3-faces are cubes of its authored complex. In the slice a
 * triangle carries the cube it was cut from; in the shadow the same cube is
 * its own twelve edges, projected by the shadow's map. This file holds:
 *
 * - the edges a face highlight draws are exactly that cube's edges — checked
 *   against pairs of its vertices that differ in one coordinate, read from the
 *   positions, not from the complex's 1-cells the code reads;
 * - the highlight's endpoints are those edges projected into the current
 *   chart — checked against the chart written out from the slice's normal —
 *   and they follow the slice when it turns;
 * - every triangle the section draws picks back to a face the section cuts,
 *   in that face's colour, and focusing it names the face from its geometry;
 * - a face focus is a view action, ignored in the contact world, and the
 *   highlight exists only for the focused face of the turning world.
 *
 * What it does not prove: the pointer ray cast that finds the triangle (the
 * page's, in `app.ts`, which needs a DOM), or how the lines are rasterised.
 */

const AXES = ['x', 'y', 'z', 'w'] as const;
const key = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);

function cubeGroup(complex: CellComplex): CellGroup {
  return complex.cellsOfDim(3).find((g) => g.kind === 'cuboid' && g.verticesPerCell === 8)!;
}

function cubeVertices(complex: CellComplex, ordinal: number): number[] {
  const cubes = cubeGroup(complex);
  return Array.from({ length: 8 }, (_, k) => cubes.indices[ordinal * 8 + k]!);
}

const position = (complex: CellComplex, v: number): number[] => Array.from(complex.getPosition(v));

/** The cube's edges from geometry alone: pairs of its vertices that differ in exactly one coordinate. */
function oneAxisPairs(complex: CellComplex, ordinal: number): Set<string> {
  const vs = cubeVertices(complex, ordinal);
  const out = new Set<string>();
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const p = position(complex, vs[i]!);
      const q = position(complex, vs[j]!);
      if (p.filter((c, axis) => Math.abs(c - q[axis]!) > 1e-12).length === 1) out.add(key(vs[i]!, vs[j]!));
    }
  }
  return out;
}

/** The face's name from geometry: the one axis all eight vertices share, and the sign of that value. */
function faceNameOf(complex: CellComplex, ordinal: number): string {
  const ps = cubeVertices(complex, ordinal).map((v) => position(complex, v));
  const axis = [0, 1, 2, 3].find((a) => ps.every((p) => Math.abs(p[a]! - ps[0]![a]!) < 1e-12))!;
  return `${ps[0]![axis]! < 0 ? '−' : '+'}${AXES[axis]}`;
}

/**
 * The chart the shadow projects into, written out from the slice's normal.
 * The turn is a rotor in the x–w plane: the chart's axes are the reference
 * x, y, z turned by the rotor that took +w to n, so its first axis is
 * u = (n_w, 0, 0, −n_x) and its other two are y and z. The offset moves the
 * cut, not this projection (u·n = 0).
 */
function chartOf(normal: readonly number[], p: readonly number[]): [number, number, number] {
  expect(normal[1]).toBe(0);
  expect(normal[2]).toBe(0);
  return [normal[3]! * p[0]! - normal[0]! * p[3]!, p[1]!, p[2]!];
}

const rgbOf = (hex: string): [number, number, number] =>
  [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

describe('a face’s shadow is its own twelve edges, read from the complex', () => {
  it('each of the block’s eight cubes has exactly the twelve edges joining its vertices along one axis, none twice', () => {
    const x = createExperience('cuts');
    const complex = x.block.complex!;
    const edgeCells = new Set<string>();
    const ones = complex.cellsOfDim(1).find((g) => g.verticesPerCell === 2)!;
    for (let e = 0; e < ones.indices.length; e += 2) edgeCells.add(key(ones.indices[e]!, ones.indices[e + 1]!));
    expect(cubeGroup(complex).indices.length / 8).toBe(8);
    for (let k = 0; k < 8; k++) {
      const edges = faceEdges(complex, k);
      const members = new Set(cubeVertices(complex, k));
      expect(edges, `cube ${k}`).toHaveLength(12);
      for (const [a, b] of edges) {
        expect(members.has(a) && members.has(b), `cube ${k}: ${a}–${b} among its vertices`).toBe(true);
        expect(edgeCells.has(key(a, b)), `cube ${k}: ${a}–${b} is a 1-cell`).toBe(true);
      }
      const keys = edges.map(([a, b]) => key(a, b));
      expect(new Set(keys).size, `cube ${k}: no edge twice`).toBe(12);
      expect(new Set(keys), `cube ${k}: the edges geometry says`).toEqual(oneAxisPairs(complex, k));
    }
    x.dispose();
  });

  it('together the eight faces cover all 32 edges of the block, each edge shared by exactly three faces', () => {
    // In a 4-cube an edge runs along one axis with the other three fixed at an
    // end; the facets containing it are the three fixed at those ends.
    const x = createExperience('cuts');
    const complex = x.block.complex!;
    const ones = complex.cellsOfDim(1).find((g) => g.verticesPerCell === 2)!;
    const all = new Set<string>();
    for (let e = 0; e < ones.indices.length; e += 2) all.add(key(ones.indices[e]!, ones.indices[e + 1]!));
    expect(all.size).toBe(32);
    const count = new Map<string, number>();
    for (let k = 0; k < 8; k++) for (const [a, b] of faceEdges(complex, k)) count.set(key(a, b), (count.get(key(a, b)) ?? 0) + 1);
    expect(new Set(count.keys())).toEqual(all);
    for (const [edge, n] of count) expect(n, edge).toBe(3);
    x.dispose();
  });
});

describe('the highlight sits on the shadow, and is re-projected whenever the slice moves', () => {
  it('for each of the eight faces: its source edges, projected into the chart — at the reference, and again after a 30° turn and a 0.5 slide', () => {
    const x = createExperience('cuts');
    const complex = x.block.complex!;
    const slice = x.worlds.turn.slice;
    const shadowVertices = (): number[][] => x.worlds.turn.context.block!.vertexPositions();
    for (let k = 0; k < 8; k++) {
      x.dispatch({ type: 'cut-reset' });
      x.dispatch({ type: 'focus-face', ordinal: k });
      const edges = x.faceShadow.sourceEdges();
      expect(new Set(edges.map(([a, b]) => key(a, b))), `face ${k}`).toEqual(oneAxisPairs(complex, k));

      const check = (stage: string): number[][] => {
        const drawn = x.faceShadow.drawnEndpoints();
        const normal = Array.from(slice.normal.data);
        const shadow = shadowVertices();
        expect(drawn, `face ${k} ${stage}`).toHaveLength(24);
        edges.forEach(([a, b], i) => {
          for (const [slot, v] of [[2 * i, a], [2 * i + 1, b]] as const) {
            const want = chartOf(normal, position(complex, v));
            const byMap = x.worlds.turn.context.projection.projectPoint(complex.getPosition(v));
            for (let c = 0; c < 3; c++) {
              expect(drawn[slot]![c], `face ${k} ${stage}: vertex ${v} axis ${c}, written-out chart`).toBeCloseTo(want[c]!, 6);
              expect(drawn[slot]![c], `face ${k} ${stage}: vertex ${v} axis ${c}, the shadow’s map`).toBeCloseTo(byMap[c]!, 6);
              expect(drawn[slot]![c], `face ${k} ${stage}: vertex ${v} axis ${c}, on the shadow’s own line`).toBeCloseTo(shadow[v]![c]!, 6);
            }
          }
        });
        return drawn;
      };

      const before = check('at the reference');
      // Checked after the turn alone: the turn's own update must re-project, not the next one.
      x.dispatch({ type: 'cut-turn', degrees: 30 });
      expect(Array.from(slice.normal.data)[0]).toBeCloseTo(-0.5, 12);
      check('after the turn');
      x.dispatch({ type: 'cut-offset', value: 0.5 });
      const after = check('after the turn and slide');
      const moved = after.some((p, i) => p.some((c, j) => Math.abs(c - before[i]![j]!) > 1e-3));
      expect(moved, `face ${k}: the turn moved the projection`).toBe(true);
    }
    x.dispose();
  });
});

describe('picking a drawn triangle names the face it was cut from', () => {
  it('over six slices, the faces picked from every drawn triangle are exactly the faces the section cuts, each triangle in its face’s colour', () => {
    const x = createExperience('cuts');
    const complex = x.block.complex!;
    const poses: [number, number][] = [[0, 0], [20, 0.4], [36, 0], [50, -0.3], [90, 1.0], [-60, -1.2]];
    for (const [t, o] of poses) {
      x.dispatch({ type: 'cut-turn', degrees: t });
      x.dispatch({ type: 'cut-offset', value: o });
      const where = `${t}° at ${o}`;
      const mesh = x.block.object as Mesh;
      const positions = mesh.geometry.getAttribute('position') as BufferAttribute;
      const colours = mesh.geometry.getAttribute('color') as BufferAttribute;
      const count = x.view().bodies.find((b) => b.id === 'block')!.drawn;
      expect(count, where).toBeGreaterThan(0);
      const present = new Set(x.block.presentFaces);
      const picked = new Set<number>();
      for (let p = 0; p < count; p++) {
        const centroid = new Vector3();
        for (let s = 0; s < 3; s++) centroid.add(new Vector3(positions.getX(3 * p + s), positions.getY(3 * p + s), positions.getZ(3 * p + s)));
        centroid.divideScalar(3);
        const hit = x.block.pick({ point: centroid, faceIndex: p });
        expect(hit?.id, `${where}: triangle ${p}`).toBe('block');
        const face = hit!.face!;
        expect(present.has(face.ordinal), `${where}: triangle ${p} picks a cut face`).toBe(true);
        expect(face.name, `${where}: triangle ${p}`).toBe(faceNameOf(complex, face.ordinal));
        const rgb = rgbOf(face.colour);
        for (let s = 0; s < 3; s++) {
          for (let c = 0; c < 3; c++) {
            expect(colours.getComponent(3 * p + s, c), `${where}: triangle ${p} drawn in its face’s colour`).toBeCloseTo(rgb[c]!, 6);
          }
        }
        picked.add(face.ordinal);
      }
      expect([...picked].sort(), `${where}: every cut face can be picked`).toEqual([...present].sort());
    }
    x.dispose();
  });

  it('focusing a picked face names it from its geometry; the label and the slice share its colour, and its shadow is drawn in the slice’s colour over the solid', () => {
    const x = createExperience('cuts');
    const complex = x.block.complex!;
    for (const [t, o] of [[0, 0], [60, 0.2]] as const) {
      x.dispatch({ type: 'cut-turn', degrees: t });
      x.dispatch({ type: 'cut-offset', value: o });
      for (let p = 0; p < x.block.primitiveCount; p++) {
        const ordinal = x.block.pick({ point: new Vector3(), faceIndex: p })!.face!.ordinal;
        x.dispatch({ type: 'focus-face', ordinal });
        const face = x.view().face;
        expect(face, `${t}° triangle ${p}`).not.toBeNull();
        expect(face!.name, `${t}° triangle ${p}`).toBe(faceNameOf(complex, ordinal));
        const colours = (x.block.object as Mesh).geometry.getAttribute('color') as BufferAttribute;
        const rgb = rgbOf(face!.colour);
        for (let c = 0; c < 3; c++) expect(colours.getComponent(3 * p, c), `${t}° triangle ${p}: slice colour`).toBeCloseTo(rgb[c]!, 6);
        // The highlight is not the face's colour: the block's own shadow lines are drawn in the body's
        // colour, and the solid cut would hide the face it is cut from. It is the slice's colour, untested
        // against depth, so it stays visible over the solid.
        const highlight = x.faceShadow.object.material as LineBasicMaterial;
        expect(`#${highlight.color.getHexString()}`, `${t}° triangle ${p}: highlight colour`).toBe('#f1dfae');
        expect(highlight.depthTest, `${t}° triangle ${p}: drawn over the solid`).toBe(false);
      }
    }
    x.dispose();
  });
});

describe('a face focus is a view action', () => {
  /** World state a view action must not touch, read from the worlds' own objects. */
  function worldState(x: ReturnType<typeof createExperience>) {
    const t = x.worlds.turn;
    const c = x.worlds.contact;
    const probe = new VecN([0.3, -0.7, 1.1, 0.2]);
    return {
      turnNormal: Array.from(t.slice.normal.data),
      turnOffset: t.slice.offset,
      orbit: Array.from(t.products.find((p) => p.id === 'companion')!.position4()!),
      contactNormal: Array.from(c.slice.normal.data),
      contactOffset: c.slice.offset,
      steps: c.sim.steps,
      time: c.sim.time,
      impacts: c.sim.impacts,
      ballPosition: Array.from(c.sim.ball.position.data),
      ballVelocity: Array.from(c.sim.ball.linearVelocity.data),
      boxProbe: Array.from(c.sim.boxPose().applyToPoint(probe).data),
      study: [c.study.angle, c.study.mode, c.study.playing]
    };
  }

  it('is classed as a view action, and moves no slice, no orbit, no physics and starts no clock', () => {
    expect(kindOf({ type: 'focus-face', ordinal: 2 })).toBe('view');
    expect(kindOf({ type: 'focus-face', ordinal: null })).toBe('view');
    const x = createExperience('spin');
    x.dispatch({ type: 'jump-after' });          // the box is struck and moving
    x.dispatch({ type: 'chapter', id: 'free' }); // everything stays where it was left
    x.dispatch({ type: 'world', world: 'turn' });
    x.dispatch({ type: 'cut-turn', degrees: 20 });
    x.dispatch({ type: 'cut-offset', value: 0.3 });
    x.dispatch({ type: 'orbit-phase', degrees: 40 });
    const sim = x.worlds.contact.sim;
    const before = worldState(x);
    x.dispatch({ type: 'focus-face', ordinal: 3 });
    x.dispatch({ type: 'tick', seconds: 0.05 });   // a frame: only a running clock would move
    x.dispatch({ type: 'focus-face', ordinal: null });
    x.dispatch({ type: 'tick', seconds: 0.05 });
    expect(x.worlds.contact.sim).toBe(sim);
    expect(worldState(x)).toEqual(before);
    expect(x.view().clock.playing).toBe(false);
    x.dispose();
  });

  it('in the contact world it is ignored, not deferred: returning to the turning world shows no face', () => {
    const x = createExperience('free');
    x.dispatch({ type: 'world', world: 'contact' });
    x.dispatch({ type: 'focus-face', ordinal: 3 });
    expect(x.view().face).toBeNull();
    expect(x.faceShadow.sourceEdges()).toHaveLength(0);
    expect(x.faceShadow.object.visible).toBe(false);
    x.dispatch({ type: 'world', world: 'turn' });
    expect(x.view().face).toBeNull();
    expect(x.faceShadow.sourceEdges()).toHaveLength(0);
    expect(x.faceShadow.object.visible).toBe(false);
    x.dispose();
  });
});

describe('the highlight is drawn only in the turning world, and only for the focused face', () => {
  it('shows twelve edges for a focused face, none after the focus is cleared, and none once the contact world is in front', () => {
    const x = createExperience('free');
    expect(x.faceShadow.sourceEdges()).toHaveLength(0);
    x.dispatch({ type: 'focus-face', ordinal: 5 });
    expect(x.faceShadow.sourceEdges()).toHaveLength(12);
    expect(x.faceShadow.object.visible).toBe(true);
    x.dispatch({ type: 'focus-face', ordinal: null });
    expect(x.faceShadow.sourceEdges()).toHaveLength(0);
    expect(x.faceShadow.object.visible).toBe(false);
    expect(x.view().face).toBeNull();

    x.dispatch({ type: 'focus-face', ordinal: 5 });
    x.dispatch({ type: 'world', world: 'contact' });
    expect(x.faceShadow.sourceEdges()).toHaveLength(0);
    expect(x.faceShadow.object.visible).toBe(false);
    expect(x.view().face).toBeNull();
    x.dispose();
  });

  it('a chapter in the contact world clears the focus it found', () => {
    const x = createExperience('cuts');
    x.dispatch({ type: 'focus-face', ordinal: 1 });
    expect(x.faceShadow.sourceEdges()).toHaveLength(12);
    x.dispatch({ type: 'chapter', id: 'collision' });
    expect(x.faceShadow.sourceEdges()).toHaveLength(0);
    expect(x.view().face).toBeNull();
    x.dispatch({ type: 'chapter', id: 'cuts' });
    expect(x.faceShadow.sourceEdges()).toHaveLength(0);
    expect(x.view().face).toBeNull();
    x.dispose();
  });
});
