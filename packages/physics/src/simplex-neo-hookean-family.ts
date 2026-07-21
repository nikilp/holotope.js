import { CellComplex, type CellGroup } from '@holotope/core';
import {
  SimplexConstitutiveFamilyN,
  compileSimplexConstitutiveFamilyN,
  type SimplexConstitutiveFamilyElementContextN,
  type SimplexConstitutiveFamilyElementEvaluationN,
  type SimplexConstitutiveFamilyElementN,
  type SimplexConstitutiveFamilyEvaluationN,
  type SimplexConstitutiveFamilyMaterialN
} from './simplex-constitutive-family.js';
import { simplexCompressibleNeoHookeanLawN } from './simplex-constitutive-laws.js';
import {
  type SimplexCompressibleNeoHookeanEvaluationN,
  type SimplexCompressibleNeoHookeanMaterialN
} from './simplex-neo-hookean-material.js';
import {
  XpbdParticleN,
  XpbdWorldN,
  type XpbdForceProviderN
} from './xpbd-world.js';

export interface SimplexCompressibleNeoHookeanFamilyElementContextN
  extends SimplexConstitutiveFamilyElementContextN {}

export type SimplexCompressibleNeoHookeanFamilyMaterialN =
  SimplexConstitutiveFamilyMaterialN<SimplexCompressibleNeoHookeanMaterialN>;

export interface CompileSimplexCompressibleNeoHookeanFamilyNOptions {
  readonly id: string;
  readonly source: CellComplex;
  readonly simplexGroup: CellGroup;
  /** One live particle per source vertex, in source-vertex order. */
  readonly particles: readonly XpbdParticleN[];
  readonly material: SimplexCompressibleNeoHookeanFamilyMaterialN;
}

export interface SimplexCompressibleNeoHookeanFamilyElementN
  extends SimplexConstitutiveFamilyElementN<
    SimplexCompressibleNeoHookeanMaterialN
  > {}

export interface SimplexCompressibleNeoHookeanFamilyElementEvaluationN
  extends SimplexConstitutiveFamilyElementEvaluationN<
    SimplexCompressibleNeoHookeanMaterialN,
    SimplexCompressibleNeoHookeanEvaluationN
  > {}

export interface SimplexCompressibleNeoHookeanFamilyEvaluationN
  extends SimplexConstitutiveFamilyEvaluationN<
    SimplexCompressibleNeoHookeanMaterialN,
    SimplexCompressibleNeoHookeanEvaluationN
  > {}

/** Source-identified compressible Neo-Hookean family over shared RN particles. */
export class SimplexCompressibleNeoHookeanFamilyN implements XpbdForceProviderN {
  readonly constitutiveFamily: SimplexConstitutiveFamilyN<
    SimplexCompressibleNeoHookeanMaterialN,
    SimplexCompressibleNeoHookeanEvaluationN
  >;
  readonly id: string;
  readonly dimension: number;
  readonly source: CellComplex;
  readonly sourceSimplexGroup: CellGroup;
  readonly particles: readonly XpbdParticleN[];
  readonly elements: readonly SimplexCompressibleNeoHookeanFamilyElementN[];
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    family: SimplexConstitutiveFamilyN<
      SimplexCompressibleNeoHookeanMaterialN,
      SimplexCompressibleNeoHookeanEvaluationN
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
    options: CompileSimplexCompressibleNeoHookeanFamilyNOptions
  ): SimplexCompressibleNeoHookeanFamilyN {
    return new SimplexCompressibleNeoHookeanFamilyN(
      compileSimplexConstitutiveFamilyN({
        ...options,
        law: simplexCompressibleNeoHookeanLawN
      })
    );
  }

  evaluate(): SimplexCompressibleNeoHookeanFamilyEvaluationN {
    return this.constitutiveFamily.evaluate();
  }

  /** Registers this provider; particles must already belong to the world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error(
        'SimplexCompressibleNeoHookeanFamilyN.addToWorld: expected an XpbdWorldN'
      );
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `SimplexCompressibleNeoHookeanFamilyN.addToWorld: family is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(
        'SimplexCompressibleNeoHookeanFamilyN.addToWorld: family is already attached to another world'
      );
    }
    this.constitutiveFamily.assertCurrentLineage('addToWorld');
    world.addForceProvider(this);
    this.attachedWorld = world;
    return world;
  }
}

export function compileSimplexCompressibleNeoHookeanFamilyN(
  options: CompileSimplexCompressibleNeoHookeanFamilyNOptions
): SimplexCompressibleNeoHookeanFamilyN {
  return SimplexCompressibleNeoHookeanFamilyN.compile(options);
}
