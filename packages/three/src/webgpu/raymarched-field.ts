import {
  BackSide,
  BoxGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  NodeMaterial,
  Ray,
  Vector3,
  Vector4,
  type Node,
  type NodeBuilder
} from 'three/webgpu';
import {
  Break,
  Discard,
  Fn,
  If,
  Loop,
  bool,
  cameraFar,
  cameraNear,
  cameraPosition,
  depth,
  dot,
  float,
  max,
  min,
  mix,
  modelViewMatrix,
  modelWorldMatrixInverse,
  positionGeometry,
  smoothstep,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  viewZToLogarithmicDepth,
  viewZToOrthographicDepth,
  viewZToPerspectiveDepth,
  viewZToReversedOrthographicDepth,
  viewZToReversedPerspectiveDepth
} from 'three/tsl';
import {
  traceFieldSliceRay3,
  type FieldEvaluation4,
  type HyperplaneSlice4,
  type ImplicitField4,
  type Vec4f64
} from '@holotope/core';
import type {
  ImplicitFieldNode4,
  RaymarchedFieldStyle3D
} from './implicit-field-node4.js';

export interface RaymarchedField3DOptions {
  /** Half-width of the marched cube in slice coordinates. Default 1.65. */
  extent?: number;
  /** Maximum sphere-tracing steps per fragment. Default 112. */
  maxSteps?: number;
  /** Surface hit threshold in slice coordinates. Default 0.0015. */
  surfaceEpsilon?: number;
  /** Finite-difference step for field-gradient normals. Default 0.004. */
  normalEpsilon?: number;
  /** Safety factor applied to the field's distance estimate. */
  stepSafety?: number;
  /** Record-driven presentation. A neutral diagnostic style is used by default. */
  style?: RaymarchedFieldStyle3D;
  /** Write the marched hit depth into the scene depth buffer. Default true. */
  writeDepth?: boolean;
}

export interface RaymarchedFieldIntersection<Record extends FieldEvaluation4 = FieldEvaluation4> {
  /** Distance from the supplied world-space ray origin. */
  readonly distance: number;
  readonly point: Vector3;
  readonly pointLocal: Vector3;
  readonly point4: Vec4f64;
  readonly normal: Vector3;
  readonly normalLocal: Vector3;
  readonly steps: number;
  readonly startedInside: boolean;
  readonly record: Record;
}

const DEFAULT_STYLE: RaymarchedFieldStyle3D = {
  shade({ record, normal, rayDirection, stepFraction, iterationLimit }) {
    const dwell = smoothstep(0.05, 0.95, record.y.div(iterationLimit));
    const albedo = mix(vec3(0.06, 0.22, 0.42), vec3(0.7, 0.82, 1), dwell);
    const diffuse = max(dot(normal, vec3(0.55, 0.72, 0.42).normalize()), 0);
    const viewFacing = max(dot(normal, rayDirection.negate()), 0);
    const rim = float(1).sub(viewFacing).pow(2.4);
    const traceOcclusion = float(1).sub(stepFraction.mul(0.38));
    return albedo
      .mul(float(0.16).add(diffuse.mul(0.84)))
      .mul(traceOcclusion)
      .add(vec3(0.2, 0.32, 0.55).mul(rim));
  }
};

/**
 * Generic adaptive rendering product for an R4 implicit field restricted to
 * an affine 3-flat. The field supplies a packed TSL evaluator, the product
 * owns ray transport and slice uniforms, and a style maps records to color.
 *
 * The proxy cube only supplies fragments and a ray interval. No voxel grid or
 * extracted triangle surface participates in the rendering.
 */
export class RaymarchedField3D<
  Record extends FieldEvaluation4 = FieldEvaluation4,
  Field extends ImplicitField4<Record> = ImplicitField4<Record>
> {
  readonly field: Field;
  readonly fieldNode: ImplicitFieldNode4<Record, Field>;
  readonly slice: HyperplaneSlice4;
  readonly extent: number;
  readonly maxSteps: number;
  readonly surfaceEpsilon: number;
  readonly normalEpsilon: number;
  readonly stepSafety: number;
  readonly style: RaymarchedFieldStyle3D;
  readonly writeDepth: boolean;
  readonly object: Mesh;

  private _revision = 0;
  private readonly basisValues = [new Vector4(), new Vector4(), new Vector4()] as const;
  private readonly normalValue = new Vector4();
  private readonly offsetUniform = uniform(0);

  constructor(
    fieldNode: ImplicitFieldNode4<Record, Field>,
    slice: HyperplaneSlice4,
    options: RaymarchedField3DOptions = {}
  ) {
    this.field = fieldNode.field;
    this.fieldNode = fieldNode;
    this.slice = slice;
    this.extent = options.extent ?? 1.65;
    this.maxSteps = options.maxSteps ?? 112;
    this.surfaceEpsilon = options.surfaceEpsilon ?? 0.0015;
    this.normalEpsilon = options.normalEpsilon ?? 0.004;
    this.stepSafety = options.stepSafety ?? fieldNode.recommendedStepSafety;
    this.style = options.style ?? DEFAULT_STYLE;
    this.writeDepth = options.writeDepth ?? true;

    if (!Number.isFinite(this.extent) || this.extent <= 0) {
      throw new Error('RaymarchedField3D: extent must be positive and finite');
    }
    if (!Number.isSafeInteger(this.maxSteps) || this.maxSteps < 1 || this.maxSteps > 512) {
      throw new Error('RaymarchedField3D: maxSteps must be an integer in [1, 512]');
    }
    if (
      !Number.isSafeInteger(fieldNode.iterationLimit) ||
      fieldNode.iterationLimit < 1 ||
      fieldNode.iterationLimit > 65535
    ) {
      throw new Error('RaymarchedField3D: fieldNode.iterationLimit must be an integer in [1, 65535]');
    }
    for (const [label, value] of [
      ['surfaceEpsilon', this.surfaceEpsilon],
      ['normalEpsilon', this.normalEpsilon],
      ['stepSafety', this.stepSafety]
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`RaymarchedField3D: ${label} must be positive and finite`);
      }
    }
    if (this.stepSafety > 1) {
      throw new Error('RaymarchedField3D: stepSafety must not exceed one');
    }

    const basisUniforms = this.basisValues.map((value) => uniform(value));
    const normalUniform = uniform(this.normalValue);
    const surfaceEpsilon = float(this.surfaceEpsilon);
    const normalEpsilon = float(this.normalEpsilon);
    const stepSafety = float(this.stepSafety);

    const embedInSlice = (point: Node<'vec3'>): Node<'vec4'> =>
      basisUniforms[0]!.mul(point.x)
        .add(basisUniforms[1]!.mul(point.y))
        .add(basisUniforms[2]!.mul(point.z))
        .add(normalUniform.mul(this.offsetUniform));

    const localCamera = varying(vec3(modelWorldMatrixInverse.mul(vec4(cameraPosition, 1))));
    const localDirection = varying(positionGeometry.sub(localCamera));
    const hitDepth = Fn(([localPoint]: [Node<'vec3'>], builder: NodeBuilder) => {
      const camera = (builder as NodeBuilder & { camera: { isPerspectiveCamera?: boolean } }).camera;
      const viewZ = modelViewMatrix.mul(vec4(localPoint, 1)).z;
      if (builder.renderer.logarithmicDepthBuffer && camera.isPerspectiveCamera) {
        return viewZToLogarithmicDepth(viewZ, cameraNear, cameraFar);
      }
      if (builder.renderer.reversedDepthBuffer) {
        return camera.isPerspectiveCamera
          ? viewZToReversedPerspectiveDepth(viewZ, cameraNear, cameraFar)
          : viewZToReversedOrthographicDepth(viewZ, cameraNear, cameraFar);
      }
      return camera.isPerspectiveCamera
        ? viewZToPerspectiveDepth(viewZ, cameraNear, cameraFar)
        : viewZToOrthographicDepth(viewZ, cameraNear, cameraFar);
    });

    const fragment = Fn(() => {
      const rayDirection = localDirection.normalize();
      const inverseDirection = rayDirection.reciprocal();
      const minimumT = vec3(-this.extent).sub(localCamera).mul(inverseDirection);
      const maximumT = vec3(this.extent).sub(localCamera).mul(inverseDirection);
      const nearVector = min(minimumT, maximumT);
      const farVector = max(minimumT, maximumT);
      const bounds = vec2(
        max(nearVector.x, max(nearVector.y, nearVector.z)),
        min(farVector.x, min(farVector.y, farVector.z))
      ).toVar();
      bounds.x.assign(max(bounds.x, 0));

      const travelled = bounds.x.toVar();
      const position = vec3(localCamera.add(rayDirection.mul(travelled))).toVar();
      const hit = bool(false).toVar();
      const hitPosition = vec3(0).toVar();
      const hitRecord = vec4(0).toVar();
      const stepCount = float(0).toVar();

      If(bounds.x.lessThanEqual(bounds.y), () => {
        Loop(this.maxSteps, () => {
          If(travelled.greaterThan(bounds.y), () => {
            Break();
          });
          const record = fieldNode.evaluate(embedInSlice(position)).toVar();
          If(record.w.lessThan(0.5).or(record.x.lessThan(surfaceEpsilon)), () => {
            hit.assign(bool(true));
            hitPosition.assign(position);
            hitRecord.assign(record);
            Break();
          });
          const advance = max(record.x.mul(stepSafety), surfaceEpsilon.mul(0.25));
          travelled.addAssign(advance);
          position.addAssign(rayDirection.mul(advance));
          stepCount.addAssign(1);
        });
      });

      const output = vec4(0, 0, 0, 0).toVar();
      If(hit.not(), () => {
        Discard();
      });
      If(hit, () => {
        const ex = vec3(normalEpsilon, 0, 0);
        const ey = vec3(0, normalEpsilon, 0);
        const ez = vec3(0, 0, normalEpsilon);
        const gradient = vec3(
          fieldNode.evaluate(embedInSlice(hitPosition.add(ex))).x.sub(
            fieldNode.evaluate(embedInSlice(hitPosition.sub(ex))).x
          ),
          fieldNode.evaluate(embedInSlice(hitPosition.add(ey))).x.sub(
            fieldNode.evaluate(embedInSlice(hitPosition.sub(ey))).x
          ),
          fieldNode.evaluate(embedInSlice(hitPosition.add(ez))).x.sub(
            fieldNode.evaluate(embedInSlice(hitPosition.sub(ez))).x
          )
        ).toVar();
        If(dot(gradient, gradient).lessThan(1e-12), () => {
          gradient.assign(rayDirection.negate());
        }).Else(() => {
          gradient.assign(gradient.normalize());
        });
        If(dot(gradient, rayDirection).greaterThan(0), () => {
          gradient.mulAssign(-1);
        });

        depth.assign(hitDepth(hitPosition)).toStack();

        const color = this.style.shade({
          record: hitRecord,
          normal: gradient,
          rayDirection,
          stepFraction: stepCount.div(this.maxSteps),
          iterationLimit: fieldNode.iterationLimit
        });
        output.assign(vec4(color, 1));
      });
      return output;
    });

    const material = new NodeMaterial();
    material.fragmentNode = fragment();
    material.side = BackSide;
    material.transparent = true;
    material.depthWrite = this.writeDepth;
    this.object = new Mesh(
      new BoxGeometry(this.extent * 2, this.extent * 2, this.extent * 2),
      material
    );
    this.object.frustumCulled = false;
    this.update();
  }

  /** Refresh affine-slice uniforms after changing the live slice. */
  update(): void {
    for (let axis = 0; axis < 3; axis++) {
      const basis = this.slice.basis[axis]!;
      this.basisValues[axis]!.set(basis[0]!, basis[1]!, basis[2]!, basis[3]!);
    }
    const normal = this.slice.normal.data;
    this.normalValue.set(normal[0]!, normal[1]!, normal[2]!, normal[3]!);
    this.offsetUniform.value = this.slice.offset;
    this._revision++;
  }

  /** Monotonic invalidation key for temporal or progressive render pipelines. */
  get revision(): number {
    return this._revision;
  }

  /**
   * CPU-golden intersection for picking and inspection. The supplied ray and
   * returned point/normal are in world space; `pointLocal` and `point4` retain
   * the renderer-local and ambient-field coordinates.
   */
  intersectRay(ray: Ray): RaymarchedFieldIntersection<Record> | null {
    this.object.updateWorldMatrix(true, false);
    const inverse = new Matrix4().copy(this.object.matrixWorld).invert();
    const localRay = ray.clone().applyMatrix4(inverse);
    const result = traceFieldSliceRay3(
      this.field,
      this.slice,
      localRay.origin.toArray(),
      localRay.direction.toArray(),
      {
        extent: this.extent,
        maxSteps: this.maxSteps,
        surfaceEpsilon: this.surfaceEpsilon,
        normalEpsilon: this.normalEpsilon,
        stepSafety: this.stepSafety
      }
    );
    if (!result.hit) return null;

    const pointLocal = new Vector3(...result.position);
    const point = pointLocal.clone().applyMatrix4(this.object.matrixWorld);
    const normalLocal = new Vector3(...result.normal);
    const normalMatrix = new Matrix3().getNormalMatrix(this.object.matrixWorld);
    const normal = normalLocal.clone().applyMatrix3(normalMatrix).normalize();
    if (normal.dot(ray.direction) > 0) normal.negate();
    return {
      distance: point.distanceTo(ray.origin),
      point,
      pointLocal,
      point4: result.point4,
      normal,
      normalLocal,
      steps: result.steps,
      startedInside: result.startedInside,
      record: result.record
    };
  }

  dispose(): void {
    this.object.geometry.dispose();
    const material = this.object.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();
  }
}
