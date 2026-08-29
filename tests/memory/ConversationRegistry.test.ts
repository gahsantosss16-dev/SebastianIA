import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConversationRegistry,
  LEGACY_DEFAULT_CONVERSATION_ID,
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
  isValidConversationIdFormat,
} from '../../core/memory/ConversationRegistry.js';
import { FileCommandContextHydrator } from '../../core/memory/FileCommandContextHydrator.js';
import { FileCommandResultMemoryWriter } from '../../core/memory/FileCommandResultMemoryWriter.js';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';

function withTempStore(run: (store: FileMemoryStore) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-conversation-registry-'));
  try {
    run(new FileMemoryStore(join(dir, 'memory.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createRegistry(store: FileMemoryStore, ids: readonly string[] = [], clockMs = { value: 0 }): ConversationRegistry {
  let index = 0;
  return new ConversationRegistry(
    store,
    new FileCommandContextHydrator(store),
    () => ids[index++] ?? `conversation-fallback-${index}`,
    () => new Date(clockMs.value).toISOString(),
  );
}

test('isValidConversationIdFormat accepts generated ids and the default id, rejects anything else', () => {
  assert.equal(isValidConversationIdFormat('conversation-1'), true);
  assert.equal(isValidConversationIdFormat('conversation-abc123-def'), true);
  assert.equal(isValidConversationIdFormat('conversation-'), false);
  assert.equal(isValidConversationIdFormat('../../etc/passwd'), false);
  assert.equal(isValidConversationIdFormat('conversation-1/../2'), false);
  assert.equal(isValidConversationIdFormat(42), false);
  assert.equal(isValidConversationIdFormat(undefined), false);
});

test('deriveConversationTitle takes the first non-empty line, collapses whitespace and truncates predictably', () => {
  assert.equal(deriveConversationTitle('Olá Sebastian, tudo bem?'), 'Olá Sebastian, tudo bem?');
  assert.equal(deriveConversationTitle('\n\n  primeira linha útil  \nsegunda linha'), 'primeira linha útil');
  assert.equal(deriveConversationTitle('   '), DEFAULT_CONVERSATION_TITLE);
  const long = 'x'.repeat(120);
  const title = deriveConversationTitle(long);
  assert.ok(title.length <= 60);
  assert.ok(title.endsWith('…'));
});

test('create persists a conversation with a placeholder title and identical createdAt/lastActivityAt', () => {
  withTempStore((store) => {
    const registry = createRegistry(store, ['conversation-aaa']);
    const created = registry.create();
    assert.deepEqual(created, {
      id: 'conversation-aaa',
      title: DEFAULT_CONVERSATION_TITLE,
      createdAt: created.createdAt,
      lastActivityAt: created.createdAt,
    });
    assert.deepEqual(registry.get('conversation-aaa'), created);
  });
});

test('list returns conversations sorted by most recent activity first', () => {
  withTempStore((store) => {
    const clock = { value: 0 };
    const registry = createRegistry(store, ['conversation-first', 'conversation-second'], clock);
    registry.create();
    clock.value += 1_000;
    registry.create();
    clock.value += 1_000;
    registry.touch('conversation-first', new Date(clock.value).toISOString());

    assert.deepEqual(registry.list().map((c) => c.id), ['conversation-first', 'conversation-second']);
  });
});

test('get rejects a malformed id without ever touching storage, and returns undefined for a well-formed but missing id', () => {
  withTempStore((store) => {
    const registry = createRegistry(store);
    assert.equal(registry.get('../etc/passwd'), undefined);
    assert.equal(registry.get('conversation-does-not-exist'), undefined);
  });
});

test('touch on an unknown id is a safe no-op', () => {
  withTempStore((store) => {
    const registry = createRegistry(store);
    registry.touch('conversation-does-not-exist', new Date().toISOString());
    assert.deepEqual(registry.list(), []);
  });
});

test('applyTitleIfPlaceholder sets the title only once, from the first useful message, and never overwrites it again', () => {
  withTempStore((store) => {
    const registry = createRegistry(store, ['conversation-x']);
    registry.create();
    registry.applyTitleIfPlaceholder('conversation-x', 'Como faço deploy na Hostinger?');
    assert.equal(registry.get('conversation-x')?.title, 'Como faço deploy na Hostinger?');

    registry.applyTitleIfPlaceholder('conversation-x', 'Uma pergunta completamente diferente');
    assert.equal(registry.get('conversation-x')?.title, 'Como faço deploy na Hostinger?');
  });
});

test('listTurns returns undefined for an id that does not exist, and the real turns for one that does', () => {
  withTempStore((store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    writer.write({
      executionId: 'converse:1',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-14T00:00:00.000Z',
      resultGeneratedAt: '2026-08-14T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { conversationTurn: { requestText: 'oi', summary: 'olá!', kind: 'respond' } },
      metadata: { conversationId: 'conversation-real' },
    });
    const registry = createRegistry(store, ['conversation-real']);
    registry.create();

    assert.equal(registry.listTurns('conversation-does-not-exist'), undefined);
    assert.deepEqual(registry.listTurns('conversation-real')?.map((t) => t.requestText), ['oi']);
  });
});

test('a fresh installation with no registry entries and no legacy history lists nothing', () => {
  withTempStore((store) => {
    const registry = createRegistry(store);
    assert.deepEqual(registry.list(), []);
  });
});

test('an installation with only pre-existing legacy exchanges (no conversationId metadata) gets conversation-1 registered automatically, once', () => {
  withTempStore((store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    writer.write({
      executionId: 'converse:legacy-1',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-14T00:00:00.000Z',
      resultGeneratedAt: '2026-08-14T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { conversationTurn: { requestText: 'Quais são minhas tarefas?', summary: 'Você não tem nenhuma tarefa pendente.', kind: 'respond' } },
      metadata: {},
    });
    writer.write({
      executionId: 'converse:legacy-2',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-14T00:05:00.000Z',
      resultGeneratedAt: '2026-08-14T00:05:00.000Z',
      resultStatus: 'succeeded',
      output: { conversationTurn: { requestText: 'E agora?', summary: 'Continua sem tarefas.', kind: 'respond' } },
      metadata: {},
    });

    const registry = createRegistry(store);
    const list = registry.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.id, LEGACY_DEFAULT_CONVERSATION_ID);
    assert.equal(list[0]!.title, 'Quais são minhas tarefas?');
    assert.equal(list[0]!.createdAt, '2026-08-14T00:00:00.000Z');
    assert.equal(list[0]!.lastActivityAt, '2026-08-14T00:05:00.000Z');

    // Calling list again must not duplicate or re-derive the migrated entry.
    assert.deepEqual(registry.list(), list);
  });
});

test('legacy migration never overwrites a real conversation-1 that was already explicitly created', () => {
  withTempStore((store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    writer.write({
      executionId: 'converse:legacy-1',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-14T00:00:00.000Z',
      resultGeneratedAt: '2026-08-14T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { conversationTurn: { requestText: 'mensagem legada', summary: 'resposta legada', kind: 'respond' } },
      metadata: {},
    });

    const registry = createRegistry(store, [LEGACY_DEFAULT_CONVERSATION_ID], { value: 5_000 });
    const explicit = registry.create();
    assert.equal(explicit.id, LEGACY_DEFAULT_CONVERSATION_ID);

    const list = registry.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.title, DEFAULT_CONVERSATION_TITLE, 'the explicitly created conversation must win, never be replaced by the migration');
  });
});
