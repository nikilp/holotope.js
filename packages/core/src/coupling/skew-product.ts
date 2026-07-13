import { BivectorN } from '../math/bivector.js';
import { Rotor4 } from '../math/rotor4.js';

export type BaseMap<Base> = (state: Base) => Base;
export type RotorCocycle<Base> = (state: Base) => BivectorN;

export interface SkewProductFlowOptions<Base> {
  readonly id?: string;
  readonly baseMap: BaseMap<Base>;
  readonly cocycle: RotorCocycle<Base>;
  /** Scalar epsilon in `exp(epsilon B(x))`. Default 1. */
  readonly coupling?: number;
}

export interface SkewProductState<Base> {
  readonly base: Base;
  readonly fiber: Rotor4;
  readonly step: number;
}

/**
 * A discrete compact-group extension `(x,R) -> (f(x), exp(epsilon B(x)) R)`.
 *
 * The base map owns its state representation. The fiber is always a `Rotor4`,
 * so each increment is an SO(4) isometry and pair-quaternion normalization is
 * the complete drift repair after composition.
 */
export class SkewProductFlow<Base> {
  readonly id: string;
  readonly baseMap: BaseMap<Base>;
  readonly cocycle: RotorCocycle<Base>;
  readonly coupling: number;

  constructor({ id = 'skew-product-flow', baseMap, cocycle, coupling = 1 }: SkewProductFlowOptions<Base>) {
    if (!Number.isFinite(coupling)) {
      throw new Error(`SkewProductFlow: coupling must be finite, got ${coupling}`);
    }
    this.id = id;
    this.baseMap = baseMap;
    this.cocycle = cocycle;
    this.coupling = coupling;
  }

  initial(base: Base, fiber: Rotor4 = Rotor4.identity()): SkewProductState<Base> {
    return { base, fiber: fiber.clone().normalize(), step: 0 };
  }

  /** The state-dependent fiber increment `exp(epsilon B(x))`. */
  increment(base: Base): Rotor4 {
    const bivector = this.cocycle(base);
    if (bivector.n !== 4) {
      throw new Error(`SkewProductFlow: cocycle must return a 4D bivector, got n=${bivector.n}`);
    }
    if ([...bivector.coeffs].some((coefficient) => !Number.isFinite(coefficient))) {
      throw new Error('SkewProductFlow: cocycle returned a non-finite coefficient');
    }
    return Rotor4.fromBivector(bivector.clone().scale(this.coupling));
  }

  step(state: SkewProductState<Base>): SkewProductState<Base> {
    if (!Number.isSafeInteger(state.step) || state.step < 0) {
      throw new Error(`SkewProductFlow: invalid step ${state.step}`);
    }
    const increment = this.increment(state.base);
    return {
      base: this.baseMap(state.base),
      fiber: increment.multiply(state.fiber).normalize(),
      step: state.step + 1
    };
  }

  iterate(state: SkewProductState<Base>, count: number): SkewProductState<Base> {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`SkewProductFlow.iterate: count must be a non-negative safe integer, got ${count}`);
    }
    let current = state;
    for (let index = 0; index < count; index++) current = this.step(current);
    return current;
  }
}

/** Cover-independent Frobenius distance from a rotor's SO(4) matrix to identity. */
export function rotorIdentityResidual(rotor: Rotor4): number {
  const matrix = rotor.toMatrix().data;
  let squared = 0;
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      const difference = matrix[row * 4 + column]! - (row === column ? 1 : 0);
      squared += difference * difference;
    }
  }
  return Math.sqrt(squared);
}

export interface PeriodicOrbitHolonomyOptions<Base> {
  readonly period: number;
  readonly baseDistance: (left: Base, right: Base) => number;
  /** Maximum closure error accepted for the supplied periodic orbit. Default 1e-12. */
  readonly closureTolerance?: number;
  /** SO(4) identity residual below which holonomy counts as identity. Default 1e-12. */
  readonly identityTolerance?: number;
}

export interface PeriodicOrbitHolonomy<Base> {
  readonly flow: string;
  readonly period: number;
  readonly orbit: readonly Base[];
  readonly returnedBase: Base;
  readonly closureError: number;
  readonly closureTolerance: number;
  readonly closed: boolean;
  readonly holonomy: Rotor4;
  readonly identityResidual: number;
  readonly identityTolerance: number;
  readonly nontrivial: boolean;
  /** A finite obstruction to the cocycle being a coboundary on this base system. */
  readonly essentialWitness: boolean;
}

/** Ordered fiber product around a claimed periodic base orbit. */
export function periodicOrbitHolonomy<Base>(
  flow: SkewProductFlow<Base>,
  initialBase: Base,
  {
    period,
    baseDistance,
    closureTolerance = 1e-12,
    identityTolerance = 1e-12
  }: PeriodicOrbitHolonomyOptions<Base>
): PeriodicOrbitHolonomy<Base> {
  if (!Number.isSafeInteger(period) || period < 1) {
    throw new Error(`periodicOrbitHolonomy: period must be a positive safe integer, got ${period}`);
  }
  if (!Number.isFinite(closureTolerance) || closureTolerance < 0) {
    throw new Error('periodicOrbitHolonomy: closureTolerance must be finite and non-negative');
  }
  if (!Number.isFinite(identityTolerance) || identityTolerance < 0) {
    throw new Error('periodicOrbitHolonomy: identityTolerance must be finite and non-negative');
  }
  const orbit: Base[] = [];
  let state = flow.initial(initialBase);
  for (let index = 0; index < period; index++) {
    orbit.push(state.base);
    state = flow.step(state);
  }
  const closureError = baseDistance(initialBase, state.base);
  if (!Number.isFinite(closureError) || closureError < 0) {
    throw new Error('periodicOrbitHolonomy: baseDistance must return a finite non-negative value');
  }
  const identityResidual = rotorIdentityResidual(state.fiber);
  const closed = closureError <= closureTolerance;
  const nontrivial = identityResidual > identityTolerance;
  return {
    flow: flow.id,
    period,
    orbit,
    returnedBase: state.base,
    closureError,
    closureTolerance,
    closed,
    holonomy: state.fiber,
    identityResidual,
    identityTolerance,
    nontrivial,
    essentialWitness: closed && nontrivial
  };
}
