import { describe, expect, it } from 'vitest';
import { MatN, Rotor4, TransformN, VecN } from '@holotope/core';
import { HyperboxSupportShape4 } from '../src/hyperbox4.js';
import { hyperboxContactPatch4 } from '../src/hyperbox-contact4.js';
import {
  intersectContactHalfspaces4,
  type ContactHalfspace4
} from '../src/contact-polyhedron4.js';
import {
  HyperboxCollider4,
  HyperboxContactPipeline4,
  PhysicsWorld4,
  RigidBody4
} from '../src/index.js';

/**
 * A facet tilted from the contact plane by less than `rankTolerance` is too
 * nearly parallel to meet two others in a well-conditioned vertex, so the
 * clipper leaves it out of vertex generation. It used to be judged once, by
 * its value at the chart's origin: the foot of the WORLD origin on the plane.
 * The facet is not constant across the plane, though. It changes by its tilt
 * times the distance moved, so that value is off by about θ·d, where d is the
 * distance from the world origin to the contact. When θ·d passed the 1e-9
 * feasibility band with the wrong sign, the clipper threw "contact plane lies
 * outside a supplied halfspace" for a box resting on a floor. With a 5e-11
 * tilt that happens at x = −40 but not at +40.
 *
 * The facet is now judged where the patch is, at every candidate vertex,
 * with the same band as every other halfspace. Nothing is widened. The cases
 * below hold that contract in both directions: ordinary contact far from the
 * origin returns its patch, and geometry outside the band still fails.
 */

const BOX_HALF = [0.4, 0.5, 0.6, 0.7] as const;
const DEFAULTS = {
  feasibilityTolerance: 1e-9,
  vertexTolerance: 1e-8,
  rankTolerance: 1e-10,
  maxSolverPoints: 8
} as const;

/** A box resting `depth` into a floor slab, at `x` along it, turned `tilt` in x-y. */
function room(options: {
  readonly x: number;
  readonly tilt: number;
  readonly scale?: number;
  readonly depth?: number;
}): { readonly box: HyperboxSupportShape4; readonly floor: HyperboxSupportShape4 } {
  const scale = options.scale ?? 1;
  const depth = options.depth ?? 2e-3 * scale;
  const rotation = options.tilt === 0
    ? Rotor4.identity()
    : Rotor4.fromPlanes([{ i: 0, j: 1, angle: options.tilt }]);
  return {
    box: new HyperboxSupportShape4(
      BOX_HALF.map((h) => h * scale),
      new TransformN(
        4,
        rotation,
        new VecN([options.x, 0.5 * scale - depth, 1 * scale, 0.5 * scale])
      )
    ),
    floor: new HyperboxSupportShape4(
      [2000 * scale, 0.5 * scale, 50 * scale, 50 * scale],
      new TransformN(4, Rotor4.identity(), new VecN([0, -0.5 * scale, 0, 0]))
    )
  };
}

/** How far outside `shape`, moved by `shift`, the point lies. Negative is inside. */
function outsideBy(point: VecN, shape: HyperboxSupportShape4, shift?: VecN): number {
  const center = shift ? shape.center.add(shift) : shape.center;
  const local = point.clone().sub(center);
  const axes = shape.worldAxes();
  let worst = -Infinity;
  for (let axis = 0; axis < 4; axis++) {
    worst = Math.max(worst, Math.abs(axes[axis]!.dot(local)) - shape.halfExtents[axis]!);
  }
  return worst;
}

/** Patch of (a, b) plus its worst containment in both resolved bodies. */
function patchOf(a: HyperboxSupportShape4, b: HyperboxSupportShape4) {
  const result = hyperboxContactPatch4(a, b);
  const patch = result.patch;
  if (patch === null) return { result, patch, outside: NaN };
  let outside = -Infinity;
  for (const vertex of patch.vertices) {
    outside = Math.max(
      outside,
      outsideBy(vertex.point, a, patch.translationA),
      outsideBy(vertex.point, b),
      Math.abs(patch.normal.dot(vertex.point) - patch.planeOffset)
    );
  }
  return { result, patch, outside };
}

function halfspacesOf(shape: HyperboxSupportShape4): ContactHalfspace4[] {
  const axes = shape.worldAxes();
  const result: ContactHalfspace4[] = [];
  for (let axis = 0; axis < 4; axis++) {
    for (const sign of [1, -1]) {
      const normal = axes[axis]!.clone().multiplyScalar(sign);
      result.push({ normal, offset: shape.halfExtents[axis]! + normal.dot(shape.center) });
    }
  }
  return result;
}

describe('a nearly parallel facet is judged where the patch is', () => {
  it('W3: a box resting on a floor gets the same patch at x = ±5, ±40, ±1000, in both orders', () => {
    for (const tilt of [5e-11, -5e-11]) {
      const reference = room({ x: 0, tilt });
      const referenceBoxFloor = patchOf(reference.box, reference.floor).patch!;
      const referenceFloorBox = patchOf(reference.floor, reference.box).patch!;
      for (const x of [5, -5, 40, -40, 1000, -1000]) {
        const { box, floor } = room({ x, tilt });
        for (const [order, a, b, expected] of [
          ['box,floor', box, floor, referenceBoxFloor],
          ['floor,box', floor, box, referenceFloorBox]
        ] as const) {
          const label = `${order} x=${x} tilt=${tilt}`;
          const reading = patchOf(a, b);
          expect(reading.patch, label).not.toBeNull();
          // SAT is untouched: B's floor facet in one order, A's in the other.
          expect(reading.result.sat.source.featureClass, label)
            .toBe(order === 'box,floor' ? 'facet-b' : 'facet-a');
          expect(reading.patch!.intrinsicDim, label).toBe(3);
          expect(reading.patch!.vertices.map(({ id }) => id), label)
            .toEqual(expected.vertices.map(({ id }) => id));
          // The same patch, carried along the floor by x.
          for (let index = 0; index < expected.vertices.length; index++) {
            const moved = expected.vertices[index]!.point.clone().add(new VecN([x, 0, 0, 0]));
            const got = reading.patch!.vertices[index]!.point;
            for (let axis = 0; axis < 4; axis++) {
              expect(Math.abs(got.data[axis]! - moved.data[axis]!), label)
                .toBeLessThan(1e-12 * Math.max(1, Math.abs(x)));
            }
          }
          expect(reading.outside, label).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('W1 and W2, rebuilt bit for bit from the C2-TIE review cases, in both orders', () => {
    // Saved #5010 (scale 1, offset 300, θ = 1e-11) and #7872 (scale 1000,
    // offset 0, θ = 1e-11): the world axes and centres exactly as stored, set
    // as the rotation matrix so no rotor round trip intervenes.
    const W1 = {
      a: {
        c: [269.0042640600285, 65.91279271142025, -112.31176959602264, -26.04373407777303],
        h: [0.4, 0.5, 0.6, 0.7],
        axes: [
          [0.8648917440900883, -0.12062821659096527, 0.10416625940721763, 0.47598371271294204],
          [-0.44541925291510753, -0.2706665362872893, -0.28727137612017634, 0.803627072545972],
          [0.21691180844977304, 0.2664232513098598, -0.9310595768222107, -0.12286571093750279],
          [-0.08070456921638108, 0.9171734354296399, 0.19938056893983963, 0.3354505188235908]
        ]
      },
      b: {
        c: [269.72212420762696, 65.812671291652, -112.22531160071227, -25.64866759622796],
        h: [0.45, 0.55, 0.65, 0.75],
        axes: [
          [0.8648917440945425, -0.1206282165882586, 0.10416625941009033, 0.47598371270490586],
          [-0.4454192529064587, -0.2706665362884955, -0.2872713761191347, 0.803627072550732],
          [0.216911808449773, 0.26642325130985983, -0.9310595768222107, -0.12286571093750279],
          [-0.08070456921638108, 0.9171734354296399, 0.1993805689398397, 0.33545051882359084]
        ]
      },
      depth: 0.02000000000501101,
      diagnostics: {
        axesGenerated: 56, axesTested: 12, degenerateAxesSkipped: 16, duplicateAxesSkipped: 28
      },
      dim: 3,
      vertices: 8
    };
    const W2 = {
      a: {
        c: [0, 0, 0, 0],
        h: [400, 500, 600, 700],
        axes: [
          [0.015556006306399722, -0.6599833011565659, -0.3598195375268861, -0.659325377394359],
          [0.007222996009101479, -0.5265808270580487, -0.4041887215764554, 0.7478582340617129],
          [-0.013283620572418608, 0.5354304425622938, -0.8409246888039981, -0.07735279155875724],
          [0.9997646645190732, 0.021187636651800568, -0.0026543406387776747, 0.0038280684357570316]
        ]
      },
      b: {
        c: [12.911485234251835, -547.7861399555791, -298.6502161439607, -547.2400632435254],
        h: [450, 550, 650, 750],
        axes: [
          [0.015556006306327516, -0.6599833011513, -0.3598195375228442, -0.6593253774018378],
          [0.007222996009257021, -0.5265808270646486, -0.4041887215800536, 0.7478582340551196],
          [-0.013283620572418664, 0.5354304425622938, -0.8409246888039981, -0.07735279155875724],
          [0.9997646645190733, 0.02118763665180061, -0.0026543406387776747, 0.0038280684357570732]
        ]
      },
      depth: 20.00000000500006,
      diagnostics: {
        axesGenerated: 56, axesTested: 8, degenerateAxesSkipped: 16, duplicateAxesSkipped: 32
      },
      // A 1e-11 tilt rises 1e-11 × 800 = 8e-9 across this face, well past the
      // 1e-9 band. So the patch is the exact contact set, the lowest 2-face,
      // and not the whole facet.
      dim: 2,
      vertices: 4
    };
    const build = (box: { c: number[]; h: number[]; axes: number[][] }) => {
      const rotation = new MatN(4);
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 4; column++) {
          rotation.data[row * 4 + column] = box.axes[column]![row]!;
        }
      }
      const shape = new HyperboxSupportShape4(box.h, new TransformN(4, rotation, new VecN(box.c)));
      expect(shape.worldAxes().map((axis) => Array.from(axis.data))).toEqual(box.axes);
      return shape;
    };
    for (const [name, saved] of [['W1', W1], ['W2', W2]] as const) {
      const a = build(saved.a);
      const b = build(saved.b);
      for (const [order, x, y] of [['ab', a, b], ['ba', b, a]] as const) {
        const label = `${name} ${order}`;
        const reading = patchOf(x, y);
        // SAT selection and founder diagnostics exactly as the accepted candidate recorded them.
        const sat = reading.result.sat;
        expect(sat.status, label).toBe('overlapping');
        expect(sat.source.featureClass, label).toBe(order === 'ab' ? 'facet-b' : 'facet-a');
        expect(Array.from(order === 'ab' ? sat.source.axesB : sat.source.axesA), label).toEqual([0]);
        expect(sat.penetrationDepth, label).toBe(saved.depth);
        expect(sat.diagnostics, label).toEqual(saved.diagnostics);
        expect(reading.patch, label).not.toBeNull();
        expect(reading.patch!.intrinsicDim, label).toBe(saved.dim);
        expect(reading.patch!.vertices, label).toHaveLength(saved.vertices);
        expect(reading.outside, label).toBeLessThan(1e-9 * Math.max(1, ...saved.a.c.map(Math.abs)));
      }
    }
  });

  it('tilts either side of rankTolerance, and exact parallel, agree at +x and −x', () => {
    // 9e-11 and 1e-10 are left out of vertex generation, while 1.1e-10 and
    // above take part in it. Exactly parallel (0) never depended on the chart.
    for (const tilt of [0, 9e-11, 1e-10, 1.1e-10, 2e-10, 1e-9]) {
      for (const x of [40, 1000]) {
        for (const order of ['box,floor', 'floor,box'] as const) {
          const readings = [x, -x].map((at) => {
            const { box, floor } = room({ x: at, tilt });
            return order === 'box,floor' ? patchOf(box, floor) : patchOf(floor, box);
          });
          const label = `${order} ±${x} tilt=${tilt}`;
          for (const reading of readings) {
            expect(reading.patch, label).not.toBeNull();
            expect(reading.outside, label).toBeLessThan(1e-9);
          }
          expect(readings[1]!.patch!.intrinsicDim, label).toBe(readings[0]!.patch!.intrinsicDim);
          expect(readings[1]!.patch!.vertices.length, label)
            .toBe(readings[0]!.patch!.vertices.length);
        }
      }
    }
  });

  it('scaled rooms keep their patch under translation', () => {
    // At scale 100 the 5e-11 tilt rises 4e-9 across the box, past the band,
    // so the exact lowest 2-face is returned on both sides.
    for (const [scale, dim] of [[0.01, 3], [1, 3], [100, 2]] as const) {
      for (const order of ['box,floor', 'floor,box'] as const) {
        const readings = [40 * scale, -40 * scale, 1000 * scale, -1000 * scale].map((x) => {
          const { box, floor } = room({ x, tilt: 5e-11, scale });
          return order === 'box,floor' ? patchOf(box, floor) : patchOf(floor, box);
        });
        for (const reading of readings) {
          const label = `${order} scale=${scale}`;
          expect(reading.patch, label).not.toBeNull();
          expect(reading.patch!.intrinsicDim, label).toBe(dim);
          expect(reading.outside, label).toBeLessThan(1e-9 * Math.max(1, scale));
        }
      }
    }
  });
});

describe('geometry outside the band still fails', () => {
  /**
   * The box's halfspaces with its bottom `gap` above the floor's top plane,
   * clipped in that plane together with the floor's own halfspaces.
   */
  function hovering(x: number, tilt: number, gap: number) {
    const { box, floor } = room({ x, tilt, depth: -gap });
    return () => intersectContactHalfspaces4(
      new VecN([0, 1, 0, 0]),
      0,
      [...halfspacesOf(box), ...halfspacesOf(floor)],
      DEFAULTS
    );
  }

  it('a box hovering past the band is refused at every x; inside the band it is accepted', () => {
    for (const tilt of [0, 5e-11, -5e-11]) {
      for (const x of [0, 40, -40, 1000, -1000]) {
        const label = `x=${x} tilt=${tilt}`;
        for (const gap of [2e-9, 1e-6]) {
          expect(hovering(x, tilt, gap), `${label} gap=${gap}`)
            .toThrow('contact plane lies outside a supplied halfspace');
        }
        // 5e-10 is inside the 1e-9 feasibility band, and the tilt adds at most
        // 5e-11 × 0.8 across the box, so the plane still touches it.
        expect(hovering(x, tilt, 5e-10)().intrinsicDim, label).toBe(3);
      }
    }
  });

  it('disjoint in-plane regions still fail to enumerate, distinctly', () => {
    // Not a nearly parallel facet at all: the two footprints miss each other
    // along z. That is the other failure, and it keeps its own message.
    const { box, floor } = room({ x: -40, tilt: 5e-11, depth: 0 });
    const away = new HyperboxSupportShape4(
      floor.halfExtents.map((h, axis) => (axis === 2 ? 0.1 : h)),
      new TransformN(4, Rotor4.identity(), new VecN([0, -0.5, 10, 0]))
    );
    expect(() => intersectContactHalfspaces4(
      new VecN([0, 1, 0, 0]),
      0,
      [...halfspacesOf(box), ...halfspacesOf(away)],
      DEFAULTS
    )).toThrow('failed to enumerate a bounded contact patch');
  });

  it('separated pairs report no patch, far from the origin as near it', () => {
    for (const x of [0, -40, 40, -1000]) {
      const { box, floor } = room({ x, tilt: 5e-11, depth: -1e-6 });
      for (const [a, b] of [[box, floor], [floor, box]] as const) {
        const result = hyperboxContactPatch4(a, b);
        expect(result.sat.status, `x=${x}`).toBe('separated');
        expect(result.patch, `x=${x}`).toBeNull();
      }
    }
  });
});

describe('the pipeline steps the room', () => {
  it('a resting box at x = −40 steps in either collider order, as it does at +40', () => {
    const run = (x: number, boxFirst: boolean) => {
      const { box } = room({ x, tilt: 5e-11 });
      const value = new RigidBody4({
        mass: 1,
        inertiaDiagonal: new Float64Array(6).fill(1),
        position: box.center,
        rotation: Rotor4.fromPlanes([{ i: 0, j: 1, angle: 5e-11 }])
      });
      const world = new PhysicsWorld4({ gravity: [0, -9.81, 0, 0] }).addBody(value);
      const pipeline = new HyperboxContactPipeline4();
      const boxCollider = new HyperboxCollider4({
        id: 'box', halfExtents: BOX_HALF, participant: value
      });
      const floorCollider = new HyperboxCollider4({
        id: 'floor',
        halfExtents: [2000, 0.5, 50, 50],
        transform: new TransformN(4, Rotor4.identity(), new VecN([0, -0.5, 0, 0]))
      });
      for (const collider of boxFirst ? [boxCollider, floorCollider] : [floorCollider, boxCollider]) {
        pipeline.addCollider(collider);
      }
      const trace: number[] = [];
      for (let step = 0; step < 3; step++) {
        const result = pipeline.stepWorld(world, 1 / 60, 1);
        expect(result.final.contactPairs).toBe(1);
        // A failed step used to leave one whole gravity step in the velocity.
        expect(Math.abs(value.linearVelocity.data[1]!)).toBeLessThan(9.81 / 60);
        trace.push(value.position.data[1]!, value.linearVelocity.data[1]!);
      }
      return trace;
    };
    for (const boxFirst of [true, false]) {
      const left = run(-40, boxFirst);
      const right = run(40, boxFirst);
      // The same box translated by 80: the traces agree to rounding of world
      // coordinates (measured 1.3e-11), inside the 1e-9 feasibility band.
      for (let index = 0; index < left.length; index++) {
        expect(Math.abs(left[index]! - right[index]!)).toBeLessThan(1e-9);
      }
    }
  });
});
