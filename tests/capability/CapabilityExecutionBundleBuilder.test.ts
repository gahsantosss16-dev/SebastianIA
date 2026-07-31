import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CapabilityExecutionBundleBuilder,
  CapabilityExecutionPreflightValidator,
  CapabilityRegistry,
  CapabilityResolver,
  type CapabilityHandler,
  type CapabilityInvocation,
} from '../../core/capability/index.js';
import {
  CapabilityExecutionBundleConsistencyError,
  CapabilityExecutionBundleError,
  InvalidCapabilityExecutionBundleInputError,
} from '../../core/capability/CapabilityExecutionBundleErrors.js';
import { CapabilityExecutionBundleBuilder as CoreCapabilityExecutionBundleBuilder } from '../../core/index.js';

const echoDescriptor = {
  id: 'cap.echo',
  name: 'Echo Capability',
  version: '1.0.0',
  handlerId: 'handler.echo',
} as const;

const reverseDescriptor = {
  id: 'cap.reverse',
  name: 'Reverse Capability',
  version: '1.0.0',
  handlerId: 'handler.reverse',
} as const;

const echoHandler: CapabilityHandler = (invocation) => ({
  echoed: invocation.input,
});

const reverseHandler: CapabilityHandler = (invocation) => {
  const value = invocation.input.value;
  return {
    reversed: typeof value === 'string' ? value.split('').reverse().join('') : '',
  };
};

function createRegistryWithTwoCapabilities(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(echoDescriptor, echoHandler);
  registry.register(reverseDescriptor, reverseHandler);
  return registry;
}

test('CapabilityExecutionBundleBuilder builds a valid bundle from registry', () => {
  const registry = createRegistryWithTwoCapabilities();
  const builder = new CapabilityExecutionBundleBuilder();

  const bundle = builder.build(registry);

  assert.equal(bundle.catalog.length, 2);
  assert.equal(bundle.handlersById.size, 2);
  assert.equal(typeof bundle.handlersById.get('handler.echo'), 'function');
  assert.equal(typeof bundle.handlersById.get('handler.reverse'), 'function');
});

test('CapabilityExecutionBundleBuilder rejects invalid registry input', () => {
  const builder = new CapabilityExecutionBundleBuilder();

  assert.throws(
    () => builder.build(null as unknown as CapabilityRegistry),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityExecutionBundleInputError);
      return true;
    },
  );
});

test('CapabilityExecutionBundleBuilder rejects invalid descriptor in extracted catalog', () => {
  const registry = createRegistryWithTwoCapabilities();
  const builder = new CapabilityExecutionBundleBuilder();

  const mutableRegistry = registry as unknown as {
    exportCatalog: () => ReadonlyArray<{
      id: string;
      name: string;
      version: string;
      handlerId: string;
    }>;
  };

  mutableRegistry.exportCatalog = () => [
    {
      ...echoDescriptor,
      handlerId: '',
    },
  ];

  assert.throws(
    () => builder.build(registry),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityExecutionBundleInputError);
      return true;
    },
  );
});

test('CapabilityExecutionBundleBuilder rejects missing handler for descriptor', () => {
  const registry = createRegistryWithTwoCapabilities();
  const builder = new CapabilityExecutionBundleBuilder();

  const mutableRegistry = registry as unknown as {
    getHandler: (capabilityId: string) => CapabilityHandler | undefined;
  };
  mutableRegistry.getHandler = (capabilityId: string) => {
    if (capabilityId === 'cap.reverse') {
      return undefined;
    }
    return echoHandler;
  };

  assert.throws(
    () => builder.build(registry),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityExecutionBundleConsistencyError);
      return true;
    },
  );
});

test('CapabilityExecutionBundleBuilder rejects duplicate handlerId in bundle', () => {
  const registry = new CapabilityRegistry();
  registry.register(echoDescriptor, echoHandler);
  registry.register(
    {
      id: 'cap.echo.alias',
      name: 'Echo Alias',
      version: '1.0.0',
      handlerId: 'handler.echo',
    },
    reverseHandler,
  );

  const builder = new CapabilityExecutionBundleBuilder();

  assert.throws(
    () => builder.build(registry),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityExecutionBundleConsistencyError);
      return true;
    },
  );
});

test('CapabilityExecutionBundleBuilder is deterministic for identical registry state', () => {
  const registry = createRegistryWithTwoCapabilities();
  const builder = new CapabilityExecutionBundleBuilder();

  const left = builder.build(registry);
  const right = builder.build(registry);

  assert.deepEqual(left.catalog, right.catalog);
  assert.deepEqual(Array.from(left.handlersById.keys()), Array.from(right.handlersById.keys()));
});

test('CapabilityExecutionBundleBuilder protects returned catalog and handlers map', () => {
  const registry = createRegistryWithTwoCapabilities();
  const builder = new CapabilityExecutionBundleBuilder();

  const bundle = builder.build(registry);
  assert.ok(bundle.catalog.length > 0);

  const mutableCatalog = bundle.catalog as unknown as Array<{ name: string }>;
  const first = mutableCatalog.at(0);
  if (!first) {
    assert.fail('Expected at least one catalog descriptor');
  }

  first.name = 'Mutated';

  const rebuilt = builder.build(registry);
  assert.equal(rebuilt.catalog[0]?.name, 'Echo Capability');
  assert.equal(rebuilt.handlersById.has('mutated-handler'), false);
});

test('CapabilityExecutionBundleBuilder does not mutate registry state', () => {
  const registry = createRegistryWithTwoCapabilities();
  const beforeCatalog = registry.exportCatalog();
  const beforeDescriptors = registry.listDescriptors();

  const builder = new CapabilityExecutionBundleBuilder();
  builder.build(registry);

  assert.deepEqual(registry.exportCatalog(), beforeCatalog);
  assert.deepEqual(registry.listDescriptors(), beforeDescriptors);
});

test('CapabilityExecutionBundleBuilder is compatible with preflight validator', () => {
  const registry = createRegistryWithTwoCapabilities();
  const builder = new CapabilityExecutionBundleBuilder();
  const bundle = builder.build(registry);

  const preflight = new CapabilityExecutionPreflightValidator();
  const invocation: CapabilityInvocation = {
    capabilityId: 'cap.echo',
    input: { message: 'hello' },
    context: { source: 'spec-020-test' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };

  const result = preflight.validate(invocation, bundle.catalog);

  assert.equal(result.status, 'ready');
  assert.equal(result.descriptor.id, 'cap.echo');
});

test('CapabilityExecutionBundleBuilder is compatible with CapabilityResolver.invoke', () => {
  const registry = createRegistryWithTwoCapabilities();
  const builder = new CapabilityExecutionBundleBuilder();
  const bundle = builder.build(registry);

  const resolver = new CapabilityResolver(bundle.handlersById);
  const invocation: CapabilityInvocation = {
    capabilityId: 'cap.reverse',
    input: { value: 'abc' },
    context: { source: 'spec-020-test' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };

  const result = resolver.invoke(invocation, bundle.catalog);

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    reversed: 'cba',
  });
});

test('CapabilityExecutionBundleBuilder wraps unexpected failures in typed bundle error', () => {
  const registry = createRegistryWithTwoCapabilities();
  const builder = new CapabilityExecutionBundleBuilder();
  const originalStructuredClone = globalThis.structuredClone;

  globalThis.structuredClone = (() => {
    throw new Error('forced bundle clone failure');
  }) as typeof globalThis.structuredClone;

  try {
    assert.throws(
      () => builder.build(registry),
      (error: unknown) => {
        assert.ok(error instanceof CapabilityExecutionBundleError);
        return true;
      },
    );
  } finally {
    globalThis.structuredClone = originalStructuredClone;
  }
});

test('core public entrypoint exposes CapabilityExecutionBundleBuilder', () => {
  assert.equal(typeof CoreCapabilityExecutionBundleBuilder, 'function');
});