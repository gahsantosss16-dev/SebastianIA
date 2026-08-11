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
  CoreCommandContextHydrationDependencyUnavailableError,
  CoreCommandContextHydrationError,
  CorePipelineDependencyUnavailableError,
  CoreCommandResultMemoryDependencyUnavailableError,
  CoreCommandResultMemoryWriteBackError,
  CorePipelineExecutionError,
  CoreSpecializedAgentDependencyUnavailableError,
  CoreSpecializedAgentFinalResultInvalidError,
  CoreSpecializedAgentHandoffError,
  InvalidCoreCommandInputError,
} from '../../core/CorePipelineIntegrationErrors.js';
import type { SpecializedAgent } from '../../core/agent/SpecializedAgentHandoffContract.js';
import type { CommandContextHydrator } from '../../core/memory/CommandContextHydrationContract.js';
import type { CommandResultMemoryWriter } from '../../core/memory/CommandResultMemoryContract.js';
import { InvalidCommandCapabilityPipelineInputError } from '../../core/capability/CommandCapabilityPipelineExecutorErrors.js';

const successfulHydrator: CommandContextHydrator = {
  hydrate: () => ({ status: 'absent' }),
};

const successfulSpecializedAgent: SpecializedAgent = {
  handoff: async () => ({
    status: 'completed',
    output: { acknowledged: true },
  }),
};

const successfulWriteBackWriter: CommandResultMemoryWriter = {
  write: () => ({
    status: 'recorded',
    key: 'command-results:greeting:2026-07-31T00:00:00.000Z',
    recordedAt: '2026-07-31T00:00:00.000Z',
  }),
};

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
    commandContextHydrator: successfulHydrator,
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();
  return core;
}

test('Core executes command successfully through public API', async () => {
  const core = createCoreWithRealPipeline();

  const result = await core.executeCommand(createInput());

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

test('Core rejects invalid command input with typed error', async () => {
  const core = createCoreWithRealPipeline();

  await assert.rejects(
    () => core.executeCommand(null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCoreCommandInputError);
      return true;
    },
  );
});

test('Core rejects unavailable pipeline dependencies with typed error', async () => {
  const core = new SebastianCore();
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CorePipelineDependencyUnavailableError);
      return true;
    },
  );
});

test('Core rejects invalid executor dependency contract with typed error', async () => {
  const bundle = createBundle();
  const invalidExecutor = {} as unknown as { execute: never };
  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor: invalidExecutor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: successfulWriteBackWriter,
  } as never);
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CorePipelineDependencyUnavailableError);
      return true;
    },
  );
});

test('Core propagates typed errors from pipeline executor', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => {
      throw new InvalidCommandCapabilityPipelineInputError('Pipeline typed failure.');
    },
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandCapabilityPipelineInputError);
      return true;
    },
  );
});

test('Core wraps non-Error throwables from pipeline executor in typed core error', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => {
      throw 'non-error throwable';
    },
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CorePipelineExecutionError);
      return true;
    },
  );
});

test('Core delegates command execution directly to pipeline executor', async () => {
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
    commandContextHydrator: successfulHydrator,
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  const input = createInput();
  const result = await core.executeCommand(input);

  assert.equal(called, true);
  assert.equal(receivedInput, input);
  assert.equal(receivedBundle, bundle);
  assert.equal(result, expectedResult);
});

test('Core executes a single specialized agent handoff after command execution', async () => {
  const bundle = createBundle();
  let handoffCount = 0;
  let handoffPayload: unknown;
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };
  const specializedAgent: SpecializedAgent = {
    handoff: async (input) => {
      handoffCount += 1;
      handoffPayload = input;
      return {
        status: 'completed',
        output: { delegated: true },
      };
    },
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent,
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  await core.executeCommand(createInput());

  assert.equal(handoffCount, 1);
  assert.deepEqual(handoffPayload, {
    responsibilityId: 'capability.execute.greeting',
    executionId: 'greeting:2026-07-31T00:00:00.000Z',
    commandType: 'greeting',
    requestedAt: '2026-07-31T01:00:00.000Z',
    payload: {
      commandInput: createInput(),
      commandResult: {
        status: 'succeeded',
        output: { delegated: true },
        generatedAt: '2026-07-31T01:00:00.000Z',
      },
    },
  });
});

test('Core rejects missing specialized agent dependency contract with typed error', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: {} as never,
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CoreSpecializedAgentDependencyUnavailableError);
      return true;
    },
  );
});

test('Core propagates specialized agent handoff failure as typed core error', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: {
      handoff: async () => ({
        status: 'failed',
        error: new Error('handoff failed'),
      }),
    },
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CoreSpecializedAgentHandoffError);
      return true;
    },
  );
});

test('Core adopts a valid finalResult from the agent as the effective result', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: {
      handoff: async () => ({
        status: 'completed',
        output: { finalResult: { message: 'agent-provided answer' } },
      }),
    },
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  const result = await core.executeCommand(createInput());

  assert.deepEqual(result, {
    status: 'succeeded',
    output: { message: 'agent-provided answer' },
    generatedAt: '2026-07-31T01:00:00.000Z',
  });
});

test('Core write-back receives the agent finalResult output, not the original capability output', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };
  let writtenOutput: unknown;
  const writer: CommandResultMemoryWriter = {
    write: (input) => {
      writtenOutput = input.output;
      return { status: 'recorded', key: 'k', recordedAt: '2026-07-31T01:00:01.000Z' };
    },
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: {
      handoff: async () => ({
        status: 'completed',
        output: { finalResult: { message: 'agent-provided answer' } },
      }),
    },
    commandResultMemoryWriter: writer,
  });
  core.initialize();
  core.start();

  await core.executeCommand(createInput());

  assert.deepEqual(writtenOutput, { message: 'agent-provided answer' });
});

test('Core preserves the capability result unchanged when the agent does not provide a finalResult', async () => {
  const core = createCoreWithRealPipeline();

  const result = await core.executeCommand(createInput());

  assert.deepEqual(result.output, {
    echoed: { message: 'hello' },
    source: result.output.source,
  });
});

test('Core rejects an invalid finalResult (array) with a typed error and does not write back', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };
  let writeCount = 0;
  const writer: CommandResultMemoryWriter = {
    write: () => {
      writeCount += 1;
      return { status: 'recorded', key: 'k', recordedAt: '2026-07-31T01:00:01.000Z' };
    },
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: {
      handoff: async () => ({
        status: 'completed',
        output: { finalResult: ['not', 'an', 'object'] },
      }),
    },
    commandResultMemoryWriter: writer,
  });
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CoreSpecializedAgentFinalResultInvalidError);
      return true;
    },
  );
  assert.equal(writeCount, 0);
});

test('Core rejects an invalid finalResult (null) with a typed error', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: {
      handoff: async () => ({
        status: 'completed',
        output: { finalResult: null },
      }),
    },
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CoreSpecializedAgentFinalResultInvalidError);
      return true;
    },
  );
});

test('Core rejects missing memory writer dependency contract with typed error', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: {} as never,
  });
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CoreCommandResultMemoryDependencyUnavailableError);
      return true;
    },
  );
});

test('Core writes validated command result to memory after successful execution', async () => {
  const bundle = createBundle();
  let called = false;
  let captured: unknown;
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };

  const writer: CommandResultMemoryWriter = {
    write: (input) => {
      called = true;
      captured = input;
      return {
        status: 'recorded',
        key: 'command-results:greeting:2026-07-31T00:00:00.000Z',
        recordedAt: '2026-07-31T01:00:01.000Z',
      };
    },
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: writer,
  });
  core.initialize();
  core.start();

  const input = createInput();
  await core.executeCommand(input);

  assert.equal(called, true);
  assert.deepEqual(captured, {
    executionId: 'greeting:2026-07-31T00:00:00.000Z',
    commandType: 'greeting',
    commandGeneratedAt: '2026-07-31T00:00:00.000Z',
    resultGeneratedAt: '2026-07-31T01:00:00.000Z',
    resultStatus: 'succeeded',
    output: { delegated: true },
    metadata: {
      conversationId: 'conversation-1',
      sessionId: 'session-1',
    },
  });
});

test('Core propagates typed memory write-back failure as typed core write-back error', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };

  const writer: CommandResultMemoryWriter = {
    write: () => ({
      status: 'failed',
      error: new Error('write-back failed'),
    }),
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: writer,
  });
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CoreCommandResultMemoryWriteBackError);
      return true;
    },
  );
});

test('Core hydrates context before pipeline execution when hydration is available', async () => {
  const bundle = createBundle();
  let receivedInput: CommandProcessingInput | undefined;
  const executor = {
    execute: (input: CommandProcessingInput) => {
      receivedInput = input;
      return {
        status: 'succeeded' as const,
        output: { delegated: true },
        generatedAt: '2026-07-31T01:00:00.000Z',
      };
    },
  };

  const hydrator: CommandContextHydrator = {
    hydrate: () => ({
      status: 'hydrated',
      context: {
        conversation: {
          conversationId: 'conversation-hydrated',
          messages: [],
          decisions: [],
          pendingTasks: [],
        },
        session: {
          conversationId: 'conversation-hydrated',
          sessionId: 'session-hydrated',
          messages: [],
          decisions: [],
          pendingTasks: [],
        },
      },
    }),
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: hydrator,
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  const input: CommandProcessingInput = {
    type: 'greeting',
    input: { message: 'hello' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };

  await core.executeCommand(input);

  assert.deepEqual(receivedInput, {
    ...input,
    conversation: {
      conversationId: 'conversation-hydrated',
      messages: [],
      decisions: [],
      pendingTasks: [],
    },
    session: {
      conversationId: 'conversation-hydrated',
      sessionId: 'session-hydrated',
      messages: [],
      decisions: [],
      pendingTasks: [],
    },
  });
});

test('Core keeps original input when hydration returns absent', async () => {
  const bundle = createBundle();
  let receivedInput: CommandProcessingInput | undefined;
  const executor = {
    execute: (input: CommandProcessingInput) => {
      receivedInput = input;
      return {
        status: 'succeeded' as const,
        output: { delegated: true },
        generatedAt: '2026-07-31T01:00:00.000Z',
      };
    },
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: successfulHydrator,
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  const input = createInput();
  await core.executeCommand(input);

  assert.equal(receivedInput, input);
});

test('Core rejects missing context hydrator dependency contract with typed error', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: {} as never,
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CoreCommandContextHydrationDependencyUnavailableError);
      return true;
    },
  );
});

test('Core propagates typed context hydration failure as typed core hydration error', async () => {
  const bundle = createBundle();
  const executor = {
    execute: () => ({
      status: 'succeeded' as const,
      output: { delegated: true },
      generatedAt: '2026-07-31T01:00:00.000Z',
    }),
  };

  const core = new SebastianCore('Sebastian IA', {}, undefined, {
    executor,
    bundle,
    commandContextHydrator: {
      hydrate: () => ({ status: 'failed', error: new Error('hydration failed') }),
    },
    specializedAgent: successfulSpecializedAgent,
    commandResultMemoryWriter: successfulWriteBackWriter,
  });
  core.initialize();
  core.start();

  await assert.rejects(
    () => core.executeCommand(createInput()),
    (error: unknown) => {
      assert.ok(error instanceof CoreCommandContextHydrationError);
      return true;
    },
  );
});

test('Core command execution is deterministic for identical inputs and bundle', async () => {
  const core = createCoreWithRealPipeline();
  const input = createInput();

  const left = await core.executeCommand(input);
  const right = await core.executeCommand(input);

  assert.deepEqual(left, right);
});

test('Core does not mutate input when executing command pipeline', async () => {
  const core = createCoreWithRealPipeline();
  const input = createInput();
  const before = structuredClone(input);

  await core.executeCommand(input);

  assert.deepEqual(input, before);
});
