import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import {
  SEBASTIAN_GITHUB_PROJECTS_ENV_VAR,
  SEBASTIAN_GITHUB_TOKEN_ENV_VAR,
} from '../../application/GitHubProjectRegistryConfiguration.js';
import type { CognitiveDecision, CognitiveModelProvider } from '../../core/cognition/index.js';
import type { Logger } from '../../core/logger.js';

function input(text: string, second: number) {
  return { type: 'converse', input: { text }, generatedAt: `2026-08-28T14:00:${String(second).padStart(2, '0')}.000Z` };
}

function decision(overrides: Partial<CognitiveDecision> = {}): CognitiveDecision {
  return {
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
}

function capturingLogger(): { readonly logger: Logger; readonly calls: Array<{ readonly level: string; readonly message: string; readonly metadata: unknown }> } {
  const calls: Array<{ readonly level: string; readonly message: string; readonly metadata: unknown }> = [];
  const record = (level: string) => (message: string, metadata?: Record<string, unknown>) => {
    calls.push({ level, message, metadata });
  };
  return {
    calls,
    logger: { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') },
  };
}

test('a valid GitHub configuration starts the server with GitHub tools available', async () => {
  let toolIds: readonly string[] = [];
  const provider: CognitiveModelProvider = {
    decide: async (request) => {
      toolIds = request.availableTools.map((tool) => tool.toolId);
      return { outcome: 'decided', decision: decision({ finalAnswer: 'Resposta sem ferramenta.' }) };
    },
  };
  const env = {
    [SEBASTIAN_GITHUB_TOKEN_ENV_VAR]: 'a-token',
    [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: JSON.stringify([
      { id: 'neuro-hub-pro', displayName: 'Neuro Hub Pro', owner: 'sebastian-org', repository: 'neuro-hub', defaultBranch: 'main' },
    ]),
  };

  const app = createOnlineSebastianApplication(undefined, provider, undefined, env);
  const result = await app.executeCommand(input('Explique algo geral.', 1));

  assert.equal(result.status, 'succeeded');
  assert.equal(toolIds.some((id) => id.startsWith('github.')), true);
});

test('an invalid GitHub configuration never aborts startup: the server starts without GitHub, everything else intact', async () => {
  const { logger, calls } = capturingLogger();
  let toolIds: readonly string[] = [];
  const provider: CognitiveModelProvider = {
    decide: async (request) => {
      toolIds = request.availableTools.map((tool) => tool.toolId);
      return { outcome: 'decided', decision: decision({ finalAnswer: 'Tudo funcionando normalmente.' }) };
    },
  };
  const env = { [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: '{this is not valid json' };

  let app: ReturnType<typeof createOnlineSebastianApplication> | undefined;
  assert.doesNotThrow(() => {
    app = createOnlineSebastianApplication(logger, provider, undefined, env);
  });
  assert.ok(app);

  const result = await app!.executeCommand(input('Explique algo geral.', 2));

  assert.equal(result.status, 'succeeded');
  assert.equal(result.output.message, 'Tudo funcionando normalmente.');
  assert.equal(toolIds.some((id) => id.startsWith('github.')), false);
  assert.equal(
    calls.some((call) => call.level === 'warn' && call.message === 'GitHub integration disabled: invalid project registry configuration'),
    true,
  );
});

test('with SEBASTIAN_GITHUB_PROJECTS entirely absent, the server starts normally without GitHub', async () => {
  let toolIds: readonly string[] = [];
  const provider: CognitiveModelProvider = {
    decide: async (request) => {
      toolIds = request.availableTools.map((tool) => tool.toolId);
      return { outcome: 'decided', decision: decision({ finalAnswer: 'Resposta sem ferramenta.' }) };
    },
  };

  const app = createOnlineSebastianApplication(undefined, provider, undefined, {});
  const result = await app.executeCommand(input('Explique algo geral.', 3));

  assert.equal(result.status, 'succeeded');
  assert.equal(toolIds.some((id) => id.startsWith('github.')), false);
});

test('no secret or raw configuration content appears in logs when GitHub configuration is invalid', async () => {
  const { logger, calls } = capturingLogger();
  const secretLikeValue = 'ghp_should-never-appear-in-any-log-9f31c2';
  const env = { [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: `{not json, secret=${secretLikeValue}` };
  const provider: CognitiveModelProvider = {
    decide: async () => ({ outcome: 'decided', decision: decision({ finalAnswer: 'ok' }) }),
  };

  const app = createOnlineSebastianApplication(logger, provider, undefined, env);
  await app.executeCommand(input('Explique algo geral.', 4));

  const serializedCalls = JSON.stringify(calls);
  assert.equal(serializedCalls.includes(secretLikeValue), false);
  assert.equal(serializedCalls.includes(env[SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]), false);
});
