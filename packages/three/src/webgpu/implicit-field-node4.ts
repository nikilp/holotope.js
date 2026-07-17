import type { Node } from 'three/webgpu';
import type { FieldEvaluation4, ImplicitField4 } from '@holotope/core';

/**
 * Stable GPU-side projection of a field evaluation record.
 *
 * The returned `vec4` is packed as:
 *
 * - `x`: non-negative distance usable for conservative ray advancement
 * - `y`: iteration/dwell channel
 * - `z`: field-defined feature channel for inspection or presentation
 * - `w`: outside flag (`1` outside, `0` inside)
 *
 * Family-specific records remain available from `field.evalCPU()`. This packed
 * record is deliberately smaller: it is the common transport contract needed
 * by adaptive GPU render products.
 */
export interface ImplicitFieldNode4<
  Record extends FieldEvaluation4 = FieldEvaluation4,
  Field extends ImplicitField4<Record> = ImplicitField4<Record>
> {
  /** CPU source of truth paired with this GPU realization. */
  readonly field: Field;
  /** Upper bound used to normalize the packed iteration channel. */
  readonly iterationLimit: number;
  /** Conservative default multiplier for the packed distance channel. */
  readonly recommendedStepSafety: number;
  /** Build a TSL node evaluating one point in the field's documented R4 basis. */
  evaluate(point: Node<'vec4'>): Node<'vec4'>;
}

/** Signals calculated by a ray-march product and passed to presentation code. */
export interface RaymarchedFieldStyleContext {
  readonly record: Node<'vec4'>;
  readonly normal: Node<'vec3'>;
  readonly rayDirection: Node<'vec3'>;
  readonly stepFraction: Node<'float'>;
  readonly iterationLimit: number;
}

/** Presentation policy kept separate from field evaluation and ray transport. */
export interface RaymarchedFieldStyle3D {
  shade(context: RaymarchedFieldStyleContext): Node<'vec3'>;
}
