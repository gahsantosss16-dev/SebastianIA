import { MemoryManager } from '../memory/MemoryManager.js';
import {
  ConversationNotFoundError,
  ConversationPersistenceError,
  InvalidConversationIdError,
  InvalidSessionIdError,
  PendingTaskNotFoundError,
  SessionNotFoundError,
} from './ConversationErrors.js';
import type {
  Conversation,
  ConversationInput,
  Decision,
  DecisionInput,
  Message,
  MessageInput,
  PendingTask,
  PendingTaskInput,
  Session,
  SessionInput,
  Summary,
  SummaryInput,
} from './ConversationTypes.js';

export class ConversationManager {
  private readonly memory: MemoryManager;

  public constructor(memory: MemoryManager = new MemoryManager()) {
    this.memory = memory;
  }

  public async createConversation(input: ConversationInput = {}): Promise<Conversation> {
    const conversation = this.createConversationRecord(input);
    const namespace = this.getConversationNamespace(conversation.id);

    await this.memory.set(namespace, 'conversation', conversation);
    await this.registerKey(namespace, 'conversation');
    await this.registerConversationId(conversation.id);
    return this.cloneValue(conversation);
  }

  public async getConversation(id: string): Promise<Conversation | undefined> {
    this.assertValidConversationId(id);
    const namespace = this.getConversationNamespace(id);
    const conversation = await this.memory.get<Conversation>(namespace, 'conversation');
    return conversation ? this.cloneValue(conversation) : undefined;
  }

  public async listConversations(): Promise<Conversation[]> {
    const conversationIds = await this.listConversationIds();
    const conversations: Conversation[] = [];

    for (const id of conversationIds) {
      const conversation = await this.getConversation(id);
      if (conversation) {
        conversations.push(this.cloneValue(conversation));
      }
    }

    return conversations.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  public async removeConversation(id: string): Promise<boolean> {
    this.assertValidConversationId(id);
    const namespace = this.getConversationNamespace(id);
    const conversation = await this.memory.get<Conversation>(namespace, 'conversation');

    if (!conversation) {
      return false;
    }

    await this.memory.clearNamespace(namespace);
    await this.unregisterConversationId(id);
    return true;
  }

  public async createSession(conversationId: string, input: SessionInput = {}): Promise<Session> {
    this.assertValidConversationId(conversationId);
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(`Conversation '${conversationId}' was not found`);
    }

    const session = this.createSessionRecord(conversationId, input);
    const namespace = this.getConversationNamespace(conversationId);
    const key = this.getSessionKey(session.id);

    await this.memory.set(namespace, key, session);
    await this.registerKey(namespace, key);
    return this.cloneValue(session);
  }

  public async getSession(conversationId: string, sessionId: string): Promise<Session | undefined> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    const namespace = this.getConversationNamespace(conversationId);
    const session = await this.memory.get<Session>(namespace, this.getSessionKey(sessionId));
    return session ? this.cloneValue(session) : undefined;
  }

  public async closeSession(conversationId: string, sessionId: string): Promise<boolean> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    const namespace = this.getConversationNamespace(conversationId);
    const session = await this.memory.get<Session>(namespace, this.getSessionKey(sessionId));

    if (!session) {
      return false;
    }

    const closedSession: Session = {
      ...session,
      status: 'closed',
      closedAt: new Date().toISOString(),
    };

    await this.memory.set(namespace, this.getSessionKey(sessionId), closedSession);
    return true;
  }

  public async appendMessage(conversationId: string, sessionId: string, input: MessageInput): Promise<Message> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    this.assertMessageInput(input);

    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(`Conversation '${conversationId}' was not found`);
    }

    const session = await this.getSession(conversationId, sessionId);
    if (!session) {
      throw new SessionNotFoundError(`Session '${sessionId}' was not found`);
    }

    const message = this.createMessageRecord(conversationId, sessionId, input);
    const namespace = this.getConversationNamespace(conversationId);
    const key = this.getMessageKey(message.id);

    await this.memory.set(namespace, key, message);
    await this.registerKey(namespace, key);
    return this.cloneValue(message);
  }

  public async getMessages(conversationId: string, sessionId: string): Promise<Message[]> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    const namespace = this.getConversationNamespace(conversationId);
    const keys = await this.listMemoryKeys(namespace);
    const messages: Message[] = [];

    for (const key of keys) {
      if (!key.startsWith('message:')) {
        continue;
      }

      const message = await this.memory.get<Message>(namespace, key);
      if (message && message.sessionId === sessionId) {
        messages.push(this.cloneValue(message));
      }
    }

    return messages.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  public async getLastMessages(conversationId: string, sessionId: string, limit = 10): Promise<Message[]> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    const messages = await this.getMessages(conversationId, sessionId);
    return messages.slice(-Math.max(1, limit));
  }

  public async clearMessages(conversationId: string, sessionId: string): Promise<boolean> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    const namespace = this.getConversationNamespace(conversationId);
    const keys = await this.listMemoryKeys(namespace);

    let changed = false;
    for (const key of keys) {
      if (key.startsWith('message:')) {
        const message = await this.memory.get<Message>(namespace, key);
        if (message && message.sessionId === sessionId) {
          await this.memory.remove(namespace, key);
          await this.unregisterKey(namespace, key);
          changed = true;
        }
      }
    }

    return changed;
  }

  public async recordDecision(conversationId: string, sessionId: string, input: DecisionInput): Promise<Decision> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    this.assertDecisionInput(input);

    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(`Conversation '${conversationId}' was not found`);
    }

    const session = await this.getSession(conversationId, sessionId);
    if (!session) {
      throw new SessionNotFoundError(`Session '${sessionId}' was not found`);
    }

    const decision = this.createDecisionRecord(conversationId, sessionId, input);
    const namespace = this.getConversationNamespace(conversationId);
    const key = this.getDecisionKey(decision.id);

    await this.memory.set(namespace, key, decision);
    await this.registerKey(namespace, key);
    return this.cloneValue(decision);
  }

  public async getDecisions(conversationId: string, sessionId: string): Promise<Decision[]> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    const namespace = this.getConversationNamespace(conversationId);
    const keys = await this.listMemoryKeys(namespace);
    const decisions: Decision[] = [];

    for (const key of keys) {
      if (!key.startsWith('decision:')) {
        continue;
      }

      const decision = await this.memory.get<Decision>(namespace, key);
      if (decision && decision.sessionId === sessionId) {
        decisions.push(this.cloneValue(decision));
      }
    }

    return decisions.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  public async addPendingTask(conversationId: string, sessionId: string, input: PendingTaskInput): Promise<PendingTask> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    this.assertPendingTaskInput(input);

    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(`Conversation '${conversationId}' was not found`);
    }

    const session = await this.getSession(conversationId, sessionId);
    if (!session) {
      throw new SessionNotFoundError(`Session '${sessionId}' was not found`);
    }

    const task = this.createPendingTaskRecord(conversationId, sessionId, input);
    const namespace = this.getConversationNamespace(conversationId);
    const key = this.getPendingTaskKey(task.id);

    await this.memory.set(namespace, key, task);
    await this.registerKey(namespace, key);
    return this.cloneValue(task);
  }

  public async completePendingTask(conversationId: string, sessionId: string, taskId: string): Promise<boolean> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    this.assertValidTaskId(taskId);
    const namespace = this.getConversationNamespace(conversationId);
    const key = this.getPendingTaskKey(taskId);
    const task = await this.memory.get<PendingTask>(namespace, key);

    if (!task || task.sessionId !== sessionId) {
      throw new PendingTaskNotFoundError(`Pending task '${taskId}' was not found`);
    }

    const completedTask: PendingTask = {
      ...task,
      status: 'completed',
      completedAt: new Date().toISOString(),
    };

    await this.memory.set(namespace, key, completedTask);
    await this.registerKey(namespace, key);
    return true;
  }

  public async cancelPendingTask(conversationId: string, sessionId: string, taskId: string): Promise<boolean> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    this.assertValidTaskId(taskId);
    const namespace = this.getConversationNamespace(conversationId);
    const key = this.getPendingTaskKey(taskId);
    const task = await this.memory.get<PendingTask>(namespace, key);

    if (!task || task.sessionId !== sessionId) {
      throw new PendingTaskNotFoundError(`Pending task '${taskId}' was not found`);
    }

    const cancelledTask: PendingTask = {
      ...task,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
    };

    await this.memory.set(namespace, key, cancelledTask);
    await this.registerKey(namespace, key);
    return true;
  }

  public async getPendingTasks(conversationId: string, sessionId: string): Promise<PendingTask[]> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    const namespace = this.getConversationNamespace(conversationId);
    const keys = await this.listMemoryKeys(namespace);
    const tasks: PendingTask[] = [];

    for (const key of keys) {
      if (!key.startsWith('pending-task:')) {
        continue;
      }

      const task = await this.memory.get<PendingTask>(namespace, key);
      if (task && task.sessionId === sessionId && task.status === 'pending') {
        tasks.push(this.cloneValue(task));
      }
    }

    return tasks.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  public async saveSummary(conversationId: string, sessionId: string, input: SummaryInput): Promise<Summary> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    this.assertSummaryInput(input);

    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(`Conversation '${conversationId}' was not found`);
    }

    const session = await this.getSession(conversationId, sessionId);
    if (!session) {
      throw new SessionNotFoundError(`Session '${sessionId}' was not found`);
    }

    const summary = this.createSummaryRecord(conversationId, sessionId, input);
    const namespace = this.getConversationNamespace(conversationId);
    const key = this.getSummaryKey(summary.id);

    await this.memory.set(namespace, key, summary);
    await this.registerKey(namespace, key);
    return this.cloneValue(summary);
  }

  public async getLatestSummary(conversationId: string, sessionId: string): Promise<Summary | undefined> {
    this.assertValidConversationId(conversationId);
    this.assertValidSessionId(sessionId);
    const namespace = this.getConversationNamespace(conversationId);
    const keys = await this.listMemoryKeys(namespace);
    const summaries: Summary[] = [];

    for (const key of keys) {
      if (!key.startsWith('summary:')) {
        continue;
      }

      const summary = await this.memory.get<Summary>(namespace, key);
      if (summary && summary.sessionId === sessionId) {
        summaries.push(this.cloneValue(summary));
      }
    }

    if (summaries.length === 0) {
      return undefined;
    }

    return summaries.sort((left, right) => left.createdAt.localeCompare(right.createdAt)).at(-1);
  }

  private createConversationRecord(input: ConversationInput): Conversation {
    const now = new Date().toISOString();
    return {
      id: this.createId('conversation'),
      title: input.title,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };
  }

  private createSessionRecord(conversationId: string, input: SessionInput): Session {
    const now = new Date().toISOString();
    return {
      id: this.createId('session'),
      conversationId,
      createdAt: now,
      status: 'active',
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };
  }

  private createMessageRecord(conversationId: string, sessionId: string, input: MessageInput): Message {
    return {
      id: this.createId('message'),
      conversationId,
      sessionId,
      role: input.role,
      content: input.content,
      createdAt: new Date().toISOString(),
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };
  }

  private createDecisionRecord(conversationId: string, sessionId: string, input: DecisionInput): Decision {
    return {
      id: this.createId('decision'),
      conversationId,
      sessionId,
      kind: input.kind,
      summary: input.summary,
      createdAt: new Date().toISOString(),
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };
  }

  private createPendingTaskRecord(conversationId: string, sessionId: string, input: PendingTaskInput): PendingTask {
    return {
      id: this.createId('pending-task'),
      conversationId,
      sessionId,
      title: input.title,
      status: 'pending',
      createdAt: new Date().toISOString(),
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };
  }

  private createSummaryRecord(conversationId: string, sessionId: string, input: SummaryInput): Summary {
    return {
      id: this.createId('summary'),
      conversationId,
      sessionId,
      content: input.content,
      createdAt: new Date().toISOString(),
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };
  }

  private createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private getConversationNamespace(id: string): string {
    return `conversation:${id}`;
  }

  private getSessionKey(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private getMessageKey(messageId: string): string {
    return `message:${messageId}`;
  }

  private getDecisionKey(decisionId: string): string {
    return `decision:${decisionId}`;
  }

  private getPendingTaskKey(taskId: string): string {
    return `pending-task:${taskId}`;
  }

  private getSummaryKey(summaryId: string): string {
    return `summary:${summaryId}`;
  }

  private assertValidConversationId(id: string): void {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new InvalidConversationIdError('Conversation id must be a non-empty string');
    }
  }

  private assertValidSessionId(id: string): void {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new InvalidSessionIdError('Session id must be a non-empty string');
    }
  }

  private assertValidTaskId(id: string): void {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new PendingTaskNotFoundError('Pending task id must be a non-empty string');
    }
  }

  private assertMessageInput(input: MessageInput): void {
    if (typeof input.content !== 'string' || input.content.trim() === '') {
      throw new ConversationPersistenceError('Message content must be a non-empty string');
    }
  }

  private assertDecisionInput(input: DecisionInput): void {
    if (typeof input.kind !== 'string' || input.kind.trim() === '') {
      throw new ConversationPersistenceError('Decision kind must be a non-empty string');
    }
    if (typeof input.summary !== 'string' || input.summary.trim() === '') {
      throw new ConversationPersistenceError('Decision summary must be a non-empty string');
    }
  }

  private assertPendingTaskInput(input: PendingTaskInput): void {
    if (typeof input.title !== 'string' || input.title.trim() === '') {
      throw new ConversationPersistenceError('Pending task title must be a non-empty string');
    }
  }

  private assertSummaryInput(input: SummaryInput): void {
    if (typeof input.content !== 'string' || input.content.trim() === '') {
      throw new ConversationPersistenceError('Summary content must be a non-empty string');
    }
  }

  private async listMemoryKeys(namespace: string): Promise<string[]> {
    const keys = await this.memory.get<string[]>(namespace, '__keys__');
    return keys ?? [];
  }

  private async registerKey(namespace: string, key: string): Promise<void> {
    const keys = await this.listMemoryKeys(namespace);
    if (keys.includes(key)) {
      return;
    }

    const next = [...keys, key];
    await this.memory.set(namespace, '__keys__', next);
  }

  private async unregisterKey(namespace: string, key: string): Promise<void> {
    const keys = await this.listMemoryKeys(namespace);
    const next = keys.filter((existing) => existing !== key);

    if (next.length === 0) {
      await this.memory.remove(namespace, '__keys__');
      return;
    }

    await this.memory.set(namespace, '__keys__', next);
  }

  private async registerConversationId(id: string): Promise<void> {
    const namespace = this.getConversationIndexNamespace();
    const existing = await this.memory.get<string[]>(namespace, 'conversations');
    const ids = existing ?? [];

    if (ids.includes(id)) {
      return;
    }

    await this.memory.set(namespace, 'conversations', [...ids, id]);
  }

  private async unregisterConversationId(id: string): Promise<void> {
    const namespace = this.getConversationIndexNamespace();
    const existing = await this.memory.get<string[]>(namespace, 'conversations');
    if (!existing) {
      return;
    }

    const ids = existing.filter((item) => item !== id);
    if (ids.length === 0) {
      await this.memory.remove(namespace, 'conversations');
      return;
    }

    await this.memory.set(namespace, 'conversations', ids);
  }

  private async listConversationIds(): Promise<string[]> {
    const namespace = this.getConversationIndexNamespace();
    const existing = await this.memory.get<string[]>(namespace, 'conversations');
    return existing ?? [];
  }

  private getConversationIndexNamespace(): string {
    return '__conversation_index__';
  }

  private cloneValue<T>(value: T): T {
    return structuredClone(value) as T;
  }
}
