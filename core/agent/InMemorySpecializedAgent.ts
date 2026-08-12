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
  type RememberedFactRecord,
} from '../memory/index.js';
import type {
  ModelInterpretationDevelopTaskDecision,
  ModelInterpretationUseToolDecision,
  ModelProvider,
} from '../model/ModelProviderContract.js';
import {
  DevelopmentTaskOrchestrator,
  type DevelopmentTaskExecutionContext,
  type DevelopmentTaskPlan,
  type DevelopmentTaskResult,
} from '../development/index.js';

/** Responsibility recognized by this Agent as free-form natural language conversation. */
export const CONVERSE_COMMAND_TYPE = 'converse';

interface DevelopmentTaskOrchestratorLike {
  execute(plan: DevelopmentTaskPlan, context: DevelopmentTaskExecutionContext): DevelopmentTaskResult;
}

export class InMemorySpecializedAgent implements SpecializedAgent {
  private readonly specializedTool: SpecializedTool;
  private readonly modelProvider: ModelProvider | undefined;
  private readonly developmentTaskOrchestrator: DevelopmentTaskOrchestratorLike;

  public constructor(
    specializedTool: SpecializedTool = new InMemorySpecializedTool(),
    modelProvider?: ModelProvider,
    developmentTaskOrchestrator?: DevelopmentTaskOrchestratorLike,
  ) {
    this.specializedTool = specializedTool;
    this.modelProvider = modelProvider;
    this.developmentTaskOrchestrator = developmentTaskOrchestrator ?? new DevelopmentTaskOrchestrator(specializedTool);
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

    const decision = await modelProvider.interpret({
      text,
      rememberedFacts,
      pendingTasks,
      requestedAt: input.requestedAt,
    });

    if (decision.intent === 'useTool') {
      return this.handleToolUse(input, decision);
    }

    if (decision.intent === 'developTask') {
      return this.handleDevelopTask(input, decision);
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
      output: { finalResult },
    };
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
