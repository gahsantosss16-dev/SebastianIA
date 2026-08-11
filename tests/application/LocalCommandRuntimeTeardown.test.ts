import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalCommandInvocationAdapter,
  runLocalCommand,
  type LocalCommandProcessOutput,
} from '../../application/LocalCommandInvocation.js';
import {
  InvalidLocalCommandArgumentsError,
  LocalCommandExecutionAndShutdownError,
  LocalCommandRuntimeShutdownError,
} from '../../application/LocalCommandInvocationErrors.js';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import type { CapabilityResult } from '../../core/capability/index.js';
import type { Logger } from '../../core/logger.js';

const fixedDate = new Date('2026-07-31T12:00:00.000Z');
const result: CapabilityResult = {
  status: 'succeeded',
  output: { message: 'Hello!' },
  generatedAt: fixedDate.toISOString(),
};
const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function outputCapture(): { output: LocalCommandProcessOutput; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    output: {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    },
    stdout,
    stderr,
  };
}

test('adapter executes then shuts down exactly once before returning result', async () => {
  const events: string[] = [];
  const adapter = new LocalCommandInvocationAdapter({
    now: () => fixedDate,
    createApplication: () => ({
      executeCommand: async () => {
        events.push('execute');
        return result;
      },
      shutdown: () => events.push('shutdown'),
    }),
  });

  assert.equal(await adapter.execute(['greeting']), result);
  assert.deepEqual(events, ['execute', 'shutdown']);
});

test('execution failure still shuts down exactly once and preserves original failure', async () => {
  const executionFailure = new Error('execution failure');
  let shutdownCount = 0;
  const adapter = new LocalCommandInvocationAdapter({
    now: () => fixedDate,
    createApplication: () => ({
      executeCommand: async () => {
        throw executionFailure;
      },
      shutdown: () => {
        shutdownCount += 1;
      },
    }),
  });

  await assert.rejects(() => adapter.execute(['greeting']), (error) => error === executionFailure);
  assert.equal(shutdownCount, 1);
});

test('shutdown failure after success is typed and preserves cause', async () => {
  const shutdownFailure = new Error('shutdown failure');
  const adapter = new LocalCommandInvocationAdapter({
    now: () => fixedDate,
    createApplication: () => ({
      executeCommand: async () => result,
      shutdown: () => {
        throw shutdownFailure;
      },
    }),
  });

  await assert.rejects(
    () => adapter.execute(['greeting']),
    (error: unknown) => {
      assert.ok(error instanceof LocalCommandRuntimeShutdownError);
      assert.equal(error.cause, shutdownFailure);
      return true;
    },
  );
});

test('combined execution and shutdown failure preserves both causes', async () => {
  const executionFailure = new Error('execution failure');
  const shutdownFailure = new Error('shutdown failure');
  const adapter = new LocalCommandInvocationAdapter({
    now: () => fixedDate,
    createApplication: () => ({
      executeCommand: async () => {
        throw executionFailure;
      },
      shutdown: () => {
        throw shutdownFailure;
      },
    }),
  });

  await assert.rejects(
    () => adapter.execute(['greeting']),
    (error: unknown) => {
      assert.ok(error instanceof LocalCommandExecutionAndShutdownError);
      assert.equal(error.cause, executionFailure);
      assert.equal(error.shutdownCause, shutdownFailure);
      return true;
    },
  );
});

test('combined failure preserves non-Error causes', async () => {
  const adapter = new LocalCommandInvocationAdapter({
    now: () => fixedDate,
    createApplication: () => ({
      executeCommand: async () => {
        throw 'execution throwable';
      },
      shutdown: () => {
        throw 'shutdown throwable';
      },
    }),
  });

  await assert.rejects(
    () => adapter.execute(['greeting']),
    (error: unknown) => {
      assert.ok(error instanceof LocalCommandExecutionAndShutdownError);
      assert.equal(error.cause, 'execution throwable');
      assert.equal(error.shutdownCause, 'shutdown throwable');
      return true;
    },
  );
});

test('invalid arguments do not create or shut down a runtime', async () => {
  let creationCount = 0;
  let shutdownCount = 0;
  const adapter = new LocalCommandInvocationAdapter({
    createApplication: () => {
      creationCount += 1;
      return {
        executeCommand: async () => result,
        shutdown: () => {
          shutdownCount += 1;
        },
      };
    },
  });

  await assert.rejects(() => adapter.execute([]), InvalidLocalCommandArgumentsError);
  assert.equal(creationCount, 0);
  assert.equal(shutdownCount, 0);
});

test('runner emits no stdout and returns one when shutdown fails', async () => {
  const capture = outputCapture();
  const adapter = new LocalCommandInvocationAdapter({
    now: () => fixedDate,
    createApplication: () => ({
      executeCommand: async () => result,
      shutdown: () => {
        throw new Error('shutdown failure');
      },
    }),
  });

  const exitCode = await runLocalCommand(['greeting'], capture.output, adapter);

  assert.equal(exitCode, 1);
  assert.deepEqual(capture.stdout, []);
  assert.equal(JSON.parse(capture.stderr[0] ?? '{}').name, 'LocalCommandRuntimeShutdownError');
});

test('real SPEC-029 runtime is shut down after invocation', async () => {
  const core = createSebastianApplication({ logger });
  const adapter = new LocalCommandInvocationAdapter({
    now: () => fixedDate,
    createApplication: () => core,
  });

  assert.deepEqual((await adapter.execute(['greeting'])).output, { message: 'Hello!' });
  assert.deepEqual(core.getLifecycleState(), {
    initialized: true,
    started: true,
    shutDown: true,
  });
  assert.equal(core.status, 'idle');
});

test('teardown behavior is deterministic for equivalent runtimes', async () => {
  const execute = async (): Promise<{ returned: CapabilityResult; shutdownCount: number }> => {
    let shutdownCount = 0;
    const adapter = new LocalCommandInvocationAdapter({
      now: () => fixedDate,
      createApplication: () => ({
        executeCommand: async () => result,
        shutdown: () => {
          shutdownCount += 1;
        },
      }),
    });
    return { returned: await adapter.execute(['greeting']), shutdownCount };
  };

  assert.deepEqual(await execute(), await execute());
});
