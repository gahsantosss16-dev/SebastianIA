import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCommandResultMemoryWriter } from '../../core/memory/FileCommandResultMemoryWriter.js';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import { InvalidCommandResultMemoryWriteBackInputError } from '../../core/memory/CommandResultMemoryContractErrors.js';

function withTempStore(run: (store: FileMemoryStore) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-file-writer-'));
  try {
    run(new FileMemoryStore(join(dir, 'memory.json')));
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

test('file writer records a valid write-back payload durably', () => {
  withTempStore((store) => {
    const writer = new FileCommandResultMemoryWriter(store);

    const outcome = writer.write(validInput());

    assert.equal(outcome.status, 'recorded');
    assert.equal(outcome.key, 'command-results:remember:2026-07-31T00:00:00.000Z');
    assert.equal(typeof outcome.recordedAt, 'string');
    assert.deepEqual(store.listRecords('command-results').map((record) => record.executionId), [
      'remember:2026-07-31T00:00:00.000Z',
    ]);
  });
});

test('file writer persists records visible to a separate store instance on the same path', () => {
  withTempStore((store) => {
    new FileCommandResultMemoryWriter(store).write(validInput());
  });
});

test('a second FileCommandResultMemoryWriter instance sees records written by the first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-file-writer-cross-'));
  try {
    const filePath = join(dir, 'memory.json');
    new FileCommandResultMemoryWriter(new FileMemoryStore(filePath)).write(validInput());

    const secondStore = new FileMemoryStore(filePath);
    assert.equal(secondStore.listRecords('command-results').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('file writer rejects invalid payloads with typed errors', () => {
  withTempStore((store) => {
    const writer = new FileCommandResultMemoryWriter(store);

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
});

test('file writer does not mutate the write-back payload', () => {
  withTempStore((store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    const input = {
      ...validInput(),
      output: { fact: 'prefiro reuniões de manhã', nested: { enabled: true } },
    };
    const before = structuredClone(input);

    writer.write(input);

    assert.deepEqual(input, before);
  });
});
