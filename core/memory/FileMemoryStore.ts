import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  FileMemoryStoreCorruptedError,
  FileMemoryStoreReadError,
  FileMemoryStoreWriteError,
  InvalidFileMemoryStorePathError,
} from './FileMemoryStoreErrors.js';

type FileMemoryDocument = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>>;

/**
 * Synchronous, dependency-free JSON-file-backed store. Every read re-parses the
 * file from disk and every write is a full read-modify-write with an atomic
 * temp-file rename, so two instances pointed at the same path stay consistent
 * across separate Node processes without any shared in-process cache.
 */
export class FileMemoryStore {
  private readonly filePath: string;

  public constructor(filePath: string) {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new InvalidFileMemoryStorePathError('File memory store path must be a non-empty string.');
    }

    this.filePath = filePath;
  }

  public listRecords(namespace: string): readonly Readonly<Record<string, unknown>>[] {
    this.assertValidNamespace(namespace);

    const document = this.readDocument();
    const namespaceRecords = document[namespace];
    return namespaceRecords ? Object.values(namespaceRecords) : [];
  }

  public writeRecord(namespace: string, key: string, value: Readonly<Record<string, unknown>>): void {
    this.assertValidNamespace(namespace);
    this.assertValidKey(key);

    const document = this.readDocument();
    const nextNamespaceRecords = {
      ...(document[namespace] ?? {}),
      [key]: structuredClone(value),
    };
    const nextDocument: FileMemoryDocument = {
      ...document,
      [namespace]: nextNamespaceRecords,
    };

    this.writeDocument(nextDocument);
  }

  private readDocument(): FileMemoryDocument {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw new FileMemoryStoreReadError('Failed to read the local memory store file.', { cause: error });
    }

    if (raw.trim() === '') {
      return {};
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new TypeError('Local memory store file must contain a JSON object.');
      }
      return parsed as FileMemoryDocument;
    } catch (error) {
      throw new FileMemoryStoreCorruptedError('Local memory store file contains invalid JSON.', { cause: error });
    }
  }

  private writeDocument(document: FileMemoryDocument): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(tempPath, JSON.stringify(document, null, 2), 'utf8');
      renameSync(tempPath, this.filePath);
    } catch (error) {
      throw new FileMemoryStoreWriteError('Failed to write the local memory store file.', { cause: error });
    }
  }

  private assertValidNamespace(namespace: string): void {
    if (typeof namespace !== 'string' || namespace.trim() === '') {
      throw new InvalidFileMemoryStorePathError('File memory store namespace must be a non-empty string.');
    }
  }

  private assertValidKey(key: string): void {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new InvalidFileMemoryStorePathError('File memory store key must be a non-empty string.');
    }
  }
}
