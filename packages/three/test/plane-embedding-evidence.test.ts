import { Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CellComplex, PlaneEmbedding3D, PerspectiveProjection } from '@holotope/core';
import {
  ProjectedEdges3D,
  ProjectedSurface3D,
  representationHitFromProjectedEdge,
  representationHitFromProjectedSurface
} from '../src/index.js';

/**
 * P55B Part A: source identity and renderer-point evidence for the embedding,
 * through the same two products that carry projections.
 *
 * The claims under test: identity stays exact, the recovered R2 point is
 * qualified 'approximate' (never 'exact' — a pick is a Float32 observation),
 * the lineage records 'plane-embedding' rather than any projection kind, and
 * ambiguity is 'none' because an injective map cannot overlap. The lossy
 * paths must be byte-identical to before.
 */

function wireSquare(): CellComplex {
  return new CellComplex(2, Float64Array.from([
    0, 0,
    2, 0,
    2, 2,
    0, 2
  ]), [{
    key: 'wire', dim: 1, verticesPerCell: 2, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 1, 2, 2, 3, 3, 0])
  }]);
}

function sheetTriangle(): CellComplex {
  return new CellComplex(2, Float64Array.from([
    0, 0,
    2, 0,
    0, 2
  ]), [{
    key: 'sheet', dim: 2, verticesPerCell: 3, kind: 'simplex',
    indices: Uint32Array.from([0, 1, 2])
  }]);
}

describe('PlaneEmbedding3D through ProjectedEdges3D', () => {
  it('names the edge exactly and recovers an approximate R2 point', () => {
    const complex = wireSquare();
    const product = new ProjectedEdges3D(complex, new PlaneEmbedding3D());
    product.object.updateMatrixWorld(true);
    const caster = new Raycaster(new Vector3(1, 0, 5), new Vector3(0, 0, -1), 0.01, 100);
    caster.params.Line.threshold = 0.05;
    const hits = caster.intersectObject(product.object, true);
    expect(hits.length).toBeGreaterThan(0); // liveness

    const hit = representationHitFromProjectedEdge(product, hits[0]!);
    expect(hit.ambientDim).toBe(2);
    expect(hit.source.kind).toBe('cell');
    if (hit.source.kind === 'cell') {
      expect(hit.source.cellIndex).toBe(0); // the bottom edge, exactly
      expect(Array.from(hit.source.vertexIndices)).toEqual([0, 1]);
    }
    // Injectivity gives a unique inverse of the exact image — the observed
    // point is Float32, so the recovered point is approximate, never exact.
    expect(hit.ambientPointStatus).toBe('approximate');
    expect(hit.ambientPoint).toBeDefined();
    expect(hit.ambientPoint!.dim).toBe(2);
    expect(hit.ambientPoint!.data[0]).toBeCloseTo(1, 4);
    expect(hit.ambientPoint!.data[1]).toBeCloseTo(0, 4);
    expect(hit.ambiguity).toBe('none');
    expect(hit.lineage.steps[0]!.kind).toBe('plane-embedding');
    expect(hit.details.liftMethod).toBe('display-map-inverse');
    expect(hit.details.inverseStatus).toBe('on-image');
    product.dispose();
  });

  it('keeps the evidence on a posed object, where local z is only nearly zero', () => {
    const complex = wireSquare();
    const product = new ProjectedEdges3D(complex, new PlaneEmbedding3D());
    product.object.position.set(10, -4, 2.5);
    product.object.rotation.z = 0.6;
    product.object.updateMatrixWorld(true);
    const worldTarget = new Vector3(1.2, 0, 0)
      .applyMatrix4(product.object.matrixWorld);
    const caster = new Raycaster(
      worldTarget.clone().add(new Vector3(0, 0, 5)), new Vector3(0, 0, -1), 0.01, 100
    );
    caster.params.Line.threshold = 0.05;
    const hits = caster.intersectObject(product.object, true);
    expect(hits.length).toBeGreaterThan(0);
    const hit = representationHitFromProjectedEdge(product, hits[0]!);
    expect(hit.ambientPointStatus).toBe('approximate');
    expect(hit.ambientPoint!.data[0]).toBeCloseTo(1.2, 3);
    expect(hit.ambientPoint!.data[1]).toBeCloseTo(0, 3);
    expect(hit.ambiguity).toBe('none');
    product.dispose();
  });
});

describe('PlaneEmbedding3D through ProjectedSurface3D', () => {
  it('names the face exactly and recovers an approximate R2 point', () => {
    const complex = sheetTriangle();
    const product = new ProjectedSurface3D(complex, new PlaneEmbedding3D());
    product.object.updateMatrixWorld(true);
    const caster = new Raycaster(new Vector3(0.5, 0.5, 5), new Vector3(0, 0, -1), 0.01, 100);
    const hits = caster.intersectObject(product.object, true);
    expect(hits.length).toBeGreaterThan(0);
    const hit = representationHitFromProjectedSurface(product, hits[0]!);
    expect(hit.ambientDim).toBe(2);
    expect(hit.ambientPointStatus).toBe('approximate');
    expect(hit.ambientPoint!.data[0]).toBeCloseTo(0.5, 4);
    expect(hit.ambientPoint!.data[1]).toBeCloseTo(0.5, 4);
    expect(hit.ambiguity).toBe('none');
    expect(hit.lineage.steps[0]!.kind).toBe('plane-embedding');
    product.dispose();
  });
});

describe('the lossy paths are untouched', () => {
  it('keeps a perspective hit exact-lifted with projection-overlap ambiguity', () => {
    // R4 tesseract edge through the pre-existing homogeneous path: the
    // widened annotation must not have changed a single reported field.
    const complex = new CellComplex(4, Float64Array.from([
      -1, -1, -1, -1,
      1, -1, -1, -1,
      1, 1, -1, -1,
      -1, 1, -1, -1
    ]), [{
      key: 'wire', dim: 1, verticesPerCell: 2, kind: 'simplex',
      indices: Uint32Array.from([0, 1, 1, 2, 2, 3, 3, 0])
    }]);
    const product = new ProjectedEdges3D(
      complex, new PerspectiveProjection({ fromDim: 4, viewDistance: 4 })
    );
    product.object.updateMatrixWorld(true);
    const caster = new Raycaster(new Vector3(0, -0.8, 5), new Vector3(0, 0, -1), 0.01, 100);
    caster.params.Line.threshold = 0.05;
    const hits = caster.intersectObject(product.object, true);
    expect(hits.length).toBeGreaterThan(0);
    const hit = representationHitFromProjectedEdge(product, hits[0]!);
    expect(hit.ambientPointStatus).toBe('exact');
    expect(hit.ambiguity).toBe('projection-overlap');
    expect(hit.lineage.steps[0]!.kind).toBe('iterated-perspective-projection');
    expect(hit.details.liftMethod).toBe('homogeneous-simplex');
    product.dispose();
  });
});
