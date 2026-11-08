import { Pool, type PoolConfig, type QueryResultRow } from 'pg';

/**
 * Async persistence boundary for the durable online profile.  Values stay as
 * JSON text, rather than JSONB, so a migration never silently changes the
 * logical JSON representation written by FileMemoryStore.
 */
export interface SqlQueryable {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ readonly rows: readonly Row[] }>;
  end?(): Promise<void>;
}

export class PostgresMemoryStore {
  public constructor(private readonly database: SqlQueryable) {}

  public static fromConnectionString(connectionString: string): PostgresMemoryStore {
    if (typeof connectionString !== 'string' || connectionString.trim() === '') {
      throw new TypeError('SEBASTIAN_SUPABASE_DATABASE_URL must be a non-empty PostgreSQL connection string.');
    }
    const config: PoolConfig = { connectionString, max: 8, idleTimeoutMillis: 30_000 };
    return new PostgresMemoryStore(new Pool(config));
  }

  public async listRecords(namespace: string): Promise<readonly Readonly<Record<string, unknown>>[]> {
    this.assertPart(namespace, 'namespace');
    const result = await this.database.query<{ value_json: string }>(
      'select value_json from sebastian.memory_records where namespace = $1 order by record_key asc', [namespace],
    );
    return result.rows.map((row) => this.parseValue(row.value_json));
  }

  /** Atomic upsert: concurrent writes to different keys never overwrite one another. */
  public async writeRecord(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void> {
    this.assertPart(namespace, 'namespace');
    this.assertPart(key, 'key');
    let serialized: string;
    try { serialized = JSON.stringify(structuredClone(value)); } catch (cause) { throw new TypeError('Memory record must be JSON-serializable.', { cause }); }
    await this.database.query(
      `insert into sebastian.memory_records (namespace, record_key, value_json)
       values ($1, $2, $3)
       on conflict (namespace, record_key) do update
       set value_json = excluded.value_json, updated_at = clock_timestamp()`,
      [namespace, key, serialized],
    );
  }

  public async close(): Promise<void> { await this.database.end?.(); }

  private parseValue(raw: string): Readonly<Record<string, unknown>> {
    try {
      const value = JSON.parse(raw) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('not an object');
      return structuredClone(value) as Readonly<Record<string, unknown>>;
    } catch (cause) { throw new Error('PostgreSQL memory record contains invalid JSON.', { cause }); }
  }

  private assertPart(value: string, label: string): void {
    if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Memory ${label} must be a non-empty string.`);
  }
}
