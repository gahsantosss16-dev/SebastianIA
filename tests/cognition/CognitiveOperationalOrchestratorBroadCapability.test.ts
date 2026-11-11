import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CognitiveOperationalOrchestrator,
  type CognitiveDecision,
  type CognitiveModelProvider,
  type OperationalToolPolicyEntry,
} from '../../core/cognition/index.js';
import type { SpecializedTool, SpecializedToolInvocationInput, SpecializedToolInvocationResult } from '../../core/tool/index.js';

/**
 * Covers the production-discovered gap (docs/knowledge-layer-v1.md, sections
 * 2 and 9): `hasApplicableToolCandidate`'s literal id/description term
 * overlap never recognized a broad capability like `knowledge.search` as
 * applicable to a concrete technical question, so it was never attempted -
 * and a model that concluded with zero observations was accepted at face
 * value even when an applicable capability had never been tried. Both fixes
 * are exercised here against a fake Tool/provider (no real Gemini call),
 * matching the existing style of every other orchestrator test in this repo.
 */

const KNOWLEDGE_TOOL_ID = 'knowledge.search';

function decision(overrides: Partial<CognitiveDecision> = {}): CognitiveDecision {
  const value: CognitiveDecision = {
    intent: 'conclude', goal: 'atender ao objetivo', reasoningSummary: 'Decisão curta.',
    nextAction: 'concludeCompleted', requiresAuthorization: false, expectedEvidence: 'Evidência suficiente.',
    completionState: 'completed', confidence: 0.9, finalAnswer: 'Resposta direta.', ...overrides,
  };
  if (value.nextAction !== 'concludeCompleted') {
    delete (value as { finalAnswer?: string }).finalAnswer;
  }
  return value;
}

function fakeTool(handlers: Readonly<Record<string, () => SpecializedToolInvocationResult>>): SpecializedTool & { readonly invoked: string[] } {
  const invoked: string[] = [];
  return {
    invoked,
    invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
      invoked.push(input.toolId);
      const handler = handlers[input.toolId];
      if (!handler) throw new Error(`unexpected toolId invoked in test: ${input.toolId}`);
      return handler();
    },
  };
}

const KNOWLEDGE_ENTRY_WITH_PROBE = (probe: (objective: string) => boolean): OperationalToolPolicyEntry => ({
  toolId: KNOWLEDGE_TOOL_ID,
  description: 'Busca trechos relevantes em bibliotecas de conhecimento configuradas.',
  requiresAuthorization: false,
  requiredStringArguments: ['query'],
  broadApplicabilityProbe: probe,
});

test('hasApplicableToolCandidate recognizes a broadApplicabilityProbe match even with zero literal term overlap between the objective and the entry description', async () => {
  const catalog: readonly OperationalToolPolicyEntry[] = [KNOWLEDGE_ENTRY_WITH_PROBE((objective) => objective.includes('OWASP'))];
  const orchestrator = new CognitiveOperationalOrchestrator(fakeTool({}), { decide: async () => ({ outcome: 'unavailable', reason: 'n/a' }) }, catalog);

  assert.equal((await orchestrator.hasApplicableToolCandidate('quais os principais riscos segundo o OWASP?')), true);
  assert.equal((await orchestrator.hasApplicableToolCandidate('oi, tudo bem?')), false, 'unrelated small talk must not match the probe');
});

test('a concludeCompleted decision with zero observations is not accepted when exactly one applicable capability was never tried and budget remains', async () => {
  const tool = fakeTool({
    [KNOWLEDGE_TOOL_ID]: () => ({ status: 'completed', output: { outcome: 'ok', message: 'Trecho recuperado da biblioteca de conhecimento.' } }),
  });
  const catalog: readonly OperationalToolPolicyEntry[] = [KNOWLEDGE_ENTRY_WITH_PROBE(() => true)];

  let decideCalls = 0;
  let synthesizeObservations: readonly { readonly toolId: string }[] = [];
  const provider: CognitiveModelProvider = {
    decide: async () => {
      decideCalls += 1;
      // The model gives up immediately, every time, without ever choosing invokeTool.
      return { outcome: 'decided', decision: decision({}) };
    },
    synthesize: async (request) => {
      synthesizeObservations = request.observations;
      return { outcome: 'synthesized', answer: 'Resposta fundamentada na evidência recuperada.' };
    },
  };

  const orchestrator = new CognitiveOperationalOrchestrator(tool, provider, catalog);
  const result = await orchestrator.execute('o que a documentação diz sobre X?', {
    executionId: 'exec-1', responsibilityId: 'resp-1', requestedAt: '2026-09-05T10:00:00.000Z',
  });

  assert.deepEqual(tool.invoked, [KNOWLEDGE_TOOL_ID], 'the never-tried applicable capability must be attempted exactly once as recovery');
  assert.equal(decideCalls, 2, 'one extra decide() turn is spent evaluating the recovered evidence');
  assert.equal(synthesizeObservations.length, 1);
  assert.equal(synthesizeObservations[0]?.toolId, KNOWLEDGE_TOOL_ID);
  assert.equal(result.outcome, 'answered');
  assert.equal(result.outcome === 'answered' ? result.answer : undefined, 'Resposta fundamentada na evidência recuperada.');
});

test('recovery never fires when more than one applicable, argument-safe capability matches - ambiguity is left to decide()', async () => {
  const tool = fakeTool({});
  const catalog: readonly OperationalToolPolicyEntry[] = [
    KNOWLEDGE_ENTRY_WITH_PROBE(() => true),
    { toolId: 'project.searchText', description: 'Busca texto em arquivos do projeto.', requiresAuthorization: false, requiredStringArguments: ['query'], broadApplicabilityProbe: () => true },
  ];
  const provider: CognitiveModelProvider = { decide: async () => ({ outcome: 'decided', decision: decision({}) }) };
  const orchestrator = new CognitiveOperationalOrchestrator(tool, provider, catalog);

  const result = await orchestrator.execute('pergunta ambígua entre duas capabilities', {
    executionId: 'exec-2', responsibilityId: 'resp-2', requestedAt: '2026-09-05T10:00:00.000Z',
  });

  assert.deepEqual(tool.invoked, [], 'no Tool call should be guessed when the applicable capability is ambiguous');
  assert.equal(result.outcome, 'answered');
  assert.equal(result.outcome === 'answered' ? result.answer : undefined, 'Resposta direta.');
});

test('recovery never auto-invokes a capability whose required arguments cannot be filled from the objective alone (e.g. a file path)', async () => {
  const tool = fakeTool({});
  const catalog: readonly OperationalToolPolicyEntry[] = [
    { toolId: 'fs.readFile', description: 'Lê arquivo do projeto; exige path.', requiresAuthorization: false, requiredStringArguments: ['path'], broadApplicabilityProbe: () => true },
  ];
  const provider: CognitiveModelProvider = { decide: async () => ({ outcome: 'decided', decision: decision({}) }) };
  const orchestrator = new CognitiveOperationalOrchestrator(tool, provider, catalog);

  const result = await orchestrator.execute('leia o arquivo de configuração', {
    executionId: 'exec-3', responsibilityId: 'resp-3', requestedAt: '2026-09-05T10:00:00.000Z',
  });

  assert.deepEqual(tool.invoked, [], 'a required path argument must never be guessed from the objective text');
  assert.equal(result.outcome, 'answered');
});

test('recovery never auto-invokes a capability that requires write authorization', async () => {
  const tool = fakeTool({});
  const catalog: readonly OperationalToolPolicyEntry[] = [
    { toolId: 'fs.write', description: 'Grava alteração no projeto.', requiresAuthorization: true, requiredStringArguments: [], validationToolId: 'validation.build', broadApplicabilityProbe: () => true },
  ];
  const provider: CognitiveModelProvider = { decide: async () => ({ outcome: 'decided', decision: decision({}) }) };
  const orchestrator = new CognitiveOperationalOrchestrator(tool, provider, catalog);

  const result = await orchestrator.execute('corrija o problema', {
    executionId: 'exec-4', responsibilityId: 'resp-4', requestedAt: '2026-09-05T10:00:00.000Z',
  });

  assert.deepEqual(tool.invoked, [], 'a write-authorized capability must never be auto-invoked as recovery');
  assert.equal(result.outcome, 'answered');
});

test('SPEC-053: an evidence-less conclusion never auto-runs a command Tool picked by keyword overlap', async () => {
  // Production: "Grava direto na main ... docs/teste-main.md" matched the
  // validation.test terms ("teste") and the recovery path ran the test suite.
  const catalog: readonly OperationalToolPolicyEntry[] = [{
    toolId: 'validation.test', description: 'Executa somente os testes previamente cadastrados, com timeout rígido.',
    requiresAuthorization: false, requiredStringArguments: [], applicabilityTerms: ['testes', 'teste', 'test', 'suíte'],
  }];
  const tool = fakeTool({ 'validation.test': () => ({ status: 'completed', output: { outcome: 'ok', message: 'testes executados' } }) as unknown as SpecializedToolInvocationResult });
  const orchestrator = new CognitiveOperationalOrchestrator(tool, { decide: async () => ({ outcome: 'decided', decision: decision({ finalAnswer: 'Não gravo na main.' }) }) }, catalog);
  const result = await orchestrator.execute('Grava direto na main o arquivo docs/teste-main.md com o texto oi.', { executionId: 'e', responsibilityId: 'r', requestedAt: '2026-11-11T00:00:00.000Z' });
  assert.deepEqual(tool.invoked, []);
  assert.equal(result.outcome, 'answered');
});

test('SPEC-053: the recovery path never inspects the local checkout by keyword (git.status matched "branch")', async () => {
  const catalog: readonly OperationalToolPolicyEntry[] = [{
    toolId: 'git.status', description: 'Consulta branch e alterações pendentes do repositório atual.',
    requiresAuthorization: false, requiredStringArguments: [], applicabilityTerms: ['git', 'status', 'branch', 'repositório'],
  }];
  const tool = fakeTool({ 'git.status': () => ({ status: 'completed', output: { outcome: 'ok', message: 'Branch "HEAD (no branch)"' } }) as unknown as SpecializedToolInvocationResult });
  const orchestrator = new CognitiveOperationalOrchestrator(tool, { decide: async () => ({ outcome: 'decided', decision: decision({ finalAnswer: 'Vou propor a branch.' }) }) }, catalog);
  await orchestrator.execute('No LUMARKIS, cria uma branch de teste isolada.', { executionId: 'e', responsibilityId: 'r', requestedAt: '2026-11-11T00:00:00.000Z' });
  assert.deepEqual(tool.invoked, []);
});

test('SPEC-053: with the model unavailable, a fallback route for another project than the active one is never used', async () => {
  const fileRoute = (projectId: string, alias: RegExp): OperationalToolPolicyEntry => ({
    toolId: 'github.readFile', description: 'Lê um arquivo do projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'path'],
    deterministicIntent: {
      pattern: new RegExp(`(?=.*${alias.source})(?=.*docs/teste\\.md)`, 'iu'),
      buildArguments: () => ({ projectId, path: 'docs/teste.md' }),
      answerFromRejectedObservation: (observation: { readonly summary: string }) => `Não consegui ler: ${observation.summary}`,
    },
  });
  const catalog = [fileRoute('sebastiania', /sebastian/), fileRoute('lumarkis-financeiro', /lumarkis/)];
  const payloads: Array<Readonly<Record<string, unknown>>> = [];
  const tool: SpecializedTool = { invoke(input) { payloads.push(input.payload); return { status: 'completed', output: { outcome: 'rejected', message: 'não encontrado' } } as unknown as SpecializedToolInvocationResult; } };
  const orchestrator = new CognitiveOperationalOrchestrator(tool, { decide: async () => ({ outcome: 'timeout' }) }, catalog);
  const result = await orchestrator.execute('Sebastian, no LUMARKIS, cria docs/teste.md com o texto oi.', {
    executionId: 'e', responsibilityId: 'r', requestedAt: '2026-11-11T00:00:00.000Z', activeProjectId: 'lumarkis-financeiro',
  });
  assert.deepEqual(payloads.map((payload) => payload.projectId), ['lumarkis-financeiro']);
  assert.match(result.outcome === 'answered' ? result.answer : '', /^Não consegui ler: não encontrado/);
});
