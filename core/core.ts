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

  public executeCommand(input: CommandProcessingInput): CapabilityResult {
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
      this.handoffToSpecializedAgent(hydratedInput, result, dependencies.specializedAgent);
      this.writeBackCommandResult(hydratedInput, result, dependencies.commandResultMemoryWriter);
      return result;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new CorePipelineExecutionError('Core command pipeline execution failed.', {
        cause: error,
      });
    }
  }

  private handoffToSpecializedAgent(
    input: CommandProcessingInput,
    result: CapabilityResult,
    specializedAgent: SpecializedAgent,
  ): void {
    const specializedAgentContract = specializedAgent as unknown as { handoff?: unknown };
    if (!specializedAgentContract || typeof specializedAgentContract.handoff !== 'function') {
      throw new CoreSpecializedAgentDependencyUnavailableError(
        'Core specialized agent dependency must provide handoff.',
      );
    }

    const handoffPayload = structuredClone({
      commandInput: input,
      commandResult: result,
    }) as Readonly<Record<string, unknown>>;

    const handoffResult = specializedAgent.handoff({
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
      return;
    }

    if (handoffResult.status === 'failed') {
      throw new CoreSpecializedAgentHandoffError('Core specialized agent handoff failed.', {
        cause: handoffResult.error,
      });
    }

    throw new CoreSpecializedAgentHandoffError('Core specialized agent handoff returned an unsupported status.');
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
      output: result.output,
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
