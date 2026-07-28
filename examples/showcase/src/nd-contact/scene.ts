import { VecN } from '@holotope/core';
import {
  HyperplaneColliderN,
  XpbdParticleHyperplaneBarrierN,
  XpbdParticleHyperplaneBarrierStepFilterN,
  XpbdParticleN
} from '@holotope/physics';

/**
 * Authored parameters for one corner scene.
 *
 * `activationDistance` is IPC's geometric accuracy `d̂` and `stiffness` its
 * barrier scale `κ`. Both are authored rather than derived because the demo
 * makes them draggable: a barrier is constructed with them fixed, so changing
 * either means rebuilding the scene rather than mutating it.
 */
export interface NdContactSceneOptions {
  /** Ambient Euclidean dimension. The only thing that differs between panes. */
  readonly dimension: number;
  /** Particles dropped into the corner. */
  readonly particleCount?: number;
  /** Barrier activation distance `d̂`, in scene units. */
  readonly activationDistance?: number;
  /** Barrier energy scale `κ`. */
  readonly stiffness?: number;
  /**
   * Spread given to axes beyond the floor and axis 0, so the extra dimensions
   * carry real state.
   *
   * Zero by default, which keeps a scene built at any dimension identical in its
   * shared coordinates. The R⁴ pane opts in: with every particle at w = 0 a
   * hyperplane section is degenerate — everything at one offset, nothing
   * anywhere else — so the slice sweep would show nothing about the source.
   *
   * Because each barrier is axis-aligned, a particle's coordinate on one axis
   * enters only that axis's barrier, and gravity acts along the floor axis
   * alone. The prediction is therefore that spreading the extra axes leaves the
   * shared coordinates bitwise unchanged. That is a claim about the solver, not
   * an assumption: it is asserted in `test/nd-contact.test.ts`.
   */
  readonly extraAxisSpread?: number;
}

/** One constructed scene, ready to be stepped. */
export interface NdContactScene {
  readonly dimension: number;
  readonly particles: readonly XpbdParticleN[];
  readonly providers: readonly XpbdParticleHyperplaneBarrierN[];
  readonly stepFilters: readonly XpbdParticleHyperplaneBarrierStepFilterN[];
  readonly planes: readonly HyperplaneColliderN[];
  /** Uniform gravity along the negative floor axis. */
  readonly gravity: VecN;
  readonly activationDistance: number;
  readonly stiffness: number;
  readonly extraAxisSpread: number;
}

/** The axis the floor is built on; gravity opposes it. */
export const FLOOR_AXIS = 1;

const unitAxis = (dimension: number, index: number): VecN => {
  const components = new Array<number>(dimension).fill(0);
  components[index] = 1;
  return new VecN(components);
};

/**
 * Builds the same corner scene at any dimension.
 *
 * Construction is the one place a dimension may be branched on, and it is
 * branched on here only to answer "how many walls does a corner have" — a
 * corner in R^n needs one floor and `n - 1` walls. Nothing about the physics,
 * the barrier law, or the stepping differs; see `advanceNdContact`, which
 * treats dimension purely as data.
 *
 * The layout matches the scene the library's own dimension test uses, so
 * numbers produced here are directly comparable to
 * `packages/physics/test/xpbd-incremental-potential-dimensions.test.ts`.
 */
export function buildNdContactScene(options: NdContactSceneOptions): NdContactScene {
  const caller = 'buildNdContactScene';
  const { dimension } = options;
  if (!Number.isInteger(dimension) || dimension < 2) {
    throw new RangeError(`${caller}: dimension must be an integer of at least 2`);
  }
  const particleCount = options.particleCount ?? 4;
  if (!Number.isInteger(particleCount) || particleCount < 1) {
    throw new RangeError(`${caller}: particleCount must be a positive integer`);
  }
  const activationDistance = options.activationDistance ?? 0.05;
  const stiffness = options.stiffness ?? 1;
  if (!(activationDistance > 0) || !Number.isFinite(activationDistance)) {
    throw new RangeError(`${caller}: activationDistance must be finite and positive`);
  }
  if (!(stiffness > 0) || !Number.isFinite(stiffness)) {
    throw new RangeError(`${caller}: stiffness must be finite and positive`);
  }

  const extraAxisSpread = options.extraAxisSpread ?? 0;
  if (!Number.isFinite(extraAxisSpread) || extraAxisSpread < 0) {
    throw new RangeError(`${caller}: extraAxisSpread must be finite and non-negative`);
  }

  const particles = Array.from({ length: particleCount }, (_, k) => {
    const position = new Array<number>(dimension).fill(0);
    position[FLOOR_AXIS] = 0.6 + k * 0.15;
    position[0] = (k - (particleCount - 1) / 2) * 0.2;
    // Axes beyond the floor and axis 0 stay at zero unless asked for, so a scene
    // built at a higher dimension is otherwise the same scene.
    if (extraAxisSpread > 0) {
      for (let axis = 2; axis < dimension; axis++) {
        position[axis] = (k - (particleCount - 1) / 2) * extraAxisSpread;
      }
    }
    return new XpbdParticleN({ id: `p${k}`, position: new VecN(position) });
  });

  // A corner: the floor, then one wall per remaining axis.
  const planes = [new HyperplaneColliderN(unitAxis(dimension, FLOOR_AXIS), 0)];
  for (let axis = 0; axis < dimension; axis++) {
    if (axis === FLOOR_AXIS) continue;
    planes.push(new HyperplaneColliderN(unitAxis(dimension, axis), -1));
  }

  const providers: XpbdParticleHyperplaneBarrierN[] = [];
  const stepFilters: XpbdParticleHyperplaneBarrierStepFilterN[] = [];
  for (const [particleIndex, particle] of particles.entries()) {
    for (const [planeIndex, plane] of planes.entries()) {
      const barrier = new XpbdParticleHyperplaneBarrierN({
        id: `barrier/${particleIndex}/${planeIndex}`,
        particle,
        plane,
        activationDistance,
        stiffness
      });
      providers.push(barrier);
      stepFilters.push(
        new XpbdParticleHyperplaneBarrierStepFilterN({
          id: `filter/${particleIndex}/${planeIndex}`,
          barrier
        })
      );
    }
  }

  const gravityComponents = new Array<number>(dimension).fill(0);
  gravityComponents[FLOOR_AXIS] = -9.81;

  return Object.freeze({
    dimension,
    particles,
    providers,
    stepFilters,
    planes,
    gravity: new VecN(gravityComponents),
    activationDistance,
    stiffness,
    extraAxisSpread
  });
}
