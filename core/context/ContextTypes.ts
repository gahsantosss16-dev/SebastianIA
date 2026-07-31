export interface MessageContextItem {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface DecisionContextItem {
  readonly id: string;
  readonly summary: string;
  readonly createdAt: string;
}

export interface PendingTaskContextItem {
  readonly id: string;
  readonly description: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface SummaryContextItem {
  readonly id: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface ConversationContextFragment {
  readonly conversationId: string;
  readonly messages?: readonly MessageContextItem[] | undefined;
  readonly decisions?: readonly DecisionContextItem[] | undefined;
  readonly pendingTasks?: readonly PendingTaskContextItem[] | undefined;
  readonly summary?: SummaryContextItem | undefined;
}

export interface SessionContextFragment {
  readonly conversationId: string;
  readonly sessionId: string;
  readonly messages?: readonly MessageContextItem[] | undefined;
  readonly decisions?: readonly DecisionContextItem[] | undefined;
  readonly pendingTasks?: readonly PendingTaskContextItem[] | undefined;
  readonly summary?: SummaryContextItem | undefined;
}

export interface ConfigurationContextFragment {
  readonly values: Readonly<Record<string, unknown>>;
}

export interface TemporaryContextFragment {
  readonly values: Readonly<Record<string, unknown>>;
}

export interface ContextBuildInput {
  readonly generatedAt: string;
  readonly conversation: ConversationContextFragment;
  readonly session: SessionContextFragment;
  readonly configuration?: ConfigurationContextFragment | undefined;
  readonly temporary?: TemporaryContextFragment | undefined;
}

export interface ContextSnapshot {
  readonly conversationId: string;
  readonly sessionId: string;
  readonly messages: readonly MessageContextItem[];
  readonly decisions: readonly DecisionContextItem[];
  readonly pendingTasks: readonly PendingTaskContextItem[];
  readonly summary?: SummaryContextItem | undefined;
  readonly configuration?: Readonly<Record<string, unknown>> | undefined;
  readonly temporary?: Readonly<Record<string, unknown>> | undefined;
  readonly generatedAt: string;
}
