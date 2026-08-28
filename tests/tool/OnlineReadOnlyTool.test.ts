import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FILESYSTEM_READ_FILE_TOOL_ID,
  GIT_DIFF_TOOL_ID,
  GIT_STATUS_TOOL_ID,
  OnlineReadOnlyTool,
  PROJECT_SEARCH_TEXT_TOOL_ID,
  VALIDATION_TYPECHECK_TOOL_ID,
} from '../../core/tool/index.js';

test('online read-only boundary permits bounded investigation and rejects writes, secrets and traversal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-online-read-only-'));
  try {
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'service.ts'), 'export const failureCause = "missing queue";\n', 'utf8');
    writeFileSync(join(root, '.env'), 'API_TOKEN=must-not-leak\n', 'utf8');
    execFileSync('git', ['config', 'user.email', 'sebastian@test.local'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Sebastian Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: root, stdio: 'ignore' });
    writeFileSync(join(root, 'src', 'service.ts'), 'export const failureCause = "queue unavailable";\n', 'utf8');
    writeFileSync(join(root, '.env'), 'API_TOKEN=new-must-not-leak\n', 'utf8');
    const tool = new OnlineReadOnlyTool(root, [{
      toolId: VALIDATION_TYPECHECK_TOOL_ID,
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("checked")'],
      timeoutMs: 2_000,
    }]);
    const invocation = (toolId: string, payload: Readonly<Record<string, unknown>> = {}) => ({
      toolId,
      executionId: 'execution:1',
      responsibilityId: 'capability.execute.converse',
      requestedAt: '2026-08-28T00:00:00.000Z',
      payload,
    });

    const status = await tool.invoke(invocation(GIT_STATUS_TOOL_ID));
    assert.equal(status.status, 'completed');
    if (status.status === 'completed') assert.equal(status.output.outcome, 'ok');

    const diff = await tool.invoke(invocation(GIT_DIFF_TOOL_ID));
    assert.equal(diff.status, 'completed');
    if (diff.status === 'completed') {
      assert.match(String(diff.output.message), /queue unavailable/);
      assert.equal(JSON.stringify(diff.output).includes('new-must-not-leak'), false);
      assert.equal(diff.output.sensitiveSectionsOmitted, true);
    }

    const search = await tool.invoke(invocation(PROJECT_SEARCH_TEXT_TOOL_ID, { query: 'failureCause' }));
    assert.equal(search.status, 'completed');
    if (search.status === 'completed') assert.match(String(search.output.message), /src\/service\.ts:1/);

    const read = await tool.invoke(invocation(FILESYSTEM_READ_FILE_TOOL_ID, { path: 'src/service.ts' }));
    assert.equal(read.status, 'completed');
    if (read.status === 'completed') assert.match(String(read.output.message), /queue unavailable/);

    const validation = await tool.invoke(invocation(VALIDATION_TYPECHECK_TOOL_ID));
    assert.equal(validation.status, 'completed');
    if (validation.status === 'completed') assert.equal(validation.output.succeeded, true);

    for (const protectedPath of ['.env', '../outside.txt', '..\\outside.txt', 'invented.ts']) {
      const result = await tool.invoke(invocation(FILESYSTEM_READ_FILE_TOOL_ID, { path: protectedPath }));
      assert.equal(result.status, 'completed');
      if (result.status === 'completed') assert.equal(result.output.outcome, 'rejected');
    }

    for (const forbidden of ['fs.replaceText', 'shell.run', 'deploy.run', 'validation.invented']) {
      const result = await tool.invoke(invocation(forbidden));
      assert.equal(result.status, 'completed');
      if (result.status === 'completed') assert.equal(result.output.outcome, 'rejected');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
