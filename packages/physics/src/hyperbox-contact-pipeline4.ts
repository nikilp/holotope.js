import { TransformN } from '@holotope/core';
import {
  SweepAndPruneCandidateProviderN,
  hyperboxBounds4,
  type BroadphaseCandidateProviderN,
  type BroadphaseCandidateResultN,
  type BroadphaseDiagnosticsN,
  type BroadphaseProxyN
} from './broadphase.js';
import type { ContactMaterial4 } from './contact-material4.js';
import {
  ContactSolver4,
  contactConstraintsFromHyperboxPatch4,
  type ContactConstraint4,
  type ContactParticipant4,
  type ContactSolveResult4,
  type ContactSolver4Options
} from './normal-contact-solver4.js';
import {
  type HyperboxContactOptions4,
  type HyperboxContactPatch4,
  type HyperboxContactResult4
} from './hyperbox-contact4.js';
import { HyperboxSupportShape4 } from './hyperbox4.js';
import {
  NarrowphaseDispatcherN,
  type NarrowphaseHyperboxDeepManifoldResultN
} from './narrowphase-dispatcher.js';
import { RigidBody4 } from './rigid-body4.js';
import type { PhysicsWorld4 } from './world4.js';

export interface HyperboxCollider4Options {
  readonly id: string;
  readonly halfExtents: ArrayLike<number>;
  /** Dynamic body, prescribed rigid motion, or null for a fixed collider. */
  readonly participant?: ContactParticipant4;
  /** Manual world pose for fixed/kinematic colliders. Dynamic bodies own pose. */
  readonly transform?: TransformN;
  /** Pose of the box relative to a dynamic body's center/principal frame. */
  readonly localTransform?: TransformN;
  readonly material?: ContactMaterial4;
  /** Unsigned 32-bit membership bits. Default 1. */
  readonly collisionGroup?: number;
  /** Unsigned 32-bit accepted membership bits. Default all bits. */
  readonly collisionMask?: number;
  readonly enabled?: boolean;
}

/**
 * A full-dimensional R4 hyperbox plus response and filtering policy.
 *
 * Dynamic collider pose is synchronized from `RigidBody4` before every query.
 * Fixed and kinematic collider pose is explicit and changed through
 * `setTransform`; a `RigidMotion4` supplies velocity but intentionally does not
 * pretend to contain a complete orientation pose.
 */
export class HyperboxCollider4 {
  readonly id: string;
  readonly shape: HyperboxSupportShape4;
  readonly localTransform: TransformN;
  friction: number;
  restitution: number;
  collisionGroup: number;
  collisionMask: number;
  enabled: boolean;
  private _participant: ContactParticipant4;
  private manualTransform: TransformN;

  constructor(options: HyperboxCollider4Options) {
    if (options.id.length === 0) {
      throw new Error('HyperboxCollider4: id must not be empty');
    }
    this.id = options.id;
    this._participant = options.participant ?? null;
    if (this._participant instanceof RigidBody4 && options.transform !== undefined) {
      throw new Error('HyperboxCollider4: a dynamic body owns its world transform');
    }
    this.localTransform = options.localTransform?.clone() ?? TransformN.identity(4);
    assertTransform4(this.localTransform, 'localTransform');
    this.manualTransform = options.transform?.clone() ?? TransformN.identity(4);
    assertTransform4(this.manualTransform, 'transform');
    this.friction = options.material?.friction ?? 0.5;
    this.restitution = options.material?.restitution ?? 0;
    assertFriction(this.friction, 'HyperboxCollider4');
    assertRestitution(this.restitution, 'HyperboxCollider4');
    this.collisionGroup = unsigned32(options.collisionGroup ?? 1, 'collisionGroup');
    this.collisionMask = unsigned32(
      options.collisionMask ?? 0xffff_ffff,
      'collisionMask'
    );
    this.enabled = options.enabled ?? true;
    this.shape = new HyperboxSupportShape4(options.halfExtents);
    this.sync();
  }

  get participant(): ContactParticipant4 {
    return this._participant;
  }

  /** Replace response motion while retaining the current collider identity. */
  setParticipant(participant: ContactParticipant4): this {
    this._participant = participant;
    if (!(participant instanceof RigidBody4)) {
      this.manualTransform = this.shape.transform.compose(this.localTransform.inverse());
    }
    return this.sync();
  }

  /** Set the world pose of a fixed or kinematic participant. */
  setTransform(transform: TransformN): this {
    if (this._participant instanceof RigidBody4) {
      throw new Error('HyperboxCollider4.setTransform: dynamic body pose is authoritative');
    }
    assertTransform4(transform, 'transform');
    this.manualTransform = transform.clone();
    return this.sync();
  }

  /** Synchronize the support shape from its authoritative pose. */
  sync(): this {
    const root = this._participant instanceof RigidBody4
      ? new TransformN(
          4,
          this._participant.rotation.clone(),
          this._participant.position.clone()
        )
      : this.manualTransform;
    this.shape.transform = root.compose(this.localTransform);
    return this;
  }
}

export interface HyperboxContactPair4 {
  readonly id: string;
  readonly colliderA: HyperboxCollider4;
  readonly colliderB: HyperboxCollider4;
  readonly narrowphase: NarrowphaseHyperboxDeepManifoldResultN;
  readonly query: HyperboxContactResult4;
  readonly patch: HyperboxContactPatch4 | null;
  readonly friction: number;
  readonly restitution: number;
  readonly constraintIds: readonly string[];
  readonly responded: boolean;
}

export interface HyperboxContactPipelineResult4 {
  readonly pairs: readonly HyperboxContactPair4[];
  readonly response: ContactSolveResult4;
  readonly colliderCount: number;
  /** All mathematically possible active unordered pairs. */
  readonly possiblePairs: number;
  /** Pairs retained by the configured candidate provider. */
  readonly candidatePairs: number;
  readonly broadphaseRejectedPairs: number;
  readonly broadphase: BroadphaseDiagnosticsN;
  readonly filteredPairs: number;
  readonly narrowphasePairs: number;
  readonly contactPairs: number;
  readonly respondingPairs: number;
  readonly constraintCount: number;
}

export interface HyperboxContactWorldStep4 {
  readonly substeps: readonly HyperboxContactPipelineResult4[];
  readonly final: HyperboxContactPipelineResult4;
}

export interface HyperboxContactPipeline4Options {
  readonly solver?: ContactSolver4;
  readonly solverOptions?: ContactSolver4Options;
  readonly contactOptions?: HyperboxContactOptions4;
  /** Default: temporally coherent sweep-and-prune over conservative R4 AABBs. */
  readonly candidateProvider?: BroadphaseCandidateProviderN<HyperboxCollider4>;
  /** Extra AABB expansion beyond the contact tolerance. Default 0. */
  readonly broadphasePadding?: number;
  readonly narrowphaseDispatcher?: NarrowphaseDispatcherN;
  readonly mixFriction?: (frictionA: number, frictionB: number) => number;
  readonly mixRestitution?: (restitutionA: number, restitutionB: number) => number;
  readonly pairFilter?: (
    colliderA: HyperboxCollider4,
    colliderB: HyperboxCollider4
  ) => boolean;
}

/**
 * Deterministic broadphase-to-response dispatch for the specialized R4
 * hyperbox path.
 *
 * Active colliders are sorted by stable ID; a replaceable candidate provider
 * prunes pairs; filters run before narrowphase; every responding point is
 * solved in one shared `ContactSolver4` batch.
 */
export class HyperboxContactPipeline4 {
  readonly solver: ContactSolver4;
  readonly contactOptions: HyperboxContactOptions4;
  readonly candidateProvider: BroadphaseCandidateProviderN<HyperboxCollider4>;
  readonly narrowphaseDispatcher: NarrowphaseDispatcherN;
  readonly broadphasePadding: number;
  private readonly colliders = new Map<string, HyperboxCollider4>();
  private readonly mixFriction: (frictionA: number, frictionB: number) => number;
  private readonly mixRestitution: (
    restitutionA: number,
    restitutionB: number
  ) => number;
  private readonly pairFilter: (
    colliderA: HyperboxCollider4,
    colliderB: HyperboxCollider4
  ) => boolean;

  constructor(options: HyperboxContactPipeline4Options = {}) {
    if (options.solver && options.solverOptions) {
      throw new Error(
        'HyperboxContactPipeline4: provide solver or solverOptions, not both'
      );
    }
    this.solver = options.solver ?? new ContactSolver4(options.solverOptions);
    this.contactOptions = { ...options.contactOptions };
    this.candidateProvider =
      options.candidateProvider ??
      new SweepAndPruneCandidateProviderN<HyperboxCollider4>();
    this.narrowphaseDispatcher =
      options.narrowphaseDispatcher ?? new NarrowphaseDispatcherN();
    const extraPadding = options.broadphasePadding ?? 0;
    if (!Number.isFinite(extraPadding) || extraPadding < 0) {
      throw new Error(
        'HyperboxContactPipeline4: broadphasePadding must be finite and non-negative'
      );
    }
    this.broadphasePadding =
      (this.contactOptions.contactTolerance ?? 1e-12) + extraPadding;
    this.mixFriction = options.mixFriction ?? geometricMean;
    this.mixRestitution = options.mixRestitution ?? Math.max;
    this.pairFilter = options.pairFilter ?? (() => true);
  }

  get size(): number {
    return this.colliders.size;
  }

  addCollider(collider: HyperboxCollider4): this {
    const existing = this.colliders.get(collider.id);
    if (existing && existing !== collider) {
      throw new Error(`HyperboxContactPipeline4: duplicate collider ID ${collider.id}`);
    }
    this.colliders.set(collider.id, collider);
    return this;
  }

  removeCollider(colliderOrId: HyperboxCollider4 | string): this {
    const id = typeof colliderOrId === 'string' ? colliderOrId : colliderOrId.id;
    this.colliders.delete(id);
    return this;
  }

  getCollider(id: string): HyperboxCollider4 | undefined {
    return this.colliders.get(id);
  }

  /** Synchronize every dynamic support shape to its current body pose. */
  sync(): this {
    for (const collider of this.colliders.values()) collider.sync();
    return this;
  }

  /** Query all admitted pairs and solve every active response constraint. */
  solve(dt: number): HyperboxContactPipelineResult4 {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new Error('HyperboxContactPipeline4.solve: dt must be finite and positive');
    }
    const active = Array.from(this.colliders.values())
      .filter((collider) => collider.enabled)
      .sort((left, right) => compareIds(left.id, right.id));
    for (const collider of active) {
      assertColliderPolicy(collider);
      collider.sync();
    }

    const constraints: ContactConstraint4[] = [];
    const pairs: HyperboxContactPair4[] = [];
    let filteredPairs = 0;
    let narrowphasePairs = 0;
    let contactPairs = 0;
    let respondingPairs = 0;

    const proxies: BroadphaseProxyN<HyperboxCollider4>[] = active.map(
      (collider) => ({
        id: collider.id,
        bounds: hyperboxBounds4(collider.shape, this.broadphasePadding),
        value: collider
      })
    );
    const broadphaseResult = this.candidateProvider.compute(proxies);
    const candidates = resolveCandidatePairs(active, broadphaseResult);
    const possiblePairs = (active.length * (active.length - 1)) / 2;
    const broadphase = normalizedBroadphaseDiagnostics(
      this.candidateProvider.id,
      active.length,
      possiblePairs,
      candidates.length,
      broadphaseResult.diagnostics
    );

    for (const [colliderA, colliderB] of candidates) {
      if (!collisionMasksAdmit(colliderA, colliderB) || !this.pairFilter(colliderA, colliderB)) {
        filteredPairs++;
        continue;
      }
      narrowphasePairs++;
      const pairId = hyperboxPairId4(colliderA.id, colliderB.id);
      const narrowphase = this.narrowphaseDispatcher.dispatch({
        pairId,
        shapeA: colliderA.shape,
        shapeB: colliderB.shape,
        mode: 'deep-manifold',
        hyperboxOptions: this.contactOptions
      });
      if (
        narrowphase.kind !== 'deep-manifold' ||
        narrowphase.algorithm !== 'hyperbox4'
      ) {
        throw new Error(
          'HyperboxContactPipeline4: hyperbox pair lacks deep-manifold capability'
        );
      }
      const query = narrowphase.query;
      const friction = this.mixFriction(colliderA.friction, colliderB.friction);
      const restitution = this.mixRestitution(
        colliderA.restitution,
        colliderB.restitution
      );
      assertFriction(friction, 'HyperboxContactPipeline4 mixFriction');
      assertRestitution(restitution, 'HyperboxContactPipeline4 mixRestitution');
      const canRespond =
        query.patch !== null &&
        (colliderA.participant instanceof RigidBody4 ||
          colliderB.participant instanceof RigidBody4);
      const pairConstraints = canRespond
        ? contactConstraintsFromHyperboxPatch4(
            query.patch!,
            colliderA.participant,
            colliderB.participant,
            { pairId, friction, restitution }
          )
        : [];
      if (query.patch) contactPairs++;
      if (pairConstraints.length > 0) respondingPairs++;
      constraints.push(...pairConstraints);
      pairs.push({
        id: pairId,
        colliderA,
        colliderB,
        narrowphase,
        query,
        patch: query.patch,
        friction,
        restitution,
        constraintIds: pairConstraints.map((constraint) => constraint.id),
        responded: pairConstraints.length > 0
      });
    }

    const response = this.solver.solve(constraints, dt);
    return {
      pairs,
      response,
      colliderCount: active.length,
      possiblePairs,
      candidatePairs: candidates.length,
      broadphaseRejectedPairs: possiblePairs - candidates.length,
      broadphase,
      filteredPairs,
      narrowphasePairs,
      contactPairs,
      respondingPairs,
      constraintCount: constraints.length
    };
  }

  /**
   * Advance a `PhysicsWorld4` and run this pipeline at its velocity-constraint
   * seam. Colliders are resynchronized to the final integrated poses.
   */
  stepWorld(
    world: PhysicsWorld4,
    dt: number,
    substeps = 1
  ): HyperboxContactWorldStep4 {
    const results: HyperboxContactPipelineResult4[] = [];
    world.step(dt, substeps, (substepDt) => {
      results.push(this.solve(substepDt));
    });
    this.sync();
    return { substeps: results, final: results[results.length - 1]! };
  }

  reset(): void {
    this.solver.reset();
    this.candidateProvider.reset?.();
    this.narrowphaseDispatcher.reset();
  }
}

/** Stable, delimiter-safe ID for a canonically ordered collider pair. */
export function hyperboxPairId4(colliderIdA: string, colliderIdB: string): string {
  if (colliderIdA.length === 0 || colliderIdB.length === 0) {
    throw new Error('hyperboxPairId4: collider IDs must not be empty');
  }
  const [left, right] = compareIds(colliderIdA, colliderIdB) <= 0
    ? [colliderIdA, colliderIdB]
    : [colliderIdB, colliderIdA];
  return `${left.length}:${left}|${right.length}:${right}`;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolveCandidatePairs(
  active: readonly HyperboxCollider4[],
  result: BroadphaseCandidateResultN<HyperboxCollider4>
): [HyperboxCollider4, HyperboxCollider4][] {
  const byId = new Map(active.map((collider) => [collider.id, collider]));
  const seen = new Set<string>();
  const resolved: [HyperboxCollider4, HyperboxCollider4][] = [];
  for (const { proxyA, proxyB } of result.pairs) {
    if (proxyA.id === proxyB.id) {
      throw new Error('HyperboxContactPipeline4: candidate provider returned a self pair');
    }
    const first = byId.get(proxyA.id);
    const second = byId.get(proxyB.id);
    if (!first || !second) {
      throw new Error('HyperboxContactPipeline4: candidate provider returned an unknown proxy');
    }
    const pairId = hyperboxPairId4(first.id, second.id);
    if (seen.has(pairId)) {
      throw new Error(`HyperboxContactPipeline4: duplicate candidate pair ${pairId}`);
    }
    seen.add(pairId);
    resolved.push(
      compareIds(first.id, second.id) <= 0 ? [first, second] : [second, first]
    );
  }
  resolved.sort(
    ([leftA, leftB], [rightA, rightB]) =>
      compareIds(leftA.id, rightA.id) || compareIds(leftB.id, rightB.id)
  );
  return resolved;
}

function normalizedBroadphaseDiagnostics(
  providerId: string,
  proxyCount: number,
  possiblePairs: number,
  candidatePairs: number,
  source: BroadphaseDiagnosticsN
): BroadphaseDiagnosticsN {
  if (source.axis !== null && (!Number.isSafeInteger(source.axis) || source.axis < 0 || source.axis >= 4)) {
    throw new Error('HyperboxContactPipeline4: broadphase axis must be null or in [0, 3]');
  }
  for (const [name, value] of [
    ['primaryAxisOverlaps', source.primaryAxisOverlaps],
    ['secondaryAxisTests', source.secondaryAxisTests],
    ['sortSwaps', source.sortSwaps]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`HyperboxContactPipeline4: broadphase ${name} must be non-negative`);
    }
  }
  return {
    providerId,
    proxyCount,
    possiblePairs,
    candidatePairs,
    rejectedPairs: possiblePairs - candidatePairs,
    axis: source.axis,
    primaryAxisOverlaps: source.primaryAxisOverlaps,
    secondaryAxisTests: source.secondaryAxisTests,
    sortSwaps: source.sortSwaps,
    reusedOrder: source.reusedOrder
  };
}

function assertColliderPolicy(collider: HyperboxCollider4): void {
  const caller = `HyperboxCollider4 ${collider.id}`;
  assertFriction(collider.friction, caller);
  assertRestitution(collider.restitution, caller);
  unsigned32(collider.collisionGroup, 'collisionGroup');
  unsigned32(collider.collisionMask, 'collisionMask');
}

function collisionMasksAdmit(
  colliderA: HyperboxCollider4,
  colliderB: HyperboxCollider4
): boolean {
  return (
    ((colliderA.collisionGroup & colliderB.collisionMask) >>> 0) !== 0 &&
    ((colliderB.collisionGroup & colliderA.collisionMask) >>> 0) !== 0
  );
}

function geometricMean(left: number, right: number): number {
  return Math.sqrt(left * right);
}

function assertTransform4(transform: TransformN, name: string): void {
  if (transform.dim !== 4) {
    throw new Error(`HyperboxCollider4: ${name} must be 4D`);
  }
  new HyperboxSupportShape4([1, 1, 1, 1], transform);
}

function assertFriction(value: number, caller: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${caller}: friction must be finite and non-negative`);
  }
}

function assertRestitution(value: number, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${caller}: restitution must be in [0, 1]`);
  }
}

function unsigned32(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`HyperboxCollider4: ${name} must be an unsigned 32-bit integer`);
  }
  return value >>> 0;
}
