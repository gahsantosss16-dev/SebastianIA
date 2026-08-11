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

/**
 * Explicit, reserved discriminator identifying a write-back output as a
 * memory fact, regardless of which command type produced it. This is the
 * structural marker other command types (e.g. natural-language conversation)
 * must set deliberately to be recognized as memory - recognition never
 * relies on the mere presence of a "fact"-shaped property.
 */
export const MEMORY_FACT_RECORD_KIND = 'sebastian.memory.fact';

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
      if (record.resultStatus !== 'succeeded') {
        continue;
      }

      const fact = this.extractLegacyRememberFact(record) ?? this.extractMarkedMemoryFact(record);
      if (fact) {
        facts.push(fact);
      }
    }

    return facts.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  }

  /**
   * Recognition path preserved byte-for-byte from SPEC-038: a record
   * produced by the `remember` command type with a string `fact` output.
   */
  private extractLegacyRememberFact(record: Readonly<Record<string, unknown>>): RememberedFactRecord | undefined {
    if (record.commandType !== MEMORY_REMEMBER_COMMAND_TYPE) {
      return undefined;
    }

    const output = record.output as { readonly fact?: unknown } | undefined;
    return this.buildFactRecord(record, typeof output?.fact === 'string' ? output.fact : undefined);
  }

  /**
   * Recognition path for any other command type (e.g. natural-language
   * conversation) that deliberately marked its output as a memory fact via
   * the MEMORY_FACT_RECORD_KIND discriminator. A record is never treated as
   * a memory fact just because it happens to carry a similarly named field -
   * the discriminator must match exactly.
   */
  private extractMarkedMemoryFact(record: Readonly<Record<string, unknown>>): RememberedFactRecord | undefined {
    const output = record.output as { readonly memoryRecordKind?: unknown; readonly content?: unknown } | undefined;
    if (output?.memoryRecordKind !== MEMORY_FACT_RECORD_KIND) {
      return undefined;
    }

    return this.buildFactRecord(record, typeof output.content === 'string' ? output.content : undefined);
  }

  private buildFactRecord(
    record: Readonly<Record<string, unknown>>,
    content: string | undefined,
  ): RememberedFactRecord | undefined {
    const executionId = typeof record.executionId === 'string' ? record.executionId : undefined;
    const recordedAt = typeof record.resultGeneratedAt === 'string' ? record.resultGeneratedAt : undefined;

    if (!content || !executionId || !recordedAt) {
      return undefined;
    }

    return { id: executionId, content, recordedAt };
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
