/** Read-only development check. Logs only fixed status codes, never errors/URLs. */
import { createSupabaseMemoryStore } from '../core/memory/PostgresMemoryStoreConfiguration.js';
import type { PostgresMemoryStore } from '../core/memory/PostgresMemoryStore.js';

const HOST = 'db.smtyixukyexezjumouvw.supabase.co';
const USER = 'sebastian_app';
const SAFE_CODES = new Set([
  'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT',
  'ECONNRESET', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

async function main(): Promise<void> {
  const raw = process.env.SEBASTIAN_SUPABASE_DATABASE_URL;
  if (!raw?.trim()) {
    console.log(JSON.stringify({ status: 'blocked', missing: ['SEBASTIAN_SUPABASE_DATABASE_URL'] }));
    process.exitCode = 2;
    return;
  }
  let valid = false;
  try {
    const url = new URL(raw);
    const sslmode = url.searchParams.get('sslmode');
    valid = ['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === HOST &&
      decodeURIComponent(url.username) === USER && url.password.length > 0 &&
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
  try {
    store = createSupabaseMemoryStore(process.env);
    await store.ready();
    await store.verifySecureIdentity(USER);
    console.log(JSON.stringify({ status: 'passed', identityVerified: true, tlsVerified: true, schemaReady: true, writesPerformed: false }));
  } catch (error) {
    const candidate = (error as { code?: unknown } | null)?.code;
    const code = typeof candidate === 'string' && (SAFE_CODES.has(candidate) || /^[0-9A-Z]{5}$/.test(candidate))
      ? candidate : 'POSTGRES_CHECK_FAILED';
    console.log(JSON.stringify({ status: 'failed', code }));
    process.exitCode = 1;
  } finally {
    try { await store?.close(); }
    catch {
      console.log(JSON.stringify({ status: 'failed', code: 'POSTGRES_CLOSE_FAILED' }));
      process.exitCode = 1;
    }
  }
}

void main();
