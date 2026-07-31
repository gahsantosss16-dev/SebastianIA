import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CapabilityExecutionBundleBuilder,
  CapabilityExecutionGateway,
  CapabilityRegistry,
  CommandCapabilityBindings,
  CommandCapabilityExecutionCoordinator,
  type CapabilityHandler,
  type CapabilityResult,
} from '../../core/capability/index.js';
import {
  CommandCapabilityExecutionCoordinatorError,
  InvalidCommandCapabilityExecutionInputError,
} from '../../core/capability/CommandCapabilityExecutionCoordinatorErrors.js';
import { CommandCapabilityBindingNotFoundError } from '../../core/capability/CommandCapabilityBindingErrors.js';
import { InvalidCapabilityInvocationInputError } from '../../core/capability/CapabilityInvocationComposerErrors.js';
import { InvalidCapabilityExecutionGatewayInputError } from '../../core/capability/CapabilityExecutionGatewayErrors.js';
import { CommandCapabilityExecutionCoordinator as CoreCommandCapabilityExecutionCoordinator } from '../../core/index.js';

const greetingDescriptor = {
  id: 'cap.greeting',
  name: 'Greeting Capability',
  version: '1.0.0',
  handlerId: 'handler.greeting',
} as const;

const greetingHandler: CapabilityHandler = (invocation) => ({
  echoed: invocation.input,
  source: invocation.context,
});

function createCoordinator(
  bindingsEntries = [{ commandType: 'greeting', capabilityId: 'cap.greeting' }] as const,
): CommandCapabilityExecutionCoordinator {
  const bindings = new CommandCapabilityBindings(bindingsEntries);
  return new CommandCapabilityExecutionCoordinator(bindings);
}

function createBundle() {
  const registry = new CapabilityRegistry();
  registry.register(greetingDescriptor, greetingHandler);
  const builder = new CapabilityExecutionBundleBuilder();
  return builder.build(registry);
}

function createInput() {
  return {
    commandType: 'greeting',
    input: { message: 'hello' },
    context: { source: 'spec-022-test' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  } as const;
}

test('CommandCapabilityExecutionCoordinator executes successfully with valid input and bundle', () => {
  const coordinator = createCoordinator();
  const result = coordinator.execute(createInput(), createBundle());

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    echoed: { message: 'hello' },
    source: { source: 'spec-022-test' },
  });
});

test('CommandCapabilityExecutionCoordinator rejects invalid execution input', () => {
  const coordinator = createCoordinator();

  assert.throws(
    () => coordinator.execute(null as never, createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandCapabilityExecutionInputError);
      return true;
    },
  );
});

test('CommandCapabilityExecutionCoordinator rejects invalid bundle input', () => {
  const coordinator = createCoordinator();

  assert.throws(
    () => coordinator.execute(createInput(), null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandCapabilityExecutionInputError);
      return true;
    },
  );
});

test('CommandCapabilityExecutionCoordinator calls binding before composer and gateway', () => {
  const callOrder: string[] = [];

  const bindings = {
    resolveCapabilityId: () => {
      callOrder.push('binding');
      return 'cap.greeting';
    },
  };

  const composer = {
    compose: () => {
      callOrder.push('composer');
      return {
        capabilityId: 'cap.greeting',
        input: { message: 'hello' },
        context: { source: 'spec-022-test' },
        generatedAt: '2026-07-31T00:00:00.000Z',
      };
    },
  };

  const gateway = {
    execute: () => {
      callOrder.push('gateway');
      return {
        status: 'succeeded',
        output: { ok: true },
        generatedAt: '2026-07-31T00:00:00.000Z',
      } as CapabilityResult;
    },
  };

  const coordinator = new CommandCapabilityExecutionCoordinator(bindings, composer, gateway);
  coordinator.execute(createInput(), createBundle());

  assert.deepEqual(callOrder, ['binding', 'composer', 'gateway']);
});

test('CommandCapabilityExecutionCoordinator does not call composer or gateway when binding fails', () => {
  let composerCalled = false;
  let gatewayCalled = false;

  const bindings = {
    resolveCapabilityId: () => {
      throw new CommandCapabilityBindingNotFoundError('Missing binding.');
    },
  };

  const composer = {
    compose: () => {
      composerCalled = true;
      return {
        capabilityId: 'cap.greeting',
        input: {},
        context: {},
        generatedAt: '2026-07-31T00:00:00.000Z',
      };
    },
  };

  const gateway = {
    execute: () => {
      gatewayCalled = true;
      return {
        status: 'succeeded',
        output: { ok: true },
        generatedAt: '2026-07-31T00:00:00.000Z',
      } as CapabilityResult;
    },
  };

  const coordinator = new CommandCapabilityExecutionCoordinator(bindings, composer, gateway);

  assert.throws(
    () => coordinator.execute(createInput(), createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof CommandCapabilityBindingNotFoundError);
      return true;
    },
  );

  assert.equal(composerCalled, false);
  assert.equal(gatewayCalled, false);
});

test('CommandCapabilityExecutionCoordinator propagates typed composer errors', () => {
  const bindings = {
    resolveCapabilityId: () => 'cap.greeting',
  };

  const composer = {
    compose: () => {
      throw new InvalidCapabilityInvocationInputError('Composer failed.');
    },
  };

  const gateway = {
    execute: () => {
      throw new Error('Should not execute gateway when composer fails.');
    },
  };

  const coordinator = new CommandCapabilityExecutionCoordinator(bindings, composer, gateway);

  assert.throws(
    () => coordinator.execute(createInput(), createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityInvocationInputError);
      return true;
    },
  );
});

test('CommandCapabilityExecutionCoordinator propagates typed gateway errors', () => {
  const bindings = {
    resolveCapabilityId: () => 'cap.greeting',
  };

  const composer = {
    compose: () => ({
      capabilityId: 'cap.greeting',
      input: { message: 'hello' },
      context: { source: 'spec-022-test' },
      generatedAt: '2026-07-31T00:00:00.000Z',
    }),
  };

  const gateway = {
    execute: () => {
      throw new InvalidCapabilityExecutionGatewayInputError('Gateway failed.');
    },
  };

  const coordinator = new CommandCapabilityExecutionCoordinator(bindings, composer, gateway);

  assert.throws(
    () => coordinator.execute(createInput(), createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCapabilityExecutionGatewayInputError);
      return true;
    },
  );
});

test('CommandCapabilityExecutionCoordinator is deterministic for identical inputs', () => {
  const coordinator = createCoordinator();
  const input = createInput();
  const bundle = createBundle();

  const left = coordinator.execute(input, bundle);
  const right = coordinator.execute(input, bundle);

  assert.deepEqual(left, right);
});

test('CommandCapabilityExecutionCoordinator does not mutate input and bundle', () => {
  const coordinator = createCoordinator();
  const input = createInput();
  const bundle = createBundle();

  const inputBefore = structuredClone(input);
  const catalogBefore = structuredClone(bundle.catalog);
  const handlersBefore = Array.from(bundle.handlersById.keys());

  coordinator.execute(input, bundle);

  assert.deepEqual(input, inputBefore);
  assert.deepEqual(bundle.catalog, catalogBefore);
  assert.deepEqual(Array.from(bundle.handlersById.keys()), handlersBefore);
});

test('CommandCapabilityExecutionCoordinator wraps non-Error throwables in typed coordinator error', () => {
  const bindings = {
    resolveCapabilityId: () => {
      throw 'non-error throwable';
    },
  };

  const coordinator = new CommandCapabilityExecutionCoordinator(bindings);

  assert.throws(
    () => coordinator.execute(createInput(), createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof CommandCapabilityExecutionCoordinatorError);
      return true;
    },
  );
});

test('core public entrypoint exposes CommandCapabilityExecutionCoordinator', () => {
  assert.equal(typeof CoreCommandCapabilityExecutionCoordinator, 'function');
});

test('CommandCapabilityExecutionCoordinator default dependencies execute through real gateway', () => {
  const bundle = createBundle();
  const bindings = new CommandCapabilityBindings([{ commandType: 'greeting', capabilityId: 'cap.greeting' }]);

  const coordinator = new CommandCapabilityExecutionCoordinator(
    bindings,
    undefined,
    new CapabilityExecutionGateway(),
  );

  const result = coordinator.execute(createInput(), bundle);

  assert.equal(result.status, 'succeeded');
});