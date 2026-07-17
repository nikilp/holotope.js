import {
  TransformN,
  VecN,
  createHypercube
} from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  ConvexHullSupportShapeN,
  GlomeSupportShapeN,
  HyperplaneColliderN,
  HyperboxSupportShape4,
  NarrowphaseDispatcherN,
  TransformedSupportShapeN,
  gjkDistance,
  gjkMarginDistance,
  glomeGlomeContactN,
  glomeHyperboxContact4,
  glomeHyperplaneContactN,
  hyperboxContactPatch4,
  hyperboxHyperplaneContact4,
  polytopeHyperplaneContact4,
  type NarrowphaseDispatchRequestN
} from '../src/index.js';

function hull(dim: number): ConvexHullSupportShapeN {
  return ConvexHullSupportShapeN.fromCellComplex(createHypercube({ dim, size: 2 }));
}

function translated(
  source: ConvexHullSupportShapeN,
  position: ArrayLike<number>
): TransformedSupportShapeN {
  return new TransformedSupportShapeN(
    source,
    new TransformN(source.dim, undefined, new VecN(position))
  );
}

function hyperbox(position: ArrayLike<number>): HyperboxSupportShape4 {
  return new HyperboxSupportShape4(
    [1, 1, 1, 1],
    new TransformN(4, undefined, new VecN(position))
  );
}

describe('NarrowphaseDispatcherN capability selection', () => {
  it('selects general convex distance and coherently warm-starts by ordered pair ID', () => {
    const source = hull(3);
    const first = translated(source, [0, 0, 0]);
    const second = translated(source, [3, 0, 0]);
    const dispatcher = new NarrowphaseDispatcherN();

    const initial = dispatcher.dispatch({ pairId: 'first/second', shapeA: first, shapeB: second });
    expect(initial.kind).toBe('distance');
    if (initial.kind !== 'distance') throw new Error('expected distance');
    expect(initial.requestedMode).toBe('best');
    expect(initial.availableCapabilities).toEqual(['distance', 'shallow-contact']);
    expect(initial.cacheStatus).toBe('miss');
    expect(initial.query.distance).toBeCloseTo(1, 14);
    expect(initial.query.distance).toBeCloseTo(gjkDistance(first, second).distance, 14);

    second.transform = new TransformN(3, undefined, new VecN([2.8, 0, 0]));
    const coherent = dispatcher.dispatch({
      pairId: 'first/second',
      shapeA: first,
      shapeB: second
    });
    expect(coherent.kind).toBe('distance');
    if (coherent.kind !== 'distance') throw new Error('expected distance');
    expect(coherent.cacheStatus).toBe('hit');
    expect(coherent.query.termination.warmStartSize).toBeGreaterThan(0);
    expect(coherent.query.distance).toBeCloseTo(0.8, 14);
    expect(dispatcher.cacheSize).toBe(1);

    const reversed = dispatcher.dispatch({
      pairId: 'first/second',
      shapeA: second,
      shapeB: first,
      mode: 'distance'
    });
    expect(reversed.cacheStatus).toBe('miss');
  });

  it('selects rounded shallow contact when margins are present', () => {
    const source = hull(3);
    const first = translated(source, [0, 0, 0]);
    const second = translated(source, [2.3, 0, 0]);
    const dispatcher = new NarrowphaseDispatcherN();
    const result = dispatcher.dispatch({
      pairId: 'rounded',
      shapeA: first,
      shapeB: second,
      marginA: 0.2,
      marginB: 0.2
    });
    expect(result.kind).toBe('shallow-contact');
    if (result.kind !== 'shallow-contact') throw new Error('expected shallow contact');
    expect(result.query.status).toBe('margin-contact');
    expect(result.query.penetrationDepth).toBeCloseTo(0.1, 13);
    const direct = gjkMarginDistance(first, second, { marginA: 0.2, marginB: 0.2 });
    expect(result.query.signedDistance).toBeCloseTo(direct.signedDistance!, 14);
  });

  it('selects exact deep manifolds only for zero-margin R4 hyperboxes', () => {
    const first = hyperbox([0, 0, 0, 0]);
    const second = hyperbox([1.5, 0, 0, 0]);
    const dispatcher = new NarrowphaseDispatcherN();
    const result = dispatcher.dispatch({ pairId: 'boxes', shapeA: first, shapeB: second });
    expect(result.kind).toBe('deep-manifold');
    if (result.kind !== 'deep-manifold') throw new Error('expected deep manifold');
    expect(result.algorithm).toBe('hyperbox4');
    if (result.algorithm !== 'hyperbox4') throw new Error('expected hyperbox4');
    expect(result.availableCapabilities).toEqual([
      'distance',
      'shallow-contact',
      'penetration',
      'deep-manifold'
    ]);
    expect(result.cacheStatus).toBe('unused');
    expect(result.query.patch?.vertices.map(({ id }) => id)).toEqual(
      hyperboxContactPatch4(first, second).patch?.vertices.map(({ id }) => id)
    );

    const forcedDistance = dispatcher.dispatch({
      pairId: 'boxes-distance',
      shapeA: first,
      shapeB: second,
      mode: 'distance'
    });
    expect(forcedDistance.kind).toBe('distance');

    const rounded = dispatcher.dispatch({
      pairId: 'boxes-rounded',
      shapeA: first,
      shapeB: hyperbox([2.2, 0, 0, 0]),
      marginA: 0.2,
      marginB: 0.2
    });
    expect(rounded.kind).toBe('shallow-contact');
    expect(rounded.availableCapabilities).toEqual(['distance', 'shallow-contact']);
  });

  it('preserves the shallow query refusal after convex cores overlap', () => {
    const first = hyperbox([0, 0, 0, 0]);
    const second = hyperbox([1, 0, 0, 0]);
    const result = new NarrowphaseDispatcherN().dispatch({
      pairId: 'overlap',
      shapeA: first,
      shapeB: second,
      mode: 'shallow-contact',
      marginA: 0.1,
      marginB: 0.1
    });
    expect(result.kind).toBe('shallow-contact');
    if (result.kind !== 'shallow-contact') throw new Error('expected shallow contact');
    expect(result.query.status).toBe('core-contact');
    expect(result.query.penetrationDepth).toBeNull();
    expect(result.query.normal).toBeNull();
  });

  it('promotes vertex-enumerable R4 pairs from EPA penetration to a manifold', () => {
    const source = hull(4);
    const first = translated(source, [0, 0, 0, 0]);
    const second = translated(source, [1.5, 0, 0, 0]);
    const dispatcher = new NarrowphaseDispatcherN();
    const result = dispatcher.dispatch({
      pairId: 'general-r4',
      shapeA: first,
      shapeB: second,
      epaOptions: { recordTrace: true }
    });
    expect(result.kind).toBe('deep-manifold');
    if (result.kind !== 'deep-manifold') throw new Error('expected deep manifold');
    expect(result.algorithm).toBe('polytope4');
    if (result.algorithm !== 'polytope4') throw new Error('expected polytope4');
    expect(result.availableCapabilities).toEqual([
      'distance',
      'shallow-contact',
      'penetration',
      'deep-manifold'
    ]);
    expect(result.cacheStatus).toBe('miss');
    expect(result.query.status).toBe('penetrating');
    expect(result.query.patch?.penetrationDepth).toBeCloseTo(0.5, 10);
    expect(result.query.patch?.vertices).toHaveLength(8);
    expect(result.query.epa?.trace).toBeDefined();

    const coherent = dispatcher.dispatch({
      pairId: 'general-r4',
      shapeA: first,
      shapeB: second
    });
    expect(coherent.kind).toBe('deep-manifold');
    expect(coherent.cacheStatus).toBe('hit');

    const forcedPenetration = dispatcher.dispatch({
      pairId: 'general-r4-penetration',
      shapeA: first,
      shapeB: second,
      mode: 'penetration'
    });
    expect(forcedPenetration.kind).toBe('penetration');

    const forcedDistance = dispatcher.dispatch({
      pairId: 'general-r4-distance',
      shapeA: first,
      shapeB: second,
      mode: 'distance'
    });
    expect(forcedDistance.kind).toBe('distance');

    const rounded = dispatcher.dispatch({
      pairId: 'general-r4-rounded',
      shapeA: first,
      shapeB: translated(source, [2.2, 0, 0, 0]),
      marginA: 0.2,
      marginB: 0.2
    });
    expect(rounded.kind).toBe('shallow-contact');
    expect(rounded.availableCapabilities).toEqual(['distance', 'shallow-contact']);
  });

  it('returns typed refusals rather than silently weakening deep requests', () => {
    const source = hull(3);
    const general = new NarrowphaseDispatcherN().dispatch({
      pairId: 'general',
      shapeA: translated(source, [0, 0, 0]),
      shapeB: translated(source, [3, 0, 0]),
      mode: 'deep-manifold'
    });
    expect(general).toMatchObject({
      kind: 'unsupported',
      capability: null,
      reason: 'deep-manifold-not-implemented-for-shape-pair'
    });

    const roundedBoxes = new NarrowphaseDispatcherN().dispatch({
      pairId: 'rounded-boxes',
      shapeA: hyperbox([0, 0, 0, 0]),
      shapeB: hyperbox([2, 0, 0, 0]),
      mode: 'deep-manifold',
      marginA: 0.1
    });
    expect(roundedBoxes).toMatchObject({
      kind: 'unsupported',
      reason: 'deep-manifold-does-not-support-margins'
    });

    const penetration3 = new NarrowphaseDispatcherN().dispatch({
      pairId: 'r3-penetration',
      shapeA: translated(source, [0, 0, 0]),
      shapeB: translated(source, [1, 0, 0]),
      mode: 'penetration'
    });
    expect(penetration3).toMatchObject({
      kind: 'unsupported',
      reason: 'penetration-requires-zero-margin-r4-compact-support-pair'
    });
  });

  it('selects exact deep glome contact, including spherical margins', () => {
    const shapeA = new GlomeSupportShapeN([0, 0, 0, 0, 0], 1);
    const shapeB = new GlomeSupportShapeN([2.1, 0, 0, 0, 0], 1);
    const result = new NarrowphaseDispatcherN().dispatch({
      pairId: 'glomes',
      shapeA,
      shapeB,
      marginA: 0.1,
      marginB: 0.2
    });
    expect(result.kind).toBe('deep-manifold');
    if (result.kind !== 'deep-manifold') throw new Error('expected deep manifold');
    expect(result.algorithm).toBe('glome-glome');
    if (result.algorithm !== 'glome-glome') throw new Error('expected glome pair');
    expect(result.availableCapabilities).toEqual([
      'distance',
      'shallow-contact',
      'deep-manifold'
    ]);
    expect(result.query.signedDistance).toBeCloseTo(-0.2, 14);
    expect(result.query.signedDistance).toBeCloseTo(
      glomeGlomeContactN(shapeA, shapeB, { marginA: 0.1, marginB: 0.2 })
        .signedDistance,
      14
    );

    const explicitlyShallow = new NarrowphaseDispatcherN().dispatch({
      pairId: 'glomes-shallow',
      shapeA,
      shapeB,
      mode: 'shallow-contact',
      marginA: 0.1,
      marginB: 0.2
    });
    expect(explicitlyShallow.kind).toBe('shallow-contact');

    const toleranceContact = new NarrowphaseDispatcherN().dispatch({
      pairId: 'glomes-tolerance',
      shapeA: new GlomeSupportShapeN([0, 0], 1),
      shapeB: new GlomeSupportShapeN([2.05, 0], 1),
      smoothContactOptions: { tolerance: 0.1 }
    });
    expect(toleranceContact.kind).toBe('deep-manifold');
    if (
      toleranceContact.kind !== 'deep-manifold' ||
      toleranceContact.algorithm !== 'glome-glome'
    ) throw new Error('expected glome pair');
    expect(toleranceContact.query.status).toBe('touching');
  });

  it('dispatches exact ordered glome-hyperplane contact and refuses weaker modes', () => {
    const glome = new GlomeSupportShapeN([0, 0.5, 0], 1);
    const plane = new HyperplaneColliderN([0, 1, 0], 0);
    const dispatcher = new NarrowphaseDispatcherN();
    const forward = dispatcher.dispatch({
      pairId: 'glome/plane',
      shapeA: glome,
      shapeB: plane
    });
    expect(forward.kind).toBe('deep-manifold');
    if (forward.kind !== 'deep-manifold') throw new Error('expected deep manifold');
    expect(forward.algorithm).toBe('glome-hyperplane');
    if (forward.algorithm !== 'glome-hyperplane') throw new Error('expected glome plane');
    expect(forward.query.signedDistance).toBeCloseTo(
      glomeHyperplaneContactN(glome, plane).signedDistance,
      14
    );

    const reverse = dispatcher.dispatch({
      pairId: 'plane/glome',
      shapeA: plane,
      shapeB: glome
    });
    expect(reverse.kind).toBe('deep-manifold');
    if (reverse.kind !== 'deep-manifold') throw new Error('expected deep manifold');
    expect(reverse.algorithm).toBe('glome-hyperplane');
    if (reverse.algorithm !== 'glome-hyperplane') throw new Error('expected glome plane');
    expect(reverse.query.normal.data[0]).toBeCloseTo(0, 14);
    expect(reverse.query.normal.data[1]).toBeCloseTo(-1, 14);
    expect(reverse.query.normal.data[2]).toBeCloseTo(0, 14);

    expect(dispatcher.dispatch({
      pairId: 'glome/plane-distance',
      shapeA: glome,
      shapeB: plane,
      mode: 'distance'
    })).toMatchObject({
      kind: 'unsupported',
      reason: 'distance-requires-compact-support-pair'
    });
    expect(dispatcher.dispatch({
      pairId: 'plane-margin',
      shapeA: glome,
      shapeB: plane,
      mode: 'deep-manifold',
      marginB: 0.1
    })).toMatchObject({
      kind: 'unsupported',
      reason: 'deep-manifold-does-not-support-margins'
    });
  });

  it('dispatches exact glome-hyperbox contact, including both compact margins', () => {
    const glome = new GlomeSupportShapeN([1.5, 0, 0, 0], 0.5);
    const boxShape = hyperbox([0, 0, 0, 0]);
    const dispatcher = new NarrowphaseDispatcherN();
    const forward = dispatcher.dispatch({
      pairId: 'glome/box',
      shapeA: glome,
      shapeB: boxShape,
      marginA: 0.1,
      marginB: 0.2
    });
    expect(forward.kind).toBe('deep-manifold');
    if (
      forward.kind !== 'deep-manifold' ||
      forward.algorithm !== 'glome-hyperbox4'
    ) throw new Error('expected glome-hyperbox4');
    expect(forward.availableCapabilities).toEqual([
      'distance',
      'shallow-contact',
      'deep-manifold'
    ]);
    expect(forward.query.signedDistance).toBeCloseTo(-0.3, 14);
    expect(forward.query.signedDistance).toBeCloseTo(
      glomeHyperboxContact4(glome, boxShape, {
        glomeMargin: 0.1,
        hyperboxMargin: 0.2
      }).signedDistance,
      14
    );

    const reverse = dispatcher.dispatch({
      pairId: 'box/glome',
      shapeA: boxShape,
      shapeB: glome,
      marginA: 0.2,
      marginB: 0.1
    });
    expect(reverse.kind).toBe('deep-manifold');
    if (
      reverse.kind !== 'deep-manifold' ||
      reverse.algorithm !== 'glome-hyperbox4'
    ) throw new Error('expected glome-hyperbox4');
    expect(reverse.query.normal?.data[0]).toBeCloseTo(-1, 14);
  });

  it('dispatches exact hyperbox-hyperplane contact and only refuses plane margin', () => {
    const boxShape = hyperbox([0, 0.5, 0, 0]);
    const plane = new HyperplaneColliderN([0, 1, 0, 0], 0);
    const dispatcher = new NarrowphaseDispatcherN();
    const forward = dispatcher.dispatch({
      pairId: 'box/plane',
      shapeA: boxShape,
      shapeB: plane,
      marginA: 0.25
    });
    expect(forward.kind).toBe('deep-manifold');
    if (
      forward.kind !== 'deep-manifold' ||
      forward.algorithm !== 'hyperbox-hyperplane4'
    ) throw new Error('expected hyperbox-hyperplane4');
    expect(forward.availableCapabilities).toEqual(['deep-manifold']);
    expect(forward.query.signedDistance).toBeCloseTo(-0.75, 14);
    expect(forward.query.signedDistance).toBeCloseTo(
      hyperboxHyperplaneContact4(boxShape, plane, {
        hyperboxMargin: 0.25
      }).signedDistance,
      14
    );

    const reverse = dispatcher.dispatch({
      pairId: 'plane/box',
      shapeA: plane,
      shapeB: boxShape,
      marginB: 0.25
    });
    expect(reverse.kind).toBe('deep-manifold');
    if (
      reverse.kind !== 'deep-manifold' ||
      reverse.algorithm !== 'hyperbox-hyperplane4'
    ) throw new Error('expected hyperbox-hyperplane4');
    expect(reverse.query.normal.data[1]).toBeCloseTo(-1, 14);

    expect(dispatcher.dispatch({
      pairId: 'box/rounded-plane',
      shapeA: boxShape,
      shapeB: plane,
      mode: 'deep-manifold',
      marginB: 0.1
    })).toMatchObject({
      kind: 'unsupported',
      reason: 'deep-manifold-does-not-support-margins'
    });
  });

  it('dispatches complete R4 vertex-polytope support faces against a plane', () => {
    const polytope = translated(hull(4), [0, 0.5, 0, 0]);
    const plane = new HyperplaneColliderN([0, 1, 0, 0], 0);
    const dispatcher = new NarrowphaseDispatcherN();
    const forward = dispatcher.dispatch({
      pairId: 'polytope/plane',
      shapeA: polytope,
      shapeB: plane,
      marginA: 0.2
    });
    expect(forward.kind).toBe('deep-manifold');
    if (
      forward.kind !== 'deep-manifold' ||
      forward.algorithm !== 'polytope-hyperplane4'
    ) throw new Error('expected polytope-hyperplane4');
    expect(forward.availableCapabilities).toEqual(['deep-manifold']);
    expect(forward.cacheStatus).toBe('unused');
    expect(forward.query.signedDistance).toBeCloseTo(-0.7, 14);
    expect(forward.query.patch?.vertices).toHaveLength(8);
    expect(forward.query.signedDistance).toBeCloseTo(
      polytopeHyperplaneContact4(polytope, plane, {
        polytopeMargin: 0.2
      }).signedDistance!,
      14
    );

    const reverse = dispatcher.dispatch({
      pairId: 'plane/polytope',
      shapeA: plane,
      shapeB: polytope,
      marginB: 0.2
    });
    expect(reverse.kind).toBe('deep-manifold');
    if (
      reverse.kind !== 'deep-manifold' ||
      reverse.algorithm !== 'polytope-hyperplane4'
    ) throw new Error('expected polytope-hyperplane4');
    expect(reverse.query.normal.data[1]).toBeCloseTo(-1, 14);

    expect(dispatcher.dispatch({
      pairId: 'polytope/rounded-plane',
      shapeA: polytope,
      shapeB: plane,
      mode: 'deep-manifold',
      marginB: 0.1
    })).toMatchObject({
      kind: 'unsupported',
      reason: 'deep-manifold-does-not-support-margins'
    });
  });

  it('keeps non-R4 support/plane and plane/plane pairs outside the route', () => {
    const source = hull(3);
    const plane = new HyperplaneColliderN([0, 1, 0], 0);
    const dispatcher = new NarrowphaseDispatcherN();
    expect(dispatcher.dispatch({
      pairId: 'hull/plane',
      shapeA: translated(source, [0, 2, 0]),
      shapeB: plane
    })).toMatchObject({
      kind: 'unsupported',
      reason: 'no-common-narrowphase-capability'
    });
    expect(dispatcher.dispatch({
      pairId: 'plane/plane',
      shapeA: plane,
      shapeB: new HyperplaneColliderN([1, 0, 0], 0)
    })).toMatchObject({
      kind: 'unsupported',
      reason: 'no-common-narrowphase-capability'
    });
  });
});

describe('NarrowphaseDispatcherN batch lifecycle', () => {
  it('sorts pairs, reports cache reuse, and retires absent ordered pairs', () => {
    const source = hull(3);
    const shapeA = translated(source, [0, 0, 0]);
    const shapeB = translated(source, [3, 0, 0]);
    const requests: NarrowphaseDispatchRequestN[] = [
      { pairId: 'z-pair', shapeA, shapeB, mode: 'distance' },
      { pairId: 'a-pair', shapeA, shapeB, mode: 'distance' }
    ];
    const dispatcher = new NarrowphaseDispatcherN();
    const first = dispatcher.dispatchBatch(requests);
    expect(first.results.map(({ pairId }) => pairId)).toEqual(['a-pair', 'z-pair']);
    expect(first.results.map(({ cacheStatus }) => cacheStatus)).toEqual(['miss', 'miss']);
    expect(first.retiredPairIds).toEqual([]);
    expect(first.cacheSize).toBe(2);

    const second = dispatcher.dispatchBatch([requests[0]!]);
    expect(second.results[0]!.cacheStatus).toBe('hit');
    expect(second.retiredPairIds).toEqual(['a-pair']);
    expect(second.cacheSize).toBe(1);
    expect(() => dispatcher.dispatchBatch([requests[0]!, requests[0]!]))
      .toThrow(/duplicate pair ID/);
    expect(dispatcher.delete('z-pair')).toBe(true);
    expect(dispatcher.cacheSize).toBe(0);
  });

  it('can disable caching and rejects malformed requests', () => {
    const source2 = hull(2);
    const source3 = hull(3);
    const dispatcher = new NarrowphaseDispatcherN();
    const uncached = dispatcher.dispatch({
      pairId: 'uncached',
      shapeA: translated(source2, [0, 0]),
      shapeB: translated(source2, [3, 0]),
      mode: 'distance',
      useCache: false
    });
    expect(uncached.cacheStatus).toBe('disabled');
    expect(dispatcher.cacheSize).toBe(0);

    expect(() => dispatcher.dispatch({
      pairId: '',
      shapeA: translated(source2, [0, 0]),
      shapeB: translated(source2, [3, 0])
    })).toThrow(/pairId/);
    expect(() => dispatcher.dispatch({
      pairId: 'dimensions',
      shapeA: translated(source2, [0, 0]),
      shapeB: translated(source3, [0, 0, 0])
    })).toThrow(/dimensions differ/);
    expect(() => dispatcher.dispatch({
      pairId: 'margin',
      shapeA: translated(source2, [0, 0]),
      shapeB: translated(source2, [3, 0]),
      marginA: -1
    })).toThrow(/marginA/);
    expect(() => dispatcher.dispatch({
      pairId: 'owned-cache',
      shapeA: translated(source2, [0, 0]),
      shapeB: translated(source2, [3, 0]),
      gjkOptions: { warmStart: {} } as never
    })).toThrow(/owned by the dispatcher/);
  });
});
