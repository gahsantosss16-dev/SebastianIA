import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresMemoryStore, type SqlQueryable } from '../../core/memory/PostgresMemoryStore.js';

class FakeDatabase implements SqlQueryable {
  public readonly rows = new Map<string, string>();
  public async query<T extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<{ readonly rows: readonly T[] }> {
    if (text.startsWith('select')) {
      const namespace = values[0] as string;
      return { rows: [...this.rows.entries()].filter(([key]) => key.startsWith(`${namespace}\u0000`)).sort().map(([, value_json]) => ({ value_json } as unknown as T)) };
    }
    const [namespace, key, value] = values as [string, string, string];
    this.rows.set(`${namespace}\u0000${key}`, value);
    return { rows: [] };
  }
}

test('PostgresMemoryStore preserves namespaces and atomically upserts a logical key', async () => {
  const database = new FakeDatabase();
  const store = new PostgresMemoryStore(database);
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.writeRecord('command-results', `key-${i}`, { i })));
  await store.writeRecord('command-results', 'key-0', { i: 99 });
  assert.equal((await store.listRecords('command-results')).length, 20);
  assert.deepEqual((await store.listRecords('command-results')).find((row) => row.i === 99), { i: 99 });
  assert.deepEqual(await store.listRecords('other'), []);
});

test('PostgresMemoryStore rejects malformed database payloads instead of returning stale data', async () => {
  const database = new FakeDatabase();
  database.rows.set('command-results\u0000broken', '{');
  await assert.rejects(new PostgresMemoryStore(database).listRecords('command-results'), /invalid JSON/);
});

function identityDatabase(row: Record<string, unknown>): SqlQueryable {
  return { query: async <Row>() => ({ rows: [row as Row] }) } as unknown as SqlQueryable;
}

test('verifySecureIdentity fails closed when identity or TLS cannot be proven', async () => {
  await assert.rejects(new PostgresMemoryStore(identityDatabase({ identity_matches: true, session_user_matches: true, backend_ssl: false, backend_tls_version: null })).verifySecureIdentity('sebastian_app'), /identity or TLS/);
  await assert.rejects(new PostgresMemoryStore(identityDatabase({ identity_matches: false, session_user_matches: false, backend_ssl: true, backend_tls_version: 'TLSv1.3' })).verifySecureIdentity('sebastian_app'), /identity or TLS/);
  await new PostgresMemoryStore(identityDatabase({ identity_matches: true, session_user_matches: true, backend_ssl: true, backend_tls_version: 'TLSv1.3' })).verifySecureIdentity('sebastian_app');
});

test('homologation facts never expose more than fixed booleans and TLS protocol names', async () => {
  const facts = await new PostgresMemoryStore(identityDatabase({ identity_matches: true, session_user_matches: true, backend_ssl: true, backend_tls_version: 'weird' })).describeHomologationFacts('sebastian_app');
  assert.deepEqual(facts, { identityMatches: true, sessionUserMatches: true, backendSsl: true, backendTlsVersion: null, clientTlsAuthorized: null, clientTlsVersion: null });
});
