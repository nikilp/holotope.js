import { BackSide, BoxGeometry, Mesh, NodeMaterial, Vector4 } from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  bool,
  cameraPosition,
  cos,
  dot,
  float,
  fwidth,
  max,
  min,
  mix,
  modelWorldMatrixInverse,
  positionGeometry,
  pow,
  select,
  smoothstep,
  uniform,
  varying,
  vec2,
  vec3,
  vec4
} from 'three/tsl';
import { QuaternionJuliaField, type HyperplaneSlice4 } from '@holotope/core';

export interface RaymarchedQuaternionJulia3DOptions {
  /** Half-width of the marched cube in slice coordinates. Default 1.65. */
  extent?: number;
  /** Maximum sphere-tracing steps per fragment. Default 112. */
  maxSteps?: number;
  /** Surface hit threshold in slice coordinates. Default 0.0015. */
  surfaceEpsilon?: number;
  /** Finite-difference step for field-gradient normals. Default 0.004. */
  normalEpsilon?: number;
  /** Safety factor applied to the lower-bound distance estimate. Default 0.72. */
  stepSafety?: number;
}

/**
 * TSL sphere-traced section of a quaternion Julia field. Unlike
 * `SampledSlicedField3D`, it does not voxelize the field or extract a
 * triangle surface: each fragment restricts the same R4 field to the
 * supplied affine 3-flat and marches it adaptively.
 *
 * The box mesh is only the ray-entry proxy. Shading, gradient normals, and
 * the visible surface are evaluated in the fragment stage. Use with
 * `WebGPURenderer`; the TSL graph can also compile through its WebGL2
 * fallback.
 */
export class RaymarchedQuaternionJulia3D {
  readonly field: QuaternionJuliaField;
  readonly slice: HyperplaneSlice4;
  readonly extent: number;
  readonly maxSteps: number;
  readonly surfaceEpsilon: number;
  readonly normalEpsilon: number;
  readonly stepSafety: number;
  readonly object: Mesh;

  private readonly basisValues = [new Vector4(), new Vector4(), new Vector4()] as const;
  private readonly normalValue = new Vector4();
  private readonly offsetUniform = uniform(0);

  constructor(
    field: QuaternionJuliaField,
    slice: HyperplaneSlice4,
    options: RaymarchedQuaternionJulia3DOptions = {}
  ) {
    this.field = field;
    this.slice = slice;
    this.extent = options.extent ?? 1.65;
    this.maxSteps = options.maxSteps ?? 112;
    this.surfaceEpsilon = options.surfaceEpsilon ?? 0.0015;
    this.normalEpsilon = options.normalEpsilon ?? 0.004;
    this.stepSafety = options.stepSafety ?? field.distanceEstimator.recommendedStepSafety;
    if (!Number.isFinite(this.extent) || this.extent <= 0) {
      throw new Error('RaymarchedQuaternionJulia3D: extent must be positive and finite');
    }
    if (!Number.isSafeInteger(this.maxSteps) || this.maxSteps < 1 || this.maxSteps > 512) {
      throw new Error('RaymarchedQuaternionJulia3D: maxSteps must be an integer in [1, 512]');
    }
    for (const [label, value] of [
      ['surfaceEpsilon', this.surfaceEpsilon],
      ['normalEpsilon', this.normalEpsilon],
      ['stepSafety', this.stepSafety]
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`RaymarchedQuaternionJulia3D: ${label} must be positive and finite`);
      }
    }
    if (this.stepSafety > 1) {
      throw new Error('RaymarchedQuaternionJulia3D: stepSafety must not exceed one');
    }

    const basisUniforms = this.basisValues.map((value) => uniform(value));
    const normalUniform = uniform(this.normalValue);
    const parameter = field.parameter;
    const parameterUniform = uniform(
      new Vector4(parameter[0], parameter[1], parameter[2], parameter[3])
    );
    const escapeSquared = float(field.options.escapeRadius * field.options.escapeRadius);
    const maximumIterations = field.options.maxIterations;
    const extent = float(this.extent);
    const surfaceEpsilon = float(this.surfaceEpsilon);
    const normalEpsilon = float(this.normalEpsilon);
    const stepSafety = float(this.stepSafety);

    // These helpers build TSL subgraphs. Keeping them in the node graph
    // allows the same implementation to target WGSL and the renderer's
    // WebGL2 fallback.
    const embedInSlice = (point: any): any =>
      basisUniforms[0]!.mul(point.x)
        .add(basisUniforms[1]!.mul(point.y))
        .add(basisUniforms[2]!.mul(point.z))
        .add(normalUniform.mul(this.offsetUniform));

    const evaluate = (point: any): any => {
      const q = vec4(point).toVar();
      const radiusSquared = dot(q, q).toVar();
      const derivativeBound = float(1).toVar();
      const orbitTrap = radiusSquared.sqrt().toVar();
      const iterations = float(0).toVar();

      Loop(maximumIterations, () => {
        If(radiusSquared.greaterThan(escapeSquared), () => {
          Break();
        });
        const radius = radiusSquared.sqrt();
        derivativeBound.mulAssign(radius.mul(2));
        q.assign(
          vec4(
            q.w.mul(q.x).mul(2).add(parameterUniform.x),
            q.w.mul(q.y).mul(2),
            q.w.mul(q.z).mul(2),
            q.w.mul(q.w)
              .sub(q.x.mul(q.x))
              .sub(q.y.mul(q.y))
              .sub(q.z.mul(q.z))
              .add(parameterUniform.w)
          )
        );
        radiusSquared.assign(dot(q, q));
        orbitTrap.assign(min(orbitTrap, radiusSquared.sqrt()));
        iterations.addAssign(1);
      });

      const escaped = radiusSquared.greaterThan(escapeSquared);
      const magnitude = radiusSquared.sqrt();
      const distance = float(0).toVar();
      If(escaped.and(derivativeBound.greaterThan(0)), () => {
        distance.assign(max(0, magnitude.mul(magnitude.log()).mul(0.5).div(derivativeBound)));
      });
      return vec4(distance, iterations, orbitTrap, select(escaped, 1, 0));
    };

    const localCamera = varying(
      vec3(modelWorldMatrixInverse.mul(vec4(cameraPosition, 1)))
    );
    const localDirection = varying(positionGeometry.sub(localCamera));

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
          const record = evaluate(embedInSlice(position)).toVar();
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
      // Orbit-trap bands are procedural fragment detail, so ordinary MSAA
      // cannot filter them. Fade their contrast once one screen pixel spans
      // a substantial part of a band period; this suppresses distant moire
      // without erasing the bands when the camera moves close enough to
      // resolve them.
      const bandPhase = hitRecord.z.mul(22);
      const bandFootprint = fwidth(bandPhase);
      const bandContrast = float(0.12).mul(
        float(1).sub(smoothstep(0.18, 1.25, bandFootprint))
      );
      If(hit, () => {
        const ex = vec3(normalEpsilon, 0, 0);
        const ey = vec3(0, normalEpsilon, 0);
        const ez = vec3(0, 0, normalEpsilon);
        const gradient = vec3(
          evaluate(embedInSlice(hitPosition.add(ex))).x.sub(
            evaluate(embedInSlice(hitPosition.sub(ex))).x
          ),
          evaluate(embedInSlice(hitPosition.add(ey))).x.sub(
            evaluate(embedInSlice(hitPosition.sub(ey))).x
          ),
          evaluate(embedInSlice(hitPosition.add(ez))).x.sub(
            evaluate(embedInSlice(hitPosition.sub(ez))).x
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

        const phase = hitRecord.y.div(maximumIterations);
        const palette = mix(
          vec3(0.035, 0.24, 0.48),
          vec3(0.98, 0.16, 0.57),
          smoothstep(0.08, 0.9, phase)
        );
        const bands = float(1)
          .sub(bandContrast)
          .add(cos(bandPhase).mul(bandContrast));
        const lightDirection = vec3(0.55, 0.72, 0.42).normalize();
        const diffuse = max(dot(gradient, lightDirection), 0);
        const viewFacing = max(dot(gradient, rayDirection.negate()), 0);
        const rim = pow(float(1).sub(viewFacing), 2.4);
        const traceOcclusion = float(1).sub(stepCount.div(this.maxSteps).mul(0.38));
        const lit = palette
          .mul(float(0.16).add(diffuse.mul(0.84)))
          .mul(bands)
          .mul(traceOcclusion)
          .add(vec3(0.34, 0.12, 0.5).mul(rim));
        output.assign(vec4(lit, 1));
      });
      return output;
    });

    const material = new NodeMaterial();
    material.fragmentNode = fragment();
    // Render the far/exit faces of the proxy cube. The shader computes the
    // actual near/far ray interval itself, so this works both outside and
    // inside the box; FrontSide would disappear as soon as the camera
    // crossed the proxy boundary.
    material.side = BackSide;
    material.transparent = true;
    material.depthWrite = false;
    this.object = new Mesh(
      new BoxGeometry(this.extent * 2, this.extent * 2, this.extent * 2),
      material
    );
    this.object.frustumCulled = false;
    this.update();
  }

  /** Refresh the affine 3-flat uniforms after changing the slice. */
  update(): void {
    for (let axis = 0; axis < 3; axis++) {
      const basis = this.slice.basis[axis]!;
      this.basisValues[axis]!.set(basis[0]!, basis[1]!, basis[2]!, basis[3]!);
    }
    const normal = this.slice.normal.data;
    this.normalValue.set(normal[0]!, normal[1]!, normal[2]!, normal[3]!);
    this.offsetUniform.value = this.slice.offset;
  }

  dispose(): void {
    this.object.geometry.dispose();
    const material = this.object.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();
  }
}
