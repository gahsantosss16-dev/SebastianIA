import type { CapabilityDescriptor, CapabilityInvocation } from './CapabilityTypes.js';
import {
  CapabilityPreflightError,
  CapabilityPreflightNotReadyError,
  InvalidCapabilityPreflightInputError,
} from './CapabilityExecutionPreflightErrors.js';

export interface CapabilityPreflightResult {
  readonly status: 'ready';
  readonly capabilityId: string;
  readonly descriptor: CapabilityDescriptor;
}

export class CapabilityExecutionPreflightValidator {
  public validate(
    invocation: CapabilityInvocation,
    catalog: readonly CapabilityDescriptor[],
  ): CapabilityPreflightResult {
    this.validateInvocation(invocation);
    const catalogEntries = this.validateCatalog(catalog);

    const descriptor = catalogEntries.get(invocation.capabilityId);
    if (!descriptor) {
      throw new CapabilityPreflightNotReadyError(
        `Capability id '${invocation.capabilityId}' is not available in the catalog.`,
      );
    }

    try {
      return {
        status: 'ready',
        capabilityId: invocation.capabilityId,
        descriptor: structuredClone(descriptor),
      };
    } catch (error) {
      throw new CapabilityPreflightError('Capability preflight result composition failed.', {
        cause: error,
      });
    }
  }

  private validateInvocation(invocation: CapabilityInvocation): void {
    const isObject = invocation && typeof invocation === 'object' && !Array.isArray(invocation);
    if (!isObject) {
      throw new InvalidCapabilityPreflightInputError('Capability invocation must be an object.');
    }

    if (typeof invocation.capabilityId !== 'string' || invocation.capabilityId.trim() === '') {
      throw new InvalidCapabilityPreflightInputError('Capability invocation id is required.');
    }
  }

  private validateCatalog(catalog: readonly CapabilityDescriptor[]): Map<string, CapabilityDescriptor> {
    if (!Array.isArray(catalog)) {
      throw new InvalidCapabilityPreflightInputError('Capability catalog must be an array.');
    }

    const catalogEntries = new Map<string, CapabilityDescriptor>();

    for (const descriptor of catalog) {
      const isObject = descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor);
      if (!isObject) {
        throw new InvalidCapabilityPreflightInputError('Capability descriptor must be an object.');
      }

      if (typeof descriptor.id !== 'string' || descriptor.id.trim() === '') {
        throw new InvalidCapabilityPreflightInputError('Capability descriptor id is required.');
      }

      if (typeof descriptor.handlerId !== 'string' || descriptor.handlerId.trim() === '') {
        throw new InvalidCapabilityPreflightInputError('Capability descriptor handlerId is required.');
      }

      if (catalogEntries.has(descriptor.id)) {
        throw new InvalidCapabilityPreflightInputError(
          `Duplicate capability descriptor in catalog: ${descriptor.id}`,
        );
      }

      catalogEntries.set(descriptor.id, descriptor);
    }

    return catalogEntries;
  }
}