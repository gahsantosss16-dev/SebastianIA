import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CognitiveOperationalOrchestrator,
  NO_LOCAL_VALIDATION_TOOL_ID,
  type CognitiveDecision,
  type CognitiveModelProvider,
  type OperationalToolPolicyEntry,
} from '../../core/cognition/index.js';
import type { SpecializedTool, SpecializedToolInvocationInput, SpecializedToolInvocationResult } from '../../core/tool/index.js';
import type { PendingOperationRecord } from '../../core/memory/PendingOperationContract.js';

/**
 * Regression: GitHub writes to an external project (LUMARKIS) used to be
 * "validated" by SebastianIA's own local `validation.test`, so the answer
 * could say "Corrigido ... validação concluída com sucesso" about a remote
 * change nobody tested. An outcome-only policy must report exactly what the
 * Tool confirmed, never invoke a local validation and never claim a test.
 */

const WRITE_TOOL_ID = 'github.upsertFile';
const LOCAL_VALIDATION_ID = 'validation.test';
const CONTEXT = { executionId: 'exec-o', responsibilityId: 'resp-o', requestedAt: '2026-11-10T10:00:00.000Z' };
const LATER = { ...CONTEXT, requestedAt: '2026-11-10T10:01:00.000Z' };
const ARGS = { projectId: 'lumarkis-financeiro', branch: 'sebastian/readme', path: 'README.md', content: 'x', message: 'docs: readme' };

const writePolicy: OperationalToolPolicyEntry = {
  toolId: WRITE_TOOL_ID, description: 'Cria ou edita um arquivo em uma branch sebastian/ e registra um commit.',
  requiresAuthorization: true, resultEvidence: 'toolOutcomeOnly', risk: 'grava arquivo e commit somente em branch de tarefa',
  requiredStringArguments: ['projectId', 'branch', 'path', 'content', 'message'],
};
const localValidation: OperationalToolPolicyEntry = {
  toolId: LOCAL_VALIDATION_ID, description: 'Executa os testes locais do SebastianIA.', requiresAuthorization: false, requiredStringArguments: [],
};

function decision(overrides: Partial<CognitiveDecision> = {}): CognitiveDecision {
  const value: CognitiveDecision = {
    intent: 'proposeFix', goal: 'editar arquivo', reasoningSummary: 'Proposta curta.',
    nextAction: 'invokeTool', requiresAuthorization: true, expectedEvidence: 'Commit registrado.',
    completionState: 'inProgress', confidence: 0.9, toolId: WRITE_TOOL_ID, toolArguments: ARGS, ...overrides,
  };
  if (value.nextAction !== 'concludeCompleted') delete (value as { finalAnswer?: string }).finalAnswer;
  return value;
}

const proposingProvider: CognitiveModelProvider = { decide: async () => ({ outcome: 'decided', decision: decision() }) };

function fakeTool(writeResult: SpecializedToolInvocationResult): SpecializedTool & { readonly invoked: string[] } {
  const invoked: string[] = [];
  return {
    invoked,
    invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
      invoked.push(input.toolId);
      if (input.toolId === LOCAL_VALIDATION_ID) return { status: 'completed', output: { outcome: 'ok', succeeded: true, exitCode: 0 } };
      return writeResult;
    },
  };
}

async function propose(tool: SpecializedTool, catalog: readonly OperationalToolPolicyEntry[]) {
  return new CognitiveOperationalOrchestrator(tool, proposingProvider, catalog).execute('edite o arquivo README', CONTEXT);
}

const okWrite: SpecializedToolInvocationResult = { status: 'completed', output: { outcome: 'ok', message: 'Arquivo "README.md" alterado na branch "sebastian/readme"; commit abc1234 registrado no GitHub.' } };
const failedWrite: SpecializedToolInvocationResult = { status: 'completed', output: { outcome: 'rejected', reasonCode: 'githubRequestFailed', message: 'O GitHub não confirmou a gravação de "README.md" na branch "sebastian/readme" (HTTP 409); nenhum commit desta etapa foi confirmado.' } };

test('outcome-only proposal stores no local validation and never promises to validate the external project', async () => {
  const tool = fakeTool(okWrite);
  const result = await propose(tool, [writePolicy, localValidation]);
  assert.equal(result.outcome, 'proposed');
  if (result.outcome !== 'proposed') return;
  assert.equal(result.operation.validationToolId, NO_LOCAL_VALIDATION_TOOL_ID);
  assert.doesNotMatch(result.answer, /validar/);
  assert.match(result.answer, /não executa testes do projeto alterado/);
  assert.deepEqual(tool.invoked, [], 'a proposal never executes anything');
});

test('authorized outcome-only write reports exactly the confirmed result and never runs or claims local validation', async () => {
  const tool = fakeTool(okWrite);
  const proposed = await propose(tool, [writePolicy, localValidation]);
  assert.equal(proposed.outcome, 'proposed');
  if (proposed.outcome !== 'proposed') return;
  const executed = await new CognitiveOperationalOrchestrator(tool, proposingProvider, [writePolicy, localValidation]).executeAuthorized(proposed.operation, LATER);
  assert.deepEqual(tool.invoked, [WRITE_TOOL_ID], 'SebastianIA local tests must never stand in for the external project');
  assert.equal(executed.operation.status, 'completed');
  assert.match(executed.answer, /commit abc1234 registrado no GitHub/);
  assert.match(executed.answer, /não foi testada/);
  assert.doesNotMatch(executed.answer, /Corrigido|validação foi concluída com sucesso/);
});

test('failed outcome-only write is reported as failed, preserves earlier confirmed steps and still claims no test', async () => {
  const tool = fakeTool(failedWrite);
  const proposed = await propose(tool, [writePolicy, localValidation]);
  if (proposed.outcome !== 'proposed') return assert.fail('expected a proposal');
  const executed = await new CognitiveOperationalOrchestrator(tool, proposingProvider, [writePolicy, localValidation]).executeAuthorized(proposed.operation, LATER);
  assert.deepEqual(tool.invoked, [WRITE_TOOL_ID]);
  assert.equal(executed.operation.status, 'failed');
  assert.match(executed.answer, /^A operação não foi concluída/);
  assert.match(executed.answer, /HTTP 409/);
  assert.match(executed.answer, /etapas anteriores .* foram preservadas e não foram revertidas/);
  assert.doesNotMatch(executed.answer, /Corrigido|validação foi concluída com sucesso/);
});

test('a stale proposal persisted with the local validation is refused for an outcome-only Tool without executing', async () => {
  const tool = fakeTool(okWrite);
  const proposed = await propose(tool, [writePolicy, localValidation]);
  if (proposed.outcome !== 'proposed') return assert.fail('expected a proposal');
  const stale: PendingOperationRecord = { ...proposed.operation, validationToolId: LOCAL_VALIDATION_ID };
  const executed = await new CognitiveOperationalOrchestrator(tool, proposingProvider, [writePolicy, localValidation]).executeAuthorized(stale, LATER);
  assert.equal(executed.operation.status, 'failed');
  assert.deepEqual(tool.invoked, []);
});

test('an outcome-only policy that also names a validation is a misconfiguration and is never proposed', async () => {
  const tool = fakeTool(okWrite);
  const result = await propose(tool, [{ ...writePolicy, validationToolId: LOCAL_VALIDATION_ID }, localValidation]);
  assert.equal(result.outcome, 'blocked');
  assert.deepEqual(tool.invoked, []);
});
