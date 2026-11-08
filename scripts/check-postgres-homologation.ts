/** Read-only development check. Logs only fixed status codes, never errors/URLs. */
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
  try {
    store = createSupabaseMemoryStore(process.env);
    await store.ready();
    try {
      await store.verifySecureIdentity(USER);
    } catch (identityError) {
      // Fixed booleans only: which half of the identity/TLS check failed.
      const facts = await store.describeHomologationFacts(USER);
      console.log(JSON.stringify({ status: 'diagnostic', ...facts }));
      throw identityError;
    }
    console.log(JSON.stringify({ status: 'passed', mode, identityVerified: true, tlsVerified: true, schemaReady: true, writesPerformed: false }));
  } catch (error) {
    const candidate = (error as { code?: unknown } | null)?.code;
    const message = error instanceof Error ? error.message : '';
    // Fixed application failures carry no Postgres code; map them to fixed labels.
    const appCode = message === 'PostgreSQL memory schema or permissions are unavailable.' ? 'SCHEMA_OR_PERMISSIONS_NOT_READY'
      : message === 'PostgreSQL identity or TLS verification failed.' ? 'IDENTITY_OR_TLS_CHECK_FAILED' : undefined;
    const code = typeof candidate === 'string' && (SAFE_CODES.has(candidate) || /^[0-9A-Z]{5}$/.test(candidate))
      ? candidate : appCode ?? 'POSTGRES_CHECK_FAILED';
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
