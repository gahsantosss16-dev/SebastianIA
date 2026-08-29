import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import type { CognitiveDecision, CognitiveDecisionRequest, CognitiveModelProvider } from '../../core/cognition/index.js';
import type { Logger } from '../../core/logger.js';
import {
  FILESYSTEM_READ_FILE_TOOL_ID,
  GIT_DIFF_TOOL_ID,
  GIT_STATUS_TOOL_ID,
  OnlineReadOnlyTool,
  PROJECT_SEARCH_TEXT_TOOL_ID,
  type SpecializedToolInvocationInput,
} from '../../core/tool/index.js';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const operationalCatalog = [{
  toolId: GIT_STATUS_TOOL_ID,
  description: 'Consulta branch e alterações pendentes sem modificar o repositório.',
  requiresAuthorization: false,
  requiredStringArguments: [],
}, {
  toolId: GIT_DIFF_TOOL_ID,
  description: 'Consulta o diff sem modificar o repositório.',
  requiresAuthorization: false,
  requiredStringArguments: [],
}] as const;

function input(text: string, second: number) {
  return { type: 'converse', input: { text }, generatedAt: `2026-08-28T12:00:${String(second).padStart(2, '0')}.000Z` };
}

function decision(overrides: Partial<CognitiveDecision> = {}): CognitiveDecision {
  const value: CognitiveDecision = {
    intent: 'conclude' as const,
    goal: 'atender ao objetivo',
    reasoningSummary: 'Decisão operacional curta.',
    nextAction: 'concludeCompleted' as const,
    requiresAuthorization: false,
    expectedEvidence: 'Resposta ou evidência suficiente.',
    completionState: 'completed' as const,
    confidence: 0.95,
    finalAnswer: 'Resposta direta.',
    ...overrides,
  };
  if (value.nextAction !== 'concludeCompleted') {
    delete (value as { finalAnswer?: string }).finalAnswer;
  }
  return value;
}

test('operational cognition handles direct answers, contextual read-only investigation, policy rejection and fallback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-operational-'));
  try {
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'sebastian@test.local'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Sebastian Test'], { cwd: root });
    writeFileSync(join(root, 'tracked.txt'), 'original\n', 'utf8');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: root, stdio: 'ignore' });
    writeFileSync(join(root, 'tracked.txt'), 'alterado\n', 'utf8');

    const requests: CognitiveDecisionRequest[] = [];
    const invoked: string[] = [];
    let unavailable = false;
    const provider: CognitiveModelProvider = {
      decide: async (request) => {
        requests.push(request);
        if (unavailable) return { outcome: 'unavailable', reason: 'offline' };
        if (request.objective.includes('TCP')) {
          return { outcome: 'decided', decision: decision({ finalAnswer: 'TCP prioriza entrega confiável; UDP prioriza baixa latência.' }) };
        }
        if (request.objective.includes('Corrija')) {
          return { outcome: 'decided', decision: decision({
            intent: 'proposeFix',
            finalAnswer: 'A correção exige escrita e contexto suficiente sobre a alteração. Preciso de autorização antes de executar.',
          }) };
        }
        if (request.objective.includes('inexistente')) {
          return { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: 'tool.inventada', toolArguments: {},
          }) };
        }
        if ((request.objective.includes('diferenças atuais') || request.objective.includes('foi alterado')) && request.recentObservations.length === 0) {
          return { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: GIT_DIFF_TOOL_ID, toolArguments: {},
          }) };
        }
        if (request.recentObservations.length === 0) {
          return { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: GIT_STATUS_TOOL_ID, toolArguments: {},
          }) };
        }
        return { outcome: 'decided', decision: decision({
          finalAnswer: `Diagnóstico: ${request.recentObservations[0]?.summary}`,
        }) };
      },
      respond: async () => ({ outcome: 'unavailable', reason: 'fallback controlado' }),
    };
    const realTool = new OnlineReadOnlyTool(root);
    const tool = {
      invoke(invocation: SpecializedToolInvocationInput) {
        invoked.push(invocation.toolId);
        return realTool.invoke(invocation);
      },
    };
    const app = createSebastianApplication({
      logger,
      dataDir: root,
      specializedTool: tool,
      authorizedCommands: [],
      cognitiveModelProvider: provider,
      cognitiveOperationalTools: operationalCatalog,
    });

    const general = await app.executeCommand(input('Explique a diferença entre TCP e UDP.', 1));
    assert.equal(general.output.message, 'TCP prioriza entrega confiável; UDP prioriza baixa latência.');
    assert.deepEqual(invoked, [], 'direct answer must not invoke a Tool');

    const diff = await app.executeCommand(input('Veja o que foi alterado.', 7));
    assert.match(String(diff.output.message), /alterado/);
    assert.equal(invoked.some((toolId) => toolId === GIT_DIFF_TOOL_ID), true);

    const investigation = await app.executeCommand(input('Verifique o estado do repositório.', 2));
    assert.match(String(investigation.output.message), /tracked\.txt/);
    assert.equal(invoked.at(-1), GIT_STATUS_TOOL_ID);
    assert.equal(requests.at(-1)?.recentObservations[0]?.toolId, GIT_STATUS_TOOL_ID);

    const continuation = await app.executeCommand(input('E tem alguma alteração não commitada?', 3));
    assert.match(String(continuation.output.message), /tracked\.txt/);
    assert.equal(requests.find((request) => request.objective.startsWith('E tem'))?.relevantMemory.some((item) => item.content.includes('tracked.txt')), true);

    const before = join(root, 'tracked.txt');
    const correction = await app.executeCommand(input('Corrija isso.', 4));
    assert.match(String(correction.output.message), /Preciso de autorização/);
    assert.equal(invoked.some((toolId: string) => toolId === 'fs.replaceText'), false);
    assert.equal(await import('node:fs').then(({ readFileSync }) => readFileSync(before, 'utf8')), 'alterado\n');

    await app.executeCommand(input('Use uma ferramenta inexistente.', 5));
    assert.equal(invoked.some((toolId: string) => toolId === 'tool.inventada'), false);

    unavailable = true;
    const fallback = await app.executeCommand(input('Uma solicitação desconhecida.', 6));
    assert.equal(fallback.output.message, 'Ainda não sei responder a isso.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('authorized operation is persisted, requires an unambiguous reply, executes the frozen scope once and validates before success', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'sebastian-pending-operation-'));
  const actionToolId = 'config.replaceSafeValue';
  const validationToolId = 'config.validateSafeValue';
  const catalog = [
    {
      toolId: actionToolId, description: 'substituir o valor de configuração com rollback simples',
      requiresAuthorization: true, requiredStringArguments: ['path', 'value'], validationToolId,
      risk: 'baixo e reversível',
    },
    {
      toolId: validationToolId, description: 'validar o valor configurado',
      requiresAuthorization: false, requiredStringArguments: [],
    },
  ] as const;
  const invocations: SpecializedToolInvocationInput[] = [];
  let currentValue = 'old';
  let validationSucceeds = true;
  const tool = {
    invoke(invocation: SpecializedToolInvocationInput) {
      invocations.push(invocation);
      if (invocation.toolId === actionToolId) {
        currentValue = String(invocation.payload.value);
        return { status: 'completed' as const, output: { outcome: 'ok' } };
      }
      if (invocation.toolId === validationToolId) {
        return { status: 'completed' as const, output: { outcome: 'ok', succeeded: validationSucceeds && currentValue === 'new' } };
      }
      return { status: 'failed' as const, error: new Error('tool fora do catálogo') };
    },
  };
  let decideCalls = 0;
  const proposingProvider: CognitiveModelProvider = {
    decide: async () => {
      decideCalls += 1;
      return { outcome: 'decided', decision: decision({
        intent: 'proposeFix', nextAction: 'invokeTool', completionState: 'inProgress',
        toolId: actionToolId, toolArguments: { path: 'settings.json', value: 'new' }, requiresAuthorization: true,
      }) };
    },
  };
  const unavailableProvider: CognitiveModelProvider = {
    decide: async () => { throw new Error('provider não deve ser consultado após a proposta'); },
  };
  const app = (provider: CognitiveModelProvider) => createSebastianApplication({
    logger, dataDir, specializedTool: tool, authorizedCommands: [], cognitiveModelProvider: provider,
    cognitiveOperationalTools: catalog,
  });

  try {
    const proposal = await app(proposingProvider).executeCommand(input('Investigue e proponha a correção da configuração.', 10));
    assert.match(String(proposal.output.message), /Posso executar e validar/);
    assert.equal(currentValue, 'old');
    assert.equal(invocations.length, 0, 'a proposal can never execute its write tool');
    assert.equal(decideCalls, 1);

    const ambiguous = await app(unavailableProvider).executeCommand(input('Talvez.', 11));
    assert.match(String(ambiguous.output.message), /Não executei nada/);
    assert.equal(invocations.length, 0);

    const authorized = await app(unavailableProvider).executeCommand(input('OK, faça.', 12));
    assert.match(String(authorized.output.message), /Corrigido/);
    assert.deepEqual(invocations.map((item) => item.toolId), [actionToolId, validationToolId]);
    assert.deepEqual(invocations[0]?.payload, { path: 'settings.json', value: 'new' });
    assert.equal(currentValue, 'new');

    await app(unavailableProvider).executeCommand(input('sim', 13));
    assert.equal(invocations.length, 2, 'a completed authorization cannot be replayed');
    assert.equal(readFileSync(join(dataDir, 'memory.json'), 'utf8').includes('cognitive-secret'), false);

    const denialDir = mkdtempSync(join(tmpdir(), 'sebastian-denied-operation-'));
    try {
      const deniedApp = (provider: CognitiveModelProvider) => createSebastianApplication({
        logger, dataDir: denialDir, specializedTool: tool, authorizedCommands: [], cognitiveModelProvider: provider,
        cognitiveOperationalTools: catalog,
      });
      currentValue = 'old'; invocations.length = 0;
      await deniedApp(proposingProvider).executeCommand(input('Proponha a alteração.', 20));
      const denied = await deniedApp(unavailableProvider).executeCommand(input('Não, cancela.', 21));
      assert.match(String(denied.output.message), /cancelada/);
      assert.equal(invocations.length, 0);
      await deniedApp(unavailableProvider).executeCommand(input('sim', 22));
      assert.equal(invocations.length, 0, 'a cancelled proposal cannot be authorized later');
    } finally {
      rmSync(denialDir, { recursive: true, force: true });
    }

    const failedDir = mkdtempSync(join(tmpdir(), 'sebastian-failed-validation-'));
    try {
      const failedApp = (provider: CognitiveModelProvider) => createSebastianApplication({
        logger, dataDir: failedDir, specializedTool: tool, authorizedCommands: [], cognitiveModelProvider: provider,
        cognitiveOperationalTools: catalog,
      });
      currentValue = 'old'; invocations.length = 0; validationSucceeds = false;
      await failedApp(proposingProvider).executeCommand(input('Proponha outra alteração.', 30));
      const failed = await failedApp(unavailableProvider).executeCommand(input('pode executar', 31));
      assert.doesNotMatch(String(failed.output.message), /^Corrigido/);
      assert.match(String(failed.output.message), /validação falhou/);
    } finally {
      validationSucceeds = true;
      rmSync(failedDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('read-only planner autonomously chains search, file read and diagnosis while unsafe choices fail closed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-readonly-investigation-'));
  try {
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    writeFileSync(join(root, 'worker.ts'), 'export function deliver() { return queueName; }\n', 'utf8');
    writeFileSync(join(root, '.env'), 'QUEUE_NAME=private-value\n', 'utf8');
    const catalog = [
      { toolId: GIT_STATUS_TOOL_ID, description: 'status', requiresAuthorization: false, requiredStringArguments: [] },
      { toolId: GIT_DIFF_TOOL_ID, description: 'diff', requiresAuthorization: false, requiredStringArguments: [] },
      { toolId: PROJECT_SEARCH_TEXT_TOOL_ID, description: 'search', requiresAuthorization: false, requiredStringArguments: ['query'] },
      { toolId: FILESYSTEM_READ_FILE_TOOL_ID, description: 'read', requiresAuthorization: false, requiredStringArguments: ['path'] },
    ] as const;
    const requests: CognitiveDecisionRequest[] = [];
    const invoked: string[] = [];
    const provider: CognitiveModelProvider = {
      decide: async (request) => {
        requests.push(request);
        if (request.objective.includes('casual')) return { outcome: 'decided', decision: decision({ finalAnswer: 'Vamos conversar normalmente.' }) };
        if (request.objective.includes('segredo')) {
          if (request.recentObservations.length === 0) return { outcome: 'decided', decision: decision({ intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress', toolId: FILESYSTEM_READ_FILE_TOOL_ID, toolArguments: { path: '.env' } }) };
          return { outcome: 'decided', decision: decision({ finalAnswer: 'A leitura foi bloqueada pela política de segurança.' }) };
        }
        if (request.recentObservations.length === 0) return { outcome: 'decided', decision: decision({ intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress', toolId: PROJECT_SEARCH_TEXT_TOOL_ID, toolArguments: { query: 'deliver' } }) };
        if (request.recentObservations.length === 1) return { outcome: 'decided', decision: decision({ intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress', toolId: FILESYSTEM_READ_FILE_TOOL_ID, toolArguments: { path: 'worker.ts' } }) };
        return { outcome: 'decided', decision: decision({ finalAnswer: 'Diagnóstico: worker.ts usa queueName sem definição local.' }) };
      },
      synthesize: async (request) => ({
        outcome: 'synthesized',
        answer: request.objective.includes('entrega')
          ? 'Diagnóstico: worker.ts usa queueName sem definição local.'
          : 'Síntese baseada na observação.',
      }),
    };
    const realTool = new OnlineReadOnlyTool(root);
    const tool = { invoke(invocation: SpecializedToolInvocationInput) { invoked.push(invocation.toolId); return realTool.invoke(invocation); } };
    const app = createSebastianApplication({ logger, dataDir: root, specializedTool: tool, authorizedCommands: [], cognitiveModelProvider: provider, cognitiveOperationalTools: catalog });

    const diagnosis = await app.executeCommand(input('Localize e diagnostique por que a entrega está falhando.', 40));
    assert.equal(diagnosis.output.message, 'Diagnóstico: worker.ts usa queueName sem definição local.');
    assert.deepEqual(invoked, [PROJECT_SEARCH_TEXT_TOOL_ID, FILESYSTEM_READ_FILE_TOOL_ID]);
    assert.match(requests[1]?.recentObservations[0]?.summary ?? '', /worker\.ts/);
    assert.match(requests[2]?.recentObservations[1]?.summary ?? '', /queueName/);

    invoked.length = 0;
    const casual = await app.executeCommand(input('Uma pergunta casual sem investigação.', 41));
    assert.equal(casual.output.message, 'Vamos conversar normalmente.');
    assert.deepEqual(invoked, []);

    const secret = await app.executeCommand(input('Tente consultar um segredo.', 42));
    assert.match(String(secret.output.message), /bloqueada/);
    assert.equal(requests.at(-1)?.recentObservations[0]?.outcome, 'rejected');
    assert.equal(JSON.stringify(requests).includes('private-value'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('real online composition exposes only the approved investigation catalog to cognition', async () => {
  let toolIds: readonly string[] = [];
  const provider: CognitiveModelProvider = {
    decide: async (request) => {
      toolIds = request.availableTools.map((tool) => tool.toolId);
      return { outcome: 'decided', decision: decision({ finalAnswer: 'Resposta sem ferramenta.' }) };
    },
  };
  const app = createOnlineSebastianApplication(logger, provider);
  const result = await app.executeCommand(input('Explique um conceito geral sem investigar.', 50));

  assert.equal(result.output.message, 'Resposta sem ferramenta.');
  assert.deepEqual(toolIds, [
    GIT_STATUS_TOOL_ID,
    GIT_DIFF_TOOL_ID,
    PROJECT_SEARCH_TEXT_TOOL_ID,
    FILESYSTEM_READ_FILE_TOOL_ID,
    'validation.typecheck',
    'validation.build',
    'validation.test',
  ]);
  assert.equal(toolIds.some((toolId) => /write|replace|shell|deploy/i.test(toolId)), false);
});
