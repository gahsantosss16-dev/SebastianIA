import type {
  SpecializedTool,
  SpecializedToolInvocationInput,
  SpecializedToolInvocationResult,
} from '../tool/SpecializedToolInvocationContract.js';
import { searchKnowledge } from './KnowledgeRetrieval.js';
import type { KnowledgeStore } from './KnowledgeStore.js';
import type { KnowledgeAuthorityLevel } from './KnowledgeTypes.js';

export const KNOWLEDGE_SEARCH_TOOL_ID = 'knowledge.search';

/**
 * Keeps the tool's own output safely under the orchestrator's existing
 * observation cap (`MAX_OBSERVATION_CHARS = 2_000` in
 * CognitiveOperationalOrchestrator.ts) so knowledge results never get
 * truncated mid-excerpt by a layer that knows nothing about chunk
 * boundaries - see docs/knowledge-layer-v1.md, section 5.
 */
const MAX_MESSAGE_CHARS = 1_800;

const AUTHORITY_LABEL: Readonly<Record<KnowledgeAuthorityLevel, string>> = {
  'official-docs': 'documentação oficial',
  specification: 'especificação/norma',
  'internal-doc': 'documentação interna do projeto',
  book: 'livro/referência técnica',
};

interface KnowledgeCitationBlock {
  readonly citationTag: string;
  readonly sourceId: string;
  readonly title: string;
  readonly author?: string;
  readonly authorityLevel: KnowledgeAuthorityLevel;
  readonly sectionPath: readonly string[];
  readonly locator: string;
  readonly excerpt: string;
  readonly text: string;
}

/**
 * `knowledge.search` as a `SpecializedTool` - routed through the same
 * catalog/dispatcher as every other read-only tool. Deliberately never
 * given a `deterministicIntent.answerFromSuccessfulObservation` shortcut
 * (see docs/knowledge-layer-v1.md, section 2 and 8): its result always goes
 * through `synthesize()`'s existing evidence-grounding validation, never
 * straight to the user unfiltered.
 */
export class KnowledgeSearchTool implements SpecializedTool {
  public constructor(private readonly store: KnowledgeStore) {}

  /**
   * Cheap, generic relevance probe reusing the exact same BM25-lite ranking
   * `invoke` itself relies on - never a topic/keyword list. Intended as the
   * `OperationalToolPolicyEntry.broadApplicabilityProbe` for this tool's own
   * catalog entry (see OnlineSebastianApplication.ts): true whenever the
   * objective shares at least one real, scored term with some indexed chunk,
   * regardless of what that term is or which domain it belongs to.
   */
  public hasRelevantMatch(objective: string): boolean {
    return searchKnowledge(this.store, { query: objective }, { topK: 1 }).length > 0;
  }

  public invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
    const query = input.payload.query;
    const domain = input.payload.domain;
    const allowedKeys = new Set(['query', 'domain']);
    if (
      typeof query !== 'string' || query.trim().length < 2 || query.length > 200 ||
      (domain !== undefined && (typeof domain !== 'string' || domain.trim() === '')) ||
      Object.keys(input.payload).some((key) => !allowedKeys.has(key))
    ) {
      return {
        status: 'completed',
        output: Object.freeze({
          operation: 'knowledge.search', outcome: 'rejected', reasonCode: 'invalidToolArguments',
          message: 'Os parâmetros fornecidos para "knowledge.search" são inválidos.',
        }),
      };
    }

    const hits = searchKnowledge(this.store, { query, ...(domain === undefined ? {} : { domain }) });
    if (hits.length === 0) {
      return {
        status: 'completed',
        output: Object.freeze({
          operation: 'knowledge.search', outcome: 'ok', results: [],
          message: `Nenhum trecho relevante encontrado na biblioteca de conhecimento para "${query}".`,
        }),
      };
    }

    const blocks: KnowledgeCitationBlock[] = hits.map((hit, index) => {
      const location = [
        AUTHORITY_LABEL[hit.source.authorityLevel],
        // Explicit so synthesize()/the model can never silently substitute
        // general knowledge of a different version/edition for what this
        // specific source actually documents (e.g. citing an OWASP Top 10
        // 2025 chunk must never read as if it were the 2021 edition).
        ...(hit.source.version === undefined ? [] : [`versão ${hit.source.version}`]),
        ...(hit.chunk.sectionPath.length > 0 ? [hit.chunk.sectionPath.join(' > ')] : []),
        hit.chunk.locator,
      ].join(', ');
      return {
        citationTag: `[K${index + 1}]`,
        sourceId: hit.source.sourceId,
        title: hit.source.title,
        ...(hit.source.author === undefined ? {} : { author: hit.source.author }),
        authorityLevel: hit.source.authorityLevel,
        sectionPath: hit.chunk.sectionPath,
        locator: hit.chunk.locator,
        excerpt: hit.chunk.text,
        text: `[K${index + 1}] Fonte: "${hit.source.title}"${hit.source.author === undefined ? '' : ` — ${hit.source.author}`} (${location})\n${hit.chunk.text}`,
      };
    });

    const { includedBlocks, message } = this.buildBoundedMessage(query, blocks);
    const results = includedBlocks.map(({ text: _text, ...result }) => result);

    return {
      status: 'completed',
      output: Object.freeze({ operation: 'knowledge.search', outcome: 'ok', results, message }),
    };
  }

  private buildBoundedMessage(
    query: string,
    blocks: readonly KnowledgeCitationBlock[],
  ): { readonly includedBlocks: readonly KnowledgeCitationBlock[]; readonly message: string } {
    let included = blocks;
    let message = this.composeMessage(query, included);
    while (message.length > MAX_MESSAGE_CHARS && included.length > 1) {
      included = included.slice(0, -1);
      message = this.composeMessage(query, included);
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      message = `${message.slice(0, MAX_MESSAGE_CHARS - 1)}…`;
    }
    return { includedBlocks: included, message };
  }

  private composeMessage(query: string, blocks: readonly KnowledgeCitationBlock[]): string {
    return `Trechos recuperados da biblioteca de conhecimento para "${query}":\n\n${blocks.map((block) => block.text).join('\n\n')}`;
  }
}
