import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubControlledWriteTool, GITHUB_CREATE_BRANCH_TOOL_ID, GITHUB_OPEN_PULL_REQUEST_TOOL_ID, GITHUB_UPSERT_FILE_TOOL_ID } from '../../core/tool/GitHubControlledWriteTool.js';
import { ProjectRegistry } from '../../core/project/ProjectRegistry.js';

const registry = new ProjectRegistry({ readOnly: true, entries: [{ id: 'safe', displayName: 'Safe', aliases: [], resourceKind: 'github-repository', remoteRepository: { owner: 'o', repository: 'r', defaultBranch: 'main' }, permissions: { access: 'controlled-write' } }] });
const invocation = (toolId: string, payload: Record<string, unknown>) => ({ toolId, payload, executionId: 'e', responsibilityId: 'r', requestedAt: '2026-11-09T00:00:00.000Z' });
const outcome = async (tool: GitHubControlledWriteTool, toolId: string, payload: Record<string, unknown>) => {
  const result = await tool.invoke(invocation(toolId, payload));
  assert.equal(result.status, 'completed');
  return result.status === 'completed' ? result.output : undefined;
};

test('controlled GitHub write flow only targets a task branch and never main', async () => {
  const calls: Array<{ url: string; init: Readonly<Record<string, unknown>> }> = [];
  const tool = new GitHubControlledWriteTool('secret', registry, async (url, init) => {
    calls.push({ url, init });
    const body = url.includes('/git/ref/heads/') ? { object: { sha: 'abc' } } : {};
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  assert.equal((await outcome(tool, GITHUB_CREATE_BRANCH_TOOL_ID, { projectId: 'safe', branch: 'sebastian/visual-small-change' }))?.outcome, 'ok');
  assert.equal((await outcome(tool, GITHUB_UPSERT_FILE_TOOL_ID, { projectId: 'safe', branch: 'sebastian/visual-small-change', path: 'public/style.css', content: 'x', message: 'style: small visual change' }))?.outcome, 'ok');
  assert.equal((await outcome(tool, GITHUB_OPEN_PULL_REQUEST_TOOL_ID, { projectId: 'safe', branch: 'sebastian/visual-small-change', title: 'Visual small change' }))?.outcome, 'ok');
  assert.equal(calls.some((call) => call.url.includes('/git/refs') && JSON.stringify(call.init).includes('refs/heads/main')), false);
  assert.equal(calls.some((call) => call.url.includes('/pulls') && JSON.stringify(call.init).includes('"base":"main"')), true);
});

test('controlled GitHub write flow rejects main and protected files before network access', async () => {
  let calls = 0;
  const tool = new GitHubControlledWriteTool('secret', registry, async () => { calls += 1; return { ok: true, status: 200, text: async () => '{}' }; });
  const main = await outcome(tool, GITHUB_CREATE_BRANCH_TOOL_ID, { projectId: 'safe', branch: 'main' });
  const protectedFile = await outcome(tool, GITHUB_UPSERT_FILE_TOOL_ID, { projectId: 'safe', branch: 'sebastian/fix', path: '.env', content: 'x', message: 'x' });
  assert.equal(main?.outcome, 'rejected');
  assert.equal(protectedFile?.outcome, 'rejected');
  assert.equal(calls, 0);
});
