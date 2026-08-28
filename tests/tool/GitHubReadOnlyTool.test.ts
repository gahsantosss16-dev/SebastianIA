import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GITHUB_COMPARE_BRANCH_TOOL_ID,
  GITHUB_GET_PROJECT_TOOL_ID,
  GITHUB_LIST_COMMITS_TOOL_ID,
  GITHUB_LIST_TREE_TOOL_ID,
  GITHUB_READ_FILE_TOOL_ID,
  GitHubReadOnlyTool,
} from '../../core/tool/GitHubReadOnlyTool.js';
import { ProjectRegistry } from '../../core/project/ProjectRegistry.js';
import type { SpecializedToolInvocationInput, SpecializedToolInvocationResult } from '../../core/tool/index.js';

const SECRET_TOKEN = 'ghp_super-secret-token-must-not-leak';

function registry(): ProjectRegistry {
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

function invocation(toolId: string, payload: Readonly<Record<string, unknown>> = {}): SpecializedToolInvocationInput {
  return {
    toolId,
    executionId: 'execution:1',
    responsibilityId: 'capability.execute.converse',
    requestedAt: '2026-08-28T00:00:00.000Z',
    payload,
  };
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

async function outcomeOf(result: SpecializedToolInvocationResult): Promise<Readonly<Record<string, unknown>>> {
  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') throw new Error('unreachable');
  return result.output;
}

test('github.getProject resolves a registered project by alias without any network call', async () => {
  let fetchCalls = 0;
  const tool = new GitHubReadOnlyTool({ token: SECRET_TOKEN, registry: registry(), fetchImpl: async () => { fetchCalls += 1; throw new Error('must not be called'); } });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_GET_PROJECT_TOOL_ID, { projectId: 'Neuro Hub' })));

  assert.equal(output.outcome, 'ok');
  assert.equal(output.projectId, 'neuro-hub-pro');
  assert.equal(output.owner, 'sebastian-org');
  assert.equal(output.repository, 'neuro-hub');
  assert.equal(output.defaultBranch, 'main');
  assert.equal(output.access, 'read-only');
  assert.equal(fetchCalls, 0);
});

test('an unregistered, invented project reference is rejected, never guessed', async () => {
  const tool = new GitHubReadOnlyTool({ token: SECRET_TOKEN, registry: registry() });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_GET_PROJECT_TOOL_ID, { projectId: 'Some Invented Repo' })));

  assert.equal(output.outcome, 'rejected');
  assert.equal(output.reasonCode, 'projectNotFound');
});

test('the model cannot override owner/repository/url via extra payload fields', async () => {
  const tool = new GitHubReadOnlyTool({ token: SECRET_TOKEN, registry: registry(), fetchImpl: async () => { throw new Error('must not be called'); } });

  const output = await outcomeOf(
    await tool.invoke(
      invocation(GITHUB_GET_PROJECT_TOOL_ID, {
        projectId: 'neuro-hub-pro',
        owner: 'attacker',
        repository: 'evil-repo',
        url: 'https://example.com/evil',
      }),
    ),
  );

  assert.equal(output.outcome, 'rejected');
  assert.equal(output.reasonCode, 'invalidToolArguments');
});

test('an unsupported/write-shaped toolId is rejected without ever calling the network', async () => {
  let fetchCalls = 0;
  const tool = new GitHubReadOnlyTool({ token: SECRET_TOKEN, registry: registry(), fetchImpl: async () => { fetchCalls += 1; throw new Error('must not be called'); } });

  const output = await outcomeOf(await tool.invoke(invocation('github.createFile', { projectId: 'neuro-hub-pro' })));

  assert.equal(output.outcome, 'rejected');
  assert.equal(output.reasonCode, 'unsupportedOperation');
  assert.equal(fetchCalls, 0);
});

test('github.readFile decodes base64 content and reports the branch it read from', async () => {
  const content = Buffer.from('export const answer = 42;\n', 'utf8').toString('base64');
  const tool = new GitHubReadOnlyTool({
    token: SECRET_TOKEN,
    registry: registry(),
    fetchImpl: async (url) => {
      assert.match(url, /\/repos\/sebastian-org\/neuro-hub\/contents\/src\/answer\.ts\?ref=main/);
      return jsonResponse(200, { type: 'file', encoding: 'base64', content, path: 'src/answer.ts', size: 27 });
    },
  });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_READ_FILE_TOOL_ID, { projectId: 'neuro-hub-pro', path: 'src/answer.ts' })));

  assert.equal(output.outcome, 'ok');
  assert.equal(output.content, 'export const answer = 42;\n');
  assert.match(String(output.message), /answer = 42/);
});

test('github.readFile rejects a path that traverses outside the repository', async () => {
  const tool = new GitHubReadOnlyTool({ token: SECRET_TOKEN, registry: registry(), fetchImpl: async () => { throw new Error('must not be called'); } });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_READ_FILE_TOOL_ID, { projectId: 'neuro-hub-pro', path: '../../etc/passwd' })));

  assert.equal(output.outcome, 'rejected');
  assert.equal(output.reasonCode, 'invalidToolArguments');
});

test('github.readFile reports a safe rejection when the path is actually a directory', async () => {
  const tool = new GitHubReadOnlyTool({
    token: SECRET_TOKEN,
    registry: registry(),
    fetchImpl: async () => jsonResponse(200, [{ name: 'src', path: 'src', type: 'dir' }]),
  });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_READ_FILE_TOOL_ID, { projectId: 'neuro-hub-pro', path: 'src' })));

  assert.equal(output.outcome, 'rejected');
  assert.equal(output.reasonCode, 'pathIsDirectory');
});

test('github.listTree lists directory entries, truncated and typed', async () => {
  const tool = new GitHubReadOnlyTool({
    token: SECRET_TOKEN,
    registry: registry(),
    fetchImpl: async () =>
      jsonResponse(200, [
        { name: 'src', path: 'src', type: 'dir', size: 0 },
        { name: 'README.md', path: 'README.md', type: 'file', size: 120 },
      ]),
  });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_LIST_TREE_TOOL_ID, { projectId: 'Neuro Hub' })));

  assert.equal(output.outcome, 'ok');
  assert.deepEqual(output.entries, [
    { name: 'src', path: 'src', type: 'dir', size: 0 },
    { name: 'README.md', path: 'README.md', type: 'file', size: 120 },
  ]);
});

test('github.listCommits summarizes recent commits without unbounded content', async () => {
  const tool = new GitHubReadOnlyTool({
    token: SECRET_TOKEN,
    registry: registry(),
    fetchImpl: async (url) => {
      assert.match(url, /\/repos\/sebastian-org\/neuro-hub\/commits\?sha=main&per_page=5/);
      return jsonResponse(200, [
        { sha: 'abcdef1234567890', commit: { message: 'fix: corrige bug\n\ndetalhes longos', author: { name: 'Dev', date: '2026-08-01T00:00:00Z' } } },
      ]);
    },
  });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_LIST_COMMITS_TOOL_ID, { projectId: 'neuro-hub-pro', limit: 5 })));

  assert.equal(output.outcome, 'ok');
  assert.deepEqual(output.commits, [{ sha: 'abcdef123456', message: 'fix: corrige bug', authorName: 'Dev', date: '2026-08-01T00:00:00Z' }]);
});

test('github.listCommits rejects an out-of-range limit', async () => {
  const tool = new GitHubReadOnlyTool({ token: SECRET_TOKEN, registry: registry(), fetchImpl: async () => { throw new Error('must not be called'); } });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_LIST_COMMITS_TOOL_ID, { projectId: 'neuro-hub-pro', limit: 999 })));

  assert.equal(output.outcome, 'rejected');
});

test('github.compareBranch compares against the registry-configured base branch and never includes raw patch text', async () => {
  const tool = new GitHubReadOnlyTool({
    token: SECRET_TOKEN,
    registry: registry(),
    fetchImpl: async (url) => {
      assert.match(url, /\/compare\/main\.\.\.feature%2Fx/);
      return jsonResponse(200, {
        status: 'ahead',
        ahead_by: 3,
        behind_by: 0,
        files: [{ filename: 'src/answer.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ secret patch content @@' }],
      });
    },
  });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_COMPARE_BRANCH_TOOL_ID, { projectId: 'neuro-hub-pro', ref: 'feature/x' })));

  assert.equal(output.outcome, 'ok');
  assert.equal(output.base, 'main');
  assert.equal(output.head, 'feature/x');
  assert.equal(JSON.stringify(output).includes('secret patch content'), false);
});

test('github.compareBranch rejects a malformed ref', async () => {
  const tool = new GitHubReadOnlyTool({ token: SECRET_TOKEN, registry: registry(), fetchImpl: async () => { throw new Error('must not be called'); } });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_COMPARE_BRANCH_TOOL_ID, { projectId: 'neuro-hub-pro', ref: 'not a valid ref' })));

  assert.equal(output.outcome, 'rejected');
  assert.equal(output.reasonCode, 'invalidToolArguments');
});

for (const [status, reasonCode] of [
  [401, 'upstreamAuthenticationFailed'],
  [403, 'upstreamPermissionDenied'],
  [404, 'upstreamNotFound'],
  [429, 'upstreamRateLimited'],
  [500, 'upstreamServerError'],
] as const) {
  test(`GitHub HTTP ${status} maps to a safe, closed outcome (${reasonCode})`, async () => {
    const tool = new GitHubReadOnlyTool({
      token: SECRET_TOKEN,
      registry: registry(),
      fetchImpl: async () => ({ ok: false, status, text: async () => 'irrelevant upstream body' }),
    });

    const output = await outcomeOf(await tool.invoke(invocation(GITHUB_LIST_TREE_TOOL_ID, { projectId: 'neuro-hub-pro' })));

    assert.equal(output.outcome, 'rejected');
    assert.equal(output.reasonCode, reasonCode);
    assert.equal(JSON.stringify(output).includes('irrelevant upstream body'), false);
  });
}

test('an oversized GitHub response is rejected instead of being parsed', async () => {
  const tool = new GitHubReadOnlyTool({
    token: SECRET_TOKEN,
    registry: registry(),
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'x'.repeat(600 * 1024) }),
  });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_LIST_TREE_TOOL_ID, { projectId: 'neuro-hub-pro' })));

  assert.equal(output.outcome, 'rejected');
  assert.equal(output.reasonCode, 'responseTooLarge');
});

test('a GitHub request that never resolves is aborted by the explicit timeout', async () => {
  const tool = new GitHubReadOnlyTool({
    token: SECRET_TOKEN,
    registry: registry(),
    timeoutMs: 20,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = (init as { readonly signal: AbortSignal }).signal;
        signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  });

  const output = await outcomeOf(await tool.invoke(invocation(GITHUB_LIST_TREE_TOOL_ID, { projectId: 'neuro-hub-pro' })));

  assert.equal(output.outcome, 'rejected');
  assert.equal(output.reasonCode, 'upstreamTimeout');
});

test('the GitHub token never appears in any tool output, across success, rejection, and upstream-failure paths', async () => {
  const tool = new GitHubReadOnlyTool({
    token: SECRET_TOKEN,
    registry: registry(),
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => `unauthorized for token ${SECRET_TOKEN}` }),
  });

  const results = await Promise.all([
    tool.invoke(invocation(GITHUB_GET_PROJECT_TOOL_ID, { projectId: 'nope' })),
    tool.invoke(invocation(GITHUB_LIST_TREE_TOOL_ID, { projectId: 'neuro-hub-pro' })),
    tool.invoke(invocation('github.notAToolAtAll', { projectId: 'neuro-hub-pro' })),
  ]);

  for (const result of results) {
    const output = await outcomeOf(result);
    assert.equal(JSON.stringify(output).includes(SECRET_TOKEN), false);
  }
});
