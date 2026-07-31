import type { CapabilityDescriptor, CapabilityHandler, CapabilityRegistration } from './CapabilityTypes.js';
import {
  CapabilityAlreadyRegisteredError,
  CapabilityRegistryError,
  InvalidCapabilityRegistrationError,
} from './CapabilityRegistryErrors.js';

export interface CapabilityRegistryOptions {
  readonly readOnly?: boolean;
  readonly entries?: readonly CapabilityRegistration[];
}

export class CapabilityRegistry {
  private readonly descriptors = new Map<string, CapabilityDescriptor>();
  private readonly handlers = new Map<string, CapabilityHandler>();
  private readonly readOnly: boolean;

  public constructor(options: CapabilityRegistryOptions = {}) {
    this.readOnly = options.readOnly ?? false;

    for (const entry of options.entries ?? []) {
      this.registerInternal(entry.descriptor, entry.handler);
    }
  }

  public register(descriptor: CapabilityDescriptor, handler: CapabilityHandler): void {
    if (this.readOnly) {
      throw new CapabilityRegistryError('Capability registry is read-only after core initialization.');
    }

    this.registerInternal(descriptor, handler);
  }

  public getDescriptor(capabilityId: string): CapabilityDescriptor | undefined {
    this.validateCapabilityId(capabilityId);

    const descriptor = this.descriptors.get(capabilityId);
    if (!descriptor) {
      return undefined;
    }

    return this.cloneDescriptor(descriptor);
  }

  public getHandler(capabilityId: string): CapabilityHandler | undefined {
    this.validateCapabilityId(capabilityId);
    return this.handlers.get(capabilityId);
  }

  public has(capabilityId: string): boolean {
    this.validateCapabilityId(capabilityId);
    return this.descriptors.has(capabilityId);
  }

  public listDescriptors(): readonly CapabilityDescriptor[] {
    return this.exportDescriptors();
  }

  public exportCatalog(): readonly CapabilityDescriptor[] {
    return this.exportDescriptors();
  }

  private registerInternal(descriptor: CapabilityDescriptor, handler: CapabilityHandler): void {
    this.validateDescriptor(descriptor);
    this.validateHandler(handler);

    if (this.descriptors.has(descriptor.id)) {
      throw new CapabilityAlreadyRegisteredError(`Capability already registered: ${descriptor.id}`);
    }

    this.descriptors.set(descriptor.id, this.cloneDescriptor(descriptor));
    this.handlers.set(descriptor.id, handler);
  }

  private validateCapabilityId(capabilityId: string): void {
    if (typeof capabilityId !== 'string' || capabilityId.trim() === '') {
      throw new InvalidCapabilityRegistrationError('Capability id must be a non-empty string.');
    }
  }

  private validateDescriptor(descriptor: CapabilityDescriptor): void {
    const isObject = descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor);
    if (!isObject) {
      throw new InvalidCapabilityRegistrationError('Capability descriptor must be an object.');
    }

    if (typeof descriptor.id !== 'string' || descriptor.id.trim() === '') {
      throw new InvalidCapabilityRegistrationError('Capability descriptor id is required.');
    }

    if (typeof descriptor.name !== 'string' || descriptor.name.trim() === '') {
      throw new InvalidCapabilityRegistrationError('Capability descriptor name is required.');
    }

    if (typeof descriptor.version !== 'string' || descriptor.version.trim() === '') {
      throw new InvalidCapabilityRegistrationError('Capability descriptor version is required.');
    }

    if (typeof descriptor.handlerId !== 'string' || descriptor.handlerId.trim() === '') {
      throw new InvalidCapabilityRegistrationError('Capability descriptor handlerId is required.');
    }

    if (descriptor.id !== descriptor.id.trim()) {
      throw new InvalidCapabilityRegistrationError('Capability descriptor id must not contain leading or trailing spaces.');
    }
  }

  private validateHandler(handler: CapabilityHandler): void {
    if (typeof handler !== 'function') {
      throw new InvalidCapabilityRegistrationError('Capability handler must be a function.');
    }
  }

  private cloneDescriptor(descriptor: CapabilityDescriptor): CapabilityDescriptor {
    return structuredClone(descriptor);
  }

  private exportDescriptors(): readonly CapabilityDescriptor[] {
    return Array.from(this.descriptors.values(), (descriptor) => this.cloneDescriptor(descriptor));
  }
}
