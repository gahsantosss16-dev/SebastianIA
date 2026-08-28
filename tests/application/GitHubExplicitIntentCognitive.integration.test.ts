import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSebastianApplication } from '../../application/SebastianApplication.js';
import type { CognitiveDecision, CognitiveDecisionRequest, CognitiveModelProvider } from '../../core/cognition/index.js';
import type { Logger } from '../../core/logger.js';
import { ProjectRegistry } from '../../core/project/ProjectRegistry.js';
import {
  GITHUB_GET_PROJECT_TOOL_ID,
  GITHUB_LIST_COMMITS_TOOL_ID,
  GitHubReadOnlyTool,
  OnlineReadOnlyTool,
  type SpecializedToolInvocationInput,
} from '../../core/tool/index.js';

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

const githubCatalog = [
  { toolId: GITHUB_GET_PROJECT_TOOL_ID, description: 'Resolve um projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId'] },
  { toolId: GITHUB_LIST_COMMITS_TOOL_ID, description: 'Lista commits recentes do projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId'] },
] as const;

function input(text: string, second: number) {
  return { type: 'converse', input: { text }, generatedAt: `2026-08-28T15:00:${String(second).padStart(2, '0')}.000Z` };
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

function sebastianRegistry(): ProjectRegistry {
  return new ProjectRegistry({
    entries: [
      {
        id: 'sebastiania',
        displayName: 'SebastianIA',
        aliases: ['Sebastian'],
        resourceKind: 'github-repository',
        remoteRepository: { owner: 'gahsantosss16-dev', repository: 'SebastianIA', defaultBranch: 'main' },
        permissions: { access: 'read-only' },
      },
    ],
  });
}

function commitsFetchImpl() {
  return async (url: string) => {
    if (url.includes('/commits')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          { sha: 'abcdef123456', commit: { message: 'fix: corrige timeout do provider cognitivo', author: { name: 'Gabriel', date: '2026-08-28T00:00:00Z' } } },
        ]),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

function buildApp(provider: CognitiveModelProvider, fetchImpl: ReturnType<typeof commitsFetchImpl>, root: string) {
  const registry = sebastianRegistry();
  const githubTool = new GitHubReadOnlyTool({ token: 'fake-token', registry, fetchImpl });
  const onlineTool = new OnlineReadOnlyTool(root, [], githubTool);
  const invoked: string[] = [];
  const tool = {
    async invoke(invocation: SpecializedToolInvocationInput) {
      invoked.push(invocation.toolId);
      return onlineTool.invoke(invocation);
    },
  };
  const app = createSebastianApplication({
    logger, dataDir: root, specializedTool: tool, authorizedCommands: [],
    cognitiveModelProvider: provider, cognitiveOperationalTools: githubCatalog,
  });
  return { app, invoked };
}

test('an explicit GitHub request for recent commits calls github.listCommits and the final answer cites the real commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-explicit-'));
  try {
    const provider: CognitiveModelProvider = {
      decide: async (request) => {
        if (request.recentObservations.length === 0) {
          return { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: GITHUB_LIST_COMMITS_TOOL_ID, toolArguments: { projectId: 'SebastianIA' },
          }) };
        }
        return { outcome: 'decided', decision: decision({
          finalAnswer: `Os commits recentes do SebastianIA incluem: ${request.recentObservations[0]?.summary}`,
        }) };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const result = await app.executeCommand(
      input('verifique o projeto SebastianIA no GitHub e me diga quais foram os commits mais recentes', 1),
    );

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.match(String(result.output.message), /corrige timeout do provider cognitivo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the project alias "Sebastian" resolves to the same registered GitHub project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-alias-'));
  try {
    const provider: CognitiveModelProvider = {
      decide: async (request) => {
        if (request.recentObservations.length === 0) {
          return { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: GITHUB_LIST_COMMITS_TOOL_ID, toolArguments: { projectId: 'Sebastian' },
          }) };
        }
        return { outcome: 'decided', decision: decision({
          finalAnswer: `Encontrei: ${request.recentObservations[0]?.summary}`,
        }) };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const result = await app.executeCommand(input('quais os commits recentes do Sebastian no GitHub?', 2));

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.match(String(result.output.message), /corrige timeout do provider cognitivo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('when the operational loop fails after a valid GitHub observation, the answer is an honest operational message, never a "no access" claim from the conversational fallback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-fallback-guard-'));
  try {
    let respondCalls = 0;
    const provider: CognitiveModelProvider = {
      decide: async (request) => {
        if (request.recentObservations.length === 0) {
          return { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: GITHUB_LIST_COMMITS_TOOL_ID, toolArguments: { projectId: 'SebastianIA' },
          }) };
        }
        // Simulates a decide() timeout/failure on the very next round-trip,
        // even though a real, valid GitHub observation was already gathered.
        return { outcome: 'unavailable', reason: 'simulated decide timeout after a real observation' };
      },
      respond: async () => {
        respondCalls += 1;
        return { outcome: 'responded', answer: 'Não tenho acesso ao GitHub.' };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const result = await app.executeCommand(
      input('verifique o projeto SebastianIA no GitHub e me diga quais foram os commits mais recentes', 3),
    );

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.equal(respondCalls, 0, 'the conversational "no tools" fallback must never be consulted after a real Tool attempt');
    assert.doesNotMatch(String(result.output.message), /não tenho acesso/i);
    assert.doesNotMatch(String(result.output.message), /acesso.{0,20}internet/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a real GitHub Tool error (unregistered project) is reported as an honest operational outcome, never as "no internet access"', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-real-error-'));
  try {
    const provider: CognitiveModelProvider = {
      decide: async (request) => {
        if (request.recentObservations.length === 0) {
          return { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: GITHUB_LIST_COMMITS_TOOL_ID, toolArguments: { projectId: 'ProjetoInexistente' },
          }) };
        }
        return { outcome: 'decided', decision: decision({
          finalAnswer: `Não consegui consultar esse projeto: ${request.recentObservations[0]?.summary}`,
        }) };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const result = await app.executeCommand(
      input('verifique o projeto ProjetoInexistente no GitHub e me diga os commits recentes', 4),
    );

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.match(String(result.output.message), /nenhum projeto autorizado corresponde/i);
    assert.doesNotMatch(String(result.output.message), /não tenho acesso à internet/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a casual request with no GitHub intent never calls a github.* tool, and preserves the normal conversational answer unchanged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-casual-'));
  try {
    let respondCalls = 0;
    const provider: CognitiveModelProvider = {
      decide: async () => ({ outcome: 'decided', decision: decision({ finalAnswer: 'Vamos conversar normalmente.' }) }),
      respond: async () => {
        respondCalls += 1;
        return { outcome: 'responded', answer: 'não deveria ser usado' };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const result = await app.executeCommand(input('Como foi seu dia?', 5));

    assert.deepEqual(invoked, []);
    assert.equal(result.output.message, 'Vamos conversar normalmente.');
    assert.equal(respondCalls, 0, 'a plain conclusion needs no conversational fallback at all');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a successful GitHub observation is used directly by the final answer - the conversational fallback is never consulted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-no-fallback-needed-'));
  try {
    let respondCalls = 0;
    const provider: CognitiveModelProvider = {
      decide: async (request) => {
        if (request.recentObservations.length === 0) {
          return { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: GITHUB_LIST_COMMITS_TOOL_ID, toolArguments: { projectId: 'SebastianIA' },
          }) };
        }
        return { outcome: 'decided', decision: decision({
          finalAnswer: `Commit mais recente: ${request.recentObservations[0]?.summary}`,
        }) };
      },
      respond: async () => {
        respondCalls += 1;
        return { outcome: 'responded', answer: 'não tenho acesso ao GitHub' };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const result = await app.executeCommand(input('me diga os commits recentes do SebastianIA no GitHub', 6));

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.match(String(result.output.message), /corrige timeout do provider cognitivo/);
    assert.equal(respondCalls, 0, 'a real, successful Tool observation must never be second-guessed by the "no tools" fallback');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('decide proposing a non-actionable step before ever calling a Tool still never surfaces the "no access" fallback claim', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-non-actionable-'));
  try {
    let respondCalls = 0;
    const provider: CognitiveModelProvider = {
      // A structurally valid, successfully-parsed decision (matching production's
      // "decide respondeu com sucesso") whose nextAction the orchestrator does not
      // treat as actionable - `toolCalls` stays 0 because no Tool was ever reached.
      decide: async () => ({
        outcome: 'decided',
        decision: {
          intent: 'investigate',
          goal: 'investigar o projeto SebastianIA no GitHub',
          reasoningSummary: 'preciso de mais evidência antes de agir',
          nextAction: 'requestMoreEvidence',
          requiresAuthorization: false,
          expectedEvidence: 'lista de commits recentes',
          completionState: 'inProgress',
          confidence: 0.4,
        },
      }),
      respond: async () => {
        respondCalls += 1;
        return { outcome: 'responded', answer: 'Não tenho acesso ao GitHub.' };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const result = await app.executeCommand(
      input('verifique o projeto SebastianIA no GitHub e me diga quais foram os commits mais recentes', 7),
    );

    assert.deepEqual(invoked, []);
    assert.equal(respondCalls, 0, 'a demonstrably-working decide() must never hand off to the "no tools" conversational fallback');
    assert.doesNotMatch(String(result.output.message), /não tenho acesso/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('end-to-end: "Sebastian, verifique o projeto SebastianIA no GitHub e me diga quais foram os commits mais recentes" resolves through github.listCommits with a real answer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-e2e-'));
  try {
    let respondCalls = 0;
    const provider: CognitiveModelProvider = {
      decide: async (request) => {
        if (request.recentObservations.length === 0) {
          return { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: GITHUB_LIST_COMMITS_TOOL_ID, toolArguments: { projectId: 'SebastianIA' },
          }) };
        }
        return { outcome: 'decided', decision: decision({
          finalAnswer: `Os commits mais recentes do SebastianIA: ${request.recentObservations[0]?.summary}`,
        }) };
      },
      respond: async () => {
        respondCalls += 1;
        return { outcome: 'responded', answer: 'Não tenho acesso ao GitHub.' };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const startedAt = Date.now();
    const result = await app.executeCommand(
      input('Sebastian, verifique o projeto SebastianIA no GitHub e me diga quais foram os commits mais recentes.', 8),
    );
    const durationMs = Date.now() - startedAt;

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID], 'github.listCommits must actually run');
    assert.match(String(result.output.message), /abcdef123456|corrige timeout do provider cognitivo/, 'the final answer must cite the real observed commit');
    assert.doesNotMatch(String(result.output.message), /não tenho acesso/i);
    assert.doesNotMatch(String(result.output.message), /acesso.{0,20}internet/i);
    assert.doesNotMatch(String(result.output.message), /ainda não sei responder/i);
    assert.equal(respondCalls, 0, 'the false-denial conversational fallback must never be reached once the Tool observation is real');
    assert.ok(durationMs < 5_000, 'no timeout: the whole exchange must resolve quickly');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
