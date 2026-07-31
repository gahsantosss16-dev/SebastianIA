import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../../core/capability/CapabilityRegistry.js';
import {
  CapabilityAlreadyRegisteredError,
  CapabilityRegistryError,
  InvalidCapabilityRegistrationError,
} from '../../core/capability/CapabilityRegistryErrors.js';
import type { CapabilityHandler, CapabilityInvocation } from '../../core/capability/CapabilityTypes.js';
import { CapabilityResolver } from '../../core/capability/CapabilityResolver.js';
import { CapabilityRegistry as CoreCapabilityRegistry } from '../../core/index.js';

const echoHandler: CapabilityHandler = (invocation) => ({
  echoed: invocation.input,
  context: invocation.context,
});

const descriptor = {
  id: 'echo',
  name: 'Echo',
  version: '1.0.0',
  handlerId: 'echo-handler',
  inputSchema: { type: 'object' },
} as const;

const invocation: CapabilityInvocation = {
  capabilityId: 'echo',
  input: { message: 'hello' },
  context: { source: 'test' },
  generatedAt: '2026-07-31T00:00:00.000Z',
};

test('CapabilityRegistry registers a valid capability and reports it as available', () => {
  const registry = new CapabilityRegistry();
  registry.register(descriptor, echoHandler);

  assert.equal(registry.has('echo'), true);
  assert.equal(typeof registry.getHandler('echo'), 'function');
  assert.equal(registry.getDescriptor('echo')?.id, 'echo');
});

test('CapabilityRegistry rejects duplicate capability ids', () => {
  const registry = new CapabilityRegistry();
  registry.register(descriptor, echoHandler);

  assert.throws(
    () => registry.register(descriptor, echoHandler),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityAlreadyRegisteredError);
      return true;
    },
  );
});

test('CapabilityRegistry rejects invalid descriptors', () => {
  const registry = new CapabilityRegistry();

  assert.throws(
    () =>
      registry.register(
        {
          ...descriptor,
          id: '   ',
        },
        echoHandler,
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityRegistrationError);
      return true;
    },
  );
});

test('CapabilityRegistry rejects invalid handlers', () => {
  const registry = new CapabilityRegistry();

  assert.throws(
    () => registry.register(descriptor, null as unknown as CapabilityHandler),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityRegistrationError);
      return true;
    },
  );
});

test('CapabilityRegistry descriptors are returned as protected copies', () => {
  const registry = new CapabilityRegistry();
  registry.register(descriptor, echoHandler);

  const loaded = registry.getDescriptor('echo');
  if (!loaded) {
    assert.fail('Expected descriptor to be available');
  }

  const mutableLoaded = loaded as unknown as { name: string; inputSchema?: { type?: string } };
  mutableLoaded.name = 'Changed';
  if (mutableLoaded.inputSchema) {
    mutableLoaded.inputSchema.type = 'changed';
  }

  const reloaded = registry.getDescriptor('echo');
  assert.equal(reloaded?.name, 'Echo');
  assert.equal((reloaded?.inputSchema as { type?: string } | undefined)?.type, 'object');
});

test('CapabilityRegistry listDescriptors and exportCatalog are deterministic copies', () => {
  const registry = new CapabilityRegistry();
  registry.register(descriptor, echoHandler);

  const listed = registry.listDescriptors();
  const exported = registry.exportCatalog();

  assert.deepEqual(listed, exported);
  assert.notEqual(listed, exported);
  assert.ok(listed.length > 0);

  const mutableListed = listed as unknown as Array<{ name: string }>;
  const first = mutableListed.at(0);
  if (!first) {
    assert.fail('Expected at least one descriptor');
  }
  first.name = 'Mutated';

  assert.equal(registry.getDescriptor('echo')?.name, 'Echo');
});

test('CapabilityRegistry validates capability ids in query methods', () => {
  const registry = new CapabilityRegistry();

  assert.throws(
    () => registry.getDescriptor(''),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityRegistrationError);
      return true;
    },
  );

  assert.throws(
    () => registry.getHandler('   '),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityRegistrationError);
      return true;
    },
  );

  assert.throws(
    () => registry.has(''),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityRegistrationError);
      return true;
    },
  );
});

test('CapabilityRegistry instances remain isolated', () => {
  const first = new CapabilityRegistry();
  const second = new CapabilityRegistry();

  first.register(descriptor, echoHandler);

  assert.equal(first.has('echo'), true);
  assert.equal(second.has('echo'), false);
});

test('CapabilityRegistry can be initialized in read-only mode', () => {
  const registry = new CapabilityRegistry({
    readOnly: true,
    entries: [{ descriptor, handler: echoHandler }],
  });

  assert.equal(registry.has('echo'), true);
  assert.throws(
    () =>
      registry.register(
        {
          id: 'other',
          name: 'Other',
          version: '1.0.0',
          handlerId: 'other-handler',
        },
        echoHandler,
      ),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityRegistryError);
      return true;
    },
  );
});

test('CapabilityRegistry exported catalog is compatible with CapabilityResolver', () => {
  const registry = new CapabilityRegistry();
  registry.register(descriptor, echoHandler);

  const handler = registry.getHandler('echo');
  if (!handler) {
    assert.fail('Expected handler to be available');
  }

  const resolver = new CapabilityResolver(
    new Map([
      [descriptor.handlerId, handler],
    ]),
  );

  const result = resolver.invoke(invocation, registry.exportCatalog());

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    echoed: { message: 'hello' },
    context: { source: 'test' },
  });
});

test('core public entrypoint exposes CapabilityRegistry', () => {
  assert.equal(typeof CoreCapabilityRegistry, 'function');
});
