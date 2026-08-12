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

/** How many chronologically-recent exchanges are ever hydrated into context - a small, fixed window, never the full history. */
export const MAX_HYDRATED_RECENT_EXCHANGES = 8;

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
 * A short, already-bounded record of one past conversational turn - the
 * user's original request text plus a short summary of what Sebastian did
 * about it (never the full finalResult, never raw Tool output). This is what
 * lets a later, separate process resolve a short continuation reference
 * ("então continua") against what was actually discussed, without requiring
 * the user to explicitly `recall` anything.
 */
export interface RecentExchangeRecord {
  readonly id: string;
  readonly requestText: string;
  readonly summary: string;
  readonly kind: string;
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

    const succeededRecords = this.store
      .listRecords(COMMAND_RESULTS_NAMESPACE)
      .filter((record) => record.resultStatus === 'succeeded');

    const facts = this.readRememberedFacts(succeededRecords);
    const pendingTasks = this.readPendingTasks(succeededRecords);
    const recentExchanges = this.readRecentExchanges(succeededRecords);

    if (facts.length === 0 && pendingTasks.length === 0 && recentExchanges.length === 0) {
      return { status: 'absent' };
    }

    const context: CommandContextHydrationSnapshot = {
      temporary: {
        values: { rememberedFacts: facts, pendingTasks, recentExchanges },
      },
    };

    return { status: 'hydrated', context };
  }

  /**
   * Every succeeded record whose `output.conversationTurn` has the expected
   * shape becomes a candidate exchange - a record without it (e.g. a rigid
   * `greeting`/`remember`/`recall` command, or any output predating this
   * block) is simply not a conversational turn and is skipped, exactly like
   * the other two record kinds already do. `conversationTurn` reaches the
   * persisted record's `output` via Core's `memoryExtras` seam (a
   * write-back-only sibling of `finalResult`, merged in separately - see
   * `SebastianCore.extractMemoryExtras`/`writeBackCommandResult`), so the
   * value a user actually sees for that command never carries this field.
   * Only the most recent MAX_HYDRATED_RECENT_EXCHANGES are ever hydrated -
   * this is the bound that keeps "recent context" from silently growing into
   * the entire conversation history.
   */
  private readRecentExchanges(
    succeededRecords: readonly Readonly<Record<string, unknown>>[],
  ): readonly RecentExchangeRecord[] {
    const exchanges: RecentExchangeRecord[] = [];

    for (const record of succeededRecords) {
      const exchange = this.extractRecentExchange(record);
      if (exchange) {
        exchanges.push(exchange);
      }
    }

    exchanges.sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
    return exchanges.slice(-MAX_HYDRATED_RECENT_EXCHANGES);
  }

  private extractRecentExchange(record: Readonly<Record<string, unknown>>): RecentExchangeRecord | undefined {
    const output = record.output as { readonly conversationTurn?: unknown } | undefined;
    const turn = output?.conversationTurn as
      | { readonly requestText?: unknown; readonly summary?: unknown; readonly kind?: unknown }
      | undefined;

    if (
      !turn ||
      typeof turn.requestText !== 'string' ||
      typeof turn.summary !== 'string' ||
      typeof turn.kind !== 'string'
    ) {
      return undefined;
    }

    const executionId = typeof record.executionId === 'string' ? record.executionId : undefined;
    const recordedAt = typeof record.resultGeneratedAt === 'string' ? record.resultGeneratedAt : undefined;
    if (!executionId || !recordedAt) {
      return undefined;
    }

    return { id: executionId, requestText: turn.requestText, summary: turn.summary, kind: turn.kind, recordedAt };
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
