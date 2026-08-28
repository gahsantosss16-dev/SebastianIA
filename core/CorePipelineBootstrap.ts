import type { CorePipelineDependencies } from './core.js';
import {
  buildRegistry,
  CapabilityExecutionBundleBuilder,
  type CapabilityExecutionBundle,
  type CapabilityProvider,
  type CapabilityRegistry,
  type CommandCapabilityBinding,
  CommandCapabilityBindings,
  CommandCapabilityExecutionCoordinator,
  CommandCapabilityPipelineExecutor,
} from './capability/index.js';
import {
  CorePipelineBootstrapError,
  InvalidCorePipelineBindingsError,
  InvalidCorePipelineBundleError,
  InvalidCorePipelineExecutorError,
  InvalidCorePipelineProvidersError,
} from './CorePipelineBootstrapErrors.js';
import {
  InMemorySpecializedAgent,
  type SpecializedAgent,
} from './agent/index.js';
import {
  InMemorySpecializedTool,
  LocalFilesystemInspectionTool,
  LocalGitInspectionTool,
  LocalAuthorizedCommandTool,
  LocalToolDispatcher,
  type AuthorizedCommandDefinition,
  type SpecializedTool,
} from './tool/index.js';
import {
  FileCommandContextHydrator,
  FileCommandResultMemoryWriter,
  FileMemoryStore,
  InMemoryCommandContextHydrator,
  InMemoryCommandResultMemoryWriter,
  type CommandContextHydrator,
  type CommandResultMemoryWriter,
} from './memory/index.js';
import { DevelopmentModelProvider, type ModelProvider } from './model/index.js';
import { GoalExecutionOrchestrator, MAX_GOAL_EXECUTION_STEPS } from './development/index.js';
import type { CognitiveModelProvider } from './cognition/index.js';

export interface CorePipelineBootstrapInput {
  readonly providers: readonly CapabilityProvider[];
  readonly bindings: readonly CommandCapabilityBinding[];
  /**
   * Absolute path to the local memory file. When provided, the pipeline is
   * composed with disk-persisted memory adapters instead of the in-memory
   * ones, so context and command results survive across separate processes.
   */
  readonly memoryFilePath?: string;
  /**
   * Explicit root directory the filesystem inspection Tool is allowed to
   * read from. Captured by the composing caller (application composition
   * root, or a test), never derived from user text. Defaults to
   * `process.cwd()` when omitted.
   */
  readonly allowedFilesystemRoot?: string;
  /**
   * Pre-authorized commands (e.g. `validation.test`) the workspace's
   * composition chooses to expose. Never derived from user text, and empty
   * by default - a workspace that configures none simply has no runnable
   * validations.
   */
  readonly authorizedCommands?: readonly AuthorizedCommandDefinition[];
  /**
   * Optional cognitive engine (SPEC-048) the goal-execution cycle may
   * consult once the deterministic SPEC-046/047 path has exhausted itself.
   * Undefined by default - the pipeline composes and starts exactly as
   * before, with zero network dependency, when this is omitted.
   */
  readonly cognitiveModelProvider?: CognitiveModelProvider;
  /**
   * Explicit Tool boundary supplied by a composition root. Omitted by the
   * existing local/CLI composition, which preserves the current dispatcher.
   * The online composition uses this seam to install a fail-closed Tool that
   * has no reference to filesystem, Git or command adapters.
   */
  readonly specializedTool?: SpecializedTool;
}

interface CorePipelineExecutorLike {
  execute: CommandCapabilityPipelineExecutor['execute'];
}

export interface CorePipelineBootstrapFactories {
  readonly buildRegistry?: (providers: readonly CapabilityProvider[]) => CapabilityRegistry;
  readonly buildBundle?: (registry: CapabilityRegistry) => CapabilityExecutionBundle;
  readonly buildBindings?: (bindings: readonly CommandCapabilityBinding[]) => CommandCapabilityBindings;
  readonly buildCoordinator?: (bindings: CommandCapabilityBindings) => CommandCapabilityExecutionCoordinator;
  readonly buildExecutor?: (coordinator: CommandCapabilityExecutionCoordinator) => CorePipelineExecutorLike;
  readonly buildCommandContextHydrator?: (memoryFilePath: string | undefined) => CommandContextHydrator;
  readonly buildSpecializedTool?: (
    allowedFilesystemRoot: string,
    authorizedCommands: readonly AuthorizedCommandDefinition[],
  ) => SpecializedTool;
  readonly buildModelProvider?: () => ModelProvider;
  readonly buildGoalExecutionOrchestrator?: (
    tool: SpecializedTool,
    cognitiveModelProvider: CognitiveModelProvider | undefined,
  ) => GoalExecutionOrchestrator;
  readonly buildSpecializedAgent?: (
    tool: SpecializedTool,
    modelProvider: ModelProvider,
    goalExecutionOrchestrator: GoalExecutionOrchestrator,
  ) => SpecializedAgent;
  readonly buildCommandResultMemoryWriter?: (memoryFilePath: string | undefined) => CommandResultMemoryWriter;
}

export class CorePipelineBootstrap {
  private readonly factories: Required<CorePipelineBootstrapFactories>;

  public constructor(factories: CorePipelineBootstrapFactories = {}) {
    this.factories = {
      buildRegistry: factories.buildRegistry ?? buildRegistry,
      buildBundle:
        factories.buildBundle ?? ((registry) => new CapabilityExecutionBundleBuilder().build(registry)),
      buildBindings: factories.buildBindings ?? ((bindings) => new CommandCapabilityBindings(bindings)),
      buildCoordinator:
        factories.buildCoordinator ?? ((bindings) => new CommandCapabilityExecutionCoordinator(bindings)),
      buildExecutor:
        factories.buildExecutor ?? ((coordinator) => new CommandCapabilityPipelineExecutor(coordinator)),
      buildCommandContextHydrator:
        factories.buildCommandContextHydrator ??
        ((memoryFilePath) =>
          memoryFilePath === undefined
            ? new InMemoryCommandContextHydrator()
            : new FileCommandContextHydrator(new FileMemoryStore(memoryFilePath))),
      buildSpecializedTool:
        factories.buildSpecializedTool ??
        ((allowedFilesystemRoot, authorizedCommands) =>
          new LocalToolDispatcher(
            new InMemorySpecializedTool(),
            new LocalFilesystemInspectionTool(allowedFilesystemRoot),
            new LocalGitInspectionTool(allowedFilesystemRoot),
            new LocalAuthorizedCommandTool(allowedFilesystemRoot, authorizedCommands),
          )),
      buildModelProvider:
        factories.buildModelProvider ?? (() => new DevelopmentModelProvider()),
      buildGoalExecutionOrchestrator:
        factories.buildGoalExecutionOrchestrator ??
        ((tool, cognitiveModelProvider) => new GoalExecutionOrchestrator(tool, MAX_GOAL_EXECUTION_STEPS, cognitiveModelProvider)),
      buildSpecializedAgent:
        factories.buildSpecializedAgent ??
        ((tool, modelProvider, goalExecutionOrchestrator) =>
          new InMemorySpecializedAgent(tool, modelProvider, undefined, goalExecutionOrchestrator)),
      buildCommandResultMemoryWriter:
        factories.buildCommandResultMemoryWriter ??
        ((memoryFilePath) =>
          memoryFilePath === undefined
            ? new InMemoryCommandResultMemoryWriter()
            : new FileCommandResultMemoryWriter(new FileMemoryStore(memoryFilePath))),
    };
  }

  public compose(input: CorePipelineBootstrapInput): CorePipelineDependencies {
    this.validateInput(input);

    const registry = this.composeRegistry(input.providers);
    const bundle = this.composeBundle(registry);
    const bindings = this.composeBindings(input.bindings, bundle);
    const coordinator = this.composeCoordinator(bindings);
    const executor = this.composeExecutor(coordinator);
    const commandContextHydrator = this.composeCommandContextHydrator(input.memoryFilePath);
    const specializedTool =
      input.specializedTool ??
      this.composeSpecializedTool(input.allowedFilesystemRoot ?? process.cwd(), input.authorizedCommands ?? []);
    const modelProvider = this.composeModelProvider();
    const goalExecutionOrchestrator = this.composeGoalExecutionOrchestrator(specializedTool, input.cognitiveModelProvider);
    const specializedAgent = this.composeSpecializedAgent(specializedTool, modelProvider, goalExecutionOrchestrator);
    const commandResultMemoryWriter = this.composeCommandResultMemoryWriter(input.memoryFilePath);

    return Object.freeze({
      executor,
      bundle,
      commandContextHydrator,
      specializedAgent,
      commandResultMemoryWriter,
    });
  }

  private validateInput(input: CorePipelineBootstrapInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new CorePipelineBootstrapError('Core pipeline bootstrap input must be an object.');
    }

    if (
      input.memoryFilePath !== undefined &&
      (typeof input.memoryFilePath !== 'string' || input.memoryFilePath.trim() === '')
    ) {
      throw new CorePipelineBootstrapError('Core pipeline memoryFilePath must be a non-empty string when provided.');
    }

    if (
      input.allowedFilesystemRoot !== undefined &&
      (typeof input.allowedFilesystemRoot !== 'string' || input.allowedFilesystemRoot.trim() === '')
    ) {
      throw new CorePipelineBootstrapError(
        'Core pipeline allowedFilesystemRoot must be a non-empty string when provided.',
      );
    }

    if (input.authorizedCommands !== undefined && !Array.isArray(input.authorizedCommands)) {
      throw new CorePipelineBootstrapError('Core pipeline authorizedCommands must be an array when provided.');
    }

    if (input.specializedTool !== undefined && typeof input.specializedTool.invoke !== 'function') {
      throw new CorePipelineBootstrapError('Core pipeline specializedTool must provide invoke when provided.');
    }
  }

  private composeRegistry(providers: readonly CapabilityProvider[]): CapabilityRegistry {
    try {
      return this.factories.buildRegistry(providers);
    } catch (error) {
      throw new InvalidCorePipelineProvidersError('Core pipeline providers are invalid.', { cause: error });
    }
  }

  private composeBundle(registry: CapabilityRegistry): CapabilityExecutionBundle {
    let bundle: CapabilityExecutionBundle;
    try {
      bundle = this.factories.buildBundle(registry);
      this.validateBundle(bundle);
    } catch (error) {
      throw new InvalidCorePipelineBundleError('Core pipeline bundle is invalid.', { cause: error });
    }
    return bundle;
  }

  private composeBindings(
    entries: readonly CommandCapabilityBinding[],
    bundle: CapabilityExecutionBundle,
  ): CommandCapabilityBindings {
    try {
      const bindings = this.factories.buildBindings(entries);
      bindings.validateAgainstCatalog(bundle.catalog);
      return bindings;
    } catch (error) {
      throw new InvalidCorePipelineBindingsError('Core pipeline bindings are invalid.', { cause: error });
    }
  }

  private composeCoordinator(bindings: CommandCapabilityBindings): CommandCapabilityExecutionCoordinator {
    try {
      const coordinator = this.factories.buildCoordinator(bindings);
      if (!coordinator || typeof coordinator.execute !== 'function') {
        throw new TypeError('Core pipeline coordinator must provide execute.');
      }
      return coordinator;
    } catch (error) {
      throw new CorePipelineBootstrapError('Core pipeline coordinator composition failed.', { cause: error });
    }
  }

  private composeExecutor(coordinator: CommandCapabilityExecutionCoordinator): CorePipelineExecutorLike {
    try {
      const executor = this.factories.buildExecutor(coordinator);
      if (!executor || typeof executor.execute !== 'function') {
        throw new TypeError('Core pipeline executor must provide execute.');
      }
      return executor;
    } catch (error) {
      throw new InvalidCorePipelineExecutorError('Core pipeline executor is invalid.', { cause: error });
    }
  }

  private composeCommandContextHydrator(memoryFilePath: string | undefined): CommandContextHydrator {
    try {
      const hydrator = this.factories.buildCommandContextHydrator(memoryFilePath);
      if (!hydrator || typeof hydrator.hydrate !== 'function') {
        throw new TypeError('Core command context hydrator must provide hydrate.');
      }
      return hydrator;
    } catch (error) {
      throw new CorePipelineBootstrapError('Core command context hydrator composition failed.', { cause: error });
    }
  }

  private composeSpecializedTool(
    allowedFilesystemRoot: string,
    authorizedCommands: readonly AuthorizedCommandDefinition[],
  ): SpecializedTool {
    try {
      const specializedTool = this.factories.buildSpecializedTool(allowedFilesystemRoot, authorizedCommands);
      if (!specializedTool || typeof specializedTool.invoke !== 'function') {
        throw new TypeError('Core specialized tool must provide invoke.');
      }
      return specializedTool;
    } catch (error) {
      throw new CorePipelineBootstrapError('Core specialized tool composition failed.', { cause: error });
    }
  }

  private composeModelProvider(): ModelProvider {
    try {
      const modelProvider = this.factories.buildModelProvider();
      if (!modelProvider || typeof modelProvider.interpret !== 'function') {
        throw new TypeError('Core model provider must provide interpret.');
      }
      return modelProvider;
    } catch (error) {
      throw new CorePipelineBootstrapError('Core model provider composition failed.', { cause: error });
    }
  }

  private composeGoalExecutionOrchestrator(
    tool: SpecializedTool,
    cognitiveModelProvider: CognitiveModelProvider | undefined,
  ): GoalExecutionOrchestrator {
    try {
      const goalExecutionOrchestrator = this.factories.buildGoalExecutionOrchestrator(tool, cognitiveModelProvider);
      if (!goalExecutionOrchestrator || typeof goalExecutionOrchestrator.execute !== 'function') {
        throw new TypeError('Core goal execution orchestrator must provide execute.');
      }
      return goalExecutionOrchestrator;
    } catch (error) {
      throw new CorePipelineBootstrapError('Core goal execution orchestrator composition failed.', { cause: error });
    }
  }

  private composeSpecializedAgent(
    tool: SpecializedTool,
    modelProvider: ModelProvider,
    goalExecutionOrchestrator: GoalExecutionOrchestrator,
  ): SpecializedAgent {
    try {
      const specializedAgent = this.factories.buildSpecializedAgent(tool, modelProvider, goalExecutionOrchestrator);
      if (!specializedAgent || typeof specializedAgent.handoff !== 'function') {
        throw new TypeError('Core specialized agent must provide handoff.');
      }
      return specializedAgent;
    } catch (error) {
      throw new CorePipelineBootstrapError('Core specialized agent composition failed.', { cause: error });
    }
  }

  private composeCommandResultMemoryWriter(memoryFilePath: string | undefined): CommandResultMemoryWriter {
    try {
      const writer = this.factories.buildCommandResultMemoryWriter(memoryFilePath);
      if (!writer || typeof writer.write !== 'function') {
        throw new TypeError('Core command result memory writer must provide write.');
      }
      return writer;
    } catch (error) {
      throw new CorePipelineBootstrapError('Core command result memory writer composition failed.', { cause: error });
    }
  }

  private validateBundle(bundle: CapabilityExecutionBundle): void {
    const isObject = bundle && typeof bundle === 'object' && !Array.isArray(bundle);
    if (!isObject || !Array.isArray(bundle.catalog)) {
      throw new TypeError('Core pipeline bundle must provide a catalog array.');
    }

    const handlersById = bundle.handlersById as unknown as { get?: unknown; has?: unknown };
    if (!handlersById || typeof handlersById.get !== 'function' || typeof handlersById.has !== 'function') {
      throw new TypeError('Core pipeline bundle must provide handlersById as a read-only map.');
    }

    for (const descriptor of bundle.catalog) {
      const validDescriptor = descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor);
      if (!validDescriptor || typeof descriptor.id !== 'string' || typeof descriptor.handlerId !== 'string') {
        throw new TypeError('Core pipeline bundle contains an invalid descriptor.');
      }
      if (!handlersById.has(descriptor.handlerId) || typeof handlersById.get(descriptor.handlerId) !== 'function') {
        throw new TypeError(`Core pipeline bundle has no handler for '${descriptor.id}'.`);
      }
    }
  }
}

export function composeCorePipelineDependencies(input: CorePipelineBootstrapInput): CorePipelineDependencies {
  return new CorePipelineBootstrap().compose(input);
}
