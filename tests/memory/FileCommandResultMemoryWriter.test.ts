import { AsyncFileMemoryStore } from '../../core/memory/AsyncMemoryStore.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCommandResultMemoryWriter } from '../../core/memory/FileCommandResultMemoryWriter.js';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import { InvalidCommandResultMemoryWriteBackInputError } from '../../core/memory/CommandResultMemoryContractErrors.js';

async function withTempStore(run: (store: AsyncFileMemoryStore) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-file-writer-'));
  try {
    await run(new AsyncFileMemoryStore(new FileMemoryStore(join(dir, 'memory.json'))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function validInput() {
  return {
    executionId: 'remember:2026-07-31T00:00:00.000Z',
    commandType: 'remember',
    commandGeneratedAt: '2026-07-31T00:00:00.000Z',
    resultGeneratedAt: '2026-07-31T00:00:01.000Z',
    resultStatus: 'succeeded',
    output: { fact: 'prefiro reuniões de manhã' },
    metadata: {},
  } as const;
}

test('file writer records a valid write-back payload durably', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);

    const outcome = await writer.write(validInput());

    assert.equal(outcome.status, 'recorded');
    assert.equal(outcome.key, 'command-results:remember:2026-07-31T00:00:00.000Z');
    assert.equal(typeof outcome.recordedAt, 'string');
    assert.deepEqual((await store.listRecords('command-results')).map((record) => record.executionId), [
      'remember:2026-07-31T00:00:00.000Z',
    ]);
  });
});

test('file writer persists records visible to a separate store instance on the same path', async () => {
  await withTempStore(async (store) => {
    await new FileCommandResultMemoryWriter(store).write(validInput());
  });
});

test('a second FileCommandResultMemoryWriter instance sees records written by the first', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-file-writer-cross-'));
  try {
    const filePath = join(dir, 'memory.json');
    await new FileCommandResultMemoryWriter(new AsyncFileMemoryStore(new FileMemoryStore(filePath))).write(validInput());

    const secondStore = new AsyncFileMemoryStore(new FileMemoryStore(filePath));
    assert.equal((await secondStore.listRecords('command-results')).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file writer rejects invalid payloads with typed errors', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);

    await assert.rejects(
      async () => (await writer.write(null as never)),
      (error: unknown) => {
        assert.ok(error instanceof InvalidCommandResultMemoryWriteBackInputError);
        return true;
      },
    );

    await assert.rejects(
      async () => (await writer.write({ ...validInput(), executionId: '   ' })),
      (error: unknown) => {
        assert.ok(error instanceof InvalidCommandResultMemoryWriteBackInputError);
        return true;
      },
    );
  });
});

test('file writer does not mutate the write-back payload', async () => {
  await withTempStore(async (store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    const input = {
      ...validInput(),
      output: { fact: 'prefiro reuniões de manhã', nested: { enabled: true } },
    };
    const before = structuredClone(input);

    await writer.write(input);

    assert.deepEqual(input, before);
  });
});
