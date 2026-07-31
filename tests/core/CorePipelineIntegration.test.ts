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
import type { CommandProcessingInput } from '../../core/command/CommandTypes.js';
import { SebastianCore } from '../../core/core.js';
import {
  CorePipelineDependencyUnavailableError,
  CorePipelineExecutionError,
  InvalidCoreCommandInputError,
} from '../../core/CorePipelineIntegrationErrors.js';
import { InvalidCommandCapabilityPipelineInputError } from '../../core/capability/CommandCapabilityPipelineExecutorErrors.js';

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

function createBundle() {
  const registry = new CapabilityRegistry();
  registry.register(greetingDescriptor, greetingHandler);
  const builder = new CapabilityExecutionBundleBuilder();
  return builder.build(registry);
}

function createCoreWithRealPipeline(): SebastianCore {
  const bundle = createBundle();
  const bindings = new CommandCapabilityBindings([{ commandType: 'greeting', capabilityId: 'cap.greeting' }]);
  const coordinator = new CommandCapabilityExecutionCoordinator(bindings);
  const executor = new CommandCapabilityPipelineExecutor(coordinator);
  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
  });
  core.initialize();
  core.start();
  return core;
}

test('Core executes command successfully through public API', () => {
  const core = createCoreWithRealPipeline();

  const result = core.executeCommand(createInput());

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

test('Core rejects invalid command input with typed error', () => {
  const core = createCoreWithRealPipeline();

  assert.throws(
    () => core.executeCommand(null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCoreCommandInputError);
      return true;
    },
  );
});

test('Core rejects unavailable pipeline dependencies with typed error', () => {
  const core = new SebastianCore();
  core.initialize();
  core.start();

  assert.throws(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CorePipelineDependencyUnavailableError);
      return true;
    },
  );
});

test('Core rejects invalid executor dependency contract with typed error', () => {
  const bundle = createBundle();
  const invalidExecutor = {} as unknown as { execute: never };
  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor: invalidExecutor,
    bundle,
  } as never);
  core.initialize();
  core.start();

  assert.throws(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CorePipelineDependencyUnavailableError);
      return true;
    },
  );
});

test('Core propagates typed errors from pipeline executor', () => {
  const bundle = createBundle();
  const executor = {
    execute: () => {
      throw new InvalidCommandCapabilityPipelineInputError('Pipeline typed failure.');
    },
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
  });
  core.initialize();
  core.start();

  assert.throws(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandCapabilityPipelineInputError);
      return true;
    },
  );
});

test('Core wraps non-Error throwables from pipeline executor in typed core error', () => {
  const bundle = createBundle();
  const executor = {
    execute: () => {
      throw 'non-error throwable';
    },
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
  });
  core.initialize();
  core.start();

  assert.throws(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CorePipelineExecutionError);
      return true;
    },
  );
});

test('Core delegates command execution directly to pipeline executor', () => {
  let called = false;
  let receivedInput: CommandProcessingInput | undefined;
  let receivedBundle: unknown;

  const bundle = createBundle();
  const expectedResult: CapabilityResult = {
    status: 'succeeded',
    output: { delegated: true },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };

  const executor = {
    execute: (input: CommandProcessingInput, executionBundle: unknown) => {
      called = true;
      receivedInput = input;
      receivedBundle = executionBundle;
      return expectedResult;
    },
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
  });
  core.initialize();
  core.start();

  const input = createInput();
  const result = core.executeCommand(input);

  assert.equal(called, true);
  assert.equal(receivedInput, input);
  assert.equal(receivedBundle, bundle);
  assert.equal(result, expectedResult);
});

test('Core command execution is deterministic for identical inputs and bundle', () => {
  const core = createCoreWithRealPipeline();
  const input = createInput();

  const left = core.executeCommand(input);
  const right = core.executeCommand(input);

  assert.deepEqual(left, right);
});

test('Core does not mutate input when executing command pipeline', () => {
  const core = createCoreWithRealPipeline();
  const input = createInput();
  const before = structuredClone(input);

  core.executeCommand(input);

  assert.deepEqual(input, before);
});