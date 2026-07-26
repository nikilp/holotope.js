import { CellComplex, MatN, VecN, type CellGroup } from '@holotope/core';
import { describe, expect, it } from 'vitest';
import {
  XpbdParticleN,
  compileSimplexCompressibleNeoHookeanFamilyN,
  compileSimplexConstitutiveFamilyN,
  compileXpbdIncrementalPotentialProblemN,
  estimateXpbdIncrementalPotentialHessianVectorN,
  evaluateSimplexCompressibleNeoHookeanHessianVectorN,
  evaluateSimplexCompressibleNeoHookeanN,
  evaluateSimplexMeasureBarrierHessianVectorN,
  evaluateSimplexMeasureBarrierN,
  evaluateSimplexStVenantKirchhoffHessianVectorN,
  evaluateSimplexStVenantKirchhoffN,
  evaluateXpbdIncrementalPotentialAnalyticHessianVectorN,
  simplexMeasureBarrierLawN,
  type SimplexConstitutiveEvaluationN
} from '../src/index.js';

type ConstitutiveEvaluator = (
  rest: readonly VecN[],
  current: readonly VecN[]
) => SimplexConstitutiveEvaluationN<unknown>;

function displaced(
  positions: readonly VecN[],
  directions: readonly VecN[],
  scale: number
): VecN[] {
  return positions.map((position, vertex) => {
    const result = position.clone();
    for (let axis = 0; axis < result.dim; axis++) {
      result.data[axis]! += scale * directions[vertex]!.data[axis]!;
    }
    return result;
  });
}

function centeredGradientDerivative(
  evaluate: ConstitutiveEvaluator,
  rest: readonly VecN[],
  current: readonly VecN[],
  directions: readonly VecN[],
  step = 2e-6
): VecN[] {
  const plus = evaluate(rest, displaced(current, directions, step));
  const minus = evaluate(rest, displaced(current, directions, -step));
  return plus.currentGradients.map((gradient, vertex) => {
    const result = gradient.clone().sub(minus.currentGradients[vertex]!);
    return result.multiplyScalar(0.5 / step);
  });
}

function expectVectorsClose(
  actual: readonly VecN[],
  expected: readonly VecN[],
  tolerance = 3e-7
): void {
  expect(actual).toHaveLength(expected.length);
  for (let vertex = 0; vertex < actual.length; vertex++) {
    for (let axis = 0; axis < actual[vertex]!.dim; axis++) {
      const a = actual[vertex]!.data[axis]!;
      const b = expected[vertex]!.data[axis]!;
      expect(Math.abs(a - b)).toBeLessThanOrEqual(
        tolerance * Math.max(1, Math.abs(a), Math.abs(b))
      );
    }
  }
}

function squareSource(): { source: CellComplex; group: CellGroup } {
  const group: CellGroup = {
    key: 'triangles',
    dim: 2,
    verticesPerCell: 3,
    kind: 'simplex',
    indices: new Uint32Array([0, 1, 2, 1, 3, 2])
  };
  return {
    source: new CellComplex(2, new Float64Array([
      0, 0,
      1, 0,
      0, 1,
      1, 1
    ]), [group]),
    group
  };
}

function packed(vectors: readonly VecN[]): Float64Array {
  return Float64Array.from(vectors.flatMap((vector) => vector.toArray()));
}

describe('simplex constitutive analytic curvature', () => {
  it('matches centered StVK gradients from R1 through embedded and full R4', () => {
    const cases = [
      {
        rest: [new VecN([0]), new VecN([1])],
        current: [new VecN([-0.1]), new VecN([1.25])],
        directions: [new VecN([0.3]), new VecN([-0.17])]
      },
      {
        rest: [
          new VecN([0, 0, 0, 0]),
          new VecN([1, 0, 0, 0]),
          new VecN([0, 1, 0, 0])
        ],
        current: [
          new VecN([0.03, -0.02, 0.04, 0.01]),
          new VecN([1.08, 0.13, -0.06, 0.11]),
          new VecN([-0.09, 0.92, 0.15, -0.05])
        ],
        directions: [
          new VecN([0.1, -0.07, 0.04, 0.08]),
          new VecN([-0.03, 0.16, -0.11, 0.02]),
          new VecN([0.09, 0.05, 0.13, -0.06])
        ]
      },
      {
        rest: [
          new VecN([0, 0, 0, 0]),
          new VecN([1, 0, 0, 0]),
          new VecN([0, 1, 0, 0]),
          new VecN([0, 0, 1, 0]),
          new VecN([0, 0, 0, 1])
        ],
        current: [
          new VecN([0.02, -0.03, 0.01, 0.04]),
          new VecN([1.1, 0.08, -0.04, 0.03]),
          new VecN([-0.06, 0.94, 0.12, -0.02]),
          new VecN([0.04, -0.09, 1.06, 0.07]),
          new VecN([0.02, 0.03, -0.08, 0.91])
        ],
        directions: [
          new VecN([0.02, -0.01, 0.03, -0.04]),
          new VecN([-0.06, 0.08, 0.01, 0.02]),
          new VecN([0.04, -0.03, 0.07, -0.01]),
          new VecN([0.05, 0.02, -0.08, 0.03]),
          new VecN([-0.03, 0.06, 0.04, -0.02])
        ]
      }
    ];
    const material = { firstLameParameter: 2.4, shearModulus: 1.7 };

    for (const { rest, current, directions } of cases) {
      const analytic = evaluateSimplexStVenantKirchhoffHessianVectorN(
        rest,
        current,
        directions,
        material
      );
      const numeric = centeredGradientDerivative(
        (r, x) => evaluateSimplexStVenantKirchhoffN(r, x, material),
        rest,
        current,
        directions
      );
      expectVectorsClose(analytic.products, numeric);
      expect(analytic.netProductResidual).toBeLessThan(1e-13);
    }
  });

  it('matches centered Neo-Hookean gradients on an embedded R2 simplex in R4', () => {
    const rest = [
      new VecN([0, 0, 0, 0]),
      new VecN([1, 0, 0, 0]),
      new VecN([0, 1, 0, 0])
    ];
    const current = [
      new VecN([0.02, -0.03, 0.01, 0.04]),
      new VecN([1.08, 0.09, -0.08, 0.02]),
      new VecN([-0.06, 0.88, 0.13, -0.07])
    ];
    const directions = [
      new VecN([0.04, -0.03, 0.02, 0.01]),
      new VecN([-0.08, 0.11, 0.05, -0.04]),
      new VecN([0.07, 0.02, -0.09, 0.06])
    ];
    const material = { firstLameParameter: 3.1, shearModulus: 2.2 };
    const analytic =
      evaluateSimplexCompressibleNeoHookeanHessianVectorN(
        rest,
        current,
        directions,
        material
      );
    const numeric = centeredGradientDerivative(
      (r, x) => evaluateSimplexCompressibleNeoHookeanN(r, x, material),
      rest,
      current,
      directions
    );
    expectVectorsClose(analytic.products, numeric, 5e-7);
    expect(analytic.netProductResidual).toBeLessThan(1e-13);
  });

  it('matches StVK at identity and differentiates Neo-Hookean in full R4', () => {
    const rest = [
      new VecN([0, 0, 0, 0]),
      new VecN([1, 0, 0, 0]),
      new VecN([0, 1, 0, 0]),
      new VecN([0, 0, 1, 0]),
      new VecN([0, 0, 0, 1])
    ];
    const directions = [
      new VecN([0.02, -0.01, 0.03, -0.04]),
      new VecN([-0.06, 0.08, 0.01, 0.02]),
      new VecN([0.04, -0.03, 0.07, -0.01]),
      new VecN([0.05, 0.02, -0.08, 0.03]),
      new VecN([-0.03, 0.06, 0.04, -0.02])
    ];
    const material = { firstLameParameter: 2.4, shearModulus: 1.7 };
    const stvk = evaluateSimplexStVenantKirchhoffHessianVectorN(
      rest,
      rest,
      directions,
      material
    );
    const neoAtIdentity =
      evaluateSimplexCompressibleNeoHookeanHessianVectorN(
        rest,
        rest,
        directions,
        material
      );
    expectVectorsClose(neoAtIdentity.products, stvk.products, 2e-14);

    const current = [
      new VecN([0.02, -0.03, 0.01, 0.04]),
      new VecN([1.1, 0.08, -0.04, 0.03]),
      new VecN([-0.06, 0.94, 0.12, -0.02]),
      new VecN([0.04, -0.09, 1.06, 0.07]),
      new VecN([0.02, 0.03, -0.08, 0.91])
    ];
    const analytic =
      evaluateSimplexCompressibleNeoHookeanHessianVectorN(
        rest,
        current,
        directions,
        material
      );
    const numeric = centeredGradientDerivative(
      (r, x) => evaluateSimplexCompressibleNeoHookeanN(r, x, material),
      rest,
      current,
      directions
    );
    expectVectorsClose(analytic.products, numeric, 8e-7);
  });

  it('returns exact zero outside the measure barrier support and exact active curvature', () => {
    const rest = [
      new VecN([0, 0]),
      new VecN([1, 0]),
      new VecN([0, 1])
    ];
    const directions = [
      new VecN([0.04, -0.02]),
      new VecN([-0.06, 0.09]),
      new VecN([0.03, -0.07])
    ];
    const material = {
      minimumMeasureRatio: 0.2,
      activationMeasureRatio: 0.9,
      stiffness: 4
    };
    const inactive = evaluateSimplexMeasureBarrierHessianVectorN(
      rest,
      rest,
      directions,
      material
    );
    expect(inactive.base.active).toBe(false);
    expect(inactive.products.every((product) => product.lengthSq() === 0))
      .toBe(true);

    const current = [
      new VecN([0.01, -0.02]),
      new VecN([0.76, 0.03]),
      new VecN([-0.04, 0.79])
    ];
    const analytic = evaluateSimplexMeasureBarrierHessianVectorN(
      rest,
      current,
      directions,
      material
    );
    const numeric = centeredGradientDerivative(
      (r, x) => evaluateSimplexMeasureBarrierN(r, x, material),
      rest,
      current,
      directions
    );
    expect(analytic.base.active).toBe(true);
    expectVectorsClose(analytic.products, numeric, 8e-7);
  });

  it('annuls a common translation direction exactly', () => {
    const rest = [
      new VecN([0, 0, 0, 0]),
      new VecN([1, 0, 0, 0]),
      new VecN([0, 1, 0, 0])
    ];
    const current = [
      new VecN([0.02, -0.03, 0.04, 0.01]),
      new VecN([1.06, 0.08, -0.02, 0.05]),
      new VecN([-0.07, 0.94, 0.12, -0.06])
    ];
    const translation = new VecN([0.3, -0.4, 0.2, 0.1]);
    const result = evaluateSimplexCompressibleNeoHookeanHessianVectorN(
      rest,
      current,
      [translation, translation, translation],
      { firstLameParameter: 3, shearModulus: 2 }
    );
    expect(result.products.every((product) => product.lengthSq() === 0))
      .toBe(true);
    expect(result.netProductResidual).toBe(0);
  });

  it('is linear in direction and covariant under a common ambient rotation', () => {
    const rest = [
      new VecN([0, 0, 0, 0]),
      new VecN([1, 0, 0, 0]),
      new VecN([0, 1, 0, 0])
    ];
    const current = [
      new VecN([0.02, -0.03, 0.04, 0.01]),
      new VecN([1.06, 0.08, -0.02, 0.05]),
      new VecN([-0.07, 0.94, 0.12, -0.06])
    ];
    const a = [
      new VecN([0.03, -0.02, 0.01, 0.04]),
      new VecN([-0.05, 0.08, 0.02, -0.01]),
      new VecN([0.07, 0.01, -0.06, 0.03])
    ];
    const b = [
      new VecN([-0.02, 0.04, 0.03, -0.01]),
      new VecN([0.06, -0.03, 0.01, 0.05]),
      new VecN([-0.04, 0.02, 0.08, -0.06])
    ];
    const sum = a.map((direction, vertex) =>
      direction.clone().add(b[vertex]!)
    );
    const material = { firstLameParameter: 3, shearModulus: 2 };
    const productA = evaluateSimplexCompressibleNeoHookeanHessianVectorN(
      rest,
      current,
      a,
      material
    ).products;
    const productB = evaluateSimplexCompressibleNeoHookeanHessianVectorN(
      rest,
      current,
      b,
      material
    ).products;
    const productSum = evaluateSimplexCompressibleNeoHookeanHessianVectorN(
      rest,
      current,
      sum,
      material
    ).products;
    expectVectorsClose(
      productSum,
      productA.map((product, vertex) =>
        product.clone().add(productB[vertex]!)
      ),
      2e-14
    );

    const rotation = MatN.rotationInPlane(4, 0, 3, 0.47)
      .multiply(MatN.rotationInPlane(4, 1, 2, -0.31));
    const rotated = evaluateSimplexCompressibleNeoHookeanHessianVectorN(
      rest.map((position) => rotation.applyTo(position)),
      current.map((position) => rotation.applyTo(position)),
      sum.map((direction) => rotation.applyTo(direction)),
      material
    );
    expectVectorsClose(
      rotated.products,
      productSum.map((product) => rotation.applyTo(product)),
      2e-13
    );
  });

  it('validates direction evidence without mutating caller vectors', () => {
    const rest = [new VecN([0, 0]), new VecN([1, 0])];
    const directions = [new VecN([0.2, -0.1]), new VecN([-0.3, 0.4])];
    const before = directions.map((direction) => direction.toArray());
    const result = evaluateSimplexStVenantKirchhoffHessianVectorN(
      rest,
      rest,
      directions,
      { firstLameParameter: 2, shearModulus: 1 }
    );
    expect(directions.map((direction) => direction.toArray())).toEqual(before);
    expect(result.directions[0]).not.toBe(directions[0]);
    expect(() => evaluateSimplexStVenantKirchhoffHessianVectorN(
      rest,
      rest,
      [new VecN([0, 0])],
      { firstLameParameter: 2, shearModulus: 1 }
    )).toThrow(/direction count/);
    expect(() => evaluateSimplexStVenantKirchhoffHessianVectorN(
      rest,
      rest,
      [new VecN([0, 0]), new VecN([0, 0, 0])],
      { firstLameParameter: 2, shearModulus: 1 }
    )).toThrow(/must be R2/);
    expect(() => evaluateSimplexStVenantKirchhoffHessianVectorN(
      rest,
      rest,
      [new VecN([0, 0]), new VecN([Number.NaN, 0])],
      { firstLameParameter: 2, shearModulus: 1 }
    )).toThrow(/must be finite/);
  });

  it('composes Neo-Hookean and barrier families into the complete objective', () => {
    const { source, group } = squareSource();
    const current = [
      new VecN([0.02, -0.03]),
      new VecN([0.91, 0.04]),
      new VecN([-0.05, 0.88]),
      new VecN([0.92, 0.9])
    ];
    const directions = [
      new VecN([0.04, -0.02]),
      new VecN([-0.06, 0.09]),
      new VecN([0.03, -0.07]),
      new VecN([0.08, 0.01])
    ];
    const particles = current.map((position, vertex) =>
      new XpbdParticleN({
        id: `curvature/${vertex}`,
        position,
        inverseMass: 0.5 + 0.1 * vertex
      })
    );
    const elastic = compileSimplexCompressibleNeoHookeanFamilyN({
      id: 'elastic-sheet',
      source,
      simplexGroup: group,
      particles,
      material: { firstLameParameter: 3, shearModulus: 2 }
    });
    const barrier = compileSimplexConstitutiveFamilyN({
      id: 'measure-barrier',
      source,
      simplexGroup: group,
      particles,
      law: simplexMeasureBarrierLawN,
      material: {
        minimumMeasureRatio: 0.2,
        activationMeasureRatio: 0.95,
        stiffness: 1.5
      }
    });
    expect(barrier.evaluatePotentialHessianVectorAt).toBeTypeOf('function');
    const problem = compileXpbdIncrementalPotentialProblemN({
      dimension: 2,
      particles,
      predictedPositions: current,
      deltaTime: 0.08,
      providers: [elastic, barrier]
    });
    const options = {
      problem,
      coordinates: packed(current),
      direction: packed(directions)
    };
    const analytic =
      evaluateXpbdIncrementalPotentialAnalyticHessianVectorN(options);
    const numeric = estimateXpbdIncrementalPotentialHessianVectorN(options);
    expect(analytic.status).toBe('evaluated');
    expect(numeric.status).toBe('evaluated');
    if (analytic.status !== 'evaluated' || numeric.status !== 'evaluated') {
      return;
    }
    for (let index = 0; index < analytic.product.length; index++) {
      const a = analytic.product[index]!;
      const b = numeric.product[index]!;
      expect(Math.abs(a - b)).toBeLessThanOrEqual(
        2e-5 * Math.max(1, Math.abs(a), Math.abs(b))
      );
    }
    expect(analytic.providers.map((entry) => entry.provider.id))
      .toEqual(['elastic-sheet', 'measure-barrier']);
  });

  it('keeps a custom first-order-only family explicitly unsupported', () => {
    const { source, group } = squareSource();
    const current = [
      new VecN([0, 0]),
      new VecN([1.03, 0.02]),
      new VecN([-0.01, 0.97]),
      new VecN([1.01, 1.04])
    ];
    const particles = current.map((position, vertex) =>
      new XpbdParticleN({
        id: `first-order/${vertex}`,
        position,
        inverseMass: 1
      })
    );
    const firstOrder = compileSimplexConstitutiveFamilyN({
      id: 'first-order-only',
      source,
      simplexGroup: group,
      particles,
      law: {
        id: 'custom-first-order-stvk',
        evaluate: evaluateSimplexStVenantKirchhoffN
      },
      material: { firstLameParameter: 2, shearModulus: 1 }
    });
    expect(firstOrder.evaluatePotentialHessianVectorAt).toBeUndefined();
    const result =
      evaluateXpbdIncrementalPotentialAnalyticHessianVectorN({
        problem: compileXpbdIncrementalPotentialProblemN({
          dimension: 2,
          particles,
          predictedPositions: current,
          deltaTime: 0.1,
          providers: [firstOrder]
        }),
        coordinates: packed(current),
        direction: new Float64Array([
          0.1, 0.2,
          -0.2, 0.1,
          0.05, -0.1,
          0.03, 0.07
        ])
      });
    expect(result.status).toBe('unsupported-provider');
    if (result.status === 'unsupported-provider') {
      expect(result.providerIds).toEqual(['first-order-only']);
    }
  });
});
