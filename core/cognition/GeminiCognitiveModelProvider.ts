import { InvalidCognitiveModelProviderInputError } from './CognitiveModelProviderErrors.js';
import { parseCognitiveDecision } from './CognitiveDecisionValidator.js';
import type {
  CognitiveConversationRequest,
  CognitiveConversationResult,
  CognitiveDecisionRequest,
  CognitiveDecisionResult,
  CognitiveModelProvider,
} from './CognitiveModelProviderContract.js';

const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';
export const DEFAULT_GEMINI_COGNITIVE_TIMEOUT_MS = 8_000;
export const MAX_GEMINI_RESPONSE_BYTES = 64 * 1024;
export const MAX_GEMINI_GENERATED_JSON_CHARS = 16 * 1024;
export const MAX_GEMINI_CONVERSATION_ANSWER_CHARS = 8_000;

type FetchLike = (input: string, init: Readonly<Record<string, unknown>>) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}>;

export interface GeminiCognitiveModelProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
}

const ANSWER_SCHEMA = Object.freeze({
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
});

const DECISION_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['investigate', 'proposeFix', 'verify', 'conclude'] },
    goal: { type: 'string' },
    reasoningSummary: { type: 'string' },
    nextAction: {
      type: 'string',
      enum: ['invokeTool', 'requestMoreEvidence', 'concludeCompleted', 'concludeFailed'],
    },
    toolId: { type: 'string' },
    toolArguments: { type: 'object' },
    requiresAuthorization: { type: 'boolean' },
    expectedEvidence: { type: 'string' },
    completionState: {
      type: 'string',
      enum: ['inProgress', 'completed', 'failed', 'insufficientEvidence'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: [
    'intent',
    'goal',
    'reasoningSummary',
    'nextAction',
    'requiresAuthorization',
    'expectedEvidence',
    'completionState',
    'confidence',
  ],
});

const CONVERSATION_SYSTEM_INSTRUCTION =
  'Você é Sebastian. Responda à mensagem do usuário de forma útil, direta e segura. ' +
  'Você não possui Tools, filesystem, Git, comandos, memória ou autorização para executar ações. ' +
  'Retorne somente um objeto JSON com o campo string "answer".';

const DECISION_SYSTEM_INSTRUCTION =
  'Você é o motor cognitivo do Sebastian e apenas propõe uma decisão estruturada. ' +
  'Nenhuma Tool foi disponibilizada nesta integração online; não invente toolId nem alegue ter executado ações. ' +
  'Prefira requestMoreEvidence ou concludeFailed quando não houver evidência suficiente. ' +
  'Retorne somente o objeto JSON solicitado e uma reasoningSummary curta, nunca raciocínio detalhado.';

/** Native-fetch adapter for the official Gemini generateContent HTTPS API. */
export class GeminiCognitiveModelProvider implements CognitiveModelProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  public constructor(options: GeminiCognitiveModelProviderOptions) {
    if (!options || typeof options !== 'object') {
      throw new InvalidCognitiveModelProviderInputError('Gemini cognitive provider options must be an object.');
    }
    if (typeof options.apiKey !== 'string' || options.apiKey.trim() === '') {
      throw new InvalidCognitiveModelProviderInputError('Gemini cognitive provider API key must be configured.');
    }
    if (typeof options.model !== 'string' || options.model.trim() === '') {
      throw new InvalidCognitiveModelProviderInputError('Gemini cognitive provider model must be configured.');
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_GEMINI_COGNITIVE_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs >= 15_000) {
      throw new InvalidCognitiveModelProviderInputError(
        'Gemini cognitive provider timeout must be an integer between 1 and 14999 milliseconds.',
      );
    }

    this.apiKey = options.apiKey;
    this.model = options.model.trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  public async respond(request: CognitiveConversationRequest): Promise<CognitiveConversationResult> {
    if (
      !request ||
      typeof request !== 'object' ||
      typeof request.text !== 'string' ||
      request.text.trim() === '' ||
      typeof request.requestedAt !== 'string' ||
      request.requestedAt.trim() === ''
    ) {
      return { outcome: 'invalidResponse', reason: 'Requisição conversacional cognitiva inválida.' };
    }

    const result = await this.generateStructured(
      CONVERSATION_SYSTEM_INSTRUCTION,
      JSON.stringify({ text: request.text, requestedAt: request.requestedAt }),
      ANSWER_SCHEMA,
    );
    if (result.outcome !== 'generated') {
      return result;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.content) as unknown;
    } catch {
      return { outcome: 'invalidResponse', reason: 'Resposta conversacional não é JSON válido.' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { outcome: 'invalidResponse', reason: 'Resposta conversacional não corresponde ao schema.' };
    }
    const answer = (parsed as { readonly answer?: unknown }).answer;
    if (
      typeof answer !== 'string' ||
      answer.trim() === '' ||
      answer.length > MAX_GEMINI_CONVERSATION_ANSWER_CHARS ||
      Object.keys(parsed).some((key) => key !== 'answer')
    ) {
      return { outcome: 'invalidResponse', reason: 'Resposta conversacional não corresponde ao schema.' };
    }
    return { outcome: 'responded', answer: answer.trim() };
  }

  public async decide(request: CognitiveDecisionRequest): Promise<CognitiveDecisionResult> {
    if (!request || typeof request !== 'object' || typeof request.objective !== 'string' || request.objective.trim() === '') {
      return { outcome: 'invalidResponse', reason: 'Requisição de decisão cognitiva inválida.' };
    }

    // Deliberately excludes Memory, file excerpts, Tool descriptions and raw
    // observations from the remote payload. The online profile exposes none
    // of those capabilities to Gemini.
    const safeRequest = {
      objective: request.objective,
      authorization: request.authorization,
      stepsTaken: request.stepsTaken,
      stepsRemaining: request.stepsRemaining,
      requestedAt: request.requestedAt,
    };
    const result = await this.generateStructured(
      DECISION_SYSTEM_INSTRUCTION,
      JSON.stringify(safeRequest),
      DECISION_SCHEMA,
    );
    if (result.outcome !== 'generated') {
      return result;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(result.content) as unknown;
    } catch {
      return { outcome: 'invalidResponse', reason: 'Resposta cognitiva não é JSON válido.' };
    }
    const decision = parseCognitiveDecision(raw);
    return decision
      ? { outcome: 'decided', decision }
      : { outcome: 'invalidResponse', reason: 'Resposta cognitiva não corresponde ao schema.' };
  }

  private async generateStructured(
    systemInstruction: string,
    userContent: string,
    responseJsonSchema: Readonly<Record<string, unknown>>,
  ): Promise<
    | { readonly outcome: 'generated'; readonly content: string }
    | { readonly outcome: 'unavailable'; readonly reason: string }
    | { readonly outcome: 'timeout' }
    | { readonly outcome: 'invalidResponse'; readonly reason: string }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const endpoint = `${GEMINI_API_ORIGIN}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: userContent }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema,
            maxOutputTokens: 2_048,
            temperature: 0.3,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return { outcome: 'unavailable', reason: `Gemini indisponível (HTTP ${response.status}).` };
      }

      const rawBody = await response.text();
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_GEMINI_RESPONSE_BYTES) {
        return { outcome: 'invalidResponse', reason: 'Resposta do Gemini excedeu o limite permitido.' };
      }

      let body: unknown;
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        return { outcome: 'invalidResponse', reason: 'Envelope do Gemini não é JSON válido.' };
      }
      const content = extractGeminiText(body);
      if (
        typeof content !== 'string' ||
        content.trim() === '' ||
        content.length > MAX_GEMINI_GENERATED_JSON_CHARS
      ) {
        return { outcome: 'invalidResponse', reason: 'Gemini não retornou conteúdo estruturado válido.' };
      }
      return { outcome: 'generated', content: content.trim() };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { outcome: 'timeout' };
      }
      return { outcome: 'unavailable', reason: 'Não foi possível contatar o Gemini.' };
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractGeminiText(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  const candidates = (body as { readonly candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length !== 1) {
    return undefined;
  }
  const candidate = candidates[0] as { readonly content?: { readonly parts?: unknown } } | undefined;
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts) || parts.length !== 1) {
    return undefined;
  }
  const text = (parts[0] as { readonly text?: unknown } | undefined)?.text;
  return typeof text === 'string' ? text : undefined;
}
