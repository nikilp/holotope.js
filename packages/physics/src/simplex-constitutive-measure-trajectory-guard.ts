import type { VecN } from '@holotope/core';
import type { SimplexConstitutiveEvaluationN } from './simplex-constitutive.js';
import {
  SimplexConstitutiveFamilyN,
  type SimplexConstitutiveFamilyElementN
} from './simplex-constitutive-family.js';
import {
  analyzeLinearSimplexMeasureN,
  type AnalyzeLinearSimplexMeasureNOptions,
  type LinearSimplexMeasureAnalysisN
} from './simplex-measure-cast.js';
import {
  XpbdParticleN,
  XpbdWorldN,
  type XpbdStateGuardContextN,
  type XpbdStateGuardEvaluationN,
  type XpbdStateGuardN
} from './xpbd-world.js';

export interface CompileSimplexConstitutiveFamilyMeasureTrajectoryGuardNOptions<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> {
  readonly id: string;
  readonly family: SimplexConstitutiveFamilyN<TMaterial, TEvaluation>;
  /** Required intrinsic current/rest measure ratio along every linear chord. */
  readonly minimumMeasureRatio: number;
  readonly timeTolerance?: number;
  readonly maximumDepth?: number;
  readonly relativeCoefficientTolerance?: number;
}

export type SimplexConstitutiveFamilyMeasureTrajectoryGuardStatusN =
  | 'accepted'
  | 'initial-violation'
  | 'possible-violation';

export interface SimplexConstitutiveFamilyMeasureTrajectoryGuardCandidateN<
  TMaterial
> {
  readonly elementIndex: number;
  readonly element: SimplexConstitutiveFamilyElementN<TMaterial>;
  readonly analysis: LinearSimplexMeasureAnalysisN;
}

export interface SimplexConstitutiveFamilyMeasureTrajectoryGuardEvaluationN<
  TMaterial
> extends XpbdStateGuardEvaluationN {
  readonly status: SimplexConstitutiveFamilyMeasureTrajectoryGuardStatusN;
  readonly requiredMinimumMeasureRatio: number;
  readonly inspectedElementCount: number;
  /** Conservative lower bound in squared measure-ratio margin units. */
  readonly minimumMarginLowerBound: number | null;
  readonly candidate:
    SimplexConstitutiveFamilyMeasureTrajectoryGuardCandidateN<TMaterial> | null;
}

/** Continuous intrinsic rank/measure policy for one arbitrary simplex family. */
export class SimplexConstitutiveFamilyMeasureTrajectoryGuardN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> implements XpbdStateGuardN {
  readonly id: string;
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];
  readonly family: SimplexConstitutiveFamilyN<TMaterial, TEvaluation>;
  readonly minimumMeasureRatio: number;
  readonly timeTolerance: number | undefined;
  readonly maximumDepth: number | undefined;
  readonly relativeCoefficientTolerance: number | undefined;
  private readonly restPositions: readonly (readonly VecN[])[];
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    options: CompileSimplexConstitutiveFamilyMeasureTrajectoryGuardNOptions<
      TMaterial,
      TEvaluation
    >
  ) {
    this.id = options.id;
    this.family = options.family;
    this.dimension = options.family.dimension;
    this.particles = options.family.particles;
    this.minimumMeasureRatio = options.minimumMeasureRatio;
    this.timeTolerance = options.timeTolerance;
    this.maximumDepth = options.maximumDepth;
    this.relativeCoefficientTolerance = options.relativeCoefficientTolerance;
    this.restPositions = Object.freeze(options.family.elements.map(
      (_element, index) => options.family.restPositionsOfElement(index)
    ));
  }

  static compile<
    TMaterial,
    TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
  >(
    options: CompileSimplexConstitutiveFamilyMeasureTrajectoryGuardNOptions<
      TMaterial,
      TEvaluation
    >
  ): SimplexConstitutiveFamilyMeasureTrajectoryGuardN<TMaterial, TEvaluation> {
    const caller = 'compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN';
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(`${caller}: id must be a non-empty string`);
    }
    if (!(options.family instanceof SimplexConstitutiveFamilyN)) {
      throw new Error(`${caller}: family must be a SimplexConstitutiveFamilyN`);
    }
    if (!Number.isFinite(options.minimumMeasureRatio) ||
      options.minimumMeasureRatio < 0) {
      throw new Error(
        `${caller}: minimumMeasureRatio must be finite and non-negative`
      );
    }
    validateOptionalQueryOptions(options, caller);
    options.family.assertCurrentLineage('evaluate');
    return new SimplexConstitutiveFamilyMeasureTrajectoryGuardN(options);
  }

  evaluate(
    context: XpbdStateGuardContextN
  ): SimplexConstitutiveFamilyMeasureTrajectoryGuardEvaluationN<TMaterial> {
    this.family.assertCurrentLineage('evaluate');
    let minimumMarginLowerBound = Number.POSITIVE_INFINITY;
    for (let elementIndex = 0; elementIndex < this.family.elements.length; elementIndex++) {
      const element = this.family.elements[elementIndex]!;
      const startPositions = element.sourceVertexIndices.map((vertex) =>
        context.positionBeforeSubstep(this.particles[vertex]!)
      );
      const endPositions = element.sourceVertexIndices.map((vertex) =>
        this.particles[vertex]!.position
      );
      const analysis = analyzeLinearSimplexMeasureN({
        restPositions: this.restPositions[elementIndex]!,
        startPositions,
        endPositions,
        minimumMeasureRatio: this.minimumMeasureRatio,
        ...(this.timeTolerance === undefined
          ? {} : { timeTolerance: this.timeTolerance }),
        ...(this.maximumDepth === undefined
          ? {} : { maximumDepth: this.maximumDepth }),
        ...(this.relativeCoefficientTolerance === undefined
          ? {} : { relativeCoefficientTolerance: this.relativeCoefficientTolerance })
      });
      if (analysis.status !== 'safe') {
        const candidate = Object.freeze({ elementIndex, element, analysis });
        const margin = analysis.status === 'initial-violation'
          ? analysis.initialMargin
          : analysis.bernsteinBounds[0];
        return Object.freeze({
          accepted: false,
          margin,
          reason: analysis.status === 'initial-violation'
            ? `source simplex ${element.sourceCellIndex} begins below the intrinsic measure threshold`
            : `source simplex ${element.sourceCellIndex} may meet the intrinsic measure threshold`,
          status: analysis.status,
          requiredMinimumMeasureRatio: this.minimumMeasureRatio,
          inspectedElementCount: elementIndex + 1,
          minimumMarginLowerBound: Number.isFinite(minimumMarginLowerBound)
            ? minimumMarginLowerBound : null,
          candidate
        });
      }
      minimumMarginLowerBound = Math.min(
        minimumMarginLowerBound,
        analysis.minimumMarginLowerBound
      );
    }
    return Object.freeze({
      accepted: true,
      margin: minimumMarginLowerBound,
      status: 'accepted',
      requiredMinimumMeasureRatio: this.minimumMeasureRatio,
      inspectedElementCount: this.family.elements.length,
      minimumMarginLowerBound,
      candidate: null
    });
  }

  /** Registers this policy; family particles must already belong to the world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error(
        'SimplexConstitutiveFamilyMeasureTrajectoryGuardN.addToWorld: expected an XpbdWorldN'
      );
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `SimplexConstitutiveFamilyMeasureTrajectoryGuardN.addToWorld: guard is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(
        'SimplexConstitutiveFamilyMeasureTrajectoryGuardN.addToWorld: guard is already attached to another world'
      );
    }
    this.family.assertCurrentLineage('addToWorld');
    world.addStateGuard(this);
    this.attachedWorld = world;
    return world;
  }
}

export function compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
>(
  options: CompileSimplexConstitutiveFamilyMeasureTrajectoryGuardNOptions<
    TMaterial,
    TEvaluation
  >
): SimplexConstitutiveFamilyMeasureTrajectoryGuardN<TMaterial, TEvaluation> {
  return SimplexConstitutiveFamilyMeasureTrajectoryGuardN.compile(options);
}

function validateOptionalQueryOptions(
  options: Pick<
    AnalyzeLinearSimplexMeasureNOptions,
    'timeTolerance' | 'maximumDepth' | 'relativeCoefficientTolerance'
  >,
  caller: string
): void {
  if (options.timeTolerance !== undefined &&
    (!Number.isFinite(options.timeTolerance) ||
      options.timeTolerance <= 0 || options.timeTolerance > 1)) {
    throw new Error(`${caller}: timeTolerance must be finite in (0, 1]`);
  }
  if (options.maximumDepth !== undefined &&
    (!Number.isSafeInteger(options.maximumDepth) ||
      options.maximumDepth < 1 || options.maximumDepth > 64)) {
    throw new Error(`${caller}: maximumDepth must be an integer in [1, 64]`);
  }
  if (options.relativeCoefficientTolerance !== undefined &&
    (!Number.isFinite(options.relativeCoefficientTolerance) ||
      options.relativeCoefficientTolerance < 0)) {
    throw new Error(
      `${caller}: relativeCoefficientTolerance must be finite and non-negative`
    );
  }
}
