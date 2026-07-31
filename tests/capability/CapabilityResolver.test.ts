import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityResolver } from '../../core/capability/CapabilityResolver.js';
import { InvalidCapabilityInvocationError, UnsupportedCapabilityError, CapabilityResolutionError, CapabilityExecutionError } from '../../core/capability/CapabilityErrors.js';
import type { CapabilityInvocation } from '../../core/capability/CapabilityTypes.js';
import { CapabilityResolver as CoreCapabilityResolver } from '../../core/index.js';

const catalog = [
  {
    id: 'echo',
    name: 'Echo',
    version: '1.0.0',
    handlerId: 'echo-handler',
    inputSchema: { type: 'object' },
  },
] as const;

const handlers = new Map<string, (invocation: CapabilityInvocation) => Record<string, unknown>>([
  [
    'echo-handler',
    (invocation) => ({
      echoed: invocation.input,
      context: invocation.context,
    }),
  ],
]);

test('CapabilityResolver invokes a registered handler and returns a success result', () => {
  const resolver = new CapabilityResolver(handlers);
  const result = resolver.invoke(
    {
      capabilityId: 'echo',
      input: { message: 'hello' },
      context: { source: 'test' },
      generatedAt: '2026-07-31T00:00:00.000Z',
    },
    catalog,
  );

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    echoed: { message: 'hello' },
    context: { source: 'test' },
  });
  assert.equal(result.generatedAt, '2026-07-31T00:00:00.000Z');
});

test('CapabilityResolver rejects an empty capability id', () => {
  const resolver = new CapabilityResolver(handlers);

  assert.throws(
    () =>
      resolver.invoke(
        {
          capabilityId: '',
          input: {},
          context: {},
          generatedAt: '2026-07-31T00:00:00.000Z',
        },
        catalog,
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityInvocationError);
      return true;
    },
  );
});

test('CapabilityResolver rejects invalid input shape', () => {
  const resolver = new CapabilityResolver(handlers);

  assert.throws(
    () =>
      resolver.invoke(
        {
          capabilityId: 'echo',
          input: [] as unknown as Record<string, unknown>,
          context: {},
          generatedAt: '2026-07-31T00:00:00.000Z',
        },
        catalog,
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityInvocationError);
      return true;
    },
  );
});

test('CapabilityResolver rejects unsupported capabilities', () => {
  const resolver = new CapabilityResolver(handlers);

  assert.throws(
    () =>
      resolver.invoke(
        {
          capabilityId: 'missing',
          input: {},
          context: {},
          generatedAt: '2026-07-31T00:00:00.000Z',
        },
        catalog,
      ),
    (error: unknown) => {
      assert.ok(error instanceof UnsupportedCapabilityError);
      return true;
    },
  );
});

test('CapabilityResolver rejects unresolved handlers', () => {
  const resolver = new CapabilityResolver(new Map());

  assert.throws(
    () =>
      resolver.invoke(
        {
          capabilityId: 'echo',
          input: {},
          context: {},
          generatedAt: '2026-07-31T00:00:00.000Z',
        },
        catalog,
      ),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityResolutionError);
      return true;
    },
  );
});

test('CapabilityResolver propagates handler execution failures', () => {
  const failingHandlers = new Map<string, (invocation: CapabilityInvocation) => Record<string, unknown>>([
    ['echo-handler', () => {
      throw new Error('boom');
    }],
  ]);
  const resolver = new CapabilityResolver(failingHandlers);

  assert.throws(
    () =>
      resolver.invoke(
        {
          capabilityId: 'echo',
          input: {},
          context: {},
          generatedAt: '2026-07-31T00:00:00.000Z',
        },
        catalog,
      ),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityExecutionError);
      return true;
    },
  );
});

test('CapabilityResolver is deterministic for the same input', () => {
  const resolver = new CapabilityResolver(handlers);
  const first = resolver.invoke(
    {
      capabilityId: 'echo',
      input: { message: 'hello' },
      context: { source: 'test' },
      generatedAt: '2026-07-31T00:00:00.000Z',
    },
    catalog,
  );
  const second = resolver.invoke(
    {
      capabilityId: 'echo',
      input: { message: 'hello' },
      context: { source: 'test' },
      generatedAt: '2026-07-31T00:00:00.000Z',
    },
    catalog,
  );

  assert.deepEqual(first, second);
});

test('CapabilityResolver rejects duplicate descriptors in the catalog', () => {
  const resolver = new CapabilityResolver(handlers);
  const duplicateCatalog = [
    ...catalog,
    {
      id: 'echo',
      name: 'Echo Duplicate',
      version: '1.0.1',
      handlerId: 'echo-handler',
    },
  ];

  assert.throws(
    () =>
      resolver.invoke(
        {
          capabilityId: 'echo',
          input: {},
          context: {},
          generatedAt: '2026-07-31T00:00:00.000Z',
        },
        duplicateCatalog,
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityInvocationError);
      return true;
    },
  );
});

test('CapabilityResolver rejects an empty handlerId in a descriptor', () => {
  const resolver = new CapabilityResolver(handlers);
  const invalidCatalog = [
    {
      id: 'echo',
      name: 'Echo',
      version: '1.0.0',
      handlerId: '   ',
    },
  ];

  assert.throws(
    () =>
      resolver.invoke(
        {
          capabilityId: 'echo',
          input: {},
          context: {},
          generatedAt: '2026-07-31T00:00:00.000Z',
        },
        invalidCatalog,
      ),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityInvocationError);
      return true;
    },
  );
});

test('CapabilityResolver rejects invalid handler output', () => {
  const invalidOutputHandlers = new Map<string, (invocation: CapabilityInvocation) => Record<string, unknown>>([
    ['echo-handler', () => null as unknown as Record<string, unknown>],
  ]);
  const resolver = new CapabilityResolver(invalidOutputHandlers);

  assert.throws(
    () =>
      resolver.invoke(
        {
          capabilityId: 'echo',
          input: {},
          context: {},
          generatedAt: '2026-07-31T00:00:00.000Z',
        },
        catalog,
      ),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityExecutionError);
      return true;
    },
  );
});

test('CapabilityResolver preserves the original invocation, input, context and catalog', () => {
  const resolver = new CapabilityResolver(handlers);
  const invocation = {
    capabilityId: 'echo',
    input: { message: 'hello' },
    context: { source: 'test' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };
  const catalogSnapshot = [
    {
      id: 'echo',
      name: 'Echo',
      version: '1.0.0',
      handlerId: 'echo-handler',
    },
  ];

  resolver.invoke(invocation, catalogSnapshot);

  assert.deepEqual(invocation, {
    capabilityId: 'echo',
    input: { message: 'hello' },
    context: { source: 'test' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
  assert.deepEqual(catalogSnapshot, [
    {
      id: 'echo',
      name: 'Echo',
      version: '1.0.0',
      handlerId: 'echo-handler',
    },
  ]);
});

test('CapabilityResolver preserves the original cause from handler exceptions', () => {
  const originalError = new Error('boom');
  const failingHandlers = new Map<string, (invocation: CapabilityInvocation) => Record<string, unknown>>([
    ['echo-handler', () => {
      throw originalError;
    }],
  ]);
  const resolver = new CapabilityResolver(failingHandlers);

  try {
    resolver.invoke(
      {
        capabilityId: 'echo',
        input: {},
        context: {},
        generatedAt: '2026-07-31T00:00:00.000Z',
      },
      catalog,
    );
    assert.fail('Expected an error to be thrown');
  } catch (error) {
    assert.ok(error instanceof CapabilityExecutionError);
    assert.equal((error as CapabilityExecutionError & { cause?: unknown }).cause, originalError);
  }
});

test('core public entrypoint exposes CapabilityResolver', () => {
  assert.equal(typeof CoreCapabilityResolver, 'function');
});
