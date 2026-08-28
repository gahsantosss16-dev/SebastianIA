import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GeminiCognitiveModelProvider,
  MAX_GEMINI_CONVERSATION_ANSWER_CHARS,
} from '../../core/cognition/GeminiCognitiveModelProvider.js';
import { InvalidCognitiveModelProviderInputError } from '../../core/cognition/CognitiveModelProviderErrors.js';
import type { CognitiveDecisionRequest } from '../../core/cognition/CognitiveModelProviderContract.js';
import type { Logger } from '../../core/logger.js';

const API_KEY = 'gemini-test-key-never-real';
const MODEL = 'gemini-2.5-flash-lite';

type FakeResponse = { readonly ok: boolean; readonly status: number; text(): Promise<string> };
type FetchHandler = (url: string, init: Readonly<Record<string, unknown>>) => Promise<FakeResponse>;

function geminiEnvelope(generated: unknown): string {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: typeof generated === 'string' ? generated : JSON.stringify(generated) }] } }],
  });
}

function response(status: number, body: string): FakeResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

function provider(fetchImpl: FetchHandler, timeoutMs = 8_000, respondTimeoutMs?: number): GeminiCognitiveModelProvider {
  return new GeminiCognitiveModelProvider({
    apiKey: API_KEY,
    model: MODEL,
    timeoutMs,
    fetchImpl,
    ...(respondTimeoutMs === undefined ? {} : { respondTimeoutMs }),
  });
}

function decisionRequest(): CognitiveDecisionRequest {
  return {
    objective: 'investigue o problema',
    authorization: 'readOnly',
    relevantMemory: [{ content: 'memória que não pode sair' }],
    recentObservations: [{ stepId: '1', toolId: 'git.status', outcome: 'ok', summary: 'segredo interno' }],
    filesRead: [{ path: 'secret.txt', content: 'conteúdo do arquivo' }],
    availableTools: [{ toolId: 'fs.readFile', description: 'ler', requiresAuthorization: false }],
    stepsTaken: 1,
    stepsRemaining: 10,
    requestedAt: '2026-08-27T00:00:00.000Z',
  };
}

test('SPEC-050: Gemini provider validates credentials, model and timeout without exposing values', () => {
  assert.throws(
    () => new GeminiCognitiveModelProvider({ apiKey: '', model: MODEL }),
    InvalidCognitiveModelProviderInputError,
  );
  assert.throws(
    () => new GeminiCognitiveModelProvider({ apiKey: API_KEY, model: '' }),
    InvalidCognitiveModelProviderInputError,
  );
  assert.throws(
    () => new GeminiCognitiveModelProvider({ apiKey: API_KEY, model: MODEL, timeoutMs: 15_000 }),
    InvalidCognitiveModelProviderInputError,
  );
  assert.throws(
    () => new GeminiCognitiveModelProvider({ apiKey: API_KEY, model: MODEL, respondTimeoutMs: 30_000 }),
    InvalidCognitiveModelProviderInputError,
  );
});

test('SPEC-050: valid structured Gemini response becomes conversational text and key stays only in header', async () => {
  let capturedUrl = '';
  let capturedInit: Readonly<Record<string, unknown>> = {};
  const cognitive = provider(async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return response(200, geminiEnvelope({ answer: 'Uma resposta cognitiva útil.' }));
  });

  const result = await cognitive.respond?.({ text: 'Explique recursão.', requestedAt: '2026-08-27T00:00:00.000Z' });

  assert.deepEqual(result, { outcome: 'responded', answer: 'Uma resposta cognitiva útil.' });
  assert.equal(capturedUrl, `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`);
  const headers = capturedInit.headers as Record<string, string>;
  assert.equal(headers['x-goog-api-key'], API_KEY);
  const body = capturedInit.body as string;
  assert.equal(body.includes(API_KEY), false);
  assert.equal(body.includes('Explique recursão.'), true);
  assert.equal(body.includes('responseJsonSchema'), true);
  assert.equal(body.includes('application/json'), true);
});

test('Gemini conversation payload includes bounded recent context without granting tools or authority', async () => {
  let capturedBody = '';
  const cognitive = provider(async (_url, init) => {
    capturedBody = init.body as string;
    return response(200, geminiEnvelope({ answer: 'Um exemplo contextual.' }));
  });

  await cognitive.respond?.({
    text: 'Dê um exemplo disso.',
    requestedAt: '2026-08-27T00:01:00.000Z',
    recentExchanges: [{
      requestText: 'Explique recursão.',
      summary: 'Recursão reduz um problema em instâncias menores.',
    }],
  });

  assert.equal(capturedBody.includes('Explique recursão.'), true);
  assert.equal(capturedBody.includes('instâncias menores'), true);
  assert.equal(capturedBody.includes('availableTools'), false);
  assert.equal(capturedBody.includes('authorization'), false);
});

test('Gemini decision payload exposes only bounded operational context and excludes raw file contents', async () => {
  let capturedBody = '';
  const validDecision = {
    intent: 'conclude',
    goal: 'investigue o problema',
    reasoningSummary: 'Não há evidência remota suficiente.',
    nextAction: 'concludeFailed',
    requiresAuthorization: false,
    expectedEvidence: 'Evidência local adicional.',
    completionState: 'insufficientEvidence',
    confidence: 0.8,
  };
  const cognitive = provider(async (_url, init) => {
    capturedBody = init.body as string;
    return response(200, geminiEnvelope(validDecision));
  });

  const result = await cognitive.decide(decisionRequest());

  assert.equal(result.outcome, 'decided');
  for (const forbidden of ['secret.txt', 'conteúdo do arquivo']) {
    assert.equal(capturedBody.includes(forbidden), false, forbidden);
  }
  for (const expected of ['memória que não pode sair', 'git.status', 'fs.readFile', 'segredo interno']) {
    assert.equal(capturedBody.includes(expected), true, expected);
  }
  assert.equal(capturedBody.includes('investigue o problema'), true);
});

test('cognitive identity is generalist by default and operational capabilities do not restrict casual conversation', async () => {
  let capturedBody = '';
  const cognitive = provider(async (_url, init) => {
    capturedBody = init.body as string;
    return response(200, geminiEnvelope({
      intent: 'conclude', goal: 'conversar', reasoningSummary: 'Resposta casual.',
      nextAction: 'concludeCompleted', requiresAuthorization: false,
      expectedEvidence: 'Nenhuma ferramenta necessária.', completionState: 'completed',
      confidence: 0.9, finalAnswer: 'Futebol mexe mesmo com a gente.',
    }));
  });

  await cognitive.decide({ ...decisionRequest(), objective: 'Converse comigo sobre um assunto cotidiano.' });

  for (const expected of ['assistente pessoal generalista', 'Converse naturalmente', 'mensagem atual define a intenção']) {
    assert.equal(capturedBody.includes(expected), true, expected);
  }
  assert.equal(capturedBody.includes('assistente de desenvolvimento local'), false);
});

test('SPEC-050: HTTP failures and network failures resolve unavailable without raw failure leakage', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const result = await provider(async () => response(status, 'sensitive remote body')).respond?.({
      text: 'pergunta',
      requestedAt: '2026-08-27T00:00:00.000Z',
    });
    assert.equal(result?.outcome, 'unavailable');
    assert.equal(JSON.stringify(result).includes('sensitive remote body'), false);
    assert.equal(JSON.stringify(result).includes(API_KEY), false);
  }

  const network = await provider(async () => {
    throw new Error(`DNS failure with ${API_KEY}`);
  }).respond?.({ text: 'pergunta', requestedAt: '2026-08-27T00:00:00.000Z' });
  assert.deepEqual(network, { outcome: 'unavailable', reason: 'Não foi possível contatar o Gemini.' });
});

test('SPEC-050: timeout aborts native fetch and resolves timeout without retry', async () => {
  let calls = 0;
  let aborted = false;
  const cognitive = provider(
    async (_url, init) =>
      new Promise<FakeResponse>((_resolve, reject) => {
        calls += 1;
        const signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          aborted = true;
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    8_000,
    20,
  );

  const result = await cognitive.respond?.({ text: 'pergunta', requestedAt: '2026-08-27T00:00:00.000Z' });
  assert.deepEqual(result, { outcome: 'timeout' });
  assert.equal(aborted, true);
  assert.equal(calls, 1);
});

test('a respond call slower than the old shared 8s timeout, but within the dedicated respond timeout, still succeeds', async () => {
  const cognitive = provider(async () => {
    await new Promise((resolve) => setTimeout(resolve, 8_200));
    return response(200, geminiEnvelope({ answer: 'Resposta que chegou logo após 8 segundos.' }));
  });

  const result = await cognitive.respond?.({ text: 'pergunta', requestedAt: '2026-08-27T00:00:00.000Z' });

  assert.deepEqual(result, { outcome: 'responded', answer: 'Resposta que chegou logo após 8 segundos.' });
});

test('SPEC-050: malformed envelopes, JSON, schemas and oversized answers are invalidResponse', async () => {
  const bodies = [
    'not-json',
    JSON.stringify({}),
    geminiEnvelope('not-json'),
    geminiEnvelope({}),
    geminiEnvelope({ answer: '' }),
    geminiEnvelope({ answer: 'ok', toolId: 'fs.readFile' }),
    geminiEnvelope({ answer: 'x'.repeat(MAX_GEMINI_CONVERSATION_ANSWER_CHARS + 1) }),
  ];

  for (const body of bodies) {
    const result = await provider(async () => response(200, body)).respond?.({
      text: 'pergunta',
      requestedAt: '2026-08-27T00:00:00.000Z',
    });
    assert.equal(result?.outcome, 'invalidResponse');
  }
});

test('Gemini diagnostics distinguish safe technical outcomes without logging credentials, prompts or bodies', async () => {
  const entries: Array<{ level: string; message: string; metadata?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: () => undefined,
    info: (message, metadata) => entries.push({ level: 'info', message, ...(metadata === undefined ? {} : { metadata }) }),
    warn: (message, metadata) => entries.push({ level: 'warn', message, ...(metadata === undefined ? {} : { metadata }) }),
    error: () => undefined,
  };
  const expectedCategories = new Map<number, string>([
    [400, 'badRequest'],
    [401, 'authentication'],
    [403, 'permission'],
    [404, 'modelNotFound'],
    [429, 'rateLimit'],
    [500, 'serverError'],
  ]);
  const secretPrompt = 'prompt privado que não pode aparecer';

  for (const [status, errorCategory] of expectedCategories) {
    const cognitive = new GeminiCognitiveModelProvider({
      apiKey: API_KEY,
      model: MODEL,
      logger,
      fetchImpl: async () => response(status, `raw remote body ${API_KEY} ${secretPrompt}`),
    });
    await cognitive.respond?.({ text: secretPrompt, requestedAt: '2026-08-27T00:00:00.000Z' });
    const entry = entries.at(-1);
    assert.equal(entry?.level, 'warn');
    assert.deepEqual(entry?.metadata, {
      provider: 'gemini',
      model: MODEL,
      operation: 'respond',
      outcome: 'unavailable',
      durationMs: entry?.metadata?.durationMs,
      httpStatus: status,
      errorCategory,
    });
  }

  const success = new GeminiCognitiveModelProvider({
    apiKey: API_KEY,
    model: MODEL,
    logger,
    fetchImpl: async () => response(200, geminiEnvelope({ answer: 'Resposta segura.' })),
  });
  await success.respond?.({ text: secretPrompt, requestedAt: '2026-08-27T00:00:00.000Z' });
  assert.equal(entries.at(-1)?.metadata?.outcome, 'responded');
  assert.equal(entries.at(-1)?.metadata?.httpStatus, 200);

  const invalid = new GeminiCognitiveModelProvider({
    apiKey: API_KEY,
    model: MODEL,
    logger,
    fetchImpl: async () => response(200, geminiEnvelope('not-json')),
  });
  await invalid.respond?.({ text: secretPrompt, requestedAt: '2026-08-27T00:00:00.000Z' });
  assert.equal(entries.at(-1)?.metadata?.outcome, 'invalidResponse');
  assert.equal(entries.at(-1)?.metadata?.errorCategory, 'invalidStructuredJson');

  const network = new GeminiCognitiveModelProvider({
    apiKey: API_KEY,
    model: MODEL,
    logger,
    fetchImpl: async () => {
      throw new Error(`private network failure ${API_KEY}`);
    },
  });
  await network.respond?.({ text: secretPrompt, requestedAt: '2026-08-27T00:00:00.000Z' });
  assert.equal(entries.at(-1)?.metadata?.outcome, 'unavailable');
  assert.equal(entries.at(-1)?.metadata?.errorCategory, 'networkError');

  const timeout = new GeminiCognitiveModelProvider({
    apiKey: API_KEY,
    model: MODEL,
    timeoutMs: 5,
    respondTimeoutMs: 5,
    logger,
    fetchImpl: async (_url, init) =>
      new Promise<FakeResponse>((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });
  await timeout.respond?.({ text: secretPrompt, requestedAt: '2026-08-27T00:00:00.000Z' });
  assert.equal(entries.at(-1)?.metadata?.outcome, 'timeout');
  assert.equal(entries.at(-1)?.metadata?.errorCategory, 'timeout');

  const serialized = JSON.stringify(entries);
  assert.equal(serialized.includes(API_KEY), false);
  assert.equal(serialized.includes(secretPrompt), false);
  assert.equal(serialized.includes('raw remote body'), false);
});
