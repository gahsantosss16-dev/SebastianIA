import test from 'node:test';
import assert from 'node:assert/strict';
import { OllamaCognitiveModelProvider } from '../../core/cognition/OllamaCognitiveModelProvider.js';
import { InvalidCognitiveModelProviderInputError } from '../../core/cognition/CognitiveModelProviderErrors.js';
import type { CognitiveDecisionRequest } from '../../core/cognition/CognitiveModelProviderContract.js';

function baseRequest(): CognitiveDecisionRequest {
  return {
    objective: 'corrigir o teste',
    authorization: 'writeAuthorized',
    relevantMemory: [],
    recentObservations: [],
    filesRead: [],
    availableTools: [],
    stepsTaken: 2,
    stepsRemaining: 12,
    requestedAt: '2026-08-12T00:00:00.000Z',
  };
}

function validDecisionPayload(): Record<string, unknown> {
  return {
    intent: 'proposeFix',
    goal: 'corrigir',
    reasoningSummary: 'lendo o arquivo',
    nextAction: 'invokeTool',
    toolId: 'fs.readFile',
    toolArguments: { path: 'a.js' },
    requiresAuthorization: false,
    expectedEvidence: 'conteúdo do arquivo',
    completionState: 'inProgress',
    confidence: 0.7,
  };
}

function fakeFetch(handler: (input: string, init: Readonly<Record<string, unknown>>) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>) {
  return handler;
}

test('constructor rejects a missing/blank model', () => {
  assert.throws(() => new OllamaCognitiveModelProvider({ model: '' }), InvalidCognitiveModelProviderInputError);
  assert.throws(() => new OllamaCognitiveModelProvider({ model: undefined as never }), InvalidCognitiveModelProviderInputError);
});

test('constructor rejects a blank endpoint or a non-positive timeoutMs when provided', () => {
  assert.throws(() => new OllamaCognitiveModelProvider({ model: 'x', endpoint: '   ' }), InvalidCognitiveModelProviderInputError);
  assert.throws(() => new OllamaCognitiveModelProvider({ model: 'x', timeoutMs: 0 }), InvalidCognitiveModelProviderInputError);
  assert.throws(() => new OllamaCognitiveModelProvider({ model: 'x', timeoutMs: -5 }), InvalidCognitiveModelProviderInputError);
});

test('a valid Ollama response round-trips into a decided CognitiveDecisionResult', async () => {
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> = {};
  const provider = new OllamaCognitiveModelProvider({
    model: 'llama3.1:8b',
    fetchImpl: fakeFetch(async (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: { role: 'assistant', content: JSON.stringify(validDecisionPayload()) } }),
      };
    }),
  });

  const result = await provider.decide(baseRequest());

  assert.equal(result.outcome, 'decided');
  if (result.outcome === 'decided') {
    assert.equal(result.decision.toolId, 'fs.readFile');
  }
  assert.equal(capturedUrl, 'http://127.0.0.1:11434/api/chat');
  assert.equal(capturedBody.model, 'llama3.1:8b');
  assert.equal(capturedBody.format, 'json');
  assert.equal(capturedBody.stream, false);
  const messages = capturedBody.messages as Array<{ readonly role: string; readonly content: string }>;
  const systemPrompt = messages.find((message) => message.role === 'system')?.content ?? '';
  assert.match(systemPrompt, /grau de informalidade e abreviações do usuário/);
  assert.match(systemPrompt, /sem aberturas genéricas de atendimento/);
  assert.match(systemPrompt, /sem caricaturar, perder precisão/);
});

test('respects a custom endpoint', async () => {
  let capturedUrl = '';
  const provider = new OllamaCognitiveModelProvider({
    model: 'llama3.1:8b',
    endpoint: 'http://localhost:9999',
    fetchImpl: fakeFetch(async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify(validDecisionPayload()) } }) };
    }),
  });

  await provider.decide(baseRequest());
  assert.equal(capturedUrl, 'http://localhost:9999/api/chat');
});

test('a non-OK HTTP status resolves to unavailable, never a throw', async () => {
  const provider = new OllamaCognitiveModelProvider({
    model: 'llama3.1:8b',
    fetchImpl: fakeFetch(async () => ({ ok: false, status: 500, json: async () => ({}) })),
  });

  const result = await provider.decide(baseRequest());
  assert.equal(result.outcome, 'unavailable');
});

test('a rejected fetch (connection refused / runtime not running) resolves to unavailable', async () => {
  const provider = new OllamaCognitiveModelProvider({
    model: 'llama3.1:8b',
    fetchImpl: fakeFetch(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    }),
  });

  const result = await provider.decide(baseRequest());
  assert.equal(result.outcome, 'unavailable');
  if (result.outcome === 'unavailable') {
    assert.ok(result.reason.includes('ECONNREFUSED') || result.reason.length > 0);
  }
});

test('a response body missing message.content resolves to invalidResponse', async () => {
  const provider = new OllamaCognitiveModelProvider({
    model: 'llama3.1:8b',
    fetchImpl: fakeFetch(async () => ({ ok: true, status: 200, json: async () => ({}) })),
  });

  const result = await provider.decide(baseRequest());
  assert.equal(result.outcome, 'invalidResponse');
});

test('a non-JSON message content resolves to invalidResponse, never a thrown parse error', async () => {
  const provider = new OllamaCognitiveModelProvider({
    model: 'llama3.1:8b',
    fetchImpl: fakeFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: 'sure, here is my plan: read the file' } }),
    })),
  });

  const result = await provider.decide(baseRequest());
  assert.equal(result.outcome, 'invalidResponse');
});

test('valid JSON that does not satisfy the decision schema resolves to invalidResponse', async () => {
  const provider = new OllamaCognitiveModelProvider({
    model: 'llama3.1:8b',
    fetchImpl: fakeFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: JSON.stringify({ hello: 'world' }) } }),
    })),
  });

  const result = await provider.decide(baseRequest());
  assert.equal(result.outcome, 'invalidResponse');
});

test('a call exceeding timeoutMs resolves to timeout, and the underlying request is aborted', async () => {
  let sawAbort = false;
  const provider = new OllamaCognitiveModelProvider({
    model: 'llama3.1:8b',
    timeoutMs: 30,
    fetchImpl: fakeFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => {
            sawAbort = true;
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    ),
  });

  const result = await provider.decide(baseRequest());
  assert.equal(result.outcome, 'timeout');
  assert.equal(sawAbort, true);
});
