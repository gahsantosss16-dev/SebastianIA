import { AsyncFileMemoryStore } from '../../core/memory/AsyncMemoryStore.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCommandContextHydrator } from '../../core/memory/FileCommandContextHydrator.js';
import { FileCommandResultMemoryWriter } from '../../core/memory/FileCommandResultMemoryWriter.js';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import { InvalidCommandContextHydrationRequestError } from '../../core/memory/CommandContextHydrationContractErrors.js';

async function withTempStore(run: (store: AsyncFileMemoryStore) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-file-hydrator-'));
  try {
    await run(new AsyncFileMemoryStore(new FileMemoryStore(join(dir, 'memory.json'))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('hydrator returns absent when no fact was ever remembered', async () => {
  await withTempStore(async (store) => {
    const hydrator = new FileCommandContextHydrator(store);

    const outcome = await hydrator.hydrate({
      commandType: 'recall',
      generatedAt: '2026-08-11T00:00:00.000Z',
    });

    assert.deepEqual(outcome, { status: 'absent' });
  });
});

test('hydrator reconstructs remembered facts from persisted write-back records', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'remember:2026-08-11T00:00:00.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { fact: 'prefiro reuniões de manhã' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'recall', generatedAt: '2026-08-11T00:05:00.000Z' });

    assert.equal(outcome.status, 'hydrated');
    if (outcome.status !== 'hydrated') {
      assert.fail('Expected hydrated status.');
    }

    const temporary = outcome.context.temporary as { values: { rememberedFacts: unknown[] } };
    assert.deepEqual(temporary.values.rememberedFacts, [
      {
        id: 'remember:2026-08-11T00:00:00.000Z',
        content: 'prefiro reuniões de manhã',
        recordedAt: '2026-08-11T00:00:00.000Z',
      },
    ]);
  });
});

test('hydrator ignores records from other command types and failed results', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'greeting:2026-08-11T00:00:00.000Z',
      commandType: 'greeting',
      commandGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { message: 'Hello!' },
      metadata: {},
    });
    await writer.write({
      executionId: 'remember:2026-08-11T00:00:01.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-11T00:00:01.000Z',
      resultGeneratedAt: '2026-08-11T00:00:01.000Z',
      resultStatus: 'failed',
      output: {},
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'recall', generatedAt: '2026-08-11T00:05:00.000Z' });

    assert.deepEqual(outcome, { status: 'absent' });
  });
});

test('hydrator sorts remembered facts chronologically', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'remember:2026-08-11T00:02:00.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-11T00:02:00.000Z',
      resultGeneratedAt: '2026-08-11T00:02:00.000Z',
      resultStatus: 'succeeded',
      output: { fact: 'segundo fato' },
      metadata: {},
    });
    await writer.write({
      executionId: 'remember:2026-08-11T00:01:00.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultStatus: 'succeeded',
      output: { fact: 'primeiro fato' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'recall', generatedAt: '2026-08-11T00:05:00.000Z' });

    assert.equal(outcome.status, 'hydrated');
    if (outcome.status !== 'hydrated') {
      assert.fail('Expected hydrated status.');
    }

    const temporary = outcome.context.temporary as { values: { rememberedFacts: Array<{ content: string }> } };
    assert.deepEqual(
      temporary.values.rememberedFacts.map((fact) => fact.content),
      ['primeiro fato', 'segundo fato'],
    );
  });
});

test('hydrator rejects invalid request with typed error', async () => {
  await withTempStore(async (store) => {
    const hydrator = new FileCommandContextHydrator(store);

    await assert.rejects(
      async () => (await hydrator.hydrate(null as never)),
      (error: unknown) => {
        assert.ok(error instanceof InvalidCommandContextHydrationRequestError);
        return true;
      },
    );
  });
});

test('hydrator recognizes a marked memory fact produced by a non-remember command type', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'converse:2026-08-11T00:00:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { memoryRecordKind: 'sebastian.memory.fact', content: 'prefiro reuniões de manhã' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-11T00:05:00.000Z' });

    assert.equal(outcome.status, 'hydrated');
    if (outcome.status !== 'hydrated') {
      assert.fail('Expected hydrated status.');
    }

    const temporary = outcome.context.temporary as { values: { rememberedFacts: unknown[] } };
    assert.deepEqual(temporary.values.rememberedFacts, [
      {
        id: 'converse:2026-08-11T00:00:00.000Z',
        content: 'prefiro reuniões de manhã',
        recordedAt: '2026-08-11T00:00:00.000Z',
      },
    ]);
  });
});

test('hydrator merges legacy remember records and marked converse records chronologically', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'remember:2026-08-11T00:01:00.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultStatus: 'succeeded',
      output: { fact: 'fato via comando rígido' },
      metadata: {},
    });
    await writer.write({
      executionId: 'converse:2026-08-11T00:02:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:02:00.000Z',
      resultGeneratedAt: '2026-08-11T00:02:00.000Z',
      resultStatus: 'succeeded',
      output: { memoryRecordKind: 'sebastian.memory.fact', content: 'fato via linguagem natural' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-11T00:05:00.000Z' });

    assert.equal(outcome.status, 'hydrated');
    if (outcome.status !== 'hydrated') {
      assert.fail('Expected hydrated status.');
    }

    const temporary = outcome.context.temporary as { values: { rememberedFacts: Array<{ content: string }> } };
    assert.deepEqual(
      temporary.values.rememberedFacts.map((fact) => fact.content),
      ['fato via comando rígido', 'fato via linguagem natural'],
    );
  });
});

test('hydrator reconstructs a pending task from a task-creation record', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'converse:2026-08-11T00:00:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { memoryRecordKind: 'sebastian.memory.task.created', content: 'comprar leite' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-11T00:05:00.000Z' });

    assert.equal(outcome.status, 'hydrated');
    if (outcome.status !== 'hydrated') {
      assert.fail('Expected hydrated status.');
    }

    const temporary = outcome.context.temporary as { values: { pendingTasks: unknown[] } };
    assert.deepEqual(temporary.values.pendingTasks, [
      { id: 'converse:2026-08-11T00:00:00.000Z', content: 'comprar leite', createdAt: '2026-08-11T00:00:00.000Z' },
    ]);
  });
});

test('a completed task no longer appears among pending tasks, without rewriting the creation record', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'converse:2026-08-11T00:00:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { memoryRecordKind: 'sebastian.memory.task.created', content: 'comprar leite' },
      metadata: {},
    });
    await writer.write({
      executionId: 'converse:2026-08-11T00:01:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultStatus: 'succeeded',
      output: { memoryRecordKind: 'sebastian.memory.task.completed', taskId: 'converse:2026-08-11T00:00:00.000Z' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-11T00:05:00.000Z' });

    // With no facts and no pending tasks left, hydration correctly reports
    // absent - the important proof here is at the storage level: the
    // creation record itself must survive completion untouched, append-only.
    assert.deepEqual(outcome, { status: 'absent' });

    const rawStore = await store.listRecords('command-results');
    assert.equal(rawStore.length, 2, 'both the creation and completion records must be preserved, never merged or removed');

    const creationRecord = rawStore.find((record) => record.executionId === 'converse:2026-08-11T00:00:00.000Z');
    assert.deepEqual(creationRecord?.output, {
      memoryRecordKind: 'sebastian.memory.task.created',
      content: 'comprar leite',
    });

    const completionRecord = rawStore.find((record) => record.executionId === 'converse:2026-08-11T00:01:00.000Z');
    assert.deepEqual(completionRecord?.output, {
      memoryRecordKind: 'sebastian.memory.task.completed',
      taskId: 'converse:2026-08-11T00:00:00.000Z',
    });
  });
});

test('a pending task remains visible when a different task is completed', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'converse:2026-08-11T00:00:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { memoryRecordKind: 'sebastian.memory.task.created', content: 'comprar leite' },
      metadata: {},
    });
    await writer.write({
      executionId: 'converse:2026-08-11T00:01:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultStatus: 'succeeded',
      output: { memoryRecordKind: 'sebastian.memory.task.created', content: 'pagar conta' },
      metadata: {},
    });
    await writer.write({
      executionId: 'converse:2026-08-11T00:02:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:02:00.000Z',
      resultGeneratedAt: '2026-08-11T00:02:00.000Z',
      resultStatus: 'succeeded',
      output: { memoryRecordKind: 'sebastian.memory.task.completed', taskId: 'converse:2026-08-11T00:00:00.000Z' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-11T00:05:00.000Z' });

    assert.equal(outcome.status, 'hydrated');
    if (outcome.status !== 'hydrated') {
      assert.fail('Expected hydrated status.');
    }
    const temporary = outcome.context.temporary as { values: { pendingTasks: Array<{ content: string }> } };
    assert.deepEqual(
      temporary.values.pendingTasks.map((t) => t.content),
      ['pagar conta'],
    );
  });
});

test('hydrator sorts pending tasks chronologically and keeps facts alongside tasks', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'remember:2026-08-11T00:00:00.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { fact: 'prefiro reuniões de manhã' },
      metadata: {},
    });
    await writer.write({
      executionId: 'converse:2026-08-11T00:02:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:02:00.000Z',
      resultGeneratedAt: '2026-08-11T00:02:00.000Z',
      resultStatus: 'succeeded',
      output: { memoryRecordKind: 'sebastian.memory.task.created', content: 'segunda tarefa' },
      metadata: {},
    });
    await writer.write({
      executionId: 'converse:2026-08-11T00:01:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultStatus: 'succeeded',
      output: { memoryRecordKind: 'sebastian.memory.task.created', content: 'primeira tarefa' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-11T00:05:00.000Z' });

    assert.equal(outcome.status, 'hydrated');
    if (outcome.status !== 'hydrated') {
      assert.fail('Expected hydrated status.');
    }
    const temporary = outcome.context.temporary as {
      values: { rememberedFacts: Array<{ content: string }>; pendingTasks: Array<{ content: string }> };
    };
    assert.deepEqual(
      temporary.values.pendingTasks.map((task) => task.content),
      ['primeira tarefa', 'segunda tarefa'],
    );
    assert.deepEqual(
      temporary.values.rememberedFacts.map((fact) => fact.content),
      ['prefiro reuniões de manhã'],
    );
  });
});

test('hydrator does not treat an unrelated "fact"-shaped output as memory without the explicit discriminator', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'converse:2026-08-11T00:00:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { fact: 'parece um fato mas não tem o discriminador' },
      metadata: {},
    });
    await writer.write({
      executionId: 'converse:2026-08-11T00:00:01.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-11T00:00:01.000Z',
      resultGeneratedAt: '2026-08-11T00:00:01.000Z',
      resultStatus: 'succeeded',
      output: { message: 'apenas uma resposta comum', content: 'não deve ser reconhecido' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-11T00:05:00.000Z' });

    assert.deepEqual(outcome, { status: 'absent' });
  });
});

async function writeExchangeRecord(
  writer: FileCommandResultMemoryWriter,
  executionId: string,
  recordedAt: string,
  conversationTurn: Readonly<Record<string, unknown>>,
  extraOutput: Readonly<Record<string, unknown>> = {},
  metadata: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await writer.write({
    executionId,
    commandType: 'converse',
    commandGeneratedAt: recordedAt,
    resultGeneratedAt: recordedAt,
    resultStatus: 'succeeded',
    output: { ...extraOutput, conversationTurn },
    metadata,
  });
}

test('hydrator reconstructs a recent exchange from a record carrying memoryExtras.conversationTurn (SPEC-045)', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writeExchangeRecord(
      writer,
      'converse:2026-08-12T00:00:00.000Z',
      '2026-08-12T00:00:00.000Z',
      { requestText: 'Quais arquivos existem?', summary: 'Arquivos em ".": a.md.', kind: 'useTool' },
      { message: 'Arquivos em ".": a.md.' },
    );

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-12T00:05:00.000Z' });

    assert.equal(outcome.status, 'hydrated');
    if (outcome.status !== 'hydrated') {
      assert.fail('Expected hydrated status.');
    }
    const temporary = outcome.context.temporary as { values: { recentExchanges: unknown[] } };
    assert.deepEqual(temporary.values.recentExchanges, [
      {
        id: 'converse:2026-08-12T00:00:00.000Z',
        requestText: 'Quais arquivos existem?',
        summary: 'Arquivos em ".": a.md.',
        kind: 'useTool',
        recordedAt: '2026-08-12T00:00:00.000Z',
      },
    ]);
  });
});

test('hydrator does not treat the user-visible output alone as a recent exchange without a conversationTurn field', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'converse:2026-08-12T00:00:00.000Z',
      commandType: 'converse',
      commandGeneratedAt: '2026-08-12T00:00:00.000Z',
      resultGeneratedAt: '2026-08-12T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { message: 'apenas uma resposta comum' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-12T00:05:00.000Z' });

    assert.deepEqual(outcome, { status: 'absent' });
  });
});

test('hydrator skips a malformed conversationTurn (missing required string fields) instead of crashing', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writeExchangeRecord(writer, 'converse:2026-08-12T00:00:00.000Z', '2026-08-12T00:00:00.000Z', {
      requestText: 'oi',
      // summary intentionally missing
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-12T00:05:00.000Z' });

    assert.deepEqual(outcome, { status: 'absent' });
  });
});

test('hydrator sorts recent exchanges chronologically regardless of write order', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writeExchangeRecord(writer, 'converse:2', '2026-08-12T00:02:00.000Z', { requestText: 'b', summary: 'resposta b', kind: 'respond' });
    await writeExchangeRecord(writer, 'converse:1', '2026-08-12T00:01:00.000Z', { requestText: 'a', summary: 'resposta a', kind: 'respond' });
    await writeExchangeRecord(writer, 'converse:3', '2026-08-12T00:03:00.000Z', { requestText: 'c', summary: 'resposta c', kind: 'respond' });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-12T00:05:00.000Z' });

    assert.equal(outcome.status, 'hydrated');
    if (outcome.status !== 'hydrated') {
      assert.fail('Expected hydrated status.');
    }
    const temporary = outcome.context.temporary as { values: { recentExchanges: ReadonlyArray<{ requestText: string }> } };
    assert.deepEqual(
      temporary.values.recentExchanges.map((exchange) => exchange.requestText),
      ['a', 'b', 'c'],
    );
  });
});

test('hydrator caps recent exchanges at the fixed window, keeping only the most recent ones', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    for (let index = 0; index < 12; index += 1) {
      const minute = String(index).padStart(2, '0');
      await writeExchangeRecord(writer, `converse:${index}`, `2026-08-12T00:${minute}:00.000Z`, {
        requestText: `mensagem ${index}`,
        summary: `resposta ${index}`,
        kind: 'respond',
      });
    }

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-12T01:00:00.000Z' });

    assert.equal(outcome.status, 'hydrated');
    if (outcome.status !== 'hydrated') {
      assert.fail('Expected hydrated status.');
    }
    const temporary = outcome.context.temporary as { values: { recentExchanges: ReadonlyArray<{ requestText: string }> } };
    assert.equal(temporary.values.recentExchanges.length, 8);
    assert.deepEqual(
      temporary.values.recentExchanges.map((exchange) => exchange.requestText),
      ['mensagem 4', 'mensagem 5', 'mensagem 6', 'mensagem 7', 'mensagem 8', 'mensagem 9', 'mensagem 10', 'mensagem 11'],
    );
  });
});

test('hydrator reconstructs facts, tasks and recent exchanges together without interfering with each other', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'remember:2026-08-12T00:00:00.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-12T00:00:00.000Z',
      resultGeneratedAt: '2026-08-12T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { fact: 'prefiro reuniões de manhã' },
      metadata: {},
    });
    await writeExchangeRecord(writer, 'converse:2026-08-12T00:01:00.000Z', '2026-08-12T00:01:00.000Z', {
      requestText: 'oi',
      summary: 'olá!',
      kind: 'respond',
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-12T00:05:00.000Z' });

    assert.equal(outcome.status, 'hydrated');
    if (outcome.status !== 'hydrated') {
      assert.fail('Expected hydrated status.');
    }
    const temporary = outcome.context.temporary as {
      values: { rememberedFacts: unknown[]; pendingTasks: unknown[]; recentExchanges: unknown[] };
    };
    assert.equal(temporary.values.rememberedFacts.length, 1);
    assert.equal(temporary.values.pendingTasks.length, 0);
    assert.equal(temporary.values.recentExchanges.length, 1);
  });
});

test('hydrate scopes recent exchanges to the requested conversationId, never leaking another conversation\'s turns', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writeExchangeRecord(
      writer, 'converse:a1', '2026-08-13T00:00:00.000Z',
      { requestText: 'pergunta em A', summary: 'resposta em A', kind: 'respond' }, {}, { conversationId: 'conversation-a' },
    );
    await writeExchangeRecord(
      writer, 'converse:b1', '2026-08-13T00:01:00.000Z',
      { requestText: 'pergunta em B', summary: 'resposta em B', kind: 'respond' }, {}, { conversationId: 'conversation-b' },
    );

    const hydrator = new FileCommandContextHydrator(store);
    const outcomeA = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-13T00:05:00.000Z', conversationId: 'conversation-a' });
    const outcomeB = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-13T00:05:00.000Z', conversationId: 'conversation-b' });

    if (outcomeA.status !== 'hydrated' || outcomeB.status !== 'hydrated') {
      assert.fail('Expected both conversations to hydrate.');
    }
    const exchangesA = (outcomeA.context.temporary as { values: { recentExchanges: ReadonlyArray<{ requestText: string }> } }).values.recentExchanges;
    const exchangesB = (outcomeB.context.temporary as { values: { recentExchanges: ReadonlyArray<{ requestText: string }> } }).values.recentExchanges;
    assert.deepEqual(exchangesA.map((e) => e.requestText), ['pergunta em A']);
    assert.deepEqual(exchangesB.map((e) => e.requestText), ['pergunta em B']);
  });
});

test('hydrate keeps remembered facts global regardless of which conversationId is requested', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writer.write({
      executionId: 'remember:2026-08-13T00:00:00.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-13T00:00:00.000Z',
      resultGeneratedAt: '2026-08-13T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { fact: 'prefiro reuniões de manhã' },
      metadata: {},
    });
    await writeExchangeRecord(
      writer, 'converse:a1', '2026-08-13T00:01:00.000Z',
      { requestText: 'pergunta em A', summary: 'resposta em A', kind: 'respond' }, {}, { conversationId: 'conversation-a' },
    );

    const hydrator = new FileCommandContextHydrator(store);
    const outcomeB = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-13T00:05:00.000Z', conversationId: 'conversation-b-brand-new' });

    if (outcomeB.status !== 'hydrated') {
      assert.fail('Expected the fact to make conversation B hydrate even with no exchanges of its own.');
    }
    const { values } = outcomeB.context.temporary as { values: { rememberedFacts: ReadonlyArray<{ content: string }>; recentExchanges: unknown[] } };
    assert.deepEqual(values.rememberedFacts.map((fact) => fact.content), ['prefiro reuniões de manhã']);
    assert.deepEqual(values.recentExchanges, []);
  });
});

test('hydrate folds a legacy record with no conversationId at all into conversation-1, never into any other conversation', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    await writeExchangeRecord(writer, 'converse:legacy', '2026-08-13T00:00:00.000Z', {
      requestText: 'mensagem antiga sem conversationId',
      summary: 'resposta antiga',
      kind: 'respond',
    });

    const hydrator = new FileCommandContextHydrator(store);
    const legacyOutcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-13T00:05:00.000Z', conversationId: 'conversation-1' });
    const otherOutcome = await hydrator.hydrate({ commandType: 'converse', generatedAt: '2026-08-13T00:05:00.000Z', conversationId: 'conversation-other' });

    if (legacyOutcome.status !== 'hydrated') {
      assert.fail('Expected legacy record to hydrate under conversation-1.');
    }
    assert.deepEqual(otherOutcome, { status: 'absent' });
    const legacyExchanges = (legacyOutcome.context.temporary as { values: { recentExchanges: ReadonlyArray<{ requestText: string }> } }).values.recentExchanges;
    assert.deepEqual(legacyExchanges.map((e) => e.requestText), ['mensagem antiga sem conversationId']);
  });
});

test('listConversationTurns returns one conversation\'s full, unbounded history and excludes another\'s', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    for (let index = 0; index < 12; index += 1) {
      const minute = String(index).padStart(2, '0');
      await writeExchangeRecord(
        writer, `converse:a${index}`, `2026-08-13T00:${minute}:00.000Z`,
        { requestText: `mensagem A ${index}`, summary: `resposta A ${index}`, kind: 'respond' }, {}, { conversationId: 'conversation-a' },
      );
    }
    await writeExchangeRecord(
      writer, 'converse:b0', '2026-08-13T01:00:00.000Z',
      { requestText: 'mensagem B', summary: 'resposta B', kind: 'respond' }, {}, { conversationId: 'conversation-b' },
    );

    const hydrator = new FileCommandContextHydrator(store);
    const turnsA = await hydrator.listConversationTurns('conversation-a');
    const turnsB = await hydrator.listConversationTurns('conversation-b');

    assert.equal(turnsA.length, 12, 'unlike hydrate(), listConversationTurns must never cap at the 8-turn cognitive window');
    assert.deepEqual(turnsA.map((t) => t.requestText), Array.from({ length: 12 }, (_, i) => `mensagem A ${i}`));
    assert.deepEqual(turnsB.map((t) => t.requestText), ['mensagem B']);
  });
});
