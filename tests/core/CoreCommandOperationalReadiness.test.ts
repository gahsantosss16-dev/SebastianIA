import test from 'node:test';
import assert from 'node:assert/strict';
import { composeCorePipelineDependencies } from '../../core/CorePipelineBootstrap.js';
import { bootstrapCoreOperationalRuntime } from '../../core/CoreOperationalRuntimeBootstrap.js';
import { CoreCommandOperationalReadinessError } from '../../core/CorePipelineIntegrationErrors.js';
import type { CapabilityHandler, CapabilityProvider } from '../../core/capability/index.js';
import type { CommandProcessingInput } from '../../core/command/index.js';
import { SebastianCore } from '../../core/core.js';
import type { Logger } from '../../core/logger.js';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const handler: CapabilityHandler = (invocation) => ({ echoed: invocation.input });
const provider: CapabilityProvider = {
  providerId: 'provider.readiness',
  listRegistrations: () => [
    {
      descriptor: {
        id: 'cap.greeting',
        name: 'Greeting Capability',
        version: '1.0.0',
        handlerId: 'handler.greeting',
      },
      handler,
    },
  ],
};
const composition = {
  providers: [provider],
  bindings: [{ commandType: 'greeting', capabilityId: 'cap.greeting' }],
} as const;

function input(): CommandProcessingInput {
  return {
    type: 'greeting',
    input: { message: 'hello' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  };
}

function createCore(execute?: () => never): SebastianCore {
  const dependencies = execute
    ? {
        executor: { execute },
        bundle: composeCorePipelineDependencies(composition).bundle,
        commandContextHydrator: {
          hydrate: () => ({ status: 'absent' as const }),
        },
        specializedAgent: {
          handoff: async () => ({
            status: 'completed' as const,
            output: { acknowledged: true },
          }),
        },
        commandResultMemoryWriter: {
          write: () => ({
            status: 'recorded' as const,
            key: 'command-results:greeting:2026-07-31T00:00:00.000Z',
            recordedAt: '2026-07-31T00:00:00.000Z',
          }),
        },
      }
    : composeCorePipelineDependencies(composition);
  return new SebastianCore('Sebastian Test', {}, logger, dependencies);
}

async function assertReadinessFailure(core: SebastianCore): Promise<void> {
  await assert.rejects(
    () => core.executeCommand(input()),
    (error: unknown) => {
      assert.ok(error instanceof CoreCommandOperationalReadinessError);
      return true;
    },
  );
}

test('Core rejects commands before initialize', async () => {
  await assertReadinessFailure(createCore());
});

test('Core rejects commands after initialize and before start', async () => {
  const core = createCore();
  core.initialize();

  await assertReadinessFailure(core);
});

test('Core rejects commands when start occurs without initialize', async () => {
  const core = createCore();
  core.start();

  await assertReadinessFailure(core);
});

test('Core rejects commands after shutdown', async () => {
  const core = createCore();
  core.initialize();
  core.start();
  core.shutdown();

  await assertReadinessFailure(core);
});

test('Core rejects commands when status is not ready', async () => {
  const core = createCore();
  core.initialize();
  core.start();
  core.status = 'error';

  await assertReadinessFailure(core);
});

test('readiness rejection does not call executor or mutate input and state', async () => {
  let executionCount = 0;
  const core = createCore(() => {
    executionCount += 1;
    throw new Error('executor must not be called');
  });
  const command = input();
  const inputBefore = structuredClone(command);
  const stateBefore = core.getLifecycleState();

  await assert.rejects(() => core.executeCommand(command), CoreCommandOperationalReadinessError);

  assert.equal(executionCount, 0);
  assert.deepEqual(command, inputBefore);
  assert.deepEqual(core.getLifecycleState(), stateBefore);
});

test('readiness decision is deterministic for the same state', async () => {
  const core = createCore();

  const capture = async (): Promise<Error> => {
    try {
      await core.executeCommand(input());
      assert.fail('Expected readiness failure.');
    } catch (error) {
      assert.ok(error instanceof Error);
      return error;
    }
  };

  const left = await capture();
  const right = await capture();
  assert.equal(left.constructor, right.constructor);
  assert.equal(left.message, right.message);
});

test('ready Core executes a command normally', async () => {
  const core = createCore();
  core.initialize();
  core.start();

  assert.deepEqual(await core.executeCommand(input()), {
    status: 'succeeded',
    output: { echoed: { message: 'hello' } },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
});

test('SPEC-027 bootstrap returns a Core accepted by the readiness gate', async () => {
  const core = bootstrapCoreOperationalRuntime({ composition, logger });

  assert.deepEqual(await core.executeCommand(input()), {
    status: 'succeeded',
    output: { echoed: { message: 'hello' } },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
});
