import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import {
  CognitiveOperationalOrchestrator,
  type CognitiveConversationRequest,
  type CognitiveDecisionRequest,
  type CognitiveDecisionResult,
  type CognitiveModelProvider,
  type OperationalToolPolicyEntry,
} from '../../core/cognition/index.js';
import type { Logger } from '../../core/logger.js';
import { AsyncFileMemoryStore } from '../../core/memory/AsyncMemoryStore.js';
import { FileMemoryStore, resolveMemoryFilePath } from '../../core/memory/index.js';
import type { SpecializedTool } from '../../core/tool/index.js';

/**
 * Latency regression: ordinary conversation that merely shares a common word
 * with a Tool description ("atual", "texto", "projeto", "programação") used
 * to enter the operational `decide` loop - measured at 6.2-15 s and up to 3
 * Gemini calls plus a pointless Tool call - instead of one `respond` call.
 * Requests that really need a Tool must still reach `decide`.
 */

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function recordingProvider(decideResults: CognitiveDecisionResult[] = []) {
  const decideRequests: CognitiveDecisionRequest[] = [];
  const respondRequests: CognitiveConversationRequest[] = [];
  const provider: CognitiveModelProvider = {
    decide: async (request) => {
      decideRequests.push(request);
      return decideResults.shift() ?? {
        outcome: 'decided',
        decision: { intent: 'conclude', goal: 'g', reasoningSummary: 'r', nextAction: 'concludeCompleted', requiresAuthorization: false, expectedEvidence: 'e', completionState: 'completed', confidence: 0.9, finalAnswer: 'via decide' },
      };
    },
    respond: async (request) => {
      respondRequests.push(request);
      const facts = (request.relevantFacts ?? []).map((fact) => fact.content);
      return { outcome: 'responded', answer: facts.length > 0 ? `via respond: ${facts.join(' | ')}` : 'via respond' };
    },
    synthesize: async () => ({ outcome: 'synthesized', answer: 'via synthesize' }),
  };
  return { provider, decideRequests, respondRequests };
}

function createApp(provider: CognitiveModelProvider) {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-fast-path-'));
  const store = new AsyncFileMemoryStore(new FileMemoryStore(resolveMemoryFilePath(dataDir)));
  return createOnlineSebastianApplication(logger, provider, dataDir, {}, undefined, undefined, store);
}

let second = 0;
const say = (text: string, conversationId = 'conversation-fast') => ({
  type: 'converse',
  input: { text },
  generatedAt: new Date(Date.UTC(2026, 10, 9, 18, 0, 0) + ++second * 1_000).toISOString(),
  conversation: { conversationId },
  session: { conversationId, sessionId: 'session-1' },
});

test('FAST PATH: ordinary conversation containing generic words from Tool descriptions is answered with a single respond call and no decide/Tool', async () => {
  const messages = [
    'Qual é a situação atual da economia no Brasil?',
    'Me explique o que é programação funcional',
    'Me ajude a organizar o texto deste e-mail para meu chefe',
    'Tenho um projeto pessoal de corrida, como começo?',
    'Faça uma lista de livros sobre liderança',
    'Oi Sebastian, tudo bem?',
  ];
  for (const text of messages) {
    const { provider, decideRequests, respondRequests } = recordingProvider();
    const app = createApp(provider);
    const result = await app.executeCommand(say(text));
    assert.equal(decideRequests.length, 0, `decide must not run for: ${text}`);
    assert.equal(respondRequests.length, 1, `exactly one respond call for: ${text}`);
    assert.equal(result.output.message, 'via respond', text);
    app.shutdown();
  }
});

test('FAST PATH: requests that really need a Tool still go through the operational decide loop', async () => {
  for (const text of ['qual o status do repositório? tem alterações pendentes?', 'rode o typecheck', 'mostre o git diff atual', 'busque no código do projeto onde está o timeout']) {
    const { provider, decideRequests } = recordingProvider();
    const app = createApp(provider);
    await app.executeCommand(say(text));
    assert.ok(decideRequests.length >= 1, `decide must run for: ${text}`);
    app.shutdown();
  }
});

test('FAST PATH: permanent memory is still saved without Gemini and recalled in another conversation with one respond call', async () => {
  const { provider, decideRequests, respondRequests } = recordingProvider();
  const app = createApp(provider);
  const saved = await app.executeCommand(say('Guarde na sua memória que minha cor favorita é azul', 'conversation-a'));
  assert.equal(saved.output.content, 'minha cor favorita é azul');
  const recalled = await app.executeCommand(say('qual minha cor favorita?', 'conversation-b'));
  assert.equal(recalled.output.message, 'via respond: minha cor favorita é azul');
  assert.equal(decideRequests.length, 0);
  assert.equal(respondRequests.length, 1);
  app.shutdown();
});

test('FAST PATH: a Tool request whose decide times out once is still retried once (timeout handling preserved)', async () => {
  const { provider, decideRequests } = recordingProvider([{ outcome: 'timeout' }]);
  const app = createApp(provider);
  const result = await app.executeCommand(say('rode o typecheck'));
  assert.ok(decideRequests.length >= 2, 'the timed-out decide is retried once');
  assert.notEqual(result.output.message, undefined);
  app.shutdown();
});

const noTool: SpecializedTool = { invoke: () => { throw new Error('no Tool expected'); } };

test('applicabilityTerms: only the declared vocabulary gates the entry (accent/case-insensitive, multi-word terms need every word); description qualifiers no longer do', async () => {
  const entry: OperationalToolPolicyEntry = {
    toolId: 'git.status',
    description: 'Consulta branch e alterações pendentes do repositório atual.',
    requiresAuthorization: false,
    requiredStringArguments: [],
    applicabilityTerms: ['git', 'repositório', 'alterações pendentes'],
  };
  const orchestrator = new CognitiveOperationalOrchestrator(noTool, recordingProvider().provider, [entry]);
  assert.equal(await orchestrator.hasApplicableToolCandidate('Qual a situação atual do mercado?'), false);
  assert.equal(await orchestrator.hasApplicableToolCandidate('tenho alterações para fazer na dieta'), false);
  assert.equal(await orchestrator.hasApplicableToolCandidate('Quais as ALTERACOES PENDENTES?'), true);
  assert.equal(await orchestrator.hasApplicableToolCandidate('como está o repositorio?'), true);
  assert.equal(await orchestrator.hasApplicableToolCandidate('git status'), true);

  // Entries without the field keep the original id/description overlap.
  const { applicabilityTerms: _omitted, ...legacyEntry } = entry;
  const legacy = new CognitiveOperationalOrchestrator(noTool, recordingProvider().provider, [legacyEntry]);
  assert.equal(await legacy.hasApplicableToolCandidate('Qual a situação atual do mercado?'), true);
});
