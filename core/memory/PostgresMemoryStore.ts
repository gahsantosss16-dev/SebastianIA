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
  private poolFailure: Error | undefined;
  public constructor(private readonly database: SqlQueryable) {}

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
    const store = new PostgresMemoryStore(pool);
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

  /**
   * Read-only homologation check: never returns server fields or credential material.
   * TLS is proven on this process's own socket (certificate chain and hostname
   * verified by Node). Through the Supabase Session Pooler, pg_stat_ssl only
   * describes the pooler's internal hop to Postgres, so it is not the client
   * connection; it remains the fallback when no client socket is reachable.
   */
  public async verifySecureIdentity(expectedUser: string): Promise<void> {
    this.assertAvailable();
    const facts = await this.describeHomologationFacts(expectedUser);
    const tlsVerified = facts.clientTlsAuthorized ?? facts.backendSsl;
    if (!facts.identityMatches || !tlsVerified) {
      throw new Error('PostgreSQL identity or TLS verification failed.');
    }
  }

  /** Homologation diagnostics: fixed booleans and the TLS protocol name only. */
  public async describeHomologationFacts(expectedUser: string): Promise<{
    identityMatches: boolean; sessionUserMatches: boolean; backendSsl: boolean;
    backendTlsVersion: string | null; clientTlsAuthorized: boolean | null; clientTlsVersion: string | null;
  }> {
    this.assertAvailable();
    const sql = `select current_user::text = $1 as identity_matches, session_user::text = $1 as session_user_matches,
        (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as backend_ssl,
        (select version from pg_stat_ssl where pid = pg_backend_pid()) as backend_tls_version`;
    type Row = { identity_matches: boolean; session_user_matches: boolean; backend_ssl: boolean | null; backend_tls_version: string | null };
    let row: Row | undefined;
    let clientTlsAuthorized: boolean | null = null;
    let clientTlsVersion: string | null = null;
    if (this.database instanceof Pool) {
      const client = await this.database.connect();
      try {
        const stream = (client as unknown as { connection?: { stream?: { authorized?: unknown; getProtocol?: () => string | null } } }).connection?.stream;
        const protocol = typeof stream?.getProtocol === 'function' ? stream.getProtocol() : null;
        clientTlsVersion = protocol === 'TLSv1.2' || protocol === 'TLSv1.3' ? protocol : null;
        clientTlsAuthorized = stream?.authorized === true && clientTlsVersion !== null;
        row = (await client.query<Row>(sql, [expectedUser])).rows[0];
      } finally { client.release(); }
    } else {
      row = (await this.database.query<Row>(sql, [expectedUser])).rows[0];
    }
    const version = row?.backend_tls_version ?? null;
    return { identityMatches: row?.identity_matches === true, sessionUserMatches: row?.session_user_matches === true,
      backendSsl: row?.backend_ssl === true, backendTlsVersion: version === 'TLSv1.2' || version === 'TLSv1.3' ? version : null,
      clientTlsAuthorized, clientTlsVersion };
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
