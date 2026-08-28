import {
  type SpecializedAgent,
  type SpecializedAgentHandoffInput,
  type SpecializedAgentHandoffResult,
} from './SpecializedAgentHandoffContract.js';
import { InvalidSpecializedAgentHandoffInputError } from './SpecializedAgentHandoffErrors.js';
import { InMemorySpecializedTool } from '../tool/InMemorySpecializedTool.js';
import type { SpecializedTool } from '../tool/SpecializedToolInvocationContract.js';
import {
  MEMORY_FACT_RECORD_KIND,
  TASK_CREATED_RECORD_KIND,
  TASK_COMPLETED_RECORD_KIND,
  type PendingTaskRecord,
  type PendingOperationRecord,
  type RecentExchangeRecord,
  type RememberedFactRecord,
} from '../memory/index.js';
import type {
  ModelInterpretationDecision,
  ModelInterpretationDevelopTaskDecision,
  ModelInterpretationPursueGoalDecision,
  ModelInterpretationUseToolDecision,
  ModelProvider,
} from '../model/ModelProviderContract.js';
import { ConversationContextComposer } from '../model/ConversationContextComposer.js';
import {
  DevelopmentTaskOrchestrator,
  GoalExecutionOrchestrator,
  type DevelopmentTaskExecutionContext,
  type DevelopmentTaskPlan,
  type DevelopmentTaskResult,
  type GoalDefinition,
  type GoalExecutionContext,
  type GoalExecutionResult,
} from '../development/index.js';
import {
  CognitiveOperationalOrchestrator,
  type CognitiveModelProvider,
  type OperationalToolPolicyEntry,
} from '../cognition/index.js';

/** Responsibility recognized by this Agent as free-form natural language conversation. */
export const CONVERSE_COMMAND_TYPE = 'converse';

interface DevelopmentTaskOrchestratorLike {
  execute(plan: DevelopmentTaskPlan, context: DevelopmentTaskExecutionContext): DevelopmentTaskResult;
}

interface GoalExecutionOrchestratorLike {
  execute(goal: GoalDefinition, context: GoalExecutionContext): GoalExecutionResult;
  /**
   * Optional cognitive entry point (SPEC-048). Feature-detected at the call
   * site: an orchestrator (real or test double) that does not implement it
   * simply keeps using the synchronous `execute` path unchanged - existing
   * fakes that only implement `execute` are entirely unaffected.
   */
  executeWithCognition?(goal: GoalDefinition, context: GoalExecutionContext): Promise<GoalExecutionResult>;
}

export class InMemorySpecializedAgent implements SpecializedAgent {
  private readonly specializedTool: SpecializedTool;
  private readonly modelProvider: ModelProvider | undefined;
  private readonly developmentTaskOrchestrator: DevelopmentTaskOrchestratorLike;
  private readonly goalExecutionOrchestrator: GoalExecutionOrchestratorLike;
  private readonly cognitiveModelProvider: CognitiveModelProvider | undefined;
  private readonly cognitiveOperationalOrchestrator: CognitiveOperationalOrchestrator | undefined;

  public constructor(
    specializedTool: SpecializedTool = new InMemorySpecializedTool(),
    modelProvider?: ModelProvider,
    developmentTaskOrchestrator?: DevelopmentTaskOrchestratorLike,
    goalExecutionOrchestrator?: GoalExecutionOrchestratorLike,
    cognitiveModelProvider?: CognitiveModelProvider,
    cognitiveOperationalTools?: readonly OperationalToolPolicyEntry[],
  ) {
    this.specializedTool = specializedTool;
    this.modelProvider = modelProvider;
    this.developmentTaskOrchestrator = developmentTaskOrchestrator ?? new DevelopmentTaskOrchestrator(specializedTool);
    this.goalExecutionOrchestrator = goalExecutionOrchestrator ?? new GoalExecutionOrchestrator(specializedTool);
    this.cognitiveModelProvider = cognitiveModelProvider;
    this.cognitiveOperationalOrchestrator = cognitiveModelProvider && cognitiveOperationalTools && cognitiveOperationalTools.length > 0
      ? new CognitiveOperationalOrchestrator(specializedTool, cognitiveModelProvider, cognitiveOperationalTools)
      : undefined;
  }

  public async handoff(input: SpecializedAgentHandoffInput): Promise<SpecializedAgentHandoffResult> {
    this.validateInput(input);

    if (input.commandType === CONVERSE_COMMAND_TYPE && this.modelProvider) {
      return this.handleConversation(input, this.modelProvider);
    }

    return this.handleToolDelegation(input);
  }

  /**
   * Converse responsibilities are resolved entirely through interpretation -
   * there is no external side effect to delegate, so the Tool is
   * deliberately not invoked here (SPEC-037's "at most one invocation when
   * necessary", not "always exactly one").
   */
  private async handleConversation(
    input: SpecializedAgentHandoffInput,
    modelProvider: ModelProvider,
  ): Promise<SpecializedAgentHandoffResult> {
    const text = this.extractConversationText(input);
    const rememberedFacts = this.extractRememberedFacts(input);
    const pendingTasks = this.extractPendingTasks(input);
    const recentExchanges = this.extractRecentExchanges(input);
    const pendingOperations = this.extractPendingOperations(input);
    const cognitiveRecentExchanges = this.selectCognitiveRecentExchanges(text, rememberedFacts, recentExchanges);

    const pendingResponse = this.handlePendingOperationResponse(input, text, pendingOperations);
    if (pendingResponse) return pendingResponse;

    const decision = await modelProvider.interpret({
      text,
      rememberedFacts,
      pendingTasks,
      recentExchanges: cognitiveRecentExchanges,
      requestedAt: input.requestedAt,
    });

    const operationalDecision = await this.applyCognitiveOperationalDecision(
      decision,
      text,
      input.requestedAt,
      input.executionId,
      input.responsibilityId,
      cognitiveRecentExchanges,
    );
    const effectiveDecision = await this.applyCognitiveConversationFallback(
      operationalDecision,
      text,
      input.requestedAt,
      cognitiveRecentExchanges,
    );
    const result = await this.resolveConversationDecision(input, effectiveDecision, rememberedFacts);
    return this.withConversationTurn(result, text, effectiveDecision);
  }

  private async applyCognitiveOperationalDecision(
    decision: ModelInterpretationDecision,
    text: string,
    requestedAt: string,
    executionId: string,
    responsibilityId: string,
    recentExchanges: readonly RecentExchangeRecord[],
  ): Promise<ModelInterpretationDecision> {
    const eligible =
      (decision.intent === 'respond' && decision.cognitiveFallbackEligible === true) ||
      (decision.intent === 'useTool' && decision.cognitiveOperationalEligible === true);
    if (!eligible || !this.cognitiveOperationalOrchestrator) {
      return decision;
    }

    const result = await this.cognitiveOperationalOrchestrator.execute(text, {
      executionId,
      responsibilityId,
      requestedAt,
      relevantMemory: recentExchanges.map((exchange) => ({
        content: `Usuário: ${exchange.requestText}\nSebastian: ${exchange.summary}`.slice(0, 2_000),
      })),
    });
    if (result.outcome === 'answered') {
      return { intent: 'respond', answer: result.answer, recordable: true };
    }
    if (result.outcome === 'proposed') {
      return { intent: 'respond', answer: result.answer, recordable: true, pendingOperation: result.operation };
    }
    return decision;
  }

  private async applyCognitiveConversationFallback(
    decision: ModelInterpretationDecision,
    text: string,
    requestedAt: string,
    recentExchanges: readonly RecentExchangeRecord[],
  ): Promise<ModelInterpretationDecision> {
    if (
      decision.intent !== 'respond' ||
      decision.cognitiveFallbackEligible !== true ||
      typeof this.cognitiveModelProvider?.respond !== 'function'
    ) {
      return decision;
    }

    try {
      const result = await this.cognitiveModelProvider.respond({
        text,
        requestedAt,
        ...(recentExchanges.length === 0
          ? {}
          : {
              recentExchanges: recentExchanges.map((exchange) => ({
                requestText: exchange.requestText,
                summary: exchange.summary,
              })),
            }),
      });
      if (result.outcome !== 'responded' || typeof result.answer !== 'string' || result.answer.trim() === '') {
        return decision;
      }
      return { intent: 'respond', answer: result.answer.trim(), recordable: true };
    } catch {
      return decision;
    }
  }

  private async resolveConversationDecision(
    input: SpecializedAgentHandoffInput,
    decision: ModelInterpretationDecision,
    rememberedFacts: readonly RememberedFactRecord[],
  ): Promise<SpecializedAgentHandoffResult> {
    if (decision.intent === 'useTool') {
      return this.handleToolUse(input, decision);
    }

    if (decision.intent === 'developTask') {
      return this.handleDevelopTask(input, decision);
    }

    if (decision.intent === 'pursueGoal') {
      return this.handlePursueGoal(input, decision, rememberedFacts);
    }

    let finalResult: Readonly<Record<string, unknown>>;
    if (decision.intent === 'remember') {
      finalResult = { memoryRecordKind: MEMORY_FACT_RECORD_KIND, content: decision.content };
    } else if (decision.intent === 'addTask') {
      finalResult = { memoryRecordKind: TASK_CREATED_RECORD_KIND, content: decision.content };
    } else if (decision.intent === 'completeTask') {
      finalResult = { memoryRecordKind: TASK_COMPLETED_RECORD_KIND, taskId: decision.taskId };
    } else {
      finalResult = { message: decision.answer };
    }

    return {
      status: 'completed',
      output: {
        finalResult,
        ...(decision.intent === 'respond' && decision.pendingOperation
          ? { memoryExtras: { operationEvent: decision.pendingOperation } }
          : {}),
      },
    };
  }

  /**
   * Attaches a short, already-bounded record of this turn (the original
   * request text plus a short summary of what happened) as `memoryExtras` -
   * a sibling of `finalResult`, never merged into it. Core's `memoryExtras`
   * seam persists this to Memory (so a later, separate process can hydrate
   * it back as `recentExchanges`) without ever including it in the response
   * shown to the user - the existing `finalResult` shape for every decision
   * kind is completely unaffected. A failed handoff is never persisted by
   * Core in the first place, so it is returned unchanged.
   *
   * Deliberately skipped for `remember`/`addTask`/`completeTask`: those
   * decisions already have their own dedicated, purpose-built memory
   * category (facts/tasks) capturing the same content - recording a second,
   * redundant exchange for them would only duplicate that content and cause
   * it to double-count during relevance selection, not add any real
   * continuity value (there is no natural sense of "continuing" a completed
   * remember/task statement the way there is for a response or an action).
   * Also skipped whenever a `respond` decision explicitly marks itself
   * `recordable: false` - an "I don't know"/"nothing found" answer must
   * never itself become the "recent context" a later continuation mistakes
   * for real information.
   */
  private withConversationTurn(
    result: SpecializedAgentHandoffResult,
    requestText: string,
    decision: ModelInterpretationDecision,
  ): SpecializedAgentHandoffResult {
    if (result.status !== 'completed') {
      return result;
    }

    if (decision.intent === 'remember' || decision.intent === 'addTask' || decision.intent === 'completeTask') {
      return result;
    }

    if (decision.intent === 'respond' && decision.recordable === false) {
      return result;
    }

    const finalResult = result.output.finalResult;
    if (!finalResult || typeof finalResult !== 'object' || Array.isArray(finalResult)) {
      return result;
    }

    const conversationTurn = {
      requestText,
      summary: this.buildConversationTurnSummary(decision, finalResult as Readonly<Record<string, unknown>>),
      kind: decision.intent,
    };

    const existingMemoryExtras = result.output.memoryExtras;
    const safeExisting = existingMemoryExtras && typeof existingMemoryExtras === 'object' && !Array.isArray(existingMemoryExtras)
      ? existingMemoryExtras as Readonly<Record<string, unknown>>
      : {};
    return {
      status: 'completed',
      output: { ...result.output, memoryExtras: { ...safeExisting, conversationTurn } },
    };
  }

  /** Only ever called for `respond`/`useTool`/`developTask` decisions - see withConversationTurn's early return for the other kinds. */
  private buildConversationTurnSummary(
    decision: ModelInterpretationDecision,
    finalResult: Readonly<Record<string, unknown>>,
  ): string {
    if (decision.intent === 'respond') {
      return decision.answer;
    }

    const message = finalResult.message;
    return typeof message === 'string' && message.trim() !== '' ? message : 'ação executada';
  }

  /**
   * The only responsibility branch where the Agent both consults the
   * ModelProvider and invokes the Tool: the decision identifies which Tool
   * to use and with what input, the Agent invokes it and turns its
   * (already user-safe) message into the conversational finalResult. An
   * unexpected Tool failure propagates as a failed handoff, unchanged from
   * the existing pass-through failure semantics.
   */
  private handleToolUse(
    input: SpecializedAgentHandoffInput,
    decision: ModelInterpretationUseToolDecision,
  ): SpecializedAgentHandoffResult {
    const toolResult = this.specializedTool.invoke({
      toolId: decision.toolId,
      executionId: input.executionId,
      responsibilityId: input.responsibilityId,
      requestedAt: input.requestedAt,
      payload: decision.toolInput,
    });

    if (!toolResult || typeof toolResult !== 'object' || Array.isArray(toolResult)) {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized tool invocation returned an invalid output.');
    }

    if (toolResult.status === 'failed') {
      return { status: 'failed', error: toolResult.error };
    }

    if (toolResult.status !== 'completed') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized tool invocation returned an unsupported status.');
    }

    const message = toolResult.output.message;
    if (typeof message !== 'string' || message.trim() === '') {
      throw new InvalidSpecializedAgentHandoffInputError(
        'Specialized tool invocation output must include a non-empty message.',
      );
    }

    return { status: 'completed', output: { finalResult: { message } } };
  }

  /**
   * Runs a bounded, already-structured development task (SPEC-044) end to
   * end within this single handoff - a linear, capped sequence of Tool
   * invocations, never an open-ended or background loop. The orchestrator's
   * own bounded, pre-summarized result becomes the finalResult verbatim, so
   * neither raw stdout/stderr nor a raw diff ever reaches the response or
   * the Memory write-back that reuses the same value.
   */
  private handleDevelopTask(
    input: SpecializedAgentHandoffInput,
    decision: ModelInterpretationDevelopTaskDecision,
  ): SpecializedAgentHandoffResult {
    const result = this.developmentTaskOrchestrator.execute(decision.plan, {
      executionId: input.executionId,
      responsibilityId: input.responsibilityId,
      requestedAt: input.requestedAt,
    });

    return {
      status: 'completed',
      output: { finalResult: { message: result.message, developmentTask: result } },
    };
  }

  /**
   * Runs a bounded, adaptive goal (SPEC-046) end to end within this single
   * handoff - OBJECTIVE → PLAN → ACT → OBSERVE → DECIDE → VERIFY → COMPLETE,
   * entirely inside `GoalExecutionOrchestrator`. As with `developTask`, the
   * orchestrator's own bounded, already-summarized result becomes the
   * finalResult verbatim - no raw stdout/diff, and no unverified "success"
   * (a fix is only ever reported completed once the orchestrator's own
   * verification step confirms it).
   */
  private async handlePursueGoal(
    input: SpecializedAgentHandoffInput,
    decision: ModelInterpretationPursueGoalDecision,
    rememberedFacts: readonly RememberedFactRecord[],
  ): Promise<SpecializedAgentHandoffResult> {
    const context = {
      executionId: input.executionId,
      responsibilityId: input.responsibilityId,
      requestedAt: input.requestedAt,
      relevantMemory: rememberedFacts.map((fact) => ({ content: fact.content })),
    };

    const result =
      typeof this.goalExecutionOrchestrator.executeWithCognition === 'function'
        ? await this.goalExecutionOrchestrator.executeWithCognition(decision.goal, context)
        : this.goalExecutionOrchestrator.execute(decision.goal, context);

    return {
      status: 'completed',
      output: { finalResult: { message: result.message, goalExecution: result } },
    };
  }

  private handleToolDelegation(input: SpecializedAgentHandoffInput): SpecializedAgentHandoffResult {
    const specializedToolContract = this.specializedTool as unknown as { invoke?: unknown };
    if (!specializedToolContract || typeof specializedToolContract.invoke !== 'function') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized tool dependency must provide invoke.');
    }

    const toolResult = this.specializedTool.invoke({
      toolId: `tool.${input.commandType}`,
      executionId: input.executionId,
      responsibilityId: input.responsibilityId,
      requestedAt: input.requestedAt,
      payload: structuredClone(input.payload) as Readonly<Record<string, unknown>>,
    });

    if (!toolResult || typeof toolResult !== 'object' || Array.isArray(toolResult)) {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized tool invocation returned an invalid output.');
    }

    if (toolResult.status === 'failed') {
      return {
        status: 'failed',
        error: toolResult.error,
      };
    }

    if (toolResult.status !== 'completed') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized tool invocation returned an unsupported status.');
    }

    return {
      status: 'completed',
      output: {
        responsibilityId: input.responsibilityId,
        executionId: input.executionId,
        toolId: `tool.${input.commandType}`,
        toolOutput: toolResult.output,
        acknowledgedAt: new Date().toISOString(),
      },
    };
  }

  private extractConversationText(input: SpecializedAgentHandoffInput): string {
    const commandInput = input.payload.commandInput as { readonly input?: Readonly<Record<string, unknown>> } | undefined;
    const text = commandInput?.input?.text;

    if (typeof text !== 'string' || text.trim() === '') {
      throw new InvalidSpecializedAgentHandoffInputError(
        'Converse handoff payload must include a non-empty commandInput.input.text.',
      );
    }

    return text;
  }

  private extractRememberedFacts(input: SpecializedAgentHandoffInput): readonly RememberedFactRecord[] {
    const commandInput = input.payload.commandInput as
      | { readonly temporary?: { readonly values?: { readonly rememberedFacts?: unknown } } }
      | undefined;
    const rememberedFacts = commandInput?.temporary?.values?.rememberedFacts;

    return Array.isArray(rememberedFacts) ? (rememberedFacts as readonly RememberedFactRecord[]) : [];
  }

  private extractPendingTasks(input: SpecializedAgentHandoffInput): readonly PendingTaskRecord[] {
    const commandInput = input.payload.commandInput as
      | { readonly temporary?: { readonly values?: { readonly pendingTasks?: unknown } } }
      | undefined;
    const pendingTasks = commandInput?.temporary?.values?.pendingTasks;

    return Array.isArray(pendingTasks) ? (pendingTasks as readonly PendingTaskRecord[]) : [];
  }

  private extractRecentExchanges(input: SpecializedAgentHandoffInput): readonly RecentExchangeRecord[] {
    const commandInput = input.payload.commandInput as
      | { readonly temporary?: { readonly values?: { readonly recentExchanges?: unknown } } }
      | undefined;
    const recentExchanges = commandInput?.temporary?.values?.recentExchanges;

    return Array.isArray(recentExchanges) ? (recentExchanges as readonly RecentExchangeRecord[]) : [];
  }

  private extractPendingOperations(input: SpecializedAgentHandoffInput): readonly PendingOperationRecord[] {
    const commandInput = input.payload.commandInput as
      | { readonly temporary?: { readonly values?: { readonly pendingOperations?: unknown } } }
      | undefined;
    const pendingOperations = commandInput?.temporary?.values?.pendingOperations;
    return Array.isArray(pendingOperations) ? pendingOperations as readonly PendingOperationRecord[] : [];
  }

  private selectCognitiveRecentExchanges(
    text: string,
    rememberedFacts: readonly RememberedFactRecord[],
    recentExchanges: readonly RecentExchangeRecord[],
  ): readonly RecentExchangeRecord[] {
    if (recentExchanges.length === 0) return [];
    const composed = new ConversationContextComposer().compose({ text, rememberedFacts, recentExchanges });
    if (composed.intent === 'continuationReference' || composed.intent === 'resumptionReference') {
      const selectedIds = new Set([
        ...recentExchanges.slice(-1).map((exchange) => exchange.id),
        ...composed.relevantMemories.filter((match) => match.source === 'exchange').map((match) => match.id),
      ]);
      return recentExchanges.filter((exchange) => selectedIds.has(exchange.id)).slice(-4);
    }
    const relevantIds = new Set(
      composed.relevantMemories
        .filter((match) => match.source === 'exchange' && match.score >= 2)
        .map((match) => match.id),
    );
    return recentExchanges.filter((exchange) => relevantIds.has(exchange.id));
  }

  private handlePendingOperationResponse(
    input: SpecializedAgentHandoffInput,
    text: string,
    pendingOperations: readonly PendingOperationRecord[],
  ): SpecializedAgentHandoffResult | undefined {
    const intent = this.classifyAuthorizationResponse(text);
    if (intent === 'unrelated' || pendingOperations.length === 0) return undefined;
    if (pendingOperations.length !== 1) {
      return this.operationResponse(
        'Há mais de uma proposta pendente; preciso que você indique qual deseja autorizar ou cancelar.',
        undefined,
        text,
      );
    }

    const [operation] = pendingOperations;
    if (!operation) return undefined;
    if (intent === 'ambiguous') {
      return this.operationResponse(
        `Não executei nada. A proposta "${operation.proposedAction}" continua pendente; responda claramente se deseja executá-la ou cancelá-la.`,
        undefined,
        text,
      );
    }
    if (intent === 'deny') {
      return this.operationResponse(
        'Entendido. A proposta foi cancelada e nenhuma alteração foi executada.',
        { ...operation, status: 'cancelled', updatedAt: input.requestedAt },
        text,
      );
    }
    if (!this.cognitiveOperationalOrchestrator) {
      return this.operationResponse('A operação não está disponível neste ambiente e não foi executada.', undefined, text);
    }

    const execution = this.cognitiveOperationalOrchestrator.executeAuthorized(operation, {
      executionId: input.executionId,
      responsibilityId: input.responsibilityId,
      requestedAt: input.requestedAt,
    });
    return this.operationResponse(execution.answer, execution.operation, text);
  }

  private classifyAuthorizationResponse(text: string): 'authorize' | 'deny' | 'ambiguous' | 'unrelated' {
    const normalized = text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const affirmative = new Set(['sim', 'ok', 'pode', 'faca', 'ok faca', 'sim faca', 'pode fazer', 'pode executar']);
    if (affirmative.has(normalized)) return 'authorize';
    if (/^(nao|deixa|deixa pra la|cancela|cancelar)(\b|$)/.test(normalized)) return 'deny';
    if (/^(talvez|quem sabe|nao sei|acho que)(\b|$)/.test(normalized)) return 'ambiguous';
    return 'unrelated';
  }

  private operationResponse(
    message: string,
    operationEvent: PendingOperationRecord | undefined,
    requestText: string,
  ): SpecializedAgentHandoffResult {
    return {
      status: 'completed',
      output: {
        finalResult: { message },
        memoryExtras: {
          ...(operationEvent === undefined ? {} : { operationEvent }),
          conversationTurn: { requestText, summary: message, kind: 'operationAuthorization' },
        },
      },
    };
  }

  private validateInput(input: SpecializedAgentHandoffInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent handoff input must be an object.');
    }

    if (typeof input.responsibilityId !== 'string' || input.responsibilityId.trim() === '') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent responsibilityId must be a non-empty string.');
    }

    if (typeof input.executionId !== 'string' || input.executionId.trim() === '') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent executionId must be a non-empty string.');
    }

    if (typeof input.commandType !== 'string' || input.commandType.trim() === '') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent commandType must be a non-empty string.');
    }

    if (typeof input.requestedAt !== 'string' || input.requestedAt.trim() === '') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent requestedAt must be a non-empty string.');
    }

    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent payload must be an object.');
    }
  }
}
