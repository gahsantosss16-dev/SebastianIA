import {
  type SpecializedAgent,
  type SpecializedAgentHandoffInput,
  type SpecializedAgentHandoffResult,
} from './SpecializedAgentHandoffContract.js';
import { InvalidSpecializedAgentHandoffInputError } from './SpecializedAgentHandoffErrors.js';
import { InMemorySpecializedTool } from '../tool/InMemorySpecializedTool.js';
import type { SpecializedTool } from '../tool/SpecializedToolInvocationContract.js';

export class InMemorySpecializedAgent implements SpecializedAgent {
  private readonly specializedTool: SpecializedTool;

  public constructor(specializedTool: SpecializedTool = new InMemorySpecializedTool()) {
    this.specializedTool = specializedTool;
  }

  public handoff(input: SpecializedAgentHandoffInput): SpecializedAgentHandoffResult {
    this.validateInput(input);

    const specializedToolContract = this.specializedTool as unknown as { invoke?: unknown };
    if (!specializedToolContract || typeof specializedToolContract.invoke !== 'function') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized tool dependency must provide invoke.');
    }

    const toolResult = this.specializedTool.invoke({
      toolId: `tool.${input.commandType}`,
      executionId: input.executionId,
      responsibilityId: input.responsibilityId,
      requestedAt: input.requestedAt,
      payload: structuredClone(input.payload) as Readonly<Record<string, unknown>>,
    });

    if (!toolResult || typeof toolResult !== 'object' || Array.isArray(toolResult)) {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized tool invocation returned an invalid output.');
    }

    if (toolResult.status === 'failed') {
      return {
        status: 'failed',
        error: toolResult.error,
      };
    }

    if (toolResult.status !== 'completed') {
      throw new InvalidSpecializedAgentHandoffInputError('Specialized tool invocation returned an unsupported status.');
    }

    return {
      status: 'completed',
      output: {
        responsibilityId: input.responsibilityId,
        executionId: input.executionId,
        toolId: `tool.${input.commandType}`,
        toolOutput: toolResult.output,
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
