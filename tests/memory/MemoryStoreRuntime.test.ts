import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStoreRuntime } from '../../core/memory/MemoryStoreRuntime.js';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import type { Logger } from '../../core/logger.js';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

test('shared store composition persists Core memory and can be reopened without dataDir on the application', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-store-runtime-'));
  try {
    const first = createMemoryStoreRuntime(dataDir, {});
    await first.ready();
    const writer = createSebastianApplication({ memoryStore: first.store, logger });
    await writer.executeCommand({ type: 'remember', input: { text: 'shared persistence boundary' }, generatedAt: '2026-11-08T00:00:00.000Z' });
    writer.shutdown();
    await first.close();
    const second = createMemoryStoreRuntime(dataDir, { SEBASTIAN_STORE_DRIVER: 'file' });
    await second.ready();
    const reader = createSebastianApplication({ memoryStore: second.store, logger });
    const result = await reader.executeCommand({ type: 'recall', input: {}, generatedAt: '2026-11-08T00:00:01.000Z' });
    assert.match(JSON.stringify(result.output), /shared persistence boundary/);
    reader.shutdown();
    await second.close();
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test('selecting Supabase without a connection URL fails without creating a local memory file', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-store-no-fallback-'));
  try {
    assert.throws(() => createMemoryStoreRuntime(dataDir, { SEBASTIAN_STORE_DRIVER: 'supabase' }), /SEBASTIAN_SUPABASE_DATABASE_URL/);
    assert.equal(existsSync(join(dataDir, 'memory.json')), false);
    assert.throws(() => createOnlineSebastianApplication(logger, undefined, dataDir, { SEBASTIAN_STORE_DRIVER: 'supabase' }), /shared async memory store/);
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test('a real refused PostgreSQL connection rejects readiness without a file fallback and the pool closes idempotently', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-store-unavailable-'));
  const runtime = createMemoryStoreRuntime(dataDir, {
    SEBASTIAN_STORE_DRIVER: 'supabase', SEBASTIAN_SUPABASE_DATABASE_URL: 'postgresql://validation:unused@127.0.0.1:1/validation',
  });
  try {
    await assert.rejects(runtime.ready());
    await assert.rejects(runtime.store.writeRecord('validation', 'key', { persisted: false }));
    assert.equal(existsSync(join(dataDir, 'memory.json')), false);
  } finally { await runtime.close(); await runtime.close(); rmSync(dataDir, { recursive: true, force: true }); }
});
