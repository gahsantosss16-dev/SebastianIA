import { createHash } from 'node:crypto';
import { chunkDocument, estimateTokenCount } from './KnowledgeChunker.js';
import type { KnowledgeStore } from './KnowledgeStore.js';
import type {
  KnowledgeAuthorityLevel,
  KnowledgeIngestionFormat,
  KnowledgeSourceRecord,
  KnowledgeSourceType,
  KnowledgeTechnologyReference,
} from './KnowledgeTypes.js';

/**
 * Offline/CLI ingestion only (see docs/knowledge-layer-v1.md, section 4) -
 * never part of the live conversational path. Markdown/TXT only in this
 * phase; no OCR, no PDF/DOCX.
 */
export interface IngestSourceInput {
  readonly sourceId: string;
  readonly title: string;
  readonly domain: string;
  readonly sourceType: KnowledgeSourceType;
  readonly authorityLevel: KnowledgeAuthorityLevel;
  readonly usageRights: string;
  readonly origin: string;
  readonly language?: string;
  readonly author?: string;
  readonly version?: string;
  readonly publicationDate?: string;
  readonly technologyRelated?: KnowledgeTechnologyReference;
  readonly format: KnowledgeIngestionFormat;
  readonly rawText: string;
  readonly ingestedAt: string;
}

export interface IngestSourceResult {
  readonly sourceId: string;
  readonly chunksWritten: number;
  readonly chunksSkippedAsDuplicate: number;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function validateInput(input: IngestSourceInput): void {
  const requiredStrings: ReadonlyArray<readonly [string, unknown]> = [
    ['sourceId', input.sourceId], ['title', input.title], ['domain', input.domain],
    ['usageRights', input.usageRights], ['origin', input.origin], ['rawText', input.rawText],
    ['ingestedAt', input.ingestedAt],
  ];
  for (const [name, value] of requiredStrings) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`Knowledge ingestion "${name}" must be a non-empty string.`);
    }
  }
  if (input.format !== 'markdown' && input.format !== 'txt') {
    throw new TypeError('Knowledge ingestion format must be "markdown" or "txt" in this phase.');
  }
}

/**
 * Ingests one source: writes/refreshes its `KnowledgeSourceRecord`, then
 * chunks the raw text and writes each chunk. Re-ingesting unchanged content
 * is idempotent - `chunkId` is derived from `sourceId + locator + chunkHash`,
 * so the same content always resolves to the same chunk record and the
 * store's key-based write simply overwrites it in place (no duplicate
 * accumulates). Exact cross-source duplicates (identical `chunkHash` already
 * present under a different chunkId) are detected and skipped explicitly.
 */
export function ingestSource(store: KnowledgeStore, input: IngestSourceInput): IngestSourceResult {
  validateInput(input);

  const source: KnowledgeSourceRecord = {
    sourceId: input.sourceId,
    title: input.title,
    domain: input.domain,
    sourceType: input.sourceType,
    authorityLevel: input.authorityLevel,
    usageRights: input.usageRights,
    origin: input.origin,
    language: input.language ?? 'pt',
    status: 'active',
    ingestionDate: input.ingestedAt,
    contentHash: sha256(input.rawText),
    ...(input.author === undefined ? {} : { author: input.author }),
    ...(input.version === undefined ? {} : { version: input.version }),
    ...(input.publicationDate === undefined ? {} : { publicationDate: input.publicationDate }),
    ...(input.technologyRelated === undefined ? {} : { technologyRelated: input.technologyRelated }),
  };
  store.upsertSource(source);

  const draftChunks = chunkDocument(input.format, input.rawText);
  let chunksWritten = 0;
  let chunksSkippedAsDuplicate = 0;

  for (const draft of draftChunks) {
    const chunkHash = sha256(draft.text);
    const chunkId = sha256(`${input.sourceId}|${draft.locator}|${chunkHash}`).slice(0, 32);
    const existingByHash = store.findChunkByHash(chunkHash);
    if (existingByHash !== undefined && existingByHash.chunkId !== chunkId) {
      // Identical text already stored under a different chunk (a different
      // source, or the same source at a different locator) - the first
      // occurrence stays canonical, this one is not written again.
      chunksSkippedAsDuplicate += 1;
      continue;
    }
    store.upsertChunk({
      chunkId,
      sourceId: input.sourceId,
      sectionPath: draft.sectionPath,
      locator: draft.locator,
      text: draft.text,
      tokenCount: estimateTokenCount(draft.text),
      chunkHash,
      language: source.language,
      status: 'active',
    });
    chunksWritten += 1;
  }

  return { sourceId: input.sourceId, chunksWritten, chunksSkippedAsDuplicate };
}

/** Soft removal only (see docs/knowledge-layer-v1.md, section 4) - never mutates chunk content, only marks the source (and therefore its chunks, via retrieval-time filtering) as no longer active. */
export function deprecateSource(store: KnowledgeStore, sourceId: string, deprecatedBySourceId?: string): void {
  const existing = store.getSource(sourceId);
  if (existing === undefined) {
    throw new TypeError(`Knowledge source "${sourceId}" does not exist and cannot be deprecated.`);
  }
  store.upsertSource({
    ...existing,
    status: 'deprecated',
    ...(deprecatedBySourceId === undefined ? {} : { supersededBy: deprecatedBySourceId }),
  });
}
