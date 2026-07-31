import { CapabilityRegistry } from './CapabilityRegistry.js';
import type { CapabilityDescriptor, CapabilityHandler } from './CapabilityTypes.js';
import {
  CapabilityExecutionBundleConsistencyError,
  CapabilityExecutionBundleError,
  InvalidCapabilityExecutionBundleInputError,
} from './CapabilityExecutionBundleErrors.js';

export interface CapabilityExecutionBundle {
  readonly catalog: readonly CapabilityDescriptor[];
  readonly handlersById: ReadonlyMap<string, CapabilityHandler>;
}

class ReadonlyHandlersMap implements ReadonlyMap<string, CapabilityHandler> {
  public constructor(private readonly source: Map<string, CapabilityHandler>) {}

  public get size(): number {
    return this.source.size;
  }

  public get(key: string): CapabilityHandler | undefined {
    return this.source.get(key);
  }

  public has(key: string): boolean {
    return this.source.has(key);
  }

  public forEach(
    callbackfn: (value: CapabilityHandler, key: string, map: ReadonlyMap<string, CapabilityHandler>) => void,
    thisArg?: unknown,
  ): void {
    this.source.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }

  public entries(): MapIterator<[string, CapabilityHandler]> {
    return this.source.entries();
  }

  public keys(): MapIterator<string> {
    return this.source.keys();
  }

  public values(): MapIterator<CapabilityHandler> {
    return this.source.values();
  }

  public [Symbol.iterator](): MapIterator<[string, CapabilityHandler]> {
    return this.source[Symbol.iterator]();
  }

  public get [Symbol.toStringTag](): string {
    return 'ReadonlyMap';
  }
}

export class CapabilityExecutionBundleBuilder {
  public build(registry: CapabilityRegistry): CapabilityExecutionBundle {
    if (!(registry instanceof CapabilityRegistry)) {
      throw new InvalidCapabilityExecutionBundleInputError('Capability registry must be a CapabilityRegistry instance.');
    }

    try {
      const catalog = registry.exportCatalog();
      if (!Array.isArray(catalog)) {
        throw new InvalidCapabilityExecutionBundleInputError('Capability catalog must be an array.');
      }

      const handlersById = new Map<string, CapabilityHandler>();
      const protectedCatalog: CapabilityDescriptor[] = [];

      for (const descriptor of catalog) {
        this.validateDescriptor(descriptor);

        const handler = registry.getHandler(descriptor.id);
        if (typeof handler !== 'function') {
          throw new CapabilityExecutionBundleConsistencyError(
            `Capability descriptor '${descriptor.id}' does not have a resolvable handler.`,
          );
        }

        if (handlersById.has(descriptor.handlerId)) {
          throw new CapabilityExecutionBundleConsistencyError(
            `Duplicate handlerId in execution bundle: ${descriptor.handlerId}`,
          );
        }

        handlersById.set(descriptor.handlerId, handler);
        protectedCatalog.push(structuredClone(descriptor));
      }

      return {
        catalog: protectedCatalog,
        handlersById: new ReadonlyHandlersMap(handlersById),
      };
    } catch (error) {
      if (
        error instanceof InvalidCapabilityExecutionBundleInputError ||
        error instanceof CapabilityExecutionBundleConsistencyError ||
        error instanceof CapabilityExecutionBundleError
      ) {
        throw error;
      }

      throw new CapabilityExecutionBundleError('Capability execution bundle build failed.', {
        cause: error,
      });
    }
  }

  private validateDescriptor(descriptor: CapabilityDescriptor): void {
    const isObject = descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor);
    if (!isObject) {
      throw new InvalidCapabilityExecutionBundleInputError('Capability descriptor must be an object.');
    }

    if (typeof descriptor.id !== 'string' || descriptor.id.trim() === '') {
      throw new InvalidCapabilityExecutionBundleInputError('Capability descriptor id is required.');
    }

    if (typeof descriptor.handlerId !== 'string' || descriptor.handlerId.trim() === '') {
      throw new InvalidCapabilityExecutionBundleInputError('Capability descriptor handlerId is required.');
    }
  }
}