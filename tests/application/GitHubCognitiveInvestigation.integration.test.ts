import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import { createOnlineSebastianApplication } from '../../application/OnlineSebastianApplication.js';
import {
  SEBASTIAN_GITHUB_PROJECTS_ENV_VAR,
  SEBASTIAN_GITHUB_TOKEN_ENV_VAR,
} from '../../application/GitHubProjectRegistryConfiguration.js';
import type { CognitiveDecision, CognitiveDecisionRequest, CognitiveModelProvider } from '../../core/cognition/index.js';
import type { Logger } from '../../core/logger.js';
import { ProjectRegistry } from '../../core/project/ProjectRegistry.js';
import {
  GITHUB_COMPARE_BRANCH_TOOL_ID,
  GITHUB_GET_PROJECT_TOOL_ID,
  GITHUB_LIST_COMMITS_TOOL_ID,
  GITHUB_LIST_TREE_TOOL_ID,
  GITHUB_READ_FILE_TOOL_ID,
  GitHubReadOnlyTool,
  OnlineReadOnlyTool,
  type SpecializedToolInvocationInput,
} from '../../core/tool/index.js';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const SECRET_TOKEN = 'ghp_integration-secret-must-not-leak';

const githubCatalog = [
  { toolId: GITHUB_GET_PROJECT_TOOL_ID, description: 'Resolve um projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId'] },
  { toolId: GITHUB_LIST_TREE_TOOL_ID, description: 'Lista arquivos do projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId'] },
  { toolId: GITHUB_READ_FILE_TOOL_ID, description: 'Lê um arquivo do projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'path'] },
  { toolId: GITHUB_LIST_COMMITS_TOOL_ID, description: 'Lista commits recentes do projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId'] },
  { toolId: GITHUB_COMPARE_BRANCH_TOOL_ID, description: 'Compara branches do projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId', 'ref'] },
] as const;

function input(text: string, second: number) {
  return { type: 'converse', input: { text }, generatedAt: `2026-08-28T13:00:${String(second).padStart(2, '0')}.000Z` };
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

function neuroHubRegistry(): ProjectRegistry {
  return new ProjectRegistry({
    entries: [
      {
        id: 'neuro-hub-pro',
        displayName: 'Neuro Hub Pro',
        aliases: ['Neuro Hub'],
        resourceKind: 'github-repository',
        remoteRepository: { owner: 'sebastian-org', repository: 'neuro-hub', defaultBranch: 'main' },
        permissions: { access: 'read-only' },
      },
    ],
  });
}

test('"Sebastian, verifica o Neuro Hub" resolves the project and investigates it across multiple GitHub steps', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-investigation-'));
  try {
    const registry = neuroHubRegistry();
    const githubTool = new GitHubReadOnlyTool({
      token: SECRET_TOKEN,
      registry,
      fetchImpl: async (url) => {
        if (url.includes('/commits')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([
              { sha: 'abc123def456', commit: { message: 'fix: corrige timeout de fila', author: { name: 'Dev', date: '2026-08-20T00:00:00Z' } } },
            ]),
          };
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    });
    const onlineTool = new OnlineReadOnlyTool(root, [], githubTool);
    const invoked: string[] = [];
    const requests: CognitiveDecisionRequest[] = [];
    const tool = {
      async invoke(invocation: SpecializedToolInvocationInput) {
        invoked.push(invocation.toolId);
        return onlineTool.invoke(invocation);
      },
    };

    const provider: CognitiveModelProvider = {
      decide: async (request) => {
        requests.push(request);
        if (request.recentObservations.length === 0) {
          return { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: GITHUB_GET_PROJECT_TOOL_ID, toolArguments: { projectId: 'Neuro Hub' },
          }) };
        }
        if (request.recentObservations.length === 1) {
          return { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: GITHUB_LIST_COMMITS_TOOL_ID, toolArguments: { projectId: 'neuro-hub-pro' },
          }) };
        }
        return { outcome: 'decided', decision: decision({
          finalAnswer: `Diagnóstico do Neuro Hub: ${request.recentObservations[1]?.summary}`,
        }) };
      },
    };

    const app = createSebastianApplication({
      logger, dataDir: root, specializedTool: tool, authorizedCommands: [],
      cognitiveModelProvider: provider, cognitiveOperationalTools: githubCatalog,
    });

    const result = await app.executeCommand(input('Sebastian, verifica o Neuro Hub.', 1));

    assert.deepEqual(invoked, [GITHUB_GET_PROJECT_TOOL_ID, GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.match(String(result.output.message), /corrige timeout de fila/);
    assert.equal(JSON.stringify(requests).includes(SECRET_TOKEN), false);
    assert.equal(String(result.output.message).includes(SECRET_TOKEN), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a casual conversation that does not require a project never consults GitHub', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-casual-'));
  try {
    const registry = neuroHubRegistry();
    const githubTool = new GitHubReadOnlyTool({ token: SECRET_TOKEN, registry, fetchImpl: async () => { throw new Error('must not be called'); } });
    const onlineTool = new OnlineReadOnlyTool(root, [], githubTool);
    const invoked: string[] = [];
    const tool = {
      async invoke(invocation: SpecializedToolInvocationInput) {
        invoked.push(invocation.toolId);
        return onlineTool.invoke(invocation);
      },
    };
    const provider: CognitiveModelProvider = {
      decide: async () => ({ outcome: 'decided', decision: decision({ finalAnswer: 'Claro, tudo bem por aqui!' }) }),
    };
    const app = createSebastianApplication({
      logger, dataDir: root, specializedTool: tool, authorizedCommands: [],
      cognitiveModelProvider: provider, cognitiveOperationalTools: githubCatalog,
    });

    const result = await app.executeCommand(input('Oi Sebastian, tudo bem?', 1));

    assert.equal(result.output.message, 'Claro, tudo bem por aqui!');
    assert.deepEqual(invoked, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a decision naming a GitHub toolId outside the approved catalog is rejected, never executed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-outside-catalog-'));
  try {
    const registry = neuroHubRegistry();
    const githubTool = new GitHubReadOnlyTool({ token: SECRET_TOKEN, registry, fetchImpl: async () => { throw new Error('must not be called'); } });
    const onlineTool = new OnlineReadOnlyTool(root, [], githubTool);
    const invoked: string[] = [];
    const tool = {
      async invoke(invocation: SpecializedToolInvocationInput) {
        invoked.push(invocation.toolId);
        return onlineTool.invoke(invocation);
      },
    };
    const provider: CognitiveModelProvider = {
      decide: async () => ({ outcome: 'decided', decision: decision({
        intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
        toolId: 'github.deleteFile', toolArguments: { projectId: 'neuro-hub-pro' },
      }) }),
    };
    const app = createSebastianApplication({
      logger, dataDir: root, specializedTool: tool, authorizedCommands: [],
      cognitiveModelProvider: provider, cognitiveOperationalTools: githubCatalog,
    });

    const result = await app.executeCommand(input('Apague um arquivo do Neuro Hub.', 1));

    assert.deepEqual(invoked, []);
    assert.equal(result.status, 'succeeded');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the online composition exposes GitHub read-only tools only when configured, and never a write/shell/deploy toolId', async () => {
  const projectsJson = JSON.stringify([
    { id: 'neuro-hub-pro', displayName: 'Neuro Hub Pro', aliases: ['Neuro Hub'], owner: 'sebastian-org', repository: 'neuro-hub', defaultBranch: 'main' },
  ]);

  let toolIdsWithGitHub: readonly string[] = [];
  const providerWithGitHub: CognitiveModelProvider = {
    decide: async (request) => {
      toolIdsWithGitHub = request.availableTools.map((tool) => tool.toolId);
      return { outcome: 'decided', decision: decision({ finalAnswer: 'Resposta sem ferramenta.' }) };
    },
  };
  const appWithGitHub = createOnlineSebastianApplication(logger, providerWithGitHub, undefined, {
    [SEBASTIAN_GITHUB_TOKEN_ENV_VAR]: 'a-token',
    [SEBASTIAN_GITHUB_PROJECTS_ENV_VAR]: projectsJson,
  });
  await appWithGitHub.executeCommand(input('Explique algo geral.', 60));

  assert.deepEqual(toolIdsWithGitHub.filter((id) => id.startsWith('github.')), [
    GITHUB_GET_PROJECT_TOOL_ID, GITHUB_LIST_TREE_TOOL_ID, GITHUB_READ_FILE_TOOL_ID, GITHUB_LIST_COMMITS_TOOL_ID, GITHUB_COMPARE_BRANCH_TOOL_ID,
  ]);
  assert.equal(toolIdsWithGitHub.some((id) => /write|replace|shell|deploy/i.test(id)), false);

  let toolIdsWithoutGitHub: readonly string[] = [];
  const providerWithoutGitHub: CognitiveModelProvider = {
    decide: async (request) => {
      toolIdsWithoutGitHub = request.availableTools.map((tool) => tool.toolId);
      return { outcome: 'decided', decision: decision({ finalAnswer: 'Resposta sem ferramenta.' }) };
    },
  };
  const appWithoutGitHub = createOnlineSebastianApplication(logger, providerWithoutGitHub, undefined, {});
  await appWithoutGitHub.executeCommand(input('Explique algo geral.', 61));

  assert.equal(toolIdsWithoutGitHub.some((id) => id.startsWith('github.')), false);
});
