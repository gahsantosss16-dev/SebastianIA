import type { CapabilityDescriptor } from './CapabilityTypes.js';
import {
  CommandCapabilityBindingConsistencyError,
  CommandCapabilityBindingNotFoundError,
  DuplicateCommandCapabilityBindingError,
  InvalidCommandCapabilityBindingError,
} from './CommandCapabilityBindingErrors.js';

export interface CommandCapabilityBinding {
  readonly commandType: string;
  readonly capabilityId: string;
}

export class CommandCapabilityBindings {
  private readonly bindings = new Map<string, string>();

  public constructor(entries: readonly CommandCapabilityBinding[]) {
    if (!Array.isArray(entries)) {
      throw new InvalidCommandCapabilityBindingError('Command capability bindings must be an array.');
    }

    for (const entry of entries) {
      this.validateBinding(entry);

      if (this.bindings.has(entry.commandType)) {
        throw new DuplicateCommandCapabilityBindingError(
          `Command type already bound: ${entry.commandType}`,
        );
      }

      this.bindings.set(entry.commandType, entry.capabilityId);
    }
  }

  public resolveCapabilityId(commandType: string): string {
    this.validateCommandType(commandType);

    const capabilityId = this.bindings.get(commandType);
    if (!capabilityId) {
      throw new CommandCapabilityBindingNotFoundError(
        `No capability binding found for command type: ${commandType}`,
      );
    }

    return capabilityId;
  }

  public has(commandType: string): boolean {
    this.validateCommandType(commandType);
    return this.bindings.has(commandType);
  }

  public listBindings(): readonly CommandCapabilityBinding[] {
    return Array.from(this.bindings.entries(), ([commandType, capabilityId]) => ({
      commandType,
      capabilityId,
    }));
  }

  public validateAgainstCatalog(catalog: readonly CapabilityDescriptor[]): void {
    if (!Array.isArray(catalog)) {
      throw new InvalidCommandCapabilityBindingError('Capability catalog must be an array.');
    }

    const catalogIds = new Set<string>();
    for (const descriptor of catalog) {
      const isObject = descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor);
      if (!isObject) {
        throw new InvalidCommandCapabilityBindingError('Capability descriptor must be an object.');
      }

      if (typeof descriptor.id !== 'string' || descriptor.id.trim() === '') {
        throw new InvalidCommandCapabilityBindingError('Capability descriptor id is required.');
      }

      catalogIds.add(descriptor.id);
    }

    for (const [commandType, capabilityId] of this.bindings.entries()) {
      if (!catalogIds.has(capabilityId)) {
        throw new CommandCapabilityBindingConsistencyError(
          `Capability id '${capabilityId}' for command type '${commandType}' is not present in the catalog.`,
        );
      }
    }
  }

  private validateBinding(entry: CommandCapabilityBinding): void {
    const isObject = entry && typeof entry === 'object' && !Array.isArray(entry);
    if (!isObject) {
      throw new InvalidCommandCapabilityBindingError('Binding entry must be an object.');
    }

    this.validateCommandType(entry.commandType);

    if (typeof entry.capabilityId !== 'string' || entry.capabilityId.trim() === '') {
      throw new InvalidCommandCapabilityBindingError('Capability id must be a non-empty string.');
    }
  }

  private validateCommandType(commandType: string): void {
    if (typeof commandType !== 'string' || commandType.trim() === '') {
      throw new InvalidCommandCapabilityBindingError('Command type must be a non-empty string.');
    }
  }
}