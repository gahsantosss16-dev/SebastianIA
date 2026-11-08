import type { AsyncMemoryStore } from '../memory/AsyncMemoryStore.js';
import type { KnowledgeChunkRecord, KnowledgeSourceRecord } from './KnowledgeTypes.js';

const SOURCES_NAMESPACE = 'knowledge.sources';
const CHUNKS_NAMESPACE = 'knowledge.chunks';

/**
 * Typed knowledge namespaces over `AsyncMemoryStore` (see
 * docs/knowledge-layer-v1.md, section 0 and 4) - no new storage engine, no
 * database, no external service. Sources and chunks are two namespaces of
 * the same generic, dependency-free, atomically-written JSON store already
 * used for conversation memory.
 */
export class KnowledgeStore {
  public constructor(private readonly store: AsyncMemoryStore) {}

  public async listSources(): Promise<readonly KnowledgeSourceRecord[]> {
    return (await this.store.listRecords(SOURCES_NAMESPACE)) as unknown as readonly KnowledgeSourceRecord[];
  }

  public async getSource(sourceId: string): Promise<KnowledgeSourceRecord | undefined> {
    return (await this.listSources()).find((source) => source.sourceId === sourceId);
  }

  public async upsertSource(source: KnowledgeSourceRecord): Promise<void> {
    await this.store.writeRecord(SOURCES_NAMESPACE, source.sourceId, source as unknown as Record<string, unknown>);
  }

  public async listChunks(): Promise<readonly KnowledgeChunkRecord[]> {
    return (await this.store.listRecords(CHUNKS_NAMESPACE)) as unknown as readonly KnowledgeChunkRecord[];
  }

  public async findChunkByHash(chunkHash: string): Promise<KnowledgeChunkRecord | undefined> {
    return (await this.listChunks()).find((chunk) => chunk.chunkHash === chunkHash);
  }

  public async upsertChunk(chunk: KnowledgeChunkRecord): Promise<void> {
    await this.store.writeRecord(CHUNKS_NAMESPACE, chunk.chunkId, chunk as unknown as Record<string, unknown>);
  }
}
