import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCliProjectTaskExecutor } from '../../core/project/ClaudeCliProjectTaskExecutor.js';
import type { ProjectTaskExecutionRequest } from '../../core/project/ProjectTaskExecutor.js';

/**
 * Drives the real executor (real spawn, real argument building, real result
 * parsing) against a fake `claude` executable - never the real CLI, so no
 * model call and no cost. The fake is a shebang Node script, which `spawn`
 * without a shell cannot launch on Windows, hence the skip there.
 */
const skip = process.platform === 'win32' ? 'fake CLI is a shebang script; spawn without shell cannot run it on Windows' : false;

const FAKE_CLI = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(process.env.FAKE_CLI_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
const mode = process.env.FAKE_CLI_MODE;
const out = (payload, code) => { process.stdout.write(JSON.stringify(payload)); process.exit(code); };
if (mode === 'sleep') setTimeout(() => out({ type: 'result', subtype: 'success', is_error: false, result: 'tarde demais' }, 0), 10000);
else if (mode === 'budget-exit-0') out({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, errors: [] }, 0);
else if (mode === 'budget-exit-1') out({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, errors: [] }, 1);
else if (mode === 'max-turns') out({ type: 'result', subtype: 'error_max_turns', is_error: false, errors: ['limite de turnos'] }, 0);
else out({ type: 'result', subtype: 'success', is_error: false, result: 'Resumo real do executor.' }, 0);
`;

function fixture(mode = 'ok') {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-claude-cli-'));
  const executablePath = join(dir, 'fake-claude.cjs');
  writeFileSync(executablePath, FAKE_CLI);
  chmodSync(executablePath, 0o755);
  const log = join(dir, 'calls.log');
  process.env.FAKE_CLI_LOG = log;
  process.env.FAKE_CLI_MODE = mode;
  const calls = (): { cwd: string; args: string[] }[] =>
    readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { cwd: string; args: string[] });
  return { dir, executablePath, calls };
}

function request(dir: string, authorization: ProjectTaskExecutionRequest['authorization'], signal?: AbortSignal): ProjectTaskExecutionRequest {
  return {
    taskId: 't1', projectId: 'demo', workspaceRoot: dir, authorization, instructions: 'analisa o calc',
    conversationId: 'c1', executionId: 'e1', ...(signal === undefined ? {} : { signal }),
  };
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

test('readOnly runs restricted, without Edit/Write, in dontAsk mode, inside the workspace root and with the read-only budget', { skip }, async () => {
  const { dir, executablePath, calls } = fixture();
  const result = await new ClaudeCliProjectTaskExecutor({ executablePath }).execute(request(dir, 'readOnly'));

  assert.deepEqual(result.outcome, 'completed');
  assert.equal(result.summary, 'Resumo real do executor.');
  const [call] = calls();
  assert.equal(call!.cwd, dir);
  assert.ok(call!.args.includes('--restricted'));
  assert.ok(call!.args.includes('--strict-mcp-config'));
  assert.ok(call!.args.includes('--no-session-persistence'));
  assert.equal(argValue(call!.args, '--tools'), 'Read,Grep,Glob');
  assert.equal(argValue(call!.args, '--permission-mode'), 'dontAsk');
  assert.equal(argValue(call!.args, '--max-budget-usd'), '0.5');
});

test('writeAuthorized adds only Edit/Write (never Bash), uses acceptEdits and the write budget; configured budgets are honored', { skip }, async () => {
  const { dir, executablePath, calls } = fixture();
  await new ClaudeCliProjectTaskExecutor({ executablePath }).execute(request(dir, 'writeAuthorized'));
  await new ClaudeCliProjectTaskExecutor({ executablePath, readOnlyMaxBudgetUsd: 0.1, writeMaxBudgetUsd: 0.3 }).execute(request(dir, 'writeAuthorized'));
  await new ClaudeCliProjectTaskExecutor({ executablePath, readOnlyMaxBudgetUsd: 0.1, writeMaxBudgetUsd: 0.3 }).execute(request(dir, 'readOnly'));

  const [write, customWrite, customRead] = calls();
  assert.equal(argValue(write!.args, '--tools'), 'Read,Grep,Glob,Edit,Write');
  assert.equal(argValue(write!.args, '--permission-mode'), 'acceptEdits');
  assert.equal(argValue(write!.args, '--max-budget-usd'), '2');
  assert.equal(argValue(customWrite!.args, '--max-budget-usd'), '0.3');
  assert.equal(argValue(customRead!.args, '--max-budget-usd'), '0.1');
});

test('a CLI error result without result text (budget limit) is a failure naming the cost limit, even when the CLI exits 0', { skip }, async () => {
  for (const mode of ['budget-exit-0', 'budget-exit-1']) {
    const { dir, executablePath } = fixture(mode);
    const result = await new ClaudeCliProjectTaskExecutor({ executablePath }).execute(request(dir, 'writeAuthorized'));

    assert.equal(result.outcome, 'failed', mode);
    assert.match(result.summary, /limite de custo/, mode);
    assert.doesNotMatch(result.summary, /"subtype"/, `${mode}: the raw JSON must never be presented as the summary`);
  }
});

test('any non-success CLI result subtype is a failure that keeps the stop reason', { skip }, async () => {
  const { dir, executablePath } = fixture('max-turns');
  const result = await new ClaudeCliProjectTaskExecutor({ executablePath }).execute(request(dir, 'readOnly'));

  assert.equal(result.outcome, 'failed');
  assert.match(result.summary, /limite de turnos/);
});

test('a timeout is reported as timedOut, never as an unavailable executor', { skip }, async () => {
  const { dir, executablePath } = fixture('sleep');
  const result = await new ClaudeCliProjectTaskExecutor({ executablePath, timeoutMs: 300 }).execute(request(dir, 'readOnly'));

  assert.equal(result.outcome, 'timedOut');
  assert.match(result.summary, /tempo limite de 300ms/);
  assert.doesNotMatch(result.summary, /indisponivel/);
});

test('an external cancellation is reported as cancelled, never as an unavailable executor', { skip }, async () => {
  const { dir, executablePath } = fixture('sleep');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const result = await new ClaudeCliProjectTaskExecutor({ executablePath }).execute(request(dir, 'readOnly', controller.signal));

  assert.equal(result.outcome, 'cancelled');
  assert.doesNotMatch(result.summary, /indisponivel/);
});

test('a missing executable is reported as an unavailable executor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sebastian-claude-cli-missing-'));
  const result = await new ClaudeCliProjectTaskExecutor({ executablePath: join(dir, 'does-not-exist') }).execute(request(dir, 'readOnly'));

  assert.equal(result.outcome, 'failed');
  assert.match(result.summary, /Executor indisponivel/);
});
