import { randomUUID } from 'node:crypto';
import type { RecentExchangeRecord } from './FileCommandContextHydrator.js';
import type { AsyncMemoryStore } from './AsyncMemoryStore.js';

export const CONVERSATION_REGISTRY_NAMESPACE = 'conversations';
export const DEFAULT_CONVERSATION_TITLE = 'Nova conversa';
/** Must match `CommandProcessor.DEFAULT_CONVERSATION_ID` / the literal duplicated in `FileCommandContextHydrator`. Named differently here only to avoid an ambiguous `export *` collision with `core/command`'s own export of the same concept. */
export const LEGACY_DEFAULT_CONVERSATION_ID = 'conversation-1';
const MAX_CONVERSATION_TITLE_CHARS = 60;
/** Accepts both the generated `conversation-<uuid>` shape and the pre-existing default id - never anything a client could use to reach another namespace/key. */
const CONVERSATION_ID_PATTERN = /^conversation-[A-Za-z0-9-]{1,64}$/;

export interface ConversationSummaryRecord {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
}

interface ConversationTurnSource {
  listConversationTurns(conversationId: string): Promise<readonly RecentExchangeRecord[]>;
}

/**
 * Validates a conversation id received from a client (a request body field or
 * a route segment) before it is ever used to look anything up. Never derived
 * from user text - only ever compared against ids this registry itself
 * generated (or the one legacy default id), so this is a format check, not an
 * authorization decision.
 */
export function isValidConversationIdFormat(value: unknown): value is string {
  return typeof value === 'string' && CONVERSATION_ID_PATTERN.test(value);
}

/**
 * Derives a short, predictable conversation title from the first useful text
 * a conversation receives - deliberately no model call. Just the first
 * non-empty line, collapsed and truncated.
 */
export function deriveConversationTitle(text: string): string {
  const firstLine = text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  if (collapsed === '') {
    return DEFAULT_CONVERSATION_TITLE;
  }
  return collapsed.length > MAX_CONVERSATION_TITLE_CHARS
    ? `${collapsed.slice(0, MAX_CONVERSATION_TITLE_CHARS - 1)}…`
    : collapsed;
}

/**
 * Small, persistent index of conversations (id/title/createdAt/lastActivityAt)
 * backed by the same `FileMemoryStore` document used for everything else -
 * deliberately not a new file, per SPEC guidance to keep persistence simple
 * and consolidated. The actual turns of each conversation are never stored
 * here; they already live in the `command-results` namespace, scoped by
 * `metadata.conversationId` - this registry is purely the list a sidebar
 * renders and the existence check a conversationId is validated against.
 */
export class ConversationRegistry {
  private readonly store: AsyncMemoryStore;
  private readonly turnSource: ConversationTurnSource;
  private readonly createId: () => string;
  private readonly now: () => string;

  public constructor(
    store: AsyncMemoryStore,
    turnSource: ConversationTurnSource,
    createId: () => string = () => `conversation-${randomUUID()}`,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.store = store;
    this.turnSource = turnSource;
    this.createId = createId;
    this.now = now;
  }

  public async create(): Promise<ConversationSummaryRecord> {
    const at = this.now();
    const record: ConversationSummaryRecord = {
      id: this.createId(),
      title: DEFAULT_CONVERSATION_TITLE,
      createdAt: at,
      lastActivityAt: at,
    };
    await this.store.writeRecord(CONVERSATION_REGISTRY_NAMESPACE, record.id, { ...record });
    return record;
  }

  public async list(): Promise<readonly ConversationSummaryRecord[]> {
    await this.ensureLegacyConversationRegistered();
    return (await this.readAll()).sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
  }

  public async get(id: string): Promise<ConversationSummaryRecord | undefined> {
    if (!isValidConversationIdFormat(id)) {
      return undefined;
    }
    await this.ensureLegacyConversationRegistered();
    return (await this.readAll()).find((conversation) => conversation.id === id);
  }

  public async touch(id: string, at: string = this.now()): Promise<void> {
    const existing = await this.get(id);
    if (!existing) {
      return;
    }
    await this.store.writeRecord(CONVERSATION_REGISTRY_NAMESPACE, id, { ...existing, lastActivityAt: at });
  }

  /** Applies `title` only while the conversation still carries the generic placeholder - never overwrites a title a later feature might let a user set explicitly. */
  public async applyTitleIfPlaceholder(id: string, title: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing || existing.title !== DEFAULT_CONVERSATION_TITLE || title.trim() === '') {
      return;
    }
    await this.store.writeRecord(CONVERSATION_REGISTRY_NAMESPACE, id, { ...existing, title });
  }

  /** The full turn history of one conversation, for a caller (the HTTP layer) reopening it - `undefined` for an id that fails format validation or does not exist. */
  public async listTurns(id: string): Promise<readonly RecentExchangeRecord[] | undefined> {
    if (!(await this.get(id))) {
      return undefined;
    }
    return await this.turnSource.listConversationTurns(id);
  }

  private async readAll(): Promise<ConversationSummaryRecord[]> {
    return (await this.store
      .listRecords(CONVERSATION_REGISTRY_NAMESPACE))
      .map((record) => this.parse(record))
      .filter((record): record is ConversationSummaryRecord => record !== undefined);
  }

  private parse(record: Readonly<Record<string, unknown>>): ConversationSummaryRecord | undefined {
    if (
      typeof record.id !== 'string' || record.id.trim() === '' ||
      typeof record.title !== 'string' || record.title.trim() === '' ||
      typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) ||
      typeof record.lastActivityAt !== 'string' || !Number.isFinite(Date.parse(record.lastActivityAt))
    ) {
      return undefined;
    }
    return { id: record.id, title: record.title, createdAt: record.createdAt, lastActivityAt: record.lastActivityAt };
  }

  /**
   * Idempotent, one-time migration: an installation that only ever had the
   * old linear `recentExchanges` (no conversation registry entries at all for
   * the default id) gets that history surfaced as a real, reopenable
   * conversation instead of silently disappearing from the sidebar. Runs at
   * most once - after the first successful registration the default id is
   * present in the store, so this becomes a no-op read on every later call.
   */
  private async ensureLegacyConversationRegistered(): Promise<void> {
    const alreadyRegistered = (await this.store
      .listRecords(CONVERSATION_REGISTRY_NAMESPACE))
      .some((record) => record.id === LEGACY_DEFAULT_CONVERSATION_ID);
    if (alreadyRegistered) {
      return;
    }

    const legacyTurns = [...await this.turnSource.listConversationTurns(LEGACY_DEFAULT_CONVERSATION_ID)]
      .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
    if (legacyTurns.length === 0) {
      return;
    }

    const first = legacyTurns[0]!;
    const last = legacyTurns[legacyTurns.length - 1]!;
    const record: ConversationSummaryRecord = {
      id: LEGACY_DEFAULT_CONVERSATION_ID,
      title: deriveConversationTitle(first.requestText),
      createdAt: first.recordedAt,
      lastActivityAt: last.recordedAt,
    };
    await this.store.writeRecord(CONVERSATION_REGISTRY_NAMESPACE, record.id, { ...record });
  }
}
