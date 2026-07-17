import { MatN, Rotor4, TransformN, VecN } from '@holotope/core';
import {
  type SupportFeatureId,
  type SupportShapeN,
  type SupportVertexN
} from './support-shape.js';

/** Full-dimensional oriented 4D box with stable bit-mask vertex IDs. */
export class HyperboxSupportShape4 implements SupportShapeN {
  readonly dim = 4;
  readonly halfExtents: Float64Array;
  transform: TransformN;

  constructor(halfExtents: ArrayLike<number>, transform?: TransformN) {
    if (halfExtents.length !== 4) {
      throw new Error(
        `HyperboxSupportShape4: expected four half extents, got ${halfExtents.length}`
      );
    }
    this.halfExtents = Float64Array.from(halfExtents);
    if (Array.from(this.halfExtents).some((extent) => !Number.isFinite(extent) || extent <= 0)) {
      throw new Error('HyperboxSupportShape4: half extents must be finite and positive');
    }
    this.transform = transform?.clone() ?? TransformN.identity(4);
    assertHyperboxTransform(this.transform);
  }

  get center(): VecN {
    return this.transform.position.clone();
  }

  /** Current orthonormal local coordinate axes expressed in world R4. */
  worldAxes(): readonly [VecN, VecN, VecN, VecN] {
    assertHyperboxTransform(this.transform);
    const worldAxis = (axis: number): VecN => {
      const basis = VecN.basis(4, axis);
      return this.transform.rotation instanceof Rotor4
        ? this.transform.rotation.applyToPoint(basis)
        : this.transform.rotation.applyTo(basis);
    };
    return [worldAxis(0), worldAxis(1), worldAxis(2), worldAxis(3)];
  }

  support(direction: VecN): SupportVertexN {
    assertDirection4(direction);
    const axes = this.worldAxes();
    let featureId = 0;
    const point = this.center;
    for (let axis = 0; axis < 4; axis++) {
      const positive = axes[axis]!.dot(direction) >= 0;
      if (positive) featureId |= 1 << axis;
      point.add(
        axes[axis]!.clone().multiplyScalar(
          (positive ? 1 : -1) * this.halfExtents[axis]!
        )
      );
    }
    return { point, featureId };
  }

  resolveFeature(featureId: SupportFeatureId): SupportVertexN | undefined {
    if (
      typeof featureId !== 'number' ||
      !Number.isSafeInteger(featureId) ||
      featureId < 0 ||
      featureId >= 16
    ) {
      return undefined;
    }
    const axes = this.worldAxes();
    const point = this.center;
    for (let axis = 0; axis < 4; axis++) {
      point.add(
        axes[axis]!.clone().multiplyScalar(
          ((featureId & (1 << axis)) !== 0 ? 1 : -1) * this.halfExtents[axis]!
        )
      );
    }
    return { point, featureId };
  }

  enumerateVertices(): readonly SupportVertexN[] {
    return Array.from({ length: 16 }, (_, featureId) =>
      this.resolveFeature(featureId)!
    );
  }
}

function assertDirection4(direction: VecN): void {
  if (
    direction.dim !== 4 ||
    Array.from(direction.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error('HyperboxSupportShape4: direction must contain four finite coordinates');
  }
}

function assertHyperboxTransform(transform: TransformN): void {
  if (transform.dim !== 4) {
    throw new Error(`HyperboxSupportShape4: transform dimension ${transform.dim} != 4`);
  }
  if (Array.from(transform.position.data).some((coordinate) => !Number.isFinite(coordinate))) {
    throw new Error('HyperboxSupportShape4: transform position must be finite');
  }
  const matrix = transform.rotation instanceof MatN
    ? transform.rotation
    : transform.rotation.toMatrix();
  if (
    Array.from(matrix.data).some((entry) => !Number.isFinite(entry)) ||
    matrix.orthogonalityError() > 1e-10
  ) {
    throw new Error('HyperboxSupportShape4: transform rotation must be orthonormal');
  }
}
