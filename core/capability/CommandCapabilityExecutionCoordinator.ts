import { CapabilityExecutionGateway } from './CapabilityExecutionGateway.js';
import type { CapabilityExecutionBundle } from './CapabilityExecutionBundleBuilder.js';
import { CapabilityInvocationComposer } from './CapabilityInvocationComposer.js';
import { CommandCapabilityBindings } from './CommandCapabilityBinding.js';
import type { CapabilityResult } from './CapabilityTypes.js';
import {
  CommandCapabilityExecutionCoordinatorError,
  InvalidCommandCapabilityExecutionInputError,
} from './CommandCapabilityExecutionCoordinatorErrors.js';

export interface CommandCapabilityExecutionInput {
  readonly commandType: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly generatedAt: string;
}

interface CommandCapabilityBindingsLike {
  resolveCapabilityId(commandType: string): string;
}

interface CapabilityInvocationComposerLike {
  compose(input: {
    capabilityId: string;
    input: Readonly<Record<string, unknown>>;
    context: Readonly<Record<string, unknown>>;
    generatedAt: string;
  }): {
    capabilityId: string;
    input: Readonly<Record<string, unknown>>;
    context: Readonly<Record<string, unknown>>;
    generatedAt: string;
  };
}

interface CapabilityExecutionGatewayLike {
  execute(invocation: {
    capabilityId: string;
    input: Readonly<Record<string, unknown>>;
    context: Readonly<Record<string, unknown>>;
    generatedAt: string;
  }, bundle: CapabilityExecutionBundle): CapabilityResult;
}

export class CommandCapabilityExecutionCoordinator {
  public constructor(
    private readonly bindings: CommandCapabilityBindingsLike,
    private readonly invocationComposer: CapabilityInvocationComposerLike = new CapabilityInvocationComposer(),
    private readonly executionGateway: CapabilityExecutionGatewayLike = new CapabilityExecutionGateway(),
  ) {
    if (!bindings || typeof bindings.resolveCapabilityId !== 'function') {
      throw new InvalidCommandCapabilityExecutionInputError(
        'Command capability bindings dependency must provide resolveCapabilityId.',
      );
    }

    if (!invocationComposer || typeof invocationComposer.compose !== 'function') {
      throw new InvalidCommandCapabilityExecutionInputError(
        'Capability invocation composer dependency must provide compose.',
      );
    }

    if (!executionGateway || typeof executionGateway.execute !== 'function') {
      throw new InvalidCommandCapabilityExecutionInputError(
        'Capability execution gateway dependency must provide execute.',
      );
    }
  }

  public execute(input: CommandCapabilityExecutionInput, bundle: CapabilityExecutionBundle): CapabilityResult {
    this.validateInput(input);
    this.validateBundle(bundle);

    try {
      const capabilityId = this.bindings.resolveCapabilityId(input.commandType);

      const invocation = this.invocationComposer.compose({
        capabilityId,
        input: input.input,
        context: input.context,
        generatedAt: input.generatedAt,
      });

      return this.executionGateway.execute(invocation, bundle);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new CommandCapabilityExecutionCoordinatorError('Command capability execution coordination failed.', {
        cause: error,
      });
    }
  }

  private validateInput(input: CommandCapabilityExecutionInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidCommandCapabilityExecutionInputError('Command capability execution input must be an object.');
    }

    if (typeof input.commandType !== 'string' || input.commandType.trim() === '') {
      throw new InvalidCommandCapabilityExecutionInputError('Command type must be a non-empty string.');
    }

    if (!input.input || typeof input.input !== 'object' || Array.isArray(input.input)) {
      throw new InvalidCommandCapabilityExecutionInputError('Command input payload must be an object.');
    }

    if (!input.context || typeof input.context !== 'object' || Array.isArray(input.context)) {
      throw new InvalidCommandCapabilityExecutionInputError('Command execution context must be an object.');
    }

    if (typeof input.generatedAt !== 'string' || input.generatedAt.trim() === '') {
      throw new InvalidCommandCapabilityExecutionInputError('Command generatedAt must be a non-empty string.');
    }
  }

  private validateBundle(bundle: CapabilityExecutionBundle): void {
    const isObject = bundle && typeof bundle === 'object' && !Array.isArray(bundle);
    if (!isObject) {
      throw new InvalidCommandCapabilityExecutionInputError('Capability execution bundle must be an object.');
    }

    if (!Array.isArray(bundle.catalog)) {
      throw new InvalidCommandCapabilityExecutionInputError('Capability execution bundle catalog must be an array.');
    }

    const handlersById = bundle.handlersById as unknown as { get?: unknown; has?: unknown };
    if (!handlersById || typeof handlersById.get !== 'function' || typeof handlersById.has !== 'function') {
      throw new InvalidCommandCapabilityExecutionInputError(
        'Capability execution bundle handlersById must be a read-only map.',
      );
    }
  }
}

export function createCommandCapabilityExecutionCoordinator(
  bindings: CommandCapabilityBindings,
): CommandCapabilityExecutionCoordinator {
  return new CommandCapabilityExecutionCoordinator(bindings);
}