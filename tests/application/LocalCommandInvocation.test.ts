import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalCommandInvocationAdapter,
  runLocalCommand,
  type LocalCommandProcessOutput,
} from '../../application/LocalCommandInvocation.js';
import { InvalidLocalCommandArgumentsError } from '../../application/LocalCommandInvocationErrors.js';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import type { CapabilityResult } from '../../core/capability/index.js';
import type { CommandProcessingInput } from '../../core/command/index.js';

const fixedDate = new Date('2026-07-31T12:00:00.000Z');
const expectedResult: CapabilityResult = {
  status: 'succeeded',
  output: { message: 'Hello, Gabriel!' },
  generatedAt: fixedDate.toISOString(),
};

function createOutputCapture(): {
  output: LocalCommandProcessOutput;
  stdout: string[];
  stderr: string[];
} {
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

test('adapter maps greeting without name to CommandProcessingInput', () => {
  let received: CommandProcessingInput | undefined;
  const adapter = new LocalCommandInvocationAdapter({
    now: () => fixedDate,
    createApplication: () => ({
      executeCommand: (input) => {
        received = input;
        return { ...expectedResult, output: { message: 'Hello!' } };
      },
    }),
  });

  adapter.execute(['greeting']);

  assert.deepEqual(received, {
    type: 'greeting',
    input: {},
    generatedAt: fixedDate.toISOString(),
  });
});

test('adapter maps greeting name and executes exactly once', () => {
  let executionCount = 0;
  const adapter = new LocalCommandInvocationAdapter({
    now: () => fixedDate,
    createApplication: () => ({
      executeCommand: (input) => {
        executionCount += 1;
        assert.deepEqual(input.input, { name: 'Gabriel' });
        return expectedResult;
      },
    }),
  });

  assert.equal(adapter.execute(['greeting', 'Gabriel']), expectedResult);
  assert.equal(executionCount, 1);
});

test('adapter rejects missing, unknown and excessive arguments with typed errors', () => {
  const adapter = new LocalCommandInvocationAdapter();

  assert.throws(() => adapter.execute([]), InvalidLocalCommandArgumentsError);
  assert.throws(() => adapter.execute(['unknown']), InvalidLocalCommandArgumentsError);
  assert.throws(
    () => adapter.execute(['greeting', 'Gabriel', 'extra']),
    InvalidLocalCommandArgumentsError,
  );
});

test('invalid arguments prevent clock access and runtime creation', () => {
  let clockCount = 0;
  let creationCount = 0;
  const adapter = new LocalCommandInvocationAdapter({
    now: () => {
      clockCount += 1;
      return fixedDate;
    },
    createApplication: () => {
      creationCount += 1;
      return createSebastianApplication();
    },
  });

  assert.throws(() => adapter.execute(['unknown']), InvalidLocalCommandArgumentsError);
  assert.equal(clockCount, 0);
  assert.equal(creationCount, 0);
});

test('valid invocation consults the clock exactly once', () => {
  let clockCount = 0;
  const adapter = new LocalCommandInvocationAdapter({
    now: () => {
      clockCount += 1;
      return fixedDate;
    },
    createApplication: () => ({ executeCommand: () => expectedResult }),
  });

  adapter.execute(['greeting']);

  assert.equal(clockCount, 1);
});

test('runner writes result JSON only to stdout and returns zero', () => {
  const capture = createOutputCapture();
  const adapter = new LocalCommandInvocationAdapter({
    now: () => fixedDate,
    createApplication: () => ({ executeCommand: () => expectedResult }),
  });

  const exitCode = runLocalCommand(['greeting', 'Gabriel'], capture.output, adapter);

  assert.equal(exitCode, 0);
  assert.deepEqual(capture.stdout, [`${JSON.stringify(expectedResult)}\n`]);
  assert.deepEqual(capture.stderr, []);
});

test('runner writes typed failure JSON only to stderr and returns one', () => {
  const capture = createOutputCapture();

  const exitCode = runLocalCommand([], capture.output);

  assert.equal(exitCode, 1);
  assert.deepEqual(capture.stdout, []);
  assert.deepEqual(JSON.parse(capture.stderr[0] ?? '{}'), {
    name: 'InvalidLocalCommandArgumentsError',
    message: 'Command type is required. Usage: greeting [name].',
    code: 'INVALID_ARGUMENT',
  });
});

test('runner normalizes non-Error throwables', () => {
  const capture = createOutputCapture();
  const adapter = {
    execute: () => {
      throw 'non-error failure';
    },
  } as unknown as LocalCommandInvocationAdapter;

  const exitCode = runLocalCommand(['greeting'], capture.output, adapter);

  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(capture.stderr[0] ?? '{}'), {
    name: 'UnknownError',
    message: 'non-error failure',
  });
});

test('adapter is deterministic with identical arguments and fixed clock', () => {
  const adapter = new LocalCommandInvocationAdapter({
    now: () => fixedDate,
    createApplication: () => ({ executeCommand: () => expectedResult }),
  });

  assert.deepEqual(adapter.execute(['greeting', 'Gabriel']), adapter.execute(['greeting', 'Gabriel']));
});

test('adapter executes through the real SPEC-029 composition root', () => {
  const adapter = new LocalCommandInvocationAdapter({ now: () => fixedDate });

  assert.deepEqual(adapter.execute(['greeting', 'Gabriel']), expectedResult);
});
