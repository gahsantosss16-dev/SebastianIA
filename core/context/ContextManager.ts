import {
  InvalidContextConversationIdError,
  InvalidContextInputError,
  InvalidContextSessionIdError,
} from './ContextErrors.js';
import type {
  ConfigurationContextFragment,
  ContextBuildInput,
  ContextSnapshot,
  ConversationContextFragment,
  MessageContextItem,
  PendingTaskContextItem,
  SessionContextFragment,
  SummaryContextItem,
  TemporaryContextFragment,
  DecisionContextItem,
} from './ContextTypes.js';

export class ContextManager {
  public buildSnapshot(input: ContextBuildInput): ContextSnapshot {
    this.assertValidGeneratedAt(input.generatedAt);
    const conversation = this.normalizeConversation(input.conversation);
    const session = this.normalizeSession(input.session);

    this.assertValidConversationId(conversation.conversationId);
    this.assertValidSessionId(session.sessionId);
    this.assertConversationIdsMatch(conversation.conversationId, session.conversationId);

    const messages = this.mergeMessages(conversation.messages, session.messages);
    const decisions = this.mergeDecisions(conversation.decisions, session.decisions);
    const pendingTasks = this.mergePendingTasks(conversation.pendingTasks, session.pendingTasks);
    const summary = this.selectSummary(conversation.summary, session.summary);
    const configuration = this.normalizeConfiguration(input.configuration);
    const temporary = this.normalizeTemporary(input.temporary);

    return Object.freeze({
      conversationId: conversation.conversationId,
      sessionId: session.sessionId,
      messages: Object.freeze([...messages]),
      decisions: Object.freeze([...decisions]),
      pendingTasks: Object.freeze([...pendingTasks]),
      summary: summary ? Object.freeze({ ...summary }) : undefined,
      configuration: configuration ? Object.freeze({ ...configuration }) : undefined,
      temporary: temporary ? Object.freeze({ ...temporary }) : undefined,
      generatedAt: input.generatedAt,
    }) as ContextSnapshot;
  }

  private normalizeConversation(fragment: ConversationContextFragment): ConversationContextFragment {
    return {
      conversationId: fragment.conversationId,
      messages: fragment.messages ? [...fragment.messages] : undefined,
      decisions: fragment.decisions ? [...fragment.decisions] : undefined,
      pendingTasks: fragment.pendingTasks ? [...fragment.pendingTasks] : undefined,
      summary: fragment.summary ? { ...fragment.summary } : undefined,
    };
  }

  private normalizeSession(fragment: SessionContextFragment): SessionContextFragment {
    return {
      conversationId: fragment.conversationId,
      sessionId: fragment.sessionId,
      messages: fragment.messages ? [...fragment.messages] : undefined,
      decisions: fragment.decisions ? [...fragment.decisions] : undefined,
      pendingTasks: fragment.pendingTasks ? [...fragment.pendingTasks] : undefined,
      summary: fragment.summary ? { ...fragment.summary } : undefined,
    };
  }

  private normalizeConfiguration(fragment: ConfigurationContextFragment | undefined): Readonly<Record<string, unknown>> | undefined {
    if (!fragment) {
      return undefined;
    }

    return this.deepFreezeRecord(fragment.values);
  }

  private normalizeTemporary(fragment: TemporaryContextFragment | undefined): Readonly<Record<string, unknown>> | undefined {
    if (!fragment) {
      return undefined;
    }

    return this.deepFreezeRecord(fragment.values);
  }

  private mergeMessages(conversationMessages: readonly MessageContextItem[] | undefined, sessionMessages: readonly MessageContextItem[] | undefined): MessageContextItem[] {
    const merged: MessageContextItem[] = [];

    for (const message of [...(conversationMessages ?? []), ...(sessionMessages ?? [])]) {
      merged.push(Object.freeze({ ...message }));
    }

    return merged;
  }

  private mergeDecisions(conversationDecisions: readonly DecisionContextItem[] | undefined, sessionDecisions: readonly DecisionContextItem[] | undefined): DecisionContextItem[] {
    const merged: DecisionContextItem[] = [];

    for (const decision of [...(conversationDecisions ?? []), ...(sessionDecisions ?? [])]) {
      merged.push(Object.freeze({ ...decision }));
    }

    return merged;
  }

  private mergePendingTasks(conversationTasks: readonly PendingTaskContextItem[] | undefined, sessionTasks: readonly PendingTaskContextItem[] | undefined): PendingTaskContextItem[] {
    const merged: PendingTaskContextItem[] = [];

    for (const task of [...(conversationTasks ?? []), ...(sessionTasks ?? [])]) {
      merged.push(Object.freeze({ ...task }));
    }

    return merged;
  }

  private selectSummary(conversationSummary: SummaryContextItem | undefined, sessionSummary: SummaryContextItem | undefined): SummaryContextItem | undefined {
    return conversationSummary ? Object.freeze({ ...conversationSummary }) : sessionSummary ? Object.freeze({ ...sessionSummary }) : undefined;
  }

  private assertConversationIdsMatch(left: string, right: string): void {
    if (left !== right) {
      throw new InvalidContextInputError('Conversation and session fragments must reference the same conversation id');
    }
  }

  private assertValidConversationId(id: string): void {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new InvalidContextConversationIdError('Conversation id must be a non-empty string');
    }
  }

  private assertValidSessionId(id: string): void {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new InvalidContextSessionIdError('Session id must be a non-empty string');
    }
  }

  private assertValidGeneratedAt(value: string): void {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new InvalidContextInputError('generatedAt must be a non-empty string');
    }
  }

  private deepFreezeRecord<T>(value: Record<string, T>): Readonly<Record<string, T>> {
    const frozenEntries = Object.entries(value).map(([key, entry]) => [key, this.deepFreezeValue(entry)] as const);
    return Object.freeze(Object.fromEntries(frozenEntries)) as Readonly<Record<string, T>>;
  }

  private deepFreezeValue<T>(value: T): T {
    if (Array.isArray(value)) {
      const frozenItems = value.map((item) => this.deepFreezeValue(item));
      return Object.freeze(frozenItems) as T;
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, this.deepFreezeValue(entry)] as const);
      return Object.freeze(Object.fromEntries(entries)) as T;
    }

    return value;
  }
}
