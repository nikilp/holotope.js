import { Rotor4, TransformN, VecN } from '@holotope/core';
import {
  AxisAlignedBoundsN,
  SweepAndPruneCandidateProviderN,
  hyperboxBounds4,
  supportShapeBoundsN,
  sweptBoundsN,
  type BroadphaseCandidateProviderN,
  type BroadphaseDiagnosticsN,
  type BroadphaseProxyN
} from './broadphase.js';
import type { RigidMotion4 } from './contact-kinematics4.js';
import type { ContactMaterial4 } from './contact-material4.js';
import { HyperboxCollider4 } from './hyperbox-contact-pipeline4.js';
import type { HyperboxContactOptions4, HyperboxContactPatch4 } from './hyperbox-contact4.js';
import { HyperplaneColliderN } from './hyperplane-collider.js';
import { HyperboxSupportShape4 } from './hyperbox4.js';
import {
  convexLinearCastN,
  supportShapeHyperplaneLinearCastN,
  type ConvexLinearCastOptionsN,
  type ConvexLinearCastResultN,
  type HyperplaneLinearCastOptionsN,
  type HyperplaneLinearCastResultN
} from './linear-cast.js';
import {
  convexRigidCast4,
  supportShapeHyperplaneRigidCast4,
  type ConvexRigidCastResult4,
  type HyperplaneRigidCastResult4,
  type RigidCastMotion4
} from './rigid-cast4.js';
import type {
  HyperboxHyperplaneContactPatch4,
  MixedAnalyticContactOptions4
} from './mixed-contact4.js';
import {
  NarrowphaseDispatcherN,
  type NarrowphaseDispatchRequestN,
  type NarrowphaseDispatchResultN
} from './narrowphase-dispatcher.js';
import {
  ContactSolver4,
  contactConstraintFromSmoothPointPatch4,
  contactConstraintsFromHyperboxHyperplanePatch4,
  contactConstraintsFromHyperboxPatch4,
  contactConstraintsFromPolytopePatch4,
  contactConstraintsFromPolytopeHyperplanePatch4,
  type ContactConstraint4,
  type ContactParticipant4,
  type ContactSolveResult4,
  type ContactSolver4Options
} from './normal-contact-solver4.js';
import type { PolytopeContactPatch4 } from './polytope-contact4.js';
import type { PolytopeContactOptions4 } from './polytope-contact4.js';
import type {
  PolytopeHyperplaneContactOptions4,
  PolytopeHyperplaneContactPatch4
} from './polytope-plane-contact4.js';
import {
  KinematicBody4,
  applyKinematicBodyPosePlan4,
  planKinematicBodyPose4,
  type KinematicBodyPosePlan4
} from './kinematic-body4.js';
import {
  CompiledPolytopeSupportShapeN,
  compileConvexPolytopeTopologyN,
  type ConvexPolytopeTopologyN,
  type ConvexPolytopeTopologyOptionsN
} from './polytope-topology.js';
import { RigidBody4 } from './rigid-body4.js';
import {
  applyRigidBodyPosePlan4,
  planRigidBodyPose4,
  type RigidBodyPosePlan4
} from './rigid-body-pose-plan4.js';
import { RigidTrajectory4 } from './rigid-trajectory4.js';
import {
  GlomeSupportShapeN,
  TransformedSupportShapeN,
  supportShapeVerticesN,
  type SupportShapeN
} from './support-shape.js';
import type {
  SmoothContactOptionsN,
  SmoothPointContactPatchN
} from './smooth-contact.js';
import type { PhysicsWorld4 } from './world4.js';

interface ContactColliderPolicy4 {
  readonly id: string;
  readonly participant: ContactParticipant4;
  friction: number;
  restitution: number;
  collisionGroup: number;
  collisionMask: number;
  enabled: boolean;
  sync(): this;
}

const defaultPolytopeTopologyCache = new WeakMap<
  SupportShapeN,
  ConvexPolytopeTopologyN
>();

export interface GlomeCollider4Options {
  readonly id: string;
  readonly radius: number;
  /** Dynamic body, pose-owning kinematic body, velocity-only motion, or null. */
  readonly participant?: ContactParticipant4;
  /** Explicit world center for fixed or velocity-only participants. */
  readonly center?: VecN | ArrayLike<number>;
  /** Body-local center for a dynamic or pose-owning kinematic participant. */
  readonly localCenter?: VecN | ArrayLike<number>;
  readonly material?: ContactMaterial4;
  readonly collisionGroup?: number;
  readonly collisionMask?: number;
  readonly enabled?: boolean;
}

/** Finite R4 glome collider whose center can follow a rigid body. */
export class GlomeCollider4 implements ContactColliderPolicy4 {
  readonly id: string;
  readonly shape: GlomeSupportShapeN;
  readonly localCenter: VecN;
  friction: number;
  restitution: number;
  collisionGroup: number;
  collisionMask: number;
  enabled: boolean;
  private _participant: ContactParticipant4;
  private manualCenter: VecN;

  constructor(options: GlomeCollider4Options) {
    assertColliderId(options.id, 'GlomeCollider4');
    this.id = options.id;
    this._participant = options.participant ?? null;
    if (ownsColliderPose(this._participant) && options.center !== undefined) {
      throw new Error('GlomeCollider4: a body owns its world center');
    }
    if (!ownsColliderPose(this._participant) && options.localCenter !== undefined) {
      throw new Error(
        'GlomeCollider4: localCenter requires a dynamic body or pose-owning kinematic body'
      );
    }
    this.localCenter = vector4(options.localCenter, 'GlomeCollider4 localCenter');
    this.manualCenter = vector4(options.center, 'GlomeCollider4 center');
    this.shape = new GlomeSupportShapeN(this.manualCenter, options.radius);
    this.friction = options.material?.friction ?? 0.5;
    this.restitution = options.material?.restitution ?? 0;
    assertMaterial(this.friction, this.restitution, 'GlomeCollider4');
    this.collisionGroup = unsigned32(options.collisionGroup ?? 1, 'collisionGroup');
    this.collisionMask = unsigned32(
      options.collisionMask ?? 0xffff_ffff,
      'collisionMask'
    );
    this.enabled = options.enabled ?? true;
    this.sync();
  }

  get participant(): ContactParticipant4 {
    return this._participant;
  }

  setParticipant(participant: ContactParticipant4): this {
    if (ownsColliderPose(this._participant) && !ownsColliderPose(participant)) {
      this.manualCenter = this.shape.center.clone();
    }
    this._participant = participant;
    return this.sync();
  }

  setCenter(center: VecN | ArrayLike<number>): this {
    if (ownsColliderPose(this._participant)) {
      throw new Error('GlomeCollider4.setCenter: body center is authoritative');
    }
    this.manualCenter = vector4(center, 'GlomeCollider4 center');
    return this.sync();
  }

  setRadius(radius: number): this {
    if (!Number.isFinite(radius) || radius < 0) {
      throw new Error('GlomeCollider4.setRadius: radius must be finite and non-negative');
    }
    this.shape.radius = radius;
    return this;
  }

  sync(): this {
    const center = ownsColliderPose(this._participant)
      ? this._participant.rotation
          .applyToPoint(this.localCenter)
          .add(this._participant.position)
      : this.manualCenter;
    this.shape.center.data.set(center.data);
    return this;
  }
}

export interface PolytopeCollider4Options {
  readonly id: string;
  /** Full-dimensional local R4 support shape with stable vertex enumeration. */
  readonly source: SupportShapeN;
  /** Dynamic body, pose-owning kinematic body, velocity-only motion, or null. */
  readonly participant?: ContactParticipant4;
  /** Manual world pose for fixed/velocity-only colliders. Pose owners reject it. */
  readonly transform?: TransformN;
  /** Collider pose relative to a dynamic or kinematic body's root frame. */
  readonly localTransform?: TransformN;
  /** Reusable source incidence. Compiled once from `source` when omitted. */
  readonly topology?: ConvexPolytopeTopologyN;
  readonly topologyOptions?: ConvexPolytopeTopologyOptionsN;
  readonly material?: ContactMaterial4;
  readonly collisionGroup?: number;
  readonly collisionMask?: number;
  readonly enabled?: boolean;
}

/** Vertex-enumerable convex R4 polytope with explicit pose and response policy. */
export class PolytopeCollider4 implements ContactColliderPolicy4 {
  readonly id: string;
  readonly source: SupportShapeN;
  readonly shape: TransformedSupportShapeN;
  readonly topology: ConvexPolytopeTopologyN;
  readonly localTransform: TransformN;
  friction: number;
  restitution: number;
  collisionGroup: number;
  collisionMask: number;
  enabled: boolean;
  private _participant: ContactParticipant4;
  private manualTransform: TransformN;

  constructor(options: PolytopeCollider4Options) {
    assertColliderId(options.id, 'PolytopeCollider4');
    if (options.source.dim !== 4 || !supportShapeVerticesN(options.source)) {
      throw new Error(
        'PolytopeCollider4: source must be a vertex-enumerable R4 support shape'
      );
    }
    this.id = options.id;
    this.source = options.source;
    const cachedTopology = options.topologyOptions === undefined
      ? defaultPolytopeTopologyCache.get(options.source)
      : undefined;
    const suppliedTopology = options.topology
      ?? options.source.polytopeTopology
      ?? cachedTopology;
    const compilation = suppliedTopology
      ? null
      : compileConvexPolytopeTopologyN(options.source, options.topologyOptions);
    if (compilation && (compilation.status !== 'complete' || !compilation.topology)) {
      throw new Error(
        `PolytopeCollider4: topology compilation failed (${compilation.reason})`
      );
    }
    this.topology = suppliedTopology
      ?? compilation!.topology!;
    if (!suppliedTopology && options.topologyOptions === undefined) {
      defaultPolytopeTopologyCache.set(options.source, this.topology);
    }
    const topologicalSource = new CompiledPolytopeSupportShapeN(
      options.source,
      this.topology
    );
    this._participant = options.participant ?? null;
    if (ownsColliderPose(this._participant) && options.transform !== undefined) {
      throw new Error('PolytopeCollider4: a body owns its world transform');
    }
    this.localTransform = options.localTransform?.clone() ?? TransformN.identity(4);
    assertTransform4(this.localTransform, 'PolytopeCollider4 localTransform');
    this.manualTransform = options.transform?.clone() ?? TransformN.identity(4);
    assertTransform4(this.manualTransform, 'PolytopeCollider4 transform');
    this.shape = new TransformedSupportShapeN(topologicalSource);
    this.friction = options.material?.friction ?? 0.5;
    this.restitution = options.material?.restitution ?? 0;
    assertMaterial(this.friction, this.restitution, 'PolytopeCollider4');
    this.collisionGroup = unsigned32(options.collisionGroup ?? 1, 'collisionGroup');
    this.collisionMask = unsigned32(
      options.collisionMask ?? 0xffff_ffff,
      'collisionMask'
    );
    this.enabled = options.enabled ?? true;
    this.sync();
  }

  get participant(): ContactParticipant4 {
    return this._participant;
  }

  setParticipant(participant: ContactParticipant4): this {
    this._participant = participant;
    if (!ownsColliderPose(participant)) {
      this.manualTransform = this.shape.transform.compose(this.localTransform.inverse());
    }
    return this.sync();
  }

  setTransform(transform: TransformN): this {
    if (ownsColliderPose(this._participant)) {
      throw new Error('PolytopeCollider4.setTransform: body pose is authoritative');
    }
    assertTransform4(transform, 'PolytopeCollider4 transform');
    this.manualTransform = transform.clone();
    return this.sync();
  }

  sync(): this {
    const root = ownsColliderPose(this._participant)
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

export interface HyperplaneContactCollider4Options {
  readonly id: string;
  readonly normal: VecN | ArrayLike<number>;
  readonly offset?: number;
  /** Prescribed motion supplies velocity only; geometry remains explicit. */
  readonly participant?: RigidMotion4 | null;
  readonly material?: ContactMaterial4;
  readonly collisionGroup?: number;
  readonly collisionMask?: number;
  readonly enabled?: boolean;
}

/** Infinite R4 contact boundary kept outside compact-support broadphase. */
export class HyperplaneContactCollider4 implements ContactColliderPolicy4 {
  readonly id: string;
  private _shape: HyperplaneColliderN;
  friction: number;
  restitution: number;
  collisionGroup: number;
  collisionMask: number;
  enabled: boolean;
  private _participant: RigidMotion4 | null;

  constructor(options: HyperplaneContactCollider4Options) {
    assertColliderId(options.id, 'HyperplaneContactCollider4');
    if (
      options.participant instanceof RigidBody4 ||
      options.participant instanceof KinematicBody4
    ) {
      throw new Error(
        'HyperplaneContactCollider4: an infinite plane cannot have a pose-owning body'
      );
    }
    this.id = options.id;
    this._participant = options.participant ?? null;
    this._shape = plane4(options.normal, options.offset ?? 0);
    this.friction = options.material?.friction ?? 0.5;
    this.restitution = options.material?.restitution ?? 0;
    assertMaterial(this.friction, this.restitution, 'HyperplaneContactCollider4');
    this.collisionGroup = unsigned32(options.collisionGroup ?? 1, 'collisionGroup');
    this.collisionMask = unsigned32(
      options.collisionMask ?? 0xffff_ffff,
      'collisionMask'
    );
    this.enabled = options.enabled ?? true;
  }

  get participant(): RigidMotion4 | null {
    return this._participant;
  }

  get shape(): HyperplaneColliderN {
    return this._shape;
  }

  setParticipant(participant: RigidMotion4 | null): this {
    if (participant instanceof RigidBody4 || participant instanceof KinematicBody4) {
      throw new Error(
        'HyperplaneContactCollider4: an infinite plane cannot have a pose-owning body'
      );
    }
    this._participant = participant;
    return this;
  }

  setPlane(normal: VecN | ArrayLike<number>, offset = 0): this {
    this._shape = plane4(normal, offset);
    return this;
  }

  sync(): this {
    return this;
  }
}

export type CompactContactCollider4 =
  | HyperboxCollider4
  | GlomeCollider4
  | PolytopeCollider4;
export type ContactCollider4 = CompactContactCollider4 | HyperplaneContactCollider4;

export interface ContactPipelinePair4 {
  readonly id: string;
  readonly colliderA: ContactCollider4;
  readonly colliderB: ContactCollider4;
  readonly narrowphase: NarrowphaseDispatchResultN;
  readonly patch:
    | HyperboxContactPatch4
    | PolytopeContactPatch4
    | PolytopeHyperplaneContactPatch4
    | HyperboxHyperplaneContactPatch4
    | SmoothPointContactPatchN
    | null;
  readonly friction: number;
  readonly restitution: number;
  readonly constraintIds: readonly string[];
  readonly responded: boolean;
}

export interface ContactPipelineResult4 {
  readonly pairs: readonly ContactPipelinePair4[];
  readonly response: ContactSolveResult4;
  readonly colliderCount: number;
  readonly compactColliderCount: number;
  readonly hyperplaneColliderCount: number;
  /** Compact/compact plus compact/hyperplane pairs; plane/plane is excluded. */
  readonly possiblePairs: number;
  /** Compact candidates retained by broadphase plus every compact/plane pair. */
  readonly candidatePairs: number;
  readonly compactCandidatePairs: number;
  readonly hyperplaneCandidatePairs: number;
  readonly broadphaseRejectedPairs: number;
  /** Diagnostics cover only the finite compact-collider lane. */
  readonly broadphase: BroadphaseDiagnosticsN;
  readonly filteredPairs: number;
  readonly narrowphasePairs: number;
  readonly distancePairs: number;
  readonly unsupportedPairs: number;
  readonly contactPairs: number;
  readonly respondingPairs: number;
  readonly constraintCount: number;
  readonly retiredNarrowphasePairIds: readonly string[];
}

export interface ContactPipelineWorldStep4 {
  readonly substeps: readonly ContactPipelineResult4[];
  readonly final: ContactPipelineResult4;
}

export interface ContactPipelineContinuousOptions4 {
  /** Maximum impact events resolved inside one substep. Default 8. */
  readonly maxEventsPerSubstep?: number;
  /** Smallest remaining/advanced time represented explicitly. Default 1e-12 s. */
  readonly timeTolerance?: number;
  /** Zero band for externally prescribed kinematic velocity. Default 1e-12. */
  readonly angularVelocityTolerance?: number;
  /** Conservative-advancement policy for compact/compact casts. */
  readonly castOptions?: ConvexLinearCastOptionsN;
}

export type ContactPipelineContinuousStatus4 =
  | 'complete'
  | 'partial'
  | 'event-limit';

export interface ContactPipelineContinuousEvent4 {
  readonly pairId: string;
  /** Time from the beginning of this substep. */
  readonly time: number;
  /** Cast fraction of the remaining interval immediately before this event. */
  readonly remainingFraction: number;
  readonly cast: ContactPipelineContinuousCast4;
  readonly solve: ContactPipelineResult4;
}

export type ContactPipelineContinuousCast4 =
  | ConvexLinearCastResultN
  | HyperplaneLinearCastResultN
  | ConvexRigidCastResult4
  | HyperplaneRigidCastResult4;

export interface ContactPipelineContinuousSubstep4 {
  readonly status: ContactPipelineContinuousStatus4;
  readonly requestedDt: number;
  readonly advancedDt: number;
  readonly remainingDt: number;
  readonly initial: ContactPipelineResult4;
  readonly events: readonly ContactPipelineContinuousEvent4[];
  readonly final: ContactPipelineResult4;
  readonly castPairs: number;
  /** One compact-collider swept-broadphase record per impact scan. */
  readonly sweptBroadphase: readonly BroadphaseDiagnosticsN[];
  /** Reserved for dynamic angular trajectories unsupported by a collider type. */
  readonly angularFallbackPairIds: readonly string[];
  readonly kinematicFallbackPairIds: readonly string[];
  readonly indeterminatePairIds: readonly string[];
}

export interface ContactPipelineContinuousWorldStep4 {
  readonly status: ContactPipelineContinuousStatus4;
  readonly substeps: readonly ContactPipelineContinuousSubstep4[];
  readonly final: ContactPipelineResult4;
}

export interface ContactPipeline4Options {
  readonly solver?: ContactSolver4;
  readonly solverOptions?: ContactSolver4Options;
  readonly candidateProvider?: BroadphaseCandidateProviderN<CompactContactCollider4>;
  readonly narrowphaseDispatcher?: NarrowphaseDispatcherN;
  readonly hyperboxContactOptions?: HyperboxContactOptions4;
  readonly smoothContactOptions?: SmoothContactOptionsN;
  readonly mixedContactOptions?: MixedAnalyticContactOptions4;
  readonly polytopeContactOptions?: Omit<PolytopeContactOptions4, 'epaOptions'>;
  readonly polytopeHyperplaneContactOptions?: Omit<
    PolytopeHyperplaneContactOptions4,
    'polytopeMargin'
  >;
  /** Extra compact AABB expansion beyond query tolerances. Default 0. */
  readonly broadphasePadding?: number;
  readonly mixFriction?: (frictionA: number, frictionB: number) => number;
  readonly mixRestitution?: (restitutionA: number, restitutionB: number) => number;
  readonly pairFilter?: (
    colliderA: ContactCollider4,
    colliderB: ContactCollider4
  ) => boolean;
}

/**
 * Deterministic mixed-shape R4 contact orchestration.
 *
 * Finite hyperboxes, vertex polytopes, and glomes share the configured N-D
 * broadphase. Infinite hyperplanes use a separate exhaustive compact/plane
 * lane. The capability dispatcher decides whether each admitted pair yields
 * distance, exact deep contact, or an explicit unsupported result.
 */
export class ContactPipeline4 {
  readonly solver: ContactSolver4;
  readonly candidateProvider: BroadphaseCandidateProviderN<CompactContactCollider4>;
  readonly narrowphaseDispatcher: NarrowphaseDispatcherN;
  readonly hyperboxContactOptions: HyperboxContactOptions4;
  readonly smoothContactOptions: SmoothContactOptionsN;
  readonly mixedContactOptions: MixedAnalyticContactOptions4;
  readonly polytopeContactOptions: Omit<PolytopeContactOptions4, 'epaOptions'>;
  readonly polytopeHyperplaneContactOptions: Omit<
    PolytopeHyperplaneContactOptions4,
    'polytopeMargin'
  >;
  readonly broadphasePadding: number;
  private readonly colliders = new Map<string, ContactCollider4>();
  private readonly mixFriction: (frictionA: number, frictionB: number) => number;
  private readonly mixRestitution: (
    restitutionA: number,
    restitutionB: number
  ) => number;
  private readonly pairFilter: (
    colliderA: ContactCollider4,
    colliderB: ContactCollider4
  ) => boolean;

  constructor(options: ContactPipeline4Options = {}) {
    if (options.solver && options.solverOptions) {
      throw new Error('ContactPipeline4: provide solver or solverOptions, not both');
    }
    this.solver = options.solver ?? new ContactSolver4(options.solverOptions);
    this.candidateProvider =
      options.candidateProvider ??
      new SweepAndPruneCandidateProviderN<CompactContactCollider4>();
    this.narrowphaseDispatcher =
      options.narrowphaseDispatcher ?? new NarrowphaseDispatcherN();
    this.hyperboxContactOptions = { ...options.hyperboxContactOptions };
    this.smoothContactOptions = { ...options.smoothContactOptions };
    this.mixedContactOptions = { ...options.mixedContactOptions };
    this.polytopeContactOptions = { ...options.polytopeContactOptions };
    this.polytopeHyperplaneContactOptions = {
      ...options.polytopeHyperplaneContactOptions
    };
    const extraPadding = options.broadphasePadding ?? 0;
    if (!Number.isFinite(extraPadding) || extraPadding < 0) {
      throw new Error('ContactPipeline4: broadphasePadding must be finite and non-negative');
    }
    this.broadphasePadding = Math.max(
      this.hyperboxContactOptions.contactTolerance ?? 1e-12,
      this.smoothContactOptions.tolerance ?? 1e-12,
      this.mixedContactOptions.tolerance ?? 1e-12,
      this.polytopeContactOptions.clipTolerance ?? 1e-9
    ) + extraPadding;
    this.mixFriction = options.mixFriction ?? geometricMean;
    this.mixRestitution = options.mixRestitution ?? Math.max;
    this.pairFilter = options.pairFilter ?? (() => true);
  }

  get size(): number {
    return this.colliders.size;
  }

  addCollider(collider: ContactCollider4): this {
    const existing = this.colliders.get(collider.id);
    if (existing && existing !== collider) {
      throw new Error(`ContactPipeline4: duplicate collider ID ${collider.id}`);
    }
    this.colliders.set(collider.id, collider);
    return this;
  }

  removeCollider(colliderOrId: ContactCollider4 | string): this {
    const id = typeof colliderOrId === 'string' ? colliderOrId : colliderOrId.id;
    this.colliders.delete(id);
    return this;
  }

  getCollider(id: string): ContactCollider4 | undefined {
    return this.colliders.get(id);
  }

  sync(): this {
    for (const collider of this.colliders.values()) collider.sync();
    return this;
  }

  solve(dt: number): ContactPipelineResult4 {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new Error('ContactPipeline4.solve: dt must be finite and positive');
    }
    const active = Array.from(this.colliders.values())
      .filter((collider) => collider.enabled)
      .sort((left, right) => compareIds(left.id, right.id));
    for (const collider of active) {
      assertColliderPolicy(collider);
      collider.sync();
    }
    const compact = active.filter(isCompactCollider);
    const hyperplanes = active.filter(isHyperplaneContactCollider);
    const proxies: BroadphaseProxyN<CompactContactCollider4>[] = compact.map(
      (collider) => ({
        id: collider.id,
        bounds: collider instanceof HyperboxCollider4
          ? hyperboxBounds4(collider.shape, this.broadphasePadding)
          : supportShapeBoundsN(collider.shape, this.broadphasePadding),
        value: collider
      })
    );
    const broadphaseResult = this.candidateProvider.compute(proxies);
    const compactCandidates = resolveCompactCandidates(compact, broadphaseResult.pairs);
    const candidates: [ContactCollider4, ContactCollider4][] = [...compactCandidates];
    for (const finite of compact) {
      for (const plane of hyperplanes) candidates.push(canonicalColliderPair(finite, plane));
    }
    candidates.sort(compareColliderPairs);

    const compactPossiblePairs = unorderedPairCount(compact.length);
    const hyperplaneCandidatePairs = compact.length * hyperplanes.length;
    const possiblePairs = compactPossiblePairs + hyperplaneCandidatePairs;
    const broadphase = normalizedBroadphaseDiagnostics(
      this.candidateProvider.id,
      compact.length,
      compactPossiblePairs,
      compactCandidates.length,
      broadphaseResult.diagnostics
    );

    let filteredPairs = 0;
    const admitted: [ContactCollider4, ContactCollider4][] = [];
    for (const pair of candidates) {
      if (!collisionMasksAdmit(pair[0], pair[1]) || !this.pairFilter(pair[0], pair[1])) {
        filteredPairs++;
      } else {
        admitted.push(pair);
      }
    }
    const requests: NarrowphaseDispatchRequestN[] = admitted.map(
      ([colliderA, colliderB]) => ({
        pairId: contactPairId4(colliderA.id, colliderB.id),
        shapeA: colliderA.shape,
        shapeB: colliderB.shape,
        mode: 'best',
        hyperboxOptions: this.hyperboxContactOptions,
        smoothContactOptions: this.smoothContactOptions,
        mixedContactOptions: this.mixedContactOptions,
        polytopeOptions: this.polytopeContactOptions,
        polytopeHyperplaneOptions: this.polytopeHyperplaneContactOptions
      })
    );
    const dispatched = this.narrowphaseDispatcher.dispatchBatch(requests);
    const pairById = new Map(
      admitted.map((pair) => [contactPairId4(pair[0].id, pair[1].id), pair])
    );
    const constraints: ContactConstraint4[] = [];
    const pairs: ContactPipelinePair4[] = [];
    let distancePairs = 0;
    let unsupportedPairs = 0;
    let contactPairs = 0;
    let respondingPairs = 0;
    for (const narrowphase of dispatched.results) {
      const pair = pairById.get(narrowphase.pairId);
      if (!pair) throw new Error('ContactPipeline4: dispatcher returned an unknown pair');
      const [colliderA, colliderB] = pair;
      const friction = this.mixFriction(colliderA.friction, colliderB.friction);
      const restitution = this.mixRestitution(
        colliderA.restitution,
        colliderB.restitution
      );
      assertMaterial(friction, restitution, 'ContactPipeline4 material mixer');
      if (
        narrowphase.kind === 'distance' ||
        narrowphase.kind === 'shallow-contact' ||
        narrowphase.kind === 'penetration'
      ) {
        distancePairs++;
      }
      if (narrowphase.kind === 'unsupported') unsupportedPairs++;
      const patch = contactPatch(narrowphase);
      const canRespond =
        patch !== null &&
        (colliderA.participant instanceof RigidBody4 ||
          colliderB.participant instanceof RigidBody4);
      const pairConstraints = canRespond
        ? constraintsFromPatch(
            narrowphase,
            colliderA.participant,
            colliderB.participant,
            friction,
            restitution
          )
        : [];
      if (patch) contactPairs++;
      if (pairConstraints.length > 0) respondingPairs++;
      constraints.push(...pairConstraints);
      pairs.push({
        id: narrowphase.pairId,
        colliderA,
        colliderB,
        narrowphase,
        patch,
        friction,
        restitution,
        constraintIds: pairConstraints.map(({ id }) => id),
        responded: pairConstraints.length > 0
      });
    }
    const response = this.solver.solve(constraints, dt);
    return {
      pairs,
      response,
      colliderCount: active.length,
      compactColliderCount: compact.length,
      hyperplaneColliderCount: hyperplanes.length,
      possiblePairs,
      candidatePairs: candidates.length,
      compactCandidatePairs: compactCandidates.length,
      hyperplaneCandidatePairs,
      broadphaseRejectedPairs: compactPossiblePairs - compactCandidates.length,
      broadphase,
      filteredPairs,
      narrowphasePairs: admitted.length,
      distancePairs,
      unsupportedPairs,
      contactPairs,
      respondingPairs,
      constraintCount: constraints.length,
      retiredNarrowphasePairIds: dispatched.retiredPairIds
    };
  }

  stepWorld(
    world: PhysicsWorld4,
    dt: number,
    substeps = 1
  ): ContactPipelineWorldStep4 {
    const kinematicBodies = collectKinematicBodies4(this.colliders.values());
    for (const body of kinematicBodies) planKinematicBodyPose4(body, dt);
    const results: ContactPipelineResult4[] = [];
    world.step(dt, substeps, (substepDt) => {
      results.push(this.solve(substepDt));
      for (const body of kinematicBodies) {
        applyKinematicBodyPosePlan4(
          planKinematicBodyPose4(body, substepDt),
          1
        );
      }
    });
    this.sync();
    return { substeps: results, final: results[results.length - 1]! };
  }

  /**
   * Opt-in event-driven rigid CCD followed by the existing discrete solver.
   *
   * Every scan and pose advance shares one frozen trajectory per dynamic or
   * pose-owning kinematic body. Centered glomes retain the exact linear fast
   * path; velocity-only prescribed motion remains a `partial` fallback.
   */
  stepWorldContinuous(
    world: PhysicsWorld4,
    dt: number,
    substeps = 1,
    options: ContactPipelineContinuousOptions4 = {}
  ): ContactPipelineContinuousWorldStep4 {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new Error(
        'ContactPipeline4.stepWorldContinuous: dt must be finite and positive'
      );
    }
    if (!Number.isSafeInteger(substeps) || substeps < 1) {
      throw new Error(
        'ContactPipeline4.stepWorldContinuous: substeps must be a positive integer'
      );
    }
    const resolved = resolveContinuousOptions(options);
    const kinematicBodies = collectKinematicBodies4(this.colliders.values());
    for (const body of kinematicBodies) planKinematicBodyPose4(body, dt);
    for (const collider of this.colliders.values()) {
      if (
        collider.participant instanceof RigidBody4 &&
        !world.bodies.includes(collider.participant)
      ) {
        throw new Error(
          `ContactPipeline4.stepWorldContinuous: dynamic collider ${collider.id} body is not in the world`
        );
      }
    }

    const requestedDt = dt / substeps;
    const results: ContactPipelineContinuousSubstep4[] = [];
    for (let substep = 0; substep < substeps; substep++) {
      world.integrateVelocities(requestedDt);
      this.sync();
      const initial = this.solve(requestedDt);
      const events: ContactPipelineContinuousEvent4[] = [];
      const angularFallbackPairIds = new Set<string>();
      const kinematicFallbackPairIds = new Set<string>();
      const indeterminatePairIds = new Set<string>();
      const sweptBroadphase: BroadphaseDiagnosticsN[] = [];
      let castPairs = 0;
      let advancedDt = 0;
      let remainingDt = requestedDt;
      let eventLimit = false;

      while (remainingDt > resolved.timeTolerance) {
        const posePlans = planContinuousPoses4(
          world,
          this.colliders.values(),
          remainingDt
        );
        const scan = this.scanContinuousImpacts(
          remainingDt,
          resolved,
          posePlans
        );
        sweptBroadphase.push(scan.broadphase);
        castPairs += scan.castPairs;
        for (const id of scan.angularFallbackPairIds) angularFallbackPairIds.add(id);
        for (const id of scan.kinematicFallbackPairIds) kinematicFallbackPairIds.add(id);
        for (const id of scan.indeterminatePairIds) indeterminatePairIds.add(id);
        if (!scan.impact) {
          applyContinuousPosePlans4(posePlans, 1);
          advancedDt += remainingDt;
          remainingDt = 0;
          this.sync();
          break;
        }
        if (events.length >= resolved.maxEventsPerSubstep) {
          eventLimit = true;
          break;
        }
        const fraction = scan.impact.cast.time!;
        const eventDt = Math.max(0, Math.min(remainingDt, remainingDt * fraction));
        if (eventDt > 0) {
          applyContinuousPosePlans4(posePlans, fraction);
          advancedDt += eventDt;
          remainingDt -= eventDt;
          this.sync();
        }
        const solve = this.solve(requestedDt);
        events.push({
          pairId: scan.impact.pairId,
          time: advancedDt,
          remainingFraction: fraction,
          cast: scan.impact.cast,
          solve
        });

        // A zero-time event should become an initial contact after this solve.
        // If the response route could not consume it, stop rather than spin.
        if (eventDt <= resolved.timeTolerance && solve.contactPairs === 0) {
          indeterminatePairIds.add(scan.impact.pairId);
          break;
        }
      }

      if (!eventLimit && remainingDt > 0) {
        applyContinuousPosePlans4(
          planContinuousPoses4(world, this.colliders.values(), remainingDt),
          1
        );
        advancedDt += remainingDt;
        remainingDt = 0;
        this.sync();
      }
      this.sync();
      const final = this.solve(requestedDt);
      const hasFallback =
        angularFallbackPairIds.size > 0 ||
        kinematicFallbackPairIds.size > 0 ||
        indeterminatePairIds.size > 0;
      const status: ContactPipelineContinuousStatus4 = eventLimit
        ? 'event-limit'
        : hasFallback
          ? 'partial'
          : 'complete';
      results.push({
        status,
        requestedDt,
        advancedDt,
        remainingDt,
        initial,
        events,
        final,
        castPairs,
        sweptBroadphase,
        angularFallbackPairIds: Array.from(angularFallbackPairIds).sort(compareIds),
        kinematicFallbackPairIds: Array.from(kinematicFallbackPairIds).sort(compareIds),
        indeterminatePairIds: Array.from(indeterminatePairIds).sort(compareIds)
      });
    }
    world.clearAccumulators();
    this.sync();
    const status: ContactPipelineContinuousStatus4 = results.some(
      ({ status }) => status === 'event-limit'
    )
      ? 'event-limit'
      : results.some(({ status }) => status === 'partial')
        ? 'partial'
        : 'complete';
    return {
      status,
      substeps: results,
      final: results[results.length - 1]!.final
    };
  }

  private scanContinuousImpacts(
    remainingDt: number,
    options: ResolvedContinuousOptions4,
    posePlans: ReadonlyMap<ContinuousPoseOwner4, ContinuousPosePlan4>
  ): ContinuousImpactScan4 {
    const active = Array.from(this.colliders.values())
      .filter((collider) => collider.enabled)
      .sort((left, right) => compareIds(left.id, right.id));
    const compact = active.filter(isCompactCollider);
    const hyperplanes = active.filter(isHyperplaneContactCollider);
    const padding = Math.max(
      this.broadphasePadding,
      (options.castOptions.targetDistance ?? 0) +
        (options.castOptions.distanceTolerance ?? 1e-12)
    );
    const proxies: BroadphaseProxyN<CompactContactCollider4>[] = compact.map(
      (collider) => ({
        id: collider.id,
        bounds: sweptColliderBounds4(
          collider,
          remainingDt,
          padding
        ),
        value: collider
      })
    );
    const broadphaseResult = this.candidateProvider.compute(proxies);
    const compactCandidates = resolveCompactCandidates(
      compact,
      broadphaseResult.pairs
    );
    const candidates: [ContactCollider4, ContactCollider4][] = [
      ...compactCandidates
    ];
    for (const finite of compact) {
      for (const plane of hyperplanes) {
        candidates.push(canonicalColliderPair(finite, plane));
      }
    }
    candidates.sort(compareColliderPairs);
    const broadphase = normalizedBroadphaseDiagnostics(
      this.candidateProvider.id,
      compact.length,
      unorderedPairCount(compact.length),
      compactCandidates.length,
      broadphaseResult.diagnostics
    );
    const angularFallbackPairIds = new Set<string>();
    const kinematicFallbackPairIds = new Set<string>();
    const indeterminatePairIds = new Set<string>();
    let castPairs = 0;
    let impact: ContinuousImpact4 | null = null;
    const normalizedEventTolerance = Math.min(
      1,
      options.timeTolerance / remainingDt
    );

    for (const [colliderA, colliderB] of candidates) {
        if (
          !collisionMasksAdmit(colliderA, colliderB) ||
          !this.pairFilter(colliderA, colliderB)
        ) continue;
        const pairId = contactPairId4(colliderA.id, colliderB.id);
        if (hasUnmanagedKinematicMotion(colliderA, options.angularVelocityTolerance) ||
            hasUnmanagedKinematicMotion(colliderB, options.angularVelocityTolerance)) {
          kinematicFallbackPairIds.add(pairId);
          continue;
        }
        const dynamicA = colliderA.participant instanceof RigidBody4;
        const dynamicB = colliderB.participant instanceof RigidBody4;
        if (!dynamicA && !dynamicB) continue;

        const displacementA = colliderPlannedDisplacement4(
          colliderA,
          posePlans
        );
        const displacementB = colliderPlannedDisplacement4(
          colliderB,
          posePlans
        );
        const requiresRigidCast =
          hasPlannedGeometricAngularMotion(
            colliderA,
            posePlans
          ) ||
          hasPlannedGeometricAngularMotion(
            colliderB,
            posePlans
          );
        let cast: ContactPipelineContinuousCast4;
        if (isHyperplaneContactCollider(colliderA)) {
          if (!isCompactCollider(colliderB)) {
            throw new Error('ContactPipeline4: plane/plane CCD pair escaped filtering');
          }
          cast = requiresRigidCast
            ? supportShapeHyperplaneRigidCast4(
                colliderB.shape,
                colliderRigidCastMotion4(colliderB, posePlans),
                colliderA.shape,
                options.castOptions
              )
            : supportShapeHyperplaneLinearCastN(
                colliderB.shape,
                displacementB,
                colliderA.shape,
                hyperplaneCastOptions(options.castOptions)
              );
        } else if (isHyperplaneContactCollider(colliderB)) {
          if (!isCompactCollider(colliderA)) {
            throw new Error('ContactPipeline4: plane/plane CCD pair escaped filtering');
          }
          cast = requiresRigidCast
            ? supportShapeHyperplaneRigidCast4(
                colliderA.shape,
                colliderRigidCastMotion4(colliderA, posePlans),
                colliderB.shape,
                options.castOptions
              )
            : supportShapeHyperplaneLinearCastN(
                colliderA.shape,
                displacementA,
                colliderB.shape,
                hyperplaneCastOptions(options.castOptions)
              );
        } else {
          cast = requiresRigidCast
            ? convexRigidCast4(
                colliderA.shape,
                colliderRigidCastMotion4(colliderA, posePlans),
                colliderB.shape,
                colliderRigidCastMotion4(colliderB, posePlans),
                options.castOptions
              )
            : convexLinearCastN(
                colliderA.shape,
                displacementA,
                colliderB.shape,
                displacementB,
                options.castOptions
              );
        }
        castPairs++;
        if (cast.status === 'indeterminate') {
          indeterminatePairIds.add(pairId);
          continue;
        }
        if (
          cast.status !== 'impact' ||
          cast.time === null ||
          cast.time <= normalizedEventTolerance
        ) continue;
        if (
          !impact ||
          cast.time < impact.cast.time! - normalizedEventTolerance ||
          (Math.abs(cast.time - impact.cast.time!) <= normalizedEventTolerance &&
            compareIds(pairId, impact.pairId) < 0)
        ) {
          impact = { pairId, cast };
        }
    }
    return {
      impact,
      castPairs,
      broadphase,
      angularFallbackPairIds: Array.from(angularFallbackPairIds),
      kinematicFallbackPairIds: Array.from(kinematicFallbackPairIds),
      indeterminatePairIds: Array.from(indeterminatePairIds)
    };
  }

  reset(): void {
    this.solver.reset();
    this.candidateProvider.reset?.();
    this.narrowphaseDispatcher.reset();
  }
}

interface ResolvedContinuousOptions4 {
  readonly maxEventsPerSubstep: number;
  readonly timeTolerance: number;
  readonly angularVelocityTolerance: number;
  readonly castOptions: ConvexLinearCastOptionsN;
}

interface ContinuousImpact4 {
  readonly pairId: string;
  readonly cast: ContactPipelineContinuousCast4;
}

interface ContinuousImpactScan4 {
  readonly impact: ContinuousImpact4 | null;
  readonly castPairs: number;
  readonly broadphase: BroadphaseDiagnosticsN;
  readonly angularFallbackPairIds: readonly string[];
  readonly kinematicFallbackPairIds: readonly string[];
  readonly indeterminatePairIds: readonly string[];
}

function sweptColliderBounds4(
  collider: CompactContactCollider4,
  remainingDt: number,
  padding: number
): AxisAlignedBoundsN {
  const start = collider instanceof HyperboxCollider4
    ? hyperboxBounds4(collider.shape, padding)
    : supportShapeBoundsN(collider.shape, padding);
  const displacement = colliderLinearDisplacement4(collider, remainingDt);
  const participant = collider.participant;
  if (!participant || !hasGeometricAngularMotion(collider)) {
    return sweptBoundsN(start, displacement);
  }

  // AABB-corner radius is deliberately conservative: every point in the
  // starting shape lies inside this pivot-centered ball, and arbitrary rigid
  // rotation preserves that radius. Sweeping the ball with the pivot covers
  // unsupported angular trajectories without pretending to solve them.
  const pivot = participant instanceof RigidBody4
    ? participant.position
    : participant.center;
  let radiusSquared = 0;
  for (let axis = 0; axis < 4; axis++) {
    const reach = Math.max(
      Math.abs(start.min[axis]! - pivot.data[axis]!),
      Math.abs(start.max[axis]! - pivot.data[axis]!)
    );
    radiusSquared += reach * reach;
  }
  const radius = Math.sqrt(radiusSquared);
  const min = new Float64Array(4);
  const max = new Float64Array(4);
  for (let axis = 0; axis < 4; axis++) {
    min[axis] = pivot.data[axis]! - radius;
    max[axis] = pivot.data[axis]! + radius;
  }
  return sweptBoundsN(new AxisAlignedBoundsN(min, max), displacement);
}

function colliderLinearDisplacement4(
  collider: ContactCollider4,
  dt: number
): VecN {
  const participant = collider.participant;
  if (!participant) return new VecN(4);
  const velocity = participant instanceof RigidBody4
    ? participant.linearVelocity
    : participant.linearVelocity;
  return velocity.clone().multiplyScalar(dt);
}

type ContinuousPoseOwner4 = RigidBody4 | KinematicBody4;
type ContinuousPosePlan4 = RigidBodyPosePlan4 | KinematicBodyPosePlan4;

function planContinuousPoses4(
  world: PhysicsWorld4,
  colliders: Iterable<ContactCollider4>,
  duration: number
): ReadonlyMap<ContinuousPoseOwner4, ContinuousPosePlan4> {
  const plans = new Map<ContinuousPoseOwner4, ContinuousPosePlan4>(
    world.bodies.map((body) => [body, planRigidBodyPose4(body, duration)])
  );
  for (const body of collectKinematicBodies4(colliders)) {
    plans.set(body, planKinematicBodyPose4(body, duration));
  }
  return plans;
}

function applyContinuousPosePlans4(
  plans: ReadonlyMap<ContinuousPoseOwner4, ContinuousPosePlan4>,
  time: number
): void {
  for (const plan of plans.values()) {
    if (plan.body instanceof KinematicBody4) {
      applyKinematicBodyPosePlan4(plan as KinematicBodyPosePlan4, time);
    } else {
      applyRigidBodyPosePlan4(plan as RigidBodyPosePlan4, time);
    }
  }
}

function colliderRigidCastMotion4(
  collider: CompactContactCollider4,
  plans: ReadonlyMap<ContinuousPoseOwner4, ContinuousPosePlan4>
): RigidCastMotion4 {
  const participant = collider.participant;
  if (ownsColliderPose(participant)) {
    const plan = plans.get(participant);
    if (!plan) {
      throw new Error(
        `ContactPipeline4: dynamic collider ${collider.id} has no pose plan`
      );
    }
    if (
      collider instanceof GlomeCollider4 &&
      collider.localCenter.lengthSq() === 0
    ) {
      return {
        trajectory: new RigidTrajectory4({
          start: plan.trajectory.start,
          linearDisplacement: plan.trajectory.linearDisplacement,
          angularDisplacementWorld: new Float64Array(6)
        })
      };
    }
    return { trajectory: plan.trajectory };
  }
  return {
    trajectory: new RigidTrajectory4({
      start: new TransformN(
        4,
        Rotor4.identity(),
        collider.shape.center.clone()
      ),
      linearDisplacement: new Float64Array(4),
      angularDisplacementWorld: new Float64Array(6)
    })
  };
}

function hasPlannedGeometricAngularMotion(
  collider: ContactCollider4,
  plans: ReadonlyMap<ContinuousPoseOwner4, ContinuousPosePlan4>
): boolean {
  if (!isCompactCollider(collider)) return false;
  if (
    collider instanceof GlomeCollider4 &&
    collider.localCenter.lengthSq() === 0
  ) return false;
  const participant = collider.participant;
  if (!ownsColliderPose(participant)) return false;
  const plan = plans.get(participant);
  if (!plan) {
    throw new Error(
      `ContactPipeline4: dynamic collider ${collider.id} has no pose plan`
    );
  }
  return squaredCoefficients(
    plan.trajectory.angularDisplacementWorld.coeffs
  ) > 0;
}

function colliderPlannedDisplacement4(
  collider: ContactCollider4,
  plans: ReadonlyMap<ContinuousPoseOwner4, ContinuousPosePlan4>
): VecN {
  const participant = collider.participant;
  if (!ownsColliderPose(participant)) return new VecN(4);
  const plan = plans.get(participant);
  if (!plan) {
    throw new Error(
      `ContactPipeline4: collider ${collider.id} has no pose plan`
    );
  }
  return plan.trajectory.linearDisplacement.clone();
}

function hasGeometricAngularMotion(
  collider: CompactContactCollider4
): boolean {
  if (
    collider instanceof GlomeCollider4 &&
    collider.localCenter.lengthSq() === 0
  ) return false;
  const participant = collider.participant;
  if (!participant) return false;
  const coefficients = participant instanceof RigidBody4
    ? participant.angularVelocityWorld().coeffs
    : participant.angularVelocityWorld.coeffs;
  return squaredCoefficients(coefficients) > 0;
}

function resolveContinuousOptions(
  options: ContactPipelineContinuousOptions4
): ResolvedContinuousOptions4 {
  const maxEventsPerSubstep = options.maxEventsPerSubstep ?? 8;
  if (!Number.isSafeInteger(maxEventsPerSubstep) || maxEventsPerSubstep < 1) {
    throw new Error(
      'ContactPipeline4.stepWorldContinuous: maxEventsPerSubstep must be a positive integer'
    );
  }
  const timeTolerance = options.timeTolerance ?? 1e-12;
  const angularVelocityTolerance = options.angularVelocityTolerance ?? 1e-12;
  for (const [name, value] of [
    ['timeTolerance', timeTolerance],
    ['angularVelocityTolerance', angularVelocityTolerance]
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `ContactPipeline4.stepWorldContinuous: ${name} must be finite and non-negative`
      );
    }
  }
  const castOptions: ConvexLinearCastOptionsN = {
    distanceTolerance: 1e-12,
    ...options.castOptions
  };
  if (
    castOptions.maxIterations !== undefined &&
    (!Number.isSafeInteger(castOptions.maxIterations) || castOptions.maxIterations < 1)
  ) {
    throw new Error(
      'ContactPipeline4.stepWorldContinuous: castOptions.maxIterations must be a positive integer'
    );
  }
  for (const name of [
    'targetDistance',
    'distanceTolerance',
    'timeTolerance',
    'speedTolerance'
  ] as const) {
    const value = castOptions[name];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(
        `ContactPipeline4.stepWorldContinuous: castOptions.${name} must be finite and non-negative`
      );
    }
  }
  return {
    maxEventsPerSubstep,
    timeTolerance,
    angularVelocityTolerance,
    castOptions
  };
}

function hyperplaneCastOptions(
  options: ConvexLinearCastOptionsN
): HyperplaneLinearCastOptionsN {
  return {
    ...(options.targetDistance !== undefined
      ? { targetDistance: options.targetDistance }
      : {}),
    ...(options.distanceTolerance !== undefined
      ? { distanceTolerance: options.distanceTolerance }
      : {}),
    ...(options.timeTolerance !== undefined
      ? { timeTolerance: options.timeTolerance }
      : {}),
    ...(options.speedTolerance !== undefined
      ? { speedTolerance: options.speedTolerance }
      : {})
  };
}

function hasUnmanagedKinematicMotion(
  collider: ContactCollider4,
  tolerance: number
): boolean {
  const participant = collider.participant;
  if (
    !participant ||
    participant instanceof RigidBody4 ||
    participant instanceof KinematicBody4
  ) return false;
  return participant.linearVelocity.lengthSq() > tolerance ** 2 ||
    squaredCoefficients(participant.angularVelocityWorld.coeffs) > tolerance ** 2;
}

function squaredCoefficients(coefficients: ArrayLike<number>): number {
  let squared = 0;
  for (let index = 0; index < coefficients.length; index++) {
    squared += coefficients[index]! ** 2;
  }
  return squared;
}

/** Stable, delimiter-safe ID for any canonically ordered R4 collider pair. */
export function contactPairId4(colliderIdA: string, colliderIdB: string): string {
  assertColliderId(colliderIdA, 'contactPairId4');
  assertColliderId(colliderIdB, 'contactPairId4');
  const [left, right] = compareIds(colliderIdA, colliderIdB) <= 0
    ? [colliderIdA, colliderIdB]
    : [colliderIdB, colliderIdA];
  return `${left.length}:${left}|${right.length}:${right}`;
}

function contactPatch(
  result: NarrowphaseDispatchResultN
): HyperboxContactPatch4 | PolytopeContactPatch4 | PolytopeHyperplaneContactPatch4 | HyperboxHyperplaneContactPatch4 | SmoothPointContactPatchN | null {
  if (result.kind !== 'deep-manifold') return null;
  return result.query.patch;
}

function constraintsFromPatch(
  result: NarrowphaseDispatchResultN,
  participantA: ContactParticipant4,
  participantB: ContactParticipant4,
  friction: number,
  restitution: number
): readonly ContactConstraint4[] {
  if (result.kind !== 'deep-manifold' || !result.query.patch) return [];
  if (result.algorithm === 'hyperbox4') {
    return contactConstraintsFromHyperboxPatch4(
      result.query.patch,
      participantA,
      participantB,
      { pairId: result.pairId, friction, restitution }
    );
  }
  if (result.algorithm === 'polytope4') {
    return contactConstraintsFromPolytopePatch4(
      result.query.patch,
      participantA,
      participantB,
      { pairId: result.pairId, friction, restitution }
    );
  }
  if (result.algorithm === 'hyperbox-hyperplane4') {
    return contactConstraintsFromHyperboxHyperplanePatch4(
      result.query.patch,
      participantA,
      participantB,
      { pairId: result.pairId, friction, restitution }
    );
  }
  if (result.algorithm === 'polytope-hyperplane4') {
    return contactConstraintsFromPolytopeHyperplanePatch4(
      result.query.patch,
      participantA,
      participantB,
      { pairId: result.pairId, friction, restitution }
    );
  }
  return [contactConstraintFromSmoothPointPatch4(
    result.query.patch,
    participantA,
    participantB,
    { pairId: result.pairId, friction, restitution }
  )];
}

function resolveCompactCandidates(
  active: readonly CompactContactCollider4[],
  pairs: readonly {
    readonly proxyA: BroadphaseProxyN<CompactContactCollider4>;
    readonly proxyB: BroadphaseProxyN<CompactContactCollider4>;
  }[]
): [CompactContactCollider4, CompactContactCollider4][] {
  const byId = new Map(active.map((collider) => [collider.id, collider]));
  const seen = new Set<string>();
  const resolved: [CompactContactCollider4, CompactContactCollider4][] = [];
  for (const { proxyA, proxyB } of pairs) {
    if (proxyA.id === proxyB.id) {
      throw new Error('ContactPipeline4: candidate provider returned a self pair');
    }
    const colliderA = byId.get(proxyA.id);
    const colliderB = byId.get(proxyB.id);
    if (!colliderA || !colliderB) {
      throw new Error('ContactPipeline4: candidate provider returned an unknown proxy');
    }
    const pair: [CompactContactCollider4, CompactContactCollider4] =
      compareIds(colliderA.id, colliderB.id) <= 0
        ? [colliderA, colliderB]
        : [colliderB, colliderA];
    const id = contactPairId4(pair[0].id, pair[1].id);
    if (seen.has(id)) {
      throw new Error(`ContactPipeline4: duplicate candidate pair ${id}`);
    }
    seen.add(id);
    resolved.push(pair);
  }
  resolved.sort(compareColliderPairs);
  return resolved;
}

function canonicalColliderPair<A extends ContactCollider4, B extends ContactCollider4>(
  first: A,
  second: B
): [ContactCollider4, ContactCollider4] {
  return compareIds(first.id, second.id) <= 0
    ? [first, second]
    : [second, first];
}

function compareColliderPairs(
  left: readonly [ContactCollider4, ContactCollider4],
  right: readonly [ContactCollider4, ContactCollider4]
): number {
  return compareIds(left[0].id, right[0].id) || compareIds(left[1].id, right[1].id);
}

function isCompactCollider(
  collider: ContactCollider4
): collider is CompactContactCollider4 {
  return (
    collider instanceof HyperboxCollider4 ||
    collider instanceof GlomeCollider4 ||
    collider instanceof PolytopeCollider4
  );
}

function ownsColliderPose(
  participant: ContactParticipant4
): participant is RigidBody4 | KinematicBody4 {
  return participant instanceof RigidBody4 || participant instanceof KinematicBody4;
}

function collectKinematicBodies4(
  colliders: Iterable<ContactCollider4>
): readonly KinematicBody4[] {
  const bodies = new Set<KinematicBody4>();
  for (const collider of colliders) {
    if (collider.participant instanceof KinematicBody4) {
      bodies.add(collider.participant);
    }
  }
  return Array.from(bodies);
}

function assertTransform4(transform: TransformN, owner: string): void {
  if (
    transform.dim !== 4 ||
    Array.from(transform.position.data).some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`${owner}: expected a finite R4 transform`);
  }
  const matrix = transform.rotation instanceof Rotor4
    ? transform.rotation.toMatrix()
    : transform.rotation;
  if (
    Array.from(matrix.data).some((value) => !Number.isFinite(value)) ||
    matrix.orthogonalityError() > 1e-10 ||
    Math.abs(matrix.determinant() - 1) > 1e-9
  ) {
    throw new Error(`${owner}: rotation must be proper orthonormal`);
  }
}

function isHyperplaneContactCollider(
  collider: ContactCollider4
): collider is HyperplaneContactCollider4 {
  return collider instanceof HyperplaneContactCollider4;
}

function collisionMasksAdmit(
  colliderA: ContactCollider4,
  colliderB: ContactCollider4
): boolean {
  return (
    ((colliderA.collisionMask & colliderB.collisionGroup) >>> 0) !== 0 &&
    ((colliderB.collisionMask & colliderA.collisionGroup) >>> 0) !== 0
  );
}

function assertColliderPolicy(collider: ContactCollider4): void {
  assertMaterial(collider.friction, collider.restitution, `ContactPipeline4 ${collider.id}`);
  unsigned32(collider.collisionGroup, `${collider.id} collisionGroup`);
  unsigned32(collider.collisionMask, `${collider.id} collisionMask`);
}

function assertColliderId(id: string, owner: string): void {
  if (id.length === 0) throw new Error(`${owner}: id must not be empty`);
}

function assertMaterial(friction: number, restitution: number, owner: string): void {
  if (!Number.isFinite(friction) || friction < 0) {
    throw new Error(`${owner}: friction must be finite and non-negative`);
  }
  if (!Number.isFinite(restitution) || restitution < 0 || restitution > 1) {
    throw new Error(`${owner}: restitution must be in [0, 1]`);
  }
}

function unsigned32(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`ContactPipeline4: ${name} must be an unsigned 32-bit integer`);
  }
  return value >>> 0;
}

function vector4(
  value: VecN | ArrayLike<number> | undefined,
  name: string
): VecN {
  const vector = value instanceof VecN
    ? value.clone()
    : new VecN(value ?? new Float64Array(4));
  if (
    vector.dim !== 4 ||
    Array.from(vector.data).some((coordinate) => !Number.isFinite(coordinate))
  ) {
    throw new Error(`${name} must contain four finite coordinates`);
  }
  return vector;
}

function plane4(normal: VecN | ArrayLike<number>, offset: number): HyperplaneColliderN {
  const plane = new HyperplaneColliderN(normal, offset);
  if (plane.dim !== 4) {
    throw new Error('HyperplaneContactCollider4: normal must contain four coordinates');
  }
  return plane;
}

function geometricMean(left: number, right: number): number {
  return Math.sqrt(left * right);
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unorderedPairCount(count: number): number {
  return (count * (count - 1)) / 2;
}

function normalizedBroadphaseDiagnostics(
  providerId: string,
  proxyCount: number,
  possiblePairs: number,
  candidatePairs: number,
  source: BroadphaseDiagnosticsN
): BroadphaseDiagnosticsN {
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
