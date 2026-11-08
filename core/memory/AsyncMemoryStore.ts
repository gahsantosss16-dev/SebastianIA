import type { FileMemoryStore } from './FileMemoryStore.js';
import type { PostgresMemoryStore } from './PostgresMemoryStore.js';

/** The only persistence boundary used by new online components. */
export interface AsyncMemoryStore {
  listRecords(namespace: string): Promise<readonly Readonly<Record<string, unknown>>[]>;
  writeRecord(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void>;
}

/** Keeps the development file driver explicit while allowing async consumers. */
export class AsyncFileMemoryStore implements AsyncMemoryStore {
  public constructor(private readonly store: FileMemoryStore) {}
  public async listRecords(namespace: string): Promise<readonly Readonly<Record<string, unknown>>[]> { return this.store.listRecords(namespace); }
  public async writeRecord(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void> { this.store.writeRecord(namespace, key, value); }
}

export class AsyncPostgresMemoryStore implements AsyncMemoryStore {
  public constructor(private readonly store: PostgresMemoryStore) {}
  public listRecords(namespace: string): Promise<readonly Readonly<Record<string, unknown>>[]> { return this.store.listRecords(namespace); }
  public writeRecord(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void> { return this.store.writeRecord(namespace, key, value); }
}
