import type {
  SpecializedTool,
  SpecializedToolInvocationInput,
  SpecializedToolInvocationResult,
} from './SpecializedToolInvocationContract.js';
import { InvalidSpecializedToolInvocationInputError } from './SpecializedToolInvocationErrors.js';

export const ONLINE_TOOL_RESTRICTION_MESSAGE =
  'Esta capacidade não está disponível no perfil online.';

/**
 * Fail-closed Tool boundary for the private HTTP composition. It deliberately
 * exposes no filesystem, Git, command, validation or auto-correction adapter:
 * every otherwise valid Tool invocation ends here as a side-effect-free,
 * user-safe rejection.
 */
export class RestrictedOnlineTool implements SpecializedTool {
  public invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
    this.validateInput(input);

    return {
      status: 'completed',
      output: Object.freeze({
        outcome: 'rejected',
        reasonCode: 'onlineProfileRestricted',
        message: ONLINE_TOOL_RESTRICTION_MESSAGE,
      }),
    };
  }

  private validateInput(input: SpecializedToolInvocationInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidSpecializedToolInvocationInputError('Restricted online Tool input must be an object.');
    }

    if (typeof input.toolId !== 'string' || input.toolId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Restricted online Tool toolId must be a non-empty string.',
      );
    }

    if (typeof input.executionId !== 'string' || input.executionId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Restricted online Tool executionId must be a non-empty string.',
      );
    }

    if (typeof input.responsibilityId !== 'string' || input.responsibilityId.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Restricted online Tool responsibilityId must be a non-empty string.',
      );
    }

    if (typeof input.requestedAt !== 'string' || input.requestedAt.trim() === '') {
      throw new InvalidSpecializedToolInvocationInputError(
        'Restricted online Tool requestedAt must be a non-empty string.',
      );
    }

    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      throw new InvalidSpecializedToolInvocationInputError(
        'Restricted online Tool payload must be an object.',
      );
    }
  }
}
