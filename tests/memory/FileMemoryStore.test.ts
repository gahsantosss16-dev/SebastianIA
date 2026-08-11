import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileMemoryStore } from '../../core/memory/FileMemoryStore.js';
import {
  FileMemoryStoreCorruptedError,
  InvalidFileMemoryStorePathError,
} from '../../core/memory/FileMemoryStoreErrors.js';

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-file-memory-store-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('store returns an empty list for a namespace that was never written', () => {
  withTempDir((dir) => {
    const store = new FileMemoryStore(join(dir, 'memory.json'));

    assert.deepEqual(store.listRecords('command-results'), []);
  });
});

test('store creates the target directory and file on first write', () => {
  withTempDir((dir) => {
    const filePath = join(dir, 'nested', 'memory.json');
    const store = new FileMemoryStore(filePath);

    store.writeRecord('command-results', 'remember:1', { fact: 'hello' });

    assert.equal(existsSync(filePath), true);
    assert.deepEqual(store.listRecords('command-results'), [{ fact: 'hello' }]);
  });
});

test('store persists records across independent instances pointed at the same path', () => {
  withTempDir((dir) => {
    const filePath = join(dir, 'memory.json');
    const writer = new FileMemoryStore(filePath);
    writer.writeRecord('command-results', 'remember:1', { fact: 'first' });

    const reader = new FileMemoryStore(filePath);
    assert.deepEqual(reader.listRecords('command-results'), [{ fact: 'first' }]);
  });
});

test('store accumulates multiple records in the same namespace without overwriting others', () => {
  withTempDir((dir) => {
    const store = new FileMemoryStore(join(dir, 'memory.json'));

    store.writeRecord('command-results', 'remember:1', { fact: 'first' });
    store.writeRecord('command-results', 'remember:2', { fact: 'second' });

    const records = store.listRecords('command-results');
    assert.equal(records.length, 2);
    assert.deepEqual(
      records.map((record) => record.fact).sort(),
      ['first', 'second'],
    );
  });
});

test('store overwrites a record written twice under the same key', () => {
  withTempDir((dir) => {
    const store = new FileMemoryStore(join(dir, 'memory.json'));

    store.writeRecord('command-results', 'remember:1', { fact: 'first' });
    store.writeRecord('command-results', 'remember:1', { fact: 'updated' });

    assert.deepEqual(store.listRecords('command-results'), [{ fact: 'updated' }]);
  });
});

test('store keeps namespaces isolated from each other', () => {
  withTempDir((dir) => {
    const store = new FileMemoryStore(join(dir, 'memory.json'));

    store.writeRecord('command-results', 'a', { value: 1 });
    store.writeRecord('other-namespace', 'b', { value: 2 });

    assert.deepEqual(store.listRecords('command-results'), [{ value: 1 }]);
    assert.deepEqual(store.listRecords('other-namespace'), [{ value: 2 }]);
  });
});

test('store does not retain a mutable reference to the written value', () => {
  withTempDir((dir) => {
    const store = new FileMemoryStore(join(dir, 'memory.json'));
    const value = { nested: { fact: 'original' } };

    store.writeRecord('command-results', 'a', value);
    value.nested.fact = 'mutated';

    const [record] = store.listRecords('command-results');
    assert.equal((record?.nested as { fact: string }).fact, 'original');
  });
});

test('store rejects an empty file path', () => {
  assert.throws(
    () => new FileMemoryStore(''),
    (error: unknown) => {
      assert.ok(error instanceof InvalidFileMemoryStorePathError);
      return true;
    },
  );
});

test('store surfaces a typed error for corrupted JSON content', () => {
  withTempDir((dir) => {
    const filePath = join(dir, 'memory.json');
    writeFileSync(filePath, '{ not valid json', 'utf8');
    const store = new FileMemoryStore(filePath);

    assert.throws(
      () => store.listRecords('command-results'),
      (error: unknown) => {
        assert.ok(error instanceof FileMemoryStoreCorruptedError);
        return true;
      },
    );
  });
});

test('store treats an empty file as an empty document', () => {
  withTempDir((dir) => {
    const filePath = join(dir, 'memory.json');
    writeFileSync(filePath, '', 'utf8');
    const store = new FileMemoryStore(filePath);

    assert.deepEqual(store.listRecords('command-results'), []);
  });
});
