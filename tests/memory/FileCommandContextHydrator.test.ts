import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileCommandContextHydrator } from '../../core/memory/FileCommandContextHydrator.js';
import { FileCommandResultMemoryWriter } from '../../core/memory/FileCommandResultMemoryWriter.js';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import { InvalidCommandContextHydrationRequestError } from '../../core/memory/CommandContextHydrationContractErrors.js';

function withTempStore(run: (store: FileMemoryStore) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-file-hydrator-'));
  try {
    run(new FileMemoryStore(join(dir, 'memory.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('hydrator returns absent when no fact was ever remembered', () => {
  withTempStore((store) => {
    const hydrator = new FileCommandContextHydrator(store);

    const outcome = hydrator.hydrate({
      commandType: 'recall',
      generatedAt: '2026-08-11T00:00:00.000Z',
    });

    assert.deepEqual(outcome, { status: 'absent' });
  });
});

test('hydrator reconstructs remembered facts from persisted write-back records', () => {
  withTempStore((store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    writer.write({
      executionId: 'remember:2026-08-11T00:00:00.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { fact: 'prefiro reuniões de manhã' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = hydrator.hydrate({ commandType: 'recall', generatedAt: '2026-08-11T00:05:00.000Z' });

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

test('hydrator ignores records from other command types and failed results', () => {
  withTempStore((store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    writer.write({
      executionId: 'greeting:2026-08-11T00:00:00.000Z',
      commandType: 'greeting',
      commandGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultGeneratedAt: '2026-08-11T00:00:00.000Z',
      resultStatus: 'succeeded',
      output: { message: 'Hello!' },
      metadata: {},
    });
    writer.write({
      executionId: 'remember:2026-08-11T00:00:01.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-11T00:00:01.000Z',
      resultGeneratedAt: '2026-08-11T00:00:01.000Z',
      resultStatus: 'failed',
      output: {},
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = hydrator.hydrate({ commandType: 'recall', generatedAt: '2026-08-11T00:05:00.000Z' });

    assert.deepEqual(outcome, { status: 'absent' });
  });
});

test('hydrator sorts remembered facts chronologically', () => {
  withTempStore((store) => {
    const writer = new FileCommandResultMemoryWriter(store);
    writer.write({
      executionId: 'remember:2026-08-11T00:02:00.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-11T00:02:00.000Z',
      resultGeneratedAt: '2026-08-11T00:02:00.000Z',
      resultStatus: 'succeeded',
      output: { fact: 'segundo fato' },
      metadata: {},
    });
    writer.write({
      executionId: 'remember:2026-08-11T00:01:00.000Z',
      commandType: 'remember',
      commandGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultGeneratedAt: '2026-08-11T00:01:00.000Z',
      resultStatus: 'succeeded',
      output: { fact: 'primeiro fato' },
      metadata: {},
    });

    const hydrator = new FileCommandContextHydrator(store);
    const outcome = hydrator.hydrate({ commandType: 'recall', generatedAt: '2026-08-11T00:05:00.000Z' });

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

test('hydrator rejects invalid request with typed error', () => {
  withTempStore((store) => {
    const hydrator = new FileCommandContextHydrator(store);

    assert.throws(
      () => hydrator.hydrate(null as never),
      (error: unknown) => {
        assert.ok(error instanceof InvalidCommandContextHydrationRequestError);
        return true;
      },
    );
  });
});
