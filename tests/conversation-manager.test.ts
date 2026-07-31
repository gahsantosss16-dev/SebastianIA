import assert from 'node:assert/strict';
import test from 'node:test';

import { ConversationManager } from '../core/conversation/ConversationManager.js';
import { ConversationNotFoundError, InvalidConversationIdError, InvalidSessionIdError, PendingTaskNotFoundError, SessionNotFoundError } from '../core/conversation/ConversationErrors.js';
import { MemoryManager } from '../core/memory/MemoryManager.js';

test('creates and retrieves a conversation', async () => {
  const manager = new ConversationManager(new MemoryManager());

  const conversation = await manager.createConversation({ title: 'Welcome' });
  const fetched = await manager.getConversation(conversation.id);

  assert.ok(conversation.id.startsWith('conversation-'));
  assert.equal(fetched?.title, 'Welcome');
  assert.equal(fetched?.status, 'active');
});

test('creates sessions and closes them', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const conversation = await manager.createConversation();

  const session = await manager.createSession(conversation.id, { metadata: { source: 'test' } });
  const fetched = await manager.getSession(conversation.id, session.id);

  assert.equal(fetched?.conversationId, conversation.id);
  assert.equal(fetched?.status, 'active');

  const closed = await manager.closeSession(conversation.id, session.id);
  assert.equal(closed, true);

  const closedSession = await manager.getSession(conversation.id, session.id);
  assert.equal(closedSession?.status, 'closed');
  assert.ok(closedSession?.closedAt);
});

test('stores messages, decisions, pending tasks and summaries for a session', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const conversation = await manager.createConversation();
  const session = await manager.createSession(conversation.id);

  const message = await manager.appendMessage(conversation.id, session.id, { role: 'user', content: 'Hello' });
  const decision = await manager.recordDecision(conversation.id, session.id, { kind: 'approve', summary: 'Approved' });
  const task = await manager.addPendingTask(conversation.id, session.id, { title: 'Follow up' });
  const summary = await manager.saveSummary(conversation.id, session.id, { content: 'Summary' });

  assert.equal(message.role, 'user');
  assert.equal(task.status, 'pending');
  assert.equal(decision.kind, 'approve');
  assert.equal(summary.content, 'Summary');

  const messages = await manager.getMessages(conversation.id, session.id);
  const decisions = await manager.getDecisions(conversation.id, session.id);
  const tasks = await manager.getPendingTasks(conversation.id, session.id);
  const latestSummary = await manager.getLatestSummary(conversation.id, session.id);

  assert.equal(messages.length, 1);
  assert.equal(decisions.length, 1);
  assert.equal(tasks.length, 1);
  assert.equal(latestSummary?.content, 'Summary');
});

test('supports listing and removing conversations with cascading namespace cleanup', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const first = await manager.createConversation({ title: 'First' });
  const second = await manager.createConversation({ title: 'Second' });

  await manager.createSession(first.id);
  await manager.createSession(second.id);

  const listed = await manager.listConversations();
  assert.equal(listed.length, 2);

  const removed = await manager.removeConversation(first.id);
  assert.equal(removed, true);

  const remaining = await manager.listConversations();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.id, second.id);
});

test('rejects invalid conversation and session ids', async () => {
  const manager = new ConversationManager(new MemoryManager());

  await assert.rejects(() => manager.getConversation('   '), InvalidConversationIdError);
  await assert.rejects(() => manager.createSession('   '), InvalidConversationIdError);
  await assert.rejects(() => manager.getSession('conversation-1', '   '), InvalidSessionIdError);
});

test('throws when referencing a missing conversation or session', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const conversation = await manager.createConversation();

  await assert.rejects(() => manager.createSession('missing-conversation'), ConversationNotFoundError);
  await assert.rejects(() => manager.appendMessage('missing-conversation', 'missing-session', { role: 'assistant', content: 'Hi' }), ConversationNotFoundError);
  await assert.rejects(() => manager.appendMessage(conversation.id, 'missing-session', { role: 'assistant', content: 'Hi' }), SessionNotFoundError);
});

test('completes and cancels pending tasks while returning only pending tasks', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const conversation = await manager.createConversation();
  const session = await manager.createSession(conversation.id);
  const task = await manager.addPendingTask(conversation.id, session.id, { title: 'Review' });

  const completed = await manager.completePendingTask(conversation.id, session.id, task.id);
  assert.equal(completed, true);
  assert.deepEqual(await manager.getPendingTasks(conversation.id, session.id), []);

  const another = await manager.addPendingTask(conversation.id, session.id, { title: 'Deploy' });
  const cancelled = await manager.cancelPendingTask(conversation.id, session.id, another.id);
  assert.equal(cancelled, true);
  assert.deepEqual(await manager.getPendingTasks(conversation.id, session.id), []);

  const pending = await manager.addPendingTask(conversation.id, session.id, { title: 'Ship' });
  const tasks = await manager.getPendingTasks(conversation.id, session.id);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.id, pending.id);
  assert.equal(tasks[0]?.status, 'pending');
});

test('keeps sessions isolated from each other within the same conversation', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const conversation = await manager.createConversation();
  const firstSession = await manager.createSession(conversation.id);
  const secondSession = await manager.createSession(conversation.id);

  await manager.appendMessage(conversation.id, firstSession.id, { role: 'user', content: 'alpha' });
  await manager.recordDecision(conversation.id, firstSession.id, { kind: 'approve', summary: 'approved' });
  await manager.addPendingTask(conversation.id, firstSession.id, { title: 'follow-up' });
  await manager.saveSummary(conversation.id, firstSession.id, { content: 'first summary' });

  const firstMessages = await manager.getMessages(conversation.id, firstSession.id);
  const secondMessages = await manager.getMessages(conversation.id, secondSession.id);
  const firstDecisions = await manager.getDecisions(conversation.id, firstSession.id);
  const secondDecisions = await manager.getDecisions(conversation.id, secondSession.id);
  const firstTasks = await manager.getPendingTasks(conversation.id, firstSession.id);
  const secondTasks = await manager.getPendingTasks(conversation.id, secondSession.id);
  const firstSummary = await manager.getLatestSummary(conversation.id, firstSession.id);
  const secondSummary = await manager.getLatestSummary(conversation.id, secondSession.id);

  assert.equal(firstMessages.length, 1);
  assert.equal(secondMessages.length, 0);
  assert.equal(firstDecisions.length, 1);
  assert.equal(secondDecisions.length, 0);
  assert.equal(firstTasks.length, 1);
  assert.equal(secondTasks.length, 0);
  assert.equal(firstSummary?.content, 'first summary');
  assert.equal(secondSummary, undefined);
});

test('returns the requested slice of the most recent messages in chronological order', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const conversation = await manager.createConversation();
  const session = await manager.createSession(conversation.id);

  await manager.appendMessage(conversation.id, session.id, { role: 'user', content: 'first' });
  await manager.appendMessage(conversation.id, session.id, { role: 'user', content: 'second' });
  await manager.appendMessage(conversation.id, session.id, { role: 'user', content: 'third' });

  const recent = await manager.getLastMessages(conversation.id, session.id, 2);
  assert.equal(recent.length, 2);
  assert.deepEqual(recent.map((item) => item.content), ['second', 'third']);
});

test('clearMessages removes only the target session messages and preserves other data', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const conversation = await manager.createConversation();
  const firstSession = await manager.createSession(conversation.id);
  const secondSession = await manager.createSession(conversation.id);

  await manager.appendMessage(conversation.id, firstSession.id, { role: 'user', content: 'first' });
  await manager.appendMessage(conversation.id, secondSession.id, { role: 'user', content: 'second' });
  await manager.recordDecision(conversation.id, firstSession.id, { kind: 'approve', summary: 'approved' });
  await manager.addPendingTask(conversation.id, firstSession.id, { title: 'follow-up' });
  await manager.saveSummary(conversation.id, firstSession.id, { content: 'summary' });

  const cleared = await manager.clearMessages(conversation.id, firstSession.id);
  assert.equal(cleared, true);

  const firstMessages = await manager.getMessages(conversation.id, firstSession.id);
  const secondMessages = await manager.getMessages(conversation.id, secondSession.id);
  const decisions = await manager.getDecisions(conversation.id, firstSession.id);
  const tasks = await manager.getPendingTasks(conversation.id, firstSession.id);
  const summary = await manager.getLatestSummary(conversation.id, firstSession.id);

  assert.equal(firstMessages.length, 0);
  assert.equal(secondMessages.length, 1);
  assert.equal(decisions.length, 1);
  assert.equal(tasks.length, 1);
  assert.equal(summary?.content, 'summary');
});

test('deleteConversation removes every record for a conversation', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const conversation = await manager.createConversation();
  const session = await manager.createSession(conversation.id);

  await manager.appendMessage(conversation.id, session.id, { role: 'user', content: 'hello' });
  await manager.recordDecision(conversation.id, session.id, { kind: 'approve', summary: 'approved' });
  await manager.addPendingTask(conversation.id, session.id, { title: 'follow-up' });
  await manager.saveSummary(conversation.id, session.id, { content: 'summary' });

  const removed = await manager.removeConversation(conversation.id);
  assert.equal(removed, true);

  assert.equal(await manager.getConversation(conversation.id), undefined);
  assert.equal(await manager.getSession(conversation.id, session.id), undefined);
  assert.deepEqual(await manager.getMessages(conversation.id, session.id), []);
  assert.deepEqual(await manager.getDecisions(conversation.id, session.id), []);
  assert.deepEqual(await manager.getPendingTasks(conversation.id, session.id), []);
  assert.equal(await manager.getLatestSummary(conversation.id, session.id), undefined);
  assert.deepEqual(await manager.listConversations(), []);
});

test('getLatestSummary returns the newest summary for a session', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const conversation = await manager.createConversation();
  const session = await manager.createSession(conversation.id);

  await manager.saveSummary(conversation.id, session.id, { content: 'first' });
  await manager.saveSummary(conversation.id, session.id, { content: 'second' });

  const latest = await manager.getLatestSummary(conversation.id, session.id);
  assert.equal(latest?.content, 'second');
});

test('throws when completing or cancelling a missing task', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const conversation = await manager.createConversation();
  const session = await manager.createSession(conversation.id);

  await assert.rejects(() => manager.completePendingTask(conversation.id, session.id, 'missing-task'), PendingTaskNotFoundError);
  await assert.rejects(() => manager.cancelPendingTask(conversation.id, session.id, 'missing-task'), PendingTaskNotFoundError);
});

test('protects stored conversation data from external mutation', async () => {
  const manager = new ConversationManager(new MemoryManager());
  const conversation = await manager.createConversation({ title: 'Protected' });
  const fetched = await manager.getConversation(conversation.id);

  if (!fetched) {
    assert.fail('conversation should exist');
  }

  const frozen = fetched as typeof fetched & { metadata?: Record<string, unknown> | undefined };
  Object.assign(frozen, { metadata: { source: 'mutated' } });
  const reloaded = await manager.getConversation(conversation.id);

  assert.equal(reloaded?.metadata?.source, undefined);
});
