import { Vector4, type Node } from 'three/webgpu';
import {
  Break,
  If,
  Loop,
  dot,
  float,
  max,
  min,
  select,
  uniform,
  vec2,
  vec4
} from 'three/tsl';
import {
  BicomplexJuliaField,
  type BicomplexJuliaEvaluation
} from '@holotope/core';
import type { ImplicitFieldNode4 } from './implicit-field-node4.js';

/** TSL realization of the bicomplex product-distance record. */
export class BicomplexJuliaNode4
  implements ImplicitFieldNode4<BicomplexJuliaEvaluation, BicomplexJuliaField>
{
  readonly field: BicomplexJuliaField;
  readonly iterationLimit: number;
  readonly recommendedStepSafety: number;

  private readonly parameterUniform;
  private readonly escapeSquared;

  constructor(field: BicomplexJuliaField) {
    this.field = field;
    this.iterationLimit = field.options.maxIterations;
    this.recommendedStepSafety = field.distanceEstimator.recommendedStepSafety;
    const first = field.factorParameters.first;
    const second = field.factorParameters.second;
    this.parameterUniform = uniform(new Vector4(first[0], first[1], second[0], second[1]));
    this.escapeSquared = float(field.options.escapeRadius * field.options.escapeRadius);
  }

  private evaluateFactor(source: Node<'vec2'>, parameter: Node<'vec2'>): Node<'vec4'> {
    const z = vec2(source).toVar();
    const radiusSquared = dot(z, z).toVar();
    const derivativeBound = float(1).toVar();
    const orbitTrap = radiusSquared.sqrt().toVar();
    const iterations = float(0).toVar();

    Loop(this.iterationLimit, () => {
      If(radiusSquared.greaterThan(this.escapeSquared), () => {
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

    const escaped = radiusSquared.greaterThan(this.escapeSquared);
    const magnitude = radiusSquared.sqrt();
    const distance = float(0).toVar();
    If(escaped.and(derivativeBound.greaterThan(0)), () => {
      distance.assign(max(0, magnitude.mul(magnitude.log()).mul(0.5).div(derivativeBound)));
    });
    return vec4(distance, iterations, orbitTrap, select(escaped, 1, 0));
  }

  evaluate(point: Node<'vec4'>): Node<'vec4'> {
    const source = vec4(point);
    const first = this.evaluateFactor(
      vec2(source.x.sub(source.y), source.w.add(source.z)),
      this.parameterUniform.xy
    );
    const second = this.evaluateFactor(
      vec2(source.x.add(source.y), source.w.sub(source.z)),
      this.parameterUniform.zw
    );
    const firstOutside = select(first.w.greaterThan(0.5), first.x, 0);
    const secondOutside = select(second.w.greaterThan(0.5), second.x, 0);
    const distance = vec2(firstOutside, secondOutside).length().mul(0.7071067811865476);
    const distanceSum = firstOutside.add(secondOutside);
    const dominance = secondOutside.sub(firstOutside).div(max(distanceSum, 1e-9));
    return vec4(
      distance,
      max(first.y, second.y),
      dominance,
      select(first.w.greaterThan(0.5).or(second.w.greaterThan(0.5)), 1, 0)
    );
  }
}
