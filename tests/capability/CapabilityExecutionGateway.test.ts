import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CapabilityExecutionBundleBuilder,
  CapabilityExecutionGateway,
  CapabilityExecutionPreflightValidator,
  CapabilityRegistry,
  type CapabilityHandler,
  type CapabilityInvocation,
  type CapabilityResult,
} from '../../core/capability/index.js';
import {
  CapabilityExecutionGatewayError,
  InvalidCapabilityExecutionGatewayInputError,
} from '../../core/capability/CapabilityExecutionGatewayErrors.js';
import { InvalidCapabilityPreflightInputError } from '../../core/capability/CapabilityExecutionPreflightErrors.js';
import { CapabilityExecutionError } from '../../core/capability/CapabilityErrors.js';
import { CapabilityExecutionGateway as CoreCapabilityExecutionGateway } from '../../core/index.js';

const echoDescriptor = {
  id: 'cap.echo',
  name: 'Echo Capability',
  version: '1.0.0',
  handlerId: 'handler.echo',
} as const;

const echoHandler: CapabilityHandler = (invocation) => ({
  echoed: invocation.input,
});

function createInvocation(): CapabilityInvocation {
  return {
    capabilityId: 'cap.echo',
    input: { message: 'hello' },
    context: { source: 'spec-021-test' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };
}

function createBundle() {
  const registry = new CapabilityRegistry();
  registry.register(echoDescriptor, echoHandler);
  const builder = new CapabilityExecutionBundleBuilder();
  return builder.build(registry);
}

test('CapabilityExecutionGateway executes successfully with valid invocation and bundle', () => {
  const gateway = new CapabilityExecutionGateway();
  const result = gateway.execute(createInvocation(), createBundle());

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    echoed: { message: 'hello' },
  });
});

test('CapabilityExecutionGateway rejects invalid invocation input', () => {
  const gateway = new CapabilityExecutionGateway();

  assert.throws(
    () => gateway.execute(null as unknown as CapabilityInvocation, createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityExecutionGatewayInputError);
      return true;
    },
  );
});

test('CapabilityExecutionGateway rejects invalid bundle input', () => {
  const gateway = new CapabilityExecutionGateway();

  assert.throws(
    () => gateway.execute(createInvocation(), null as unknown as ReturnType<typeof createBundle>),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityExecutionGatewayInputError);
      return true;
    },
  );
});

test('CapabilityExecutionGateway calls preflight before resolver', () => {
  const callOrder: string[] = [];

  const preflight = {
    validate: () => {
      callOrder.push('preflight');
      return { status: 'ready' };
    },
  };

  const resolverFactory = () => ({
    invoke: () => {
      callOrder.push('resolver');
      return {
        status: 'succeeded',
        output: { ok: true },
        generatedAt: '2026-07-31T00:00:00.000Z',
      } as CapabilityResult;
    },
  });

  const gateway = new CapabilityExecutionGateway(preflight, resolverFactory);
  gateway.execute(createInvocation(), createBundle());

  assert.deepEqual(callOrder, ['preflight', 'resolver']);
});

test('CapabilityExecutionGateway does not call resolver when preflight fails', () => {
  let resolverCalled = false;

  const preflight = {
    validate: () => {
      throw new InvalidCapabilityPreflightInputError('Invalid preflight input.');
    },
  };

  const resolverFactory = () => ({
    invoke: () => {
      resolverCalled = true;
      return {
        status: 'succeeded',
        output: { ok: true },
        generatedAt: '2026-07-31T00:00:00.000Z',
      } as CapabilityResult;
    },
  });

  const gateway = new CapabilityExecutionGateway(preflight, resolverFactory);

  assert.throws(
    () => gateway.execute(createInvocation(), createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityPreflightInputError);
      return true;
    },
  );

  assert.equal(resolverCalled, false);
});

test('CapabilityExecutionGateway propagates typed resolver errors', () => {
  const resolverFactory = () => ({
    invoke: () => {
      throw new CapabilityExecutionError('Resolver execution failed.');
    },
  });

  const gateway = new CapabilityExecutionGateway(new CapabilityExecutionPreflightValidator(), resolverFactory);

  assert.throws(
    () => gateway.execute(createInvocation(), createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityExecutionError);
      return true;
    },
  );
});

test('CapabilityExecutionGateway uses the same catalog for preflight and invoke', () => {
  let preflightCatalog: readonly unknown[] | undefined;
  let resolverCatalog: readonly unknown[] | undefined;

  const preflight = {
    validate: (_invocation: CapabilityInvocation, catalog: readonly unknown[]) => {
      preflightCatalog = catalog;
      return { status: 'ready' };
    },
  };

  const resolverFactory = () => ({
    invoke: (_invocation: CapabilityInvocation, catalog: readonly unknown[]) => {
      resolverCatalog = catalog;
      return {
        status: 'succeeded',
        output: { ok: true },
        generatedAt: '2026-07-31T00:00:00.000Z',
      } as CapabilityResult;
    },
  });

  const gateway = new CapabilityExecutionGateway(preflight, resolverFactory);
  gateway.execute(createInvocation(), createBundle());

  assert.equal(preflightCatalog, resolverCatalog);
});

test('CapabilityExecutionGateway is deterministic for identical inputs', () => {
  const gateway = new CapabilityExecutionGateway();
  const invocation = createInvocation();
  const bundle = createBundle();

  const left = gateway.execute(invocation, bundle);
  const right = gateway.execute(invocation, bundle);

  assert.deepEqual(left, right);
});

test('CapabilityExecutionGateway does not mutate invocation and bundle', () => {
  const gateway = new CapabilityExecutionGateway();
  const invocation = createInvocation();
  const bundle = createBundle();

  const invocationBefore = structuredClone(invocation);
  const catalogBefore = structuredClone(bundle.catalog);
  const handlersKeysBefore = Array.from(bundle.handlersById.keys());

  gateway.execute(invocation, bundle);

  assert.deepEqual(invocation, invocationBefore);
  assert.deepEqual(bundle.catalog, catalogBefore);
  assert.deepEqual(Array.from(bundle.handlersById.keys()), handlersKeysBefore);
});

test('CapabilityExecutionGateway wraps non-Error throwables in typed gateway error', () => {
  const resolverFactory = () => ({
    invoke: () => {
      throw 'non-error throwable';
    },
  });

  const gateway = new CapabilityExecutionGateway(new CapabilityExecutionPreflightValidator(), resolverFactory);

  assert.throws(
    () => gateway.execute(createInvocation(), createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityExecutionGatewayError);
      return true;
    },
  );
});

test('core public entrypoint exposes CapabilityExecutionGateway', () => {
  assert.equal(typeof CoreCapabilityExecutionGateway, 'function');
});