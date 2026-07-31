import type { CommandProcessingResult } from '../command/CommandTypes.js';
import type { CommandCapabilityExecutionInput } from './CommandCapabilityExecutionCoordinator.js';
import {
  CommandProcessingResultAdapterError,
  InvalidCommandProcessingResultAdapterInputError,
} from './CommandProcessingResultAdapterErrors.js';

export class CommandProcessingResultAdapter {
  public adapt(result: CommandProcessingResult): CommandCapabilityExecutionInput {
    this.validateResult(result);

    try {
      const output = result.output as Readonly<Record<string, unknown>>;

      const commandType = output.type as string;
      const input = output.input as Readonly<Record<string, unknown>>;
      const context = output.context as Readonly<Record<string, unknown>>;

      return {
        commandType,
        input: structuredClone(input),
        context: structuredClone(context),
        generatedAt: result.generatedAt,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new CommandProcessingResultAdapterError('Command processing result adaptation failed.', {
        cause: error,
      });
    }
  }

  private validateResult(result: CommandProcessingResult): void {
    const isObject = result && typeof result === 'object' && !Array.isArray(result);
    if (!isObject) {
      throw new InvalidCommandProcessingResultAdapterInputError('Command processing result must be an object.');
    }

    if (result.status !== 'succeeded') {
      throw new InvalidCommandProcessingResultAdapterInputError(
        'Command processing result status must be succeeded for capability execution adaptation.',
      );
    }

    if (typeof result.generatedAt !== 'string' || result.generatedAt.trim() === '') {
      throw new InvalidCommandProcessingResultAdapterInputError(
        'Command processing result generatedAt must be a non-empty string.',
      );
    }

    const output = result.output;
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      throw new InvalidCommandProcessingResultAdapterInputError('Command processing result output must be an object.');
    }

    const commandType = output.type;
    if (typeof commandType !== 'string' || commandType.trim() === '') {
      throw new InvalidCommandProcessingResultAdapterInputError(
        'Command processing result output.type must be a non-empty string.',
      );
    }

    const input = output.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new InvalidCommandProcessingResultAdapterInputError(
        'Command processing result output.input must be an object.',
      );
    }

    const context = output.context;
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      throw new InvalidCommandProcessingResultAdapterInputError(
        'Command processing result output.context must be an object.',
      );
    }
  }
}

export function createCommandProcessingResultAdapter(): CommandProcessingResultAdapter {
  return new CommandProcessingResultAdapter();
}