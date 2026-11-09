import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { copyFileSync, constants, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { PostgresMemoryStore } from './PostgresMemoryStore.js';

/**
 * One-way, non-destructive copy of the local memory file into PostgreSQL.
 *
 * - `dry-run` never writes: it reports what a copy would insert.
 * - `copy` first writes an immutable backup of memory.json (never overwrites an
 *   existing file), then inserts only absent keys. Existing rows are never
 *   overwritten; a differing row is reported as a conflict and kept as is.
 * - Every migrated key is read back and compared with the file value.
 * Reports carry namespace names and counts only, never keys or values.
 */
export type MemoryMigrationMode = 'dry-run' | 'copy';

export interface NamespaceMigrationReport {
  readonly fileRecords: number;
  readonly inserted: number;
  readonly alreadyIdentical: number;
  readonly conflicts: number;
  readonly pendingInsert: number;
}

export interface MemoryMigrationReport {
  readonly mode: MemoryMigrationMode;
  readonly sourceFound: boolean;
  readonly backupFile: string | null;
  readonly namespaces: Readonly<Record<string, NamespaceMigrationReport>>;
  readonly totals: NamespaceMigrationReport;
  readonly verified: boolean;
}

export class MemoryMigrationError extends Error {
  public constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'MemoryMigrationError'; }
}

type FileDocument = Record<string, Record<string, Record<string, unknown>>>;

function readSourceDocument(filePath: string): { document: FileDocument; found: boolean } {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { document: {}, found: false };
    throw new MemoryMigrationError('Failed to read the local memory file.', { cause: error });
  }
  if (raw.trim() === '') return { document: {}, found: true };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (cause) { throw new MemoryMigrationError('Local memory file contains invalid JSON.', { cause }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new MemoryMigrationError('Local memory file must contain a JSON object.');
  for (const [namespace, records] of Object.entries(parsed)) {
    if (namespace.trim() === '' || !records || typeof records !== 'object' || Array.isArray(records)) {
      throw new MemoryMigrationError('Local memory file has an invalid namespace.');
    }
    for (const [key, value] of Object.entries(records as Record<string, unknown>)) {
      if (key.trim() === '' || !value || typeof value !== 'object' || Array.isArray(value)) {
        throw new MemoryMigrationError('Local memory file has an invalid record.');
      }
    }
  }
  return { document: parsed as FileDocument, found: true };
}

/** Immutable backup next to the source; fails rather than overwrite an existing file. */
function writeBackup(filePath: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = join(dirname(filePath), `${basename(filePath, '.json')}.backup-${stamp}-${randomUUID().slice(0, 8)}.json`);
  try {
    copyFileSync(filePath, target, constants.COPYFILE_EXCL);
  } catch (cause) { throw new MemoryMigrationError('Failed to write the memory backup.', { cause }); }
  if (!readFileSync(target).equals(readFileSync(filePath))) throw new MemoryMigrationError('Memory backup does not match the source file.');
  return target;
}

export async function migrateFileMemoryToPostgres(
  filePath: string,
  store: PostgresMemoryStore,
  mode: MemoryMigrationMode,
  now: Date = new Date(),
): Promise<MemoryMigrationReport> {
  const { document, found } = readSourceDocument(filePath);
  const backupPath = mode === 'copy' && found ? writeBackup(filePath, now) : null;
  const namespaces: Record<string, NamespaceMigrationReport> = {};
  const totals = { fileRecords: 0, inserted: 0, alreadyIdentical: 0, conflicts: 0, pendingInsert: 0 };
  let verified = true;

  for (const namespace of Object.keys(document).sort()) {
    const records = document[namespace]!;
    const report = { fileRecords: 0, inserted: 0, alreadyIdentical: 0, conflicts: 0, pendingInsert: 0 };
    for (const key of Object.keys(records).sort()) {
      const value = records[key]!;
      report.fileRecords += 1;
      if (mode === 'copy' && await store.insertRecordIfAbsent(namespace, key, value)) {
        report.inserted += 1;
        const stored = await store.readRecord(namespace, key);
        if (!isDeepStrictEqual(stored, value)) verified = false;
        continue;
      }
      const existing = await store.readRecord(namespace, key);
      if (existing === undefined) report.pendingInsert += 1;
      else if (isDeepStrictEqual(existing, value)) report.alreadyIdentical += 1;
      else report.conflicts += 1;
    }
    if (mode === 'copy' && report.pendingInsert > 0) verified = false;
    namespaces[namespace] = report;
    for (const field of Object.keys(totals) as (keyof typeof totals)[]) totals[field] += report[field];
  }

  return { mode, sourceFound: found, backupFile: backupPath === null ? null : basename(backupPath), namespaces, totals, verified };
}
