import { describe, expect, it } from 'vitest';
import {
  PerspectiveProjection,
  PlaneEmbedding3D,
  TransformN,
  VecN,
  displayMapRecipe3,
  evaluateRepresentationLineagePointN,
  createRepresentationLineageN,
  isInvertibleDisplayMap3D,
  planeEmbeddingMapRecipe3,
  representationMapCapabilitiesN,
  rotationFromPlanes,
  representationMapCapabilityVerbsN,
  type DisplayMap3D,
  type Projection
} from '../src/index.js';

/**
 * P55B Part A gates: the R2 -> R3 embedding, held to the taxonomy decision.
 *
 * The embedding is injective — the exact opposite of what `Projection`'s docs
 * promise — so the gates check both directions of the map, the typed refusals,
 * and that the taxonomy's structural facts (mutual assignability, capability
 * probes) are what the decision said they are.
 */

describe('PlaneEmbedding3D: the exact map and its packed form', () => {
  it('maps [x, y] to [x, y, 0] exactly, z exactly +0', () => {
    const embedding = new PlaneEmbedding3D();
    const image = embedding.projectPoint([1.5, -2.25]);
    expect(image).toEqual([1.5, -2.25, 0]);
    expect(Object.is(image[2], 0)).toBe(true); // +0, not -0
    // Exact for values with no Float32 representation too: projectPoint is
    // the Float64 path; only the packed buffer rounds.
    const irrational = embedding.projectPoint([Math.PI, Math.SQRT2]);
    expect(irrational[0]).toBe(Math.PI);
    expect(irrational[1]).toBe(Math.SQRT2);
  });

  it('writes the packed Float32 form deterministically', () => {
    const embedding = new PlaneEmbedding3D();
    const source = Float64Array.from([Math.PI, -Math.E, 1e-8, 40.125, -0, 7]);
    const first = new Float32Array(9);
    const second = new Float32Array(9);
    embedding.projectPositions(source, 3, first);
    embedding.projectPositions(source, 3, second);
    expect(Array.from(second)).toEqual(Array.from(first)); // bitwise replay
    for (let point = 0; point < 3; point++) {
      expect(first[point * 3]).toBe(Math.fround(source[point * 2]!));
      expect(first[point * 3 + 1]).toBe(Math.fround(source[point * 2 + 1]!));
      expect(first[point * 3 + 2]).toBe(0);
    }
  });

  it('refuses wrong dimensions, short buffers, and non-finite input by name', () => {
    const embedding = new PlaneEmbedding3D();
    expect(() => embedding.projectPoint([1, 2, 3])).toThrow(/expected a 2D point, got 3/);
    expect(() => embedding.projectPoint([Number.NaN, 0])).toThrow(/must be finite/);
    expect(() => embedding.projectPoint([Number.POSITIVE_INFINITY, 0])).toThrow(/must be finite/);
    expect(() =>
      embedding.projectPositions(Float64Array.from([1, 2]), 2, new Float32Array(6))
    ).toThrow(/buffers are too small/);
    expect(() =>
      embedding.projectPositions(Float64Array.from([1, 2]), -1, new Float32Array(3))
    ).toThrow(/non-negative integer/);
    expect(() => embedding.invertPoint([1, 2])).toThrow(/expected a 3D display point, got 2/);
    expect(() => embedding.invertPoint([1, 2, Number.NaN])).toThrow(/must be finite/);
    expect(() => embedding.invertPoint([1, 2, 0], { tolerance: -1 }))
      .toThrow(/tolerance must be finite and non-negative/);
  });

  it('commutes with in-plane rigid motion', () => {
    // Rotate then embed equals embed then rotate-about-z: the covariance that
    // makes "the strip is the source" a true sentence in a posed scene.
    const embedding = new PlaneEmbedding3D();
    const angle = 0.7;
    const planar = new TransformN(
      2, rotationFromPlanes(2, [{ i: 0, j: 1, angle }]), new VecN([0.3, -1.2])
    );
    const spatial = new TransformN(
      3, rotationFromPlanes(3, [{ i: 0, j: 1, angle }]), new VecN([0.3, -1.2, 0])
    );
    const points = [[1, 0], [0.25, -3], [Math.PI, Math.E]] as const;
    for (const point of points) {
      const throughPlane = embedding.projectPoint(
        planar.applyToPoint(new VecN(point)).data
      );
      const throughSpace = spatial.applyToPoint(
        new VecN(embedding.projectPoint(point))
      );
      for (let axis = 0; axis < 3; axis++) {
        expect(throughPlane[axis]).toBeCloseTo(throughSpace.data[axis]!, 12);
      }
    }
  });
});

describe('PlaneEmbedding3D: the unique inverse and its typed refusal', () => {
  it('round-trips the exact image bitwise and refuses z != 0 by type', () => {
    const embedding = new PlaneEmbedding3D();
    const source = [Math.PI, -41.0625] as const;
    const back = embedding.invertPoint(embedding.projectPoint(source));
    expect(back.status).toBe('on-image');
    if (back.status === 'on-image') {
      expect(back.point[0]).toBe(source[0]); // bitwise: the inverse is exact
      expect(back.point[1]).toBe(source[1]);
    }
    const off = embedding.invertPoint([1, 2, 0.5]);
    expect(off.status).toBe('off-image');
    if (off.status === 'off-image') expect(off.distanceFromImage).toBe(0.5);
    // The default is the mathematical inverse: even one ulp off refuses.
    expect(embedding.invertPoint([1, 2, 5e-324]).status).toBe('off-image');
    // Signed zero is on the image.
    expect(embedding.invertPoint([1, 2, -0]).status).toBe('on-image');
  });

  it('accepts an explicit observation band, scaled by the point magnitude', () => {
    const embedding = new PlaneEmbedding3D();
    const nearly = embedding.invertPoint([100, 0, 5e-4], { tolerance: 1e-5 });
    expect(nearly.status).toBe('on-image'); // 5e-4 <= 1e-5 * 100
    const beyond = embedding.invertPoint([1, 0, 5e-4], { tolerance: 1e-5 });
    expect(beyond.status).toBe('off-image'); // 5e-4 > 1e-5 * 1
  });
});

describe('the display-map taxonomy, as decided', () => {
  it('keeps Projection and DisplayMap3D mutually assignable, embedding only broad', () => {
    // The structural fact the Part A decision turns on, pinned: widening the
    // products' annotation cannot break a caller in either direction.
    const projection = new PerspectiveProjection({ fromDim: 4, viewDistance: 4 });
    const asMap: DisplayMap3D = projection;
    const backToProjection: Projection = asMap;
    expect(backToProjection.fromDim).toBe(4);
    const embedding: DisplayMap3D = new PlaneEmbedding3D();
    expect(embedding.fromDim).toBe(2);
  });

  it('probes invertibility by capability, not identity', () => {
    expect(isInvertibleDisplayMap3D(new PlaneEmbedding3D())).toBe(true);
    expect(
      isInvertibleDisplayMap3D(new PerspectiveProjection({ fromDim: 4, viewDistance: 4 }))
    ).toBe(false);
  });

  it('records the embedding as plane-embedding, never a projection kind', () => {
    const recipe = displayMapRecipe3(new PlaneEmbedding3D());
    expect(recipe).toEqual(planeEmbeddingMapRecipe3());
    expect(recipe.kind).toBe('plane-embedding');
    // Delegation leaves lossy maps' recipes bit-for-bit what they were.
    const lossy = displayMapRecipe3(new PerspectiveProjection({ fromDim: 4, viewDistance: 4 }));
    expect(lossy.kind).toBe('iterated-perspective-projection');
  });

  it('evaluates the embedding step exactly and classifies it invertible-no-fibre', () => {
    const lineage = createRepresentationLineageN(2, [planeEmbeddingMapRecipe3()]);
    const evaluated = evaluateRepresentationLineagePointN(lineage, [1.25, -3.5]);
    expect(evaluated.kind).toBe('exact');
    if (evaluated.kind === 'exact') {
      expect(Array.from(evaluated.point.data)).toEqual([1.25, -3.5, 0]);
    }
    const capabilities = representationMapCapabilitiesN(planeEmbeddingMapRecipe3());
    expect(capabilities.pointForward).toBe('exact');
    expect(capabilities.pointLift).toBe('exact');
    expect(capabilities.inverseFibre).toBe('unavailable'); // no fibre to disclose
    const verbs = representationMapCapabilityVerbsN(planeEmbeddingMapRecipe3());
    expect(verbs.pointLift?.symbol).toBe('PlaneEmbedding3D.invertPoint');
    expect(verbs.inverseFibre).toBeUndefined();
  });

  it('refuses a malformed stored record by type instead of truncating', () => {
    // A record from storage has only its own word: a step whose declared
    // dimensions are wrong must become a typed unavailability, never a silent
    // truncation of a higher-dimensional point to its first two entries.
    const forged = {
      sourceDim: 5,
      representationDim: 3,
      steps: [{ kind: 'plane-embedding', fromDim: 5, toDim: 3 }]
    } as unknown as Parameters<typeof evaluateRepresentationLineagePointN>[0];
    const evaluated = evaluateRepresentationLineagePointN(forged, [1, 2, 3, 4, 5]);
    expect(evaluated.kind).toBe('unavailable');
    if (evaluated.kind === 'unavailable') {
      expect(evaluated.reason).toBe('recipe-insufficient');
      expect(evaluated.steps.length).toBe(1); // the forged step, and nothing after it
    }
  });
});
