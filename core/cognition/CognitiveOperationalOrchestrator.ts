import type { SpecializedTool } from '../tool/index.js';
import type {
  CognitiveDecisionRequest,
  CognitiveModelProvider,
  CognitiveObservationRecord,
  CognitiveToolDescriptor,
} from './CognitiveModelProviderContract.js';

export const MAX_OPERATIONAL_DECISIONS = 4;
const MAX_OBSERVATION_CHARS = 2_000;

export interface OperationalToolPolicyEntry extends CognitiveToolDescriptor {
  readonly requiredStringArguments: readonly string[];
}

export type CognitiveOperationalResult =
  | { readonly outcome: 'answered'; readonly answer: string; readonly toolCalls: number }
  | { readonly outcome: 'unavailable' }
  | { readonly outcome: 'blocked'; readonly reason: string; readonly toolCalls: number };

/** Bounded model → Tool → observation loop. Policy, not the model, owns authority. */
export class CognitiveOperationalOrchestrator {
  public constructor(
    private readonly tool: SpecializedTool,
    private readonly provider: CognitiveModelProvider,
    private readonly catalog: readonly OperationalToolPolicyEntry[],
    private readonly maxDecisions = MAX_OPERATIONAL_DECISIONS,
  ) {}

  public async execute(
    objective: string,
    context: { readonly executionId: string; readonly responsibilityId: string; readonly requestedAt: string; readonly relevantMemory?: readonly { readonly content: string }[] },
  ): Promise<CognitiveOperationalResult> {
    const observations: CognitiveObservationRecord[] = [];
    let toolCalls = 0;

    for (let attempt = 0; attempt < this.maxDecisions; attempt += 1) {
      let result;
      try {
        result = await this.provider.decide(this.request(objective, context.requestedAt, observations, context.relevantMemory ?? []));
      } catch {
        return { outcome: 'unavailable' };
      }
      if (result.outcome !== 'decided') {
        return result.outcome === 'unavailable' || result.outcome === 'timeout'
          ? { outcome: 'unavailable' }
          : { outcome: 'blocked', reason: 'cognitiveInvalidResponse', toolCalls };
      }

      const decision = result.decision;
      if (decision.nextAction === 'concludeCompleted') {
        return decision.finalAnswer
          ? { outcome: 'answered', answer: decision.finalAnswer, toolCalls }
          : { outcome: 'blocked', reason: 'cognitiveMissingFinalAnswer', toolCalls };
      }
      if (decision.nextAction !== 'invokeTool' || !decision.toolId) {
        return { outcome: 'blocked', reason: 'cognitiveNoActionableDecision', toolCalls };
      }

      const policy = this.catalog.find((entry) => entry.toolId === decision.toolId);
      if (!policy) {
        return { outcome: 'blocked', reason: 'cognitiveToolNotInMenu', toolCalls };
      }
      if (policy.requiresAuthorization) {
        return { outcome: 'blocked', reason: 'toolNotAuthorized', toolCalls };
      }
      const args = decision.toolArguments ?? {};
      if (
        !policy.requiredStringArguments.every((name) => typeof args[name] === 'string') ||
        Object.keys(args).some((name) => !policy.requiredStringArguments.includes(name))
      ) {
        return { outcome: 'blocked', reason: 'cognitiveInvalidToolArguments', toolCalls };
      }

      const invocation = this.tool.invoke({
        toolId: policy.toolId,
        executionId: context.executionId,
        responsibilityId: context.responsibilityId,
        requestedAt: context.requestedAt,
        payload: args,
      });
      toolCalls += 1;
      if (invocation.status !== 'completed') {
        return { outcome: 'blocked', reason: 'toolFailure', toolCalls };
      }
      const message = typeof invocation.output.message === 'string'
        ? invocation.output.message.slice(0, MAX_OBSERVATION_CHARS)
        : 'A ferramenta concluiu sem uma mensagem descritiva.';
      observations.push({
        stepId: `operational:${toolCalls}`,
        toolId: policy.toolId,
        outcome: invocation.output.outcome === 'ok' ? 'ok' : 'rejected',
        summary: message,
      });
    }

    return { outcome: 'blocked', reason: 'cognitiveBudgetExceeded', toolCalls };
  }

  private request(
    objective: string,
    requestedAt: string,
    recentObservations: readonly CognitiveObservationRecord[],
    relevantMemory: readonly { readonly content: string }[],
  ): CognitiveDecisionRequest {
    return {
      objective,
      authorization: 'readOnly',
      relevantMemory,
      recentObservations,
      filesRead: [],
      availableTools: this.catalog.map(({ toolId, description, requiresAuthorization }) => ({ toolId, description, requiresAuthorization })),
      stepsTaken: recentObservations.length,
      stepsRemaining: Math.max(0, this.maxDecisions - recentObservations.length),
      requestedAt,
    };
  }
}
