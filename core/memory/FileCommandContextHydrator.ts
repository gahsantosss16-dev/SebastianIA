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

/**
 * Discriminator for a task-creation event. The task's stable identity is the
 * `executionId` of this very write-back record - never its text - so a task
 * can be referenced unambiguously later even if its content is edited or
 * duplicated in spirit by the user.
 */
export const TASK_CREATED_RECORD_KIND = 'sebastian.memory.task.created';

/**
 * Discriminator for a task-completion event. Completion is append-only: it
 * never rewrites or removes the creation record, it only adds a new record
 * referencing the created task's id. Current task state is always derived
 * from the full history, never stored directly.
 */
export const TASK_COMPLETED_RECORD_KIND = 'sebastian.memory.task.completed';

/** A single, individually identifiable remembered fact with its own temporal metadata. */
export interface RememberedFactRecord {
  readonly id: string;
  readonly content: string;
  readonly recordedAt: string;
}

/** A task derived as still pending after replaying the append-only creation/completion history. */
export interface PendingTaskRecord {
  readonly id: string;
  readonly content: string;
  readonly createdAt: string;
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

    const succeededRecords = this.store
      .listRecords(COMMAND_RESULTS_NAMESPACE)
      .filter((record) => record.resultStatus === 'succeeded');

    const facts = this.readRememberedFacts(succeededRecords);
    const pendingTasks = this.readPendingTasks(succeededRecords);

    if (facts.length === 0 && pendingTasks.length === 0) {
      return { status: 'absent' };
    }

    const context: CommandContextHydrationSnapshot = {
      temporary: {
        values: { rememberedFacts: facts, pendingTasks },
      },
    };

    return { status: 'hydrated', context };
  }

  private readRememberedFacts(
    succeededRecords: readonly Readonly<Record<string, unknown>>[],
  ): readonly RememberedFactRecord[] {
    const facts: RememberedFactRecord[] = [];

    for (const record of succeededRecords) {
      const fact = this.extractLegacyRememberFact(record) ?? this.extractMarkedMemoryFact(record);
      if (fact) {
        facts.push(fact);
      }
    }

    return facts.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  }

  /**
   * Replays the append-only task history: every creation record is a
   * candidate, and any completion record referencing a creation's id removes
   * it from the pending set. Nothing is ever mutated or deleted - "pending"
   * is a value derived fresh from the full history on every hydration.
   */
  private readPendingTasks(
    succeededRecords: readonly Readonly<Record<string, unknown>>[],
  ): readonly PendingTaskRecord[] {
    const createdTasksById = new Map<string, PendingTaskRecord>();
    const completedTaskIds = new Set<string>();

    for (const record of succeededRecords) {
      const output = record.output as
        | { readonly memoryRecordKind?: unknown; readonly content?: unknown; readonly taskId?: unknown }
        | undefined;

      if (output?.memoryRecordKind === TASK_CREATED_RECORD_KIND) {
        const task = this.buildTaskRecord(record, typeof output.content === 'string' ? output.content : undefined);
        if (task) {
          createdTasksById.set(task.id, task);
        }
        continue;
      }

      if (output?.memoryRecordKind === TASK_COMPLETED_RECORD_KIND && typeof output.taskId === 'string') {
        completedTaskIds.add(output.taskId);
      }
    }

    const pending = [...createdTasksById.values()].filter((task) => !completedTaskIds.has(task.id));
    return pending.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private buildTaskRecord(
    record: Readonly<Record<string, unknown>>,
    content: string | undefined,
  ): PendingTaskRecord | undefined {
    const executionId = typeof record.executionId === 'string' ? record.executionId : undefined;
    const createdAt = typeof record.resultGeneratedAt === 'string' ? record.resultGeneratedAt : undefined;

    if (!content || !executionId || !createdAt) {
      return undefined;
    }

    return { id: executionId, content, createdAt };
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
