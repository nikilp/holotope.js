import {
  CellComplex,
  CoordinateProjection,
  HyperplaneSlice4,
  HyperplaneSliceN
} from '@holotope/core';
import { Raycaster, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  ProjectedEdges3D,
  ProjectedSurface3D,
  SectionChart3D,
  SlicedComplex3D
} from '../src/index.js';
import * as products from '../src/index.js';

/**
 * One contract for every product that streams new positions after construction.
 *
 * Three.js rejects a raycast against `geometry.boundingSphere` before it tests
 * any primitive, and computes a null sphere lazily on the first such test. A
 * product that writes new positions without refreshing that sphere therefore
 * keeps drawing correctly while silently losing intersections for whatever has
 * moved — visible, orbitable, and unpickable, which is the worst shape a defect
 * can take because nothing looks wrong.
 *
 * `fd5f4c8` fixed three products that had it. This table exists so the *class*
 * cannot come back: a new streaming product is added here, and a product that
 * forgets the refresh fails rather than shipping.
 *
 * The assertions are deliberately the same for every entry:
 *
 * 1. it is pickable where it starts, so the fixture is not vacuous;
 * 2. its source moves far enough that a stale sphere cannot cover both places;
 * 3. it is pickable where it now is;
 * 4. it is *not* pickable where it used to be.
 *
 * Assertion 4 proves the drawn primitives left the old position — not that the
 * bounding volume followed them. Three.js tests the sphere and then the
 * primitives, so an over-large sphere still reports zero hits where nothing is
 * drawn. That distinction matters for one row: `SlicedComplex3D` deliberately
 * bounds its whole position buffer including slots past the current draw range
 * (frustum culling is off for it), so its sphere grows rather than follows and
 * could not satisfy a "followed" test. The direct volume statement is the last
 * case in this file, and it is asserted on a product whose sphere does follow.
 */

/** One product under the same contract, however it is built and moved. */
interface StreamingProductCase {
  readonly name: string;
  /** Builds the product and returns the object plus how to drive it. */
  build(): {
    object: Object3D;
    /** Moves the authoritative source, then refreshes the product. */
    move(): void;
    /** A ray origin that should hit before the move. */
    before: [number, number];
    /** A ray origin that should hit after it. */
    after: [number, number];
    dispose(): void;
  };
}

/** How far every fixture travels: far enough that no stale sphere covers both. */
const TRAVEL = 400;

function rayAt(x: number, y: number): Raycaster {
  const caster = new Raycaster(
    new Vector3(x, y, 900), new Vector3(0, 0, -1), 0.01, 4000
  );
  // Line and point products need a pick radius; meshes ignore this.
  caster.params.Line = { threshold: 0.35 };
  caster.params.Points = { threshold: 0.35 };
  return caster;
}

function hits(object: Object3D, at: [number, number]): number {
  object.updateMatrixWorld(true);
  return rayAt(at[0], at[1]).intersectObject(object, true).length;
}

/** Two triangles with shared vertices, near the origin. */
function sheetComplex(): CellComplex {
  return new CellComplex(4, Float64Array.from([
    0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0
  ]), [{
    key: 'sheet', dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2, 1, 3, 2])
  }]);
}

function translate(complex: CellComplex, distance: number): void {
  for (let vertex = 0; vertex < complex.vertexCount; vertex++) {
    complex.positions[vertex * complex.ambientDim] += distance;
  }
}

const axes3 = (): CoordinateProjection =>
  new CoordinateProjection({ fromDim: 4, axes: [0, 1, 2] });

const CASES: readonly StreamingProductCase[] = [
  {
    name: 'ProjectedSurface3D',
    build() {
      const complex = sheetComplex();
      const product = new ProjectedSurface3D(complex, axes3());
      return {
        object: product.object,
        move: () => { translate(complex, TRAVEL); product.update(); },
        before: [0.5, 0.4],
        after: [0.5 + TRAVEL, 0.4],
        dispose: () => product.dispose()
      };
    }
  },
  {
    name: 'ProjectedEdges3D',
    build() {
      const complex = new CellComplex(4, Float64Array.from([
        0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0
      ]), [{
        key: 'wire', dim: 1, verticesPerCell: 2, kind: 'simplex',
        indices: Uint32Array.from([0, 1, 1, 2])
      }]);
      const product = new ProjectedEdges3D(complex, axes3());
      return {
        object: product.object,
        move: () => { translate(complex, TRAVEL); product.update(); },
        before: [0.5, 0],
        after: [0.5 + TRAVEL, 0],
        dispose: () => product.dispose()
      };
    }
  },
  {
    name: 'SlicedComplex3D',
    build() {
      // One 4-simplex whose apex sits far along x at w = 4, so advancing the
      // slice offset walks its cross-section across the scene.
      const complex = new CellComplex(4, Float64Array.from([
        0, 0, 0, 0, 6, 0, 0, 0, 0, 6, 0, 0, 0, 0, 6, 0, TRAVEL, 0, 0, 4
      ]), [{
        key: 'solid', dim: 3, verticesPerCell: 4, kind: 'simplex',
        indices: Uint32Array.from([
          0, 1, 2, 3, 0, 1, 2, 4, 0, 1, 3, 4, 0, 2, 3, 4, 1, 2, 3, 4
        ])
      }]);
      const slice = HyperplaneSlice4.axisAligned(3, 0.4);
      const product = new SlicedComplex3D(complex, slice);
      return {
        object: product.object,
        move: () => { slice.offset = 3.4; product.update(); },
        before: [42, 0.5],
        after: [340, 0.5],
        dispose: () => product.dispose()
      };
    }
  },
  {
    name: 'SectionChart3D',
    build() {
      // A tetrahedron group in R4 cut at w = 0: the section triangle sits near
      // the origin of the chart, and translating the authoritative source
      // along x carries it across the scene.
      const complex = new CellComplex(4, Float64Array.from([
        0, 0, 0, -2,
        6, 0, 0, 2,
        0, 6, 0, 2,
        0, 0, 6, 2
      ]), [{
        key: 'solid', dim: 3, verticesPerCell: 4, kind: 'simplex',
        indices: Uint32Array.from([0, 1, 2, 3])
      }]);
      const group = complex.groups[0]!;
      const product = new SectionChart3D(
        complex, group, HyperplaneSliceN.axisAligned(4, 3, 0)
      );
      return {
        object: product.object,
        move: () => { translate(complex, TRAVEL); product.update(); },
        before: [1.5, 1.5],
        after: [TRAVEL + 1.5, 1.5],
        dispose: () => product.dispose()
      };
    }
  }
];

describe('streaming products: bounds must follow the geometry', () => {
  for (const entry of CASES) {
    it(`${entry.name} stays pickable where it actually is`, () => {
      const product = entry.build();
      try {
        // 1. Liveness. A fixture that never hit would pass everything below
        //    while proving nothing at all.
        const initial = hits(product.object, product.before);
        expect(initial, `${entry.name}: not pickable before the move`)
          .toBeGreaterThan(0);

        // 2. Move the authoritative source and refresh the product.
        product.move();

        // 3. Pickable where it is drawn now.
        expect(
          hits(product.object, product.after),
          `${entry.name}: unpickable after the move — a stale bounding volume ` +
          'rejects the ray before any primitive is tested'
        ).toBeGreaterThan(0);

        // 4. And no longer where it was: the primitives moved, rather than the
        //    product drawing in both places. See the header on what this does
        //    and does not prove about the volume itself.
        expect(
          hits(product.object, product.before),
          `${entry.name}: still pickable at its old position`
        ).toBe(0);
      } finally {
        product.dispose();
      }
    });
  }

  it('covers every streaming product this entry point ships', () => {
    // Derived from the module, not restated by hand. A hand-written list makes
    // the completeness claim depend on the memory of whoever adds the next
    // product: an independent review added a deliberately unbounded streaming
    // product to this package and the previous literal-based version of this
    // test passed it, so the guarantee it advertised did not exist.
    //
    // The population is "exported class that re-streams positions after
    // construction", which on this entry point is exactly the classes carrying
    // an `update` method.
    const streaming = Object.entries(products)
      .filter(([, value]) =>
        typeof value === 'function' &&
        typeof (value as { prototype?: { update?: unknown } }).prototype
          ?.update === 'function')
      .map(([name]) => name)
      .sort();
    // Liveness: a predicate that matched nothing would make the comparison
    // below vacuous.
    expect(streaming.length).toBeGreaterThan(4);

    const covered = CASES.map((entry) => entry.name);
    // `FieldRelief3D` and `SampledSlicedField3D` both refreshed their bounds
    // before `fd5f4c8` and are the two entries this table drives indirectly:
    // they build from a sampled scalar field rather than a cell complex, so
    // they need a differently *shaped* fixture — not a harder one — and the
    // exclusion is a fixture-shape decision rather than a feasibility claim.
    const knownElsewhere = ['FieldRelief3D', 'SampledSlicedField3D'];
    expect([...covered, ...knownElsewhere].sort()).toEqual(streaming);
    for (const name of knownElsewhere) {
      expect(typeof products[name as keyof typeof products]).toBe('function');
    }
    // Scope, stated rather than implied: this is the main entry point's CPU
    // products. `@holotope/three/webgpu` streams positions too, through storage
    // buffers driven by `positionNode`, where neither a CPU bounding sphere nor
    // CPU raycast picking is the mechanism — those products are outside this
    // table for that reason, not by omission.
  });

  it('refreshes the bounding volume rather than leaving it null', () => {
    // The direct statement of the contract, independent of raycasting: after
    // an update the bounding volume must describe where the geometry now is.
    const complex = sheetComplex();
    const product = new ProjectedSurface3D(complex, axes3());
    try {
      product.geometry.computeBoundingSphere();
      const before = product.geometry.boundingSphere!.center.x;
      translate(complex, TRAVEL);
      product.update();
      const after = product.geometry.boundingSphere!.center.x;
      expect(Math.abs(after - before)).toBeGreaterThan(TRAVEL / 2);
    } finally {
      product.dispose();
    }
  });
});
