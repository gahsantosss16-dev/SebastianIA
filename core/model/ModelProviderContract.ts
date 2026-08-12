import type { PendingTaskRecord, RememberedFactRecord } from '../memory/index.js';
import type { DevelopmentTaskPlan } from '../development/DevelopmentTaskContract.js';

export interface ModelInterpretationRequest {
  readonly text: string;
  readonly rememberedFacts: readonly RememberedFactRecord[];
  /**
   * Tasks currently derived as pending, hydrated the same way as
   * rememberedFacts. Optional and defaulting to empty so every pre-existing
   * caller that has no notion of tasks keeps working unchanged.
   */
  readonly pendingTasks?: readonly PendingTaskRecord[];
  readonly requestedAt: string;
}

export interface ModelInterpretationRememberDecision {
  readonly intent: 'remember';
  readonly content: string;
}

export interface ModelInterpretationRespondDecision {
  readonly intent: 'respond';
  readonly answer: string;
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

export type ModelInterpretationDecision =
  | ModelInterpretationRememberDecision
  | ModelInterpretationRespondDecision
  | ModelInterpretationUseToolDecision
  | ModelInterpretationAddTaskDecision
  | ModelInterpretationCompleteTaskDecision
  | ModelInterpretationDevelopTaskDecision;

/**
 * Substitutable boundary for natural-language interpretation. Core never
 * references this contract - it is a dependency of the Agent only, so the
 * concrete provider (development or, later, a real paid LLM) can change
 * without touching Core, Memory, Capability or Tool.
 */
export interface ModelProvider {
  interpret(request: ModelInterpretationRequest): Promise<ModelInterpretationDecision>;
}
