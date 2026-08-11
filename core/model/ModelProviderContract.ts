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

export type ModelInterpretationDecision =
  | ModelInterpretationRememberDecision
  | ModelInterpretationRespondDecision;

/**
 * Substitutable boundary for natural-language interpretation. Core never
 * references this contract - it is a dependency of the Agent only, so the
 * concrete provider (development or, later, a real paid LLM) can change
 * without touching Core, Memory, Capability or Tool.
 */
export interface ModelProvider {
  interpret(request: ModelInterpretationRequest): Promise<ModelInterpretationDecision>;
}
