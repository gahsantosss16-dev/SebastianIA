import { InvalidCognitiveModelProviderInputError } from './CognitiveModelProviderErrors.js';
import { parseCognitiveDecision } from './CognitiveDecisionValidator.js';
import type {
  CognitiveConversationRequest,
  CognitiveConversationResult,
  CognitiveDecisionRequest,
  CognitiveDecisionResult,
  CognitiveModelProvider,
} from './CognitiveModelProviderContract.js';
import type { Logger } from '../logger.js';

const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';
export const DEFAULT_GEMINI_COGNITIVE_TIMEOUT_MS = 8_000;
/**
 * `respond` (the free-form conversational answer) has observed production
 * latencies that exceed `DEFAULT_GEMINI_COGNITIVE_TIMEOUT_MS` (used by the
 * tight, budget-bound `decide` loop) while still completing successfully -
 * it gets its own, more generous default so a merely-slow conversational
 * answer is not aborted the same way a stuck operational decision is.
 */
export const DEFAULT_GEMINI_RESPOND_TIMEOUT_MS = 20_000;
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
  /** Timeout for `respond` only; independent of `timeoutMs` (which continues to bound only `decide`). */
  readonly respondTimeoutMs?: number;
  readonly fetchImpl?: FetchLike;
  readonly logger?: Logger;
}

interface GeminiTechnicalDiagnostic {
  readonly durationMs: number;
  readonly httpStatus?: number;
  readonly errorCategory?: string;
}

type GeminiStructuredResult =
  | ({ readonly outcome: 'generated'; readonly content: string } & GeminiTechnicalDiagnostic)
  | ({ readonly outcome: 'unavailable'; readonly reason: string } & GeminiTechnicalDiagnostic)
  | ({ readonly outcome: 'timeout' } & GeminiTechnicalDiagnostic)
  | ({ readonly outcome: 'invalidResponse'; readonly reason: string } & GeminiTechnicalDiagnostic);

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
    finalAnswer: { type: 'string' },
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
  'Você é Sebastian, um assistente generalista. Use seu conhecimento geral e raciocínio para responder, explicar, ' +
  'comparar, resumir, escrever, revisar e planejar de forma útil, direta e segura. ' +
  'Soa como um assistente pessoal natural, não como atendimento corporativo: acompanhe o idioma, o grau de informalidade e abreviações do usuário sem caricaturar, perder precisão ou forçar gírias e emojis. ' +
  'Vá direto ao ponto; não comece automaticamente com fórmulas genéricas como "Com certeza! Estou aqui para ajudar" e não repita contexto que já esteja óbvio. Leve humor e personalidade são bem-vindos quando combinarem com a conversa, mantendo profissionalismo quando o assunto exigir. ' +
  'Mensagens casuais podem receber respostas curtas. Não termine toda resposta com uma pergunta ou oferta de ajuda e evite fórmulas repetitivas como "Como posso te ajudar hoje?". Se o usuário apenas informar uma preferência, reconheça e passe a segui-la sem transformar isso em atendimento formal. Acompanhe o registro do usuário com informalidade natural, nunca caricata. ' +
  'Quando houver contexto recente, use-o somente para compreender a conversa e referências do usuário. ' +
  'Você não possui Tools, filesystem, Git, comandos nem autorização para executar ações. ' +
  'Não invente fatos atuais ou específicos que dependam dessas fontes; explique a limitação quando necessário. ' +
  'Retorne somente um objeto JSON com o campo string "answer".';

const DECISION_SYSTEM_INSTRUCTION =
  'Você é SebastianIA, um assistente pessoal generalista com capacidades operacionais. Converse naturalmente e use conhecimento geral e raciocínio em qualquer assunto legítimo. ' +
  'Acompanhe o idioma, o grau de informalidade e abreviações do usuário sem caricaturar, perder precisão ou forçar gírias e emojis. Responda direto, sem aberturas genéricas de atendimento nem repetição de contexto óbvio; use leve humor e personalidade quando couber e mantenha profissionalismo quando o assunto exigir. ' +
  'Ferramentas, memória e ações são capacidades usadas somente quando necessárias ao objetivo atual; não restrinja sua identidade a programação, tarefas técnicas ou produtividade. ' +
  'A mensagem atual define a intenção. Use relevantMemory apenas quando semanticamente relacionada ou necessária para resolver uma referência ou continuação; nunca substitua o assunto atual por memória anterior. ' +
  'Proponha exatamente uma decisão estruturada por vez. ' +
  'Use somente toolIds presentes em availableTools. Nunca conceda autorização, invente Tool ou alegue ter executado uma ação. ' +
  'Se availableTools incluir ferramentas com prefixo "github.", você TEM acesso real ao repositório configurado através delas - nunca alegue não ter acesso ao GitHub ou à internet nesse caso; invoque a ferramenta adequada ao pedido (por exemplo, github.listCommits para commits recentes, github.readFile para ler um arquivo, github.getProject para identificar o projeto) e responda com base na observação retornada, nunca com uma recusa genérica. ' +
  'Para conversar ou responder diretamente sem ação, use concludeCompleted e forneça uma finalAnswer natural, útil e adequada ao contexto. Para finalizar após observar evidência, faça o mesmo apoiado na evidência. ' +
  'Se uma alteração for necessária mas não estiver autorizada/disponível, explique isso em finalAnswer sem executá-la. ' +
  'Retorne somente o objeto JSON solicitado e uma reasoningSummary curta, nunca raciocínio detalhado.';

/** Native-fetch adapter for the official Gemini generateContent HTTPS API. */
export class GeminiCognitiveModelProvider implements CognitiveModelProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly respondTimeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly logger: Logger | undefined;

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
    const respondTimeoutMs = options.respondTimeoutMs ?? DEFAULT_GEMINI_RESPOND_TIMEOUT_MS;
    if (!Number.isInteger(respondTimeoutMs) || respondTimeoutMs <= 0 || respondTimeoutMs >= 30_000) {
      throw new InvalidCognitiveModelProviderInputError(
        'Gemini cognitive provider respond timeout must be an integer between 1 and 29999 milliseconds.',
      );
    }

    this.apiKey = options.apiKey;
    this.model = options.model.trim();
    this.timeoutMs = timeoutMs;
    this.respondTimeoutMs = respondTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.logger = options.logger;
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
      JSON.stringify({
        text: request.text,
        requestedAt: request.requestedAt,
        ...(request.recentExchanges === undefined ? {} : { recentExchanges: request.recentExchanges }),
      }),
      ANSWER_SCHEMA,
      this.respondTimeoutMs,
      request.signal,
    );
    if (result.outcome !== 'generated') {
      this.logOutcome('respond', result.outcome, result);
      return result.outcome === 'timeout'
        ? { outcome: 'timeout' }
        : { outcome: result.outcome, reason: result.reason };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.content) as unknown;
    } catch {
      this.logOutcome('respond', 'invalidResponse', result, 'invalidStructuredJson');
      return { outcome: 'invalidResponse', reason: 'Resposta conversacional não é JSON válido.' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.logOutcome('respond', 'invalidResponse', result, 'schemaMismatch');
      return { outcome: 'invalidResponse', reason: 'Resposta conversacional não corresponde ao schema.' };
    }
    const answer = (parsed as { readonly answer?: unknown }).answer;
    if (
      typeof answer !== 'string' ||
      answer.trim() === '' ||
      answer.length > MAX_GEMINI_CONVERSATION_ANSWER_CHARS ||
      Object.keys(parsed).some((key) => key !== 'answer')
    ) {
      this.logOutcome('respond', 'invalidResponse', result, 'schemaMismatch');
      return { outcome: 'invalidResponse', reason: 'Resposta conversacional não corresponde ao schema.' };
    }
    this.logOutcome('respond', 'responded', result);
    return { outcome: 'responded', answer: answer.trim() };
  }

  public async decide(request: CognitiveDecisionRequest): Promise<CognitiveDecisionResult> {
    if (!request || typeof request !== 'object' || typeof request.objective !== 'string' || request.objective.trim() === '') {
      return { outcome: 'invalidResponse', reason: 'Requisição de decisão cognitiva inválida.' };
    }

    // Raw file contents remain excluded. The application supplies only a
    // bounded catalog and bounded summaries; neither grants authority.
    const safeRequest = {
      objective: request.objective,
      authorization: request.authorization,
      relevantMemory: request.relevantMemory,
      recentObservations: request.recentObservations,
      availableTools: request.availableTools,
      stepsTaken: request.stepsTaken,
      stepsRemaining: request.stepsRemaining,
      requestedAt: request.requestedAt,
    };
    const result = await this.generateStructured(
      DECISION_SYSTEM_INSTRUCTION,
      JSON.stringify(safeRequest),
      DECISION_SCHEMA,
      this.timeoutMs,
      request.signal,
    );
    if (result.outcome !== 'generated') {
      this.logOutcome('decide', result.outcome, result);
      return result.outcome === 'timeout'
        ? { outcome: 'timeout' }
        : { outcome: result.outcome, reason: result.reason };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(result.content) as unknown;
    } catch {
      this.logOutcome('decide', 'invalidResponse', result, 'invalidStructuredJson');
      return { outcome: 'invalidResponse', reason: 'Resposta cognitiva não é JSON válido.' };
    }
    const decision = parseCognitiveDecision(raw);
    if (!decision) {
      this.logOutcome('decide', 'invalidResponse', result, 'schemaMismatch');
      return { outcome: 'invalidResponse', reason: 'Resposta cognitiva não corresponde ao schema.' };
    }
    this.logOutcome('decide', 'responded', result);
    return { outcome: 'decided', decision };
  }

  private async generateStructured(
    systemInstruction: string,
    userContent: string,
    responseJsonSchema: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    externalSignal?: AbortSignal,
  ): Promise<GeminiStructuredResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = (): void => controller.abort();
    if (externalSignal?.aborted === true) controller.abort();
    else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });

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
        return {
          outcome: 'unavailable',
          reason: `Gemini indisponível (HTTP ${response.status}).`,
          ...this.diagnostic(startedAt, response.status, categorizeHttpStatus(response.status)),
        };
      }

      const rawBody = await response.text();
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_GEMINI_RESPONSE_BYTES) {
        return {
          outcome: 'invalidResponse',
          reason: 'Resposta do Gemini excedeu o limite permitido.',
          ...this.diagnostic(startedAt, response.status, 'responseTooLarge'),
        };
      }

      let body: unknown;
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        return {
          outcome: 'invalidResponse',
          reason: 'Envelope do Gemini não é JSON válido.',
          ...this.diagnostic(startedAt, response.status, 'invalidEnvelopeJson'),
        };
      }
      const content = extractGeminiText(body);
      if (
        typeof content !== 'string' ||
        content.trim() === '' ||
        content.length > MAX_GEMINI_GENERATED_JSON_CHARS
      ) {
        return {
          outcome: 'invalidResponse',
          reason: 'Gemini não retornou conteúdo estruturado válido.',
          ...this.diagnostic(startedAt, response.status, 'missingStructuredContent'),
        };
      }
      return { outcome: 'generated', content: content.trim(), ...this.diagnostic(startedAt, response.status) };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { outcome: 'timeout', ...this.diagnostic(startedAt, undefined, 'timeout') };
      }
      return {
        outcome: 'unavailable',
        reason: 'Não foi possível contatar o Gemini.',
        ...this.diagnostic(startedAt, undefined, 'networkError'),
      };
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  private diagnostic(
    startedAt: number,
    httpStatus?: number,
    errorCategory?: string,
  ): GeminiTechnicalDiagnostic {
    return {
      durationMs: Math.max(0, Date.now() - startedAt),
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(errorCategory === undefined ? {} : { errorCategory }),
    };
  }

  private logOutcome(
    operation: 'respond' | 'decide',
    outcome: 'responded' | 'unavailable' | 'timeout' | 'invalidResponse',
    diagnostic: GeminiTechnicalDiagnostic,
    errorCategory = diagnostic.errorCategory,
  ): void {
    if (!this.logger) {
      return;
    }
    const metadata: Record<string, unknown> = {
      provider: 'gemini',
      model: this.model,
      operation,
      outcome,
      durationMs: diagnostic.durationMs,
      ...(diagnostic.httpStatus === undefined ? {} : { httpStatus: diagnostic.httpStatus }),
      ...(errorCategory === undefined ? {} : { errorCategory }),
    };
    const message = 'Remote cognitive request completed.';
    if (outcome === 'responded') {
      this.logger.info(message, metadata);
      return;
    }
    this.logger.warn(message, metadata);
  }
}

function categorizeHttpStatus(status: number): string {
  if (status === 400) return 'badRequest';
  if (status === 401) return 'authentication';
  if (status === 403) return 'permission';
  if (status === 404) return 'modelNotFound';
  if (status === 429) return 'rateLimit';
  if (status >= 500) return 'serverError';
  if (status >= 400) return 'clientError';
  return 'httpError';
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
