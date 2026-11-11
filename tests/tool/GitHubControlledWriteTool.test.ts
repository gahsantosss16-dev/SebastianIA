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
    // A real contents PUT returns the commit; the tool never reports a write
    // without that confirmed commit SHA (commit 3147525).
    const body = url.includes('/git/ref/heads/') ? { object: { sha: 'abc' } }
      : url.includes('/contents/') && init.method === 'PUT' ? { commit: { sha: 'def4567890' } } : {};
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  assert.equal((await outcome(tool, GITHUB_CREATE_BRANCH_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/visual-small-change' }))?.outcome, 'ok');
  assert.equal((await outcome(tool, GITHUB_UPSERT_FILE_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/visual-small-change', path: 'public/style.css', content: 'x', message: 'style: small visual change' }))?.outcome, 'ok');
  assert.equal((await outcome(tool, GITHUB_OPEN_PULL_REQUEST_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/visual-small-change', title: 'Visual small change' }))?.outcome, 'ok');
  assert.equal(calls.some((call) => call.url.includes('/git/refs') && JSON.stringify(call.init).includes('refs/heads/main')), false);
  // The request body is already a JSON string; inspect it parsed, not re-stringified.
  assert.equal(calls.some((call) => call.url.includes('/pulls') && (JSON.parse(String(call.init.body)) as { base?: unknown }).base === 'main'), true);
  assert.equal(calls.some((call) => call.url.includes('/git/refs') && (JSON.parse(String(call.init.body)) as { ref?: unknown }).ref === 'refs/heads/sebastian/visual-small-change'), true);
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

test('controlled GitHub writes report only the evidence GitHub returned: branch, commit and PR number', async () => {
  const tool = new GitHubControlledWriteTool('secret', registry, async (url, init) => {
    const method = String(init.method);
    if (url.includes('/git/ref/heads/')) return { ok: true, status: 200, text: async () => JSON.stringify({ object: { sha: 'base1234567' } }) };
    if (url.includes('/git/refs')) return { ok: true, status: 201, text: async () => '{}' };
    if (url.includes('/contents/') && method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify({ sha: 'old-blob' }) };
    if (url.includes('/contents/')) return { ok: true, status: 200, text: async () => JSON.stringify({ commit: { sha: 'c0ffee12345' } }) };
    return { ok: true, status: 201, text: async () => JSON.stringify({ number: 7, html_url: 'https://github.com/gahsantosss16-dev/financeiro-lumarkis/pull/7' }) };
  });
  const branch = await outcome(tool, GITHUB_CREATE_BRANCH_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/fix' });
  assert.match(String(branch?.message), /Branch "sebastian\/fix" criada no GitHub a partir de "main" \(commit base base123\)/);
  const file = await outcome(tool, GITHUB_UPSERT_FILE_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/fix', path: 'README.md', content: 'x', message: 'docs' });
  assert.match(String(file?.message), /Arquivo "README\.md" alterado na branch "sebastian\/fix"; commit c0ffee1 registrado no GitHub\./);
  assert.equal(file?.commitSha, 'c0ffee12345');
  const pr = await outcome(tool, GITHUB_OPEN_PULL_REQUEST_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/fix', title: 'Fix' });
  assert.match(String(pr?.message), /Pull request #7 aberto da branch "sebastian\/fix" para "main"/);
  assert.equal(pr?.pullRequestNumber, 7);
  for (const message of [branch?.message, file?.message, pr?.message]) assert.doesNotMatch(String(message), /test|valida|Corrigido/i);
});

test('controlled GitHub writes never claim a commit GitHub did not confirm', async () => {
  const noCommit = new GitHubControlledWriteTool('secret', registry, async (_url, init) => ({ ok: String(init.method) !== 'GET', status: String(init.method) === 'GET' ? 404 : 201, text: async () => '{}' }));
  const accepted = await outcome(noCommit, GITHUB_UPSERT_FILE_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/fix', path: 'novo.md', content: 'x', message: 'docs' });
  assert.equal(accepted?.outcome, 'ok');
  assert.match(String(accepted?.message), /não retornou o identificador do commit/);
  assert.doesNotMatch(String(accepted?.message), /commit \w+ registrado/);

  const rejected = new GitHubControlledWriteTool('secret', registry, async () => ({ ok: false, status: 422, text: async () => '{}' }));
  const pr = await outcome(rejected, GITHUB_OPEN_PULL_REQUEST_TOOL_ID, { projectId: 'lumarkis-financeiro', branch: 'sebastian/fix', title: 'Fix' });
  assert.equal(pr?.outcome, 'rejected');
  assert.match(String(pr?.message), /não confirmou a abertura do pull request da branch "sebastian\/fix" \(HTTP 422\)/);
});
