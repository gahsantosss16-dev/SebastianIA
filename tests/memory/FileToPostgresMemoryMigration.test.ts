import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateFileMemoryToPostgres, MemoryMigrationError } from '../../core/memory/FileToPostgresMemoryMigration.js';
import { PostgresMemoryStore, type SqlQueryable } from '../../core/memory/PostgresMemoryStore.js';

/** In-memory stand-in for sebastian.memory_records that honours the store's SQL contract. */
function fakeDatabase(initial: Record<string, Record<string, unknown>> = {}) {
  const rows = new Map<string, string>();
  for (const [namespace, records] of Object.entries(initial)) {
    for (const [key, value] of Object.entries(records)) rows.set(`${namespace}\u0000${key}`, JSON.stringify(value));
  }
  const writes: string[] = [];
  const database: SqlQueryable = {
    query: async (text: string, values: readonly unknown[] = []) => {
      const [namespace, key, json] = values as string[];
      const id = `${namespace}\u0000${key}`;
      if (text.includes('on conflict (namespace, record_key) do nothing')) {
        writes.push(text);
        if (rows.has(id)) return { rows: [] };
        rows.set(id, json!);
        return { rows: [{ record_key: key }] as never[] };
      }
      if (text.includes('do update')) { writes.push(text); rows.set(id, json!); return { rows: [] }; }
      if (text.includes('where namespace = $1 and record_key = $2')) {
        const found = rows.get(id);
        return { rows: (found === undefined ? [] : [{ value_json: found }]) as never[] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { store: new PostgresMemoryStore(database), rows, writes };
}

function sourceFile(document: unknown): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-migration-'));
  const file = join(dir, 'memory.json');
  writeFileSync(file, JSON.stringify(document, null, 2), 'utf8');
  return { dir, file };
}

const document = {
  conversations: { 'conv-1': { id: 'conv-1', title: 'Cor favorita' } },
  'command-results': {
    'converse:1': { executionId: 'converse:1', output: { message: 'olá' } },
    'converse:2': { executionId: 'converse:2', output: { message: 'verde-água' } },
  },
};

test('dry-run reports pending inserts without writing or creating a backup', async () => {
  const { dir, file } = sourceFile(document);
  const { store, writes } = fakeDatabase();
  const report = await migrateFileMemoryToPostgres(file, store, 'dry-run');
  assert.equal(writes.length, 0);
  assert.equal(report.backupFile, null);
  assert.deepEqual(report.totals, { fileRecords: 3, inserted: 0, alreadyIdentical: 0, conflicts: 0, pendingInsert: 3 });
  assert.deepEqual(readdirSync(dir), ['memory.json']);
});

test('copy backs up the file byte for byte, inserts every record and verifies it, leaving the source untouched', async () => {
  const { dir, file } = sourceFile(document);
  const before = readFileSync(file);
  const { store, rows } = fakeDatabase();
  const report = await migrateFileMemoryToPostgres(file, store, 'copy', new Date('2026-11-09T00:00:00Z'));
  assert.equal(report.verified, true);
  assert.deepEqual(report.totals, { fileRecords: 3, inserted: 3, alreadyIdentical: 0, conflicts: 0, pendingInsert: 0 });
  assert.equal(rows.size, 3);
  assert.ok(report.backupFile?.startsWith('memory.backup-2026-11-09T00-00-00-000Z-'));
  assert.deepEqual(readFileSync(join(dir, report.backupFile!)), before);
  assert.deepEqual(readFileSync(file), before);
});

test('copy is idempotent: a second run inserts nothing and keeps every earlier backup', async () => {
  const { dir, file } = sourceFile(document);
  const { store } = fakeDatabase();
  await migrateFileMemoryToPostgres(file, store, 'copy');
  const second = await migrateFileMemoryToPostgres(file, store, 'copy');
  assert.equal(second.verified, true);
  assert.deepEqual(second.totals, { fileRecords: 3, inserted: 0, alreadyIdentical: 3, conflicts: 0, pendingInsert: 0 });
  assert.equal(readdirSync(dir).filter((name) => name.includes('.backup-')).length, 2);
});

test('an existing different database row is never overwritten and is reported as a conflict', async () => {
  const { file } = sourceFile(document);
  const newer = { id: 'conv-1', title: 'Título editado depois' };
  const { store, rows } = fakeDatabase({ conversations: { 'conv-1': newer } });
  const report = await migrateFileMemoryToPostgres(file, store, 'copy');
  assert.equal(report.namespaces.conversations?.conflicts, 1);
  assert.equal(report.namespaces.conversations?.inserted, 0);
  assert.deepEqual(JSON.parse(rows.get('conversations\u0000conv-1')!), newer);
  assert.equal(report.verified, true);
});

test('a missing source file migrates nothing and creates no backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-migration-'));
  const { store, writes } = fakeDatabase();
  const report = await migrateFileMemoryToPostgres(join(dir, 'memory.json'), store, 'copy');
  assert.equal(report.sourceFound, false);
  assert.equal(report.backupFile, null);
  assert.equal(report.totals.fileRecords, 0);
  assert.equal(writes.length, 0);
});

test('invalid JSON stops the migration before any backup or write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-migration-'));
  const file = join(dir, 'memory.json');
  writeFileSync(file, '{ not json', 'utf8');
  const { store, writes } = fakeDatabase();
  await assert.rejects(migrateFileMemoryToPostgres(file, store, 'copy'), MemoryMigrationError);
  assert.equal(writes.length, 0);
  assert.deepEqual(readdirSync(dir), ['memory.json']);
});

test('reports never contain record keys or values', async () => {
  const { file } = sourceFile(document);
  const report = await migrateFileMemoryToPostgres(file, fakeDatabase().store, 'copy');
  const serialized = JSON.stringify(report);
  for (const secret of ['conv-1', 'converse:1', 'verde-água', 'Cor favorita']) assert.equal(serialized.includes(secret), false);
});
