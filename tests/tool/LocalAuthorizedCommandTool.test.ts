import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAuthorizedCommandTool } from '../../core/tool/LocalAuthorizedCommandTool.js';
import { InvalidSpecializedToolInvocationInputError } from '../../core/tool/SpecializedToolInvocationErrors.js';
import type { SpecializedToolInvocationInput } from '../../core/tool/SpecializedToolInvocationContract.js';

function withFixtureRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sebastian-authorized-command-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function invocation(toolId: string): SpecializedToolInvocationInput {
  return {
    toolId,
    executionId: 'converse:2026-08-12T00:00:00.000Z',
    responsibilityId: 'capability.execute.converse',
    requestedAt: '2026-08-12T00:00:00.000Z',
    payload: {},
  };
}

test('runs an authorized command that succeeds and reports exit code 0', () => {
  withFixtureRoot((root) => {
    const tool = new LocalAuthorizedCommandTool(root, [
      { toolId: 'validation.ok', executable: process.execPath, args: ['-e', "console.log('tudo certo')"] },
    ]);

    const result = tool.invoke(invocation('validation.ok'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'ok');
    assert.equal(result.output.succeeded, true);
    assert.equal(result.output.exitCode, 0);
    assert.ok((result.output.stdout as string).includes('tudo certo'));
  });
});

test('runs an authorized command that fails and reports the real, non-zero exit code', () => {
  withFixtureRoot((root) => {
    const tool = new LocalAuthorizedCommandTool(root, [
      { toolId: 'validation.fails', executable: process.execPath, args: ['-e', 'process.exit(7)'] },
    ]);

    const result = tool.invoke(invocation('validation.fails'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'ok');
    assert.equal(result.output.succeeded, false);
    assert.equal(result.output.exitCode, 7);
  });
});

test('rejects an unauthorized toolId as a safe, friendly outcome instead of running anything', () => {
  withFixtureRoot((root) => {
    const tool = new LocalAuthorizedCommandTool(root, [
      { toolId: 'validation.ok', executable: process.execPath, args: ['-e', "console.log('x')"] },
    ]);

    const result = tool.invoke(invocation('validation.nao-registrada'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'rejected');
    assert.equal(result.output.reasonCode, 'notAuthorized');
  });
});

test('kills a command that exceeds its timeout and reports it as a safe, friendly outcome', () => {
  withFixtureRoot((root) => {
    const tool = new LocalAuthorizedCommandTool(root, [
      {
        toolId: 'validation.slow',
        executable: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 5000)'],
        timeoutMs: 300,
      },
    ]);

    const result = tool.invoke(invocation('validation.slow'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'rejected');
    assert.equal(result.output.reasonCode, 'timedOut');
  });
});

test('truncates captured stdout beyond the safe limit instead of returning it unbounded', () => {
  withFixtureRoot((root) => {
    const tool = new LocalAuthorizedCommandTool(root, [
      {
        toolId: 'validation.verbose',
        executable: process.execPath,
        args: ['-e', "process.stdout.write('a'.repeat(200000))"],
      },
    ]);

    const result = tool.invoke(invocation('validation.verbose'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    assert.equal(result.output.outcome, 'ok');
    assert.equal(result.output.stdoutTruncated, true);
    assert.ok((result.output.stdout as string).length <= 64 * 1024);
  });
});

test('never lets an argument be interpreted by a shell, even when it contains shell metacharacters', () => {
  withFixtureRoot((root) => {
    const tool = new LocalAuthorizedCommandTool(root, [
      {
        toolId: 'validation.echoArg',
        executable: process.execPath,
        args: ['-e', 'console.log(process.argv[1])', 'a && echo INJECTED || echo INJECTED'],
      },
    ]);

    const result = tool.invoke(invocation('validation.echoArg'));

    assert.equal(result.status, 'completed');
    if (result.status !== 'completed') {
      assert.fail('Expected completed status.');
    }
    // With shell:false, the metacharacter-laden string reaches the child
    // process as a single, literal argv element - never interpreted, never
    // split into multiple shell commands.
    const stdout = (result.output.stdout as string).trim();
    assert.equal(stdout, 'a && echo INJECTED || echo INJECTED');
  });
});

test('reports a failed status for a genuinely unexpected execution error, not a friendly rejection', () => {
  withFixtureRoot((root) => {
    const tool = new LocalAuthorizedCommandTool(root, [
      { toolId: 'validation.missing', executable: join(root, 'this-executable-does-not-exist'), args: [] },
    ]);

    const result = tool.invoke(invocation('validation.missing'));

    assert.equal(result.status, 'failed');
  });
});

test('rejects construction with an invalid command definition', () => {
  withFixtureRoot((root) => {
    assert.throws(
      () => new LocalAuthorizedCommandTool(root, [{ toolId: '', executable: 'node', args: [] }]),
      (error: unknown) => {
        assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
        return true;
      },
    );

    assert.throws(
      () => new LocalAuthorizedCommandTool(root, [{ toolId: 'validation.x', executable: '', args: [] }]),
      (error: unknown) => {
        assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
        return true;
      },
    );
  });
});

test('rejects a non-empty allowed root argument requirement', () => {
  assert.throws(
    () => new LocalAuthorizedCommandTool('   ', []),
    (error: unknown) => {
      assert.ok(error instanceof InvalidSpecializedToolInvocationInputError);
      return true;
    },
  );
});
