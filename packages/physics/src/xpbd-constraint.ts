import { VecN } from '@holotope/core';
import {
  evaluateDistanceCoordinateN,
  type DistanceCoordinateEvaluationN
} from './distance-coordinate-n.js';

/** One point generalized coordinate consumed by the XPBD reference kernel. */
export interface XpbdPointN {
  /** Mutable Float64 position. The solver updates this vector in place. */
  readonly position: VecN;
  /** Zero fixes the point; positive values are inverse mass. */
  readonly inverseMass: number;
}

/** One scalar relation C(x) and its gradients in `points` order. */
export interface XpbdScalarConstraintEvaluationN {
  readonly value: number;
  readonly gradients: readonly VecN[];
}

export type XpbdConstraintRelationN = 'equality' | 'greater-than-or-equal';

/** Dimension-explicit scalar relation with physical compliance. */
export interface XpbdScalarConstraintN {
  readonly id: string;
  readonly dimension: number;
  readonly points: readonly XpbdPointN[];
  /** Default `equality`; inequalities declare `C(x) >= 0`. */
  readonly relation?: XpbdConstraintRelationN;
  /** Inverse stiffness alpha. Zero is a hard positional relation. */
  readonly compliance: number;
  /** Must observe current point positions without mutating them. */
  evaluate(): XpbdScalarConstraintEvaluationN;
}

export type XpbdConstraintStatusN =
  | 'solved'
  | 'inactive'
  | 'no-dynamic-response';

/** Final evidence for one constraint after one XPBD time-step solve. */
export interface XpbdConstraintResultN {
  readonly id: string;
  readonly status: XpbdConstraintStatusN;
  readonly relation: XpbdConstraintRelationN;
  /** True exactly when a projected inequality has positive multiplier. */
  readonly active: boolean;
  readonly initialValue: number;
  readonly finalValue: number;
  /** Total position-level multiplier accumulated during this solve. */
  readonly totalMultiplier: number;
  /** `totalMultiplier / deltaTime^2`, signed along the declared gradients. */
  readonly signedForce: number;
  /** `C(x) + (compliance / deltaTime^2) * totalMultiplier`. */
  readonly compliantResidual: number;
  /** Equality residual or projected coordinate-unit KKT violation. */
  readonly projectedKktResidual: number;
  /** Final `sum_i inverseMass_i * |gradient_i|^2`. */
  readonly weightedInverseMass: number;
}

export interface XpbdSolveResultN {
  readonly dimension: number;
  readonly deltaTime: number;
  readonly iterations: number;
  readonly constraints: readonly XpbdConstraintResultN[];
  readonly maxAbsConstraintValue: number;
  readonly maxAbsCompliantResidual: number;
  readonly maxAbsProjectedKktResidual: number;
  readonly noDynamicResponseIds: readonly string[];
  readonly inactiveInequalityIds: readonly string[];
}

export interface XpbdConstraintSolverNOptions {
  readonly dimension: number;
  /** Sequential Gauss-Seidel visits per constraint. Default 8. */
  readonly iterations?: number;
  /** Weighted-gradient response at or below this is immovable. Default 1e-15. */
  readonly responseEpsilon?: number;
}

interface ConstraintWorkN {
  readonly constraint: XpbdScalarConstraintN;
  readonly relation: XpbdConstraintRelationN;
  readonly initialValue: number;
  totalMultiplier: number;
  hadDynamicResponse: boolean;
}

/**
 * Auditable Float64 Gauss-Seidel implementation of the scalar XPBD update.
 *
 * The total multiplier starts at zero for every `solve()` call: one call is
 * one XPBD time-step projection. Point positions are restored atomically if a
 * malformed custom constraint throws during any visit.
 */
export class XpbdConstraintSolverN {
  readonly dimension: number;
  readonly iterations: number;
  readonly responseEpsilon: number;

  constructor(options: XpbdConstraintSolverNOptions) {
    if (!Number.isSafeInteger(options.dimension) || options.dimension < 1) {
      throw new Error('XpbdConstraintSolverN: dimension must be a positive integer');
    }
    const iterations = options.iterations ?? 8;
    if (!Number.isSafeInteger(iterations) || iterations < 1) {
      throw new Error('XpbdConstraintSolverN: iterations must be a positive integer');
    }
    const responseEpsilon = options.responseEpsilon ?? 1e-15;
    if (!Number.isFinite(responseEpsilon) || responseEpsilon <= 0) {
      throw new Error('XpbdConstraintSolverN: responseEpsilon must be finite and positive');
    }
    this.dimension = options.dimension;
    this.iterations = iterations;
    this.responseEpsilon = responseEpsilon;
  }

  solve(
    constraints: readonly XpbdScalarConstraintN[],
    deltaTime: number
  ): XpbdSolveResultN {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      throw new Error('XpbdConstraintSolverN.solve: deltaTime must be finite and positive');
    }

    const snapshots = new Map<XpbdPointN, Float64Array>();
    try {
      const work = this.preflight(constraints, snapshots);
      const inverseDeltaTimeSq = 1 / (deltaTime * deltaTime);

      for (let iteration = 0; iteration < this.iterations; iteration++) {
        for (const item of work) {
          const evaluated = evaluateConstraint(
            item.constraint,
            this.dimension,
            'XpbdConstraintSolverN.solve'
          );
          const weightedInverseMass = constraintResponse(
            item.constraint.points,
            evaluated.gradients
          );
          if (weightedInverseMass <= this.responseEpsilon) continue;

          item.hadDynamicResponse = true;
          const scaledCompliance = item.constraint.compliance * inverseDeltaTimeSq;
          const denominator = weightedInverseMass + scaledCompliance;
          if (!Number.isFinite(denominator) || denominator <= 0) {
            throw new Error(
              `XpbdConstraintSolverN.solve: constraint "${item.constraint.id}" has invalid response`
            );
          }
          const trialDeltaMultiplier = (
            -evaluated.value - scaledCompliance * item.totalMultiplier
          ) / denominator;
          if (!Number.isFinite(trialDeltaMultiplier)) {
            throw new Error(
              `XpbdConstraintSolverN.solve: constraint "${item.constraint.id}" produced a non-finite multiplier`
            );
          }
          const nextMultiplier = item.relation === 'equality'
            ? item.totalMultiplier + trialDeltaMultiplier
            : Math.max(0, item.totalMultiplier + trialDeltaMultiplier);
          const deltaMultiplier = nextMultiplier - item.totalMultiplier;
          item.totalMultiplier = nextMultiplier;
          applyPositionCorrections(
            item.constraint.points,
            evaluated.gradients,
            deltaMultiplier
          );
        }
      }

      const results = work.map((item): XpbdConstraintResultN => {
        const evaluated = evaluateConstraint(
          item.constraint,
          this.dimension,
          'XpbdConstraintSolverN.solve'
        );
        const weightedInverseMass = constraintResponse(
          item.constraint.points,
          evaluated.gradients
        );
        const scaledCompliance = item.constraint.compliance * inverseDeltaTimeSq;
        const compliantResidual = evaluated.value +
          scaledCompliance * item.totalMultiplier;
        const active = item.relation === 'greater-than-or-equal' &&
          item.totalMultiplier > 0;
        const projectedKktResidual = item.relation === 'equality' || active
          ? compliantResidual
          : Math.min(compliantResidual, 0);
        const status: XpbdConstraintStatusN =
          item.relation === 'greater-than-or-equal' &&
          !active && compliantResidual >= 0
            ? 'inactive'
            : item.hadDynamicResponse
              ? 'solved'
              : 'no-dynamic-response';
        return Object.freeze({
          id: item.constraint.id,
          status,
          relation: item.relation,
          active,
          initialValue: item.initialValue,
          finalValue: evaluated.value,
          totalMultiplier: item.totalMultiplier,
          signedForce: item.totalMultiplier * inverseDeltaTimeSq,
          compliantResidual,
          projectedKktResidual,
          weightedInverseMass
        });
      });
      return Object.freeze({
        dimension: this.dimension,
        deltaTime,
        iterations: this.iterations,
        constraints: Object.freeze(results),
        maxAbsConstraintValue: maximumAbsolute(results.map((result) => result.finalValue)),
        maxAbsCompliantResidual: maximumAbsolute(
          results.map((result) => result.compliantResidual)
        ),
        maxAbsProjectedKktResidual: maximumAbsolute(
          results.map((result) => result.projectedKktResidual)
        ),
        noDynamicResponseIds: Object.freeze(
          results
            .filter((result) => result.status === 'no-dynamic-response')
            .map((result) => result.id)
        ),
        inactiveInequalityIds: Object.freeze(
          results
            .filter((result) => result.status === 'inactive')
            .map((result) => result.id)
        )
      });
    } catch (error) {
      for (const [point, position] of snapshots) point.position.data.set(position);
      throw error;
    }
  }

  private preflight(
    constraints: readonly XpbdScalarConstraintN[],
    snapshots: Map<XpbdPointN, Float64Array>
  ): ConstraintWorkN[] {
    const ids = new Set<string>();
    const work: ConstraintWorkN[] = [];
    for (const constraint of constraints) {
      validateConstraintDefinition(constraint, this.dimension, ids);
      for (const point of constraint.points) {
        if (!snapshots.has(point)) snapshots.set(point, point.position.data.slice());
      }
      const evaluated = evaluateConstraint(
        constraint,
        this.dimension,
        'XpbdConstraintSolverN.solve'
      );
      work.push({
        constraint,
        relation: constraintRelation(constraint),
        initialValue: evaluated.value,
        totalMultiplier: 0,
        hadDynamicResponse: false
      });
    }
    return work;
  }
}

export interface XpbdDistanceConstraintNOptions {
  readonly id: string;
  readonly pointA: XpbdPointN;
  readonly pointB: XpbdPointN;
  readonly restLength: number;
  readonly compliance?: number;
  /** Coherent distance gradient used only when the points coincide. */
  readonly directionHint?: VecN | ArrayLike<number>;
}

export interface XpbdDistanceConstraintEvaluationN
  extends XpbdScalarConstraintEvaluationN,
    DistanceCoordinateEvaluationN {
  readonly error: number;
}

/** Exact RN distance equality consumed by the generic XPBD kernel. */
export class XpbdDistanceConstraintN implements XpbdScalarConstraintN {
  readonly id: string;
  readonly dimension: number;
  readonly points: readonly [XpbdPointN, XpbdPointN];
  readonly compliance: number;
  readonly restLength: number;
  private directionHint: VecN | undefined;

  constructor(options: XpbdDistanceConstraintNOptions) {
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error('XpbdDistanceConstraintN: id must be a non-empty string');
    }
    if (options.pointA === options.pointB) {
      throw new Error('XpbdDistanceConstraintN: points must be distinct');
    }
    assertPoint(options.pointA, undefined, 'XpbdDistanceConstraintN: pointA');
    assertPoint(
      options.pointB,
      options.pointA.position.dim,
      'XpbdDistanceConstraintN: pointB'
    );
    if (!Number.isFinite(options.restLength) || options.restLength <= 0) {
      throw new Error('XpbdDistanceConstraintN: restLength must be finite and positive');
    }
    const compliance = options.compliance ?? 0;
    if (!Number.isFinite(compliance) || compliance < 0) {
      throw new Error('XpbdDistanceConstraintN: compliance must be finite and non-negative');
    }
    const directionHint = options.directionHint === undefined
      ? undefined
      : vectorN(options.directionHint, options.pointA.position.dim, 'directionHint');
    if (directionHint !== undefined && !(directionHint.length() > 1e-15)) {
      throw new Error('XpbdDistanceConstraintN: directionHint must be nonzero');
    }

    this.id = options.id;
    this.dimension = options.pointA.position.dim;
    this.points = Object.freeze([options.pointA, options.pointB]);
    this.compliance = compliance;
    this.restLength = options.restLength;
    this.directionHint = directionHint?.normalize();
  }

  evaluate(): XpbdDistanceConstraintEvaluationN {
    const coordinate = evaluateDistanceCoordinateN(
      this.points[0].position,
      this.points[1].position,
      this.directionHint
    );
    this.directionHint = coordinate.direction.clone();
    const opposite = coordinate.direction.clone().multiplyScalar(-1);
    const error = coordinate.distance - this.restLength;
    return {
      ...coordinate,
      value: error,
      error,
      gradients: Object.freeze([coordinate.direction, opposite])
    };
  }
}

function validateConstraintDefinition(
  constraint: XpbdScalarConstraintN,
  dimension: number,
  ids: Set<string>
): void {
  if (typeof constraint.id !== 'string' || constraint.id.trim().length === 0) {
    throw new Error('XpbdConstraintSolverN.solve: constraint ids must be non-empty strings');
  }
  if (ids.has(constraint.id)) {
    throw new Error(`XpbdConstraintSolverN.solve: duplicate constraint id "${constraint.id}"`);
  }
  ids.add(constraint.id);
  constraintRelation(constraint);
  if (constraint.dimension !== dimension) {
    throw new Error(
      `XpbdConstraintSolverN.solve: constraint "${constraint.id}" is R${constraint.dimension}, solver is R${dimension}`
    );
  }
  if (!Number.isFinite(constraint.compliance) || constraint.compliance < 0) {
    throw new Error(
      `XpbdConstraintSolverN.solve: constraint "${constraint.id}" compliance must be finite and non-negative`
    );
  }
  if (!Array.isArray(constraint.points) || constraint.points.length === 0) {
    throw new Error(
      `XpbdConstraintSolverN.solve: constraint "${constraint.id}" must contain points`
    );
  }
  const seen = new Set<XpbdPointN>();
  for (const point of constraint.points) {
    if (seen.has(point)) {
      throw new Error(
        `XpbdConstraintSolverN.solve: constraint "${constraint.id}" repeats a point identity`
      );
    }
    seen.add(point);
    assertPoint(point, dimension, `XpbdConstraintSolverN.solve: constraint "${constraint.id}"`);
  }
}

function constraintRelation(
  constraint: XpbdScalarConstraintN
): XpbdConstraintRelationN {
  const relation = constraint.relation ?? 'equality';
  if (relation !== 'equality' && relation !== 'greater-than-or-equal') {
    throw new Error(
      `XpbdConstraintSolverN.solve: constraint "${constraint.id}" has invalid relation`
    );
  }
  return relation;
}

function evaluateConstraint(
  constraint: XpbdScalarConstraintN,
  dimension: number,
  caller: string
): XpbdScalarConstraintEvaluationN {
  const evaluated = constraint.evaluate();
  if (!Number.isFinite(evaluated.value)) {
    throw new Error(`${caller}: constraint "${constraint.id}" value must be finite`);
  }
  if (!Array.isArray(evaluated.gradients) || evaluated.gradients.length !== constraint.points.length) {
    throw new Error(
      `${caller}: constraint "${constraint.id}" must return one gradient per point`
    );
  }
  for (const gradient of evaluated.gradients) {
    assertFiniteVector(
      gradient,
      dimension,
      `${caller}: constraint "${constraint.id}" gradient`
    );
  }
  return evaluated;
}

function constraintResponse(
  points: readonly XpbdPointN[],
  gradients: readonly VecN[]
): number {
  let response = 0;
  for (let point = 0; point < points.length; point++) {
    response += points[point]!.inverseMass * gradients[point]!.lengthSq();
  }
  return response;
}

function applyPositionCorrections(
  points: readonly XpbdPointN[],
  gradients: readonly VecN[],
  deltaMultiplier: number
): void {
  for (let point = 0; point < points.length; point++) {
    const inverseMass = points[point]!.inverseMass;
    if (inverseMass === 0) continue;
    const scale = inverseMass * deltaMultiplier;
    const position = points[point]!.position.data;
    const gradient = gradients[point]!.data;
    for (let axis = 0; axis < position.length; axis++) {
      position[axis]! += scale * gradient[axis]!;
    }
  }
}

function assertPoint(point: XpbdPointN, dimension: number | undefined, caller: string): void {
  if (typeof point !== 'object' || point === null || !(point.position instanceof VecN)) {
    throw new Error(`${caller} must provide a VecN position`);
  }
  assertFiniteVector(point.position, dimension, `${caller} position`);
  if (!Number.isFinite(point.inverseMass) || point.inverseMass < 0) {
    throw new Error(`${caller} inverseMass must be finite and non-negative`);
  }
}

function assertFiniteVector(vector: VecN, dimension: number | undefined, caller: string): void {
  if (!(vector instanceof VecN)) throw new Error(`${caller} must be a VecN`);
  if (vector.dim < 1 || (dimension !== undefined && vector.dim !== dimension)) {
    throw new Error(`${caller} must have dimension ${dimension ?? 'at least one'}`);
  }
  for (const coordinate of vector.data) {
    if (!Number.isFinite(coordinate)) throw new Error(`${caller} must be finite`);
  }
}

function vectorN(value: VecN | ArrayLike<number>, dimension: number, name: string): VecN {
  const vector = value instanceof VecN ? value.clone() : new VecN(value);
  assertFiniteVector(vector, dimension, `XpbdDistanceConstraintN: ${name}`);
  return vector;
}

function maximumAbsolute(values: readonly number[]): number {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return maximum;
}
