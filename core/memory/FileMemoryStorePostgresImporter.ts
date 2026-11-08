import { readFile } from 'node:fs/promises';
import { PostgresMemoryStore } from './PostgresMemoryStore.js';

type FileDocument = Record<string, Record<string, Record<string, unknown>>>;

export interface MemoryImportReport {
  readonly namespaces: number;
  readonly records: number;
  readonly imported: number;
}

/** Read-only source importer. Re-running is safe because the destination upserts by natural key. */
export async function importFileMemoryStore(filePath: string, destination: PostgresMemoryStore): Promise<MemoryImportReport> {
  const raw = await readFile(filePath, 'utf8');
  let document: unknown;
  try { document = raw.trim() === '' ? {} : JSON.parse(raw); } catch (cause) { throw new Error('Memory import refused: source JSON is invalid.', { cause }); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Memory import refused: source document must be an object.');
  let records = 0;
  for (const [namespace, entries] of Object.entries(document as FileDocument)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`Memory import refused: namespace ${namespace} is invalid.`);
    for (const [key, value] of Object.entries(entries)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Memory import refused: record ${namespace}/${key} is invalid.`);
      await destination.writeRecord(namespace, key, value);
      records += 1;
    }
  }
  return { namespaces: Object.keys(document as FileDocument).length, records, imported: records };
}
