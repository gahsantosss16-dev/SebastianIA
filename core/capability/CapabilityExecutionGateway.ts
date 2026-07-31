import { CapabilityExecutionPreflightValidator } from './CapabilityExecutionPreflightValidator.js';
import { CapabilityResolver } from './CapabilityResolver.js';
import type { CapabilityExecutionBundle } from './CapabilityExecutionBundleBuilder.js';
import type { CapabilityDescriptor, CapabilityHandler, CapabilityInvocation, CapabilityResult } from './CapabilityTypes.js';
import {
  CapabilityExecutionGatewayError,
  InvalidCapabilityExecutionGatewayInputError,
} from './CapabilityExecutionGatewayErrors.js';

interface CapabilityPreflightLike {
  validate(invocation: CapabilityInvocation, catalog: readonly CapabilityDescriptor[]): unknown;
}

interface CapabilityResolverLike {
  invoke(invocation: CapabilityInvocation, catalog: readonly CapabilityDescriptor[]): CapabilityResult;
}

type CapabilityResolverFactory = (handlers: ReadonlyMap<string, CapabilityHandler>) => CapabilityResolverLike;

export class CapabilityExecutionGateway {
  public constructor(
    private readonly preflightValidator: CapabilityPreflightLike = new CapabilityExecutionPreflightValidator(),
    private readonly resolverFactory: CapabilityResolverFactory =
      (handlers: ReadonlyMap<string, CapabilityHandler>) => new CapabilityResolver(handlers),
  ) {}

  public execute(invocation: CapabilityInvocation, bundle: CapabilityExecutionBundle): CapabilityResult {
    this.validateInvocation(invocation);
    this.validateBundle(bundle);

    const catalog = bundle.catalog;

    this.preflightValidator.validate(invocation, catalog);

    try {
      const resolver = this.resolverFactory(bundle.handlersById);
      return resolver.invoke(invocation, catalog);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new CapabilityExecutionGatewayError('Capability execution gateway failed.', {
        cause: error,
      });
    }
  }

  private validateInvocation(invocation: CapabilityInvocation): void {
    if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) {
      throw new InvalidCapabilityExecutionGatewayInputError('Capability invocation must be an object.');
    }
  }

  private validateBundle(bundle: CapabilityExecutionBundle): void {
    const isObject = bundle && typeof bundle === 'object' && !Array.isArray(bundle);
    if (!isObject) {
      throw new InvalidCapabilityExecutionGatewayInputError('Capability execution bundle must be an object.');
    }

    if (!Array.isArray(bundle.catalog)) {
      throw new InvalidCapabilityExecutionGatewayInputError('Capability execution bundle catalog must be an array.');
    }

    const handlersById = bundle.handlersById as unknown as { get?: unknown; has?: unknown; size?: unknown };
    if (!handlersById || typeof handlersById.get !== 'function' || typeof handlersById.has !== 'function') {
      throw new InvalidCapabilityExecutionGatewayInputError(
        'Capability execution bundle handlersById must be a read-only map.',
      );
    }
  }
}