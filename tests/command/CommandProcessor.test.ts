import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandProcessor } from '../../core/command/CommandProcessor.js';
import { InvalidCommandInputError, UnsupportedCommandTypeError } from '../../core/command/CommandErrors.js';
import { InvalidContextConversationIdError } from '../../core/context/ContextErrors.js';
import { CommandProcessor as CoreCommandProcessor } from '../../core/index.js';

test('CommandProcessor builds a context snapshot and returns a success result', () => {
  const processor = new CommandProcessor();
  const inputPayload = { message: 'hello' };
  const result = processor.process({
    type: 'greeting',
    input: inputPayload,
    generatedAt: '2026-07-31T00:00:00.000Z',
    conversation: {
      conversationId: 'conv-1',
      messages: [{ id: 'm1', role: 'user', content: 'hi', createdAt: '2026-07-31T00:00:00.000Z' }],
    },
    session: {
      conversationId: 'conv-1',
      sessionId: 'session-1',
    },
    configuration: { values: { theme: 'dark' } },
    temporary: { values: { flag: true } },
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.type, 'greeting');
  assert.equal((result.output.input as Record<string, unknown>).message, 'hello');
  assert.equal(result.output.generatedAt, '2026-07-31T00:00:00.000Z');
  assert.equal((result.output.context as { conversationId: string }).conversationId, 'conv-1');
  assert.notEqual(result.output.input, inputPayload);

  (inputPayload as Record<string, unknown>).message = 'changed';
  assert.equal((result.output.input as Record<string, unknown>).message, 'hello');
});

test('CommandProcessor validates missing type', () => {
  const processor = new CommandProcessor();

  assert.throws(
    () =>
      processor.process({
        type: '',
        input: {},
        generatedAt: '2026-07-31T00:00:00.000Z',
      }),
    (error: unknown) => {
      assert.equal((error as { message: string }).message, 'Command type is required.');
      return true;
    },
  );
});

test('CommandProcessor rejects an invalid input shape', () => {
  const processor = new CommandProcessor();

  assert.throws(
    () =>
      processor.process({
        type: 'greeting',
        input: [] as unknown as Record<string, unknown>,
        generatedAt: '2026-07-31T00:00:00.000Z',
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandInputError);
      return true;
    },
  );
});

test('CommandProcessor rejects unsupported command types', () => {
  const processor = new CommandProcessor();

  assert.throws(
    () =>
      processor.process({
        type: 'unknown',
        input: {},
        generatedAt: '2026-07-31T00:00:00.000Z',
      }),
    (error: unknown) => {
      assert.ok(error instanceof UnsupportedCommandTypeError);
      return true;
    },
  );
});

test('CommandProcessor propagates ContextManager errors', () => {
  const processor = new CommandProcessor();

  assert.throws(
    () =>
      processor.process({
        type: 'greeting',
        input: {},
        generatedAt: '2026-07-31T00:00:00.000Z',
        conversation: { conversationId: '' },
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidContextConversationIdError);
      return true;
    },
  );
});

test('CommandProcessor preserves the caller supplied generatedAt', () => {
  const processor = new CommandProcessor();
  const generatedAt = '2026-07-31T12:34:56.000Z';
  const result = processor.process({
    type: 'greeting',
    input: {},
    generatedAt,
  });

  assert.equal(result.generatedAt, generatedAt);
  assert.equal(result.output.generatedAt, generatedAt);
});

test('CommandProcessor produces deterministic results for the same input', () => {
  const processor = new CommandProcessor();
  const first = processor.process({
    type: 'greeting',
    input: { message: 'hello' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });
  const second = processor.process({
    type: 'greeting',
    input: { message: 'hello' },
    generatedAt: '2026-07-31T00:00:00.000Z',
  });

  assert.deepEqual(first, second);
});

test('core public entrypoint exposes CommandProcessor', () => {
  assert.equal(typeof CoreCommandProcessor, 'function');
});

test('CommandProcessor accepts the remember and recall command types', () => {
  const processor = new CommandProcessor();

  const rememberResult = processor.process({
    type: 'remember',
    input: { text: 'prefiro reuniões de manhã' },
    generatedAt: '2026-08-11T00:00:00.000Z',
  });
  const recallResult = processor.process({
    type: 'recall',
    input: {},
    generatedAt: '2026-08-11T00:00:01.000Z',
  });

  assert.equal(rememberResult.status, 'succeeded');
  assert.equal(rememberResult.output.type, 'remember');
  assert.equal(recallResult.status, 'succeeded');
  assert.equal(recallResult.output.type, 'recall');
});

test('CommandProcessor accepts the converse command type', () => {
  const processor = new CommandProcessor();

  const result = processor.process({
    type: 'converse',
    input: { text: 'Sebastian, lembra que prefiro reuniões de manhã' },
    generatedAt: '2026-08-11T00:00:00.000Z',
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.type, 'converse');
});
