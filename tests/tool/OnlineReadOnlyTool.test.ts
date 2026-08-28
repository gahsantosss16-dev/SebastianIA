import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GIT_DIFF_TOOL_ID, GIT_STATUS_TOOL_ID, OnlineReadOnlyTool } from '../../core/tool/index.js';

test('online read-only catalog permits git.status and rejects every other Tool', () => {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-online-read-only-'));
  try {
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    const tool = new OnlineReadOnlyTool(root);
    const invocation = (toolId: string) => ({
      toolId,
      executionId: 'execution:1',
      responsibilityId: 'capability.execute.converse',
      requestedAt: '2026-08-28T00:00:00.000Z',
      payload: {},
    });

    const status = tool.invoke(invocation(GIT_STATUS_TOOL_ID));
    assert.equal(status.status, 'completed');
    if (status.status === 'completed') assert.equal(status.output.outcome, 'ok');

    for (const forbidden of [GIT_DIFF_TOOL_ID, 'fs.readFile', 'fs.replaceText', 'validation.test']) {
      const result = tool.invoke(invocation(forbidden));
      assert.equal(result.status, 'completed');
      if (result.status === 'completed') assert.equal(result.output.reasonCode, 'onlineProfileRestricted');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
