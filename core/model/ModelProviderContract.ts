import type { PendingTaskRecord, RecentExchangeRecord, RememberedFactRecord } from '../memory/index.js';
import type { PendingOperationRecord } from '../memory/index.js';
import type { DevelopmentTaskPlan } from '../development/DevelopmentTaskContract.js';
import type { GoalDefinition } from '../development/GoalExecutionContract.js';

export interface ModelInterpretationRequest {
  readonly text: string;
  readonly rememberedFacts: readonly RememberedFactRecord[];
  /**
   * Tasks currently derived as pending, hydrated the same way as
   * rememberedFacts. Optional and defaulting to empty so every pre-existing
   * caller that has no notion of tasks keeps working unchanged.
   */
  readonly pendingTasks?: readonly PendingTaskRecord[];
  /**
   * A short, capped window of recent conversation turns, hydrated the same
   * way as rememberedFacts/pendingTasks. Optional and defaulting to empty so
   * every pre-existing caller keeps working unchanged.
   */
  readonly recentExchanges?: readonly RecentExchangeRecord[];
  readonly requestedAt: string;
}

export interface ModelInterpretationRememberDecision {
  readonly intent: 'remember';
  readonly content: string;
}

export interface ModelInterpretationRespondDecision {
  readonly intent: 'respond';
  readonly answer: string;
  /**
   * Whether this exchange is worth remembering as recent conversation
   * context for a later continuation reference. Defaults to `true` when
   * omitted, so every pre-existing caller keeps working unchanged. A
   * ModelProvider sets this to `false` for an answer that itself carries no
   * real information (e.g. "I don't know" / "nothing found") - recording
   * such an answer as context would let a later short continuation
   * ("então continua") pick it back up as if it were a real, substantive
   * topic, instead of correctly reporting it has nothing to continue.
   */
  readonly recordable?: boolean;
  /**
   * Structural opt-in for remote conversational cognition. Only the
   * deterministic provider may set it; the Agent never infers eligibility
   * by comparing user-facing answer text.
   */
  readonly cognitiveFallbackEligible?: boolean;
  readonly pendingOperation?: PendingOperationRecord;
}

/** A decision to create a new pending task with the given content. */
export interface ModelInterpretationAddTaskDecision {
  readonly intent: 'addTask';
  readonly content: string;
}

/**
 * A decision to complete an already-identified pending task, referenced by
 * its stable id - never by its text - so the Agent never has to re-resolve
 * ambiguity when producing the persisted completion record.
 */
export interface ModelInterpretationCompleteTaskDecision {
  readonly intent: 'completeTask';
  readonly taskId: string;
}

/**
 * A decision to delegate to a specific Tool, identified by a toolId the
 * Agent recognizes (e.g. the filesystem inspection toolIds). The Core and
 * the converse capability never see this shape - only the Agent, which owns
 * the decision of whether and which Tool to invoke.
 */
export interface ModelInterpretationUseToolDecision {
  readonly intent: 'useTool';
  readonly toolId: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
  /** Allows the cognitive operational loop to generalize this safe decision while preserving it as fallback. */
  readonly cognitiveOperationalEligible?: boolean;
}

/**
 * A decision to run a short, structured, multi-step development task
 * (SPEC-044) instead of a single Tool invocation. The plan itself is already
 * fully formed by the ModelProvider - the Agent only orchestrates its
 * bounded execution, never re-derives or extends it.
 */
export interface ModelInterpretationDevelopTaskDecision {
  readonly intent: 'developTask';
  readonly plan: DevelopmentTaskPlan;
}

/**
 * A decision to pursue a goal (SPEC-046) through the adaptive OBJECTIVE →
 * PLAN → ACT → OBSERVE → DECIDE → VERIFY → COMPLETE cycle, instead of a
 * single Tool invocation or an already-fully-formed plan. Unlike
 * `developTask`, the ModelProvider does not build the step sequence here -
 * only the goal itself (what to achieve, and what it is authorized to do) -
 * the Agent's `GoalExecutionOrchestrator` decides each next action from what
 * the previous one observed.
 */
export interface ModelInterpretationPursueGoalDecision {
  readonly intent: 'pursueGoal';
  readonly goal: GoalDefinition;
}

export type ModelInterpretationDecision =
  | ModelInterpretationRememberDecision
  | ModelInterpretationRespondDecision
  | ModelInterpretationUseToolDecision
  | ModelInterpretationAddTaskDecision
  | ModelInterpretationCompleteTaskDecision
  | ModelInterpretationDevelopTaskDecision
  | ModelInterpretationPursueGoalDecision;

/**
 * Substitutable boundary for natural-language interpretation. Core never
 * references this contract - it is a dependency of the Agent only, so the
 * concrete provider (development or, later, a real paid LLM) can change
 * without touching Core, Memory, Capability or Tool.
 */
export interface ModelProvider {
  interpret(request: ModelInterpretationRequest): Promise<ModelInterpretationDecision>;
}
