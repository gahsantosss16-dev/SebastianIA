import {
  InvalidCapabilityInvocationError,
  UnsupportedCapabilityError,
  CapabilityResolutionError,
  CapabilityExecutionError,
} from './CapabilityErrors.js';
import type { CapabilityDescriptor, CapabilityHandler, CapabilityInvocation, CapabilityResult } from './CapabilityTypes.js';

export class CapabilityResolver {
  public constructor(private readonly handlers: ReadonlyMap<string, CapabilityHandler>) {}

  public invoke(invocation: CapabilityInvocation, catalog: readonly CapabilityDescriptor[]): CapabilityResult {
    this.validateInvocation(invocation);
    this.validateCatalog(catalog);

    const descriptor = catalog.find((entry) => entry.id === invocation.capabilityId);
    if (!descriptor) {
      throw new UnsupportedCapabilityError(`Unsupported capability: ${invocation.capabilityId}`);
    }

    const handler = this.handlers.get(descriptor.handlerId);
    if (typeof handler !== 'function') {
      throw new CapabilityResolutionError(`Unable to resolve handler for capability: ${descriptor.id}`);
    }

    try {
      const output = handler(invocation);
      this.validateHandlerOutput(output);
      return {
        status: 'succeeded',
        output: structuredClone(output),
        generatedAt: invocation.generatedAt,
      };
    } catch (error) {
      if (error instanceof CapabilityExecutionError) {
        throw error;
      }
      throw new CapabilityExecutionError('Capability execution failed.', { cause: error });
    }
  }

  private validateInvocation(invocation: CapabilityInvocation): void {
    if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) {
      throw new InvalidCapabilityInvocationError('Capability invocation must be an object.');
    }

    if (typeof invocation.capabilityId !== 'string' || invocation.capabilityId.trim() === '') {
      throw new InvalidCapabilityInvocationError('Capability id is required.');
    }

    if (!invocation.input || typeof invocation.input !== 'object' || Array.isArray(invocation.input)) {
      throw new InvalidCapabilityInvocationError('Capability input must be an object.');
    }

    if (!invocation.context || typeof invocation.context !== 'object' || Array.isArray(invocation.context)) {
      throw new InvalidCapabilityInvocationError('Capability context must be an object.');
    }

    if (typeof invocation.generatedAt !== 'string' || invocation.generatedAt.trim() === '') {
      throw new InvalidCapabilityInvocationError('Capability generatedAt must be a non-empty string.');
    }
  }

  private validateCatalog(catalog: readonly CapabilityDescriptor[]): void {
    if (!Array.isArray(catalog)) {
      throw new InvalidCapabilityInvocationError('Capability catalog must be an array.');
    }

    const seenIds = new Set<string>();
    for (const descriptor of catalog) {
      const isValidDescriptor = descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor);
      if (!isValidDescriptor) {
        throw new InvalidCapabilityInvocationError('Capability descriptor must be an object.');
      }

      if (typeof descriptor.id !== 'string' || descriptor.id.trim() === '') {
        throw new InvalidCapabilityInvocationError('Capability descriptor id is required.');
      }

      if (typeof descriptor.handlerId !== 'string' || descriptor.handlerId.trim() === '') {
        throw new InvalidCapabilityInvocationError('Capability descriptor handlerId is required.');
      }

      if (seenIds.has(descriptor.id)) {
        throw new InvalidCapabilityInvocationError(`Duplicate capability descriptor: ${descriptor.id}`);
      }
      seenIds.add(descriptor.id);
    }
  }

  private validateHandlerOutput(output: unknown): void {
    if (output === null || output === undefined) {
      throw new CapabilityExecutionError('Capability handler returned an invalid output.');
    }

    if (Array.isArray(output) || typeof output !== 'object') {
      throw new CapabilityExecutionError('Capability handler returned an invalid output.');
    }
  }
}
