import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import { SebastianHttpServer } from '../../application/SebastianHttpServer.js';
import type { CognitiveConversationRequest, CognitiveDecisionRequest, CognitiveModelProvider } from '../../core/cognition/index.js';
import type { Logger } from '../../core/logger.js';
import { AsyncFileMemoryStore } from '../../core/memory/AsyncMemoryStore.js';
import { ConversationRegistry, FileCommandContextHydrator, FileMemoryStore, resolveMemoryFilePath } from '../../core/memory/index.js';

/**
 * Exact reproduction of the production failure of 2026-11-09 14:36 UTC
 * (build 00c4bf0, memoryDriver supabase): through the real HTTP web route,
 * "Guarde na sua memória que minha cor favorita é azul" was recognized as a
 * `remember` decision, but the fail-soft operational fallback then forced a
 * Gemini `decide` that answered `concludeCompleted` ("Embora eu não tenha uma
 * memória persistente...") with no Tool - overriding the write, so nothing
 * was persisted and another conversation could not recall the fact.
 * The Gemini double here answers exactly like production did.
 */

const API_TOKEN = 'test-only-private-token-that-is-never-logged';
const PRODUCTION_FALSE_ANSWER = 'Entendido! Embora eu não tenha uma memória persistente para guardar esse tipo de dado para o futuro, anotei mentalmente que sua cor favorita é azul.';
const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function productionLikeGemini() {
  const decideRequests: CognitiveDecisionRequest[] = [];
  const respondRequests: CognitiveConversationRequest[] = [];
  const provider: CognitiveModelProvider = {
    decide: async (request) => {
      decideRequests.push(request);
      return {
        outcome: 'decided',
        decision: {
          intent: 'conclude', goal: 'responder', reasoningSummary: 'Resposta direta.', nextAction: 'concludeCompleted',
          requiresAuthorization: false, expectedEvidence: 'n/a', completionState: 'completed', confidence: 0.9,
          finalAnswer: PRODUCTION_FALSE_ANSWER,
        },
      };
    },
    respond: async (request) => {
      respondRequests.push(request);
      const facts = request.relevantFacts ?? [];
      return { outcome: 'responded', answer: facts.length === 0 ? 'Você ainda não me informou qual é a sua cor favorita.' : `Sua cor favorita: ${facts.map((fact) => fact.content).join(' | ')}` };
    },
  };
  return { provider, decideRequests, respondRequests };
}

async function startProductionLikeServer(dataDir: string, store: AsyncFileMemoryStore, provider: CognitiveModelProvider) {
  // Same composition as application/http.ts: one shared memory store for the application and the conversation registry.
  const application = createOnlineSebastianApplication(logger, provider, dataDir, {}, undefined, undefined, store);
  const http = new SebastianHttpServer({
    application,
    apiToken: API_TOKEN,
    conversationRegistry: new ConversationRegistry(store, new FileCommandContextHydrator(store)),
    logger,
  });
  const started = await http.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${started.port}`;
  const login = await fetch(`${baseUrl}/api/web/session`, {
    method: 'POST', headers: { Origin: baseUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: API_TOKEN, remember: true }),
  });
  assert.equal(login.status, 201);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';', 1)[0]!;
  const newConversation = async (): Promise<string> => {
    const response = await fetch(`${baseUrl}/api/web/conversations`, { method: 'POST', headers: { Origin: baseUrl, Cookie: cookie } });
    assert.equal(response.status, 201);
    return ((await response.json()) as { conversation: { id: string } }).conversation.id;
  };
  const say = async (conversationId: string, message: string): Promise<string> => {
    const response = await fetch(`${baseUrl}/api/web/converse`, {
      method: 'POST', headers: { Origin: baseUrl, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, conversationId }),
    });
    assert.equal(response.status, 200);
    return ((await response.json()) as { message: string }).message;
  };
  return { newConversation, say, close: started.close, application };
}

async function persistedFacts(store: AsyncFileMemoryStore): Promise<string[]> {
  const records = await store.listRecords('command-results');
  return records
    .map((record) => record.output as { memoryRecordKind?: unknown; content?: unknown } | undefined)
    .filter((output) => output?.memoryRecordKind === 'sebastian.memory.fact')
    .map((output) => String(output!.content));
}

test('PRODUCTION REGRESSION 2026-11-09: an explicit save through the online web route is persisted before confirming, never overridden by Gemini decide, and recalled in another conversation after restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-permanent-memory-'));
  const memoryPath = resolveMemoryFilePath(dataDir);
  const store = new AsyncFileMemoryStore(new FileMemoryStore(memoryPath));
  const gemini = productionLikeGemini();
  const server = await startProductionLikeServer(dataDir, store, gemini.provider);
  try {
    const conversationA = await server.newConversation();
    const saveAnswer = await server.say(conversationA, 'Guarde na sua memória que minha cor favorita é azul');
    // Confirmation only after Core's write-back: the fact is already in the store.
    assert.equal(saveAnswer, 'Informação registrada: "minha cor favorita é azul".');
    assert.deepEqual(await persistedFacts(store), ['minha cor favorita é azul']);
    assert.equal(gemini.decideRequests.length, 0, 'a memory write must never be routed to Gemini decide');
    assert.equal(gemini.respondRequests.length, 0, 'a memory write must never be routed to Gemini respond');
    assert.doesNotMatch(saveAnswer, /mem[oó]ria persistente/);
  } finally {
    await server.close();
    server.application.shutdown();
  }

  // Restart: brand-new application + store instance over the same persisted data, then a different conversation.
  const reopened = new AsyncFileMemoryStore(new FileMemoryStore(memoryPath));
  const geminiAfterRestart = productionLikeGemini();
  const restarted = await startProductionLikeServer(dataDir, reopened, geminiAfterRestart.provider);
  try {
    const conversationB = await restarted.newConversation();
    const recall = await restarted.say(conversationB, 'qual minha cor favorita?');
    assert.deepEqual(geminiAfterRestart.respondRequests.at(-1)?.relevantFacts?.map((fact) => fact.content), ['minha cor favorita é azul']);
    assert.equal(recall, 'Sua cor favorita: minha cor favorita é azul');
  } finally {
    await restarted.close();
    restarted.application.shutdown();
  }
});

test('PRODUCTION REGRESSION 2026-11-09: "lembra que" and task writes are not overridden by Gemini decide either; generic unknown input still reaches the fail-soft decide', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-permanent-memory-'));
  const store = new AsyncFileMemoryStore(new FileMemoryStore(resolveMemoryFilePath(dataDir)));
  const gemini = productionLikeGemini();
  // No respond(): forces the code path where only the operational decide fallback exists.
  const decideOnly: CognitiveModelProvider = { decide: gemini.provider.decide };
  const server = await startProductionLikeServer(dataDir, store, decideOnly);
  try {
    const conversation = await server.newConversation();
    assert.equal(await server.say(conversation, 'lembra que prefiro reuniões de manhã'), 'Informação registrada: "prefiro reuniões de manhã".');
    assert.deepEqual(await persistedFacts(store), ['prefiro reuniões de manhã']);
    assert.equal(gemini.decideRequests.length, 0);
    // Unchanged fail-soft behavior for genuinely open conversation.
    assert.equal(await server.say(conversation, 'me conte uma curiosidade sobre polvos'), PRODUCTION_FALSE_ANSWER);
    assert.equal(gemini.decideRequests.length, 1);
  } finally {
    await server.close();
    server.application.shutdown();
  }
});
