import type {
  ConfigurationContextFragment,
  ConversationContextFragment,
  SessionContextFragment,
  TemporaryContextFragment,
} from '../context/ContextTypes.js';

export interface CommandContextHydrationRequest {
  readonly commandType: string;
  readonly generatedAt: string;
  readonly conversationId?: string;
  readonly sessionId?: string;
}

export interface CommandContextHydrationSnapshot {
  readonly conversation?: ConversationContextFragment;
  readonly session?: SessionContextFragment;
  readonly configuration?: ConfigurationContextFragment;
  readonly temporary?: TemporaryContextFragment;
}

export interface CommandContextHydrationSuccess {
  readonly status: 'hydrated';
  readonly context: CommandContextHydrationSnapshot;
}

export interface CommandContextHydrationAbsent {
  readonly status: 'absent';
}

export interface CommandContextHydrationFailure {
  readonly status: 'failed';
  readonly error: Error;
}

export type CommandContextHydrationResult =
  | CommandContextHydrationSuccess
  | CommandContextHydrationAbsent
  | CommandContextHydrationFailure;

export interface CommandContextHydrator {
  hydrate(request: CommandContextHydrationRequest): CommandContextHydrationResult;
}
