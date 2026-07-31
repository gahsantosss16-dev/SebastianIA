import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CapabilityExecutionBundleBuilder,
  CapabilityRegistry,
  CommandCapabilityBindings,
  CommandCapabilityExecutionCoordinator,
  CommandCapabilityPipelineExecutor,
  type CapabilityHandler,
  type CapabilityResult,
} from '../../core/capability/index.js';
import type { CommandProcessingInput, CommandProcessingResult } from '../../core/command/CommandTypes.js';
import {
  CommandCapabilityPipelineExecutorError,
  InvalidCommandCapabilityPipelineInputError,
} from '../../core/capability/CommandCapabilityPipelineExecutorErrors.js';
import { InvalidCommandInputError } from '../../core/command/CommandErrors.js';
import { InvalidCommandProcessingResultAdapterInputError } from '../../core/capability/CommandProcessingResultAdapterErrors.js';
import { InvalidCommandCapabilityExecutionInputError } from '../../core/capability/CommandCapabilityExecutionCoordinatorErrors.js';
import { CommandCapabilityPipelineExecutor as CoreCommandCapabilityPipelineExecutor } from '../../core/index.js';

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

function createBundle() {
  const registry = new CapabilityRegistry();
  registry.register(greetingDescriptor, greetingHandler);
  const builder = new CapabilityExecutionBundleBuilder();
  return builder.build(registry);
}

function createInput(): CommandProcessingInput {
  return {
    type: 'greeting',
    input: { message: 'hello' },
    generatedAt: '2026-07-31T00:00:00.000Z',
    conversation: {
      conversationId: 'conversation-1',
    },
    session: {
      conversationId: 'conversation-1',
      sessionId: 'session-1',
    },
  };
}

function createExecutor(): CommandCapabilityPipelineExecutor {
  const bindings = new CommandCapabilityBindings([{ commandType: 'greeting', capabilityId: 'cap.greeting' }]);
  const coordinator = new CommandCapabilityExecutionCoordinator(bindings);
  return new CommandCapabilityPipelineExecutor(coordinator);
}

test('CommandCapabilityPipelineExecutor executes full pipeline successfully', () => {
  const executor = createExecutor();
  const result = executor.execute(createInput(), createBundle());

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.output, {
    echoed: { message: 'hello' },
    source: {
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      messages: [],
      decisions: [],
      pendingTasks: [],
      summary: undefined,
      configuration: undefined,
      temporary: undefined,
      generatedAt: '2026-07-31T00:00:00.000Z',
    },
  });
});

test('CommandCapabilityPipelineExecutor rejects invalid input', () => {
  const executor = createExecutor();

  assert.throws(
    () => executor.execute(null as never, createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandCapabilityPipelineInputError);
      return true;
    },
  );
});

test('CommandCapabilityPipelineExecutor rejects invalid bundle', () => {
  const executor = createExecutor();

  assert.throws(
    () => executor.execute(createInput(), null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandCapabilityPipelineInputError);
      return true;
    },
  );
});

test('CommandCapabilityPipelineExecutor calls process before adapt and execute', () => {
  const callOrder: string[] = [];

  const processor = {
    process: (_input: CommandProcessingInput) => {
      callOrder.push('process');
      return {
        status: 'succeeded',
        output: {
          type: 'greeting',
          input: { message: 'hello' },
          context: { source: 'spec-024-test' },
        },
        generatedAt: '2026-07-31T00:00:00.000Z',
      } as CommandProcessingResult;
    },
  };

  const adapter = {
    adapt: (_result: CommandProcessingResult) => {
      callOrder.push('adapt');
      return {
        commandType: 'greeting',
        input: { message: 'hello' },
        context: { source: 'spec-024-test' },
        generatedAt: '2026-07-31T00:00:00.000Z',
      };
    },
  };

  const coordinator = {
    execute: () => {
      callOrder.push('execute');
      return {
        status: 'succeeded',
        output: { ok: true },
        generatedAt: '2026-07-31T00:00:00.000Z',
      } as CapabilityResult;
    },
  };

  const executor = new CommandCapabilityPipelineExecutor(coordinator, processor, adapter);
  executor.execute(createInput(), createBundle());

  assert.deepEqual(callOrder, ['process', 'adapt', 'execute']);
});

test('CommandCapabilityPipelineExecutor does not call adapter or coordinator when processor fails', () => {
  let adapterCalled = false;
  let coordinatorCalled = false;

  const processor = {
    process: () => {
      throw new InvalidCommandInputError('Invalid command input.');
    },
  };

  const adapter = {
    adapt: () => {
      adapterCalled = true;
      return {
        commandType: 'greeting',
        input: {},
        context: {},
        generatedAt: '2026-07-31T00:00:00.000Z',
      };
    },
  };

  const coordinator = {
    execute: () => {
      coordinatorCalled = true;
      return {
        status: 'succeeded',
        output: { ok: true },
        generatedAt: '2026-07-31T00:00:00.000Z',
      } as CapabilityResult;
    },
  };

  const executor = new CommandCapabilityPipelineExecutor(coordinator, processor, adapter);

  assert.throws(
    () => executor.execute(createInput(), createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandInputError);
      return true;
    },
  );

  assert.equal(adapterCalled, false);
  assert.equal(coordinatorCalled, false);
});

test('CommandCapabilityPipelineExecutor does not call coordinator when adapter fails', () => {
  let coordinatorCalled = false;

  const processor = {
    process: () => ({
      status: 'succeeded',
      output: {
        type: 'greeting',
        input: { message: 'hello' },
        context: { source: 'spec-024-test' },
      },
      generatedAt: '2026-07-31T00:00:00.000Z',
    } as CommandProcessingResult),
  };

  const adapter = {
    adapt: () => {
      throw new InvalidCommandProcessingResultAdapterInputError('Adapter failed.');
    },
  };

  const coordinator = {
    execute: () => {
      coordinatorCalled = true;
      return {
        status: 'succeeded',
        output: { ok: true },
        generatedAt: '2026-07-31T00:00:00.000Z',
      } as CapabilityResult;
    },
  };

  const executor = new CommandCapabilityPipelineExecutor(coordinator, processor, adapter);

  assert.throws(
    () => executor.execute(createInput(), createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandProcessingResultAdapterInputError);
      return true;
    },
  );

  assert.equal(coordinatorCalled, false);
});

test('CommandCapabilityPipelineExecutor propagates typed coordinator errors', () => {
  const processor = {
    process: () => ({
      status: 'succeeded',
      output: {
        type: 'greeting',
        input: { message: 'hello' },
        context: { source: 'spec-024-test' },
      },
      generatedAt: '2026-07-31T00:00:00.000Z',
    } as CommandProcessingResult),
  };

  const adapter = {
    adapt: () => ({
      commandType: 'greeting',
      input: { message: 'hello' },
      context: { source: 'spec-024-test' },
      generatedAt: '2026-07-31T00:00:00.000Z',
    }),
  };

  const coordinator = {
    execute: () => {
      throw new InvalidCommandCapabilityExecutionInputError('Coordinator failed.');
    },
  };

  const executor = new CommandCapabilityPipelineExecutor(coordinator, processor, adapter);

  assert.throws(
    () => executor.execute(createInput(), createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandCapabilityExecutionInputError);
      return true;
    },
  );
});

test('CommandCapabilityPipelineExecutor is deterministic for identical inputs', () => {
  const executor = createExecutor();
  const input = createInput();
  const bundle = createBundle();

  const left = executor.execute(input, bundle);
  const right = executor.execute(input, bundle);

  assert.deepEqual(left, right);
});

test('CommandCapabilityPipelineExecutor does not mutate input and bundle', () => {
  const executor = createExecutor();
  const input = createInput();
  const bundle = createBundle();

  const inputBefore = structuredClone(input);
  const catalogBefore = structuredClone(bundle.catalog);
  const handlersBefore = Array.from(bundle.handlersById.keys());

  executor.execute(input, bundle);

  assert.deepEqual(input, inputBefore);
  assert.deepEqual(bundle.catalog, catalogBefore);
  assert.deepEqual(Array.from(bundle.handlersById.keys()), handlersBefore);
});

test('CommandCapabilityPipelineExecutor wraps non-Error throwables in typed executor error', () => {
  const processor = {
    process: () => {
      throw 'non-error throwable';
    },
  };

  const adapter = {
    adapt: () => ({
      commandType: 'greeting',
      input: {},
      context: {},
      generatedAt: '2026-07-31T00:00:00.000Z',
    }),
  };

  const coordinator = {
    execute: () => ({
      status: 'succeeded',
      output: { ok: true },
      generatedAt: '2026-07-31T00:00:00.000Z',
    } as CapabilityResult),
  };

  const executor = new CommandCapabilityPipelineExecutor(coordinator, processor, adapter);

  assert.throws(
    () => executor.execute(createInput(), createBundle()),
    (error: unknown) => {
      assert.ok(error instanceof CommandCapabilityPipelineExecutorError);
      return true;
    },
  );
});

test('core public entrypoint exposes CommandCapabilityPipelineExecutor', () => {
  assert.equal(typeof CoreCommandCapabilityPipelineExecutor, 'function');
});