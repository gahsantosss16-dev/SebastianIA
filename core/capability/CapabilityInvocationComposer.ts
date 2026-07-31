import type { CapabilityInvocation } from './CapabilityTypes.js';
import {
  CapabilityInvocationCompositionError,
  InvalidCapabilityInvocationInputError,
} from './CapabilityInvocationComposerErrors.js';

export interface CapabilityInvocationInput {
  readonly capabilityId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly generatedAt: string;
}

export class CapabilityInvocationComposer {
  public compose(input: CapabilityInvocationInput): CapabilityInvocation {
    this.validateInput(input);

    try {
      return {
        capabilityId: input.capabilityId,
        input: structuredClone(input.input),
        context: structuredClone(input.context),
        generatedAt: input.generatedAt,
      };
    } catch (error) {
      throw new CapabilityInvocationCompositionError('Capability invocation composition failed.', { cause: error });
    }
  }

  private validateInput(input: CapabilityInvocationInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidCapabilityInvocationInputError('Capability invocation input must be an object.');
    }

    if (typeof input.capabilityId !== 'string' || input.capabilityId.trim() === '') {
      throw new InvalidCapabilityInvocationInputError('Capability id must be a non-empty string.');
    }

    if (!input.input || typeof input.input !== 'object' || Array.isArray(input.input)) {
      throw new InvalidCapabilityInvocationInputError('Capability input payload must be an object.');
    }

    if (!input.context || typeof input.context !== 'object' || Array.isArray(input.context)) {
      throw new InvalidCapabilityInvocationInputError('Capability context must be an object.');
    }

    if (typeof input.generatedAt !== 'string' || input.generatedAt.trim() === '') {
      throw new InvalidCapabilityInvocationInputError('Capability generatedAt must be a non-empty string.');
    }
  }
}