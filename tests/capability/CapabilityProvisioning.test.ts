import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegistry,
  type CapabilityProvider,
  CapabilityRegistry,
  CapabilityRegistryError,
  CapabilityResolver,
} from '../../core/capability/index.js';
import {
  CapabilityProvisioningError,
  DuplicateCapabilityProvisionError,
  InvalidCapabilityProviderError,
  InvalidCapabilityProvisioningError,
} from '../../core/capability/CapabilityProvisioningErrors.js';
import type { CapabilityHandler, CapabilityInvocation, CapabilityRegistration } from '../../core/capability/CapabilityTypes.js';

const invocation: CapabilityInvocation = {
  capabilityId: 'echo',
  input: { message: 'hello' },
  context: { source: 'spec-016-test' },
  generatedAt: '2026-07-31T00:00:00.000Z',
};

const echoDescriptor = {
  id: 'echo',
  name: 'Echo',
  version: '1.0.0',
  handlerId: 'echo-handler',
} as const;

const reverseDescriptor = {
  id: 'reverse',
  name: 'Reverse',
  version: '1.0.0',
  handlerId: 'reverse-handler',
} as const;

const echoHandler: CapabilityHandler = (current) => ({
  echoed: current.input,
});

const reverseHandler: CapabilityHandler = (current) => {
  const value = current.input.value;
  return {
    reversed: typeof value === 'string' ? value.split('').reverse().join('') : '',
  };
};

function createProvider(providerId: string, registrations: readonly CapabilityRegistration[]): CapabilityProvider {
  return {
    providerId,
    listRegistrations: () => registrations,
  };
}

test('buildRegistry bootstraps a read-only registry from a valid provider', () => {
  const provider = createProvider('provider.echo', [{ descriptor: echoDescriptor, handler: echoHandler }]);

  const registry = buildRegistry([provider]);

  assert.ok(registry instanceof CapabilityRegistry);
  assert.equal(registry.has('echo'), true);
  assert.equal(registry.exportCatalog().length, 1);

  assert.throws(
    () =>
      registry.register(
        {
          id: 'new-capability',
          name: 'New Capability',
          version: '1.0.0',
          handlerId: 'new-handler',
        },
        echoHandler,
      ),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityRegistryError);
      return true;
    },
  );
});

test('buildRegistry merges multiple providers in deterministic order', () => {
  const first = createProvider('provider.first', [{ descriptor: echoDescriptor, handler: echoHandler }]);
  const second = createProvider('provider.second', [{ descriptor: reverseDescriptor, handler: reverseHandler }]);

  const registry = buildRegistry([first, second]);
  const ids = registry.listDescriptors().map((descriptor) => descriptor.id);

  assert.deepEqual(ids, ['echo', 'reverse']);
});

test('buildRegistry rejects invalid providers input shape', () => {
  assert.throws(
    () => buildRegistry(null as unknown as readonly CapabilityProvider[]),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityProviderError);
      return true;
    },
  );
});

test('buildRegistry rejects provider with invalid id', () => {
  const invalidProvider = createProvider('   ', [{ descriptor: echoDescriptor, handler: echoHandler }]);

  assert.throws(
    () => buildRegistry([invalidProvider]),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityProviderError);
      return true;
    },
  );
});

test('buildRegistry rejects provider without listRegistrations', () => {
  const invalidProvider = {
    providerId: 'provider.invalid',
  } as unknown as CapabilityProvider;

  assert.throws(
    () => buildRegistry([invalidProvider]),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityProviderError);
      return true;
    },
  );
});

test('buildRegistry rejects invalid listRegistrations return type', () => {
  const invalidProvider: CapabilityProvider = {
    providerId: 'provider.invalid.return',
    listRegistrations: () => null as unknown as readonly CapabilityRegistration[],
  };

  assert.throws(
    () => buildRegistry([invalidProvider]),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityProvisioningError);
      return true;
    },
  );
});

test('buildRegistry rejects invalid registrations', () => {
  const invalidProvider: CapabilityProvider = {
    providerId: 'provider.invalid.registration',
    listRegistrations: () => [{ descriptor: echoDescriptor, handler: null as unknown as CapabilityHandler }],
  };

  assert.throws(
    () => buildRegistry([invalidProvider]),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityProvisioningError);
      return true;
    },
  );
});

test('buildRegistry rejects duplicate capability ids across providers', () => {
  const first = createProvider('provider.first', [{ descriptor: echoDescriptor, handler: echoHandler }]);
  const second = createProvider('provider.second', [{ descriptor: echoDescriptor, handler: reverseHandler }]);

  assert.throws(
    () => buildRegistry([first, second]),
    (error: unknown) => {
      assert.ok(error instanceof DuplicateCapabilityProvisionError);
      return true;
    },
  );
});

test('buildRegistry wraps provider execution failures as provisioning errors', () => {
  const faultyProvider: CapabilityProvider = {
    providerId: 'provider.faulty',
    listRegistrations: () => {
      throw new Error('provider failure');
    },
  };

  assert.throws(
    () => buildRegistry([faultyProvider]),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityProvisioningError);
      return true;
    },
  );
});

test('buildRegistry result stays compatible with CapabilityResolver.invoke', () => {
  const first = createProvider('provider.first', [{ descriptor: echoDescriptor, handler: echoHandler }]);
  const second = createProvider('provider.second', [{ descriptor: reverseDescriptor, handler: reverseHandler }]);
  const registry = buildRegistry([first, second]);

  const handlers = new Map<string, CapabilityHandler>();
  for (const descriptor of registry.exportCatalog()) {
    const handler = registry.getHandler(descriptor.id);
    if (!handler) {
      assert.fail(`Expected handler for capability ${descriptor.id}`);
    }
    handlers.set(descriptor.handlerId, handler);
  }

  const resolver = new CapabilityResolver(handlers);
  const result = resolver.invoke(invocation, registry.exportCatalog());

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    echoed: { message: 'hello' },
  });
});

test('buildRegistry returns deterministic results for the same providers', () => {
  const first = createProvider('provider.first', [{ descriptor: echoDescriptor, handler: echoHandler }]);
  const second = createProvider('provider.second', [{ descriptor: reverseDescriptor, handler: reverseHandler }]);

  const left = buildRegistry([first, second]).exportCatalog();
  const right = buildRegistry([first, second]).exportCatalog();

  assert.deepEqual(left, right);
});

test('buildRegistry does not expose mutable descriptor references', () => {
  const provider = createProvider('provider.echo', [{ descriptor: echoDescriptor, handler: echoHandler }]);
  const registry = buildRegistry([provider]);

  const listed = registry.listDescriptors();
  assert.ok(listed.length > 0);

  const mutableListed = listed as unknown as Array<{ name: string }>;
  const first = mutableListed.at(0);
  if (!first) {
    assert.fail('Expected one descriptor in list');
  }

  first.name = 'Mutated';
  assert.equal(registry.getDescriptor('echo')?.name, 'Echo');
});

test('CapabilityProvisioningError is publicly exported', () => {
  assert.equal(typeof CapabilityProvisioningError, 'function');
});