import { ContextManager } from '../context/ContextManager.js';
import { type CommandProcessingInput, type CommandProcessingResult } from './CommandTypes.js';
import { InvalidCommandInputError, UnsupportedCommandTypeError } from './CommandErrors.js';

export class CommandProcessor {
  constructor(private readonly contextManager: ContextManager = new ContextManager()) {}

  public process(input: CommandProcessingInput): CommandProcessingResult {
    if (!input?.type || typeof input.type !== 'string' || input.type.trim() === '') {
      throw new InvalidCommandInputError('Command type is required.');
    }

    if (!input?.input || typeof input.input !== 'object' || Array.isArray(input.input)) {
      throw new InvalidCommandInputError('Command input must be an object.');
    }

    const supportedTypes = new Set(['greeting']);
    if (!supportedTypes.has(input.type)) {
      throw new UnsupportedCommandTypeError(`Unsupported command type: ${input.type}`);
    }

    const context = this.contextManager.buildSnapshot({
      generatedAt: input.generatedAt,
      conversation: {
        conversationId: input.conversation?.conversationId ?? 'conversation-1',
        messages: input.conversation?.messages,
        decisions: input.conversation?.decisions,
        pendingTasks: input.conversation?.pendingTasks,
        summary: input.conversation?.summary,
      },
      session: {
        conversationId: input.session?.conversationId ?? 'conversation-1',
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
