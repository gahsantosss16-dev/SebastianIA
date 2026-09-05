import { CoreConfigService, type CoreConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import type { CommandProcessingInput } from './command/CommandTypes.js';
import type { CapabilityExecutionBundle } from './capability/CapabilityExecutionBundleBuilder.js';
import type { CapabilityResult } from './capability/CapabilityTypes.js';
import type { SpecializedAgent } from './agent/SpecializedAgentHandoffContract.js';
import type { CommandContextHydrator } from './memory/CommandContextHydrationContract.js';
import type { CommandResultMemoryWriter } from './memory/CommandResultMemoryContract.js';
import type { CoreContext, CoreLifecycleState, CoreStatus } from './types.js';
import {
  CoreCommandContextHydrationDependencyUnavailableError,
  CoreCommandContextHydrationError,
  CoreCommandOperationalReadinessError,
  CoreCommandResultMemoryDependencyUnavailableError,
  CoreCommandResultMemoryWriteBackError,
  CorePipelineDependencyUnavailableError,
  CorePipelineExecutionError,
  CoreSpecializedAgentDependencyUnavailableError,
  CoreSpecializedAgentFinalResultInvalidError,
  CoreSpecializedAgentHandoffError,
  InvalidCoreCommandInputError,
} from './CorePipelineIntegrationErrors.js';

interface CommandCapabilityPipelineExecutorLike {
  execute(input: CommandProcessingInput, bundle: CapabilityExecutionBundle): CapabilityResult;
}

export interface CorePipelineDependencies {
  readonly executor: CommandCapabilityPipelineExecutorLike;
  readonly bundle: CapabilityExecutionBundle;
  readonly commandContextHydrator: CommandContextHydrator;
  readonly specializedAgent: SpecializedAgent;
  readonly commandResultMemoryWriter: CommandResultMemoryWriter;
}

export class SebastianCore {
  public readonly name: string;
  public readonly createdAt: string;
  public status: CoreStatus;

  private readonly configService: CoreConfigService;
  private readonly logger: Logger;
  private readonly lifecycleState: CoreLifecycleState;
  private readonly pipelineDependencies: CorePipelineDependencies | undefined;

  public constructor(
    name = 'Sebastian IA',
    config: Partial<CoreConfig> = {},
    logger: Logger = createLogger(),
    pipelineDependencies?: CorePipelineDependencies,
  ) {
    this.name = name;
    this.createdAt = new Date().toISOString();
    this.status = 'idle';
    this.configService = new CoreConfigService(config);
    this.logger = logger;
    this.pipelineDependencies = pipelineDependencies;
    this.lifecycleState = {
      initialized: false,
      started: false,
      shutDown: false,
    };
  }

  public initialize(): void {
    this.status = 'initializing';
    this.logger.info('Core initialization started.');
    this.lifecycleState.initialized = true;
    this.status = 'ready';
    this.logger.info('Core initialization completed.');
  }

  public start(): void {
    this.logger.info('Core start requested.');
    this.lifecycleState.started = true;
    this.status = 'ready';
    this.logger.info('Core started.');
  }

  public shutdown(): void {
    this.status = 'shuttingDown';
    this.logger.warn('Core shutdown requested.');
    this.lifecycleState.shutDown = true;
    this.status = 'idle';
    this.logger.info('Core shutdown completed.');
  }

  public getContext(): CoreContext {
    return {
      name: this.name,
      status: this.status,
      createdAt: this.createdAt,
    };
  }

  public getLifecycleState(): CoreLifecycleState {
    return { ...this.lifecycleState };
  }

  public getConfig(): CoreConfig {
    return this.configService.get();
  }

  public async executeCommand(input: CommandProcessingInput): Promise<CapabilityResult> {
    this.validateCommandInput(input);
    this.validateCommandOperationalReadiness();

    const dependencies = this.pipelineDependencies;
    if (!dependencies) {
      throw new CorePipelineDependencyUnavailableError(
        'Core pipeline dependencies are not available for command execution.',
      );
    }

    const executor = dependencies.executor as unknown as { execute?: unknown };
    if (!executor || typeof executor.execute !== 'function') {
      throw new CorePipelineDependencyUnavailableError(
        'Core command pipeline executor dependency must provide execute.',
      );
    }

    const bundle = dependencies.bundle;
    const isBundleObject = bundle && typeof bundle === 'object' && !Array.isArray(bundle);
    if (!isBundleObject) {
      throw new CorePipelineDependencyUnavailableError('Core capability execution bundle dependency must be an object.');
    }

    if (!Array.isArray(bundle.catalog)) {
      throw new CorePipelineDependencyUnavailableError(
        'Core capability execution bundle catalog dependency must be an array.',
      );
    }

    const handlersById = bundle.handlersById as unknown as { get?: unknown; has?: unknown };
    if (!handlersById || typeof handlersById.get !== 'function' || typeof handlersById.has !== 'function') {
      throw new CorePipelineDependencyUnavailableError(
        'Core capability execution bundle handlersById dependency must be a read-only map.',
      );
    }

    try {
      const hydratedInput = this.hydrateCommandInput(input, dependencies.commandContextHydrator);
      const result = dependencies.executor.execute(hydratedInput, bundle);
      const { effectiveResult, memoryExtras } = await this.handoffToSpecializedAgent(
        hydratedInput,
        result,
        dependencies.specializedAgent,
      );
      this.writeBackCommandResult(hydratedInput, effectiveResult, memoryExtras, dependencies.commandResultMemoryWriter);
      return effectiveResult;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new CorePipelineExecutionError('Core command pipeline execution failed.', {
        cause: error,
      });
    }
  }

  private async handoffToSpecializedAgent(
    input: CommandProcessingInput,
    result: CapabilityResult,
    specializedAgent: SpecializedAgent,
  ): Promise<{ readonly effectiveResult: CapabilityResult; readonly memoryExtras: Readonly<Record<string, unknown>> | undefined }> {
    const specializedAgentContract = specializedAgent as unknown as { handoff?: unknown };
    if (!specializedAgentContract || typeof specializedAgentContract.handoff !== 'function') {
      throw new CoreSpecializedAgentDependencyUnavailableError(
        'Core specialized agent dependency must provide handoff.',
      );
    }

    // `structuredClone` cannot clone an `AbortSignal` - it silently replaces
    // it with an inert plain object (no `.aborted`, no `.addEventListener`),
    // which would make every downstream cancellation check and cognitive
    // call believe no signal was ever provided, defeating the HTTP layer's
    // own abort-on-timeout mechanism for every real cognitive request. The
    // signal is excluded from the clone and reattached by reference
    // afterward; every other field still gets the same defensive deep copy.
    const { signal, ...clonableInput } = input;
    const clonedPayload = structuredClone({
      commandInput: clonableInput,
      commandResult: result,
    }) as { commandInput: Record<string, unknown>; commandResult: unknown };
    const handoffPayload = {
      ...clonedPayload,
      commandInput: { ...clonedPayload.commandInput, ...(signal === undefined ? {} : { signal }) },
    } as Readonly<Record<string, unknown>>;

    const handoffResult = await specializedAgent.handoff({
      responsibilityId: `capability.execute.${input.type}`,
      executionId: `${input.type}:${input.generatedAt}`,
      commandType: input.type,
      requestedAt: result.generatedAt,
      payload: handoffPayload,
    });

    if (!handoffResult || typeof handoffResult !== 'object' || Array.isArray(handoffResult)) {
      throw new CoreSpecializedAgentHandoffError('Core specialized agent handoff returned an invalid output.');
    }

    if (handoffResult.status === 'completed') {
      return {
        effectiveResult: this.resolveEffectiveResult(result, handoffResult.output),
        memoryExtras: this.extractMemoryExtras(handoffResult.output),
      };
    }

    if (handoffResult.status === 'failed') {
      throw new CoreSpecializedAgentHandoffError('Core specialized agent handoff failed.', {
        cause: handoffResult.error,
      });
    }

    throw new CoreSpecializedAgentHandoffError('Core specialized agent handoff returned an unsupported status.');
  }

  /**
   * Opt-in seam: when the Agent's handoff output carries a `finalResult`
   * property, it becomes the effective result used for both the response to
   * the caller and the memory write-back. This is generic and structural -
   * Core never inspects the command type to decide whether to apply it, so
   * it works for any future capability, not only `converse`. When
   * `finalResult` is absent, behavior is unchanged: the capability's own
   * result stands, exactly as before this seam existed.
   */
  private resolveEffectiveResult(
    result: CapabilityResult,
    agentOutput: Readonly<Record<string, unknown>>,
  ): CapabilityResult {
    const finalResult = agentOutput.finalResult;
    if (finalResult === undefined) {
      return result;
    }

    const isValidFinalResult = finalResult !== null && typeof finalResult === 'object' && !Array.isArray(finalResult);
    if (!isValidFinalResult) {
      throw new CoreSpecializedAgentFinalResultInvalidError(
        'Core specialized agent finalResult must be a plain object when provided.',
      );
    }

    return { ...result, output: finalResult as Readonly<Record<string, unknown>> };
  }

  /**
   * A second, independent opt-in seam alongside `finalResult`: when present,
   * `memoryExtras` is merged into what gets persisted to Memory but never
   * into the response returned to the caller - the two purposes `finalResult`
   * used to serve together can now be served separately when an Agent needs
   * to persist a little more than it shows the user (e.g. SPEC-045's short
   * conversation-turn record for later continuity). Core still never
   * interprets what `memoryExtras` contains - that remains entirely the
   * Agent's concern. An invalid (non-object) `memoryExtras` is silently
   * ignored rather than rejected, since - unlike `finalResult` - it never
   * reaches the user and is purely an internal plumbing detail.
   */
  private extractMemoryExtras(agentOutput: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
    const memoryExtras = agentOutput.memoryExtras;
    const isValid = memoryExtras !== null && memoryExtras !== undefined && typeof memoryExtras === 'object' && !Array.isArray(memoryExtras);
    return isValid ? (memoryExtras as Readonly<Record<string, unknown>>) : undefined;
  }

  private hydrateCommandInput(
    input: CommandProcessingInput,
    hydrator: CommandContextHydrator,
  ): CommandProcessingInput {
    const hydratorContract = hydrator as unknown as { hydrate?: unknown };
    if (!hydratorContract || typeof hydratorContract.hydrate !== 'function') {
      throw new CoreCommandContextHydrationDependencyUnavailableError(
        'Core command context hydrator dependency must provide hydrate.',
      );
    }

    const hydration = hydrator.hydrate({
      commandType: input.type,
      generatedAt: input.generatedAt,
      ...(input.conversation?.conversationId === undefined
        ? {}
        : { conversationId: input.conversation.conversationId }),
      ...(input.session?.sessionId === undefined ? {} : { sessionId: input.session.sessionId }),
    });

    if (!hydration || typeof hydration !== 'object' || Array.isArray(hydration)) {
      throw new CoreCommandContextHydrationError('Core command context hydration returned an invalid output.');
    }

    if (hydration.status === 'absent') {
      return input;
    }

    if (hydration.status === 'failed') {
      throw new CoreCommandContextHydrationError('Core command context hydration failed.', {
        cause: hydration.error,
      });
    }

    if (hydration.status !== 'hydrated') {
      throw new CoreCommandContextHydrationError('Core command context hydration returned an unsupported status.');
    }

    const hydratedContext = hydration.context;
    if (!hydratedContext || typeof hydratedContext !== 'object' || Array.isArray(hydratedContext)) {
      throw new CoreCommandContextHydrationError('Core command context hydration returned an invalid context snapshot.');
    }

    return {
      ...input,
      ...(input.conversation !== undefined
        ? { conversation: input.conversation }
        : hydratedContext.conversation === undefined
          ? {}
          : { conversation: hydratedContext.conversation }),
      ...(input.session !== undefined
        ? { session: input.session }
        : hydratedContext.session === undefined
          ? {}
          : { session: hydratedContext.session }),
      ...(input.configuration !== undefined
        ? { configuration: input.configuration }
        : hydratedContext.configuration === undefined
          ? {}
          : { configuration: hydratedContext.configuration }),
      ...(input.temporary !== undefined
        ? { temporary: input.temporary }
        : hydratedContext.temporary === undefined
          ? {}
          : { temporary: hydratedContext.temporary }),
    };
  }

  private writeBackCommandResult(
    input: CommandProcessingInput,
    result: CapabilityResult,
    memoryExtras: Readonly<Record<string, unknown>> | undefined,
    writer: CommandResultMemoryWriter,
  ): void {
    const writerContract = writer as unknown as { write?: unknown };
    if (!writerContract || typeof writerContract.write !== 'function') {
      throw new CoreCommandResultMemoryDependencyUnavailableError(
        'Core command result memory writer dependency must provide write.',
      );
    }

    const outcome = writer.write({
      executionId: `${input.type}:${input.generatedAt}`,
      commandType: input.type,
      commandGeneratedAt: input.generatedAt,
      resultGeneratedAt: result.generatedAt,
      resultStatus: result.status,
      output: memoryExtras === undefined ? result.output : { ...result.output, ...memoryExtras },
      metadata: {
        ...(input.conversation?.conversationId === undefined
          ? {}
          : { conversationId: input.conversation.conversationId }),
        ...(input.session?.sessionId === undefined ? {} : { sessionId: input.session.sessionId }),
      },
    });

    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
      throw new CoreCommandResultMemoryWriteBackError('Core command result memory write-back returned an invalid output.');
    }

    if (outcome.status === 'recorded') {
      return;
    }

    if (outcome.status === 'failed') {
      throw new CoreCommandResultMemoryWriteBackError('Core command result memory write-back failed.', {
        cause: outcome.error,
      });
    }

    throw new CoreCommandResultMemoryWriteBackError('Core command result memory write-back returned an unsupported status.');
  }

  private validateCommandOperationalReadiness(): void {
    const isReady =
      this.lifecycleState.initialized &&
      this.lifecycleState.started &&
      !this.lifecycleState.shutDown &&
      this.status === 'ready';

    if (!isReady) {
      throw new CoreCommandOperationalReadinessError(
        'Core must be initialized, started, not shut down, and ready before command execution.',
      );
    }
  }

  private validateCommandInput(input: CommandProcessingInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidCoreCommandInputError('Core command input must be an object.');
    }

    if (typeof input.type !== 'string' || input.type.trim() === '') {
      throw new InvalidCoreCommandInputError('Core command type must be a non-empty string.');
    }

    if (!input.input || typeof input.input !== 'object' || Array.isArray(input.input)) {
      throw new InvalidCoreCommandInputError('Core command input payload must be an object.');
    }

    if (typeof input.generatedAt !== 'string' || input.generatedAt.trim() === '') {
      throw new InvalidCoreCommandInputError('Core command generatedAt must be a non-empty string.');
    }
  }
}

export function createCore(
  name = 'Sebastian IA',
  config: Partial<CoreConfig> = {},
  logger: Logger = createLogger(),
  pipelineDependencies?: CorePipelineDependencies,
): SebastianCore {
  return new SebastianCore(name, config, logger, pipelineDependencies);
}
