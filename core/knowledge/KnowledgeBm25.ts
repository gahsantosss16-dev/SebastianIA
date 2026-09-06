import { tokenizeWords } from './LexicalTokenizer.js';

/**
 * Pure-TypeScript BM25-lite scorer - no dependency, no external service (see
 * docs/knowledge-layer-v1.md, section 5). Standard BM25 term-frequency
 * saturation (`k1`) and document-length normalization (`b`), with IDF
 * computed over whatever document set is passed in per call. Adequate for
 * v1's small corpus (a handful of sources, low thousands of chunks); revisit
 * if the corpus grows enough that per-query IDF recomputation becomes a
 * measurable cost (see docs/knowledge-layer-v1.md, section 13, risk 2).
 */
export interface Bm25Document {
  readonly id: string;
  readonly text: string;
}

export interface Bm25ScoredResult {
  readonly id: string;
  readonly score: number;
}

export interface Bm25Options {
  readonly k1?: number;
  readonly b?: number;
}

const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

export function bm25Search(
  query: string,
  documents: readonly Bm25Document[],
  options: Bm25Options = {},
): readonly Bm25ScoredResult[] {
  const k1 = options.k1 ?? DEFAULT_K1;
  const b = options.b ?? DEFAULT_B;
  const queryTerms = tokenizeWords(query);
  if (queryTerms.length === 0 || documents.length === 0) {
    return [];
  }

  const docTermFrequencies = documents.map((document) => {
    const terms = tokenizeWords(document.text);
    const frequencies = new Map<string, number>();
    for (const term of terms) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    }
    return { id: document.id, length: terms.length, frequencies };
  });

  const totalDocuments = docTermFrequencies.length;
  const averageLength = docTermFrequencies.reduce((sum, doc) => sum + doc.length, 0) / totalDocuments;

  const idfByTerm = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    const documentsContainingTerm = docTermFrequencies.filter((doc) => doc.frequencies.has(term)).length;
    // Standard BM25 IDF with a +1 floor so a term present in every document
    // still contributes a small positive weight instead of going negative.
    const idf = Math.log(1 + (totalDocuments - documentsContainingTerm + 0.5) / (documentsContainingTerm + 0.5));
    idfByTerm.set(term, idf);
  }

  const results: Bm25ScoredResult[] = [];
  for (const doc of docTermFrequencies) {
    let score = 0;
    for (const term of queryTerms) {
      const termFrequency = doc.frequencies.get(term);
      if (!termFrequency) {
        continue;
      }
      const idf = idfByTerm.get(term) ?? 0;
      const normalizedLength = doc.length / (averageLength || 1);
      score += idf * (termFrequency * (k1 + 1)) / (termFrequency + k1 * (1 - b + b * normalizedLength));
    }
    if (score > 0) {
      results.push({ id: doc.id, score });
    }
  }

  return results.sort((left, right) => right.score - left.score);
}
