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

const DEFAULT_PROJECT_ID = 'sebastiania';
/** Mirrors the deterministic routing OnlineSebastianApplication wires when exactly one project is registered - see CognitiveOperationalOrchestrator's `deterministicIntent`. */
const githubCatalog = [
  {
    toolId: GITHUB_GET_PROJECT_TOOL_ID, description: 'Resolve um projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId'],
    deterministicIntent: {
      pattern: /^\s*github\s*[?!.]*\s*$|^(?=.*\bgithub\b)(?=.*\b(?:projet\w*|acesso|acessar)\b|.*\bconsegue\s+ver\b)(?!.*\bcommits?\b)/i,
      buildArguments: () => ({ projectId: DEFAULT_PROJECT_ID }),
      answerFromSuccessfulObservation: (observation: { readonly summary: string }) => observation.summary,
    },
  },
  {
    toolId: GITHUB_LIST_COMMITS_TOOL_ID, description: 'Lista commits recentes do projeto GitHub autorizado.', requiresAuthorization: false, requiredStringArguments: ['projectId'],
    deterministicIntent: {
      pattern: /^(?=.*\bgithub\b)(?=.*\bcommits?\b)/i,
      immediateContext: {
        objectivePattern: /(?:último|ultimo|recentes?|mais\s+recente)(?:(?!\n).)*\bcommits?\b|\bcommits?\b(?:(?!\n).)*(?:último|ultimo|recentes?|mais\s+recente)/i,
        contextPattern: /\bgithub\b/i,
      },
      buildArguments: () => ({ projectId: DEFAULT_PROJECT_ID }),
      answerFromSuccessfulObservation: (observation: { readonly summary: string }) => `Commits recentes no GitHub:\n${observation.summary}`,
    },
  },
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

function multipleCommitsFetchImpl() {
  return async (url: string) => {
    if (!url.includes('/commits')) throw new Error(`unexpected fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([
        { sha: '78702c464f99', commit: { message: 'fix: preserve GitHub continuity and log build SHA', author: { name: 'Gabriel', date: '2026-08-28T03:00:00Z' } } },
        { sha: '2c27fafbcee2', commit: { message: 'refine dynamic conversational adaptation', author: { name: 'Gabriel', date: '2026-08-28T02:00:00Z' } } },
        { sha: '1d8cb3961bf9', commit: { message: 'fix cognitive timeout cancellation and context budget', author: { name: 'Gabriel', date: '2026-08-28T01:00:00Z' } } },
        { sha: 'debb0a1a3880', commit: { message: 'preserve single web session across restarts', author: { name: 'Gabriel', date: '2026-08-27T23:00:00Z' } } },
      ]),
    };
  };
}

function buildApp(provider: CognitiveModelProvider, fetchImpl: ReturnType<typeof commitsFetchImpl>, root: string, effectiveLogger: Logger = logger) {
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
    logger: effectiveLogger, dataDir: root, specializedTool: tool, authorizedCommands: [],
    cognitiveModelProvider: provider, cognitiveOperationalTools: githubCatalog,
  });
  return { app, invoked };
}

function capturingLogger(): { readonly logger: Logger; readonly calls: Array<{ readonly level: string; readonly message: string; readonly metadata: unknown }> } {
  const calls: Array<{ readonly level: string; readonly message: string; readonly metadata: unknown }> = [];
  const record = (level: string) => (message: string, metadata?: Record<string, unknown>) => {
    calls.push({ level, message, metadata });
  };
  return { calls, logger: { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') } };
}

test('an explicit GitHub request for recent commits calls github.listCommits and the final answer cites the real commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-explicit-'));
  try {
    let decideCalls = 0;
    const provider: CognitiveModelProvider = {
      decide: async () => {
        decideCalls += 1;
        // This is the invalid repeated production proposal. It must be
        // unreachable because the deterministic route already completed.
        return { outcome: 'decided', decision: decision({
          intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
          toolId: GITHUB_LIST_COMMITS_TOOL_ID, toolArguments: { projectId: 'SebastianIA', limit: '5' },
        }) };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const result = await app.executeCommand(
      input('verifique o projeto SebastianIA no GitHub e me diga quais foram os commits mais recentes', 1),
    );

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.equal(decideCalls, 0);
    assert.match(String(result.output.message), /corrige timeout do provider cognitivo/);
    assert.doesNotMatch(String(result.output.message), /não consegui concluir|ainda não sei responder/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('evidence synthesis is proportional for singular, plural and explicit quantity requests', async () => {
  const cases = [
    {
      objective: 'qual foi o último commit no github?',
      answer: 'O último foi o 78702c46 — fix: preserve GitHub continuity and log build SHA.',
      included: ['78702c46'], excluded: ['2c27fafb', '1d8cb396'],
    },
    {
      objective: 'quais foram os últimos commits no github?',
      answer: 'Os últimos foram 78702c46, 2c27fafb, 1d8cb396 e debb0a1a.',
      included: ['78702c46', '2c27fafb'], excluded: [],
    },
    {
      objective: 'me mostra os últimos 3 commits no github',
      answer: '78702c46, 2c27fafb e 1d8cb396.',
      included: ['78702c46', '2c27fafb', '1d8cb396'], excluded: ['debb0a1a'],
    },
  ] as const;

  for (const [index, scenario] of cases.entries()) {
    const root = mkdtempSync(join(tmpdir(), `sebastian-github-synthesis-${index}-`));
    try {
      let synthesisObservations = 0;
      const provider: CognitiveModelProvider = {
        decide: async () => { throw new Error('deterministic completion must not call decide'); },
        synthesize: async (request) => {
          synthesisObservations = request.observations.length;
          assert.match(request.observations[0]?.summary ?? '', /78702c464f99/);
          return { outcome: 'synthesized', answer: scenario.answer };
        },
      };
      const { app, invoked } = buildApp(provider, multipleCommitsFetchImpl(), root);
      const result = await app.executeCommand(input(scenario.objective, 20 + index));
      assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID]);
      assert.equal(synthesisObservations, 1);
      for (const value of scenario.included) assert.match(String(result.output.message), new RegExp(value));
      for (const value of scenario.excluded) assert.doesNotMatch(String(result.output.message), new RegExp(value));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a semantic GitHub question uses observed commits instead of dumping the collection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-semantic-synthesis-'));
  try {
    const provider: CognitiveModelProvider = {
      decide: async (request) => request.recentObservations.length === 0
        ? { outcome: 'decided', decision: decision({
            intent: 'investigate', nextAction: 'invokeTool', completionState: 'inProgress',
            toolId: GITHUB_LIST_COMMITS_TOOL_ID, toolArguments: { projectId: DEFAULT_PROJECT_ID },
          }) }
        : { outcome: 'decided', decision: decision({
            finalAnswer: 'A observação já é suficiente para concluir.',
          }) },
      synthesize: async (request) => {
        assert.match(request.observations[0]?.summary ?? '', /preserve GitHub continuity/);
        return { outcome: 'synthesized', answer: 'Sim. A mudança mais recente relacionada ao GitHub preservou a continuidade e registrou o SHA do build.' };
      },
    };
    const { app, invoked } = buildApp(provider, multipleCommitsFetchImpl(), root);
    const result = await app.executeCommand(input('teve alguma mudança relacionada ao github recentemente?', 24));

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.match(String(result.output.message), /preservou a continuidade/i);
    assert.doesNotMatch(String(result.output.message), /2c27fafb|1d8cb396|debb0a1a/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed synthesis after a successful Tool uses evidence fallback without reporting Tool failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-synthesis-fallback-'));
  try {
    let decideCalls = 0;
    const provider: CognitiveModelProvider = {
      decide: async () => { decideCalls += 1; return { outcome: 'timeout' }; },
      synthesize: async () => ({ outcome: 'timeout' }),
    };
    const { app, invoked } = buildApp(provider, multipleCommitsFetchImpl(), root);
    const result = await app.executeCommand(input('qual foi o último commit no github?', 25));

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.equal(decideCalls, 0);
    assert.match(String(result.output.message), /78702c464f99/);
    assert.doesNotMatch(String(result.output.message), /não consegui concluir|falhou/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitHub project access concludes from getProject and an immediate commit follow-up uses that exact context', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-immediate-continuity-'));
  try {
    let decideCalls = 0;
    let synthesisCalls = 0;
    const provider: CognitiveModelProvider = {
      decide: async () => {
        decideCalls += 1;
        return { outcome: 'timeout' };
      },
      synthesize: async (request) => {
        synthesisCalls += 1;
        return {
          outcome: 'synthesized',
          answer: request.observations[0]?.toolId === GITHUB_GET_PROJECT_TOOL_ID
            ? 'Consigo ver o projeto SebastianIA no GitHub.'
            : 'No GitHub, o último foi abcdef123456 — fix: corrige timeout do provider cognitivo.',
        };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const project = await app.executeCommand(input('vc consegue ver meus projetos no github?', 10));
    assert.deepEqual(invoked, [GITHUB_GET_PROJECT_TOOL_ID]);
    assert.equal(decideCalls, 0, 'a successful getProject observation is already a complete answer');
    assert.equal(synthesisCalls, 1);
    assert.match(String(project.output.message), /SebastianIA|gahsantosss16-dev\/SebastianIA/);

    const commit = await app.executeCommand(input('qual foi o último commit do projeto que vc tem acesso?', 11));
    assert.deepEqual(invoked, [GITHUB_GET_PROJECT_TOOL_ID, GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.equal(decideCalls, 0, 'the immediate GitHub continuation must remain deterministic');
    assert.equal(synthesisCalls, 2);
    assert.match(String(commit.output.message), /abcdef123456|corrige timeout do provider cognitivo/);

    const shorterCommit = await app.executeCommand(input('qual foi o último commit?', 14));
    assert.deepEqual(invoked, [GITHUB_GET_PROJECT_TOOL_ID, GITHUB_LIST_COMMITS_TOOL_ID, GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.equal(synthesisCalls, 3);
    assert.match(String(shorterCommit.output.message), /abcdef123456|corrige timeout do provider cognitivo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unrelated immediate context never activates the contextual GitHub commits route', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-unrelated-context-'));
  try {
    let decideCalls = 0;
    const provider: CognitiveModelProvider = {
      decide: async () => {
        decideCalls += 1;
        return { outcome: 'timeout' };
      },
      respond: async () => ({ outcome: 'responded', answer: 'Não tenho contexto suficiente para identificar esse commit.' }),
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    await app.executeCommand(input('estou organizando uma viagem para a Espanha', 12));
    const result = await app.executeCommand(input('qual foi o último commit do projeto que vc tem acesso?', 13));

    assert.deepEqual(invoked, []);
    assert.ok(decideCalls >= 1, 'without proven GitHub continuity the normal operational fallback remains available');
    assert.doesNotMatch(String(result.output.message), /abcdef123456|Commits recentes no GitHub/);
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

    // Deliberately omits "GitHub" so the model's own choice of the alias
    // (not the deterministic default-project route, which needs the word
    // "github" to fire) is what drives this specific tool call - this test
    // is about alias resolution, not about deterministic routing.
    const result = await app.executeCommand(input('quais os commits recentes do Sebastian?', 2));

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.match(String(result.output.message), /corrige timeout do provider cognitivo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('successful deterministic commits route completes from evidence even if every optional language path would time out', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-fallback-guard-'));
  try {
    let respondCalls = 0;
    let decideCalls = 0;
    const provider: CognitiveModelProvider = {
      decide: async () => {
        decideCalls += 1;
        return { outcome: 'timeout' };
      },
      respond: async () => {
        respondCalls += 1;
        return { outcome: 'timeout' };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const result = await app.executeCommand(
      input('verifique o projeto SebastianIA no GitHub e me diga quais foram os commits mais recentes', 3),
    );

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID]);
    assert.equal(decideCalls, 0, 'the completed deterministic capability must not require another operational decision');
    assert.equal(respondCalls, 0, 'the conversational "no tools" fallback must never be consulted after a real Tool attempt');
    assert.match(String(result.output.message), /abcdef123456|corrige timeout do provider cognitivo/);
    assert.doesNotMatch(String(result.output.message), /não tenho acesso/i);
    assert.doesNotMatch(String(result.output.message), /acesso.{0,20}internet/i);
    assert.doesNotMatch(String(result.output.message), /não consegui concluir|ainda não sei responder/i);
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

    // Deliberately omits "GitHub"/"commits" so the deterministic default-
    // project route never fires here - this test is specifically about a
    // real Tool rejection for a project the MODEL itself chose, not about
    // deterministic routing (which always targets the one registered,
    // valid project and would otherwise mask this exact scenario).
    const result = await app.executeCommand(
      input('verifique o projeto ProjetoInexistente', 4),
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
    assert.equal(result.output.message, 'não deveria ser usado');
    assert.equal(respondCalls, 1, 'ordinary conversation uses the general conversational model without an operational planning turn');
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

test('decide proposing a non-actionable step never surfaces the "no access" fallback claim, and real evidence was already gathered deterministically first', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-non-actionable-'));
  try {
    let respondCalls = 0;
    const provider: CognitiveModelProvider = {
      // A structurally valid, successfully-parsed decision (matching production's
      // "decide respondeu com sucesso") whose nextAction the orchestrator does not
      // treat as actionable. Deliberately never calls invokeTool itself - the
      // real evidence in `invoked` below comes entirely from the deterministic
      // route, which already ran before this decide() was ever consulted.
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

    assert.deepEqual(invoked, [GITHUB_LIST_COMMITS_TOOL_ID], 'the deterministic route gathers real evidence even though decide() itself never proposes invokeTool');
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

test('the cognitive loop logs only structural metadata about each step - never the objective, arguments, observation content or final answer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-instrumentation-'));
  try {
    const { logger: captured, calls } = capturingLogger();
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
    const { app } = buildApp(provider, commitsFetchImpl(), root, captured);

    await app.executeCommand(
      input('verifique o projeto SebastianIA no GitHub e me diga quais foram os commits mais recentes', 10),
    );

    const decisionSteps = calls.filter((call) => call.message === 'Cognitive operational decision step completed.');
    const finished = calls.filter((call) => call.message === 'Cognitive operational loop finished.');
    const deterministicRoutes = calls.filter((call) => call.message === 'Cognitive operational deterministic route completed.');
    assert.ok(decisionSteps.length > 0 || deterministicRoutes.length > 0, 'expected at least one structural step to be logged');
    assert.ok(finished.length > 0, 'expected the final outcome to be logged');

    for (const call of [...decisionSteps, ...finished, ...deterministicRoutes]) {
      const metadata = call.metadata as Record<string, unknown>;
      for (const key of Object.keys(metadata)) {
        assert.notEqual(key, 'objective');
        assert.notEqual(key, 'toolArguments');
        assert.notEqual(key, 'answer');
        assert.notEqual(key, 'observation');
        assert.notEqual(key, 'summary');
      }
    }

    const serialized = JSON.stringify(calls);
    assert.equal(serialized.includes('abcdef123456'), false, 'no observation content (commit sha) may be logged');
    assert.equal(serialized.includes('corrige timeout do provider cognitivo'), false, 'no observation content (commit message) may be logged');
    assert.equal(serialized.includes('verifique o projeto SebastianIA'), false, 'the objective text may never be logged');
    assert.equal(serialized.includes('Os commits recentes do SebastianIA incluem'), false, 'the final answer text may never be logged');
    assert.equal(serialized.includes('fake-token'), false, 'the token may never be logged');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production evidence: a bare "github?" mention never reaches a model that hallucinates "no internet access" on an empty first turn', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-github-bare-mention-'));
  try {
    let respondCalls = 0;
    const provider: CognitiveModelProvider = {
      // Reproduces the exact production failure mode observed: on an empty
      // first turn (no observations yet), the model concludes immediately
      // with a false incapacity claim, without ever proposing invokeTool.
      // The deterministic route must make this branch unreachable for any
      // GitHub-intent objective, by guaranteeing recentObservations is
      // already non-empty before decide() is ever called.
      decide: async (request) => {
        if (request.recentObservations.length === 0) {
          return { outcome: 'decided', decision: decision({ finalAnswer: 'Não tenho acesso à internet ou a ferramentas externas.' }) };
        }
        return { outcome: 'decided', decision: decision({ finalAnswer: `Aqui está o que encontrei: ${request.recentObservations[0]?.summary}` }) };
      },
      respond: async () => {
        respondCalls += 1;
        return { outcome: 'responded', answer: 'Não tenho acesso à internet ou a ferramentas externas.' };
      },
    };
    const { app, invoked } = buildApp(provider, commitsFetchImpl(), root);

    const result = await app.executeCommand(input('github?', 9));

    assert.deepEqual(invoked, [GITHUB_GET_PROJECT_TOOL_ID], 'a bare GitHub mention must still gather real evidence before any conclusion is trusted');
    assert.equal(respondCalls, 0);
    assert.doesNotMatch(String(result.output.message), /não tenho acesso/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
