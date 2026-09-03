/**
 * ขอบเขตสาธารณะของ Canonical Machine Model
 *
 * ชั้นนี้อ่านอย่างเดียวทั้งหมด ไม่มีทางเขียน ไม่มีทางสั่งทำงาน
 */
export { MACHINE_LAYERS } from "./layers";
export type { LayerId, LayerDeclaration } from "./layers";
export { buildMachineModel, machineCensus } from "./model";
export type { MachineModel, MachineNode, MachineEdge, LayerCoverage, LayerStatus, BuildOptions } from "./model";
export { observeHardwareOs, observeInstalledSoftware, observeLocalDatabases } from "./census";
export type { MachineFact, MachineFactType, SoftwareEntity, SoftwareKind, DatabaseEntity, DatabaseKind } from "./census";
export { hardwareOf, operatingSystemOf, softwareOf, databasesOf, whereIs, availableOn, invocationOf, dependenciesOfResource, dependentsOfResource } from "./machine-binding";
export type { ResourceLocation } from "./machine-binding";
export { buildDependencyIndex, EDGE_SEMANTICS } from "./dependency-index";
export type { DependencyIndex, DependencyEdge, ImpactPath, EdgeDirection } from "./dependency-index";
export { readExpectedState, diffMachineState, expectedStateCoverage } from "./expected-state";
export type { ExpectedNode, StateDifference, DifferenceClass, ExpectedStateReport, ExpectedStateCoverage, TargetCoverage, TargetCoverageClass } from "./expected-state";
export { currentMachineIdentity, whichMachine, resourcesOf, machineState } from "./machine-binding";
export type { MachineIdentity, NodeBinding, MachineStateSummary, BindingBasis } from "./machine-binding";
export { knowledgeCoverage, EXPECTED_FACT_TYPES } from "./knowledge-coverage";
export type { KnowledgeReport, LayerKnowledge } from "./knowledge-coverage";
export { resolveResourceRoles, whyResource, evaluateNecessity, whatIfRemoved, counterfactualSets, neutralityViolations, RESOURCE_LAYERS } from "./necessity";
export type { ResourceRole, Necessity, ResourceRoleResult, PurposePath, NecessityResult, RemovalImpact, CounterfactualSet } from "./necessity";
export { projectDeclaredInvocations, projectObservedInvocations, invocationOfCapability,
  resolveInvocationGaps, projectInvocationEdges,
  whoInvokes, howIsInvoked, whatExecutes, whereDoesItRun, whatContractIsUsed, lastObservedInvocation } from "./invocation";
export type { InvocationKind, InvocationStatus, DeclaredInvocation, ObservedInvocation,
  InvocationChain, GapResolution, InvocationEdge } from "./invocation";
export { buildSelfToolModel, toolsOfDNAOS, whatCanIDoNow, whatCanINotDoNow, toolFor,
  howDoIInvoke, whatDoesItRequire, whatWillItProduce, whyCanIUseItNow, whyCanINotUseItNow,
  knowledgeGapsByFactType } from "./self-tool";
export type { SelfTool, ToolDimensions, OwnerRepresentation, BlockReason, FactTypeGap } from "./self-tool";
export { buildSelfKnowledge, answerOwnerSelfQuestions, aiRemovalProof, remainingGaps, KNOWLEDGE_FIELDS } from "./self-knowledge";
export type { CapabilityKnowledge, FieldKnowledge, FieldStatus, DefectClass, KnowledgeField,
  AuthorityMatrix, OwnerAnswer, AiRemovalProof, RemainingGap } from "./self-knowledge";
export { freezeIntegrityGaps, retrospectiveIntegrityGate, answerIntegrityQuestions, INTEGRITY_FIELDS } from "./integrity";
export type { IntegrityRecord, IntegrityFieldState, IntegrityField, IntentOrigin, GateResult,
  GateBlockReason, IntegrityAnswer, GapDefect } from "./integrity";
export { classifyExecutions, authorityTraceOf, aiResourceModel, authorityModelGaps, CLASSIFICATION_ORDER } from "./execution-authority";
export type { ExecutionContext, ExecutionRecord, ClassificationResult, AuthorityTrace, AiResource, AuthorityModelGap } from "./execution-authority";
export { capabilityContracts, contractCompatibility, compositionGraph, machineActionPrimitives,
  outcomeResolution, capabilitiesForOutcome, missingCapabilitiesForOutcome, canProduceOutcomeNow,
  whyCanNotProduceOutcome, resourcesForComposition, secretBoundaryCheck, ownerCompositionView,
  ACTION_CLASSES, TEST_OUTCOMES } from "./composition";
export type { CapabilityContract, Compatibility, CompositionEdge, CompositionGraph, ActionClass,
  ActionPrimitive, OutcomeResolution, ResourcePosition, SecretBoundaryCheck,
  OwnerCompositionBlock, OwnerCompositionView } from "./composition";
export { classifyCapabilityLevels, canonicalOperandTypes, canonicalOperators, composableOperatorPairs,
  resolveOutcomeExpression, aiOperationPositions, OWNER_TEST_EXPRESSIONS, LEVEL_ORDER } from "./operation-algebra";
export type { CapabilityLevel, LevelAssignment, OperandType, CanonicalOperator, OperatorBehavior,
  OperatorPair, OwnerOutcomeExpression, OperationResolution, EquationResult, AiOperationPosition } from "./operation-algebra";
