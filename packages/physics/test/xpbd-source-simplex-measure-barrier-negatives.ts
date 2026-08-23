/**
 * The declaration half of the privacy boundary.
 *
 * Every line below must be a compile error. Run as the NEGATIVE lane:
 *
 * ```sh
 * npx tsc -p packages/physics/test/xpbd-source-simplex-measure-barrier-negatives.tsconfig.json
 * ```
 *
 * It is expected to exit non-zero with one `TS2339` per marked access. A run
 * that exits zero means the surface grew a member it should not have.
 *
 * This lane establishes DECLARATION privacy only, and that is exactly why it
 * is not the whole story: TypeScript `private` also produced a clean negative
 * lane while the packed objects were fully mutable at runtime. The runtime
 * half lives in `-surface.test.ts` and in the packed consumer, against built
 * artifacts. Neither lane substitutes for the other.
 */
import type {
  XpbdSourceSimplexMeasureBarrierTermsN
} from '../src/index.js';

declare const terms: XpbdSourceSimplexMeasureBarrierTermsN;

// The compiled result carries exactly two members.
export const a = terms.provider;
export const b = terms.stepFilter;
export const c = terms.rule;
export const d = terms.referenceMeasure;

// The provider carries exactly the released conservative-provider surface.
export const e = terms.provider.id;
export const f = terms.provider.dimension;
export const g = terms.provider.particles;
export const h = terms.provider.evaluate();
export const i = terms.provider.rule;
export const j = terms.provider.referenceMeasure;
export const k = terms.provider.staticObstacle;
export const l = terms.provider.cellParticles;
export const m = terms.provider.obstacleParticles;
export const n = terms.provider.minimumDistance;
export const o = terms.provider.activationDistance;
export const p = terms.provider.stiffness;
export const q = terms.provider.maximumDirectionError;
export const r = terms.provider.startMarginAt;

// The filter carries exactly the released step-filter surface.
export const s = terms.stepFilter.id;
export const t = terms.stepFilter.evaluate;
export const u = terms.stepFilter.provider;
export const v = terms.stepFilter.conservativeScale;

// A successful evaluation carries exactly the energy and the forces.
export const w = h.potentialEnergy;
export const x = h.forces;
export const y = h.kind;
export const z = h.lawId;
export const aa = h.nodes;
export const ab = h.witness;
export const ac = h.barrier;
