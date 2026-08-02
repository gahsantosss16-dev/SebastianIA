import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryCommandContextHydrator,
  InvalidCommandContextHydrationRequestError,
} from '../../core/memory/index.js';

test('command context hydrator returns absent when no context exists', () => {
  const hydrator = new InMemoryCommandContextHydrator();

  const outcome = hydrator.hydrate({
    commandType: 'greeting',
    generatedAt: '2026-08-02T00:00:00.000Z',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
  });

  assert.deepEqual(outcome, { status: 'absent' });
});

test('command context hydrator returns hydrated context when snapshot exists', () => {
  const hydrator = new InMemoryCommandContextHydrator();

  hydrator.prime('conversation-1', 'session-1', {
    conversation: {
      conversationId: 'conversation-1',
      messages: [],
      decisions: [],
      pendingTasks: [],
    },
    session: {
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      messages: [],
      decisions: [],
      pendingTasks: [],
    },
    configuration: {
      values: {
        locale: 'pt-BR',
      },
    },
  });

  const outcome = hydrator.hydrate({
    commandType: 'greeting',
    generatedAt: '2026-08-02T00:00:00.000Z',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
  });

  assert.equal(outcome.status, 'hydrated');
  if (outcome.status !== 'hydrated') {
    assert.fail('Expected hydrated status.');
  }

  assert.deepEqual(outcome.context, {
    conversation: {
      conversationId: 'conversation-1',
      messages: [],
      decisions: [],
      pendingTasks: [],
    },
    session: {
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      messages: [],
      decisions: [],
      pendingTasks: [],
    },
    configuration: {
      values: {
        locale: 'pt-BR',
      },
    },
  });
});

test('command context hydrator rejects invalid request with typed error', () => {
  const hydrator = new InMemoryCommandContextHydrator();

  assert.throws(
    () => hydrator.hydrate(null as never),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandContextHydrationRequestError);
      return true;
    },
  );

  assert.throws(
    () =>
      hydrator.hydrate({
        commandType: '   ',
        generatedAt: '2026-08-02T00:00:00.000Z',
      }),
    (error: unknown) => {
      assert.ok(error instanceof InvalidCommandContextHydrationRequestError);
      return true;
    },
  );
});

test('command context hydrator does not expose mutable internal references', () => {
  const hydrator = new InMemoryCommandContextHydrator();

  hydrator.prime('conversation-1', 'session-1', {
    configuration: {
      values: {
        locale: 'pt-BR',
      },
    },
  });

  const first = hydrator.hydrate({
    commandType: 'greeting',
    generatedAt: '2026-08-02T00:00:00.000Z',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
  });

  assert.equal(first.status, 'hydrated');
  if (first.status !== 'hydrated') {
    assert.fail('Expected hydrated status.');
  }

  const firstConfiguration = first.context.configuration as { values: Record<string, unknown> };
  firstConfiguration.values.locale = 'en-US';

  const second = hydrator.hydrate({
    commandType: 'greeting',
    generatedAt: '2026-08-02T00:00:00.000Z',
    conversationId: 'conversation-1',
    sessionId: 'session-1',
  });

  assert.equal(second.status, 'hydrated');
  if (second.status !== 'hydrated') {
    assert.fail('Expected hydrated status.');
  }

  assert.deepEqual(second.context.configuration, {
    values: {
      locale: 'pt-BR',
    },
  });
});
