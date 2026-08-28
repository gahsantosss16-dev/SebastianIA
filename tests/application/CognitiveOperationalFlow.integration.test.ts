import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import type { CognitiveDecision, CognitiveDecisionRequest, CognitiveModelProvider } from '../../core/cognition/index.js';
import type { Logger } from '../../core/logger.js';
import { GIT_STATUS_TOOL_ID, OnlineReadOnlyTool, type SpecializedToolInvocationInput } from '../../core/tool/index.js';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const operationalCatalog = [{
  toolId: GIT_STATUS_TOOL_ID,
  description: 'Consulta branch e alterações pendentes sem modificar o repositório.',
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

    const investigation = await app.executeCommand(input('Verifique o estado do repositório.', 2));
    assert.match(String(investigation.output.message), /tracked\.txt/);
    assert.deepEqual(invoked, [GIT_STATUS_TOOL_ID]);
    assert.equal(requests.at(-1)?.recentObservations[0]?.toolId, GIT_STATUS_TOOL_ID);

    const continuation = await app.executeCommand(input('E tem alguma alteração não commitada?', 3));
    assert.match(String(continuation.output.message), /tracked\.txt/);
    assert.equal(requests.find((request) => request.objective.startsWith('E tem'))?.relevantMemory.some((item) => item.content.includes('repositório')), true);

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
