/** Development check. Optional isolated writes; logs only safe status fields, never errors/URLs. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSupabaseMemoryStore } from '../core/memory/PostgresMemoryStoreConfiguration.js';
import type { PostgresMemoryStore } from '../core/memory/PostgresMemoryStore.js';

const PROJECT = 'smtyixukyexezjumouvw';
const HOST = `db.${PROJECT}.supabase.co`;
const USER = 'sebastian_app';
const SAFE_CODES = new Set([
  'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT',
  'ECONNRESET', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--verify-persistence') || args.length > 1) {
    console.log(JSON.stringify({ status: 'blocked', code: 'INVALID_CHECK_ARGUMENTS' }));
    process.exitCode = 2;
    return;
  }
  const verifyPersistence = args[0] === '--verify-persistence';
  const mode = process.env.SEBASTIAN_SUPABASE_CONNECTION_MODE ?? 'direct';
  if (mode !== 'direct' && mode !== 'session-pooler') {
    console.log(JSON.stringify({ status: 'blocked', code: 'INVALID_HOMOLOGATION_CONFIGURATION' }));
    process.exitCode = 2;
    return;
  }
  const host = mode === 'direct' ? HOST : process.env.SEBASTIAN_SUPABASE_SESSION_POOLER_HOST?.trim();
  const raw = process.env.SEBASTIAN_SUPABASE_DATABASE_URL;
  const missing = [
    ...(!raw?.trim() ? ['SEBASTIAN_SUPABASE_DATABASE_URL'] : []),
    ...(!host ? ['SEBASTIAN_SUPABASE_SESSION_POOLER_HOST'] : []),
  ];
  if (missing.length > 0) {
    console.log(JSON.stringify({ status: 'blocked', missing }));
    process.exitCode = 2;
    return;
  }
  const expectedLogin = mode === 'direct' ? USER : `${USER}.${PROJECT}`;
  let valid = false;
  try {
    const url = new URL(raw!);
    const sslmode = url.searchParams.get('sslmode');
    const approvedHost = mode === 'direct' || /^aws-(?:[0-9]+-)?us-west-2\.pooler\.supabase\.com$/.test(host!);
    valid = approvedHost && ['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === host &&
      decodeURIComponent(url.username) === expectedLogin && url.password.length > 0 &&
      (url.port === '' || url.port === '5432') && url.pathname === '/postgres' &&
      (sslmode === null || sslmode === 'verify-full') &&
      !['ssl', 'sslcert', 'sslkey', 'sslrootcert'].some((key) => url.searchParams.has(key));
  } catch { /* Never print parsing exceptions; they can contain the entire URL. */ }
  if (!valid) {
    console.log(JSON.stringify({ status: 'blocked', code: 'INVALID_HOMOLOGATION_CONFIGURATION' }));
    process.exitCode = 2;
    return;
  }
  let store: PostgresMemoryStore | undefined;
  let reopened: PostgresMemoryStore | undefined;
  let stage = 'connect';
  let report: Record<string, unknown> = {};
  try {
    store = createSupabaseMemoryStore(process.env);
    await store.ready();
    stage = 'identity-and-client-tls';
    const connection = await store.inspectSecureConnection(USER);
    if (!connection.identityVerified) throw Object.assign(new Error('Identity mismatch.'), { code: 'IDENTITY_CHECK_FAILED' });
    if (!connection.tlsVerified) throw Object.assign(new Error('Client TLS verification failed.'), { code: 'CLIENT_TLS_CHECK_FAILED' });
    report = { status: 'passed', mode, identityVerified: true, tlsVerified: true, tlsProtocol: connection.tlsProtocol,
      backendTls: connection.backendTls, schemaReady: true, writesPerformed: false };
    if (verifyPersistence) {
      const namespace = `validation-github:${process.env.GITHUB_RUN_ID ?? 'manual'}:${randomUUID()}`;
      const key = 'connection-proof';
      const value = { run: randomUUID(), stage: 'inserted' };
      stage = 'write';
      await store.writeRecord(namespace, key, value);
      stage = 'read';
      assert.deepEqual(await store.listRecords(namespace), [value]);
      stage = 'update';
      const updated = { ...value, stage: 'updated' };
      await store.writeRecord(namespace, key, updated);
      assert.deepEqual(await store.listRecords(namespace), [updated]);
      await store.close();
      store = undefined;
      stage = 'reconnect-and-recover';
      reopened = createSupabaseMemoryStore(process.env);
      await reopened.ready();
      const recoveredConnection = await reopened.inspectSecureConnection(USER);
      assert.equal(recoveredConnection.identityVerified && recoveredConnection.tlsVerified, true);
      assert.deepEqual(await reopened.listRecords(namespace), [updated]);
      stage = 'isolation';
      assert.deepEqual(await reopened.listRecords(`${namespace}:other`), []);
      report = { ...report, writesPerformed: true, writeVerified: true, readVerified: true, updateVerified: true,
        reconnectVerified: true, isolationVerified: true, validationNamespace: namespace };
    }
  } catch (error) {
    const candidate = (error as { code?: unknown } | null)?.code;
    const appCodes = new Set(['IDENTITY_CHECK_FAILED', 'CLIENT_TLS_CHECK_FAILED']);
    const code = typeof candidate === 'string' && (SAFE_CODES.has(candidate) || appCodes.has(candidate) || /^[0-9A-Z]{5}$/.test(candidate))
      ? candidate : 'POSTGRES_CHECK_FAILED';
    report = { status: 'failed', stage, code };
    process.exitCode = 1;
  } finally {
    try { await store?.close(); await reopened?.close(); }
    catch { report = { status: 'failed', stage: 'close', code: 'POSTGRES_CLOSE_FAILED' }; process.exitCode = 1; }
  }
  console.log(JSON.stringify(report));
}

void main();
