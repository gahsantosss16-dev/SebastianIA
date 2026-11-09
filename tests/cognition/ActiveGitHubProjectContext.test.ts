import test from 'node:test';
import assert from 'node:assert/strict';
import { CognitiveOperationalOrchestrator } from '../../core/cognition/CognitiveOperationalOrchestrator.js';

test('a selected project overrides a stale model projectId on a GitHub follow-up', async () => {
  let payload: Record<string, unknown> | undefined;
  const orchestrator = new CognitiveOperationalOrchestrator(
    { invoke: async (input) => { payload = input.payload; return { status: 'completed' as const, output: { outcome: 'ok', message: 'evidência LUMARKIS' } }; } },
    { decide: async () => ({
      outcome: 'decided' as const,
      decision: {
        intent: 'investigate' as const, goal: 'ler estilo', reasoningSummary: 'x', nextAction: 'invokeTool' as const,
        requiresAuthorization: false, expectedEvidence: 'arquivo', completionState: 'inProgress' as const,
        confidence: 1, toolId: 'github.listTree', toolArguments: { projectId: 'sebastiania', path: '' },
      },
    }) },
    [{ toolId: 'github.listTree', description: 'Lista arquivos.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'path'] }],
  );
  await orchestrator.execute('qual o caminho e estilo atual?', { executionId: 'e', responsibilityId: 'r', requestedAt: '2026-11-09T00:00:00.000Z', activeProjectId: 'lumarkis-financeiro' });
  assert.deepEqual(payload, { projectId: 'lumarkis-financeiro', path: '' });
});
