import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CognitiveOperationalOrchestrator,
  type CognitiveDecision,
  type CognitiveDecisionResult,
  type CognitiveModelProvider,
  type OperationalToolPolicyEntry,
} from '../../core/cognition/index.js';
import type { SpecializedTool, SpecializedToolInvocationInput, SpecializedToolInvocationResult } from '../../core/tool/index.js';

/**
 * Regression for the production failure observed in Hostinger logs: a single
 * `decide` call exceeding the Gemini decide timeout (8 000 ms) ended the whole
 * operational run as `unavailable`, without ever using a Tool. The loop now
 * retries `decide` exactly once after a genuine provider timeout; a second
 * timeout (or caller cancellation) still surfaces as `unavailable`.
 */

const TOOL_ID = 'github.listCommits';
const CATALOG: readonly OperationalToolPolicyEntry[] = [
  { toolId: TOOL_ID, description: 'Lista commits recentes do repositório GitHub.', requiresAuthorization: false, requiredStringArguments: [] },
];
const CONTEXT = { executionId: 'exec-t', responsibilityId: 'resp-t', requestedAt: '2026-11-09T10:00:00.000Z' };
const OBJECTIVE = 'liste os commits recentes do repositório';

function decision(overrides: Partial<CognitiveDecision> = {}): CognitiveDecision {
  const value: CognitiveDecision = {
    intent: 'conclude', goal: 'atender ao objetivo', reasoningSummary: 'Decisão curta.',
    nextAction: 'concludeCompleted', requiresAuthorization: false, expectedEvidence: 'Evidência suficiente.',
    completionState: 'completed', confidence: 0.9, finalAnswer: 'Resposta direta.', ...overrides,
  };
  if (value.nextAction !== 'concludeCompleted') delete (value as { finalAnswer?: string }).finalAnswer;
  return value;
}

function fakeTool(): SpecializedTool & { readonly invoked: string[] } {
  const invoked: string[] = [];
  return {
    invoked,
    invoke(input: SpecializedToolInvocationInput): SpecializedToolInvocationResult {
      invoked.push(input.toolId);
      return { status: 'completed', output: { outcome: 'ok', message: 'commit abc123: correção' } } as unknown as SpecializedToolInvocationResult;
    },
  };
}

function scriptedProvider(script: readonly CognitiveDecisionResult[]): CognitiveModelProvider & { calls: number } {
  const provider = {
    calls: 0,
    decide: async (): Promise<CognitiveDecisionResult> => {
      const next = script[provider.calls] ?? script[script.length - 1]!;
      provider.calls += 1;
      return next;
    },
    synthesize: async () => ({ outcome: 'synthesized' as const, answer: 'Resposta sintetizada com evidência.' }),
  };
  return provider as CognitiveModelProvider & { calls: number };
}

const INVOKE: CognitiveDecisionResult = { outcome: 'decided', decision: decision({ intent: 'investigate', nextAction: 'invokeTool', toolId: TOOL_ID, toolArguments: {}, completionState: 'inProgress' }) };
const CONCLUDE: CognitiveDecisionResult = { outcome: 'decided', decision: decision() };

test('decide timeout: a single timeout is recovered by one retry and the run still uses the Tool and answers', async () => {
  const tool = fakeTool();
  const provider = scriptedProvider([{ outcome: 'timeout' }, INVOKE, CONCLUDE]);
  const result = await new CognitiveOperationalOrchestrator(tool, provider, CATALOG).execute(OBJECTIVE, CONTEXT);
  assert.equal(provider.calls, 3);
  assert.deepEqual(tool.invoked, [TOOL_ID]);
  assert.equal(result.outcome, 'answered');
  assert.equal(result.toolCalls, 1);
});

test('decide timeout: two consecutive timeouts still end as unavailable (failure is not masked, only one retry)', async () => {
  const tool = fakeTool();
  const provider = scriptedProvider([{ outcome: 'timeout' }, { outcome: 'timeout' }, INVOKE]);
  const result = await new CognitiveOperationalOrchestrator(tool, provider, CATALOG).execute(OBJECTIVE, CONTEXT);
  assert.equal(provider.calls, 2);
  assert.deepEqual(tool.invoked, []);
  assert.deepEqual(result, { outcome: 'unavailable', toolCalls: 0 });
});

test('decide timeout: the retry budget is per execution - a later second timeout is not retried again', async () => {
  const tool = fakeTool();
  const provider = scriptedProvider([{ outcome: 'timeout' }, INVOKE, { outcome: 'timeout' }, CONCLUDE]);
  const result = await new CognitiveOperationalOrchestrator(tool, provider, CATALOG).execute(OBJECTIVE, CONTEXT);
  assert.equal(provider.calls, 3);
  assert.deepEqual(tool.invoked, [TOOL_ID]);
  // SPEC-053: the gathered evidence is answered from instead of discarded.
  assert.equal(result.outcome, 'answered');
  assert.equal(result.toolCalls, 1);
  assert.equal(result.outcome === 'answered' ? result.answer : '', 'Resposta sintetizada com evidência.');
});

test('decide timeout: no retry when the caller already cancelled (HTTP deadline) - ends unavailable immediately', async () => {
  const controller = new AbortController();
  controller.abort();
  const provider = scriptedProvider([{ outcome: 'timeout' }, CONCLUDE]);
  const result = await new CognitiveOperationalOrchestrator(fakeTool(), provider, CATALOG).execute(OBJECTIVE, { ...CONTEXT, signal: controller.signal });
  assert.equal(provider.calls, 1);
  assert.deepEqual(result, { outcome: 'unavailable', toolCalls: 0 });
});

test('decide unavailable (non-timeout) is not retried - preserves existing behavior', async () => {
  const provider = scriptedProvider([{ outcome: 'unavailable', reason: 'Gemini indisponível (HTTP 401).' }, CONCLUDE]);
  const result = await new CognitiveOperationalOrchestrator(fakeTool(), provider, CATALOG).execute(OBJECTIVE, CONTEXT);
  assert.equal(provider.calls, 1);
  assert.deepEqual(result, { outcome: 'unavailable', toolCalls: 0 });
});

test('decide success without timeout: no extra decide call is spent', async () => {
  const tool = fakeTool();
  const provider = scriptedProvider([INVOKE, CONCLUDE]);
  const result = await new CognitiveOperationalOrchestrator(tool, provider, CATALOG).execute(OBJECTIVE, CONTEXT);
  assert.equal(provider.calls, 2);
  assert.deepEqual(tool.invoked, [TOOL_ID]);
  assert.equal(result.outcome, 'answered');
});
