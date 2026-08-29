import { ContextManager } from '../context/ContextManager.js';
import { type CommandProcessingInput, type CommandProcessingResult } from './CommandTypes.js';
import { InvalidCommandInputError, UnsupportedCommandTypeError } from './CommandErrors.js';

/** The conversation identity every command falls back to when no caller supplies one - the single linear history that predates per-conversation persistence. */
export const DEFAULT_CONVERSATION_ID = 'conversation-1';

export class CommandProcessor {
  constructor(private readonly contextManager: ContextManager = new ContextManager()) {}

  public process(input: CommandProcessingInput): CommandProcessingResult {
    if (!input?.type || typeof input.type !== 'string' || input.type.trim() === '') {
      throw new InvalidCommandInputError('Command type is required.');
    }

    if (!input?.input || typeof input.input !== 'object' || Array.isArray(input.input)) {
      throw new InvalidCommandInputError('Command input must be an object.');
    }

    const supportedTypes = new Set(['greeting', 'remember', 'recall', 'converse']);
    if (!supportedTypes.has(input.type)) {
      throw new UnsupportedCommandTypeError(`Unsupported command type: ${input.type}`);
    }

    const context = this.contextManager.buildSnapshot({
      generatedAt: input.generatedAt,
      conversation: {
        conversationId: input.conversation?.conversationId ?? DEFAULT_CONVERSATION_ID,
        messages: input.conversation?.messages,
        decisions: input.conversation?.decisions,
        pendingTasks: input.conversation?.pendingTasks,
        summary: input.conversation?.summary,
      },
      session: {
        conversationId: input.session?.conversationId ?? DEFAULT_CONVERSATION_ID,
        sessionId: input.session?.sessionId ?? 'session-1',
        messages: input.session?.messages,
        decisions: input.session?.decisions,
        pendingTasks: input.session?.pendingTasks,
        summary: input.session?.summary,
      },
      configuration: input.configuration ? { values: input.configuration.values } : undefined,
      temporary: input.temporary ? { values: input.temporary.values } : undefined,
    });

    const output: Record<string, unknown> = {
      type: input.type,
      context,
      input: structuredClone(input.input),
      generatedAt: input.generatedAt,
    };

    return {
      status: 'succeeded',
      output,
      generatedAt: input.generatedAt,
    };
  }
}
