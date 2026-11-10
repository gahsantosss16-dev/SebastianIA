import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubControlledWriteTool, GITHUB_CREATE_BRANCH_TOOL_ID, GITHUB_OPEN_PULL_REQUEST_TOOL_ID, GITHUB_UPSERT_FILE_TOOL_ID } from '../../core/tool/GitHubControlledWriteTool.js';
import { ProjectRegistry } from '../../core/project/ProjectRegistry.js';

const registry = new ProjectRegistry({ readOnly: true, entries: [{ id: 'lumarkis-financeiro', displayName: 'LUMARKIS', aliases: [], resourceKind: 'github-repository', remoteRepository: { owner: 'gahsantosss16-dev', repository: 'financeiro-lumarkis', defaultBranch: 'main' }, permissions: { access: 'controlled-write' } }] });
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
  assert.equal((await outcome(tool, GITHUB_CREATE_BRANCH_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/visual-small-change' }))?.outcome, 'ok');
  assert.equal((await outcome(tool, GITHUB_UPSERT_FILE_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/visual-small-change', path: 'public/style.css', content: 'x', message: 'style: small visual change' }))?.outcome, 'ok');
  assert.equal((await outcome(tool, GITHUB_OPEN_PULL_REQUEST_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/visual-small-change', title: 'Visual small change' }))?.outcome, 'ok');
  assert.equal(calls.some((call) => call.url.includes('/git/refs') && JSON.stringify(call.init).includes('refs/heads/main')), false);
  assert.equal(calls.some((call) => call.url.includes('/pulls') && JSON.stringify(call.init).includes('"base":"main"')), true);
});

test('controlled GitHub write flow rejects main and protected files before network access', async () => {
  let calls = 0;
  const tool = new GitHubControlledWriteTool('secret', registry, async () => { calls += 1; return { ok: true, status: 200, text: async () => '{}' }; });
  const main = await outcome(tool, GITHUB_CREATE_BRANCH_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'main' });
  const protectedFile = await outcome(tool, GITHUB_UPSERT_FILE_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/fix', path: '.env', content: 'x', message: 'x' });
  assert.equal(main?.outcome, 'rejected');
  assert.equal(protectedFile?.outcome, 'rejected');
  assert.equal(calls, 0);
});

test('controlled writes reject every project other than LUMARKIS before network access', async () => {
  const otherRegistry = new ProjectRegistry({ readOnly: true, entries: [{ id: 'sebastiania', displayName: 'SebastianIA', aliases: [], resourceKind: 'github-repository', remoteRepository: { owner: 'gahsantosss16-dev', repository: 'SebastianIA', defaultBranch: 'main' }, permissions: { access: 'controlled-write' } }] });
  let calls = 0;
  const tool = new GitHubControlledWriteTool('separate-write-token', otherRegistry, async () => { calls += 1; return { ok: true, status: 200, text: async () => '{}' }; });
  const result = await outcome(tool, GITHUB_CREATE_BRANCH_TOOL_ID, { projectId: 'sebastiania', branch: 'sebastian/blocked-write' });
  assert.equal(result?.outcome, 'rejected');
  assert.equal(result?.reasonCode, 'writeNotEnabled');
  assert.equal(calls, 0);
});
