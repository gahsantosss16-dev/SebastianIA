import type { RecentExchangeRecord, RememberedFactRecord } from '../memory/index.js';
import { InvalidModelInterpretationRequestError } from './ModelProviderContractErrors.js';

/**
 * Broad, deterministic classification of what the current message is doing -
 * not full NLU, but enough to separate "answer this from memory",
 * "resume something named earlier", "pick up the previous thread with no new
 * subject of its own", and "no special handling needed" before any specific
 * marker-based recognition runs.
 */
export type ConversationIntentCategory = 'resumptionReference' | 'continuationReference' | 'question' | 'plain';

/** A single piece of memory (a fact or a past exchange) judged relevant to the current message, with the score that ranked it. */
export interface RelevantMemoryMatch {
  readonly source: 'fact' | 'exchange';
  readonly id: string;
  readonly content: string;
  readonly recordedAt: string;
  readonly score: number;
}

export interface ComposedConversationContext {
  readonly text: string;
  readonly intent: ConversationIntentCategory;
  /** Ranked, capped selection of memory content that actually overlaps with the current message - never the full memory set. */
  readonly relevantMemories: readonly RelevantMemoryMatch[];
  readonly mostRecentFact?: RememberedFactRecord;
  readonly mostRecentExchange?: RecentExchangeRecord;
}

export interface ConversationContextComposerInput {
  readonly text: string;
  readonly rememberedFacts: readonly RememberedFactRecord[];
  readonly recentExchanges: readonly RecentExchangeRecord[];
}

/** Short, generic references to "keep going with whatever we were just doing" - order-agnostic substrings, deliberately few and specific. */
const CONTINUATION_MARKERS: readonly string[] = ['continua', 'e agora', 'como ficou', 'onde paramos', 'no que paramos'];

/** A resumption reference names a subject ("projeto"/"tarefa"/"trabalho") together with an explicit intent to continue it - distinct from, and checked before, the bare continuation markers above. */
const RESUMPTION_VERB = 'continuar';
const RESUMPTION_SUBJECTS: readonly string[] = ['projeto', 'tarefa', 'trabalho'];

const INTERROGATIVE_STARTERS: readonly string[] = [
  'qual',
  'quais',
  'quem',
  'onde',
  'quando',
  'como',
  'por que',
  'porque',
  'o que',
];

/**
 * Small, deliberately short stopword list - just enough that common
 * connectors don't create false relevance overlap between unrelated
 * sentences. Not a linguistic component, just a practical filter.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'que', 'e', 'é', 'um', 'uma', 'uns', 'umas',
  'para', 'com', 'em', 'no', 'na', 'nos', 'nas', 'por', 'ao', 'aos', 'à', 'às', 'se', 'sua', 'seu',
  'suas', 'seus', 'isso', 'você', 'voce', 'eu', 'me', 'meu', 'minha', 'meus', 'minhas', 'este', 'esta',
  'esse', 'essa', 'sobre', 'ainda', 'já', 'tem', 'têm', 'vai', 'vamos', 'muito', 'sebastian', 'ontem',
]);

const MAX_RELEVANT_MEMORIES = 3;
const MIN_TOKEN_LENGTH = 3;

/**
 * Builds the small, explicit piece of "understanding" the ModelProvider acts
 * on before falling back to its own marker-based recognition: what kind of
 * reference the message is making, and which already-stored memories (facts
 * or past exchanges) are actually relevant to it - by real keyword overlap,
 * never by dumping everything available. This is intentionally a pure,
 * independently testable step, not folded into the provider's own
 * pattern-matching so the "build context" and "recognize a specific command"
 * responsibilities stay separate.
 */
export class ConversationContextComposer {
  public compose(input: ConversationContextComposerInput): ComposedConversationContext {
    this.validateInput(input);

    const lowerText = input.text.toLowerCase();
    const mostRecentFact = this.latestByRecordedAt(input.rememberedFacts);
    const mostRecentExchange = this.latestByRecordedAt(input.recentExchanges);

    return {
      text: input.text,
      intent: this.classifyIntent(lowerText),
      relevantMemories: this.selectRelevantMemories(input.text, input.rememberedFacts, input.recentExchanges),
      ...(mostRecentFact === undefined ? {} : { mostRecentFact }),
      ...(mostRecentExchange === undefined ? {} : { mostRecentExchange }),
    };
  }

  private classifyIntent(lowerText: string): ConversationIntentCategory {
    if (this.isResumptionReference(lowerText)) {
      return 'resumptionReference';
    }
    if (this.isContinuationReference(lowerText)) {
      return 'continuationReference';
    }
    if (this.isQuestion(lowerText)) {
      return 'question';
    }
    return 'plain';
  }

  private isResumptionReference(lowerText: string): boolean {
    if (!lowerText.includes(RESUMPTION_VERB)) {
      return false;
    }
    return RESUMPTION_SUBJECTS.some((subject) => lowerText.includes(subject));
  }

  private isContinuationReference(lowerText: string): boolean {
    const trimmed = lowerText.trim();
    return CONTINUATION_MARKERS.some((marker) => lowerText.includes(marker)) ||
      /^(e\s|entao\s|então\s|nesse caso\b|neste caso\b|sobre isso\b|quanto a isso\b)/.test(trimmed) ||
      /\b(disso|nisso)\b/.test(trimmed) ||
      /\b(?:as|os)\s+(?:duas|dois|ambas|ambos)\b/.test(trimmed);
  }

  private isQuestion(lowerText: string): boolean {
    if (lowerText.includes('?')) {
      return true;
    }
    const trimmed = lowerText.trim();
    return INTERROGATIVE_STARTERS.some((starter) => trimmed === starter || trimmed.startsWith(`${starter} `));
  }

  private selectRelevantMemories(
    text: string,
    rememberedFacts: readonly RememberedFactRecord[],
    recentExchanges: readonly RecentExchangeRecord[],
  ): readonly RelevantMemoryMatch[] {
    const queryTokens = this.significantTokens(text);
    if (queryTokens.size === 0) {
      return [];
    }

    const candidates: RelevantMemoryMatch[] = [];

    for (const fact of rememberedFacts) {
      const score = this.overlapScore(queryTokens, this.significantTokens(fact.content));
      if (score > 0) {
        candidates.push({ source: 'fact', id: fact.id, content: fact.content, recordedAt: fact.recordedAt, score });
      }
    }

    for (const exchange of recentExchanges) {
      const score = this.overlapScore(queryTokens, this.significantTokens(`${exchange.requestText} ${exchange.summary}`));
      if (score > 0) {
        candidates.push({ source: 'exchange', id: exchange.id, content: exchange.summary, recordedAt: exchange.recordedAt, score });
      }
    }

    return candidates
      .sort((left, right) => right.score - left.score || right.recordedAt.localeCompare(left.recordedAt))
      .slice(0, MAX_RELEVANT_MEMORIES);
  }

  private significantTokens(text: string): ReadonlySet<string> {
    const tokens = text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
    return new Set(tokens);
  }

  private overlapScore(query: ReadonlySet<string>, candidate: ReadonlySet<string>): number {
    let score = 0;
    for (const token of query) {
      if (candidate.has(token)) {
        score += 1;
      }
    }
    return score;
  }

  private latestByRecordedAt<T extends { readonly recordedAt: string }>(records: readonly T[]): T | undefined {
    if (records.length === 0) {
      return undefined;
    }
    return [...records].sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0];
  }

  private validateInput(input: ConversationContextComposerInput): void {
    const isObject = input && typeof input === 'object' && !Array.isArray(input);
    if (!isObject) {
      throw new InvalidModelInterpretationRequestError('Conversation context composer input must be an object.');
    }
    if (typeof input.text !== 'string' || input.text.trim() === '') {
      throw new InvalidModelInterpretationRequestError('Conversation context composer text must be a non-empty string.');
    }
    if (!Array.isArray(input.rememberedFacts)) {
      throw new InvalidModelInterpretationRequestError('Conversation context composer rememberedFacts must be an array.');
    }
    if (!Array.isArray(input.recentExchanges)) {
      throw new InvalidModelInterpretationRequestError('Conversation context composer recentExchanges must be an array.');
    }
  }
}
