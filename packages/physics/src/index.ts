export {
  inverseRotateBivector4,
  rotateBivector4
} from './bivector4.js';
export {
  angularVelocityOperatorNorm4,
  combineBivectorPair4,
  orientationDexp4,
  orientationDlog4,
  relativeOrientationCoordinates4,
  splitBivectorPair4,
  type BivectorPairCoordinates4,
  type OrientationBranchToken4,
  type OrientationTrivialization4,
  type RelativeOrientationCoordinates4,
  type RelativeOrientationOptions4
} from './orientation-coordinates4.js';
export {
  massPropertiesFromCellComplex4,
  massPropertiesFromConvexBoundary4,
  massPropertiesFromTetrahedralization4,
  rebasePositionsToPrincipalFrame4,
  type ConvexBoundary4,
  type MassProperties4,
  type MassProperties4Options
} from './mass-properties4.js';
export {
  RigidBody4,
  type RigidBody4Options,
  type RigidBody4StateOptions
} from './rigid-body4.js';
export { RigidBodyObject4Binding } from './object-binding4.js';
export {
  AllPairsCandidateProviderN,
  AxisAlignedBoundsN,
  SweepAndPruneCandidateProviderN,
  hyperboxBounds4,
  supportShapeSweptBoundsN,
  supportShapeBoundsN,
  sweptBoundsN,
  type BroadphaseCandidatePairN,
  type BroadphaseCandidateProviderN,
  type BroadphaseCandidateResultN,
  type BroadphaseDiagnosticsN,
  type BroadphaseProxyN,
  type SweepAndPruneCandidateProviderNOptions
} from './broadphase.js';
export {
  NarrowphaseDispatcherN,
  type NarrowphaseCacheStatusN,
  type NarrowphaseCapabilityN,
  type NarrowphaseDeepManifoldResultN,
  type NarrowphaseDispatchBatchResultN,
  type NarrowphaseDispatchRequestN,
  type NarrowphaseDispatchResultN,
  type NarrowphaseDistanceResultN,
  type NarrowphaseGlomeDeepManifoldResultN,
  type NarrowphaseGlomeHyperboxDeepManifoldResult4,
  type NarrowphaseGlomeHyperplaneDeepManifoldResultN,
  type NarrowphaseHyperboxDeepManifoldResultN,
  type NarrowphaseHyperboxHyperplaneDeepManifoldResult4,
  type NarrowphasePenetrationResult4,
  type NarrowphasePolytopeDeepManifoldResult4,
  type NarrowphasePolytopeHyperplaneDeepManifoldResult4,
  type NarrowphaseRequestModeN,
  type NarrowphaseShapeN,
  type NarrowphaseShallowContactResultN,
  type NarrowphaseUnsupportedReasonN,
  type NarrowphaseUnsupportedResultN
} from './narrowphase-dispatcher.js';
export {
  PhysicsWorld4,
  type PhysicsWorld4Options,
  type PhysicsWorld4VelocityConstraintCallback
} from './world4.js';
export {
  ConstraintBlockSolver4,
  constraintBlockResponseMatrix4,
  type ConstraintBlock4,
  type ConstraintBlockBoundedCoordinateResult4,
  type ConstraintBlockProjection4,
  type ConstraintBlockRankPolicy4,
  type ConstraintBlockResult4,
  type ConstraintBlockSolveResult4,
  type ConstraintBlockSolver4Options
} from './constraint-block4.js';
export {
  ConstraintRowSolver4,
  applyConstraintRowImpulse4,
  applyPointPairImpulse4,
  constraintRowCoupling4,
  constraintRowResponse4,
  constraintRowSpeed4,
  participantVelocityAtPoint4,
  pointConstraintRow4,
  pointPairRelativeVelocity4,
  type ConstraintImpulseState4,
  type ConstraintParticipant4,
  type ConstraintRow4,
  type ConstraintRowResult4,
  type ConstraintRowSolveResult4,
  type ConstraintRowSolver4Options,
  type PointConstraintRow4Options,
  type PointConstraintPair4,
  type RigidJacobian4
} from './constraint-row4.js';
export {
  DirectionJoint4,
  directionConstraintBlock4,
  type DirectionConstraintBlock4Options,
  type DirectionConstraintEvaluation4,
  type DirectionJoint4Options
} from './direction-joint4.js';
export {
  OrientationJoint4,
  orientationConstraintBlock4,
  type OrientationConstraintBlock4Options,
  type OrientationConstraintEvaluation4,
  type OrientationJoint4Options
} from './orientation-joint4.js';
export {
  evaluateDistanceCoordinateN,
  evaluateDistanceConstraintN,
  type DistanceCoordinateEvaluationN,
  type DistanceConstraintEvaluationN
} from './distance-coordinate-n.js';
export {
  DistanceJoint4,
  DistanceCoordinate4,
  type DistanceCoordinate4Options,
  type DistanceJoint4Options,
  type DistanceJointConstraint4
} from './distance-joint4.js';
export {
  XpbdConstraintSolverN,
  XpbdDistanceConstraintN,
  type XpbdConstraintResultN,
  type XpbdConstraintRelationN,
  type XpbdConstraintSolverNOptions,
  type XpbdConstraintStatusN,
  type XpbdDistanceConstraintEvaluationN,
  type XpbdDistanceConstraintNOptions,
  type XpbdPointN,
  type XpbdScalarConstraintEvaluationN,
  type XpbdScalarConstraintN,
  type XpbdSolveResultN
} from './xpbd-constraint.js';
export {
  XpbdAdaptiveStepFailureErrorN,
  XpbdParticleN,
  XpbdStateGuardRejectionErrorN,
  XpbdWorldN,
  type XpbdAdaptiveStepAttemptN,
  type XpbdAdaptiveStepOptionsN,
  type XpbdConservativeForceProviderEvaluationN,
  type XpbdConservativeForceProviderN,
  type XpbdForceProviderEvaluationN,
  type XpbdForceProviderN,
  type XpbdParticleNOptions,
  type XpbdParticlePositionQueryN,
  type XpbdStateGuardContextN,
  type XpbdStateGuardEvaluationN,
  type XpbdStateGuardN,
  type XpbdVelocityResponseContextN,
  type XpbdVelocityResponseEvaluationN,
  type XpbdVelocityResponseN,
  type XpbdWorldForceProviderResultN,
  type XpbdWorldAdaptiveStepResultN,
  type XpbdWorldNOptions,
  type XpbdWorldStateGuardResultN,
  type XpbdWorldStepResultN,
  type XpbdWorldSubstepResultN,
  type XpbdWorldVelocityResponseResultN
} from './xpbd-world.js';
export {
  evaluateXpbdPotentialStateN,
  type EvaluateXpbdPotentialStateNOptions,
  type XpbdPotentialStateEvaluationN,
  type XpbdPotentialStateProviderResultN
} from './xpbd-potential-state.js';
export {
  evaluateXpbdIncrementalPotentialN,
  predictXpbdInertialStateN,
  type EvaluateXpbdIncrementalPotentialNOptions,
  type PredictXpbdInertialStateNOptions,
  type XpbdIncrementalPotentialEvaluationN,
  type XpbdInertialPredictionN
} from './xpbd-incremental-potential.js';
export {
  XpbdIncrementalPotentialProblemN,
  compileXpbdIncrementalPotentialProblemN,
  searchXpbdIncrementalPotentialArmijoN,
  type CompileXpbdIncrementalPotentialProblemNOptions,
  type SearchXpbdIncrementalPotentialArmijoNOptions,
  type XpbdArmijoAcceptedN,
  type XpbdArmijoDomainRefusalN,
  type XpbdArmijoExhaustedN,
  type XpbdArmijoNotDescentN,
  type XpbdArmijoSearchResultN,
  type XpbdArmijoTrialN,
  type XpbdArmijoTrialStatusN,
  type XpbdPackedIncrementalPotentialEvaluationN
} from './xpbd-incremental-potential-problem.js';
export {
  minimizeXpbdIncrementalPotentialN,
  type MinimizeXpbdIncrementalPotentialNOptions,
  type XpbdIncrementalPotentialConvergedN,
  type XpbdIncrementalPotentialIterationLimitN,
  type XpbdIncrementalPotentialLineSearchExhaustedN,
  type XpbdIncrementalPotentialMinimizationResultN,
  type XpbdIncrementalPotentialStalledN,
  type XpbdIncrementalPotentialStallReasonN,
  type XpbdSteepestDescentIterationN
} from './xpbd-incremental-potential-minimizer.js';
export {
  XpbdExponentialVelocityDampingN,
  type XpbdExponentialVelocityDampingEvaluationN,
  type XpbdExponentialVelocityDampingNOptions
} from './xpbd-velocity-damping.js';
export {
  XpbdDistanceNetworkN,
  compileXpbdDistanceNetworkN,
  type CompileXpbdDistanceNetworkNOptions,
  type XpbdDistanceNetworkEdgeComplianceN,
  type XpbdDistanceNetworkEdgeContextN,
  type XpbdDistanceNetworkEdgeN,
  type XpbdDistanceNetworkVertexContextN,
  type XpbdDistanceNetworkVertexScalarN
} from './xpbd-network.js';
export {
  XpbdParticleBindingN,
  compileXpbdParticleBindingN,
  type CompileXpbdParticleBindingNOptions,
  type XpbdParticleBindingVertexContextN,
  type XpbdParticleBindingVertexFixedN,
  type XpbdParticleBindingVertexN,
  type XpbdParticleBindingVertexScalarN
} from './xpbd-particle-binding.js';
export {
  XpbdParticleHyperplaneConstraintN,
  XpbdParticleHyperplaneFamilyN,
  compileXpbdParticleHyperplaneFamilyN,
  type CompileXpbdParticleHyperplaneFamilyNOptions,
  type XpbdParticleHyperplaneConstraintEvaluationN,
  type XpbdParticleHyperplaneConstraintNOptions,
  type XpbdParticleHyperplaneFamilyContactN,
  type XpbdParticleHyperplaneFamilyVertexContextN,
  type XpbdParticleHyperplaneFamilyVertexScalarN
} from './xpbd-hyperplane-contact.js';
export {
  XpbdParticleHyperplaneFrictionFamilyN,
  XpbdParticleHyperplaneFrictionN,
  compileXpbdParticleHyperplaneFrictionFamilyN,
  type CompileXpbdParticleHyperplaneFrictionFamilyNOptions,
  type XpbdParticleHyperplaneFrictionEvaluationN,
  type XpbdParticleHyperplaneFrictionFamilyContactEvaluationN,
  type XpbdParticleHyperplaneFrictionFamilyContactN,
  type XpbdParticleHyperplaneFrictionFamilyEvaluationN,
  type XpbdParticleHyperplaneFrictionFamilyVertexScalarN,
  type XpbdParticleHyperplaneFrictionNOptions,
  type XpbdParticleHyperplaneFrictionStateN
} from './xpbd-hyperplane-friction.js';
export {
  XpbdOrientedSimplexMeasureConstraintN,
  XpbdSimplexSquaredMeasureConstraintN,
  evaluateOrientedSimplexMeasureN,
  evaluateSimplexSquaredMeasureN,
  type OrientedSimplexMeasureEvaluationN,
  type SimplexSquaredMeasureEvaluationN,
  type XpbdOrientedSimplexMeasureConstraintEvaluationN,
  type XpbdOrientedSimplexMeasureConstraintNOptions,
  type XpbdSimplexSquaredMeasureConstraintEvaluationN,
  type XpbdSimplexSquaredMeasureConstraintNOptions
} from './xpbd-simplex-measure.js';
export {
  XpbdSimplexMeasureFamilyN,
  compileXpbdSimplexMeasureFamilyN,
  type CompileXpbdSimplexMeasureFamilyNOptions,
  type XpbdSimplexMeasureFamilyCellContextN,
  type XpbdSimplexMeasureFamilyCellN,
  type XpbdSimplexMeasureFamilyComplianceN,
  type XpbdSimplexMeasureFamilyRestN
} from './xpbd-simplex-family.js';
export {
  XpbdOrientedCuboidFamilyN,
  compileXpbdOrientedCuboidFamilyN,
  type CompileXpbdOrientedCuboidFamilyNOptions,
  type XpbdOrientedCuboidFamilyCellContextN,
  type XpbdOrientedCuboidFamilyCellN,
  type XpbdOrientedCuboidFamilyComplianceN,
  type XpbdOrientedCuboidFamilyRestN
} from './xpbd-oriented-cuboid-family.js';
export {
  evaluateSimplexMetricDeformationN,
  type SimplexMetricDeformationN,
  type SimplexOrientationChangeN
} from './simplex-deformation.js';
export {
  analyzeLinearSimplexOrientationN,
  type AnalyzeLinearSimplexOrientationNOptions,
  type LinearSimplexOrientationAnalysisBaseN,
  type LinearSimplexOrientationAnalysisN,
  type LinearSimplexOrientationInitialViolationN,
  type LinearSimplexOrientationPossibleViolationN,
  type LinearSimplexOrientationSafeN
} from './simplex-orientation-cast.js';
export {
  analyzeLinearSimplexMeasureN,
  type AnalyzeLinearSimplexMeasureNOptions,
  type LinearSimplexMeasureAnalysisBaseN,
  type LinearSimplexMeasureAnalysisN,
  type LinearSimplexMeasureInitialViolationN,
  type LinearSimplexMeasurePossibleViolationN,
  type LinearSimplexMeasureSafeN
} from './simplex-measure-cast.js';
export {
  SimplexConstitutiveDomainErrorN,
  type SimplexConstitutiveDomainReasonN,
  type SimplexConstitutiveEvaluationN
} from './simplex-constitutive.js';
export {
  SimplexConstitutiveFamilyN,
  compileSimplexConstitutiveFamilyN,
  type CompileSimplexConstitutiveFamilyNOptions,
  type SimplexConstitutiveFamilyElementContextN,
  type SimplexConstitutiveFamilyElementEvaluationN,
  type SimplexConstitutiveFamilyElementN,
  type SimplexConstitutiveFamilyEvaluationN,
  type SimplexConstitutiveFamilyMaterialN,
  type SimplexConstitutiveLawN
} from './simplex-constitutive-family.js';
export {
  SimplexConstitutiveFamilyStateGuardN,
  compileSimplexConstitutiveFamilyStateGuardN,
  type CompileSimplexConstitutiveFamilyStateGuardNOptions,
  type SimplexConstitutiveFamilyStateGuardEvaluationN,
  type SimplexConstitutiveFamilyStateGuardStatusN
} from './simplex-constitutive-state-guard.js';
export {
  SimplexConstitutiveFamilyTrajectoryGuardN,
  compileSimplexConstitutiveFamilyTrajectoryGuardN,
  type CompileSimplexConstitutiveFamilyTrajectoryGuardNOptions,
  type SimplexConstitutiveFamilyTrajectoryGuardCandidateN,
  type SimplexConstitutiveFamilyTrajectoryGuardEvaluationN,
  type SimplexConstitutiveFamilyTrajectoryGuardStatusN
} from './simplex-constitutive-trajectory-guard.js';
export {
  SimplexConstitutiveFamilyMeasureTrajectoryGuardN,
  compileSimplexConstitutiveFamilyMeasureTrajectoryGuardN,
  type CompileSimplexConstitutiveFamilyMeasureTrajectoryGuardNOptions,
  type SimplexConstitutiveFamilyMeasureTrajectoryGuardCandidateN,
  type SimplexConstitutiveFamilyMeasureTrajectoryGuardEvaluationN,
  type SimplexConstitutiveFamilyMeasureTrajectoryGuardStatusN
} from './simplex-constitutive-measure-trajectory-guard.js';
export {
  simplexCompressibleNeoHookeanLawN,
  simplexMeasureBarrierLawN,
  simplexStVenantKirchhoffLawN
} from './simplex-constitutive-laws.js';
export {
  evaluateSimplexStVenantKirchhoffN,
  type SimplexStVenantKirchhoffEvaluationN,
  type SimplexStVenantKirchhoffMaterialN
} from './simplex-stvk-material.js';
export {
  SIMPLEX_COMPRESSIBLE_NEO_HOOKEAN_LAW_ID,
  evaluateSimplexCompressibleNeoHookeanN,
  type SimplexCompressibleNeoHookeanEvaluationN,
  type SimplexCompressibleNeoHookeanMaterialN
} from './simplex-neo-hookean-material.js';
export {
  SIMPLEX_MEASURE_BARRIER_LAW_ID,
  evaluateSimplexMeasureBarrierN,
  type SimplexMeasureBarrierEvaluationN,
  type SimplexMeasureBarrierMaterialN
} from './simplex-measure-barrier-material.js';
export {
  SimplexCompressibleNeoHookeanFamilyN,
  compileSimplexCompressibleNeoHookeanFamilyN,
  type CompileSimplexCompressibleNeoHookeanFamilyNOptions,
  type SimplexCompressibleNeoHookeanFamilyElementContextN,
  type SimplexCompressibleNeoHookeanFamilyElementEvaluationN,
  type SimplexCompressibleNeoHookeanFamilyElementN,
  type SimplexCompressibleNeoHookeanFamilyEvaluationN,
  type SimplexCompressibleNeoHookeanFamilyMaterialN
} from './simplex-neo-hookean-family.js';
export {
  lumpSimplexMassesN,
  type LumpSimplexMassesNOptions,
  type SimplexLumpedMassElementN,
  type SimplexLumpedMassesN,
  type SimplexMassDensityN,
  type SimplexMassElementContextN
} from './simplex-mass.js';
export {
  SimplexStVenantKirchhoffFamilyN,
  compileSimplexStVenantKirchhoffFamilyN,
  type CompileSimplexStVenantKirchhoffFamilyNOptions,
  type SimplexStVenantKirchhoffFamilyElementContextN,
  type SimplexStVenantKirchhoffFamilyElementEvaluationN,
  type SimplexStVenantKirchhoffFamilyElementN,
  type SimplexStVenantKirchhoffFamilyEvaluationN,
  type SimplexStVenantKirchhoffFamilyMaterialN
} from './simplex-stvk-family.js';
export {
  DistanceIntervalJoint4,
  type DistanceIntervalConstraint4,
  type DistanceIntervalEvaluation4,
  type DistanceIntervalJoint4Options,
  type DistanceIntervalState4
} from './distance-interval4.js';
export {
  DistanceMotor4,
  type DistanceMotor4Options,
  type DistanceMotorConstraint4
} from './distance-motor4.js';
export {
  PointJoint4,
  PointJointSolver4,
  applyPairPointImpulse4,
  pointJointResponseMatrix4,
  type PointJoint4Options,
  type PointJointConstraint4,
  type PointJointParticipant4,
  type PointJointResult4,
  type PointJointSolveResult4,
  type PointJointSolver4Options
} from './point-joint4.js';
export {
  PlanarRotationJoint4,
  planarRotationConstraintBlock4,
  type OrthonormalTwoFrame4,
  type OrthonormalTwoFrameInput4,
  type PlanarRotationConstraintBlock4Options,
  type PlanarRotationConstraintEvaluation4,
  type PlanarRotationJoint4Options,
  type RegularPlanarRotationConstraint4
} from './planar-rotation-joint4.js';
export {
  PlanarRotationCoordinate4,
  planarRotationPhase4,
  type PlanarRotationCoordinate4Options,
  type PlanarRotationCoordinateEvaluation4,
  type PlanarRotationPhase4Options,
  type PlanarRotationPhaseBranch4,
  type PlanarRotationPhaseEvaluation4
} from './planar-rotation-coordinate4.js';
export {
  PlanarRotationMotor4,
  type PlanarRotationMotor4Options,
  type PlanarRotationMotorConstraint4,
  type PlanarRotationMotorEvaluation4
} from './planar-rotation-motor4.js';
export {
  PlanarRotationIntervalJoint4,
  type PlanarRotationInterval4Options,
  type PlanarRotationIntervalConstraint4,
  type PlanarRotationIntervalConstraintEvaluation4,
  type PlanarRotationIntervalConstraints4,
  type PlanarRotationIntervalEvaluation4,
  type PlanarRotationIntervalObservation4,
  type PlanarRotationIntervalState4
} from './planar-rotation-interval4.js';
export {
  ConvexHullSupportShapeN,
  GlomeSupportShapeN,
  RoundedSupportShapeN,
  TransformedSupportShapeN,
  supportFeatureKeyN,
  supportShapeVerticesN,
  type SupportFeatureId,
  type SupportShapeN,
  type SupportVertexN
} from './support-shape.js';
export {
  glomeGlomeContactN,
  glomeHyperplaneContactN,
  type GlomeGlomeContactOptionsN,
  type GlomeGlomeContactResultN,
  type GlomeGlomeContactStatusN,
  type GlomeHyperplaneContactOptionsN,
  type GlomeHyperplaneContactResultN,
  type GlomeHyperplaneContactStatusN,
  type SmoothContactOptionsN,
  type SmoothPointContactPatchN
} from './smooth-contact.js';
export {
  glomeHyperboxContact4,
  hyperboxHyperplaneContact4,
  type GlomeHyperboxContactOptions4,
  type GlomeHyperboxContactResult4,
  type GlomeHyperboxContactStatus4,
  type HyperboxHyperplaneContactOptions4,
  type HyperboxHyperplaneContactPatch4,
  type HyperboxHyperplaneContactResult4,
  type HyperboxHyperplaneContactStatus4,
  type HyperboxHyperplaneContactVertex4,
  type MixedAnalyticContactOptions4
} from './mixed-contact4.js';
export {
  gjkDistance,
  type GjkBarycentricSignOracle,
  type GjkBarycentricSignResult,
  type GjkFeaturePair,
  type GjkOptions,
  type GjkResult,
  type GjkSign,
  type GjkSimplexCertificate,
  type GjkSimplexVertexN,
  type GjkTerminationCertificate,
  type GjkTerminationReason,
  type GjkTraceEntry,
  type GjkWarmStartN
} from './gjk.js';
export {
  convexLinearCastN,
  supportShapeHyperplaneLinearCastN,
  type ConvexLinearCastOptionsN,
  type ConvexLinearCastResultN,
  type HyperplaneLinearCastOptionsN,
  type HyperplaneLinearCastResultN,
  type LinearCastReasonN,
  type LinearCastStatusN,
  type LinearCastTraceEntryN
} from './linear-cast.js';
export {
  RigidTrajectory4,
  rigidTrajectoryFromTransforms4,
  type RigidTrajectory4Options
} from './rigid-trajectory4.js';
export {
  KinematicBody4,
  applyKinematicBodyPosePlan4,
  planKinematicBodyPose4,
  type KinematicBody4Options,
  type KinematicBodyPosePlan4
} from './kinematic-body4.js';
export {
  KinematicTrackDriver4,
  type KinematicTrackDriver4Options,
  type PositionSampler4
} from './kinematic-track-driver4.js';
export {
  applyRigidBodyPosePlan4,
  planRigidBodyPose4,
  type RigidBodyPosePlan4
} from './rigid-body-pose-plan4.js';
export {
  convexRigidCast4,
  supportShapeBoundingRadius4,
  supportShapeHyperplaneRigidCast4,
  type ConvexRigidCastResult4,
  type HyperplaneRigidCastResult4,
  type RigidCastMotion4,
  type RigidCastTraceEntry4
} from './rigid-cast4.js';
export {
  epaPenetration4,
  type EpaFacetCertificate4,
  type EpaOptions4,
  type EpaPenetrationResult4,
  type EpaPointContactPatch4,
  type EpaStatus4,
  type EpaTerminationCertificate4,
  type EpaTerminationReason4,
  type EpaTraceEntry4
} from './epa4.js';
export {
  polytopeContactPatch4,
  polytopeContactVertexId4,
  type PolytopeBoundaryFeature4,
  type PolytopeContactOptions4,
  type PolytopeContactPatch4,
  type PolytopeContactPatchDiagnostics4,
  type PolytopeContactReason4,
  type PolytopeContactResult4,
  type PolytopeContactStatus4,
  type PolytopeContactVertex4,
  type PolytopeFacet4,
  type PolytopeHullDiagnostics4
} from './polytope-contact4.js';
export {
  CompiledPolytopeSupportShapeN,
  compileConvexPolytopeTopologyN,
  instantiateConvexPolytopeTopologyN,
  polytopeFaceKeyN,
  resolveConvexPolytopeTopologyN,
  type CompiledPolytopeFacetN,
  type ConvexPolytopeTopologyDiagnosticsN,
  type ConvexPolytopeTopologyN,
  type ConvexPolytopeTopologyOptionsN,
  type ConvexPolytopeTopologyReasonN,
  type ConvexPolytopeTopologyResultN,
  type ConvexPolytopeResolutionReasonN,
  type ConvexPolytopeResolutionResultN,
  type InstantiatedPolytopeFacetN,
  type PolytopeTopologyInstantiationReasonN,
  type PolytopeTopologyInstantiationResultN
} from './polytope-topology.js';
export {
  polytopeHyperplaneContact4,
  type PolytopeHyperplaneContactDiagnostics4,
  type PolytopeHyperplaneContactOptions4,
  type PolytopeHyperplaneContactPatch4,
  type PolytopeHyperplaneContactReason4,
  type PolytopeHyperplaneContactResult4,
  type PolytopeHyperplaneContactStatus4,
  type PolytopeHyperplaneContactVertex4
} from './polytope-plane-contact4.js';
export {
  createExactRingGjkSignOracle,
  type ExactSupportCoordinatesN
} from './gjk-exact.js';
export {
  gjkMarginDistance,
  type GjkMarginOptions,
  type GjkMarginResult,
  type GjkMarginStatus
} from './gjk-margin.js';
export {
  HyperplaneColliderN,
  querySupportShapeHyperplane,
  type HyperplaneQueryOptions,
  type HyperplaneQueryResult
} from './hyperplane-collider.js';
export { HyperboxSupportShape4 } from './hyperbox4.js';
export {
  type ContactMaterial4
} from './contact-material4.js';
export {
  HyperboxCollider4,
  HyperboxContactPipeline4,
  hyperboxPairId4,
  type HyperboxCollider4Options,
  type HyperboxContactPair4,
  type HyperboxContactPipeline4Options,
  type HyperboxContactPipelineResult4,
  type HyperboxContactWorldStep4
} from './hyperbox-contact-pipeline4.js';
export {
  hyperboxSat4,
  type HyperboxSatAxisSource4,
  type HyperboxSatDiagnostics4,
  type HyperboxSatFeatureClass4,
  type HyperboxSatOptions4,
  type HyperboxSatResult4
} from './hyperbox-sat4.js';
export {
  hyperboxBoundaryFeatureKey4,
  hyperboxContactPatch4,
  hyperboxContactVertexId4,
  type HyperboxBoundaryFeature4,
  type HyperboxContactOptions4,
  type HyperboxContactPatch4,
  type HyperboxContactPatchDiagnostics4,
  type HyperboxContactPatchKind4,
  type HyperboxContactResult4,
  type HyperboxContactVertex4
} from './hyperbox-contact4.js';
export {
  HyperboxContactTracker4,
  type HyperboxContactTrackerOptions4,
  type HyperboxContactTrackingResult4,
  type HyperboxTrackedContactPoint4
} from './hyperbox-contact-tracker4.js';
export {
  contactTangentBasis4,
  hyperboxContactKinematics4,
  rigidMotionFromBody4,
  rigidMotionFromTransforms4,
  velocityAtWorldPoint4,
  type ContactTangentBasis4,
  type HyperboxContactKinematics4,
  type HyperboxContactKinematicsOptions4,
  type HyperboxContactPointKinematics4,
  type RigidMotion4
} from './contact-kinematics4.js';
export {
  ContactPipeline4,
  GlomeCollider4,
  HyperplaneContactCollider4,
  PolytopeCollider4,
  contactPairId4,
  type CompactContactCollider4,
  type ContactCollider4,
  type ContactPipeline4Options,
  type ContactPipelineContinuousEvent4,
  type ContactPipelineContinuousOptions4,
  type ContactPipelineContinuousCast4,
  type ContactPipelineContinuousStatus4,
  type ContactPipelineContinuousSubstep4,
  type ContactPipelineContinuousWorldStep4,
  type ContactPipelinePair4,
  type ContactPipelineResult4,
  type ContactPipelineWorldStep4,
  type GlomeCollider4Options,
  type HyperplaneContactCollider4Options,
  type PolytopeCollider4Options
} from './contact-pipeline4.js';
export {
  ContactSolver4,
  NormalContactSolver4,
  contactConstraintFromSmoothPointPatch4,
  contactConstraintsFromHyperboxHyperplanePatch4,
  contactConstraintsFromHyperboxPatch4,
  contactConstraintsFromPolytopePatch4,
  contactConstraintsFromPolytopeHyperplanePatch4,
  normalContactConstraintFromSmoothPointPatch4,
  normalContactConstraintsFromHyperboxPatch4,
  type ContactConstraint4,
  type ContactFrictionState4,
  type ContactParticipant4,
  type ContactPointResult4,
  type ContactSolveResult4,
  type ContactSolver4Options,
  type HyperboxContactConstraintsOptions4,
  type HyperboxHyperplaneContactConstraintsOptions4,
  type HyperboxNormalContactConstraintsOptions4,
  type NormalContactConstraint4,
  type NormalContactPointResult4,
  type NormalContactSolveResult4,
  type NormalContactSolver4Options,
  type PolytopeContactConstraintsOptions4,
  type PolytopeHyperplaneContactConstraintsOptions4,
  type SmoothPointContactConstraintOptions4
} from './normal-contact-solver4.js';
