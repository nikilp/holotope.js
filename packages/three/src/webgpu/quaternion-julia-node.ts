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
  vec4
} from 'three/tsl';
import {
  QuaternionJuliaField,
  type QuaternionJuliaEvaluation
} from '@holotope/core';
import type { ImplicitFieldNode4 } from './implicit-field-node4.js';

/** TSL realization of the packed quaternion Julia field record. */
export class QuaternionJuliaNode4
  implements ImplicitFieldNode4<QuaternionJuliaEvaluation, QuaternionJuliaField>
{
  readonly field: QuaternionJuliaField;
  readonly iterationLimit: number;
  readonly recommendedStepSafety: number;

  private readonly parameterUniform;
  private readonly escapeSquared;

  constructor(field: QuaternionJuliaField) {
    this.field = field;
    this.iterationLimit = field.options.maxIterations;
    this.recommendedStepSafety = field.distanceEstimator.recommendedStepSafety;
    const parameter = field.parameter;
    this.parameterUniform = uniform(
      new Vector4(parameter[0], parameter[1], parameter[2], parameter[3])
    );
    this.escapeSquared = float(field.options.escapeRadius * field.options.escapeRadius);
  }

  evaluate(point: Node<'vec4'>): Node<'vec4'> {
    const q = vec4(point).toVar();
    const radiusSquared = dot(q, q).toVar();
    const derivativeBound = float(1).toVar();
    const orbitTrap = radiusSquared.sqrt().toVar();
    const iterations = float(0).toVar();

    Loop(this.iterationLimit, () => {
      If(radiusSquared.greaterThan(this.escapeSquared), () => {
        Break();
      });
      const radius = radiusSquared.sqrt();
      derivativeBound.mulAssign(radius.mul(2));
      q.assign(
        vec4(
          q.w.mul(q.x).mul(2).add(this.parameterUniform.x),
          q.w.mul(q.y).mul(2),
          q.w.mul(q.z).mul(2),
          q.w.mul(q.w)
            .sub(q.x.mul(q.x))
            .sub(q.y.mul(q.y))
            .sub(q.z.mul(q.z))
            .add(this.parameterUniform.w)
        )
      );
      radiusSquared.assign(dot(q, q));
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
}
