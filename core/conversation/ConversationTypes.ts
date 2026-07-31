export type ConversationStatus = 'active' | 'closed';
export type SessionStatus = 'active' | 'closed';
export type MessageRole = 'user' | 'assistant' | 'system';
export type PendingTaskStatus = 'pending' | 'completed' | 'cancelled';

export interface Conversation {
  readonly id: string;
  readonly title?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: ConversationStatus;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface Session {
  readonly id: string;
  readonly conversationId: string;
  readonly createdAt: string;
  readonly closedAt?: string | undefined;
  readonly status: SessionStatus;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly createdAt: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface Decision {
  readonly id: string;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly kind: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface PendingTask {
  readonly id: string;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly status: PendingTaskStatus;
  readonly createdAt: string;
  readonly completedAt?: string | undefined;
  readonly cancelledAt?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface Summary {
  readonly id: string;
  readonly conversationId: string;
  readonly sessionId: string;
  readonly content: string;
  readonly createdAt: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface ConversationInput {
  readonly title?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface SessionInput {
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface MessageInput {
  readonly role: MessageRole;
  readonly content: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface DecisionInput {
  readonly kind: string;
  readonly summary: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface PendingTaskInput {
  readonly title: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface SummaryInput {
  readonly content: string;
  readonly metadata?: Record<string, unknown> | undefined;
}
