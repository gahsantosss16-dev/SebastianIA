import { PostgresMemoryStore } from './PostgresMemoryStore.js';

export type SebastianStoreDriver = 'file' | 'supabase';

export function resolveSebastianStoreDriver(env: NodeJS.ProcessEnv = process.env): SebastianStoreDriver {
  const configured = env.SEBASTIAN_STORE_DRIVER?.trim().toLowerCase() ?? 'file';
  if (configured === 'file' || configured === 'supabase') return configured;
  throw new TypeError('SEBASTIAN_STORE_DRIVER must be either "file" or "supabase".');
}

/** Never falls back to a local file when production explicitly selects Supabase. */
export function createSupabaseMemoryStore(env: NodeJS.ProcessEnv = process.env): PostgresMemoryStore {
  return PostgresMemoryStore.fromConnectionString(env.SEBASTIAN_SUPABASE_DATABASE_URL ?? '');
}
