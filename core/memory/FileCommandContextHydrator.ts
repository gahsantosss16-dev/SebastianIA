import {
  type CommandContextHydrationRequest,
  type CommandContextHydrationResult,
  type CommandContextHydrationSnapshot,
  type CommandContextHydrator,
} from './CommandContextHydrationContract.js';
import { InvalidCommandContextHydrationRequestError } from './CommandContextHydrationContractErrors.js';
import { COMMAND_RESULTS_NAMESPACE } from './FileCommandResultMemoryWriter.js';
import { FileMemoryStore } from './FileMemoryStore.js';

/** Command type recorded by the memory capability that persists a fact for later recall. */
export const MEMORY_REMEMBER_COMMAND_TYPE = 'remember';

/** A single, individually identifiable remembered fact with its own temporal metadata. */
export interface RememberedFactRecord {
  readonly id: string;
  readonly content: string;
  readonly recordedAt: string;
}

/**
 * Reconstructs the remembered-facts context by reading the same persisted
 * command-result write-back records produced by FileCommandResultMemoryWriter,
 * so "remember" and "recall" stay wired through the existing SPEC-034/035
 * contracts without introducing a separate memory schema.
 */
export class FileCommandContextHydrator implements CommandContextHydrator {
  private readonly store: FileMemoryStore;

  public constructor(store: FileMemoryStore) {
    this.store = store;
  }

  public hydrate(request: CommandContextHydrationRequest): CommandContextHydrationResult {
    this.validateRequest(request);

    const facts = this.readRememberedFacts();
    if (facts.length === 0) {
      return { status: 'absent' };
    }

    const context: CommandContextHydrationSnapshot = {
      temporary: {
        values: { rememberedFacts: facts },
      },
    };

    return { status: 'hydrated', context };
  }

  private readRememberedFacts(): readonly RememberedFactRecord[] {
    const records = this.store.listRecords(COMMAND_RESULTS_NAMESPACE);
    const facts: RememberedFactRecord[] = [];

    for (const record of records) {
      if (record.commandType !== MEMORY_REMEMBER_COMMAND_TYPE || record.resultStatus !== 'succeeded') {
        continue;
      }

      const output = record.output as { readonly fact?: unknown } | undefined;
      const content = typeof output?.fact === 'string' ? output.fact : undefined;
      const executionId = typeof record.executionId === 'string' ? record.executionId : undefined;
      const recordedAt = typeof record.resultGeneratedAt === 'string' ? record.resultGeneratedAt : undefined;

      if (!content || !executionId || !recordedAt) {
        continue;
      }

      facts.push({ id: executionId, content, recordedAt });
    }

    return facts.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  }

  private validateRequest(request: CommandContextHydrationRequest): void {
    const isObject = request && typeof request === 'object' && !Array.isArray(request);
    if (!isObject) {
      throw new InvalidCommandContextHydrationRequestError('Command context hydration request must be an object.');
    }

    if (typeof request.commandType !== 'string' || request.commandType.trim() === '') {
      throw new InvalidCommandContextHydrationRequestError(
        'Command context hydration commandType must be a non-empty string.',
      );
    }

    if (typeof request.generatedAt !== 'string' || request.generatedAt.trim() === '') {
      throw new InvalidCommandContextHydrationRequestError(
        'Command context hydration generatedAt must be a non-empty string.',
      );
    }
  }
}
