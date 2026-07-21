import type { SimplexConstitutiveEvaluationN } from './simplex-constitutive.js';
import { SimplexConstitutiveDomainErrorN } from './simplex-constitutive.js';
import {
  SimplexConstitutiveFamilyN,
  type SimplexConstitutiveFamilyEvaluationN
} from './simplex-constitutive-family.js';
import {
  XpbdParticleN,
  XpbdWorldN,
  type XpbdStateGuardContextN,
  type XpbdStateGuardEvaluationN,
  type XpbdStateGuardN
} from './xpbd-world.js';

export interface CompileSimplexConstitutiveFamilyStateGuardNOptions<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> {
  readonly id: string;
  readonly family: SimplexConstitutiveFamilyN<TMaterial, TEvaluation>;
  /** Smallest accepted current/rest intrinsic measure ratio; must be positive. */
  readonly minimumMeasureRatio: number;
}

export type SimplexConstitutiveFamilyStateGuardStatusN =
  | 'accepted'
  | 'orientation-change'
  | 'below-minimum-measure'
  | 'law-domain';

export interface SimplexConstitutiveFamilyStateGuardEvaluationN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> extends XpbdStateGuardEvaluationN {
  readonly status: SimplexConstitutiveFamilyStateGuardStatusN;
  readonly lawId: string;
  readonly requiredMinimumMeasureRatio: number;
  readonly minimumMeasureRatio: number | null;
  readonly potentialEnergy: number | null;
  readonly invertedElementCount: number | null;
  readonly collapsedElementCount: number | null;
  readonly familyEvaluation:
    | SimplexConstitutiveFamilyEvaluationN<TMaterial, TEvaluation>
    | null;
  readonly domainReason: SimplexConstitutiveDomainErrorN['reason'] | null;
}

/** Explicit post-substep domain policy for one compiled constitutive family. */
export class SimplexConstitutiveFamilyStateGuardN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
> implements XpbdStateGuardN {
  readonly id: string;
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];
  readonly family: SimplexConstitutiveFamilyN<TMaterial, TEvaluation>;
  readonly minimumMeasureRatio: number;
  private attachedWorld: XpbdWorldN | null = null;

  private constructor(
    options: CompileSimplexConstitutiveFamilyStateGuardNOptions<
      TMaterial,
      TEvaluation
    >
  ) {
    this.id = options.id;
    this.family = options.family;
    this.dimension = options.family.dimension;
    this.particles = options.family.particles;
    this.minimumMeasureRatio = options.minimumMeasureRatio;
  }

  static compile<
    TMaterial,
    TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
  >(
    options: CompileSimplexConstitutiveFamilyStateGuardNOptions<
      TMaterial,
      TEvaluation
    >
  ): SimplexConstitutiveFamilyStateGuardN<TMaterial, TEvaluation> {
    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new Error(
        'compileSimplexConstitutiveFamilyStateGuardN: id must be a non-empty string'
      );
    }
    if (!(options.family instanceof SimplexConstitutiveFamilyN)) {
      throw new Error(
        'compileSimplexConstitutiveFamilyStateGuardN: family must be a SimplexConstitutiveFamilyN'
      );
    }
    if (!(options.minimumMeasureRatio > 0) ||
      !Number.isFinite(options.minimumMeasureRatio)) {
      throw new Error(
        'compileSimplexConstitutiveFamilyStateGuardN: minimumMeasureRatio must be finite and positive'
      );
    }
    options.family.assertCurrentLineage('evaluate');
    return new SimplexConstitutiveFamilyStateGuardN(options);
  }

  evaluate(
    _context: XpbdStateGuardContextN
  ): SimplexConstitutiveFamilyStateGuardEvaluationN<TMaterial, TEvaluation> {
    try {
      const familyEvaluation = this.family.evaluate();
      const margin = familyEvaluation.minimumMeasureRatio -
        this.minimumMeasureRatio;
      const orientationChanged = familyEvaluation.invertedElementCount > 0 ||
        familyEvaluation.collapsedElementCount > 0;
      const accepted = !orientationChanged && margin >= 0;
      const status = orientationChanged
        ? 'orientation-change'
        : accepted
          ? 'accepted'
          : 'below-minimum-measure';
      return Object.freeze({
        accepted,
        margin,
        ...(accepted
          ? {}
          : {
              reason: orientationChanged
                ? 'one or more full-dimensional simplices changed orientation'
                : 'minimum measure ratio is below threshold'
            }),
        status,
        lawId: familyEvaluation.lawId,
        requiredMinimumMeasureRatio: this.minimumMeasureRatio,
        minimumMeasureRatio: familyEvaluation.minimumMeasureRatio,
        potentialEnergy: familyEvaluation.potentialEnergy,
        invertedElementCount: familyEvaluation.invertedElementCount,
        collapsedElementCount: familyEvaluation.collapsedElementCount,
        familyEvaluation,
        domainReason: null
      });
    } catch (error) {
      if (!(error instanceof SimplexConstitutiveDomainErrorN) ||
        error.lawId !== this.family.law.id) {
        throw error;
      }
      return Object.freeze({
        accepted: false,
        reason: `constitutive law refused ${error.reason}`,
        status: 'law-domain',
        lawId: error.lawId,
        requiredMinimumMeasureRatio: this.minimumMeasureRatio,
        minimumMeasureRatio: null,
        potentialEnergy: null,
        invertedElementCount: null,
        collapsedElementCount: null,
        familyEvaluation: null,
        domainReason: error.reason
      });
    }
  }

  /** Registers this read-only policy; family particles must already belong to the world. */
  addToWorld(world: XpbdWorldN): XpbdWorldN {
    if (!(world instanceof XpbdWorldN)) {
      throw new Error(
        'SimplexConstitutiveFamilyStateGuardN.addToWorld: expected an XpbdWorldN'
      );
    }
    if (world.dimension !== this.dimension) {
      throw new Error(
        `SimplexConstitutiveFamilyStateGuardN.addToWorld: guard is R${this.dimension}, world is R${world.dimension}`
      );
    }
    if (this.attachedWorld !== null && this.attachedWorld !== world) {
      throw new Error(
        'SimplexConstitutiveFamilyStateGuardN.addToWorld: guard is already attached to another world'
      );
    }
    this.family.assertCurrentLineage('addToWorld');
    world.addStateGuard(this);
    this.attachedWorld = world;
    return world;
  }
}

export function compileSimplexConstitutiveFamilyStateGuardN<
  TMaterial,
  TEvaluation extends SimplexConstitutiveEvaluationN<TMaterial>
>(
  options: CompileSimplexConstitutiveFamilyStateGuardNOptions<
    TMaterial,
    TEvaluation
  >
): SimplexConstitutiveFamilyStateGuardN<TMaterial, TEvaluation> {
  return SimplexConstitutiveFamilyStateGuardN.compile(options);
}
