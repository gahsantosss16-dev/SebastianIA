import type { RememberedFactRecord } from '../memory/index.js';

export interface ModelInterpretationRequest {
  readonly text: string;
  readonly rememberedFacts: readonly RememberedFactRecord[];
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

export type ModelInterpretationDecision =
  | ModelInterpretationRememberDecision
  | ModelInterpretationRespondDecision
  | ModelInterpretationUseToolDecision;

/**
 * Substitutable boundary for natural-language interpretation. Core never
 * references this contract - it is a dependency of the Agent only, so the
 * concrete provider (development or, later, a real paid LLM) can change
 * without touching Core, Memory, Capability or Tool.
 */
export interface ModelProvider {
  interpret(request: ModelInterpretationRequest): Promise<ModelInterpretationDecision>;
}
