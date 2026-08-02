import {
  type SpecializedAgent,
  type SpecializedAgentHandoffInput,
  type SpecializedAgentHandoffResult,
} from './SpecializedAgentHandoffContract.js';
import { InvalidSpecializedAgentHandoffInputError } from './SpecializedAgentHandoffErrors.js';

export class InMemorySpecializedAgent implements SpecializedAgent {
  public handoff(input: SpecializedAgentHandoffInput): SpecializedAgentHandoffResult {
    this.validateInput(input);

    return {
      status: 'completed',
      output: {
        responsibilityId: input.responsibilityId,
        executionId: input.executionId,
        acknowledgedAt: new Date().toISOString(),
      },
    };
  }

  private validateInput(input: SpecializedAgentHandoffInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent handoff input must be an object.');
    }

    if (typeof input.responsibilityId !== 'string' || input.responsibilityId.trim() === '') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent responsibilityId must be a non-empty string.');
    }

    if (typeof input.executionId !== 'string' || input.executionId.trim() === '') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent executionId must be a non-empty string.');
    }

    if (typeof input.commandType !== 'string' || input.commandType.trim() === '') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent commandType must be a non-empty string.');
    }

    if (typeof input.requestedAt !== 'string' || input.requestedAt.trim() === '') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent requestedAt must be a non-empty string.');
    }

    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized agent payload must be an object.');
    }
  }
}
