import {
  type CommandResultMemoryWriteBackInput,
  type CommandResultMemoryWriteBackResult,
  type CommandResultMemoryWriter,
} from './CommandResultMemoryContract.js';
import {
  CommandResultMemoryWriteBackFailureError,
  InvalidCommandResultMemoryWriteBackInputError,
} from './CommandResultMemoryContractErrors.js';
import { FileMemoryStore } from './FileMemoryStore.js';

export const COMMAND_RESULTS_NAMESPACE = 'command-results';

export class FileCommandResultMemoryWriter implements CommandResultMemoryWriter {
  private readonly store: FileMemoryStore;

  public constructor(store: FileMemoryStore) {
    this.store = store;
  }

  public write(input: CommandResultMemoryWriteBackInput): CommandResultMemoryWriteBackResult {
    this.validateInput(input);

    try {
      const key = `${COMMAND_RESULTS_NAMESPACE}:${input.executionId}`;
      const recordedAt = new Date().toISOString();
      const value: Readonly<Record<string, unknown>> = {
        executionId: input.executionId,
        commandType: input.commandType,
        commandGeneratedAt: input.commandGeneratedAt,
        resultGeneratedAt: input.resultGeneratedAt,
        resultStatus: input.resultStatus,
        output: input.output,
        metadata: input.metadata,
        recordedAt,
      };

      this.store.writeRecord(COMMAND_RESULTS_NAMESPACE, input.executionId, value);

      return { status: 'recorded', key, recordedAt };
    } catch (error) {
      return {
        status: 'failed',
        error: new CommandResultMemoryWriteBackFailureError('Command result memory write-back failed.', {
          cause: error,
        }),
      };
    }
  }

  private validateInput(input: CommandResultMemoryWriteBackInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidCommandResultMemoryWriteBackInputError(
        'Command result memory write-back input must be an object.',
      );
    }

    if (typeof input.executionId !== 'string' || input.executionId.trim() === '') {
      throw new InvalidCommandResultMemoryWriteBackInputError('Command executionId must be a non-empty string.');
    }

    if (typeof input.commandType !== 'string' || input.commandType.trim() === '') {
      throw new InvalidCommandResultMemoryWriteBackInputError('Command type must be a non-empty string.');
    }

    if (typeof input.commandGeneratedAt !== 'string' || input.commandGeneratedAt.trim() === '') {
      throw new InvalidCommandResultMemoryWriteBackInputError('Command generatedAt must be a non-empty string.');
    }

    if (typeof input.resultGeneratedAt !== 'string' || input.resultGeneratedAt.trim() === '') {
      throw new InvalidCommandResultMemoryWriteBackInputError('Result generatedAt must be a non-empty string.');
    }

    if (typeof input.resultStatus !== 'string' || input.resultStatus.trim() === '') {
      throw new InvalidCommandResultMemoryWriteBackInputError('Result status must be a non-empty string.');
    }

    if (!input.output || typeof input.output !== 'object' || Array.isArray(input.output)) {
      throw new InvalidCommandResultMemoryWriteBackInputError('Result output must be an object.');
    }

    if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
      throw new InvalidCommandResultMemoryWriteBackInputError('Result metadata must be an object.');
    }
  }
}
