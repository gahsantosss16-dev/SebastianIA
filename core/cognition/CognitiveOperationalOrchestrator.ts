import { requireSynchronousToolInvocationResult, type SpecializedTool } from '../tool/index.js';
import {
  OPERATION_EVENT_RECORD_KIND,
  PENDING_OPERATION_TTL_MS,
  type PendingOperationRecord,
} from '../memory/index.js';
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
  readonly validationToolId?: string;
  readonly risk?: string;
}

export type CognitiveOperationalResult =
  | { readonly outcome: 'answered'; readonly answer: string; readonly toolCalls: number }
  | { readonly outcome: 'proposed'; readonly answer: string; readonly operation: PendingOperationRecord; readonly toolCalls: number }
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
      const args = decision.toolArguments ?? {};
      if (!this.argumentsMatchPolicy(policy, args)) {
        return { outcome: 'blocked', reason: 'cognitiveInvalidToolArguments', toolCalls };
      }
      if (policy.requiresAuthorization) {
        const validationToolId = policy.validationToolId;
        if (!validationToolId || !this.catalog.some((entry) => entry.toolId === validationToolId && !entry.requiresAuthorization)) {
          return { outcome: 'blocked', reason: 'validationUnavailable', toolCalls };
        }
        const operation = this.proposal(objective, context.executionId, context.requestedAt, policy, args);
        return {
          outcome: 'proposed',
          operation,
          toolCalls,
          answer:
            `Encontrei uma correção possível. Proponho ${operation.proposedAction}. ` +
            `Escopo: ${operation.toolId} ${JSON.stringify(operation.toolArguments)}. ` +
            `Risco: ${operation.risk}. Posso executar e validar essa alteração?`,
        };
      }
      const invocation = await this.tool.invoke({
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

  public executeAuthorized(
    operation: PendingOperationRecord,
    context: { readonly executionId: string; readonly responsibilityId: string; readonly requestedAt: string },
  ): { readonly answer: string; readonly operation: PendingOperationRecord } {
    if (operation.status !== 'proposed' || Date.parse(context.requestedAt) >= Date.parse(operation.expiresAt)) {
      return { answer: 'A proposta expirou e não foi executada.', operation: this.transition(operation, 'expired', context.requestedAt) };
    }
    const policy = this.catalog.find((entry) => entry.toolId === operation.toolId);
    if (!policy || !policy.requiresAuthorization || policy.validationToolId !== operation.validationToolId) {
      return { answer: 'A proposta não corresponde mais ao catálogo autorizado e não foi executada.', operation: this.transition(operation, 'failed', context.requestedAt) };
    }
    if (!this.argumentsMatchPolicy(policy, operation.toolArguments)) {
      return { answer: 'O escopo armazenado da proposta é inválido e não foi executado.', operation: this.transition(operation, 'failed', context.requestedAt) };
    }

    const action = requireSynchronousToolInvocationResult(
      this.tool.invoke({
        toolId: operation.toolId,
        executionId: context.executionId,
        responsibilityId: context.responsibilityId,
        requestedAt: context.requestedAt,
        payload: operation.toolArguments,
      }),
    );
    if (action.status !== 'completed' || action.output.outcome !== 'ok') {
      return { answer: 'A alteração autorizada falhou e não foi considerada resolvida.', operation: this.transition(operation, 'failed', context.requestedAt) };
    }

    const validation = requireSynchronousToolInvocationResult(
      this.tool.invoke({
        toolId: operation.validationToolId,
        executionId: context.executionId,
        responsibilityId: context.responsibilityId,
        requestedAt: context.requestedAt,
        payload: {},
      }),
    );
    const output = validation.status === 'completed' ? validation.output : undefined;
    const validated = output?.outcome === 'ok' &&
      (output.succeeded === undefined || output.succeeded === true) &&
      (output.exitCode === undefined || output.exitCode === 0);
    if (!validated) {
      return { answer: 'A alteração foi executada, mas a validação falhou; não considero o problema resolvido.', operation: this.transition(operation, 'failed', context.requestedAt) };
    }
    return {
      answer: 'Corrigido. A alteração autorizada foi executada no escopo proposto e a validação foi concluída com sucesso.',
      operation: this.transition(operation, 'completed', context.requestedAt),
    };
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

  private proposal(
    objective: string,
    objectiveId: string,
    createdAt: string,
    policy: OperationalToolPolicyEntry,
    toolArguments: Readonly<Record<string, unknown>>,
  ): PendingOperationRecord {
    return Object.freeze({
      memoryRecordKind: OPERATION_EVENT_RECORD_KIND,
      id: `${objectiveId}:operation:${policy.toolId}`,
      objectiveId,
      objective,
      proposedAction: policy.description,
      toolId: policy.toolId,
      toolArguments: structuredClone(toolArguments) as Readonly<Record<string, unknown>>,
      validationToolId: policy.validationToolId!,
      risk: policy.risk ?? 'alteração reversível de baixo risco',
      authorizationRequirement: 'explicitUserAuthorization',
      status: 'proposed',
      createdAt,
      expiresAt: new Date(Date.parse(createdAt) + PENDING_OPERATION_TTL_MS).toISOString(),
      updatedAt: createdAt,
    });
  }

  private transition(operation: PendingOperationRecord, status: PendingOperationRecord['status'], updatedAt: string): PendingOperationRecord {
    return Object.freeze({ ...operation, status, updatedAt });
  }

  private argumentsMatchPolicy(policy: OperationalToolPolicyEntry, args: Readonly<Record<string, unknown>>): boolean {
    return policy.requiredStringArguments.every((name) => typeof args[name] === 'string') &&
      Object.keys(args).every((name) => policy.requiredStringArguments.includes(name));
  }
}
