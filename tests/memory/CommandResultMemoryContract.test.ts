import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryCommandResultMemoryWriter,
  InvalidCommandResultMemoryWriteBackInputError,
} from '../../core/memory/index.js';

function validInput() {
  return {
    executionId: 'greeting:2026-07-31T00:00:00.000Z',
    commandType: 'greeting',
    commandGeneratedAt: '2026-07-31T00:00:00.000Z',
    resultGeneratedAt: '2026-07-31T00:00:01.000Z',
    resultStatus: 'succeeded',
    output: { echoed: { message: 'hello' } },
    metadata: {
      conversationId: 'conversation-1',
      sessionId: 'session-1',
    },
  } as const;
}

test('command result memory writer records a valid write-back payload', () => {
  const writer = new InMemoryCommandResultMemoryWriter();

  const outcome = writer.write(validInput());

  assert.equal(outcome.status, 'recorded');
  assert.equal(
    outcome.key,
    'command-results:greeting:2026-07-31T00:00:00.000Z',
  );
  assert.equal(typeof outcome.recordedAt, 'string');
});

test('command result memory writer rejects invalid payloads with typed errors', () => {
  const writer = new InMemoryCommandResultMemoryWriter();

  assert.throws(
    () => writer.write(null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandResultMemoryWriteBackInputError);
      return true;
    },
  );

  assert.throws(
    () => writer.write({ ...validInput(), executionId: '   ' }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandResultMemoryWriteBackInputError);
      return true;
    },
  );
});

test('command result memory writer does not mutate write-back payload', () => {
  const writer = new InMemoryCommandResultMemoryWriter();
  const input = {
    ...validInput(),
    output: {
      echoed: { message: 'hello' },
      nested: { enabled: true },
    },
  };
  const before = structuredClone(input);

  writer.write(input);

  assert.deepEqual(input, before);
});

test('command result memory writer is deterministic for identical write-back input', () => {
  const writer = new InMemoryCommandResultMemoryWriter();
  const input = validInput();

  const left = writer.write(input);
  const right = writer.write(input);

  assert.equal(left.status, 'recorded');
  assert.equal(right.status, 'recorded');
  assert.equal(left.key, right.key);
});
