import { CellComplex, type CellGroup } from '@holotope/core';
import {
  SimplexConstitutiveFamilyN,
  compileSimplexConstitutiveFamilyN,
  type SimplexConstitutiveFamilyElementContextN,
  type SimplexConstitutiveFamilyElementEvaluationN,
  type SimplexConstitutiveFamilyElementN,
  type SimplexConstitutiveFamilyEvaluationN,
  type SimplexConstitutiveFamilyHessianVectorEvaluationN,
  type SimplexConstitutiveFamilyMaterialN
} from './simplex-constitutive-family.js';
import { simplexStVenantKirchhoffLawN } from './simplex-constitutive-laws.js';
import {
  type SimplexStVenantKirchhoffEvaluationN,
  type SimplexStVenantKirchhoffMaterialN
} from './simplex-stvk-material.js';
import {
  type XpbdConservativeHessianVectorProviderN,
  type XpbdParticleDirectionQueryN
} from './xpbd-incremental-potential-analytic-curvature.js';
import {
  XpbdParticleN,
  XpbdWorldN,
  type XpbdConservativeForceProviderN,
  type XpbdParticlePositionQueryN
} from './xpbd-world.js';

export interface SimplexStVenantKirchhoffFamilyElementContextN
  extends SimplexConstitutiveFamilyElementContextN {}

export type SimplexStVenantKirchhoffFamilyMaterialN =
  SimplexConstitutiveFamilyMaterialN<SimplexStVenantKirchhoffMaterialN>;

export interface CompileSimplexStVenantKirchhoffFamilyNOptions {
  readonly id: string;
  readonly source: CellComplex;
  readonly simplexGroup: CellGroup;
  /** One live particle per source vertex, in source-vertex order. */
  readonly particles: readonly XpbdParticleN[];
  readonly material: SimplexStVenantKirchhoffFamilyMaterialN;
}

export interface SimplexStVenantKirchhoffFamilyElementN
  extends SimplexConstitutiveFamilyElementN<SimplexStVenantKirchhoffMaterialN> {}

export interface SimplexStVenantKirchhoffFamilyElementEvaluationN
  extends SimplexConstitutiveFamilyElementEvaluationN<
    SimplexStVenantKirchhoffMaterialN,
    SimplexStVenantKirchhoffEvaluationN
  > {}

export interface SimplexStVenantKirchhoffFamilyEvaluationN
  extends SimplexConstitutiveFamilyEvaluationN<
    SimplexStVenantKirchhoffMaterialN,
    SimplexStVenantKirchhoffEvaluationN
  > {}

/** Exact assembled StVK potential curvature in family particle order. */
export interface SimplexStVenantKirchhoffFamilyHessianVectorEvaluationN
  extends SimplexConstitutiveFamilyHessianVectorEvaluationN<
    SimplexStVenantKirchhoffMaterialN,
    SimplexStVenantKirchhoffEvaluationN
  > {
  /** Stable StVK law identity retained by the compatibility wrapper. */
  readonly lawId: string;
}

/** Compatibility wrapper for the source-identified StVK constitutive family. */
export class SimplexStVenantKirchhoffFamilyN
implements
  XpbdConservativeForceProviderN,
  XpbdConservativeHessianVectorProviderN {
  readonly constitutiveFamily: SimplexConstitutiveFamilyN<
    SimplexStVenantKirchhoffMaterialN,
    SimplexStVenantKirchhoffEvaluationN
  >;
  readonly id: string;
  readonly dimension: number;
  readonly source: CellComplex;
  readonly sourceSimplexGroup: CellGroup;
  readonly particles: readonly XpbdParticleN[];
  readonly elements: readonly SimplexStVenantKirchhoffFamilyElementN[];
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    family: SimplexConstitutiveFamilyN<
      SimplexStVenantKirchhoffMaterialN,
      SimplexStVenantKirchhoffEvaluationN
    >
  ) {
    this.constitutiveFamily = family;
    this.id = family.id;
    this.dimension = family.dimension;
    this.source = family.source;
    this.sourceSimplexGroup = family.sourceSimplexGroup;
    this.particles = family.particles;
    this.elements = family.elements;
  }

  static compile(
    options: CompileSimplexStVenantKirchhoffFamilyNOptions
  ): SimplexStVenantKirchhoffFamilyN {
    return new SimplexStVenantKirchhoffFamilyN(
      compileSimplexConstitutiveFamilyN({
        ...options,
        law: simplexStVenantKirchhoffLawN
      })
    );
  }

  evaluate(): SimplexStVenantKirchhoffFamilyEvaluationN {
    return this.constitutiveFamily.evaluate();
  }

  evaluateAt(
    positionOf: XpbdParticlePositionQueryN
  ): SimplexStVenantKirchhoffFamilyEvaluationN {
    return this.constitutiveFamily.evaluateAt(positionOf);
  }

  /** Evaluates exact StVK potential curvature without mutating live particles. */
  evaluatePotentialHessianVectorAt(
    positionOf: XpbdParticlePositionQueryN,
    directionOf: XpbdParticleDirectionQueryN
  ): SimplexStVenantKirchhoffFamilyHessianVectorEvaluationN {
    const evaluate =
      this.constitutiveFamily.evaluatePotentialHessianVectorAt;
    if (evaluate === undefined) {
      throw new Error(
        'SimplexStVenantKirchhoffFamilyN: built-in law lost exact curvature'
      );
    }
    return evaluate(positionOf, directionOf);
  }

  /** Registers this compatibility provider; particles must already belong to the world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error(
        'SimplexStVenantKirchhoffFamilyN.addToWorld: expected an XpbdWorldN'
      );
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `SimplexStVenantKirchhoffFamilyN.addToWorld: family is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(
        'SimplexStVenantKirchhoffFamilyN.addToWorld: family is already attached to another world'
      );
    }
    this.constitutiveFamily.assertCurrentLineage('addToWorld');
    world.addForceProvider(this);
    this.attachedWorld = world;
    return world;
  }
}

/** Compiles one explicitly selected source simplex family into StVK elements. */
export function compileSimplexStVenantKirchhoffFamilyN(
  options: CompileSimplexStVenantKirchhoffFamilyNOptions
): SimplexStVenantKirchhoffFamilyN {
  return SimplexStVenantKirchhoffFamilyN.compile(options);
}
