/**
 * Shared lexical tokenizer - extracted from `ConversationContextComposer`
 * (which keeps using `significantTokens` unchanged) so the Knowledge Layer's
 * BM25-lite scorer reuses the exact same tokenization/stopword rules instead
 * of duplicating them, per the Knowledge Layer V1 spec (docs/knowledge-layer-v1.md, section 5).
 */

export const MIN_TOKEN_LENGTH = 3;

/**
 * Small, deliberately short stopword list - just enough that common
 * connectors don't create false relevance overlap between unrelated text.
 * Not a linguistic component, just a practical filter.
 */
export const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'que', 'e', 'é', 'um', 'uma', 'uns', 'umas',
  'para', 'com', 'em', 'no', 'na', 'nos', 'nas', 'por', 'ao', 'aos', 'à', 'às', 'se', 'sua', 'seu',
  'suas', 'seus', 'isso', 'você', 'voce', 'eu', 'me', 'meu', 'minha', 'meus', 'minhas', 'este', 'esta',
  'esse', 'essa', 'sobre', 'ainda', 'já', 'tem', 'têm', 'vai', 'vamos', 'muito', 'sebastian', 'ontem',
]);

/** Full token list (may repeat), used wherever term frequency matters (e.g. BM25). */
export function tokenizeWords(text: string, stopwords: ReadonlySet<string> = DEFAULT_STOPWORDS): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !stopwords.has(token));
}

/** Deduplicated token set, used wherever only presence/overlap matters (e.g. conversation memory relevance). */
export function significantTokens(text: string, stopwords: ReadonlySet<string> = DEFAULT_STOPWORDS): ReadonlySet<string> {
  return new Set(tokenizeWords(text, stopwords));
}
