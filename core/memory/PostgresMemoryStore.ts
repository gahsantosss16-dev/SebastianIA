import { TLSSocket, checkServerIdentity } from 'node:tls';
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

const BATCH_SIZE = 500;

export class PostgresMemoryStore {
  private poolFailure: Error | undefined;
  public constructor(private readonly database: SqlQueryable, private readonly pool?: Pool, private readonly tlsHostname?: string) {}

  public static fromConnectionString(connectionString: string, ca?: string): PostgresMemoryStore {
    if (typeof connectionString !== 'string' || connectionString.trim() === '') {
      throw new TypeError('SEBASTIAN_SUPABASE_DATABASE_URL must be a non-empty PostgreSQL connection string.');
    }
    let url: URL;
    try { url = new URL(connectionString); } catch { throw new TypeError('Invalid PostgreSQL connection URL.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new TypeError('Invalid PostgreSQL connection URL.');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!local) {
      // Never let connection-string SSL options disable certificate verification.
      for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) url.searchParams.delete(key);
    }
    const config: PoolConfig = {
      connectionString: url.toString(), max: 8, idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000, query_timeout: 15_000, statement_timeout: 15_000,
      ...(local ? {} : { ssl: { rejectUnauthorized: true, ...(ca === undefined ? {} : { ca }) } }),
    };
    const pool = new Pool(config);
    const store = new PostgresMemoryStore(pool, pool, url.hostname);
    pool.on('error', (cause) => { store.poolFailure = new Error('PostgreSQL memory connection failed; restart the persistence runtime.', { cause }); });
    return store;
  }

  public async listRecords(namespace: string): Promise<readonly Readonly<Record<string, unknown>>[]> {
    this.assertAvailable();
    this.assertPart(namespace, 'namespace');
    const result = await this.database.query<{ value_json: string }>(
      'select value_json from sebastian.memory_records where namespace = $1 order by record_key asc', [namespace],
    );
    return result.rows.map((row) => this.parseValue(row.value_json));
  }

  /** Atomic upsert: concurrent writes to different keys never overwrite one another. */
  public async writeRecord(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<void> {
    this.assertAvailable();
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

  /** Reads one record by its natural key; undefined when absent. */
  public async readRecord(namespace: string, key: string): Promise<Readonly<Record<string, unknown>> | undefined> {
    this.assertAvailable();
    this.assertPart(namespace, 'namespace');
    this.assertPart(key, 'key');
    const result = await this.database.query<{ value_json: string }>(
      'select value_json from sebastian.memory_records where namespace = $1 and record_key = $2', [namespace, key],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : this.parseValue(row.value_json);
  }

  /** Never overwrites: inserts only when the natural key is absent. Returns true when a row was inserted. */
  public async insertRecordIfAbsent(namespace: string, key: string, value: Readonly<Record<string, unknown>>): Promise<boolean> {
    this.assertAvailable();
    this.assertPart(namespace, 'namespace');
    this.assertPart(key, 'key');
    let serialized: string;
    try { serialized = JSON.stringify(structuredClone(value)); } catch (cause) { throw new TypeError('Memory record must be JSON-serializable.', { cause }); }
    const result = await this.database.query<{ record_key: string }>(
      `insert into sebastian.memory_records (namespace, record_key, value_json)
       values ($1, $2, $3)
       on conflict (namespace, record_key) do nothing
       returning record_key`,
      [namespace, key, serialized],
    );
    return result.rows.length === 1;
  }

  /** Batch read by natural key; returns `namespace\u0000key` → value for the rows that exist. */
  public async readRecordsByKey(keys: readonly { readonly namespace: string; readonly key: string }[]): Promise<Map<string, Readonly<Record<string, unknown>>>> {
    this.assertAvailable();
    const found = new Map<string, Readonly<Record<string, unknown>>>();
    for (let start = 0; start < keys.length; start += BATCH_SIZE) {
      const batch = keys.slice(start, start + BATCH_SIZE);
      for (const { namespace, key } of batch) { this.assertPart(namespace, 'namespace'); this.assertPart(key, 'key'); }
      const result = await this.database.query<{ namespace: string; record_key: string; value_json: string }>(
        `select m.namespace, m.record_key, m.value_json
         from sebastian.memory_records m
         join unnest($1::text[], $2::text[]) as k(namespace, record_key) using (namespace, record_key)`,
        [batch.map((entry) => entry.namespace), batch.map((entry) => entry.key)],
      );
      for (const row of result.rows) found.set(`${row.namespace}\u0000${row.record_key}`, this.parseValue(row.value_json));
    }
    return found;
  }

  /** Batch insert that never overwrites: returns the `namespace\u0000key` ids actually inserted. */
  public async insertRecordsIfAbsent(records: readonly { readonly namespace: string; readonly key: string; readonly value: Readonly<Record<string, unknown>> }[]): Promise<Set<string>> {
    this.assertAvailable();
    const inserted = new Set<string>();
    for (let start = 0; start < records.length; start += BATCH_SIZE) {
      const batch = records.slice(start, start + BATCH_SIZE);
      const serialized = batch.map(({ namespace, key, value }) => {
        this.assertPart(namespace, 'namespace');
        this.assertPart(key, 'key');
        try { return JSON.stringify(structuredClone(value)); } catch (cause) { throw new TypeError('Memory record must be JSON-serializable.', { cause }); }
      });
      const result = await this.database.query<{ namespace: string; record_key: string }>(
        `insert into sebastian.memory_records (namespace, record_key, value_json)
         select * from unnest($1::text[], $2::text[], $3::text[])
         on conflict (namespace, record_key) do nothing
         returning namespace, record_key`,
        [batch.map((entry) => entry.namespace), batch.map((entry) => entry.key), serialized],
      );
      for (const row of result.rows) inserted.add(`${row.namespace}\u0000${row.record_key}`);
    }
    return inserted;
  }

  /** Readiness checks schema and runtime privileges without reading stored content. */
  public async ready(): Promise<void> {
    this.assertAvailable();
    const result = await this.database.query<{ ready: boolean }>(
      `select (has_table_privilege(current_user, 'sebastian.memory_records', 'SELECT')
        and has_table_privilege(current_user, 'sebastian.memory_records', 'INSERT')
        and has_table_privilege(current_user, 'sebastian.memory_records', 'UPDATE')) as ready`,
    );
    if (result.rows[0]?.ready !== true) throw new Error('PostgreSQL memory schema or permissions are unavailable.');
    await this.database.query('select namespace from sebastian.memory_records limit 0');
  }

  /** Inspect the actual Node TLS socket; pg_stat_ssl through a pooler describes a different hop. */
  public async inspectSecureConnection(expectedUser: string): Promise<{
    identityVerified: boolean; tlsVerified: boolean; backendTls: boolean; tlsProtocol: string | null;
  }> {
    this.assertAvailable();
    if (!this.pool || !this.tlsHostname) throw new Error('PostgreSQL client TLS inspection is unavailable.');
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ identity_matches: boolean; backend_tls: boolean }>(
        `select current_user::text = $1 as identity_matches,
          coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false) as backend_tls`,
        [expectedUser],
      );
      // pg returns a Client instance; PoolClient typings omit its Connection property.
      const socket = (client as unknown as { connection?: { stream?: unknown } }).connection?.stream;
      const protocol = socket instanceof TLSSocket ? socket.getProtocol() : null;
      const tlsVerified = socket instanceof TLSSocket && socket.encrypted === true && socket.authorized === true &&
        (protocol === 'TLSv1.2' || protocol === 'TLSv1.3') &&
        checkServerIdentity(this.tlsHostname, socket.getPeerCertificate()) === undefined;
      return { identityVerified: result.rows[0]?.identity_matches === true, tlsVerified,
        backendTls: result.rows[0]?.backend_tls === true, tlsProtocol: protocol };
    } finally { client.release(); }
  }

  public async verifySecureIdentity(expectedUser: string): Promise<void> {
    const result = await this.inspectSecureConnection(expectedUser);
    if (!result.identityVerified || !result.tlsVerified) throw new Error('PostgreSQL identity or TLS verification failed.');
  }

  private assertAvailable(): void {
    if (this.poolFailure !== undefined) throw this.poolFailure;
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
