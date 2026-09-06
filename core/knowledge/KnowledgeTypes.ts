/**
 * Data model for the Knowledge Layer V1 - see docs/knowledge-layer-v1.md,
 * section 3. Only 4 of the 6 authority tiers live here: "estado real do
 * projeto" and "conhecimento geral do modelo" are not stored sources, they
 * are the two other evidence channels already in the system (real Tool
 * observations, and the model's own unsourced reasoning).
 */
export type KnowledgeAuthorityLevel = 'official-docs' | 'specification' | 'internal-doc' | 'book';

export type KnowledgeSourceType = 'official-docs' | 'specification' | 'book' | 'internal-doc' | 'article';

export type KnowledgeSourceStatus = 'active' | 'deprecated';

export type KnowledgeIngestionFormat = 'markdown' | 'txt';

export interface KnowledgeTechnologyReference {
  readonly name: string;
  readonly versionRange?: string;
}

/**
 * One ingested document (a book, an official doc page, a spec, an internal
 * note). `sourceId` is caller-supplied at ingestion time (a stable slug) -
 * deriving it automatically from content was deliberately deferred (see
 * docs/knowledge-layer-v1.md, section 13, risk 1: this scheme is a one-way
 * door and changing it later invalidates already-issued citations).
 */
export interface KnowledgeSourceRecord {
  readonly sourceId: string;
  readonly title: string;
  readonly author?: string;
  readonly domain: string;
  readonly sourceType: KnowledgeSourceType;
  readonly version?: string;
  readonly publicationDate?: string;
  readonly language: string;
  readonly origin: string;
  readonly authorityLevel: KnowledgeAuthorityLevel;
  readonly status: KnowledgeSourceStatus;
  readonly supersededBy?: string;
  readonly usageRights: string;
  readonly technologyRelated?: KnowledgeTechnologyReference;
  readonly ingestionDate: string;
  readonly contentHash: string;
}

/**
 * One retrievable unit. `chunkId` is derived deterministically from
 * `sourceId + locator + chunkHash`, so re-ingesting unchanged content
 * reuses the same id (idempotent) instead of accumulating duplicates.
 */
export interface KnowledgeChunkRecord {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sectionPath: readonly string[];
  readonly locator: string;
  readonly text: string;
  readonly tokenCount: number;
  readonly chunkHash: string;
  readonly language: string;
  readonly status: KnowledgeSourceStatus;
}
