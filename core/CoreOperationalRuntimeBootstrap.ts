import {
  composeCorePipelineDependencies,
  type CorePipelineBootstrapInput,
} from './CorePipelineBootstrap.js';
import { createCore, SebastianCore, type CorePipelineDependencies } from './core.js';
import type { CoreConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import {
  CoreRuntimeCompositionError,
  CoreRuntimeCreationError,
  CoreRuntimeInitializationError,
  CoreRuntimeStartError,
  InvalidCoreOperationalRuntimeBootstrapInputError,
} from './CoreOperationalRuntimeBootstrapErrors.js';

export interface CoreOperationalRuntimeBootstrapInput {
  readonly composition: CorePipelineBootstrapInput;
  readonly name?: string;
  readonly config?: Partial<CoreConfig>;
  readonly logger?: Logger;
}

export interface CoreOperationalRuntimeBootstrapFactories {
  readonly composeDependencies?: (input: CorePipelineBootstrapInput) => CorePipelineDependencies;
  readonly createCore?: (
    name: string,
    config: Partial<CoreConfig>,
    logger: Logger,
    dependencies: CorePipelineDependencies,
  ) => SebastianCore;
}

export class CoreOperationalRuntimeBootstrap {
  private readonly composeDependencies: (input: CorePipelineBootstrapInput) => CorePipelineDependencies;
  private readonly coreFactory: NonNullable<CoreOperationalRuntimeBootstrapFactories['createCore']>;

  public constructor(factories: CoreOperationalRuntimeBootstrapFactories = {}) {
    this.composeDependencies = factories.composeDependencies ?? composeCorePipelineDependencies;
    this.coreFactory = factories.createCore ?? createCore;
  }

  public bootstrap(input: CoreOperationalRuntimeBootstrapInput): SebastianCore {
    this.validateInput(input);

    const dependencies = this.compose(input.composition);
    const core = this.create(input, dependencies);
    this.initialize(core);
    this.start(core);
    return core;
  }

  private validateInput(input: CoreOperationalRuntimeBootstrapInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidCoreOperationalRuntimeBootstrapInputError(
        'Core operational runtime bootstrap input must be an object.',
      );
    }

    const composition = input.composition;
    const isCompositionObject = composition && typeof composition === 'object' && !Array.isArray(composition);
    if (!isCompositionObject) {
      throw new InvalidCoreOperationalRuntimeBootstrapInputError(
        'Core operational runtime bootstrap composition input must be an object.',
      );
    }

    if (input.name !== undefined && (typeof input.name !== 'string' || input.name.trim() === '')) {
      throw new InvalidCoreOperationalRuntimeBootstrapInputError(
        'Core operational runtime name must be a non-empty string when provided.',
      );
    }

    if (input.config !== undefined && (!input.config || typeof input.config !== 'object' || Array.isArray(input.config))) {
      throw new InvalidCoreOperationalRuntimeBootstrapInputError(
        'Core operational runtime config must be an object when provided.',
      );
    }

    if (input.logger !== undefined) {
      const logger = input.logger as Partial<Logger>;
      if (
        !logger ||
        typeof logger.debug !== 'function' ||
        typeof logger.info !== 'function' ||
        typeof logger.warn !== 'function' ||
        typeof logger.error !== 'function'
      ) {
        throw new InvalidCoreOperationalRuntimeBootstrapInputError(
          'Core operational runtime logger must implement the Logger contract.',
        );
      }
    }
  }

  private compose(input: CorePipelineBootstrapInput): CorePipelineDependencies {
    try {
      return this.composeDependencies(input);
    } catch (error) {
      throw new CoreRuntimeCompositionError('Core runtime dependency composition failed.', { cause: error });
    }
  }

  private create(
    input: CoreOperationalRuntimeBootstrapInput,
    dependencies: CorePipelineDependencies,
  ): SebastianCore {
    try {
      const core = this.coreFactory(
        input.name ?? 'Sebastian IA',
        input.config ?? {},
        input.logger ?? createLogger(),
        dependencies,
      );

      if (!(core instanceof SebastianCore)) {
        throw new TypeError('Core runtime factory must return a SebastianCore instance.');
      }

      return core;
    } catch (error) {
      throw new CoreRuntimeCreationError('Core runtime creation failed.', { cause: error });
    }
  }

  private initialize(core: SebastianCore): void {
    try {
      core.initialize();
    } catch (error) {
      throw new CoreRuntimeInitializationError('Core runtime initialization failed.', { cause: error });
    }
  }

  private start(core: SebastianCore): void {
    try {
      core.start();
    } catch (error) {
      throw new CoreRuntimeStartError('Core runtime start failed.', { cause: error });
    }
  }
}

export function bootstrapCoreOperationalRuntime(input: CoreOperationalRuntimeBootstrapInput): SebastianCore {
  return new CoreOperationalRuntimeBootstrap().bootstrap(input);
}
