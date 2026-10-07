import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { DRAW_ORDER, TRANSPARENT_OBJECT_BUDGET } from '../../src/flatland/draw-order.js';
import { createExperience, type Experience } from '../../src/flatland/journey.js';
import { createPicture, modelToThree } from '../../src/flatland/picture.js';

/**
 * What the picture actually holds, read back from its own buffers: the cut is
 * the library's section, cell for cell; the shadow is every source edge
 * dropped along the missing direction; neither is the other. Moving the camera
 * or changing what the picture includes changes no world. The draw order does
 * not depend on where the slice is.
 */

const TOL = 1e-5; // the picture's buffers are 32-bit

const close = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, k) => Math.abs(x - b[k]!) <= TOL);
/** Segments match as unordered sets of unordered endpoint pairs. */
function sameSegments(drawn: readonly (readonly number[])[], expected: readonly (readonly [readonly number[], readonly number[]])[]): boolean {
  if (drawn.length !== expected.length) return false;
  return expected.every(([p, q]) => drawn.some((d) => (close(d.slice(0, 3), p.slice(0, 3)) && close(d.slice(3), q.slice(0, 3))) || (close(d.slice(0, 3), q.slice(0, 3)) && close(d.slice(3), p.slice(0, 3)))));
}

function states(x: Experience, rung: 'plane' | 'space'): (() => void)[] {
  const out: (() => void)[] = [];
  for (const angle of [0, 0.37, rung === 'plane' ? Math.acos(1 / Math.sqrt(3)) : Math.PI / 3, Math.PI / 2]) {
    for (const h of [-1.9, -1.2, -0.5, 0, 0.45, 1.5, 2.05]) {
      out.push(() => { x.dispatch({ type: 'tip-to', angle }); x.dispatch({ type: 'slide-to', offset: h }); });
    }
  }
  return out;
}

function setUp(rung: 'plane' | 'space'): { x: Experience; picture: ReturnType<typeof createPicture> } {
  const x = createExperience('free', { instantTurns: true });
  x.dispatch({ type: 'rung', id: rung });
  x.dispatch({ type: 'shadow', on: true });
  return { x, picture: createPicture(x) };
}

describe('the cut drawn is the library’s section, cell for cell', () => {
  it('in the plane: the section’s triangles, its sides between its corners, in the slice', () => {
    const { x, picture } = setUp('plane');
    let drawn = 0;
    for (const set of states(x, 'plane')) {
      set();
      const v = x.view();
      picture.update(v);
      const r = x.worlds.plane.drawn.result;
      const expected: number[][] = [];
      for (let t = 0; t < r.cellCount; t++) {
        const tri: number[] = [];
        for (let k = 0; k < 3; k++) { const i = r.cells[t * 3 + k]!; tri.push(r.ambientPositions[i * 3]!, r.ambientPositions[i * 3 + 1]!, r.ambientPositions[i * 3 + 2]!); }
        expected.push(tri);
      }
      const got = picture.probe.cutTriangles();
      expect(got.length).toBe(expected.length);
      got.forEach((tri, i) => expect(close(tri, expected[i]!)).toBe(true));
      for (const tri of got) for (let k = 2; k < 9; k += 3) expect(Math.abs(tri[k]! - v.offset)).toBeLessThan(TOL);
      expect(sameSegments(picture.probe.cutSides(), v.cut.edges.map((e) => [v.cut.corners[e.a]!.at, v.cut.corners[e.b]!.at] as const))).toBe(true);
      expect(picture.probe.cutCorners().map((d) => d.at)).toEqual(v.cut.corners.map((c) => c.at.map((q) => Math.fround(q))));
      if (got.length > 0) drawn += 1;
    }
    expect(drawn).toBeGreaterThan(10);
  });

  it('in space: the chart’s own mesh, each triangle in its cell’s colour, and the cut’s edges', () => {
    const { x, picture } = setUp('space');
    const space = x.worlds.space;
    expect(picture.root.getObjectById(space.chart.object.id)).toBe(space.chart.object);
    for (const set of states(x, 'space')) {
      set();
      const v = x.view();
      picture.update(v);
      const section = space.chart.section;
      expect(space.chart.geometry.drawRange.count).toBe(section.cellCount * 3);
      const colour = space.chart.geometry.getAttribute('color');
      for (let p = 0; p < section.cellCount; p++) {
        const rgb = space.faceOfPrimitive(p).rgb;
        for (let k = 0; k < 3; k++) expect(close([colour.getX(p * 3 + k), colour.getY(p * 3 + k), colour.getZ(p * 3 + k)], rgb)).toBe(true);
      }
      expect(sameSegments(picture.probe.cutSides(), v.cut.edges.map((e) => [v.cut.corners[e.a]!.at, v.cut.corners[e.b]!.at] as const))).toBe(true);
      expect(space.chart.object.visible).toBe(section.cellCount > 0);
    }
  });

  it('lights exactly the cube edges the plane crosses: one for each corner of the cut', () => {
    const { x, picture } = setUp('plane');
    for (const set of states(x, 'plane')) {
      set();
      const v = x.view();
      picture.update(v);
      const lit = picture.probe.crossedEdges();
      // Each crossed edge is drawn in two parts, split at the plane.
      expect(lit.length).toBe(2 * v.cut.crossedEdges.length);
      for (const [a, b] of v.cut.crossedEdges) {
        const p = v.corners[a]!.posed;
        const q = v.corners[b]!.posed;
        expect(lit.some((s) => close(s.slice(0, 3), [...p]) || close(s.slice(3), [...p]))).toBe(true);
        expect(lit.some((s) => close(s.slice(0, 3), [...q]) || close(s.slice(3), [...q]))).toBe(true);
      }
    }
  });
});

describe('the shadow drawn is every source edge dropped along the missing direction', () => {
  it('draws each projected edge once, and a dot where corners land, larger where several do', () => {
    for (const rung of ['plane', 'space'] as const) {
      const { x, picture } = setUp(rung);
      for (const set of states(x, rung)) {
        set();
        const v = x.view();
        picture.update(v);
        expect(picture.probe.shadowEdges().length).toBe(rung === 'plane' ? 12 : 32);
        expect(sameSegments(picture.probe.shadowEdges(), v.shadow.segments)).toBe(true);
        const dots = picture.probe.shadowPoints();
        expect(dots.length).toBe(v.shadow.points.length);
        dots.forEach((d, i) => {
          expect(close(d.at, v.shadow.points[i]!.at.slice(0, 3))).toBe(true);
          expect(d.radius > 0.05).toBe(v.shadow.points[i]!.corners.length > 1);
        });
      }
    }
  });

  it('is not the cut: the shadow’s points are the corners’ drops, the cut’s are crossings', () => {
    const { x, picture } = setUp('plane');
    x.dispatch({ type: 'pose', pose: 'corner' });
    x.dispatch({ type: 'slide-to', offset: 0.3 });
    const v = x.view();
    picture.update(v);
    const shadow = picture.probe.shadowPoints().map((d) => d.at);
    const cut = picture.probe.cutCorners().map((d) => d.at);
    // Seven shadow points, six cut corners, and no cut corner where a shadow point is.
    expect([shadow.length, cut.length]).toEqual([7, 6]);
    expect(cut.some((c) => shadow.some((s) => close(c, s)))).toBe(false);
    for (const p of shadow) expect(v.corners.some((c) => close([c.posed[0]!, c.posed[1]!], p.slice(0, 2)))).toBe(true);
  });

  it('draws nothing of the shadow while it is hidden', () => {
    const { x, picture } = setUp('space');
    x.dispatch({ type: 'shadow', on: false });
    picture.update(x.view());
    expect(picture.probe.shadowEdges()).toEqual([]);
    expect(picture.probe.shadowPoints()).toEqual([]);
  });
});

describe('the camera and the picture’s presentation change no source', () => {
  it('draws the same, and leaves every world bitwise, however the camera moves', () => {
    for (const rung of ['plane', 'space'] as const) {
      const { x, picture } = setUp(rung);
      x.dispatch({ type: 'tip-to', angle: 0.6 });
      x.dispatch({ type: 'slide-to', offset: 0.2 });
      const w = x.worlds[rung];
      const source = Array.from(w.source.positions);
      const posed = w.corners().map((c) => [...c.posed]);
      const placed = { tip: w.tip, offset: w.offset, cut: w.cut().corners.map((c) => [...c.at]) };
      picture.update(x.view());
      const before = [picture.probe.cutSides(), picture.probe.shadowEdges(), picture.probe.cutCorners()];
      const camera = new PerspectiveCamera(40, 1.5, 0.1, 100);
      for (const [px, py, pz] of [[5, 4, 6], [-7, 1, 2], [0, 9, 0.1], [2, -6, -3]]) {
        camera.position.set(px!, py!, pz!);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        for (const p of picture.pickables(x.view())) modelToThree(p.at).project(camera);
        for (const a of picture.anchors(x.view())) for (const p of a.at) modelToThree(p).project(camera);
        x.dispatch({ type: 'look' });
        picture.update(x.view());
      }
      expect([picture.probe.cutSides(), picture.probe.shadowEdges(), picture.probe.cutCorners()]).toEqual(before);
      expect(Array.from(w.source.positions)).toEqual(source);
      expect(w.corners().map((c) => [...c.posed])).toEqual(posed);
      expect({ tip: w.tip, offset: w.offset, cut: w.cut().corners.map((c) => [...c.at]) }).toEqual(placed);
    }
  });

  it('hides the cube without moving it, and shows it again where it was', () => {
    const x = createExperience('shadow', { instantTurns: true });
    const picture = createPicture(x);
    picture.update(x.view());
    const edges = picture.probe.cubeEdges();
    expect(edges.length).toBeGreaterThan(0);
    x.dispatch({ type: 'show-object', on: false });
    picture.update(x.view());
    expect(picture.probe.cubeEdges()).toEqual([]);
    expect(picture.probe.cutCorners().length).toBe(6);
    x.dispatch({ type: 'show-object', on: true });
    picture.update(x.view());
    expect(picture.probe.cubeEdges()).toEqual(edges);
  });
});

describe('the draw order is fixed by construction', () => {
  it('holds one transparent object, the cube’s faces, and the same order at every slide, through zero', () => {
    const { x, picture } = setUp('plane');
    let reference: Record<string, number> | null = null;
    for (const h of [-1.5, -0.001, -1e-9, 0, 1e-9, 0.001, 1.5]) {
      x.dispatch({ type: 'slide-to', offset: h });
      picture.update(x.view());
      const transparent = picture.probe.transparentObjects();
      expect(transparent.length).toBe(TRANSPARENT_OBJECT_BUDGET);
      expect(transparent[0]!.name).toBe('the cube, faces');
      expect(transparent[0]!.renderOrder).toBe(DRAW_ORDER.cubeFaces);
      const orders = picture.probe.renderOrders();
      reference ??= orders;
      expect(orders).toEqual(reference);
    }
  });

  it('draws the space rung’s shadow over the cut, opaque, after it', () => {
    const { x, picture } = setUp('space');
    picture.update(x.view());
    const orders = picture.probe.renderOrders();
    expect(orders['the shadow']).toBe(DRAW_ORDER.shadowOver);
    expect(orders['the cut']).toBe(DRAW_ORDER.section);
    expect(DRAW_ORDER.shadowOver).toBeGreaterThan(DRAW_ORDER.section);
    expect(DRAW_ORDER.shadowOver).toBeLessThan(DRAW_ORDER.cubeFaces);
  });
});

describe('a pick lights its source', () => {
  it('lights the cube edge a cut corner lies on', () => {
    const { x, picture } = setUp('plane');
    x.dispatch({ type: 'pose', pose: 'corner' });
    x.dispatch({ type: 'slide-to', offset: -1.2 });
    x.dispatch({ type: 'inspect', target: { kind: 'cut-corner', index: 0 } });
    const v = x.view();
    picture.update(v);
    // The edge the cut corner's own lineage names, not the one the inspection repeats.
    const [a, b] = v.cut.corners[0]!.on as [number, number];
    expect(sameSegments(picture.probe.highlighted(), [[v.corners[a]!.posed, v.corners[b]!.posed]])).toBe(true);
  });

  it('lights the light’s path from every corner that lands on a picked point', () => {
    const x = createExperience('shadow', { instantTurns: true });
    const picture = createPicture(x);
    const centre = x.view().shadow.points.findIndex((p) => p.corners.length === 2);
    x.dispatch({ type: 'inspect', target: { kind: 'shadow-point', index: centre } });
    const v = x.view();
    picture.update(v);
    const point = v.shadow.points[centre]!;
    expect(sameSegments(picture.probe.highlighted(), point.corners.map((i) => [v.corners[i]!.posed, point.at] as const))).toBe(true);
  });

  it('one rung up, lights the shadow of the edge a cut corner lies on, and nothing while the shadow is hidden', () => {
    const { x, picture } = setUp('space');
    x.dispatch({ type: 'pose', pose: 'corner' });
    x.dispatch({ type: 'slide-to', offset: -1.5 });
    x.dispatch({ type: 'inspect', target: { kind: 'cut-corner', index: 1 } });
    let v = x.view();
    const [a, b] = v.cut.corners[1]!.on as [number, number];
    const k = v.shadow.edges.findIndex(([p, q]) => (p === a && q === b) || (p === b && q === a));
    expect(k).toBeGreaterThanOrEqual(0);
    expect(v.inspection!.edges).toEqual([[a, b]]);
    picture.update(v);
    expect(sameSegments(picture.probe.highlighted(), [v.shadow.segments[k]!])).toBe(true);
    x.dispatch({ type: 'shadow', on: false });
    x.dispatch({ type: 'inspect', target: { kind: 'cut-corner', index: 1 } });
    v = x.view();
    picture.update(v);
    expect(picture.probe.highlighted()).toEqual([]);
  });
});

describe('an open question is not answered by the picture', () => {
  it('draws no pile-up larger and tags none while the question about pile-ups is open, and does once it is answered', () => {
    for (const chapter of ['shadow', 'up-shadow'] as const) {
      const x = createExperience(chapter, { instantTurns: true });
      const picture = createPicture(x);
      let v = x.view();
      picture.update(v);
      expect(v.withhold).toBe(true);
      expect(new Set(picture.probe.shadowPoints().map((d) => d.radius)).size).toBe(1);
      expect(picture.anchors(v).filter((a) => a.id === 'pile')).toEqual([]);
      // The step points the place out first (still open, still withheld), then shows what lands there.
      x.dispatch(v.prediction!.test!.action);
      v = x.view();
      expect(v.prediction!.revealed).toBe(false);
      expect(v.withhold).toBe(true);
      picture.update(v);
      expect(new Set(picture.probe.shadowPoints().map((d) => d.radius)).size).toBe(1);
      x.dispatch(v.prediction!.test!.action);
      v = x.view();
      expect(v.prediction!.revealed).toBe(true);
      expect(v.withhold).toBe(false);
      x.dispatch({ type: 'inspect', target: null });
      v = x.view();
      picture.update(v);
      expect(picture.anchors(v).filter((a) => a.id === 'pile').length).toBe(v.shadow.points.filter((p) => p.corners.length > 1).length);
      expect(picture.probe.shadowPoints().some((d) => d.radius > 0.05)).toBe(true);
    }
  });
});

describe('a point pointed out is ringed, and nothing more (D-1)', () => {
  it('draws a ring round the point in its slice, says nothing of what lands there, and lets it go on a pick', () => {
    for (const [chapter, circles] of [['shadow', 1], ['up-shadow', 3]] as const) {
      const x = createExperience(chapter, { instantTurns: true });
      const picture = createPicture(x);
      picture.update(x.view());
      expect(picture.probe.attention()).toEqual([]);
      x.dispatch(x.view().prediction!.test!.action);
      const v = x.view();
      picture.update(v);
      const ring = picture.probe.attention();
      expect(ring.length).toBe(40 * circles);
      const centre = v.shadow.points[(v.attention as { index: number }).index]!.at;
      for (const seg of ring) {
        for (const end of [seg.slice(0, 3), seg.slice(3)]) {
          expect(Math.hypot(...end.map((q, k) => q - centre[k]!))).toBeCloseTo(0.17, 5);
          // In the plane the ring lies in the plane itself.
          if (circles === 1) expect(end[2]).toBeCloseTo(v.offset, 5);
        }
      }
      expect(v.inspection).toBeNull();
      expect(picture.probe.highlighted()).toEqual([]);
      x.dispatch(v.prediction!.test!.action);
      picture.update(x.view());
      expect(picture.probe.attention()).toEqual([]);
    }
  });

  it('after a pick that does not answer, Point out lights the ring alone: the earlier point’s light goes with its line (D-8)', () => {
    const x = createExperience('shadow', { instantTurns: true });
    const picture = createPicture(x);
    const single = x.view().shadow.points.findIndex((p) => p.corners.length === 1);
    x.dispatch({ type: 'inspect', target: { kind: 'shadow-point', index: single } });
    picture.update(x.view());
    expect(x.view().inspection?.text).toMatch(/^One corner lands here/);
    expect(picture.probe.highlighted().length).toBeGreaterThan(0);
    x.dispatch(x.view().prediction!.test!.action);
    const v = x.view();
    picture.update(v);
    expect((v.attention as { index: number }).index).not.toBe(single);
    expect(v.inspection).toBeNull();
    expect(picture.probe.highlighted()).toEqual([]);
    expect(picture.probe.attention().length).toBe(40);
  });
});
