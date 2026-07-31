import type { ContextSnapshot, ConversationContextFragment, SessionContextFragment, ConfigurationContextFragment, TemporaryContextFragment } from '../context/ContextTypes.js';

export type CommandProcessingStatus = 'succeeded';

export interface CommandProcessingInput {
  readonly type: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly generatedAt: string;
  readonly conversation?: ConversationContextFragment | undefined;
  readonly session?: SessionContextFragment | undefined;
  readonly configuration?: ConfigurationContextFragment | undefined;
  readonly temporary?: TemporaryContextFragment | undefined;
}

export interface CommandProcessingResult {
  readonly status: CommandProcessingStatus;
  readonly output: Readonly<Record<string, unknown>>;
  readonly generatedAt: string;
}

export interface CommandProcessingContext extends ContextSnapshot {}
