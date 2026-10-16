import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClaudeCliProjectTaskExecutor } from '../../core/project/ClaudeCliProjectTaskExecutor.js';

type ExecutorInternals = {
  appendCapped(current: string, addition: string): string;
  parseResult(exitCode: number | null, stdout: string, stderr: string): {
    outcome: string;
    summary: string;
  };
};

const executor = new ClaudeCliProjectTaskExecutor() as unknown as ExecutorInternals;

test('Claude CLI capture stays within 256 KiB and preserves UTF-8 boundaries', () => {
  const prefix = 'x'.repeat(256 * 1024 - 1);
  const result = executor.appendCapped(prefix, 'éabc');
  assert.equal(Buffer.byteLength(result, 'utf8'), 256 * 1024 - 1);
  assert.equal(result, prefix);
  assert.equal(executor.appendCapped('x'.repeat(256 * 1024), 'extra').length, 256 * 1024);
});

test('Claude CLI JSON success requires exit code zero', () => {
  const payload = JSON.stringify({ result: 'finished', is_error: false });
  assert.equal(executor.parseResult(1, payload, '').outcome, 'failed');
  assert.equal(executor.parseResult(null, payload, '').outcome, 'failed');
  assert.equal(executor.parseResult(0, payload, '').outcome, 'completed');
  assert.equal(executor.parseResult(0, JSON.stringify({ result: 'error', is_error: true }), '').outcome, 'failed');
});
