import { CommandProcessor } from '../command/CommandProcessor.js';
import type { CommandProcessingInput, CommandProcessingResult } from '../command/CommandTypes.js';
import type { CapabilityExecutionBundle } from './CapabilityExecutionBundleBuilder.js';
import {
  type CommandCapabilityExecutionInput,
  CommandCapabilityExecutionCoordinator,
} from './CommandCapabilityExecutionCoordinator.js';
import { CommandProcessingResultAdapter } from './CommandProcessingResultAdapter.js';
import type { CapabilityResult } from './CapabilityTypes.js';
import {
  CommandCapabilityPipelineExecutorError,
  InvalidCommandCapabilityPipelineInputError,
} from './CommandCapabilityPipelineExecutorErrors.js';

interface CommandProcessorLike {
  process(input: CommandProcessingInput): CommandProcessingResult;
}

interface CommandProcessingResultAdapterLike {
  adapt(result: CommandProcessingResult): CommandCapabilityExecutionInput;
}

interface CommandCapabilityExecutionCoordinatorLike {
  execute(input: CommandCapabilityExecutionInput, bundle: CapabilityExecutionBundle): CapabilityResult;
}

export class CommandCapabilityPipelineExecutor {
  public constructor(
    private readonly coordinator: CommandCapabilityExecutionCoordinatorLike,
    private readonly processor: CommandProcessorLike = new CommandProcessor(),
    private readonly resultAdapter: CommandProcessingResultAdapterLike = new CommandProcessingResultAdapter(),
  ) {
    if (!coordinator || typeof coordinator.execute !== 'function') {
      throw new InvalidCommandCapabilityPipelineInputError(
        'Command capability execution coordinator dependency must provide execute.',
      );
    }

    if (!processor || typeof processor.process !== 'function') {
      throw new InvalidCommandCapabilityPipelineInputError(
        'Command processor dependency must provide process.',
      );
    }

    if (!resultAdapter || typeof resultAdapter.adapt !== 'function') {
      throw new InvalidCommandCapabilityPipelineInputError(
        'Command processing result adapter dependency must provide adapt.',
      );
    }
  }

  public execute(input: CommandProcessingInput, bundle: CapabilityExecutionBundle): CapabilityResult {
    this.validateInput(input);
    this.validateBundle(bundle);

    try {
      const processingResult = this.processor.process(input);
      const executionInput = this.resultAdapter.adapt(processingResult);
      return this.coordinator.execute(executionInput, bundle);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new CommandCapabilityPipelineExecutorError('Command capability pipeline execution failed.', {
        cause: error,
      });
    }
  }

  private validateInput(input: CommandProcessingInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidCommandCapabilityPipelineInputError('Command processing input must be an object.');
    }

    if (typeof input.type !== 'string' || input.type.trim() === '') {
      throw new InvalidCommandCapabilityPipelineInputError('Command processing type must be a non-empty string.');
    }

    if (!input.input || typeof input.input !== 'object' || Array.isArray(input.input)) {
      throw new InvalidCommandCapabilityPipelineInputError('Command processing input payload must be an object.');
    }

    if (typeof input.generatedAt !== 'string' || input.generatedAt.trim() === '') {
      throw new InvalidCommandCapabilityPipelineInputError(
        'Command processing generatedAt must be a non-empty string.',
      );
    }
  }

  private validateBundle(bundle: CapabilityExecutionBundle): void {
    const isObject = bundle && typeof bundle === 'object' && !Array.isArray(bundle);
    if (!isObject) {
      throw new InvalidCommandCapabilityPipelineInputError('Capability execution bundle must be an object.');
    }

    if (!Array.isArray(bundle.catalog)) {
      throw new InvalidCommandCapabilityPipelineInputError('Capability execution bundle catalog must be an array.');
    }

    const handlersById = bundle.handlersById as unknown as { get?: unknown; has?: unknown };
    if (!handlersById || typeof handlersById.get !== 'function' || typeof handlersById.has !== 'function') {
      throw new InvalidCommandCapabilityPipelineInputError(
        'Capability execution bundle handlersById must be a read-only map.',
      );
    }
  }
}

export function createCommandCapabilityPipelineExecutor(
  coordinator: CommandCapabilityExecutionCoordinator,
): CommandCapabilityPipelineExecutor {
  return new CommandCapabilityPipelineExecutor(coordinator);
}