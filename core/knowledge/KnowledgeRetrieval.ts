import { bm25Search } from './KnowledgeBm25.js';
import type { KnowledgeStore } from './KnowledgeStore.js';
import type { KnowledgeAuthorityLevel, KnowledgeChunkRecord, KnowledgeSourceRecord } from './KnowledgeTypes.js';

/**
 * Retrieval for the Knowledge Layer V1 - lexical only (see
 * docs/knowledge-layer-v1.md, section 5). Embeddings/hybrid retrieval are
 * explicitly deferred to an optional future phase, never assumed here.
 */
export interface KnowledgeSearchQuery {
  readonly query: string;
  readonly domain?: string;
}

export interface KnowledgeSearchHit {
  readonly chunk: KnowledgeChunkRecord;
  readonly source: KnowledgeSourceRecord;
  readonly score: number;
}

export interface KnowledgeSearchOptions {
  readonly topK?: number;
  readonly maxPerSource?: number;
}

const DEFAULT_TOP_K = 5;
const DEFAULT_MAX_PER_SOURCE = 2;

/** Ranking weight only - never read by any permission/authorization check (see docs/knowledge-layer-v1.md, section 8). */
const AUTHORITY_WEIGHT: Readonly<Record<KnowledgeAuthorityLevel, number>> = {
  'official-docs': 1.15,
  specification: 1.1,
  'internal-doc': 1.05,
  book: 1.0,
};

export function searchKnowledge(
  store: KnowledgeStore,
  query: KnowledgeSearchQuery,
  options: KnowledgeSearchOptions = {},
): readonly KnowledgeSearchHit[] {
  if (typeof query.query !== 'string' || query.query.trim() === '') {
    return [];
  }

  const sourcesById = new Map(store.listSources().map((source) => [source.sourceId, source]));
  const activeChunks = store.listChunks().filter((chunk) => {
    if (chunk.status !== 'active') {
      return false;
    }
    const source = sourcesById.get(chunk.sourceId);
    if (!source || source.status !== 'active') {
      return false;
    }
    if (query.domain !== undefined && source.domain !== query.domain) {
      return false;
    }
    return true;
  });
  if (activeChunks.length === 0) {
    return [];
  }

  const chunkById = new Map(activeChunks.map((chunk) => [chunk.chunkId, chunk]));
  const bm25Results = bm25Search(query.query, activeChunks.map((chunk) => ({ id: chunk.chunkId, text: chunk.text })));

  const ranked = bm25Results
    .map((result) => {
      const chunk = chunkById.get(result.id)!;
      const source = sourcesById.get(chunk.sourceId)!;
      const authorityWeight = AUTHORITY_WEIGHT[source.authorityLevel];
      return { chunk, source, score: result.score * authorityWeight };
    })
    .sort((left, right) =>
      right.score - left.score ||
      (right.source.publicationDate ?? '').localeCompare(left.source.publicationDate ?? ''));

  const maxPerSource = options.maxPerSource ?? DEFAULT_MAX_PER_SOURCE;
  const topK = options.topK ?? DEFAULT_TOP_K;
  const perSourceCount = new Map<string, number>();
  const diversified: KnowledgeSearchHit[] = [];
  for (const hit of ranked) {
    const count = perSourceCount.get(hit.source.sourceId) ?? 0;
    if (count >= maxPerSource) {
      continue;
    }
    perSourceCount.set(hit.source.sourceId, count + 1);
    diversified.push(hit);
    if (diversified.length >= topK) {
      break;
    }
  }

  return diversified;
}
