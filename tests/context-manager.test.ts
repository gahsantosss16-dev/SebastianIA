import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ContextManager,
  InvalidContextConversationIdError,
  InvalidContextInputError,
  InvalidContextSessionIdError,
} from '../core/context/index.js';

test('builds a deterministic snapshot from conversation, session, configuration and temporary fragments', () => {
  const manager = new ContextManager();

  const input = {
    generatedAt: '2026-07-30T10:00:00.000Z',
    conversation: {
      conversationId: 'conversation-1',
      messages: [{ id: 'm1', role: 'user', content: 'Hello', createdAt: '2026-07-30T09:59:00.000Z' }],
      decisions: [{ id: 'd1', summary: 'Approved', createdAt: '2026-07-30T09:59:30.000Z' }],
      pendingTasks: [{ id: 't1', description: 'Follow up', status: 'pending', createdAt: '2026-07-30T09:59:45.000Z' }],
      summary: { id: 's1', content: 'Summary', createdAt: '2026-07-30T10:00:00.000Z' },
    },
    session: {
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      messages: [{ id: 'm2', role: 'assistant', content: 'Hi there', createdAt: '2026-07-30T09:59:10.000Z' }],
      decisions: [{ id: 'd2', summary: 'Replied', createdAt: '2026-07-30T09:59:35.000Z' }],
      pendingTasks: [{ id: 't2', description: 'Send note', status: 'pending', createdAt: '2026-07-30T09:59:50.000Z' }],
      summary: { id: 's2', content: 'Session summary', createdAt: '2026-07-30T10:00:05.000Z' },
    },
    configuration: {
      values: { model: 'gpt-4o', mode: 'fast' },
    },
    temporary: {
      values: { activeTool: 'search', turn: 2 },
    },
  };

  const snapshot = manager.buildSnapshot(input);

  assert.equal(snapshot.conversationId, 'conversation-1');
  assert.equal(snapshot.sessionId, 'session-1');
  assert.equal(snapshot.generatedAt, input.generatedAt);
  assert.equal(snapshot.messages.length, 2);
  assert.equal(snapshot.decisions.length, 2);
  assert.equal(snapshot.pendingTasks.length, 2);
  assert.equal(snapshot.summary?.content, 'Summary');
  assert.equal(snapshot.configuration?.model, 'gpt-4o');
  assert.equal(snapshot.temporary?.activeTool, 'search');
});

test('rejects invalid conversation and session ids', () => {
  const manager = new ContextManager();

  assert.throws(() => manager.buildSnapshot({
    generatedAt: '2026-07-30T10:00:00.000Z',
    conversation: { conversationId: '   ' },
    session: { conversationId: 'conversation-1', sessionId: 'session-1' },
  }), InvalidContextConversationIdError);

  assert.throws(() => manager.buildSnapshot({
    generatedAt: '2026-07-30T10:00:00.000Z',
    conversation: { conversationId: 'conversation-1' },
    session: { conversationId: 'conversation-1', sessionId: '   ' },
  }), InvalidContextSessionIdError);
});

test('rejects mismatched conversation ids between fragments', () => {
  const manager = new ContextManager();

  assert.throws(() => manager.buildSnapshot({
    generatedAt: '2026-07-30T10:00:00.000Z',
    conversation: { conversationId: 'conversation-1' },
    session: { conversationId: 'conversation-2', sessionId: 'session-1' },
  }), InvalidContextInputError);
});

test('preserves the original ordering of messages, decisions and tasks and does not retain state between calls', () => {
  const manager = new ContextManager();
  const input = {
    generatedAt: '2026-07-30T10:00:00.000Z',
    conversation: {
      conversationId: 'conversation-1',
      messages: [{ id: 'm1', role: 'user', content: 'first', createdAt: '2026-07-30T09:59:00.000Z' }],
      decisions: [{ id: 'd1', summary: 'first decision', createdAt: '2026-07-30T09:59:10.000Z' }],
      pendingTasks: [{ id: 't1', description: 'first task', status: 'pending', createdAt: '2026-07-30T09:59:20.000Z' }],
    },
    session: {
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      messages: [{ id: 'm2', role: 'assistant', content: 'second', createdAt: '2026-07-30T09:59:30.000Z' }],
      decisions: [{ id: 'd2', summary: 'second decision', createdAt: '2026-07-30T09:59:40.000Z' }],
      pendingTasks: [{ id: 't2', description: 'second task', status: 'pending', createdAt: '2026-07-30T09:59:50.000Z' }],
    },
  };

  const first = manager.buildSnapshot(input);
  const second = manager.buildSnapshot({ ...input, generatedAt: '2026-07-30T10:00:01.000Z' });

  assert.deepEqual(first.messages.map((item) => item.content), ['first', 'second']);
  assert.deepEqual(first.decisions.map((item) => item.summary), ['first decision', 'second decision']);
  assert.deepEqual(first.pendingTasks.map((item) => item.description), ['first task', 'second task']);
  assert.deepEqual(second.messages.map((item) => item.content), ['first', 'second']);
  assert.equal(second.messages.length, 2);
  assert.equal(first.messages.length, 2);
});

test('returns an immutable snapshot that does not share mutable references with the input', () => {
  const manager = new ContextManager();
  const input = {
    generatedAt: '2026-07-30T10:00:00.000Z',
    conversation: {
      conversationId: 'conversation-1',
      messages: [{ id: 'm1', role: 'user', content: 'Hello', createdAt: '2026-07-30T09:59:00.000Z' }],
    },
    session: {
      conversationId: 'conversation-1',
      sessionId: 'session-1',
    },
  };

  const snapshot = manager.buildSnapshot(input);

  assert.throws(() => {
    (snapshot.messages as unknown[]).push({ id: 'm2', role: 'assistant', content: 'Nope', createdAt: '2026-07-30T09:59:10.000Z' });
  });

  input.conversation.messages?.push({ id: 'm2', role: 'assistant', content: 'Mutated', createdAt: '2026-07-30T09:59:10.000Z' });

  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0]?.content, 'Hello');
});
