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
  InMemoryCommandContextHydrator,
  InMemoryCommandResultMemoryWriter,
  type CommandContextHydrator,
  type CommandResultMemoryWriter,
} from './memory/index.js';

export interface CorePipelineBootstrapInput {
  readonly providers: readonly CapabilityProvider[];
  readonly bindings: readonly CommandCapabilityBinding[];
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
  readonly buildCommandContextHydrator?: () => CommandContextHydrator;
  readonly buildCommandResultMemoryWriter?: () => CommandResultMemoryWriter;
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
        factories.buildCommandContextHydrator ?? (() => new InMemoryCommandContextHydrator()),
      buildCommandResultMemoryWriter:
        factories.buildCommandResultMemoryWriter ?? (() => new InMemoryCommandResultMemoryWriter()),
    };
  }

  public compose(input: CorePipelineBootstrapInput): CorePipelineDependencies {
    this.validateInput(input);

    const registry = this.composeRegistry(input.providers);
    const bundle = this.composeBundle(registry);
    const bindings = this.composeBindings(input.bindings, bundle);
    const coordinator = this.composeCoordinator(bindings);
    const executor = this.composeExecutor(coordinator);
    const commandContextHydrator = this.composeCommandContextHydrator();
    const commandResultMemoryWriter = this.composeCommandResultMemoryWriter();

    return Object.freeze({ executor, bundle, commandContextHydrator, commandResultMemoryWriter });
  }

  private validateInput(input: CorePipelineBootstrapInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new CorePipelineBootstrapError('Core pipeline bootstrap input must be an object.');
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

  private composeCommandContextHydrator(): CommandContextHydrator {
    try {
      const hydrator = this.factories.buildCommandContextHydrator();
      if (!hydrator || typeof hydrator.hydrate !== 'function') {
        throw new TypeError('Core command context hydrator must provide hydrate.');
      }
      return hydrator;
    } catch (error) {
      throw new CorePipelineBootstrapError('Core command context hydrator composition failed.', { cause: error });
    }
  }

  private composeCommandResultMemoryWriter(): CommandResultMemoryWriter {
    try {
      const writer = this.factories.buildCommandResultMemoryWriter();
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
