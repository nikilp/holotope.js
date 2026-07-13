import { BackSide, BoxGeometry, Mesh, NodeMaterial, Vector4 } from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  bool,
  cameraPosition,
  dot,
  float,
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
import { BicomplexJuliaField, type HyperplaneSlice4 } from '@holotope/core';

export interface RaymarchedBicomplexJulia3DOptions {
  /** Half-width of the marched cube in slice coordinates. Default 1.65. */
  extent?: number;
  /** Maximum sphere-tracing steps per fragment. Default 144. */
  maxSteps?: number;
  /** Surface hit threshold in slice coordinates. Default 0.0015. */
  surfaceEpsilon?: number;
  /** Finite-difference step for field-gradient normals. Default 0.004. */
  normalEpsilon?: number;
  /** Safety factor applied to the proven product distance estimate. Default comes from the field. */
  stepSafety?: number;
}

/**
 * Fragment-stage section of a bicomplex Julia product. Each R4 point is
 * changed to its two idempotent complex factors, the factors are iterated
 * independently, and their certified distances are combined in the
 * orthogonal product metric before sphere tracing.
 *
 * The proxy cube only supplies fragments and a ray interval. No sampled
 * voxel grid or extracted triangle surface participates in the rendering.
 */
export class RaymarchedBicomplexJulia3D {
  readonly field: BicomplexJuliaField;
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
    field: BicomplexJuliaField,
    slice: HyperplaneSlice4,
    options: RaymarchedBicomplexJulia3DOptions = {}
  ) {
    this.field = field;
    this.slice = slice;
    this.extent = options.extent ?? 1.65;
    this.maxSteps = options.maxSteps ?? 144;
    this.surfaceEpsilon = options.surfaceEpsilon ?? 0.0015;
    this.normalEpsilon = options.normalEpsilon ?? 0.004;
    this.stepSafety = options.stepSafety ?? field.distanceEstimator.recommendedStepSafety;
    if (!Number.isFinite(this.extent) || this.extent <= 0) {
      throw new Error('RaymarchedBicomplexJulia3D: extent must be positive and finite');
    }
    if (!Number.isSafeInteger(this.maxSteps) || this.maxSteps < 1 || this.maxSteps > 512) {
      throw new Error('RaymarchedBicomplexJulia3D: maxSteps must be an integer in [1, 512]');
    }
    for (const [label, value] of [
      ['surfaceEpsilon', this.surfaceEpsilon],
      ['normalEpsilon', this.normalEpsilon],
      ['stepSafety', this.stepSafety]
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`RaymarchedBicomplexJulia3D: ${label} must be positive and finite`);
      }
    }
    if (this.stepSafety > 1) {
      throw new Error('RaymarchedBicomplexJulia3D: stepSafety must not exceed one');
    }

    const basisUniforms = this.basisValues.map((value) => uniform(value));
    const normalUniform = uniform(this.normalValue);
    const firstParameter = field.factorParameters.first;
    const secondParameter = field.factorParameters.second;
    const parameterUniform = uniform(
      new Vector4(
        firstParameter[0],
        firstParameter[1],
        secondParameter[0],
        secondParameter[1]
      )
    );
    const escapeSquared = float(field.options.escapeRadius * field.options.escapeRadius);
    const maximumIterations = field.options.maxIterations;
    const surfaceEpsilon = float(this.surfaceEpsilon);
    const normalEpsilon = float(this.normalEpsilon);
    const stepSafety = float(this.stepSafety);

    const embedInSlice = (point: any): any =>
      basisUniforms[0]!.mul(point.x)
        .add(basisUniforms[1]!.mul(point.y))
        .add(basisUniforms[2]!.mul(point.z))
        .add(normalUniform.mul(this.offsetUniform));

    // Record layout: distance, iterations, orbit trap, escaped flag.
    const evaluateFactor = (source: any, parameter: any): any => {
      const z = vec2(source).toVar();
      const radiusSquared = dot(z, z).toVar();
      const derivativeBound = float(1).toVar();
      const orbitTrap = radiusSquared.sqrt().toVar();
      const iterations = float(0).toVar();

      Loop(maximumIterations, () => {
        If(radiusSquared.greaterThan(escapeSquared), () => {
          Break();
        });
        const radius = radiusSquared.sqrt();
        derivativeBound.mulAssign(radius.mul(2));
        z.assign(
          vec2(
            z.y.mul(z.x).mul(2).add(parameter.x),
            z.y.mul(z.y).sub(z.x.mul(z.x)).add(parameter.y)
          )
        );
        radiusSquared.assign(dot(z, z));
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

    // Record layout: product distance, max iterations, factor dominance,
    // escaped flag. Dominance is -1 on a first-factor sheet and +1 on a
    // second-factor sheet, making the product structure visible in color.
    const evaluate = (point: any): any => {
      const source = vec4(point);
      const first = evaluateFactor(
        vec2(source.x.sub(source.y), source.w.add(source.z)),
        parameterUniform.xy
      );
      const second = evaluateFactor(
        vec2(source.x.add(source.y), source.w.sub(source.z)),
        parameterUniform.zw
      );
      const firstOutside = select(first.w.greaterThan(0.5), first.x, 0);
      const secondOutside = select(second.w.greaterThan(0.5), second.x, 0);
      const distance = vec2(firstOutside, secondOutside).length().mul(0.7071067811865476);
      const distanceSum = firstOutside.add(secondOutside);
      const dominance = secondOutside
        .sub(firstOutside)
        .div(max(distanceSum, 1e-9));
      return vec4(
        distance,
        max(first.y, second.y),
        dominance,
        select(first.w.greaterThan(0.5).or(second.w.greaterThan(0.5)), 1, 0)
      );
    };

    const localCamera = varying(vec3(modelWorldMatrixInverse.mul(vec4(cameraPosition, 1))));
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

        const factorMix = smoothstep(-0.78, 0.78, hitRecord.z);
        const factorPalette = mix(
          vec3(0.08, 0.78, 0.92),
          vec3(0.98, 0.18, 0.64),
          factorMix
        );
        const dwell = smoothstep(0.08, 0.92, hitRecord.y.div(maximumIterations));
        const palette = mix(factorPalette.mul(0.58), factorPalette.add(vec3(0.24, 0.12, 0.2)), dwell);
        const lightDirection = vec3(0.52, 0.74, 0.42).normalize();
        const diffuse = max(dot(gradient, lightDirection), 0);
        const viewFacing = max(dot(gradient, rayDirection.negate()), 0);
        const rim = pow(float(1).sub(viewFacing), 2.2);
        const traceOcclusion = float(1).sub(stepCount.div(this.maxSteps).mul(0.4));
        const seam = float(1).sub(hitRecord.z.abs()).mul(0.22);
        const lit = palette
          .mul(float(0.16).add(diffuse.mul(0.84)))
          .mul(traceOcclusion)
          .add(vec3(0.28, 0.18, 0.48).mul(rim))
          .add(vec3(0.2, 0.08, 0.24).mul(seam));
        output.assign(vec4(lit, 1));
      });
      return output;
    });

    const material = new NodeMaterial();
    material.fragmentNode = fragment();
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

  /** Refresh affine-slice uniforms after changing the live slice. */
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
