import { AsyncFileMemoryStore, AsyncPostgresMemoryStore, type AsyncMemoryStore } from './AsyncMemoryStore.js';
import { FileMemoryStore } from './FileMemoryStore.js';
import { resolveMemoryFilePath } from './FileMemoryStoreLocation.js';
import { createSupabaseMemoryStore, resolveSebastianStoreDriver, type SebastianStoreDriver } from './PostgresMemoryStoreConfiguration.js';

export interface MemoryStoreRuntime {
  readonly driver: SebastianStoreDriver;
  readonly store: AsyncMemoryStore;
  ready(): Promise<void>;
  close(): Promise<void>;
}

/** One owned store for the whole server. An explicitly selected database never falls back to disk. */
export function createMemoryStoreRuntime(dataDir: string, env: NodeJS.ProcessEnv = process.env): MemoryStoreRuntime {
  const driver = resolveSebastianStoreDriver(env);
  if (driver === 'file') {
    const store = new AsyncFileMemoryStore(new FileMemoryStore(resolveMemoryFilePath(dataDir)));
    return { driver, store, ready: async () => { await store.listRecords('conversations'); }, close: async () => {} };
  }
  const postgres = createSupabaseMemoryStore(env);
  let closing: Promise<void> | undefined;
  return { driver, store: new AsyncPostgresMemoryStore(postgres), ready: () => postgres.ready(), close: () => closing ??= postgres.close() };
}
