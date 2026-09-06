import type { FileMemoryStore } from '../memory/FileMemoryStore.js';
import type { KnowledgeChunkRecord, KnowledgeSourceRecord } from './KnowledgeTypes.js';

const SOURCES_NAMESPACE = 'knowledge.sources';
const CHUNKS_NAMESPACE = 'knowledge.chunks';

/**
 * Thin wrapper over the existing `FileMemoryStore` (see
 * docs/knowledge-layer-v1.md, section 0 and 4) - no new storage engine, no
 * database, no external service. Sources and chunks are two namespaces of
 * the same generic, dependency-free, atomically-written JSON store already
 * used for conversation memory.
 */
export class KnowledgeStore {
  public constructor(private readonly fileStore: FileMemoryStore) {}

  public listSources(): readonly KnowledgeSourceRecord[] {
    return this.fileStore.listRecords(SOURCES_NAMESPACE) as unknown as readonly KnowledgeSourceRecord[];
  }

  public getSource(sourceId: string): KnowledgeSourceRecord | undefined {
    return this.listSources().find((source) => source.sourceId === sourceId);
  }

  public upsertSource(source: KnowledgeSourceRecord): void {
    this.fileStore.writeRecord(SOURCES_NAMESPACE, source.sourceId, source as unknown as Record<string, unknown>);
  }

  public listChunks(): readonly KnowledgeChunkRecord[] {
    return this.fileStore.listRecords(CHUNKS_NAMESPACE) as unknown as readonly KnowledgeChunkRecord[];
  }

  public findChunkByHash(chunkHash: string): KnowledgeChunkRecord | undefined {
    return this.listChunks().find((chunk) => chunk.chunkHash === chunkHash);
  }

  public upsertChunk(chunk: KnowledgeChunkRecord): void {
    this.fileStore.writeRecord(CHUNKS_NAMESPACE, chunk.chunkId, chunk as unknown as Record<string, unknown>);
  }
}
