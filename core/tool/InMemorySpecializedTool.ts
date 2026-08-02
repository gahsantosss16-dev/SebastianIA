import {
  type SpecializedTool,
  type SpecializedToolInvocationInput,
  type SpecializedToolInvocationResult,
} from './SpecializedToolInvocationContract.js';
import {
  InvalidSpecializedToolInvocationInputError,
  SpecializedToolInvocationFailureError,
} from './SpecializedToolInvocationErrors.js';

export class InMemorySpecializedTool implements SpecializedTool {
  public invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
    this.validateInput(input);

    try {
      const output = structuredClone({
        toolId: input.toolId,
        executionId: input.executionId,
        responsibilityId: input.responsibilityId,
        processedAt: new Date().toISOString(),
        payload: input.payload,
      }) as Readonly<Record<string, unknown>>;

      return {
        status: 'completed',
        output,
      };
    } catch (error) {
      return {
        status: 'failed',
        error: new SpecializedToolInvocationFailureError('Specialized tool invocation failed.', {
          cause: error,
        }),
      };
    }
  }

  private validateInput(input: SpecializedToolInvocationInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool invocation input must be an object.');
    }

    if (typeof input.toolId !== 'string' || input.toolId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool toolId must be a non-empty string.');
    }

    if (typeof input.executionId !== 'string' || input.executionId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool executionId must be a non-empty string.');
    }

    if (typeof input.responsibilityId !== 'string' || input.responsibilityId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Specialized tool responsibilityId must be a non-empty string.',
      );
    }

    if (typeof input.requestedAt !== 'string' || input.requestedAt.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool requestedAt must be a non-empty string.');
    }

    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw new InvalidSpecializedToolInvocationInputError('Specialized tool payload must be an object.');
    }
  }
}
