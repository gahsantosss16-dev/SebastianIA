import { CapabilityRegistry } from './CapabilityRegistry.js';
import type { CapabilityRegistration } from './CapabilityTypes.js';
import {
  CapabilityProvisioningError,
  DuplicateCapabilityProvisionError,
  InvalidCapabilityProviderError,
  InvalidCapabilityProvisioningError,
} from './CapabilityProvisioningErrors.js';

export interface CapabilityProvider {
  readonly providerId: string;
  listRegistrations(): readonly CapabilityRegistration[];
}

export function buildRegistry(providers: readonly CapabilityProvider[]): CapabilityRegistry {
  if (!Array.isArray(providers)) {
    throw new InvalidCapabilityProviderError('Capability providers must be an array.');
  }

  const entries: CapabilityRegistration[] = [];
  const ownership = new Map<string, string>();

  for (const provider of providers) {
    validateProvider(provider);

    let registrations: readonly CapabilityRegistration[];
    try {
      registrations = provider.listRegistrations();
    } catch (error) {
      throw new InvalidCapabilityProvisioningError(
        `Capability provider failed while listing registrations: ${provider.providerId}`,
        { cause: error },
      );
    }

    if (!Array.isArray(registrations)) {
      throw new InvalidCapabilityProvisioningError(
        `Capability provider must return an array of registrations: ${provider.providerId}`,
      );
    }

    for (const registration of registrations) {
      validateRegistration(registration, provider.providerId);

      const currentOwner = ownership.get(registration.descriptor.id);
      if (currentOwner) {
        throw new DuplicateCapabilityProvisionError(
          `Capability id '${registration.descriptor.id}' is already provided by '${currentOwner}' and cannot be redefined by '${provider.providerId}'.`,
        );
      }

      ownership.set(registration.descriptor.id, provider.providerId);
      entries.push(registration);
    }
  }

  try {
    return new CapabilityRegistry({
      readOnly: true,
      entries,
    });
  } catch (error) {
    if (
      error instanceof InvalidCapabilityProviderError ||
      error instanceof InvalidCapabilityProvisioningError ||
      error instanceof DuplicateCapabilityProvisionError
    ) {
      throw error;
    }

    throw new CapabilityProvisioningError('Capability registry bootstrap failed.', { cause: error });
  }
}

function validateProvider(provider: CapabilityProvider): void {
  const isObject = provider && typeof provider === 'object' && !Array.isArray(provider);
  if (!isObject) {
    throw new InvalidCapabilityProviderError('Capability provider must be an object.');
  }

  if (typeof provider.providerId !== 'string' || provider.providerId.trim() === '') {
    throw new InvalidCapabilityProviderError('Capability provider id must be a non-empty string.');
  }

  if (typeof provider.listRegistrations !== 'function') {
    throw new InvalidCapabilityProviderError('Capability provider must expose listRegistrations().');
  }
}

function validateRegistration(registration: CapabilityRegistration, providerId: string): void {
  const isObject = registration && typeof registration === 'object' && !Array.isArray(registration);
  if (!isObject) {
    throw new InvalidCapabilityProvisioningError(
      `Capability registration must be an object. Provider: ${providerId}`,
    );
  }

  const descriptor = registration.descriptor;
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new InvalidCapabilityProvisioningError(
      `Capability registration descriptor is invalid. Provider: ${providerId}`,
    );
  }

  if (typeof descriptor.id !== 'string' || descriptor.id.trim() === '') {
    throw new InvalidCapabilityProvisioningError(
      `Capability descriptor id is required. Provider: ${providerId}`,
    );
  }

  if (typeof registration.handler !== 'function') {
    throw new InvalidCapabilityProvisioningError(
      `Capability registration handler must be a function. Provider: ${providerId}`,
    );
  }
}