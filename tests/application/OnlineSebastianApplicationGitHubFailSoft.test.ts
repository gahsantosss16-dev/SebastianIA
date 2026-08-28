import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import {
  SEBASTIAN_GITHUB_DEFAULT_BRANCH_ENV_VAR,
  SEBASTIAN_GITHUB_OWNER_ENV_VAR,
  SEBASTIAN_GITHUB_PROJECT_ID_ENV_VAR,
  SEBASTIAN_GITHUB_PROJECT_NAME_ENV_VAR,
  SEBASTIAN_GITHUB_REPOSITORY_ENV_VAR,
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

function completeProjectEnv(): Record<string, string> {
  return {
    [SEBASTIAN_GITHUB_TOKEN_ENV_VAR]: 'a-token',
    [SEBASTIAN_GITHUB_PROJECT_ID_ENV_VAR]: 'neuro-hub-pro',
    [SEBASTIAN_GITHUB_PROJECT_NAME_ENV_VAR]: 'Neuro Hub Pro',
    [SEBASTIAN_GITHUB_OWNER_ENV_VAR]: 'sebastian-org',
    [SEBASTIAN_GITHUB_REPOSITORY_ENV_VAR]: 'neuro-hub',
    [SEBASTIAN_GITHUB_DEFAULT_BRANCH_ENV_VAR]: 'main',
  };
}

async function startAndCollectToolIds(env: Record<string, string>, logger?: Logger): Promise<readonly string[]> {
  let toolIds: readonly string[] = [];
  const provider: CognitiveModelProvider = {
    decide: async (request) => {
      toolIds = request.availableTools.map((tool) => tool.toolId);
      return { outcome: 'decided', decision: decision({ finalAnswer: 'Resposta sem ferramenta.' }) };
    },
  };

  const app = createOnlineSebastianApplication(logger, provider, undefined, env);
  const result = await app.executeCommand(input('Explique algo geral.', 1));
  assert.equal(result.status, 'succeeded');
  return toolIds;
}

test('a complete GitHub configuration starts the server with GitHub tools available', async () => {
  const toolIds = await startAndCollectToolIds(completeProjectEnv());

  assert.equal(toolIds.some((id) => id.startsWith('github.')), true);
});

test('an incomplete GitHub configuration never aborts startup: the server starts without GitHub, everything else intact', async () => {
  const incompleteEnv = completeProjectEnv();
  delete incompleteEnv[SEBASTIAN_GITHUB_OWNER_ENV_VAR];

  const toolIds = await startAndCollectToolIds(incompleteEnv);

  assert.equal(toolIds.some((id) => id.startsWith('github.')), false);
});

test('with SEBASTIAN_GITHUB_* entirely absent, the server starts normally without GitHub', async () => {
  const toolIds = await startAndCollectToolIds({});

  assert.equal(toolIds.some((id) => id.startsWith('github.')), false);
});

test('no secret or configured value appears in logs when GitHub configuration is incomplete or complete', async () => {
  const { logger, calls } = capturingLogger();
  const env = completeProjectEnv();
  delete env[SEBASTIAN_GITHUB_REPOSITORY_ENV_VAR];

  await startAndCollectToolIds(env, logger);

  const serializedCalls = JSON.stringify(calls);
  assert.equal(serializedCalls.includes('sebastian-org'), false);
  assert.equal(serializedCalls.includes('a-token'), false);
  assert.equal(serializedCalls.includes('neuro-hub-pro'), false);
});
